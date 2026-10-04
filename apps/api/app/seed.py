from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from pydantic import JsonValue
from sqlalchemy import Table
from sqlmodel import SQLModel, Session, select

from app.db import engine
from app.models import (
    Availability,
    AvailabilityStatus,
    FishType,
    HarvestWindow,
    SiteSetting,
    SizeClass,
)

HARVEST_WINDOW_TABLE: Table = SQLModel.metadata.tables["harvest_windows"]
AVAILABILITY_TABLE: Table = SQLModel.metadata.tables["availability"]

FISH_TYPES = (
    (
        "clarias",
        "Clarias",
        "The catfish everyone knows. Widely loved across Nigeria and easy to find. A dependable choice for family tables and businesses.",
        "/images/catfish-placeholder.svg",
        1,
    ),
    (
        "hybrid",
        "Hybrid",
        "Fast-growing and made for volume. A strong choice for bulk orders and resellers.",
        "/images/catfish-placeholder.svg",
        2,
    ),
)

SIZE_CLASSES = (
    ("1-1-5kg", "1 – 1.5kg", "Smoking / BBQ size", Decimal("1.00"), Decimal("1.50"), True, False),
    ("1-5-2kg", "1.5 – 2kg", "Medium size", Decimal("1.50"), Decimal("2.00"), False, False),
    ("2-3kg", "2 – 3kg", "Table / wholesale size", Decimal("2.00"), Decimal("3.00"), False, True),
    ("3kg-plus", "3kg+", "Large size", Decimal("3.00"), None, False, False),
)

AVAILABILITY_STATUSES = (
    AvailabilityStatus.LIMITED.value,
    AvailabilityStatus.AVAILABLE.value,
    AvailabilityStatus.MAIN_STOCK.value,
    AvailabilityStatus.SOLD_OUT.value,
)

SITE_SETTINGS: tuple[tuple[str, JsonValue], ...] = (
    ("whatsapp_number", "+2349019871421"),
    ("phone_number", "+2349019871421"),
    ("farm_address", "Ajebamidele, along Ikere Road, Ado-Ekiti, Ekiti State, Nigeria"),
    ("farm_maps_url", None),
    ("business_hours", ["Mon–Sun, 8:00 AM–6:00 PM"]),
    ("min_order_kg", 40),
    ("max_order_kg", 20000),
    ("min_lead_days", 1),
    (
        "time_slots",
        [
            {"key": "8-10", "label": "8–10 AM"},
            {"key": "10-12", "label": "10 AM–12 PM"},
            {"key": "12-2", "label": "12–2 PM"},
            {"key": "2-4", "label": "2–4 PM"},
            {"key": "4-6", "label": "4–6 PM"},
        ],
    ),
    ("delivery_notice", "Delivery is available within Ekiti State. The area and fee are confirmed with each quote."),
    ("announcement_banner", None),
)


def seed_catalog(session: Session) -> None:
    for slug, name, description, image_path, sort_order in FISH_TYPES:
        fish_type = session.exec(select(FishType).where(FishType.slug == slug)).first()
        if fish_type is None:
            session.add(
                FishType(
                    slug=slug,
                    name=name,
                    description=description,
                    image_path=image_path,
                    sort_order=sort_order,
                )
            )

    for slug, label, descriptor, min_kg, max_kg, is_smoking_size, is_featured in SIZE_CLASSES:
        size_class = session.exec(select(SizeClass).where(SizeClass.slug == slug)).first()
        if size_class is None:
            session.add(
                SizeClass(
                    slug=slug,
                    label=label,
                    descriptor=descriptor,
                    min_kg=min_kg,
                    max_kg=max_kg,
                    image_path="/images/catfish-placeholder.svg",
                    is_smoking_size=is_smoking_size,
                    is_featured=is_featured,
                    sort_order=len(session.exec(select(SizeClass)).all()) + 1,
                )
            )

    today_in_lagos = datetime.now(ZoneInfo("Africa/Lagos")).date()
    harvest_window = session.exec(
        select(HarvestWindow)
        .where(
            HARVEST_WINDOW_TABLE.c.is_published.is_(True),
            HARVEST_WINDOW_TABLE.c.ends_on >= today_in_lagos,
        )
        .order_by(HARVEST_WINDOW_TABLE.c.starts_on)
    ).first()
    if harvest_window is None:
        harvest_window = HarvestWindow(
            starts_on=today_in_lagos + timedelta(days=3),
            ends_on=today_in_lagos + timedelta(days=12),
            notes="Development seed harvest window",
            is_published=True,
        )
        session.add(harvest_window)
        session.flush()

    for slug, status in zip((item[0] for item in SIZE_CLASSES), AVAILABILITY_STATUSES, strict=True):
        size_class = session.exec(select(SizeClass).where(SizeClass.slug == slug)).one()
        existing_availability = session.exec(
            select(Availability).where(
                Availability.harvest_window_id == harvest_window.id,
                Availability.size_class_id == size_class.id,
                AVAILABILITY_TABLE.c.fish_type_id.is_(None),
            )
        ).first()
        if existing_availability is None:
            session.add(
                Availability(
                    harvest_window_id=harvest_window.id,
                    size_class_id=size_class.id,
                    status=status,
                )
            )

    for key, value in SITE_SETTINGS:
        setting = session.exec(select(SiteSetting).where(SiteSetting.key == key)).first()
        if setting is None:
            session.add(SiteSetting(key=key, value=value))

    session.commit()


def main() -> None:
    with Session(engine) as session:
        seed_catalog(session)


if __name__ == "__main__":
    main()
