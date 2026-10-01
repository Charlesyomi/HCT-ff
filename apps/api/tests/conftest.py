import os
import subprocess
import sys
import threading
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.config import settings as app_config_settings
from app.db import get_session
from app.main import app
from app.models import Customer, Order, OrderEvent
from app.rate_limiter import reset_rate_limit_buckets, set_rate_limiting_enabled
from app.schemas import OrderCreateRequest
from app.seed import seed_catalog
from app.services import turnstile as turnstile_module
from app.services.order_service import (
    create_order,
)

LAGOS = ZoneInfo("Africa/Lagos")
API_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def disable_background_workers(monkeypatch: pytest.MonkeyPatch) -> None:
    """The in-process email worker must not reach the real database during tests."""
    monkeypatch.setattr(app_config_settings, "email_worker_enabled", False)
    monkeypatch.setattr(app_config_settings, "database_warmup_on_startup", False)


def _sqlite_engine() -> Engine:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        seed_catalog(session)
    return engine


def _install_engine(engine: Engine) -> None:
    def override_session() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_session


def _reset_spam_state() -> None:
    reset_rate_limit_buckets()
    turnstile_module.reset_turnstile_state()


@pytest.fixture
def order_app() -> Iterator[tuple[TestClient, Engine]]:
    """Seeded API with the in-memory IP rate limiter disabled so tests stay independent."""
    set_rate_limiting_enabled(False)
    _reset_spam_state()
    engine = _sqlite_engine()
    _install_engine(engine)
    try:
        with TestClient(app) as client:
            yield client, engine
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
        set_rate_limiting_enabled(True)
        _reset_spam_state()


@pytest.fixture
def rate_limited_app() -> Iterator[tuple[TestClient, Engine]]:
    """Seeded API with the IP rate limiter switched on (SPEC §6.11 limits)."""
    set_rate_limiting_enabled(True)
    _reset_spam_state()
    engine = _sqlite_engine()
    _install_engine(engine)
    try:
        with TestClient(app) as client:
            yield client, engine
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
        set_rate_limiting_enabled(False)
        _reset_spam_state()


def lagos_today() -> date:
    return datetime.now(LAGOS).date()


def default_preferred_date() -> date:
    return lagos_today() + timedelta(days=3)


@pytest.fixture
def order_payload() -> Callable[..., dict[str, Any]]:
    """Factory producing a valid order payload; keyword arguments override single fields."""

    def build(**overrides: Any) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "fish_type": "clarias",
            "size": "2-3kg",
            "quantity_kg": 200,
            "preferred_date": default_preferred_date().isoformat(),
            "time_slot": "10-12",
            "fulfilment": "pickup",
            "delivery_address": "",
            "delivery_landmark": "",
            "notes": "Please call before delivery.",
            "customer_name": "Ada Okafor",
            "phone": "0801 234 5678",
            "email": "ada@example.com",
        }
        payload.update(overrides)
        return payload

    return build


@pytest.fixture
def submit(
    order_app: tuple[TestClient, Engine],
) -> Callable[..., Any]:
    client, _ = order_app

    def send(
        payload: dict[str, Any] | None = None,
        *,
        key: str | None = "idem-key-1",
    ) -> Any:
        headers: dict[str, str] = {}
        if key is not None:
            headers["Idempotency-Key"] = key
        return client.post(
            "/api/v1/orders",
            json=payload or {},
            headers=headers,
        )

    return send


@pytest.fixture(scope="session")
def postgres_url() -> str:
    url = os.getenv("DATABASE_URL_TEST", "")
    if not url:
        pytest.skip("DATABASE_URL_TEST is not set; skipping Postgres integration test")
    return url


@pytest.fixture
def postgres_engine(postgres_url: str) -> Iterator[Engine]:
    engine = create_engine(postgres_url, pool_pre_ping=True)
    SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        seed_catalog(session)
    try:
        yield engine
    finally:
        SQLModel.metadata.drop_all(engine)
        engine.dispose()


def run_alembic(arguments: list[str], database_url: str) -> subprocess.CompletedProcess[str]:
    """Run Alembic against an explicit URL by overriding DATABASE_URL for the subprocess."""
    environment = {**os.environ, "DATABASE_URL": database_url}
    return subprocess.run(
        [sys.executable, "-m", "alembic", *arguments],
        cwd=str(API_ROOT),
        capture_output=True,
        env=environment,
        text=True,
        check=False,
    )


def parallel_create_orders(
    engine: Engine,
    count: int,
    *,
    shared_idempotency_key: str | None = None,
    start_index: int = 0,
) -> list[str]:
    """
    Create `count` orders concurrently, one thread and one session per order.

    Concurrency race: every thread reads the year counter at the same moment, so without a
    row lock two threads would mint the same reference.
    Prevention: create_order takes a `SELECT ... FOR UPDATE` row lock on the year counter,
    so increments serialise inside Postgres; this helper only supplies real concurrency.
    """
    barrier = threading.Barrier(count)
    references: list[str] = []

    def worker(index: int) -> None:
        key = shared_idempotency_key or f"concurrent-{index}"
        request = OrderCreateRequest(
            fish_type="clarias",
            size="2-3kg",
            quantity_kg=200,
            preferred_date=default_preferred_date(),
            time_slot="10-12",
            fulfilment="pickup",
            delivery_address="",
            delivery_landmark="",
            notes="",
            customer_name=f"Concurrent Customer {index}",
            phone=f"0810{index:07d}",
            email=f"customer{index}@example.com",
        )
        barrier.wait()
        with Session(engine) as session:
            order, _token = create_order(session, request, key, "127.0.0.1")
            references.append(order.reference)

    with ThreadPoolExecutor(max_workers=count) as pool:
        list(pool.map(worker, range(start_index, start_index + count)))
    return references


def stored_orders(engine: Engine) -> list[Order]:
    with Session(engine) as session:
        return list(session.exec(select(Order)).all())


def stored_customers(engine: Engine) -> list[Customer]:
    with Session(engine) as session:
        return list(session.exec(select(Customer)).all())


def stored_events(engine: Engine) -> list[OrderEvent]:
    with Session(engine) as session:
        return list(session.exec(select(OrderEvent)).all())


def reference_sequence(references: list[str]) -> list[int]:
    return sorted(int(reference.rsplit("-", 1)[1]) for reference in references)