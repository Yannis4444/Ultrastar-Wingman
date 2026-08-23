"""create songs table

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "songs",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("source_id", sa.String(length=64), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("artist", sa.Text(), nullable=False),
        sa.Column("fingerprint", sa.String(length=512), nullable=False),
        sa.Column("directory", sa.Text(), nullable=False, unique=True),
        sa.Column("txt_file", sa.Text(), nullable=False),
        sa.Column("cover_file", sa.Text(), nullable=True),
        sa.Column("audio_file", sa.Text(), nullable=True),
        sa.Column("video_file", sa.Text(), nullable=True),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("language", sa.Text(), nullable=True),
        sa.Column("genre", sa.Text(), nullable=True),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("edition", sa.Text(), nullable=True),
        sa.Column("creator", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_songs_fingerprint", "songs", ["fingerprint"])


def downgrade() -> None:
    op.drop_index("ix_songs_fingerprint", table_name="songs")
    op.drop_table("songs")
