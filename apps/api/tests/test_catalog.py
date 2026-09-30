from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.db import get_session
from app.main import app
from app.models import ContactMessage, HarvestWindow
from app.seed import seed_catalog


@pytest.fixture
def catalog_app() -> Iterator[tuple[TestClient, Engine]]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        seed_catalog(session)

    def override_session() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    try:
        with TestClient(app) as client:
            yield client, engine
    finally:
        app.dependency_overrides.clear()
        engine.dispose()


def test_catalog_returns_database_backed_public_data(
    catalog_app: tuple[TestClient, Engine],
) -> None:
    client, _ = catalog_app
    response = client.get("/api/v1/catalog")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=30, stale-while-revalidate=30"

    payload = response.json()
    assert [fish["slug"] for fish in payload["fish_types"]] == ["clarias", "hybrid"]
    assert [size["slug"] for size in payload["size_classes"]] == [
        "1-1-5kg",
        "1-5-2kg",
        "2-3kg",
        "3kg-plus",
    ]
    assert [size["status"] for size in payload["size_classes"]] == [
        "limited",
        "available",
        "main_stock",
        "sold_out",
    ]
    assert payload["harvest_window"] is not None
    assert "internal_estimate_kg" not in response.text
    assert payload["settings"]["min_order_kg"] == 40


def test_catalog_returns_no_window_and_unavailable_sizes_without_a_published_window(
    catalog_app: tuple[TestClient, Engine],
) -> None:
    client, engine = catalog_app
    with Session(engine) as session:
        for window in session.exec(select(HarvestWindow)).all():
            window.is_published = False
            session.add(window)
        session.commit()

    response = client.get("/api/v1/catalog")
    assert response.status_code == 200
    assert response.json()["harvest_window"] is None
    assert {size["status"] for size in response.json()["size_classes"]} == {"unavailable"}


def test_contact_submission_is_trimmed_and_persisted(
    catalog_app: tuple[TestClient, Engine],
) -> None:
    client, engine = catalog_app
    response = client.post(
        "/api/v1/contact",
        json={
            "name": "  Ada Okafor ",
            "phone": " 0801 234 5678 ",
            "message": " Please call me ",
        },
    )
    assert response.status_code == 201
    assert response.json() == {"status": "received"}

    with Session(engine) as session:
        message = session.exec(select(ContactMessage)).one()
        assert message.name == "Ada Okafor"
        assert message.phone == "0801 234 5678"
        assert message.message == "Please call me"


def test_contact_rejects_short_messages(catalog_app: tuple[TestClient, Engine]) -> None:
    client, _ = catalog_app
    response = client.post(
        "/api/v1/contact", json={"name": "Ada", "phone": "08012345678", "message": "no"}
    )
    assert response.status_code == 422
