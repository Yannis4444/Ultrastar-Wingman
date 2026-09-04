"""seed the achievements Wingman ships

Revision ID: 0023
Revises: 0022

The shipped achievements as ordinary rows with `built_in = 1` and stable slug ids — seventeen
of them when this was written, and whatever `builtin.py` holds when it runs, which is the
point made below. Data and not schema, which is why it is its own revision: 0022 stays the two
tables it created.

The rows are read from `achievements/builtin.py` rather than spelled out again here, so the
set exists exactly once — the seed, a future "reset the built-ins" and the tests all read the
same list. That is a deliberate exception to "a migration does not import application code":
what is being copied is a *value*, not a schema, and the insert names its own columns below,
so a later change to the model cannot break this revision. The other half of that trade is
that editing `builtin.py` changes what a **fresh** database is seeded with and nothing about
an existing one — a new built-in needs its own revision, exactly like this one (0030 is the
first of those, and insert-if-absent because of this very sentence: a database created after
`builtin.py` grew is seeded with the whole file here).

`created_at` is spelled out per row: a bulk insert gets no ORM default, and the column is NOT
NULL. One instant for all of them, because they arrive together.
"""

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

from ultrastar_wingman.achievements.builtin import BUILT_INS, seed_rows

revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | None = None
depends_on: str | None = None

# The columns this revision writes, frozen here so the insert does not depend on the model.
achievements = sa.table(
    "achievements",
    sa.column("id", sa.String),
    sa.column("name", sa.Text),
    sa.column("description", sa.Text),
    sa.column("icon", sa.String),
    sa.column("icon_file", sa.Text),
    sa.column("color", sa.String),
    sa.column("hidden", sa.Boolean),
    sa.column("enabled", sa.Boolean),
    sa.column("built_in", sa.Boolean),
    sa.column("sort_order", sa.Integer),
    sa.column("definition", sa.JSON),
    sa.column("created_at", sa.DateTime(timezone=True)),
)

SEEDED_IDS = [built_in.id for built_in in BUILT_INS]


def upgrade() -> None:
    seeded_at = datetime.now(UTC)
    op.bulk_insert(achievements, [{**row, "created_at": seeded_at} for row in seed_rows()])


def downgrade() -> None:
    # What a player earned on one goes with it: a `player_achievements` row naming an
    # achievement that is gone is skipped by every listing anyway, and leaving one orphan per
    # shipped achievement per singer behind would only make an upgrade-downgrade-upgrade cycle
    # add them twice.
    op.execute(
        sa.text("DELETE FROM player_achievements WHERE achievement_id IN :ids").bindparams(
            sa.bindparam("ids", value=SEEDED_IDS, expanding=True)
        )
    )
    op.execute(
        sa.text("DELETE FROM achievements WHERE id IN :ids").bindparams(
            sa.bindparam("ids", value=SEEDED_IDS, expanding=True)
        )
    )
