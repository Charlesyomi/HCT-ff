"""Add customers, reference_counters, orders, and order_events tables

Revision ID: 20241001_orders
Revises: 20240929_init
Create Date: 2026-10-01
"""

from alembic import op
import sqlalchemy as sa

revision = "20241001_orders"
down_revision = "20240929_init"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "customers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("phone_e164", sa.String(length=32), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("first_order_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_customers_phone_e164", "customers", ["phone_e164"], unique=True)

    op.create_table(
        "reference_counters",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("last_value", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_reference_counters_year", "reference_counters", ["year"], unique=True)

    op.create_table(
        "orders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("reference", sa.String(length=32), nullable=False),
        sa.Column("customer_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("fish_type", sa.String(length=20), nullable=False),
        sa.Column("size_class_id", sa.Uuid(), nullable=False),
        sa.Column("size_label_snapshot", sa.String(length=80), nullable=False),
        sa.Column("quantity_kg", sa.Integer(), nullable=False),
        sa.Column("is_bulk", sa.Boolean(), nullable=False),
        sa.Column("preferred_date", sa.Date(), nullable=False),
        sa.Column("time_slot_key", sa.String(length=20), nullable=False),
        sa.Column("time_slot_label", sa.String(length=80), nullable=False),
        sa.Column("fulfilment", sa.String(length=20), nullable=False),
        sa.Column("delivery_address", sa.String(), nullable=True),
        sa.Column("delivery_landmark", sa.String(), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("source_intent", sa.String(length=40), nullable=True),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("idempotency_payload_hash", sa.String(length=64), nullable=False),
        sa.Column("access_token_hash", sa.String(length=64), nullable=False),
        sa.Column("harvest_window_id", sa.Uuid(), nullable=True),
        sa.Column("internal_notes", sa.String(), nullable=True),
        sa.Column("assigned_to", sa.Uuid(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'quoted', 'confirmed', 'ready', 'completed', 'cancelled', 'declined', 'expired')",
            name="ck_orders_status",
        ),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["size_class_id"], ["size_classes.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["harvest_window_id"], ["harvest_windows.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_orders_reference", "orders", ["reference"], unique=True)
    op.create_index("ix_orders_idempotency_key", "orders", ["idempotency_key"], unique=True)
    op.create_index("ix_orders_customer_id", "orders", ["customer_id"])
    op.create_index("ix_orders_size_class_id", "orders", ["size_class_id"])
    op.create_index("ix_orders_harvest_window_id", "orders", ["harvest_window_id"])
    op.create_index("ix_orders_access_token_hash", "orders", ["access_token_hash"])
    op.create_index("ix_orders_submitted_at", "orders", ["submitted_at"])
    op.create_index("ix_orders_status_submitted_at", "orders", ["status", "submitted_at"])

    op.create_table(
        "order_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(length=40), nullable=False),
        sa.Column("from_status", sa.String(length=24), nullable=True),
        sa.Column("to_status", sa.String(length=24), nullable=False),
        sa.Column("actor_type", sa.String(length=20), nullable=False),
        sa.Column("actor_id", sa.String(length=80), nullable=True),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_order_events_order_id", "order_events", ["order_id"])


def downgrade() -> None:
    op.drop_table("order_events")
    op.drop_table("orders")
    op.drop_table("reference_counters")
    op.drop_table("customers")
