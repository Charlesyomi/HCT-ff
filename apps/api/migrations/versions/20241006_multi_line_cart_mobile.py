"""Add multi-line orders, the account cart and mobile auth codes.

Revision ID: 20241006_multi_line_cart_mobile
Revises: 20241005_indicative_pricing
Create Date: 2026-10-04

Expand-only: no existing table, column, endpoint or test is removed or renamed. Existing
orders are backfilled with exactly one line so every order has a uniform line shape.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20241006_multi_line_cart_mobile"
down_revision = "20241005_indicative_pricing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "order_items",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("fish_type", sa.String(length=20), nullable=False),
        sa.Column("size_class_id", sa.Uuid(), nullable=False),
        sa.Column("size_label_snapshot", sa.String(length=80), nullable=False),
        sa.Column("quantity_kg", sa.Integer(), nullable=False),
        sa.Column("indicative_unit_price_kobo", sa.BigInteger(), nullable=True),
        sa.Column("line_total_kobo", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["size_class_id"], ["size_classes.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_order_items_order_id", "order_items", ["order_id"])
    op.create_index("ix_order_items_size_class_id", "order_items", ["size_class_id"])

    # Backfill: every existing order becomes a one-line order carrying the same snapshot.
    op.execute(
        sa.text(
            """
            INSERT INTO order_items (
                id, order_id, fish_type, size_class_id, size_label_snapshot, quantity_kg,
                indicative_unit_price_kobo, line_total_kobo, created_at, updated_at
            )
            SELECT
                gen_random_uuid(), id, fish_type, size_class_id, size_label_snapshot,
                quantity_kg, indicative_unit_price_kobo, indicative_total_kobo,
                created_at, updated_at
            FROM orders
            """
        )
    )

    op.create_table(
        "carts",
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("items", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("account_id"),
    )

    op.create_table(
        "mobile_auth_codes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("challenge", sa.String(length=128), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_mobile_auth_codes_code_hash", "mobile_auth_codes", ["code_hash"], unique=True
    )
    op.create_index("ix_mobile_auth_codes_account_id", "mobile_auth_codes", ["account_id"])
    op.create_index("ix_mobile_auth_codes_expires_at", "mobile_auth_codes", ["expires_at"])


def downgrade() -> None:
    op.drop_table("mobile_auth_codes")
    op.drop_table("carts")
    op.drop_table("order_items")