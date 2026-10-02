"""Add admin_users, admin_sessions, quotes, payments and audit_log (SPEC §7, §9)

Revision ID: 20241004_admin
Revises: 20241003_accounts_sessions
Create Date: 2026-10-01
"""

from alembic import op
import sqlalchemy as sa

revision = "20241004_admin"
down_revision = "20241003_accounts_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "admin_users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("must_change_password", sa.Boolean(), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_attempts", sa.Integer(), nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("role IN ('owner', 'staff')", name="ck_admin_users_role"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_admin_users_email", "admin_users", ["email"], unique=True)

    op.create_table(
        "admin_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("admin_user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("csrf_token_hash", sa.String(length=64), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=400), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["admin_user_id"], ["admin_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_admin_sessions_token_hash", "admin_sessions", ["token_hash"], unique=True)
    op.create_index("ix_admin_sessions_admin_user_id", "admin_sessions", ["admin_user_id"])
    op.create_index("ix_admin_sessions_expires_at", "admin_sessions", ["expires_at"])

    op.create_table(
        "quotes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("unit_price_kobo", sa.Integer(), nullable=False),
        sa.Column("quantity_kg", sa.Integer(), nullable=False),
        sa.Column("delivery_fee_kobo", sa.Integer(), nullable=False),
        sa.Column("discount_kobo", sa.Integer(), nullable=False),
        sa.Column("total_kobo", sa.Integer(), nullable=False),
        sa.Column("deposit_kobo", sa.Integer(), nullable=False),
        sa.Column("valid_until", sa.Date(), nullable=False),
        sa.Column("message_to_customer", sa.String(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('sent', 'accepted', 'superseded', 'declined', 'expired')",
            name="ck_quotes_status",
        ),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["admin_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_quotes_order_id", "quotes", ["order_id"])
    op.create_index("ix_quotes_created_by", "quotes", ["created_by"])
    op.create_index("ix_quotes_order_id_version_no", "quotes", ["order_id", "version_no"])

    op.create_table(
        "payments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("order_id", sa.Uuid(), nullable=False),
        sa.Column("amount_kobo", sa.Integer(), nullable=False),
        sa.Column("method", sa.String(length=16), nullable=False),
        sa.Column("reference", sa.String(length=120), nullable=True),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("recorded_by", sa.Uuid(), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["recorded_by"], ["admin_users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_payments_order_id", "payments", ["order_id"])
    op.create_index("ix_payments_recorded_by", "payments", ["recorded_by"])

    op.create_table(
        "audit_log",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("actor_type", sa.String(length=20), nullable=False),
        sa.Column("actor_id", sa.String(length=80), nullable=True),
        sa.Column("action", sa.String(length=60), nullable=False),
        sa.Column("entity", sa.String(length=40), nullable=False),
        sa.Column("entity_id", sa.String(length=64), nullable=True),
        sa.Column("before", sa.JSON(), nullable=True),
        sa.Column("after", sa.JSON(), nullable=True),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_log_entity_entity_id", "audit_log", ["entity", "entity_id"])


def downgrade() -> None:
    op.drop_table("audit_log")
    op.drop_table("payments")
    op.drop_table("quotes")
    op.drop_table("admin_sessions")
    op.drop_table("admin_users")