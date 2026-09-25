"""add backend wanted-list ownership metadata

Revision ID: g1b2c3d4e5f6
Revises: d4e6f8a0b2c4, f7a2c9d4e6b1
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "g1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = (
    "d4e6f8a0b2c4",
    "f7a2c9d4e6b1",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "wanted_people",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("agency_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("embeddings_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["agency_id"], ["agencies.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_wanted_person_name"),
    )
    op.create_index("ix_wanted_people_agency_id", "wanted_people", ["agency_id"])


def downgrade() -> None:
    op.drop_index("ix_wanted_people_agency_id", table_name="wanted_people")
    op.drop_table("wanted_people")
