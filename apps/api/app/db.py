"""Database engine and session helpers (Addendum §A2: pooled Postgres in production).

Runtime uses the transaction pooler (`DATABASE_URL`, port 6543 by default) while Alembic
uses the direct endpoint (`DATABASE_URL_DIRECT`). Behind a transaction pooler the driver
must not cache prepared statements, pool sizes stay small, and the first connect is
retried because free projects pause when idle.
"""

import logging
import time
from collections.abc import Iterator
from typing import Any, Protocol

from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session, create_engine

from app.config import settings

logger = logging.getLogger("adesoba.db")

TRANSACTION_POOLER_PORTS = ("6543",)


def is_pooled_url(database_url: str) -> bool:
    """True when the URL points at a transaction pooler (PgBouncer) endpoint."""
    if not database_url:
        return False
    tail = database_url.rsplit("@", 1)[-1]
    host_and_path = tail.split("/", 1)[0]
    port = host_and_path.rsplit(":", 1)[-1] if ":" in host_and_path else ""
    return port in TRANSACTION_POOLER_PORTS


def engine_options(database_url: str) -> dict[str, object]:
    """
    Per-deployment engine options.

    Concurrency race: PgBouncer in transaction mode breaks server-side prepared statements,
    which surface as intermittent "prepared statement already exists" errors under load.
    Prevention: `prepare_threshold=None` disables the driver's prepared-statement cache
    whenever the URL points at a transaction pooler.
    """
    options: dict[str, object] = {
        "pool_pre_ping": True,
        "pool_size": settings.database_pool_max_size,
        "max_overflow": settings.database_pool_max_overflow,
        "pool_timeout": settings.database_pool_timeout_seconds,
        "pool_recycle": settings.database_pool_recycle_seconds,
    }
    connect_args: dict[str, object] = {}
    if is_pooled_url(database_url):
        connect_args["prepare_threshold"] = None
    if database_url.startswith("postgresql"):
        connect_args.setdefault("connect_timeout", settings.database_connect_timeout_seconds)
    if connect_args:
        options["connect_args"] = connect_args
    return options


def build_engine(database_url: str | None = None) -> Engine:
    return create_engine(database_url or settings.database_url, **engine_options(database_url or settings.database_url))


class Connectable(Protocol):
    """Anything with SQLAlchemy's `connect()`; lets tests inject a failing double."""

    def connect(self) -> Any: ...


def connect_with_retry(engine: Connectable) -> bool:
    """
    Best-effort first connect with backoff (free projects resume after a pause).

    The API still starts when this fails: `/ready` keeps answering so an orchestrator does
    not kill a container that is only waiting for Postgres to wake up.
    """
    for attempt in range(1, max(1, settings.database_connect_retries) + 1):
        try:
            with engine.connect() as connection:
                connection.exec_driver_sql("SELECT 1")
            logger.info("Database connection established (attempt %s)", attempt)
            return True
        except SQLAlchemyError as error:
            logger.warning("Database connect attempt %s failed: %s", attempt, error)
            if attempt >= settings.database_connect_retries:
                return False
            time.sleep(min(settings.database_connect_backoff_seconds * attempt, 30))
    return False


engine = build_engine()


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
