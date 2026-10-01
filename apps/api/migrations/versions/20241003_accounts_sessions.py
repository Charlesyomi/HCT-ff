"""Add customer accounts, sessions and account links (Addendum 001 §A4)

Revision ID: 20241003_accounts_sessions
Revises: 20241002_email_outbox
Create Date: 2026-10-01
"""

from alembic import op
import sqlalchemy as sa

revision = "20241003_accounts_sessions"
down_revision = "20241002_email_outbox"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("google_sub", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("email_verified", sa.Boolean(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=True),
        sa.Column("avatar_url", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_accounts_google_sub", "accounts", ["google_sub"], unique=True)
    op.create_index("ix_accounts_email", "accounts", ["email"], unique=True)

    op.create_table(
        "account_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("csrf_token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=400), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_account_sessions_token_hash", "account_sessions", ["token_hash"], unique=True)
    op.create_index("ix_account_sessions_account_id", "account_sessions", ["account_id"])
    op.create_index("ix_account_sessions_expires_at", "account_sessions", ["expires_at"])

    # Expand-only: nullable links so existing guest orders and customers keep working.
    op.add_column("customers", sa.Column("account_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_customers_account_id",
        "customers",
        "accounts",
        ["account_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_customers_account_id", "customers", ["account_id"])

    op.add_column("orders", sa.Column("account_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_orders_account_id",
        "orders",
        "accounts",
        ["account_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_orders_account_id", "orders", ["account_id"])


def downgrade() -> None:
    op.drop_index("ix_orders_account_id", table_name="orders")
    op.drop_constraint("fk_orders_account_id", "orders", type_="foreignkey")
    op.drop_column("orders", "account_id")

    op.drop_index("ix_customers_account_id", table_name="customers")
    op.drop_constraint("fk_customers_account_id", "customers", type_="foreignkey")
    op.drop_column("customers", "account_id")

    op.drop_table("account_sessions")
    op.drop_table("accounts")
