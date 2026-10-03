"""Admin authentication and order administration (SPEC §8, §9).

Design notes:
* Passwords use argon2id via `argon2-cffi`; a plain SHA-256 hash would be far too fast to
  brute force offline, so the slow KDF matters here more than for the random session tokens
  used elsewhere in the codebase.
* The session cookie holds a random id whose SHA-256 hash is the only stored value, the same
  pattern used for customer sessions in `auth_service`.
* Every mutation writes an `audit_log` row in the same transaction as the change, so an
  audited change can never survive without its audit trail.
* Money is integer kobo everywhere; `paid_kobo` is the sum of the payment ledger, never a
  stored column, so two concurrent payments cannot overwrite one another.
"""

import base64
import hashlib
import hmac
import logging
import secrets
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from pydantic import JsonValue
from sqlmodel import Session, col, select

from app.models import (
    AdminRole,
    AdminSession,
    AdminUser,
    AuditLog,
    Order,
    OrderEvent,
    OrderStatus,
    Payment,
    PaymentMethod,
    Quote,
    QuoteStatus,
)

logger = logging.getLogger("adesoba.admin")

ADMIN_SESSION_COOKIE_NAME = "adesoba_admin_session"
# SPEC §9: idle timeout 30 minutes, absolute lifetime 12 hours.
ADMIN_IDLE_TIMEOUT_SECONDS = 30 * 60
ADMIN_ABSOLUTE_TIMEOUT_SECONDS = 12 * 60 * 60
# Lockout after 5 failures for 15 minutes (SPEC §9: lockout after repeated failures).
ADMIN_MAX_FAILED_ATTEMPTS = 5
ADMIN_LOCKOUT_MINUTES = 15
# SPEC §9: minimum 12 characters.
MIN_PASSWORD_LENGTH = 12

# Order status machine (SPEC §9). Terminal states have no outgoing edges.
ALLOWED_TRANSITIONS: dict[str, tuple[str, ...]] = {
    OrderStatus.PENDING.value: (
        OrderStatus.QUOTED.value,
        OrderStatus.CONFIRMED.value,
        OrderStatus.DECLINED.value,
        OrderStatus.CANCELLED.value,
        OrderStatus.EXPIRED.value,
    ),
    OrderStatus.QUOTED.value: (
        OrderStatus.CONFIRMED.value,
        OrderStatus.DECLINED.value,
        OrderStatus.CANCELLED.value,
        OrderStatus.EXPIRED.value,
    ),
    OrderStatus.CONFIRMED.value: (
        OrderStatus.READY.value,
        OrderStatus.DECLINED.value,
        OrderStatus.CANCELLED.value,
    ),
    OrderStatus.READY.value: (OrderStatus.COMPLETED.value, OrderStatus.CANCELLED.value),
    OrderStatus.COMPLETED.value: (),
    OrderStatus.CANCELLED.value: (),
    OrderStatus.DECLINED.value: (),
    OrderStatus.EXPIRED.value: (),
}

TERMINAL_STATUSES = frozenset(
    current for current, targets in ALLOWED_TRANSITIONS.items() if not targets
)

_hasher = PasswordHasher()


class AdminAuthError(Exception):
    """Login failed; the endpoint answers with a generic 401 (never which part was wrong)."""


class AdminForbiddenError(Exception):
    """Authenticated but not permitted (e.g. staff calling an owner-only route)."""


class AdminConflictError(Exception):
    """Optimistic-lock version mismatch or an illegal status transition (HTTP 409)."""


class AdminNotFoundError(Exception):
    """Requested admin resource does not exist (HTTP 404)."""


@dataclass(frozen=True)
class AdminSessionTokens:
    raw_session_id: str
    csrf_token: str
    admin_user: AdminUser


@dataclass(frozen=True)
class PaymentSummary:
    paid_kobo: int
    balance_kobo: int
    due_kobo: int

def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def normalize_email(email: str) -> str:
    return email.strip().lower()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    return True


def validate_password_strength(password: str) -> str | None:
    """Return an error message when the password is too weak, else None (SPEC §9)."""
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
    return None


def _as_utc(value: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes; treat them as UTC rather than comparing blindly."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


# --- Login / lockout --------------------------------------------------------------


def authenticate(
    session: Session, email: str, password: str, now: datetime | None = None
) -> AdminUser:
    """
    Verify credentials, applying the lockout policy.

    Concurrency race: two login attempts for the same user can be in flight at once.
    Prevention: the counter is incremented on the row and re-read inside the same
    transaction, and a locked account is rejected before the password is even checked.
    """
    moment = now or datetime.now(UTC)
    user = session.exec(
        select(AdminUser).where(col(AdminUser.email) == normalize_email(email))
    ).first()

    # Always run a verification so a missing account and a wrong password take a
    # comparable amount of time and cannot be told apart by response latency.
    dummy_hash = _hasher.hash(secrets.token_urlsafe(16))
    stored_hash = user.password_hash if user is not None else dummy_hash
    password_ok = verify_password(password, stored_hash)

    if user is None or not password_ok or not user.is_active:
        if user is not None:
            record_failed_attempt(session, user, moment)
        # One message for every failure mode: never reveal whether the account exists.
        raise AdminAuthError("Incorrect email or password.")

    locked_until = _as_utc(user.locked_until)
    if locked_until is not None and locked_until > moment:
        raise AdminAuthError("Incorrect email or password.")

    user.failed_attempts = 0
    user.locked_until = None
    user.last_login_at = moment
    user.updated_at = moment
    session.add(user)
    session.commit()
    return user


def record_failed_attempt(
    session: Session, user: AdminUser, now: datetime | None = None
) -> None:
    """Count a failure and lock the account once the threshold is reached."""
    moment = now or datetime.now(UTC)
    user.failed_attempts += 1
    if user.failed_attempts >= ADMIN_MAX_FAILED_ATTEMPTS:
        user.locked_until = moment + timedelta(minutes=ADMIN_LOCKOUT_MINUTES)
        user.failed_attempts = 0
        logger.warning("Admin account %s locked after repeated failures", user.email)
    user.updated_at = moment
    session.add(user)
    session.commit()


# --- Sessions ---------------------------------------------------------------------


def create_admin_session(
    session: Session,
    admin_user: AdminUser,
    *,
    created_ip: str | None,
    user_agent: str | None,
) -> AdminSessionTokens:
    raw_session_id = secrets.token_urlsafe(32)
    csrf_token = _b64url(hashlib.sha256(f"admin-csrf:{raw_session_id}".encode("ascii")).digest())
    now = datetime.now(UTC)
    record = AdminSession(
        admin_user_id=admin_user.id,
        token_hash=hashlib.sha256(raw_session_id.encode("ascii")).hexdigest(),
        csrf_token_hash=hashlib.sha256(csrf_token.encode("ascii")).hexdigest(),
        last_seen_at=now,
        expires_at=now + timedelta(seconds=ADMIN_ABSOLUTE_TIMEOUT_SECONDS),
        created_ip=created_ip,
        user_agent=(user_agent or "")[:400] or None,
    )
    session.add(record)
    session.commit()
    return AdminSessionTokens(
        raw_session_id=raw_session_id,
        csrf_token=csrf_token,
        admin_user=admin_user,
    )


def resolve_admin_session(
    session: Session,
    raw_session_id: str | None,
    now: datetime | None = None,
) -> tuple[AdminSession, AdminUser] | None:
    """
    Return the live session and its user, refreshing `last_seen_at` for the idle timeout.

    Concurrency race: two in-flight requests share one session and both write
    `last_seen_at`. Prevention: the write is monotonic - a stale timestamp from a slower
    request never rewinds the idle clock.
    """
    if not raw_session_id:
        return None
    moment = now or datetime.now(UTC)
    token_hash = hashlib.sha256(raw_session_id.encode("ascii")).hexdigest()
    record = session.exec(
        select(AdminSession).where(col(AdminSession.token_hash) == token_hash)
    ).first()
    if record is None:
        return None

    expires_at = _as_utc(record.expires_at)
    if expires_at is not None and expires_at <= moment:
        session.delete(record)
        session.commit()
        return None

    last_seen = _as_utc(record.last_seen_at)
    if last_seen is not None and moment - last_seen > timedelta(seconds=ADMIN_IDLE_TIMEOUT_SECONDS):
        session.delete(record)
        session.commit()
        return None

    user = session.exec(select(AdminUser).where(col(AdminUser.id) == record.admin_user_id)).first()
    if user is None or not user.is_active:
        session.delete(record)
        session.commit()
        return None

    if last_seen is None or moment > last_seen:
        record.last_seen_at = moment
        record.updated_at = moment
        session.add(record)
        session.commit()
    return record, user


def verify_admin_csrf(record: AdminSession, raw_session_id: str, csrf_token: str | None) -> bool:
    if not csrf_token:
        return False
    expected = _b64url(hashlib.sha256(f"admin-csrf:{raw_session_id}".encode("ascii")).digest())
    if not hmac.compare_digest(expected, csrf_token):
        return False
    return hmac.compare_digest(
        record.csrf_token_hash,
        hashlib.sha256(csrf_token.encode("ascii")).hexdigest(),
    )


def delete_admin_session(session: Session, record: AdminSession) -> None:
    session.delete(record)
    session.commit()


def require_owner(admin_user: AdminUser) -> None:
    if admin_user.role != AdminRole.OWNER.value:
        raise AdminForbiddenError("This action requires an owner account.")


# --- Audit ------------------------------------------------------------------------


def record_audit(
    session: Session,
    *,
    admin_user: AdminUser,
    action: str,
    entity: str,
    entity_id: str | None,
    before: JsonValue | None = None,
    after: JsonValue | None = None,
    ip: str | None = None,
) -> AuditLog:
    """
    Append an audit row.

    The caller is responsible for the commit: the audit entry must land in the *same*
    transaction as the change it describes, otherwise a rolled-back change would still
    appear in the log (or a committed change would not).
    """
    entry = AuditLog(
        actor_type="admin",
        actor_id=str(admin_user.id),
        action=action,
        entity=entity,
        entity_id=entity_id,
        before=before,
        after=after,
        ip=ip,
    )
    session.add(entry)
    return entry


# --- Orders -----------------------------------------------------------------------


def get_order_for_admin(session: Session, order_id: UUID) -> Order:
    order = session.exec(select(Order).where(col(Order.id) == order_id)).first()
    if order is None:
        raise AdminNotFoundError("Order not found.")
    return order


def check_version(order: Order, expected_version: int | None) -> None:
    """
    Optimistic lock (SPEC §8: `version` required on admin writes).

    Concurrency race: two staff members edit the same order at once.
    Prevention: the caller sends the version it read; a mismatch means the row moved on
    and the stale write is refused with 409 instead of silently overwriting.
    """
    if expected_version is None:
        raise AdminConflictError("This change requires the current order version.")
    if order.version != expected_version:
        raise AdminConflictError("This order was updated by someone else. Reload it and try again.")


def allowed_next_statuses(current_status: str) -> list[str]:
    return list(ALLOWED_TRANSITIONS.get(current_status, ()))


def transition_order(
    session: Session,
    order: Order,
    to_status: str,
    *,
    expected_version: int | None,
    admin_user: AdminUser,
    note: str | None = None,
    ip: str | None = None,
) -> Order:
    """
    Apply a status transition if the machine allows it, recording an order event.

    Concurrency race: two admins transition the same order simultaneously.
    Prevention: the version check rejects the loser with 409, and the transition itself is
    validated against `ALLOWED_TRANSITIONS` so a terminal order can never be revived.
    """
    check_version(order, expected_version)

    current_status = order.status
    if to_status == current_status:
        raise AdminConflictError(f"Order is already '{to_status}'.")
    if to_status not in ALLOWED_TRANSITIONS.get(current_status, ()):
        raise AdminConflictError(f"Cannot move an order from '{current_status}' to '{to_status}'.")

    now = datetime.now(UTC)
    order.status = to_status
    order.version += 1
    order.updated_at = now
    if to_status in TERMINAL_STATUSES:
        order.closed_at = now
    session.add(order)

    session.add(
        OrderEvent(
            order_id=order.id,
            type="status_change",
            from_status=current_status,
            to_status=to_status,
            actor_type="admin",
            actor_id=str(admin_user.id),
            note=note or f"Status changed to {to_status}.",
        )
    )
    record_audit(
        session,
        admin_user=admin_user,
        action="order.transition",
        entity="order",
        entity_id=str(order.id),
        before={"status": current_status, "version": order.version - 1},
        after={"status": to_status, "version": order.version},
        ip=ip,
    )
    session.commit()
    return order


def update_order_notes(
    session: Session,
    order: Order,
    *,
    internal_notes: str | None,
    assigned_to: UUID | None,
    expected_version: int | None,
    admin_user: AdminUser,
    ip: str | None = None,
) -> Order:
    check_version(order, expected_version)
    before: dict[str, JsonValue] = {
        "internal_notes": order.internal_notes,
        "assigned_to": str(order.assigned_to) if order.assigned_to else None,
    }
    order.internal_notes = internal_notes
    order.assigned_to = assigned_to
    order.version += 1
    order.updated_at = datetime.now(UTC)
    session.add(order)
    record_audit(
        session,
        admin_user=admin_user,
        action="order.update",
        entity="order",
        entity_id=str(order.id),
        before=before,
        after={
            "internal_notes": order.internal_notes,
            "assigned_to": str(order.assigned_to) if order.assigned_to else None,
        },
        ip=ip,
    )
    session.commit()
    return order# --- Quotes -----------------------------------------------------------------------


def compute_quote_total_kobo(
    unit_price_kobo: int, quantity_kg: int, delivery_fee_kobo: int, discount_kobo: int
) -> int:
    """
    Total in kobo, computed in integers only.

    Integer maths matters here: the same arithmetic in kobo (Naira cents) is exact, while
    the equivalent float computation drifts by a few kobo on bulk orders and would make the
    customer's accepted quote disagree with the balance shown on the ledger.
    """
    return unit_price_kobo * quantity_kg + delivery_fee_kobo - discount_kobo


def create_quote(
    session: Session,
    order: Order,
    *,
    unit_price_kobo: int,
    quantity_kg: int,
    delivery_fee_kobo: int,
    discount_kobo: int,
    deposit_kobo: int,
    valid_until: date,
    message_to_customer: str | None,
    admin_user: AdminUser,
    ip: str | None = None,
) -> Quote:
    """
    Add a new quote version; the previous open quote is marked superseded, never deleted.

    Concurrency race: two admins quote the same order at once.
    Prevention: `version_no` is derived from the highest existing number for the order, and
    any still-`sent` quote is superseded in the same transaction, so exactly one quote stays
    open and the losing version becomes history rather than an ambiguous second offer.
    """
    if unit_price_kobo < 0 or delivery_fee_kobo < 0 or discount_kobo < 0 or deposit_kobo < 0:
        raise AdminConflictError("Quote amounts cannot be negative.")
    if quantity_kg <= 0:
        raise AdminConflictError("Quote quantity must be greater than zero.")

    total_kobo = compute_quote_total_kobo(
        unit_price_kobo, quantity_kg, delivery_fee_kobo, discount_kobo
    )
    if total_kobo < 0:
        raise AdminConflictError("Discount cannot be greater than the order total.")
    if deposit_kobo > total_kobo:
        raise AdminConflictError("Deposit cannot be greater than the total.")

    existing = list(session.exec(select(Quote).where(col(Quote.order_id) == order.id)).all())
    version_no = max((quote.version_no for quote in existing), default=0) + 1
    open_quotes = [quote for quote in existing if quote.status == QuoteStatus.SENT.value]

    now = datetime.now(UTC)
    for previous in open_quotes:
        previous.status = QuoteStatus.SUPERSEDED.value
        previous.updated_at = now
        session.add(previous)

    quote = Quote(
        order_id=order.id,
        version_no=version_no,
        unit_price_kobo=unit_price_kobo,
        quantity_kg=quantity_kg,
        delivery_fee_kobo=delivery_fee_kobo,
        discount_kobo=discount_kobo,
        total_kobo=total_kobo,
        deposit_kobo=deposit_kobo,
        valid_until=valid_until,
        message_to_customer=message_to_customer,
        status=QuoteStatus.SENT.value,
        created_by=admin_user.id,
    )
    session.add(quote)

    # A quote moves the order out of `pending` so the customer-facing badge agrees with what
    # they can now see (SPEC §5.4). Only the first quote does this; later versions leave an
    # already-quoted order alone. Terminal orders are never revived by quoting.
    if order.status == OrderStatus.PENDING.value:
        previous_status = order.status
        order.status = OrderStatus.QUOTED.value
        order.version += 1
        order.updated_at = now
        session.add(order)
        session.add(
            OrderEvent(
                order_id=order.id,
                type="status_change",
                from_status=previous_status,
                to_status=OrderStatus.QUOTED.value,
                actor_type="admin",
                actor_id=str(admin_user.id),
                note="Quote sent.",
            )
        )

    record_audit(
        session,
        admin_user=admin_user,
        action="quote.create",
        entity="order",
        entity_id=str(order.id),
        before={"status": order.status, "version": order.version},
        after={
            "version_no": version_no,
            "total_kobo": total_kobo,
            "deposit_kobo": deposit_kobo,
            "valid_until": valid_until.isoformat(),
            "status": order.status,
            "version": order.version,
        },
        ip=ip,
    )
    session.commit()
    return quote


def accept_quote(
    session: Session,
    order: Order,
    quote: Quote,
    *,
    admin_user: AdminUser,
    ip: str | None = None,
) -> Quote:
    """Accept a quote and move the order to confirmed in the same transaction."""
    if quote.order_id != order.id:
        raise AdminConflictError("That quote belongs to a different order.")
    if quote.status != QuoteStatus.SENT.value:
        raise AdminConflictError("Only an open quote can be accepted.")
    now = datetime.now(UTC)
    quote.status = QuoteStatus.ACCEPTED.value
    quote.accepted_at = now
    quote.updated_at = now
    session.add(quote)

    previous_status = order.status
    if OrderStatus.CONFIRMED.value in ALLOWED_TRANSITIONS.get(previous_status, ()):
        order.status = OrderStatus.CONFIRMED.value
        order.version += 1
        order.updated_at = now
        session.add(order)
        session.add(
            OrderEvent(
                order_id=order.id,
                type="status_change",
                from_status=previous_status,
                to_status=OrderStatus.CONFIRMED.value,
                actor_type="admin",
                actor_id=str(admin_user.id),
                note="Quote accepted.",
            )
        )

    record_audit(
        session,
        admin_user=admin_user,
        action="quote.accept",
        entity="order",
        entity_id=str(order.id),
        before={"quote_status": QuoteStatus.SENT.value, "order_status": previous_status},
        after={"quote_status": QuoteStatus.ACCEPTED.value, "order_status": order.status},
        ip=ip,
    )
    session.commit()
    return quote# --- Payments ---------------------------------------------------------------------


def payment_summary(session: Session, order_id: UUID) -> PaymentSummary:
    """
    Paid/balance figures are derived from the ledger, never stored on the order.

    Concurrency race: two cash payments recorded at the same time.
    Prevention: each payment is its own inserted row, so both are counted; a stored
    running total would be vulnerable to a lost update.
    """
    payments = list(
        session.exec(select(Payment).where(col(Payment.order_id) == order_id)).all()
    )
    paid_kobo = sum(payment.amount_kobo for payment in payments)

    accepted = session.exec(
        select(Quote).where(
            col(Quote.order_id) == order_id,
            col(Quote.status) == QuoteStatus.ACCEPTED.value,
        )
    ).first()
    due_kobo = accepted.total_kobo if accepted is not None else 0
    return PaymentSummary(
        paid_kobo=paid_kobo,
        due_kobo=due_kobo,
        balance_kobo=max(due_kobo - paid_kobo, 0),
    )


def record_payment(
    session: Session,
    order: Order,
    *,
    amount_kobo: int,
    method: str,
    reference: str | None,
    note: str | None,
    admin_user: AdminUser,
    received_at: datetime | None = None,
    ip: str | None = None,
) -> Payment:
    if amount_kobo == 0:
        raise AdminConflictError("Payment amount cannot be zero.")
    if amount_kobo < 0:
        raise AdminConflictError(
            "To correct a payment, add a negative adjustment instead of editing the row."
        )
    if method not in {item.value for item in PaymentMethod}:
        raise AdminConflictError("Unknown payment method.")

    payment = Payment(
        order_id=order.id,
        amount_kobo=amount_kobo,
        method=method,
        reference=reference,
        note=note,
        recorded_by=admin_user.id,
        received_at=received_at or datetime.now(UTC),
    )
    session.add(payment)
    record_audit(
        session,
        admin_user=admin_user,
        action="payment.record",
        entity="order",
        entity_id=str(order.id),
        after={"amount_kobo": amount_kobo, "method": method},
        ip=ip,
    )
    session.commit()
    return payment


# --- Quote expiry (SPEC §10 scheduled job) ----------------------------------------


def expire_stale_quotes(session: Session, today: date) -> int:
    """
    Mark quotes past their validity as expired and close the orders waiting on them.

    Called by the cron job; safe to run repeatedly because only `sent` quotes qualify.
    """
    now = datetime.now(UTC)
    stale = list(
        session.exec(
            select(Quote).where(
                col(Quote.status) == QuoteStatus.SENT.value,
                col(Quote.valid_until) < today,
            )
        ).all()
    )
    for quote in stale:
        quote.status = QuoteStatus.EXPIRED.value
        quote.updated_at = now
        session.add(quote)

        order = session.exec(select(Order).where(col(Order.id) == quote.order_id)).first()
        if order is None or order.status != OrderStatus.QUOTED.value:
            continue
        order.status = OrderStatus.EXPIRED.value
        order.version += 1
        order.closed_at = now
        order.updated_at = now
        session.add(order)
        session.add(
            OrderEvent(
                order_id=order.id,
                type="status_change",
                from_status=OrderStatus.QUOTED.value,
                to_status=OrderStatus.EXPIRED.value,
                actor_type="system",
                note="Quote expired before the customer responded.",
            )
        )
    if stale:
        session.commit()
    return len(stale)