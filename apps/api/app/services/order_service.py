import hashlib
import hmac
import json
import logging
import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
import phonenumbers
from sqlalchemy.exc import IntegrityError
from sqlmodel import SQLModel, Session, col, select

from app.config import settings
from app.models import (
    Availability,
    Customer,
    HarvestWindow,
    Order,
    OrderEvent,
    OrderStatus,
    Quote,
    QuoteStatus,
    ReferenceCounter,
    SiteSetting,
    SizeClass,
)
from app.schemas import OrderCreateRequest, OrderQuotePublic
from app.services.email.outbox import enqueue_order_emails
from app.services.notifier import get_notifier
from app.services.turnstile import enforce_turnstile

logger = logging.getLogger("adesoba.orders")

ORDERS_TABLE = SQLModel.metadata.tables["orders"]
CUSTOMERS_TABLE = SQLModel.metadata.tables["customers"]


def normalize_nigerian_phone(phone_input: str) -> str:
    """Normalize phone input to E.164 with Nigerian region default."""
    cleaned = phone_input.strip()
    try:
        parsed = phonenumbers.parse(cleaned, "NG")
    except phonenumbers.NumberParseException as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enter a valid Nigerian phone number.",
        ) from exc

    if not phonenumbers.is_valid_number(parsed):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Enter a valid Nigerian phone number.",
        )

    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)


def mask_phone_number(phone_e164: str) -> str:
    """Mask phone number for safe public display (e.g. +234801***5678)."""
    if len(phone_e164) >= 10:
        return f"{phone_e164[:7]}***{phone_e164[-4:]}"
    return phone_e164


def clean_notes(notes: str | None) -> str:
    """Strip control characters, trim, and enforce max length."""
    if not notes:
        return ""
    stripped = "".join(ch for ch in notes if ch.isprintable() or ch in "\n\r\t").strip()
    return stripped[:500]


def hash_token(raw_token: str) -> str:
    """Return SHA-256 hex digest of a token."""
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def derive_order_access_token(secret_key: str, reference: str, idempotency_key: str) -> str:
    """
    Derive a deterministic customer access token from the application secret key,
    order reference, and idempotency key.
    """
    msg = f"{reference}:{idempotency_key}".encode("utf-8")
    return hmac.new(secret_key.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def compute_payload_hash(request: OrderCreateRequest) -> str:
    """Compute deterministic SHA-256 digest of relevant order request fields."""
    payload_dict = {
        "fish_type": request.fish_type,
        "size": request.size,
        "quantity_kg": request.quantity_kg,
        "preferred_date": request.preferred_date.isoformat(),
        "time_slot": request.time_slot,
        "fulfilment": request.fulfilment,
        "delivery_address": (request.delivery_address or "").strip(),
        "delivery_landmark": (request.delivery_landmark or "").strip(),
        "notes": (request.notes or "").strip(),
        "customer_name": request.customer_name.strip(),
        "phone": request.phone.strip(),
        "email": (request.email or "").strip(),
    }
    canonical_json = json.dumps(payload_dict, sort_keys=True)
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def generate_atomic_reference(session: Session, year: int) -> str:
    """
    Generate the next sequential order reference for the given year (AF-YYYY-NNNN).

    Concurrency race: Two concurrent order submissions could read the same year counter
    simultaneously and generate duplicate references.
    Prevention: We query the reference_counters row with `with_for_update()` inside the
    transaction, serializing counter increments at the database engine level until commit.
    """
    bind = session.get_bind()
    dialect_name = bind.dialect.name if bind is not None else ""

    query = select(ReferenceCounter).where(ReferenceCounter.year == year)
    if dialect_name == "postgresql":
        query = query.with_for_update()

    counter = session.exec(query).first()
    if counter is None:
        try:
            counter = ReferenceCounter(year=year, last_value=1)
            session.add(counter)
            session.flush()
            return f"AF-{year}-{1:04d}"
        except IntegrityError:
            # Another concurrent transaction inserted the counter record for this year first.
            session.rollback()
            query = select(ReferenceCounter).where(ReferenceCounter.year == year)
            if dialect_name == "postgresql":
                query = query.with_for_update()
            counter = session.exec(query).one()

    counter.last_value += 1
    session.add(counter)
    session.flush()
    return f"AF-{year}-{counter.last_value:04d}"


def get_site_settings_map(session: Session) -> dict[str, object]:
    defaults: dict[str, object] = {
        "min_order_kg": 40,
        "max_order_kg": 20000,
        "min_lead_days": 1,
        "time_slots": [
            {"key": "8-10", "label": "8–10 AM"},
            {"key": "10-12", "label": "10 AM–12 PM"},
            {"key": "12-2", "label": "12–2 PM"},
            {"key": "2-4", "label": "2–4 PM"},
            {"key": "4-6", "label": "4–6 PM"},
        ],
    }
    for setting in session.exec(select(SiteSetting)).all():
        defaults[setting.key] = setting.value
    return defaults


def setting_int(settings_map: dict[str, object], key: str, default: int) -> int:
    """Read an integer setting, tolerating admin-entered strings in the JSON column."""
    value = settings_map.get(key, default)
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return default
    return default


def time_slot_labels(settings_map: dict[str, object]) -> dict[str, str]:
    """Map configured time-slot keys to their labels (label snapshot stored on the order)."""
    raw_slots = settings_map.get("time_slots", [])
    if not isinstance(raw_slots, list):
        return {}
    slots: dict[str, str] = {}
    for slot in raw_slots:
        if not isinstance(slot, dict):
            continue
        key = slot.get("key")
        label = slot.get("label")
        if isinstance(key, str) and isinstance(label, str):
            slots[key] = label
    return slots


def create_order(
    session: Session,
    request: OrderCreateRequest,
    idempotency_key: str,
    client_ip: str,
    account_id: UUID | None = None,
) -> tuple[Order, str]:
    """
    Validate, normalize, and atomically create an order.

    Concurrency race: Two requests with the same Idempotency-Key arrive concurrently, both
    passing the initial existence check before either has committed to the database.
    Prevention: A database UNIQUE index on idempotency_key ensures only one insert succeeds;
    the duplicate catches IntegrityError, rolls back, and verifies/replays the winner's result.
    """
    # Spam protection: honeypot plus Turnstile (enforced only when a secret key is configured).
    if request.website:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Submission rejected.",
        )
    enforce_turnstile(request.turnstile_token, client_ip or None)

    # Payload hash for idempotency comparison
    payload_hash = compute_payload_hash(request)

    # 1. Existing idempotency check
    existing_order = session.exec(
        select(Order).where(Order.idempotency_key == idempotency_key)
    ).first()
    if existing_order is not None:
        if existing_order.idempotency_payload_hash != payload_hash:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Idempotency-Key has already been used with a different request payload.",
            )
        replayed_token = derive_order_access_token(
            settings.secret_key, existing_order.reference, idempotency_key
        )
        return existing_order, replayed_token

    # 2. Normalize and validate phone
    phone_e164 = normalize_nigerian_phone(request.phone)

    # 3. Rate limit per phone number (3 per hour)
    one_hour_ago = datetime.now(UTC) - timedelta(hours=1)
    phone_order_count = session.exec(
        select(ORDERS_TABLE.c.id)
        .join(CUSTOMERS_TABLE, ORDERS_TABLE.c.customer_id == CUSTOMERS_TABLE.c.id)
        .where(
            CUSTOMERS_TABLE.c.phone_e164 == phone_e164,
            ORDERS_TABLE.c.submitted_at >= one_hour_ago,
        )
    ).all()
    if len(phone_order_count) >= 3:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many orders submitted for this phone number. Please try again later.",
        )

    # 4. Settings and validations
    settings_map = get_site_settings_map(session)
    min_order_kg = setting_int(settings_map, "min_order_kg", 40)
    max_order_kg = setting_int(settings_map, "max_order_kg", 20000)
    min_lead_days = setting_int(settings_map, "min_lead_days", 1)

    if request.quantity_kg < min_order_kg or request.quantity_kg > max_order_kg:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Order quantity must be between {min_order_kg}kg and {max_order_kg}kg.",
        )

    # 5. Check size class and harvest window availability
    size_class = session.exec(
        select(SizeClass).where(
            SizeClass.slug == request.size,
            col(SizeClass.is_active).is_(True),
        )
    ).first()
    if size_class is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Choose a fish size that is available in the catalog.",
        )

    today_lagos = datetime.now(ZoneInfo("Africa/Lagos")).date()
    earliest_date = today_lagos + timedelta(days=min_lead_days)
    latest_date = today_lagos + timedelta(days=90)
    if request.preferred_date < earliest_date or request.preferred_date > latest_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Preferred date must be at least {min_lead_days} day(s) from now and within 90 days.",
        )

    active_harvest_window = session.exec(
        select(HarvestWindow)
        .where(col(HarvestWindow.is_published).is_(True), HarvestWindow.ends_on >= today_lagos)
        .order_by(col(HarvestWindow.starts_on))
    ).first()

    if active_harvest_window is not None:
        availability_rec = session.exec(
            select(Availability).where(
                Availability.harvest_window_id == active_harvest_window.id,
                Availability.size_class_id == size_class.id,
            )
        ).first()
        if availability_rec is not None and availability_rec.status in ("sold_out", "unavailable"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Fish size '{size_class.label}' is currently unavailable for this harvest window.",
            )

    # 6. Time slot validation
    valid_slot_map = time_slot_labels(settings_map)
    if request.time_slot not in valid_slot_map:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Choose a valid preferred time slot.",
        )
    time_slot_label = valid_slot_map[request.time_slot]

    # 7. Fulfilment validation
    if request.fulfilment == "delivery":
        addr = (request.delivery_address or "").strip()
        if len(addr) < 8:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Delivery address or area must be at least 8 characters.",
            )

    # 8. Customer upsert
    now_utc = datetime.now(UTC)
    customer = session.exec(
        select(Customer).where(Customer.phone_e164 == phone_e164)
    ).first()
    if customer is None:
        customer = Customer(
            name=request.customer_name.strip(),
            phone_e164=phone_e164,
            email=request.email.strip() if request.email else None,
            first_order_at=now_utc,
            account_id=account_id,
        )
        session.add(customer)
    else:
        customer.name = request.customer_name.strip()
        if request.email:
            customer.email = request.email.strip()
        if account_id is not None and customer.account_id is None:
            # Links a guest customer to the signed-in account (Addendum §A4); never
            # overwrites an account that already owns the customer record.
            customer.account_id = account_id
        customer.updated_at = now_utc
        session.add(customer)

    session.flush()

    # 9. Reference and token generation
    reference = generate_atomic_reference(session, today_lagos.year)
    access_token = derive_order_access_token(settings.secret_key, reference, idempotency_key)
    token_hash = hash_token(access_token)

    order = Order(
        reference=reference,
        customer_id=customer.id,
        status=OrderStatus.PENDING.value,
        version=1,
        account_id=account_id,
        fish_type=request.fish_type,
        size_class_id=size_class.id,
        size_label_snapshot=size_class.label,
        quantity_kg=request.quantity_kg,
        is_bulk=(request.quantity_kg >= 1000),
        preferred_date=request.preferred_date,
        time_slot_key=request.time_slot,
        time_slot_label=time_slot_label,
        fulfilment=request.fulfilment,
        delivery_address=(request.delivery_address or "").strip() if request.fulfilment == "delivery" else None,
        delivery_landmark=(request.delivery_landmark or "").strip() if request.fulfilment == "delivery" else None,
        notes=clean_notes(request.notes),
        source_intent=request.source_intent,
        idempotency_key=idempotency_key,
        idempotency_payload_hash=payload_hash,
        access_token_hash=token_hash,
        harvest_window_id=active_harvest_window.id if active_harvest_window else None,
        submitted_at=now_utc,
    )
    session.add(order)
    session.flush()

    # Initial order event
    session.add(
        OrderEvent(
            order_id=order.id,
            type="created",
            from_status=None,
            to_status=OrderStatus.PENDING.value,
            actor_type="customer",
            note="Order request submitted by customer.",
        )
    )

    # Notification emails are enqueued in this same transaction (Addendum §A3): an order can
    # never exist without its outbox rows, and a rolled-back order leaves nothing behind.
    enqueue_order_emails(session, order, customer)

    try:
        session.commit()
    except IntegrityError:
        # Concurrent duplicate submit with the same Idempotency-Key
        session.rollback()
        dup_order = session.exec(
            select(Order).where(Order.idempotency_key == idempotency_key)
        ).first()
        if dup_order is not None and dup_order.idempotency_payload_hash == payload_hash:
            replayed_token = derive_order_access_token(
                settings.secret_key, dup_order.reference, idempotency_key
            )
            return dup_order, replayed_token
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Idempotency-Key has already been used with a different request payload.",
        )

    # Audit log line for the console/log channel; it can never fail the order.
    try:
        get_notifier().send_order_created(order, customer)
    except Exception as exc:
        logger.warning("Failed to log order notification for %s: %s", order.reference, exc)

    return order, access_token


def get_public_order_by_token(
    session: Session, reference: str, raw_token: str
) -> tuple[Order, Customer]:
    """Retrieve an order for the public view using its secret access token."""
    token_hash = hash_token(raw_token)
    order = session.exec(
        select(Order).where(
            Order.reference == reference,
            Order.access_token_hash == token_hash,
        )
    ).first()
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired order access token.",
        )

    customer = session.exec(select(Customer).where(Customer.id == order.customer_id)).one()
    return order, customer


def lookup_order_by_phone(
    session: Session, reference: str, phone_input: str
) -> tuple[Order, Customer, str]:
    """Look up an order by reference and matching phone number; issue a fresh access token."""
    phone_e164 = normalize_nigerian_phone(phone_input)

    order = session.exec(select(Order).where(Order.reference == reference)).first()
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found or details do not match.",
        )

    customer = session.exec(select(Customer).where(Customer.id == order.customer_id)).one()
    if customer.phone_e164 != phone_e164:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Order not found or details do not match.",
        )

    fresh_token = secrets.token_urlsafe(32)
    order.access_token_hash = hash_token(fresh_token)
    order.updated_at = datetime.now(UTC)
    session.add(order)
    session.commit()

    return order, customer, fresh_token


def public_quote_for(session: Session, order_id: UUID) -> OrderQuotePublic | None:
    """
    The one quote a customer is allowed to see, or None when the order has not been quoted.

    Rules (SPEC §5.4, owner-confirmed):
      * only the newest version is exposed, so superseded quotes never leak;
      * a quote counts as expired once `valid_until` has passed, even if the expiry cron
        has not run yet, otherwise a customer would see a live-looking quote they already
        missed;
      * `created_by` is not part of the public shape, so no admin identity is disclosed.

    Access is already gated upstream: every caller has proved ownership via the order
    access token or a signed-in attached account.
    """
    quote = session.exec(
        select(Quote)
        .where(
            col(Quote.order_id) == order_id,
            col(Quote.status) != QuoteStatus.SUPERSEDED.value,
        )
        .order_by(col(Quote.version_no).desc())
    ).first()
    if quote is None:
        return None

    today = datetime.now(ZoneInfo("Africa/Lagos")).date()
    expired = quote.valid_until < today or quote.status in (
        QuoteStatus.EXPIRED.value,
        QuoteStatus.DECLINED.value,
    )
    return OrderQuotePublic(
        version_no=quote.version_no,
        unit_price_kobo=quote.unit_price_kobo,
        quantity_kg=quote.quantity_kg,
        delivery_fee_kobo=quote.delivery_fee_kobo,
        discount_kobo=quote.discount_kobo,
        total_kobo=quote.total_kobo,
        deposit_kobo=quote.deposit_kobo,
        valid_until=quote.valid_until,
        message_to_customer=quote.message_to_customer,
        status=QuoteStatus.EXPIRED.value if expired else quote.status,
        is_expired=expired,
    )


def cancel_order_by_customer(session: Session, reference: str, raw_token: str) -> Order:
    """
    Cancel an order using the access token. Allowed only from pending or quoted statuses.

    Concurrency race: Two callers attempt conflicting status updates on the same order simultaneously.
    Prevention: Each transition increments the `version` column and verifies the expected version
    before applying changes, raising HTTP 409 Conflict if a version mismatch or illegal transition occurs.
    """
    token_hash = hash_token(raw_token)
    order = session.exec(
        select(Order).where(
            Order.reference == reference,
            Order.access_token_hash == token_hash,
        )
    ).first()
    if order is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired order access token.",
        )

    if order.status not in (OrderStatus.PENDING.value, OrderStatus.QUOTED.value):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot cancel order in '{order.status}' status.",
        )

    old_status = order.status
    now_utc = datetime.now(UTC)
    order.status = OrderStatus.CANCELLED.value
    order.version += 1
    order.closed_at = now_utc
    order.updated_at = now_utc
    session.add(order)

    session.add(
        OrderEvent(
            order_id=order.id,
            type="status_change",
            from_status=old_status,
            to_status=OrderStatus.CANCELLED.value,
            actor_type="customer",
            note="Order cancelled by customer.",
        )
    )

    session.commit()
    return order
