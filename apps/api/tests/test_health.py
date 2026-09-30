from collections.abc import Iterator

from fastapi.testclient import TestClient
from sqlmodel import Session, create_engine

from app.db import get_session
from app.main import app


client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_ready() -> None:
    sqlite_engine = create_engine("sqlite://")

    def override_session() -> Iterator[Session]:
        with Session(sqlite_engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    try:
        response = client.get("/ready")
    finally:
        app.dependency_overrides.clear()
        sqlite_engine.dispose()

    assert response.status_code == 200
    assert response.json()["status"] == "ready"


def test_cors_allows_only_the_configured_web_origin() -> None:
    preflight = client.options(
        "/api/v1/orders",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,idempotency-key",
        },
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "idempotency-key" in preflight.headers["access-control-allow-headers"].lower()

    rejected = client.get("/health", headers={"Origin": "https://unexpected.example"})
    assert "access-control-allow-origin" not in rejected.headers
