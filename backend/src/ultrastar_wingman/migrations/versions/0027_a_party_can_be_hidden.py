"""a party can be hidden from the picker

Revision ID: 0027
Revises: 0026

`karaoke_sessions.hidden` is the eye in the Scores page's party picker: a party the host has
tidied away is left out of that list and out of nothing else. Every score it holds stays in
the singer's own record, in a song's best scores, in the all-parties total and in what an
achievement is worked out from — the flag reaches one listing, so no number anywhere moves
because somebody tidied.

`NOT NULL` with a `0` server default, the shape `players.hidden` took in 0021, which is also
what fills the column for the parties already in the table: nothing was hidden before this
migration, and every party recorded from now on starts visible.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0027"
down_revision: str | None = "0026"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "karaoke_sessions",
        sa.Column("hidden", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )


def downgrade() -> None:
    op.drop_column("karaoke_sessions", "hidden")
