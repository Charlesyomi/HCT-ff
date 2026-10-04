"""Migration reversibility for the multi-line/cart/mobile tables (Postgres only).

Runs only with `DATABASE_URL_TEST`; see tests/conftest.py for the existing pattern.

Note: `migrations/env.py` prefers `DATABASE_URL_DIRECT` over `DATABASE_URL`, so this module
runs its own Alembic subprocess that overrides *both* variables. Otherwise a developer
`DATABASE_URL_DIRECT` in apps/api/.env would silently migrate the wrong database.
"""

import os
import subprocess
import sys

from sqlalchemy import create_engine, text
from sqlmodel import Session

from tests.conftest import API_ROOT

NEW_TABLES = ("order_items", "carts", "mobile_auth_codes")


def run_alembic_at(arguments: list[str], database_url: str) -> subprocess.CompletedProcess[str]:
    environment = {
        **os.environ,
        "DATABASE_URL": database_url,
        "DATABASE_URL_DIRECT": database_url,
    }
    return subprocess.run(
        [sys.executable, "-m", "alembic", *arguments],
        cwd=str(API_ROOT),
        capture_output=True,
        env=environment,
        text=True,
        check=False,
    )


def table_names(database_url: str) -> list[str]:
    engine = create_engine(database_url, pool_pre_ping=True)
    try:
        with Session(engine) as session:
            found = session.execute(
                text(
                    "SELECT table_name FROM information_schema.tables "
                    f"WHERE table_name IN {NEW_TABLES!r}"
                )
            ).scalars().all()
        return list(found)
    finally:
        engine.dispose()


def test_new_tables_appear_on_upgrade_and_disappear_on_downgrade(
    postgres_url: str,
) -> None:
    downgrade_to_base = run_alembic_at(["downgrade", "base"], postgres_url)
    assert downgrade_to_base.returncode == 0, downgrade_to_base.stderr

    upgrade = run_alembic_at(["upgrade", "head"], postgres_url)
    assert upgrade.returncode == 0, upgrade.stderr
    assert sorted(table_names(postgres_url)) == sorted(NEW_TABLES)

    downgrade = run_alembic_at(["downgrade", "base"], postgres_url)
    assert downgrade.returncode == 0, downgrade.stderr
    assert table_names(postgres_url) == []


def test_existing_orders_are_backfilled_with_one_line_each(
    postgres_url: str,
) -> None:
    """An order that existed before the migration gains exactly one order_items row."""
    assert run_alembic_at(["downgrade", "base"], postgres_url).returncode == 0
    assert run_alembic_at(["upgrade", "20241005_indicative_pricing"], postgres_url).returncode == 0

    engine = create_engine(postgres_url, pool_pre_ping=True)
    try:
        with engine.begin() as connection:
            connection.execute(text("DELETE FROM order_events"))
            connection.execute(text("DELETE FROM orders"))
            connection.execute(text("DELETE FROM customers"))
            # A bare migration has no catalog rows, so seed the one size this order needs.
            connection.execute(
                text(
                    "INSERT INTO size_classes (id, slug, label, descriptor, min_kg, max_kg, "
                    "image_path, is_featured, is_smoking_size, is_active, sort_order, "
                    "created_at, updated_at) VALUES "
                    "(gen_random_uuid(), '2-3kg', '2 – 3kg', 'Table / wholesale size', "
                    "2.00, 3.00, '/images/catfish-placeholder.svg', false, true, true, 1, "
                    "now(), now())"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO customers (id, name, phone_e164, email, first_order_at, "
                    "created_at, updated_at) VALUES "
                    "(gen_random_uuid(), 'Backfill Customer', '+2348010000000', "
                    "'backfill@example.com', now(), now(), now())"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO orders (id, reference, customer_id, status, version, fish_type, "
                    "size_class_id, size_label_snapshot, quantity_kg, is_bulk, preferred_date, "
                    "time_slot_key, time_slot_label, fulfilment, idempotency_key, "
                    "idempotency_payload_hash, access_token_hash, submitted_at, created_at, "
                    "updated_at, indicative_unit_price_kobo, indicative_total_kobo) "
                    "SELECT gen_random_uuid(), 'AF-2026-9001', c.id, 'pending', 1, 'clarias', "
                    "s.id, '2 – 3kg', 250, false, current_date, '10-12', '10 AM–12 PM', "
                    "'pickup', 'backfill-key', 'a', 'b', now(), now(), now(), 5000, 1250000 "
                    "FROM customers c, size_classes s WHERE s.slug = '2-3kg'"
                )
            )
    finally:
        engine.dispose()

    upgrade = run_alembic_at(["upgrade", "head"], postgres_url)
    assert upgrade.returncode == 0, upgrade.stderr

    engine = create_engine(postgres_url, pool_pre_ping=True)
    try:
        with Session(engine) as session:
            rows = session.execute(
                text(
                    "SELECT o.reference, i.fish_type, i.size_label_snapshot, i.quantity_kg, "
                    "i.indicative_unit_price_kobo, i.line_total_kobo "
                    "FROM order_items i JOIN orders o ON o.id = i.order_id"
                )
            ).all()
    finally:
        engine.dispose()

    assert len(rows) == 1
    assert rows[0].reference == "AF-2026-9001"
    assert rows[0].fish_type == "clarias"
    assert rows[0].size_label_snapshot == "2 – 3kg"
    assert rows[0].quantity_kg == 250
    assert rows[0].indicative_unit_price_kobo == 5000
    assert rows[0].line_total_kobo == 1250000

    assert run_alembic_at(["downgrade", "base"], postgres_url).returncode == 0