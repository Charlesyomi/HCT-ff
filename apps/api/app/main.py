from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, HTTPException
from fastapi import Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import Table, text
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import SQLModel, Session, select

from app.db import get_session
from app.config import settings
from app.models import Availability, ContactMessage, FishType, HarvestWindow, SiteSetting, SizeClass
from app.schemas import (
    CatalogResponse,
    CatalogSettingsPublic,
    ContactMessageCreate,
    ContactMessageCreated,
    FishTypePublic,
    HarvestWindowPublic,
    SizeClassPublic,
)

app = FastAPI(title="Adesoba API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Idempotency-Key", "X-Order-Token", "X-CSRF-Token"],
)

FISH_TYPE_TABLE: Table = SQLModel.metadata.tables["fish_types"]
SIZE_CLASS_TABLE: Table = SQLModel.metadata.tables["size_classes"]
HARVEST_WINDOW_TABLE: Table = SQLModel.metadata.tables["harvest_windows"]


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
def readiness(session: Session = Depends(get_session)) -> dict[str, str]:
    try:
        session.execute(text("SELECT 1"))
    except SQLAlchemyError as error:
        raise HTTPException(status_code=503, detail="Database is unavailable") from error
    return {"status": "ready"}


@app.get("/api/v1/catalog")
def catalog(response: Response, session: Session = Depends(get_session)) -> CatalogResponse:
    response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=30"
    today_in_lagos = datetime.now(ZoneInfo("Africa/Lagos")).date()
    harvest_window = session.exec(
        select(HarvestWindow)
        .where(
            HARVEST_WINDOW_TABLE.c.is_published.is_(True),
            HARVEST_WINDOW_TABLE.c.ends_on >= today_in_lagos,
        )
        .order_by(HARVEST_WINDOW_TABLE.c.starts_on)
    ).first()

    fish_types = session.exec(
        select(FishType)
        .where(FISH_TYPE_TABLE.c.is_active.is_(True))
        .order_by(FISH_TYPE_TABLE.c.sort_order)
    ).all()
    size_classes = session.exec(
        select(SizeClass)
        .where(SIZE_CLASS_TABLE.c.is_active.is_(True))
        .order_by(SIZE_CLASS_TABLE.c.sort_order)
    ).all()

    availability_by_size: dict[str, str] = {}
    if harvest_window is not None:
        records = session.exec(
            select(Availability).where(Availability.harvest_window_id == harvest_window.id)
        ).all()
        availability_by_size = {
            str(record.size_class_id): record.status
            for record in records
            if record.fish_type_id is None
        }

    defaults: dict[str, object] = {
        "whatsapp_number": "+2348012345678",
        "phone_number": "+2348012345678",
        "farm_address": "[EDIT ME] Farm address, Ogun State, Nigeria",
        "farm_maps_url": None,
        "business_hours": ["Mon–Sat, 8:00 AM–6:00 PM"],
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
        "delivery_notice": "Delivery fee and service area are confirmed with each quote.",
        "announcement_banner": None,
    }
    for setting in session.exec(select(SiteSetting)).all():
        defaults[setting.key] = setting.value

    public_sizes = [
        SizeClassPublic(
            slug=size.slug,
            label=size.label,
            descriptor=size.descriptor,
            min_kg=size.min_kg,
            max_kg=size.max_kg,
            image_path=size.image_path,
            is_featured=size.is_featured,
            is_smoking_size=size.is_smoking_size,
            sort_order=size.sort_order,
            status=(
                availability_by_size.get(str(size.id), "unavailable")
                if harvest_window is not None
                else "unavailable"
            ),
        )
        for size in size_classes
    ]

    return CatalogResponse(
        fish_types=[FishTypePublic.model_validate(fish_type) for fish_type in fish_types],
        size_classes=public_sizes,
        harvest_window=(
            HarvestWindowPublic.model_validate(harvest_window)
            if harvest_window is not None
            else None
        ),
        settings=CatalogSettingsPublic.model_validate(defaults),
    )


@app.post(
    "/api/v1/contact",
    response_model=ContactMessageCreated,
    status_code=status.HTTP_201_CREATED,
)
def create_contact_message(
    message: ContactMessageCreate,
    session: Session = Depends(get_session),
) -> ContactMessageCreated:
    session.add(
        ContactMessage(
            name=message.name,
            phone=message.phone,
            message=message.message,
        )
    )
    session.commit()
    return ContactMessageCreated()
