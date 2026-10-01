"""Transactional outbox: enqueue with the order, deliver later (Addendum 001 §A3).

Two invariants drive the design:
* the outbox row is written in the *same* transaction as the order, so an order can never
  exist without its notification (and a rolled-back order leaves no orphan email);
* delivery never runs inside the request, so a provider outage cannot fail an order.
"""

import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from pydantic import JsonValue
from sqlmodel import Session, col, select

from app.config import settings
from app.models import Customer, EmailOutbox, EmailOutboxStatus, EmailTemplate, Order, SiteSetting
from app.services.email.base import (
    EmailMessage,
    EmailProvider,
    PermanentEmailError,
    TransientEmailError,
)
from app.services.email.factory import get_email_provider
from app.services.email.templates import (
    default_site_url,
    outbox_payload,
    render_order_received_customer,
    render_order_received_farm,
)

logger = logging.getLogger("adesoba.email.outbox")

MAX_ATTEMPTS = 5
BASE_BACKOFF_SECONDS = 60
QUOTA_DEFERRAL_SECONDS = 3600


def _site_url(session: Session) -> str:
    setting = session.exec(select(SiteSetting).where(SiteSetting.key == "site_url")).first()
    if setting is not None and isinstance(setting.value, str):
        return setting.value
    return default_site_url()


def _whatsapp_number(session: Session) -> str | None:
    setting = session.exec(select(SiteSetting).where(SiteSetting.key == "whatsapp_number")).first()
    if setting is not None and isinstance(setting.value, str):
        return setting.value
    return None


def enqueue_order_emails(session: Session, order: Order, customer: Customer) -> list[EmailOutbox]:
    """
    Add the customer and farm emails for an order to the outbox (same transaction).

    Concurrency race: a retried submission with the same Idempotency-Key could enqueue a
    second copy while the first worker is still sending the first one.
    Prevention: UNIQUE(order_id, template) makes the duplicate insert fail, and the
    existing row is reused instead of creating a second email.
    """
    provider_name = (settings.email_provider or "console").strip().lower()
    site_url = _site_url(session)
    rows: list[EmailOutbox] = []

    farm_email = settings.farm_notify_email
    if farm_email:
        rendered = render_order_received_farm(
            order,
            customer.name,
            customer.phone_e164,
            site_url,
        )
        rows.append(
            _add_outbox_row(
                session,
                order_id=order.id,
                provider=provider_name,
                to_email=farm_email,
                template=EmailTemplate.ORDER_RECEIVED_FARM.value,
                subject=rendered.subject,
                payload=outbox_payload(rendered.subject, rendered.html_body, rendered.text_body),
            )
        )

    # Guest email is optional (Addendum §A3): only the farm email is sent without one.
    if customer.email:
        rendered = render_order_received_customer(
            order,
            customer.name,
            site_url,
            _whatsapp_number(session),
        )
        rows.append(
            _add_outbox_row(
                session,
                order_id=order.id,
                provider=provider_name,
                to_email=customer.email,
                template=EmailTemplate.ORDER_RECEIVED_CUSTOMER.value,
                subject=rendered.subject,
                payload=outbox_payload(rendered.subject, rendered.html_body, rendered.text_body),
            )
        )

    return rows


def _add_outbox_row(
    session: Session,
    *,
    order_id: UUID,
    provider: str,
    to_email: str,
    template: str,
    subject: str,
    payload: JsonValue,
) -> EmailOutbox:
    existing = session.exec(
        select(EmailOutbox).where(
            col(EmailOutbox.order_id) == order_id,
            col(EmailOutbox.template) == template,
        )
    ).first()
    if existing is not None:
        return existing

    row = EmailOutbox(
        order_id=order_id,
        provider=provider,
        to_email=to_email,
        template=template,
        subject=subject,
        payload=payload,
        status=EmailOutboxStatus.PENDING.value,
        attempts=0,
        next_attempt_at=datetime.now(UTC),
    )
    session.add(row)
    session.flush()
    return row


def pending_rows(session: Session, limit: int = 10) -> list[EmailOutbox]:
    """Pending rows whose backoff window has elapsed (diagnostics and tests)."""
    now = datetime.now(UTC)
    return list(
        session.exec(
            select(EmailOutbox)
            .where(
                col(EmailOutbox.status) == EmailOutboxStatus.PENDING.value,
                col(EmailOutbox.next_attempt_at) <= now,
            )
            .order_by(col(EmailOutbox.next_attempt_at))
            .limit(limit)
        ).all()
    )


def _message_from_row(row: EmailOutbox) -> EmailMessage:
    payload = row.payload if isinstance(row.payload, dict) else {}
    return EmailMessage(
        to_email=row.to_email,
        subject=str(payload.get("subject") or row.subject or "Adesoba Farm"),
        html_body=str(payload.get("html_body", "")),
        text_body=str(payload.get("text_body", "")),
        from_address=settings.email_from_address,
        from_name=settings.email_from_name,
        reply_to=settings.email_reply_to or None,
    )


def _mark_sent(session: Session, row: EmailOutbox, provider_message_id: str) -> None:
    row.status = EmailOutboxStatus.SENT.value
    row.provider_message_id = provider_message_id
    row.last_error = None
    row.updated_at = datetime.now(UTC)
    session.add(row)
    session.commit()


def _mark_retry(
    session: Session,
    row: EmailOutbox,
    error: str,
    *,
    count_attempt: bool,
    delay_seconds: int,
) -> None:
    if count_attempt:
        row.attempts += 1
    row.last_error = error[:500]
    row.next_attempt_at = datetime.now(UTC) + timedelta(seconds=delay_seconds)
    row.status = (
        EmailOutboxStatus.FAILED.value
        if count_attempt and row.attempts >= MAX_ATTEMPTS
        else EmailOutboxStatus.PENDING.value
    )
    row.updated_at = datetime.now(UTC)
    session.add(row)
    session.commit()


def process_pending(session: Session, provider: EmailProvider | None = None, limit: int = 10) -> dict[str, int]:
    """
    Send due outbox rows.

    Concurrency race: two workers (API loop and cron) can pick the same row and both send.
    Prevention: each row is claimed with `SELECT ... FOR UPDATE SKIP LOCKED`, so the second
    worker skips rows the first one already locked, and a duplicate send is then impossible.
    """
    email_provider = provider or get_email_provider()
    summary = {"sent": 0, "retried": 0, "failed": 0, "deferred": 0}
    for row in _claim_batch(session, limit):
        try:
            provider_message_id = email_provider.send(_message_from_row(row))
        except TransientEmailError as error:
            summary["deferred"] += 1
            _mark_retry(
                session,
                row,
                str(error),
                # Quota/5xx is not the message's fault, so it does not burn an attempt.
                count_attempt=False,
                delay_seconds=QUOTA_DEFERRAL_SECONDS,
            )
            logger.warning("Email deferred (%s): %s", row.template, error)
        except PermanentEmailError as error:
            summary["failed"] += 1
            _mark_retry(session, row, str(error), count_attempt=True, delay_seconds=0)
            logger.error("Email permanently failed (%s): %s", row.template, error)
        except Exception as error:  # unexpected provider bug: retry with backoff
            summary["retried"] += 1
            _mark_retry(
                session,
                row,
                str(error),
                count_attempt=True,
                delay_seconds=BASE_BACKOFF_SECONDS * (2 ** row.attempts),
            )
            logger.exception("Email attempt raised (%s): %s", row.template, error)
        else:
            summary["sent"] += 1
            _mark_sent(session, row, provider_message_id)
    return summary


def _claim_batch(session: Session, limit: int) -> list[EmailOutbox]:
    """Select due rows, locking them so a second worker cannot claim the same rows."""
    bind = session.get_bind()
    dialect_name = bind.dialect.name if bind is not None else ""
    statement = (
        select(EmailOutbox)
        .where(
            col(EmailOutbox.status) == EmailOutboxStatus.PENDING.value,
            col(EmailOutbox.next_attempt_at) <= datetime.now(UTC),
        )
        .order_by(col(EmailOutbox.next_attempt_at))
        .limit(limit)
    )
    if dialect_name == "postgresql":
        statement = statement.with_for_update(skip_locked=True)
    claimed = list(session.exec(statement).all())
    session.commit()
    return claimed


def outbox_counts(session: Session) -> dict[str, int]:
    """Pending/failed counts for the admin dashboard (Addendum §A3)."""
    counts = {EmailOutboxStatus.PENDING.value: 0, EmailOutboxStatus.FAILED.value: 0, EmailOutboxStatus.SENT.value: 0}
    for row in session.exec(select(EmailOutbox)).all():
        counts[row.status] = counts.get(row.status, 0) + 1
    return counts


def outbox_row_to_payload(row: EmailOutbox) -> JsonValue:
    return row.payload
