"""create downloads table

Revision ID: 0005
Revises: 0004

The download queue is persisted, not in memory: a restart must be able to say which
downloads were still pending and which one it interrupted.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "downloads",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("source_song_id", sa.String(length=64), nullable=False),
        # Labels for the UI: a source may not know them before the download runs.
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("artist", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("progress", sa.Float(), nullable=True),
        sa.Column("step", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        # Not a foreign key: the history outlives the song it produced.
        sa.Column("song_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_downloads_status", "downloads", ["status"])


def downgrade() -> None:
    op.drop_index("ix_downloads_status", table_name="downloads")
    op.drop_table("downloads")
