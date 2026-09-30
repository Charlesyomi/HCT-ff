from datetime import UTC, date, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID, uuid4

from pydantic import JsonValue
from sqlalchemy import CheckConstraint, Column, DateTime, JSON, Numeric, UniqueConstraint
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
