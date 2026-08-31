"""a player can be hidden

Revision ID: 0021
Revises: 0020

`players.hidden` is the eye in the people admin: somebody who went home is taken out of the
singer picker without being deleted, so every score they sang keeps its owner and every past
session still names them. NOT NULL with a server default of 0, not nullable — a player is
either in the picker or not, and "unknown" is a state nothing can produce. The default is
also what fills the column for the players already in the table: nobody was hidden before
this migration, so no backfill belongs here.

Unindexed: the flag is read with the row, never selected on — the whole roster is a handful
of rows and the picker filters it in the client.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "players",
        sa.Column("hidden", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )


def downgrade() -> None:
    op.drop_column("players", "hidden")
