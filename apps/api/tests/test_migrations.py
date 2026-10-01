"""Migration reversibility checks (SPEC §7; Addendum §A6). Runs only with DATABASE_URL_TEST."""

from sqlalchemy import create_engine, text
from sqlmodel import Session, select

from app.models import Customer, Order
from tests.conftest import run_alembic

ORDER_TABLES = ("orders", "customers", "reference_counters", "order_events")


def test_migrations_upgrade_and_downgrade_cleanly_on_a_fresh_database(
    postgres_url: str,
) -> None:
    upgrade = run_alembic(["upgrade", "head"], postgres_url)
    assert upgrade.returncode == 0, upgrade.stderr

    engine = create_engine(postgres_url, pool_pre_ping=True)
    try:
        with Session(engine) as session:
            head = session.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        assert head
        with Session(engine) as session:
            remaining = session.execute(
                text(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_name IN ('orders', 'customers', 'reference_counters', "
                    "'order_events', 'fish_types')"
                ),
            ).scalars().all()
        assert remaining == []
    finally:
        engine.dispose()

    downgrade = run_alembic(["downgrade", "base"], postgres_url)
    assert downgrade.returncode == 0, downgrade.stderr


def test_order_tables_are_reachable_after_migrating_up(postgres_url: str) -> None:
    upgrade = run_alembic(["upgrade", "head"], postgres_url)
    assert upgrade.returncode == 0, upgrade.stderr

    engine = create_engine(postgres_url, pool_pre_ping=True)
    try:
        with Session(engine) as session:
            assert session.exec(select(Customer)).all() == []
            assert session.exec(select(Order)).all() == []
    finally:
        engine.dispose()
        run_alembic(["downgrade", "base"], postgres_url)
