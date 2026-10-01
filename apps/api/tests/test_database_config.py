"""Pooler and connection-hardening tests (Addendum 001 §A2)."""

from typing import Any

import pytest

from app import db
from app.config import settings


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://postgres:postgres@db.abc.supabase.co:6543/postgres",
        "postgresql+psycopg://user:pass@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
    ],
)
def test_transaction_pooler_urls_disable_prepared_statement_caching(url: str) -> None:
    options: dict[str, Any] = db.engine_options(url)
    connect_args: dict[str, Any] = options.get("connect_args", {})  # type: ignore[assignment]
    assert db.is_pooled_url(url) is True
    assert connect_args["prepare_threshold"] is None


def test_direct_urls_keep_prepared_statements_and_still_pool() -> None:
    url = "postgresql+psycopg://postgres:postgres@db.abc.supabase.co:5432/postgres"

    options: dict[str, Any] = db.engine_options(url)
    connect_args: dict[str, Any] = options.get("connect_args", {})  # type: ignore[assignment]

    assert db.is_pooled_url(url) is False
    assert "prepare_threshold" not in connect_args
    assert options["pool_pre_ping"] is True
    assert options["pool_size"] == settings.database_pool_max_size


def test_sqlite_test_urls_do_not_receive_postgres_connect_args() -> None:
    options: dict[str, Any] = db.engine_options("sqlite://")
    connect_args: dict[str, Any] = options.get("connect_args", {})  # type: ignore[assignment]

    assert "prepare_threshold" not in connect_args


def test_connect_with_retry_retries_then_gives_up(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts: list[int] = []

    class _FailingEngine:
        def connect(self) -> Any:
            attempts.append(1)
            raise db.SQLAlchemyError("connection refused")

    monkeypatch.setattr(settings, "database_connect_retries", 3)
    monkeypatch.setattr(settings, "database_connect_backoff_seconds", 0)

    assert db.connect_with_retry(_FailingEngine()) is False
    assert len(attempts) == 3


def test_connect_with_retry_returns_true_on_first_success(monkeypatch: pytest.MonkeyPatch) -> None:
    class _WorkingEngine:
        def connect(self) -> Any:
            return self

        def __enter__(self) -> Any:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def exec_driver_sql(self, statement: str) -> None:
            assert statement == "SELECT 1"

    assert db.connect_with_retry(_WorkingEngine()) is True
