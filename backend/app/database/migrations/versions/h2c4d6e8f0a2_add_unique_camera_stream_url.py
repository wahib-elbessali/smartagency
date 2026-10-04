"""make camera stream URLs globally unique

Revision ID: h2c4d6e8f0a2
Revises: g1b2c3d4e5f6
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "h2c4d6e8f0a2"
down_revision: Union[str, Sequence[str], None] = "g1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    duplicates = bind.execute(
        sa.text(
            """
            SELECT stream_url, COUNT(*) AS camera_count
            FROM cameras
            WHERE stream_url IS NOT NULL
            GROUP BY stream_url
            HAVING COUNT(*) > 1
            ORDER BY stream_url
            """
        )
    ).all()
    if duplicates:
        values = ", ".join(str(row[0]) for row in duplicates)
        raise RuntimeError(
            "Migration aborted: duplicate camera stream_url values exist. "
            "Resolve these values before retrying: "
            f"{values}"
        )

    op.create_unique_constraint(
        "uq_camera_stream_url",
        "cameras",
        ["stream_url"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_camera_stream_url", "cameras", type_="unique")
