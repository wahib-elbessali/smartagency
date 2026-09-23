"""add backend workstation ownership for AI employee activity

Revision ID: d4e6f8a0b2c4
Revises: a6b7c8d9e0f1
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d4e6f8a0b2c4"
down_revision: Union[str, Sequence[str], None] = "a6b7c8d9e0f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "workstations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("agency_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("zone_name", sa.String(length=120), nullable=False),
        sa.Column("employee_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["agency_id"], ["agencies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_workstation_name"),
    )
    op.create_index(
        op.f("ix_workstations_agency_id"),
        "workstations",
        ["agency_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_workstations_employee_id"),
        "workstations",
        ["employee_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_workstations_employee_id"), table_name="workstations")
    op.drop_index(op.f("ix_workstations_agency_id"), table_name="workstations")
    op.drop_table("workstations")
