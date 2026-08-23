"""create sings and scores tables

Revision ID: 0004
Revises: 0003

Wingman's own statistics store. USDX's Ultrastar.db is only an ingestion source
from here on — it cannot tell two runs of the same song apart.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "sings",
        sa.Column("id", sa.String(length=32), primary_key=True),
        # Not a foreign key: statistics must survive a song leaving the library.
        sa.Column("song_id", sa.String(length=64), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        # NULL while the song runs, and forever if Wingman went down mid-song.
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_sings_song_id", "sings", ["song_id"])
    op.create_table(
        "scores",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        # Declared for documentation; SQLite does not enforce foreign keys without a pragma.
        sa.Column("sing_id", sa.String(length=32), sa.ForeignKey("sings.id"), nullable=False),
        # NULL when the name USDX scored under matched no launched slot. Deliberately not a
        # foreign key: a deleted player must not take their scores with them, and
        # `player_name` stays the durable label.
        sa.Column("player_id", sa.String(length=32), nullable=True),
        sa.Column("player_name", sa.Text(), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("difficulty", sa.Integer(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_scores_sing_id", "scores", ["sing_id"])
    op.create_index("ix_scores_player_id", "scores", ["player_id"])


def downgrade() -> None:
    op.drop_index("ix_scores_player_id", table_name="scores")
    op.drop_index("ix_scores_sing_id", table_name="scores")
    op.drop_table("scores")
    op.drop_index("ix_sings_song_id", table_name="sings")
    op.drop_table("sings")
