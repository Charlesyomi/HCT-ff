"""Add nullable indicative pricing snapshots to availability and orders.

Revision ID: 20241005_indicative_pricing
Revises: 20241004_admin
Create Date: 2026-10-04
"""

from alembic import op
import sqlalchemy as sa

revision = "20241005_indicative_pricing"
down_revision = "20241004_admin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "availability",
        sa.Column("indicative_price_per_kg_kobo", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "availability",
        sa.Column("price_updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("orders", sa.Column("indicative_unit_price_kobo", sa.BigInteger(), nullable=True))
    op.add_column("orders", sa.Column("indicative_total_kobo", sa.BigInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "indicative_total_kobo")
    op.drop_column("orders", "indicative_unit_price_kobo")
    op.drop_column("availability", "price_updated_at")
    op.drop_column("availability", "indicative_price_per_kg_kobo")
