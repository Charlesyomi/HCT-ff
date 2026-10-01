"""Transactional outbox and email provider tests (Addendum 001 §A3, §A6)."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.engine import Engine
from sqlmodel import Session, select

from app.config import settings
from app.models import EmailOutbox, EmailOutboxStatus, EmailTemplate, Order
from app.services.email.base import (
    EmailMessage,
    EmailProvider,
    PermanentEmailError,
    TransientEmailError,
)
from app.services.email.brevo import BrevoProvider
from app.services.email.console import ConsoleProvider
from app.services.email.factory import build_email_provider
from app.services.email.mailgun import MailgunProvider
from app.services.email.outbox import (
    MAX_ATTEMPTS,
    QUOTA_DEFERRAL_SECONDS,
    enqueue_order_emails,
    outbox_counts,
    process_pending,
)
from app.services.email.smtp import SmtpProvider
from app.services.email.templates import render_order_received_customer, render_order_received_farm


class RecordingProvider(EmailProvider):
    """Captures messages so tests can assert on provider calls without a network."""

    name = "recording"

    def __init__(self, error: Exception | None = None) -> None:
        self.messages: list[EmailMessage] = []
        self.error = error

    def send(self, message: EmailMessage) -> str:
        if self.error is not None:
            raise self.error
        self.messages.append(message)
        return f"recording-{len(self.messages)}"


@pytest.fixture(autouse=True)
def farm_email(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "farm_notify_email", "farm@adesoba.example")


def outbox_rows(engine: Engine) -> list[EmailOutbox]:
    with Session(engine) as session:
        return list(session.exec(select(EmailOutbox)).all())


# --- Order + outbox write in one transaction (A6) ---


def test_order_creation_writes_customer_and_farm_outbox_rows(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app

    response = client.post(
        "/api/v1/orders",
        json=order_payload(),
        headers={"Idempotency-Key": "email-1"},
    )

    assert response.status_code == 201
    rows = outbox_rows(engine)
    assert {row.template for row in rows} == {
        EmailTemplate.ORDER_RECEIVED_FARM.value,
        EmailTemplate.ORDER_RECEIVED_CUSTOMER.value,
    }
    assert all(row.status == EmailOutboxStatus.PENDING.value for row in rows)
    assert all(row.attempts == 0 for row in rows)
    assert all(row.provider == "console" for row in rows)
    recipients = {row.to_email for row in rows}
    assert recipients == {"farm@adesoba.example", "ada@example.com"}


def test_guest_without_email_only_queues_the_farm_email(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app

    response = client.post(
        "/api/v1/orders",
        json=order_payload(email=""),
        headers={"Idempotency-Key": "email-guest"},
    )

    assert response.status_code == 201
    rows = outbox_rows(engine)
    assert [row.template for row in rows] == [EmailTemplate.ORDER_RECEIVED_FARM.value]


def test_failed_order_creation_leaves_no_outbox_rows(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app

    response = client.post(
        "/api/v1/orders",
        json=order_payload(size="3kg-plus"),
        headers={"Idempotency-Key": "email-rejected"},
    )

    assert response.status_code == 422
    assert outbox_rows(engine) == []


def test_replayed_submission_does_not_duplicate_outbox_rows(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app

    first = client.post("/api/v1/orders", json=order_payload(), headers={"Idempotency-Key": "email-replay"})
    second = client.post("/api/v1/orders", json=order_payload(), headers={"Idempotency-Key": "email-replay"})

    assert first.status_code == 201
    assert second.status_code == 201
    assert len(outbox_rows(engine)) == 2


def test_unique_order_template_constraint_prevents_duplicate_rows(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app
    client.post("/api/v1/orders", json=order_payload(), headers={"Idempotency-Key": "email-unique"})

    with Session(engine) as session:
        order = session.exec(select(Order)).one()
        customer = order.customer_id
        assert customer is not None
        from app.models import Customer

        customer_row = session.exec(select(Customer).where(Customer.id == order.customer_id)).one()
        extra = enqueue_order_emails(session, order, customer_row)
        session.commit()

    assert len(extra) == 2
    assert len(outbox_rows(engine)) == 2


# --- Worker behaviour ---


def test_worker_sends_pending_rows_and_records_provider_message_ids(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app
    client.post("/api/v1/orders", json=order_payload(), headers={"Idempotency-Key": "worker-1"})
    provider = RecordingProvider()

    with Session(engine) as session:
        summary = process_pending(session, provider=provider)

    assert summary["sent"] == 2
    assert len(provider.messages) == 2
    assert {message.to_email for message in provider.messages} == {
        "farm@adesoba.example",
        "ada@example.com",
    }
    rows = outbox_rows(engine)
    assert all(row.status == EmailOutboxStatus.SENT.value for row in rows)
    assert all(row.provider_message_id for row in rows)


def test_provider_failure_never_breaks_a_submitted_order(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app

    created = client.post("/api/v1/orders", json=order_payload(), headers={"Idempotency-Key": "worker-2"})
    assert created.status_code == 201

    provider = RecordingProvider(error=TransientEmailError("provider timeout"))
    with Session(engine) as session:
        summary = process_pending(session, provider=provider)

    assert summary["deferred"] == 2
    rows = outbox_rows(engine)
    assert all(row.status == EmailOutboxStatus.PENDING.value for row in rows)
    assert all("provider timeout" in (row.last_error or "") for row in rows)


def test_quota_response_defers_without_burning_an_attempt(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app
    client.post("/api/v1/orders", json=order_payload(), headers={"Idempotency-Key": "quota"})

    with Session(engine) as session:
        process_pending(session, provider=RecordingProvider(error=TransientEmailError("HTTP 429 quota")))
        rows = list(session.exec(select(EmailOutbox)).all())
        for row in rows:
            assert row.attempts == 0
            assert row.status == EmailOutboxStatus.PENDING.value
            deferred_until = row.next_attempt_at.replace(tzinfo=row.next_attempt_at.tzinfo or UTC)
            assert deferred_until >= datetime.now(UTC) + timedelta(seconds=QUOTA_DEFERRAL_SECONDS - 30)


def test_permanent_failures_exhaust_attempts_and_mark_failed(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app
    client.post("/api/v1/orders", json=order_payload(), headers={"Idempotency-Key": "permanent"})
    provider = RecordingProvider(error=PermanentEmailError("recipient rejected"))

    with Session(engine) as session:
        for _ in range(MAX_ATTEMPTS):
            session.query(EmailOutbox).update({"next_attempt_at": datetime.now(UTC)})
            session.commit()
            process_pending(session, provider=provider)

    rows = outbox_rows(engine)
    assert all(row.status == EmailOutboxStatus.FAILED.value for row in rows)
    assert all(row.attempts == MAX_ATTEMPTS for row in rows)
    assert outbox_counts_from(engine)["failed"] == 2


def outbox_counts_from(engine: Engine) -> dict[str, int]:
    with Session(engine) as session:
        return outbox_counts(session)


def test_deferred_rows_are_not_picked_up_before_their_time(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app
    client.post("/api/v1/orders", json=order_payload(), headers={"Idempotency-Key": "deferred"})

    provider = RecordingProvider(error=TransientEmailError("HTTP 429"))
    with Session(engine) as session:
        process_pending(session, provider=provider)
        provider.error = None
        assert process_pending(session, provider=provider)["sent"] == 0
        assert provider.messages == []
    rows = outbox_rows(engine)
    assert all(row.status == EmailOutboxStatus.PENDING.value for row in rows)


# --- Providers (A6: changing EMAIL_PROVIDER needs no code change) ---


def test_every_configured_provider_can_be_built_without_code_changes() -> None:
    assert isinstance(build_email_provider("console"), ConsoleProvider)
    assert isinstance(build_email_provider("brevo"), BrevoProvider)
    assert isinstance(build_email_provider("mailgun"), MailgunProvider)
    assert isinstance(build_email_provider("smtp"), SmtpProvider)
    assert isinstance(build_email_provider(), ConsoleProvider)
    with pytest.raises(ValueError):
        build_email_provider("sendgrid")


def test_brevo_maps_transient_and_permanent_responses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = BrevoProvider(api_key="key")

    monkeypatch.setattr(
        "app.services.email.brevo.httpx.post",
        lambda *args, **kwargs: _FakeResponse(429, {"message": "quota"}),
    )
    with pytest.raises(TransientEmailError):
        provider.send(_sample_message())

    monkeypatch.setattr(
        "app.services.email.brevo.httpx.post",
        lambda *args, **kwargs: _FakeResponse(400, {"message": "bad recipient"}),
    )
    with pytest.raises(PermanentEmailError):
        provider.send(_sample_message())

    monkeypatch.setattr(
        "app.services.email.brevo.httpx.post",
        lambda *args, **kwargs: _FakeResponse(201, {"messageId": "<20261001.1@brevo>"}),
    )
    assert provider.send(_sample_message()) == "<20261001.1@brevo>"


def test_mailgun_uses_the_configured_region_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, str] = {}

    def fake_post(url: str, **kwargs: Any) -> _FakeResponse:
        captured["url"] = url
        return _FakeResponse(200, {"id": "<mg-1>"})

    monkeypatch.setattr("app.services.email.mailgun.httpx.post", fake_post)
    provider = MailgunProvider(api_key="key", domain="mg.example", base_url="https://api.eu.mailgun.net/v3")

    assert provider.send(_sample_message()) == "<mg-1>"
    assert captured["url"].startswith("https://api.eu.mailgun.net/v3/mg.example/messages")


def test_smtp_provider_requires_a_host() -> None:
    provider = SmtpProvider(host="")
    with pytest.raises(PermanentEmailError):
        provider.send(_sample_message())


def _sample_message() -> EmailMessage:
    return EmailMessage(
        to_email="customer@example.com",
        subject="Hello",
        html_body="<p>Hello</p>",
        text_body="Hello",
        from_address="no-reply@example.com",
        from_name="Adesoba Farm",
    )


class _FakeResponse:
    def __init__(self, status_code: int, body: dict[str, Any]) -> None:
        self.status_code = status_code
        self._body = body

    def json(self) -> dict[str, Any]:
        return self._body


# --- Templates ---


def test_customer_email_never_contains_an_access_token(
    order_app: tuple[TestClient, Engine],
    order_payload: Callable[..., dict[str, Any]],
) -> None:
    client, engine = order_app
    created = client.post("/api/v1/orders", json=order_payload(), headers={"Idempotency-Key": "tpl-1"})
    access_token = created.json()["access_token"]
    reference = created.json()["reference"]

    with Session(engine) as session:
        order = session.exec(select(Order)).one()
        rendered = render_order_received_customer(order, "Ada Okafor", "https://adesoba.example", "+2348012345678")

    assert reference in rendered.subject
    assert reference in rendered.html_body
    assert "https://adesoba.example/my-orders?reference=" in rendered.html_body
    assert "wa.me/2348012345678" in rendered.html_body
    assert "been charged" in rendered.html_body.lower()
    assert access_token not in rendered.html_body
    assert access_token not in rendered.text_body
    assert access_token not in rendered.subject


def test_farm_email_summarises_the_order_and_links_to_the_admin() -> None:
    order = _FakeOrder()
    rendered = render_order_received_farm(order, "Ada Okafor", "+2348012345678", "https://adesoba.example")

    assert "AF-2026-0001" in rendered.subject
    assert "https://adesoba.example/admin/orders" in rendered.html_body
    assert "+2348012345678" in rendered.text_body


class _FakeOrder:
    reference = "AF-2026-0001"
    fish_type = "clarias"
    size_label_snapshot = "2 – 3kg"
    quantity_kg = 200
    preferred_date = datetime(2026, 10, 6, tzinfo=UTC).date()
    time_slot_label = "10 AM–12 PM"
    fulfilment = "pickup"
    delivery_address = None
    notes = ""
