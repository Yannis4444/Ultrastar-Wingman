"""create achievements and player_achievements

Revision ID: 0022
Revises: 0021

The catalogue and what every player has reached on it. Two tables, no foreign keys like the
rest of the schema — a `player_achievements` row names a player id the same loose way
`scores.player_id` does.

`definition` is one JSON column and not a table per condition: it is never queried in SQL,
only evaluated in Python against the scores a player already has, so a relational shape
would buy nothing and cost a migration every time an operator is added.

No seed data. The included achievements are ordinary rows with stable slug ids and arrive
in their own revision, so this one stays the schema change it is.

Autogenerate also proposed replacing `ix_players_user_id` with a unique constraint and
dropping `ix_sessions_user_id`: pre-existing drift between 0006's hand-written DDL and the
models, nothing to do with achievements, and left alone here.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | None = None
depends_on: str | None = None

PLAYER_INDEX = "ix_player_achievements_player_id"


def upgrade() -> None:
    op.create_table(
        "achievements",
        # A uuid4 hex for one somebody made, a stable slug for one Wingman ships — import
        # matches by id, which is what lets a built-in be recognised across instances.
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        # An icon name the frontend resolves; the backend ships no list of them.
        sa.Column("icon", sa.String(length=32), nullable=True),
        # Absolute path of an uploaded image, which replaces the glyph when it is set.
        sa.Column("icon_file", sa.Text(), nullable=True),
        sa.Column("color", sa.String(length=16), nullable=False),
        sa.Column("hidden", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        sa.Column("built_in", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("definition", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "player_achievements",
        sa.Column("achievement_id", sa.String(length=64), primary_key=True),
        sa.Column("player_id", sa.String(length=32), primary_key=True),
        # NULL while the row carries progress only, and NULL again when a recomputation says
        # the achievement no longer holds.
        sa.Column("earned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("session_id", sa.String(length=32), nullable=True),
        sa.Column("progress_current", sa.Integer(), nullable=True),
        sa.Column("progress_target", sa.Integer(), nullable=True),
    )
    # Every read is "what has this player got"; the achievement id comes second.
    op.create_index(PLAYER_INDEX, "player_achievements", ["player_id"])


def downgrade() -> None:
    op.drop_index(PLAYER_INDEX, table_name="player_achievements")
    op.drop_table("player_achievements")
    op.drop_table("achievements")
