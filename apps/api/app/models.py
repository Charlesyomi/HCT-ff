from datetime import UTC, date, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID, uuid4

from pydantic import JsonValue
from sqlalchemy import CheckConstraint, Column, DateTime, Index, JSON, Numeric, UniqueConstraint
from sqlmodel import Field, SQLModel


def current_timestamp() -> datetime:
    return datetime.now(UTC)


class FishType(SQLModel, table=True):
    __tablename__ = "fish_types"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    slug: str = Field(unique=True, index=True, max_length=80)
    name: str = Field(max_length=100)
    description: str
    image_path: str = Field(max_length=255)
    is_active: bool = Field(default=True)
    sort_order: int = Field(default=0)
    created_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class SizeClass(SQLModel, table=True):
    __tablename__ = "size_classes"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    slug: str = Field(unique=True, index=True, max_length=80)
    label: str = Field(max_length=80)
    descriptor: str = Field(max_length=160)
    min_kg: Decimal = Field(sa_column=Column(Numeric(6, 2), nullable=False))
    max_kg: Decimal | None = Field(
        default=None,
        sa_column=Column(Numeric(6, 2), nullable=True),
    )
    image_path: str = Field(max_length=255)
    is_featured: bool = Field(default=False)
    is_smoking_size: bool = Field(default=False)
    is_active: bool = Field(default=True)
    sort_order: int = Field(default=0)
    created_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class HarvestWindow(SQLModel, table=True):
    __tablename__ = "harvest_windows"
    __table_args__ = (CheckConstraint("starts_on <= ends_on", name="ck_harvest_window_dates"),)

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    starts_on: date
    ends_on: date
    notes: str | None = None
    is_published: bool = Field(default=False)
    created_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class AvailabilityStatus(StrEnum):
    LIMITED = "limited"
    AVAILABLE = "available"
    MAIN_STOCK = "main_stock"
    SOLD_OUT = "sold_out"
    UNAVAILABLE = "unavailable"


class Availability(SQLModel, table=True):
    __tablename__ = "availability"
    __table_args__ = (
        UniqueConstraint(
            "harvest_window_id",
            "size_class_id",
            name="uq_availability_window_size",
        ),
        CheckConstraint(
            "status IN ('limited', 'available', 'main_stock', 'sold_out', 'unavailable')",
            name="ck_availability_status",
        ),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    harvest_window_id: UUID = Field(
        foreign_key="harvest_windows.id",
        ondelete="RESTRICT",
        index=True,
    )
    size_class_id: UUID = Field(
        foreign_key="size_classes.id",
        ondelete="RESTRICT",
        index=True,
    )
    fish_type_id: UUID | None = Field(
        default=None,
        foreign_key="fish_types.id",
        ondelete="SET NULL",
        index=True,
    )
    status: str = Field(max_length=24)
    internal_estimate_kg: int | None = None
    created_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class SiteSetting(SQLModel, table=True):
    __tablename__ = "site_settings"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    key: str = Field(unique=True, index=True, max_length=100)
    value: JsonValue = Field(sa_column=Column(JSON, nullable=False))
    created_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class ContactMessage(SQLModel, table=True):
    __tablename__ = "contact_messages"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    name: str = Field(max_length=80)
    phone: str = Field(max_length=32)
    message: str
    status: str = Field(default="new", max_length=24)
    created_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class OrderStatus(StrEnum):
    PENDING = "pending"
    QUOTED = "quoted"
    CONFIRMED = "confirmed"
    READY = "ready"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    DECLINED = "declined"
    EXPIRED = "expired"


class Customer(SQLModel, table=True):
    __tablename__ = "customers"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    name: str = Field(max_length=80)
    phone_e164: str = Field(unique=True, index=True, max_length=32)
    email: str | None = Field(default=None, max_length=255, nullable=True)
    account_id: UUID | None = Field(
        default=None,
        foreign_key="accounts.id",
        ondelete="SET NULL",
        nullable=True,
        index=True,
    )
    notes: str | None = Field(default=None, nullable=True)
    first_order_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    created_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class ReferenceCounter(SQLModel, table=True):
    __tablename__ = "reference_counters"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    year: int = Field(unique=True, index=True)
    last_value: int = Field(default=0)
    created_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class Order(SQLModel, table=True):
    __tablename__ = "orders"
    __table_args__ = (
        Index("ix_orders_status_submitted_at", "status", "submitted_at"),
        CheckConstraint(
            "status IN ('pending', 'quoted', 'confirmed', 'ready', 'completed', 'cancelled', 'declined', 'expired')",
            name="ck_orders_status",
        ),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    reference: str = Field(unique=True, index=True, max_length=32)
    customer_id: UUID = Field(foreign_key="customers.id", ondelete="RESTRICT", index=True)
    status: str = Field(default=OrderStatus.PENDING.value, max_length=24, index=True)
    version: int = Field(default=1)
    fish_type: str = Field(max_length=20)
    size_class_id: UUID = Field(foreign_key="size_classes.id", ondelete="RESTRICT", index=True)
    size_label_snapshot: str = Field(max_length=80)
    quantity_kg: int = Field()
    is_bulk: bool = Field(default=False)
    account_id: UUID | None = Field(
        default=None,
        foreign_key="accounts.id",
        ondelete="SET NULL",
        nullable=True,
        index=True,
    )
    preferred_date: date = Field()
    time_slot_key: str = Field(max_length=20)
    time_slot_label: str = Field(max_length=80)
    fulfilment: str = Field(max_length=20)
    delivery_address: str | None = Field(default=None, nullable=True)
    delivery_landmark: str | None = Field(default=None, nullable=True)
    notes: str | None = Field(default=None, nullable=True)
    source_intent: str | None = Field(default=None, nullable=True, max_length=40)
    idempotency_key: str = Field(unique=True, index=True, max_length=128)
    idempotency_payload_hash: str = Field(max_length=64)
    access_token_hash: str = Field(max_length=64, index=True)
    harvest_window_id: UUID | None = Field(
        default=None,
        foreign_key="harvest_windows.id",
        ondelete="SET NULL",
        nullable=True,
        index=True,
    )
    internal_notes: str | None = Field(default=None, nullable=True)
    assigned_to: UUID | None = Field(default=None, nullable=True)
    submitted_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False, index=True),
    )
    closed_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    created_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class Account(SQLModel, table=True):
    """Google-signed-in customer account (Addendum §A4). Sign-in is always optional."""

    __tablename__ = "accounts"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    google_sub: str = Field(unique=True, index=True, max_length=255)
    email: str = Field(unique=True, index=True, max_length=255)
    email_verified: bool = Field(default=False)
    name: str | None = Field(default=None, max_length=120, nullable=True)
    avatar_url: str | None = Field(default=None, max_length=500, nullable=True)
    created_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    last_login_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    updated_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class AccountSession(SQLModel, table=True):
    """Server-side session for signed-in customers (Addendum §A4).

    Only the SHA-256 hash of the session id is stored, so a database leak cannot be
    replayed as a cookie. The cookie name differs from the future admin cookie.
    """

    __tablename__ = "account_sessions"
    __table_args__ = (Index("ix_account_sessions_expires_at", "expires_at"),)

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    account_id: UUID = Field(foreign_key="accounts.id", ondelete="CASCADE", index=True)
    token_hash: str = Field(unique=True, index=True, max_length=64)
    csrf_token_hash: str = Field(max_length=64)
    expires_at: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    created_ip: str | None = Field(default=None, max_length=64, nullable=True)
    user_agent: str | None = Field(default=None, max_length=400, nullable=True)
    created_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class EmailOutboxStatus(StrEnum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"


class EmailTemplate(StrEnum):
    ORDER_RECEIVED_CUSTOMER = "order_received_customer"
    ORDER_RECEIVED_FARM = "order_received_farm"


class EmailOutbox(SQLModel, table=True):
    """Transactional outbox (Addendum §A3): rows are written with the order, sent later."""

    __tablename__ = "email_outbox"
    __table_args__ = (
        UniqueConstraint("order_id", "template", name="uq_email_outbox_order_template"),
        CheckConstraint("status IN ('pending', 'sent', 'failed')", name="ck_email_outbox_status"),
        Index("ix_email_outbox_status_next_attempt_at", "status", "next_attempt_at"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    order_id: UUID | None = Field(
        default=None,
        foreign_key="orders.id",
        ondelete="CASCADE",
        nullable=True,
        index=True,
    )
    provider: str = Field(max_length=24)
    to_email: str = Field(max_length=255)
    template: str = Field(max_length=64)
    subject: str | None = Field(default=None, max_length=255, nullable=True)
    payload: JsonValue = Field(sa_column=Column(JSON, nullable=False))
    status: str = Field(default=EmailOutboxStatus.PENDING.value, max_length=16)
    attempts: int = Field(default=0)
    next_attempt_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    last_error: str | None = Field(default=None, nullable=True)
    provider_message_id: str | None = Field(default=None, max_length=255, nullable=True)
    created_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class OrderEvent(SQLModel, table=True):
    __tablename__ = "order_events"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    order_id: UUID = Field(foreign_key="orders.id", ondelete="CASCADE", index=True)
    type: str = Field(max_length=40)
    from_status: str | None = Field(default=None, max_length=24, nullable=True)
    to_status: str = Field(max_length=24)
    actor_type: str = Field(max_length=20)
    actor_id: str | None = Field(default=None, max_length=80, nullable=True)
    note: str | None = Field(default=None, nullable=True)
    created_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=current_timestamp,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
