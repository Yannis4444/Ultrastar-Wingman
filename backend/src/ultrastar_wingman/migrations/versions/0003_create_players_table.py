"""create players table

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "players",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        # Accounts arrive in phase 4; until then every player is a temporary guest and this
        # stays false. Temporary players are still persisted — the old app lost them on restart.
        sa.Column("registered", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("avatar_file", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    # Names are unique case-insensitively. SQLite's lower() folds ASCII only, so "Jörg" and
    # "jörg" can coexist — acceptable, unicode case folding is not worth a custom collation.
    op.create_index("ix_players_name_lower", "players", [sa.text("lower(name)")], unique=True)


def downgrade() -> None:
    op.drop_index("ix_players_name_lower", table_name="players")
    op.drop_table("players")
