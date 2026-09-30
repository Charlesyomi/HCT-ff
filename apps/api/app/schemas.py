from datetime import date
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

    @field_validator("name", "phone", "message", mode="before")
    @classmethod
    def trim_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ContactMessageCreated(BaseModel):
    status: Literal["received"] = "received"
