"""seed the second seventeen achievements Wingman ships

Revision ID: 0030
Revises: 0029

`builtin.py` grew by seventeen — a ladder of wins, the four decades, two hidden ones about the
range of an evening and eight nods. Editing that file changes what a **fresh** database is
seeded with and nothing about an existing one, so the new ones need their own revision,
exactly as 0023's docstring says.

Which makes this revision the awkward one, and the reason it is written the way it is: 0023
imports `seed_rows()` live, so a database created *after* `builtin.py` grew was already seeded
with everything that file holds by 0023 itself, while a database created before it holds only
the first seventeen. Both run this. So it is **insert-if-absent**: it asks which of its own
seventeen ids are already there and inserts the rest. A blind insert would duplicate them on
the first kind of database and fail on the primary key.

`NEW_IDS` is spelled out here rather than derived from `builtin.py`, and that is the whole
trick: the *values* come from `seed_rows()`, so a name still exists in one place, but which
ids belong to **this** revision is frozen in this file. The next batch of built-ins can then
grow `builtin.py` again without 0030 quietly seeding those too.

`sort_order` continues after the highest in the table rather than at seventeen: the catalogue's
order is the host's (`PUT /achievements/order` renumbers all of it), so the seventeen they
already arranged may sit at any numbers at all, and the new ones belong at the end of whatever
that is. `created_at` is spelled out per row, one instant for all of them: a bulk insert gets
no ORM default and the column is NOT NULL.
"""

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

from ultrastar_wingman.achievements.builtin import seed_rows

revision: str = "0030"
down_revision: str | None = "0029"
branch_labels: str | None = None
depends_on: str | None = None

# The ids this revision is about, in `builtin.py`'s order. Frozen: see the docstring.
NEW_IDS: tuple[str, ...] = (
    "builtin-wins-1",
    "builtin-wins-10",
    "builtin-wins-50",
    "builtin-decade-1970s",
    "builtin-decade-1980s",
    "builtin-decade-1990s",
    "builtin-decade-2000s",
    "builtin-time-traveler",
    "builtin-mixtape",
    "builtin-full-commitment",
    "builtin-rap-god",
    "builtin-queen-10",
    "builtin-abba-5",
    "builtin-beatles-4",
    "builtin-christmas",
    "builtin-soundtrack",
    "builtin-groundhog-day",
)

# The columns this revision writes, frozen here so the insert does not depend on the model —
# the same list 0023 writes, and for the same reason.
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


def upgrade() -> None:
    connection = op.get_bind()
    present = set(
        connection.scalars(sa.select(achievements.c.id).where(achievements.c.id.in_(NEW_IDS))).all()
    )
    missing = [row for row in seed_rows() if row["id"] in NEW_IDS and row["id"] not in present]
    if not missing:
        # A database built after `builtin.py` grew: 0023 seeded the whole of it.
        return
    # `None` on an empty table, which only a database whose achievements were all deleted by
    # hand can be — and there the new ones start at zero like any other first row.
    highest = connection.scalar(sa.select(sa.func.max(achievements.c.sort_order)))
    first = 0 if highest is None else highest + 1
    seeded_at = datetime.now(UTC)
    op.bulk_insert(
        achievements,
        [
            {**row, "sort_order": first + index, "created_at": seeded_at}
            for index, row in enumerate(missing)
        ],
    )


def downgrade() -> None:
    # What a player earned on one goes with it, exactly as in 0023: a `player_achievements`
    # row naming an achievement that is gone is skipped by every listing anyway, and leaving
    # the orphans behind would make the next upgrade seed on top of them.
    op.execute(
        sa.text("DELETE FROM player_achievements WHERE achievement_id IN :ids").bindparams(
            sa.bindparam("ids", value=list(NEW_IDS), expanding=True)
        )
    )
    op.execute(
        sa.text("DELETE FROM achievements WHERE id IN :ids").bindparams(
            sa.bindparam("ids", value=list(NEW_IDS), expanding=True)
        )
    )
