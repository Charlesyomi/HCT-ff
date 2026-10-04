from datetime import date, datetime
from uuid import UUID
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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
    indicative_price_per_kg_kobo: int | None
    price_updated_at: datetime | None


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


class OrderItemInput(BaseModel):
    """One requested line of a multi-line order.

    The same per-line rules as the legacy single-line payload apply (known fish type, a
    catalog size slug, a positive kilogram quantity). Prices are never accepted from the
    client; the server fills them in.
    """

    fish_type: Literal["clarias", "hybrid", "any"]
    size: str = Field(min_length=1)
    quantity_kg: int = Field(gt=0)

    @field_validator("size", mode="before")
    @classmethod
    def trim_size(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class OrderCreateRequest(BaseModel):
    # Multi-line form: `items[]` supersedes the single-line fields below. The single-line
    # fields are kept optional so existing web clients keep working unchanged.
    items: list[OrderItemInput] | None = None
    fish_type: Literal["clarias", "hybrid", "any"] | None = None
    size: str | None = None
    quantity_kg: int | None = None
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
        "size",
        mode="before",
    )
    @classmethod
    def trim_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def require_one_form(self) -> "OrderCreateRequest":
        """Accept either `items[]` (1-10 lines) or the legacy single-line fields."""
        if self.items is not None:
            if not self.items:
                raise ValueError("Provide at least one order line.")
            if len(self.items) > 10:
                raise ValueError("An order can contain at most 10 lines.")
            return self
        if self.fish_type is None or self.size is None or self.quantity_kg is None:
            raise ValueError(
                "Provide either items[] or the single-line fish_type, size and quantity_kg."
            )
        return self


class OrderItemPublic(BaseModel):
    """A public order line. `size_label` is the label snapshotted at submission time."""

    fish_type: str
    size_label: str
    quantity_kg: int
    indicative_unit_price_kobo: int | None = None
    line_total_kobo: int | None = None


class OrderCreateResponse(BaseModel):
    reference: str
    access_token: str
    status: str
    submitted_at: datetime
    indicative_unit_price_kobo: int | None
    indicative_total_kobo: int | None
    items: list[OrderItemPublic] = []


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


class OrderQuotePublic(BaseModel):
    """
    The quote as the customer sees it (SPEC §5.4 "quote breakdown when available").

    Only the newest quote for an order is ever exposed. Superseded versions stay admin-only,
    and `created_by` is deliberately absent so an admin's identity never reaches a customer.
    """

    version_no: int
    unit_price_kobo: int
    quantity_kg: int
    delivery_fee_kobo: int
    discount_kobo: int
    total_kobo: int
    # Informational only: SPEC §21 has no online payment, so the UI must present this as an
    # arrangement agreed with the farm rather than something payable on the site.
    deposit_kobo: int
    valid_until: date
    message_to_customer: str | None = None
    status: str
    # True when the quote is past its validity, whether or not the cron job has caught up.
    is_expired: bool


class OrderPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    reference: str
    status: str
    fish_type: str
    size_label: str
    quantity_kg: int
    indicative_unit_price_kobo: int | None = None
    indicative_total_kobo: int | None = None
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
    items: list[OrderItemPublic] = []
    submitted_at: datetime
    events: list[OrderEventPublic] = []
    quote: OrderQuotePublic | None = None


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
    indicative_unit_price_kobo: int | None = None
    indicative_total_kobo: int | None = None
    is_bulk: bool
    preferred_date: date
    time_slot_label: str
    fulfilment: str
    items: list[OrderItemPublic] = []
    submitted_at: datetime
    # Same single-quote rule as OrderPublic, so both views agree (SPEC §5.4).
    quote: OrderQuotePublic | None = None


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


class CartLineInput(BaseModel):
    fish_type: Literal["clarias", "hybrid", "any"]
    size: str = Field(min_length=1)
    quantity_kg: int = Field(gt=0)

    @field_validator("size", mode="before")
    @classmethod
    def trim_size(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class CartLine(BaseModel):
    fish_type: str
    size: str
    size_label: str
    quantity_kg: int
    indicative_unit_price_kobo: int | None = None
    line_total_kobo: int | None = None


class CartUpdateRequest(BaseModel):
    items: list[CartLineInput] = Field(min_length=1, max_length=10)
    expected_version: int = Field(ge=0)


class CartResponse(BaseModel):
    items: list[CartLine] = []
    version: int
    updated_at: datetime | None = None
    indicative_total_kobo: int | None = None


class MobileTokenRequest(BaseModel):
    code: str = Field(min_length=1)
    code_verifier: str = Field(min_length=1)


class MobileTokenResponse(BaseModel):
    access_token: str
    expires_at: datetime
    token_type: str = "Bearer"


class ErrorDetail(BaseModel):
    code: str
    message: str
    fields: dict[str, list[str]] | None = None
    request_id: str | None = None


class ErrorEnvelope(BaseModel):
    error: ErrorDetail


class AdminLoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=200)

    @field_validator("email", mode="before")
    @classmethod
    def trim_email(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class AdminChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=12, max_length=200)


class _UuidAsStrMixin(BaseModel):
    """
    Coerce ORM `id` attributes to `str`.

    SQLModel hands back `UUID` objects but every admin response declares `id: str`, so a
    plain `model_validate` on a table row would fail validation without this. The mixin
    declares `id` itself so Pydantic accepts the validator, and subclasses inherit it.
    """

    id: str

    @field_validator("id", mode="before")
    @classmethod
    def stringify_id(cls, value: object) -> object:
        return str(value) if isinstance(value, UUID) else value


class AdminUserSummary(_UuidAsStrMixin):
    model_config = ConfigDict(from_attributes=True)

    email: str
    name: str
    role: str
    is_active: bool
    must_change_password: bool
    last_login_at: datetime | None = None


class AdminLoginResponse(BaseModel):
    user: AdminUserSummary
    csrf_token: str
    must_change_password: bool = False


class AdminMeResponse(BaseModel):
    user: AdminUserSummary
    csrf_token: str | None = None
    signed_in: bool = True


class AdminCountsByStatus(BaseModel):
    pending: int = 0
    quoted: int = 0
    confirmed: int = 0
    ready: int = 0
    completed: int = 0
    cancelled: int = 0
    declined: int = 0
    expired: int = 0


class AdminDashboardResponse(BaseModel):
    counts_by_status: AdminCountsByStatus
    today_pickups: int = 0
    today_deliveries: int = 0
    week_confirmed_volume_kg: int = 0
    upcoming_bulk_orders: int = 0
    unhandled_messages: int = 0
    outbox_counts: dict[str, int] = {}


class AdminOrderListItem(BaseModel):
    id: str
    reference: str
    status: str
    customer_name: str
    customer_phone: str
    fish_type: str
    size_label: str
    quantity_kg: int
    is_bulk: bool
    preferred_date: date
    time_slot_label: str
    fulfilment: str
    submitted_at: datetime
    version: int


class AdminOrderListResponse(BaseModel):
    orders: list[AdminOrderListItem]
    total: int
    page: int = 1
    page_size: int = 25


class AdminQuoteOut(_UuidAsStrMixin):
    model_config = ConfigDict(from_attributes=True)

    version_no: int
    unit_price_kobo: int
    quantity_kg: int
    delivery_fee_kobo: int
    discount_kobo: int
    total_kobo: int
    deposit_kobo: int
    valid_until: date
    message_to_customer: str | None = None
    status: str
    created_at: datetime
    accepted_at: datetime | None = None


class AdminPaymentOut(_UuidAsStrMixin):
    model_config = ConfigDict(from_attributes=True)

    amount_kobo: int
    method: str
    reference: str | None = None
    note: str | None = None
    received_at: datetime


class AdminOrderDetail(BaseModel):
    id: str
    reference: str
    status: str
    version: int
    allowed_next_statuses: list[str]
    customer_name: str
    customer_phone: str
    customer_email: str | None = None
    customer_notes: str | None = None
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
    internal_notes: str | None = None
    assigned_to: str | None = None
    source_intent: str | None = None
    submitted_at: datetime
    closed_at: datetime | None = None
    quotes: list[AdminQuoteOut] = []
    payments: list[AdminPaymentOut] = []
    paid_kobo: int = 0
    due_kobo: int = 0
    balance_kobo: int = 0
    events: list[OrderEventPublic] = []


class AdminOrderUpdateRequest(BaseModel):
    internal_notes: str | None = Field(default=None, max_length=2000)
    assigned_to: str | None = None
    version: int

    @field_validator("internal_notes", mode="before")
    @classmethod
    def trim_notes(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class AdminTransitionRequest(BaseModel):
    to_status: str = Field(min_length=3, max_length=24)
    version: int
    note: str | None = Field(default=None, max_length=500)


class AdminQuoteRequest(BaseModel):
    unit_price_kobo: int = Field(ge=0)
    quantity_kg: int = Field(gt=0)
    delivery_fee_kobo: int = Field(default=0, ge=0)
    discount_kobo: int = Field(default=0, ge=0)
    deposit_kobo: int = Field(default=0, ge=0)
    valid_until: date
    message_to_customer: str | None = Field(default=None, max_length=1000)

    @field_validator("message_to_customer", mode="before")
    @classmethod
    def trim_message(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class AdminQuoteResponse(BaseModel):
    quote: AdminQuoteOut
    paid_kobo: int = 0
    due_kobo: int = 0
    balance_kobo: int = 0


class AdminQuoteAcceptRequest(BaseModel):
    quote_id: str


class AdminPaymentRequest(BaseModel):
    amount_kobo: int
    method: Literal["cash", "transfer", "pos", "other"] = "cash"
    reference: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=500)
    received_at: datetime | None = None


class AdminPaymentResponse(BaseModel):
    payment: AdminPaymentOut
    paid_kobo: int
    due_kobo: int
    balance_kobo: int


class AdminHarvestWindowIn(BaseModel):
    starts_on: date
    ends_on: date
    notes: str | None = Field(default=None, max_length=500)
    is_published: bool = False


class AdminHarvestWindowOut(_UuidAsStrMixin):
    model_config = ConfigDict(from_attributes=True)

    starts_on: date
    ends_on: date
    notes: str | None = None
    is_published: bool


class AdminAvailabilityUpdate(BaseModel):
    """Bulk update every size for one harvest window in a single call (SPEC §8)."""

    statuses: dict[
        str, Literal["limited", "available", "main_stock", "sold_out", "unavailable"]
    ] = Field(default_factory=dict)
    indicative_prices_per_kg_kobo: dict[str, int | None] = Field(default_factory=dict)

    @field_validator("indicative_prices_per_kg_kobo")
    @classmethod
    def validate_indicative_prices(cls, values: dict[str, int | None]) -> dict[str, int | None]:
        if any(price is not None and price < 0 for price in values.values()):
            raise ValueError("Indicative prices must be non-negative integer kobo values.")
        return values


class AdminSizeClassOut(_UuidAsStrMixin):
    model_config = ConfigDict(from_attributes=True)

    slug: str
    label: str
    descriptor: str
    min_kg: Decimal
    max_kg: Decimal | None
    image_path: str
    is_featured: bool
    is_smoking_size: bool
    is_active: bool
    sort_order: int


class AdminSizeClassUpdate(BaseModel):
    label: str | None = Field(default=None, max_length=80)
    descriptor: str | None = Field(default=None, max_length=160)
    image_path: str | None = Field(default=None, max_length=255)
    is_featured: bool | None = None
    is_smoking_size: bool | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class AdminFishTypeOut(_UuidAsStrMixin):
    model_config = ConfigDict(from_attributes=True)

    slug: str
    name: str
    description: str
    image_path: str
    is_active: bool
    sort_order: int


class AdminFishTypeUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    description: str | None = None
    image_path: str | None = Field(default=None, max_length=255)
    is_active: bool | None = None
    sort_order: int | None = None


class AdminSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    value: str


class AdminSettingsUpdate(BaseModel):
    value: str = Field(max_length=4000)


class AdminCustomerOut(BaseModel):
    id: str
    name: str
    phone_e164: str
    email: str | None = None
    notes: str | None = None
    first_order_at: datetime
    order_count: int = 0
    total_kg: int = 0


class AdminCustomerDetail(AdminCustomerOut):
    orders: list[AdminOrderListItem] = []


class AdminMessageOut(_UuidAsStrMixin):
    model_config = ConfigDict(from_attributes=True)

    name: str
    phone: str
    message: str
    status: str
    created_at: datetime


class AdminMessageUpdate(BaseModel):
    status: Literal["new", "handled"] = "handled"


class AdminUserCreate(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=12, max_length=200)
    role: Literal["owner", "staff"] = "staff"

    @field_validator("email", mode="before")
    @classmethod
    def trim_email(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class AdminUserUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    password: str | None = Field(default=None, max_length=200)
    role: Literal["owner", "staff"] | None = None
    is_active: bool | None = None
