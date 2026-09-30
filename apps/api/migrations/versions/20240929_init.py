"""Initial schema

Revision ID: 20240929_init
Revises:
Create Date: 2026-09-29
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20240929_init"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fish_types",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("image_path", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_fish_types_slug", "fish_types", ["slug"], unique=True)

    op.create_table(
        "size_classes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("label", sa.String(length=80), nullable=False),
        sa.Column("descriptor", sa.String(length=160), nullable=False),
        sa.Column("min_kg", sa.Numeric(precision=6, scale=2), nullable=False),
        sa.Column("max_kg", sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column("image_path", sa.String(length=255), nullable=False),
        sa.Column("is_featured", sa.Boolean(), nullable=False),
        sa.Column("is_smoking_size", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_size_classes_slug", "size_classes", ["slug"], unique=True)

    op.create_table(
        "harvest_windows",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=False),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("is_published", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("starts_on <= ends_on", name="ck_harvest_window_dates"),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "availability",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("harvest_window_id", sa.Uuid(), nullable=False),
        sa.Column("size_class_id", sa.Uuid(), nullable=False),
        sa.Column("fish_type_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("internal_estimate_kg", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('limited', 'available', 'main_stock', 'sold_out', 'unavailable')",
            name="ck_availability_status",
        ),
        sa.ForeignKeyConstraint(["fish_type_id"], ["fish_types.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["harvest_window_id"], ["harvest_windows.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["size_class_id"], ["size_classes.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "harvest_window_id", "size_class_id", name="uq_availability_window_size"
        ),
    )
    op.create_index("ix_availability_fish_type_id", "availability", ["fish_type_id"])
    op.create_index("ix_availability_harvest_window_id", "availability", ["harvest_window_id"])
    op.create_index("ix_availability_size_class_id", "availability", ["size_class_id"])

    op.create_table(
        "site_settings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_site_settings_key", "site_settings", ["key"], unique=True)

    op.create_table(
        "contact_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=False),
        sa.Column("message", sa.String(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("contact_messages")
    op.drop_index("ix_site_settings_key", table_name="site_settings")
    op.drop_table("site_settings")
    op.drop_index("ix_availability_size_class_id", table_name="availability")
    op.drop_index("ix_availability_harvest_window_id", table_name="availability")
    op.drop_index("ix_availability_fish_type_id", table_name="availability")
    op.drop_table("availability")
    op.drop_table("harvest_windows")
    op.drop_index("ix_size_classes_slug", table_name="size_classes")
    op.drop_table("size_classes")
    op.drop_index("ix_fish_types_slug", table_name="fish_types")
    op.drop_table("fish_types")
