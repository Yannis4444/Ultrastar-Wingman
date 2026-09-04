"""seed the twenty-songs-in-one-party achievement

Revision ID: 0031
Revises: 0030

`builtin.py` gained a third rung on *Five in a Night* → *Iron Lungs*: *All Night Long*, twenty
songs in one party. Editing that file changes what a **fresh** database is seeded with and
nothing about an existing one, so the new one needs its own revision, exactly as 0023's
docstring says and exactly the way 0030 did it.

So this is 0030's shape at one row. 0023 imports `seed_rows()` live, so a database created
*after* `builtin.py` grew was seeded with everything that file holds by 0023 itself, while an
older one has the thirty-four that came before this one. Both run this, so it is
**insert-if-absent**: it asks whether its own id is already there and inserts it if it is not.
A blind insert would be a primary-key error on the first kind of database.

`NEW_IDS` is spelled out here rather than derived from `builtin.py` for 0030's reason: the
*values* come from `seed_rows()`, so a name still exists in one place, but which ids belong to
**this** revision is frozen in this file, and the next batch can grow that file again without
0031 quietly seeding those too. It is a tuple of one for the same reason it is a tuple in
0030 — nothing else about the revision depends on how many ids it owns.

Where the row lands differs between the two kinds of database, and both are intended: a fresh
one gets it directly behind *Iron Lungs*, because that is where `builtin.py` lists it, while
an existing one gets it at the end of whatever the host arranged. `sort_order` continues after
the highest in the table rather than at thirteen, which is its index in `BUILT_INS`: the
catalogue's order is the host's (`PUT /achievements/order` renumbers all of it), so the numbers
already in the table are theirs and the new row belongs behind them. `created_at` is spelled
out: a bulk insert gets no ORM default and the column is NOT NULL.
"""

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

from ultrastar_wingman.achievements.builtin import seed_rows

revision: str = "0031"
down_revision: str | None = "0030"
branch_labels: str | None = None
depends_on: str | None = None

# The ids this revision is about. Frozen: see the docstring.
NEW_IDS: tuple[str, ...] = ("builtin-evening-songs-20",)

# The columns this revision writes, frozen here so the insert does not depend on the model —
# the same list 0023 and 0030 write, and for the same reason.
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
    # hand can be — and there the new one starts at zero like any other first row.
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
    # What a player earned on it goes with it, exactly as in 0023 and 0030: a
    # `player_achievements` row naming an achievement that is gone is skipped by every listing
    # anyway, and leaving the orphan behind would make the next upgrade seed on top of it.
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
