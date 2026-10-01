from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class FishTypePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    slug: str
    name: str
    description: str
    image_path: str
    sort_order: int


class SizeClassPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    slug: str
    label: str
    descriptor: str
    min_kg: Decimal
    max_kg: Decimal | None
    image_path: str
    is_featured: bool
    is_smoking_size: bool
    sort_order: int
    status: str


class HarvestWindowPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    starts_on: date
    ends_on: date
    notes: str | None


class TimeSlotPublic(BaseModel):
    key: str
    label: str


class CatalogSettingsPublic(BaseModel):
    whatsapp_number: str
    phone_number: str
    farm_address: str
    farm_maps_url: str | None
    business_hours: list[str]
    min_order_kg: int
    max_order_kg: int
    min_lead_days: int
    time_slots: list[TimeSlotPublic]
    delivery_notice: str
    announcement_banner: str | None


class CatalogResponse(BaseModel):
    fish_types: list[FishTypePublic]
    size_classes: list[SizeClassPublic]
    harvest_window: HarvestWindowPublic | None
    settings: CatalogSettingsPublic


class ContactMessageCreate(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    phone: str = Field(min_length=8, max_length=32)
    message: str = Field(min_length=5, max_length=2000)
    # Spam protection fields (SPEC §6.12): hidden honeypot and Turnstile token.
    website: str | None = None
    turnstile_token: str | None = None

    @field_validator("name", "phone", "message", mode="before")
    @classmethod
    def trim_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ContactMessageCreated(BaseModel):
    status: Literal["received"] = "received"


class OrderCreateRequest(BaseModel):
    fish_type: Literal["clarias", "hybrid", "any"]
    size: str = Field(min_length=1)
    quantity_kg: int
    preferred_date: date
    time_slot: str = Field(min_length=1)
    fulfilment: Literal["pickup", "delivery"]
    delivery_address: str | None = ""
    delivery_landmark: str | None = ""
    notes: str | None = ""
    customer_name: str = Field(min_length=2, max_length=80)
    phone: str = Field(min_length=8, max_length=32)
    email: str | None = ""
    source_intent: str | None = None
    website: str | None = None
    turnstile_token: str | None = None

    @field_validator(
        "customer_name",
        "phone",
        "email",
        "delivery_address",
        "delivery_landmark",
        "notes",
        mode="before",
    )
    @classmethod
    def trim_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class OrderCreateResponse(BaseModel):
    reference: str
    access_token: str
    status: str
    submitted_at: datetime


class OrderLookupRequest(BaseModel):
    reference: str = Field(min_length=1)
    phone: str = Field(min_length=5)


class OrderEventPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    type: str
    from_status: str | None = None
    to_status: str
    note: str | None = None
    created_at: datetime


class OrderPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    reference: str
    status: str
    fish_type: str
    size_label: str
    quantity_kg: int
    is_bulk: bool
    preferred_date: date
    time_slot_label: str
    fulfilment: str
    delivery_address: str | None = None
    delivery_landmark: str | None = None
    notes: str | None = None
    customer_name: str
    customer_phone_masked: str
    customer_email: str | None = None
    submitted_at: datetime
    events: list[OrderEventPublic] = []


class OrderLookupResponse(BaseModel):
    order: OrderPublic
    access_token: str


class OrderCancelResponse(BaseModel):
    reference: str
    status: str


class AccountMeResponse(BaseModel):
    id: str
    email: str
    name: str | None = None
    avatar_url: str | None = None
    signed_in: bool = True


class AccountOrderItem(BaseModel):
    reference: str
    status: str
    fish_type: str
    size_label: str
    quantity_kg: int
    is_bulk: bool
    preferred_date: date
    time_slot_label: str
    fulfilment: str
    submitted_at: datetime


class AccountOrdersResponse(BaseModel):
    orders: list[AccountOrderItem]
    csrf_token: str | None = None


class AttachOrderRequest(BaseModel):
    reference: str = Field(min_length=1, max_length=32)
    phone: str = Field(min_length=8, max_length=32)


class AttachOrderResponse(BaseModel):
    reference: str
    attached: bool
    status: str


class ErrorDetail(BaseModel):
    code: str
    message: str
    fields: dict[str, list[str]] | None = None
    request_id: str | None = None


class ErrorEnvelope(BaseModel):
    error: ErrorDetail
