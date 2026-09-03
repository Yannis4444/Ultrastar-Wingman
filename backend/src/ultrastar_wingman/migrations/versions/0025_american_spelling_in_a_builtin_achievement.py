"""american spelling in a built-in achievement's name

Revision ID: 0025
Revises: 0024

`builtin-artists-10` was seeded as *Well Travelled*. Wingman's text is American English, so
`builtin.py` now says *Well Traveled*, and 0023 is the only thing that ever wrote the old
spelling into a database. Editing `builtin.py` changes what a fresh database is seeded with
and nothing about an existing one, so the rename needs its own revision.

The update is conditional on the stored text: what a host renamed the badge to is theirs, and
a migration that overwrote it would be a data loss with no way back. Only a row still holding
the seeded spelling is touched.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: str | None = None
depends_on: str | None = None

ACHIEVEMENT_ID = "builtin-artists-10"
OLD_NAME = "Well Travelled"
NEW_NAME = "Well Traveled"

achievements = sa.table("achievements", sa.column("id", sa.String), sa.column("name", sa.Text))


def _rename(old: str, new: str) -> None:
    op.execute(
        achievements.update()
        .where(achievements.c.id == ACHIEVEMENT_ID, achievements.c.name == old)
        .values(name=new)
    )


def upgrade() -> None:
    _rename(OLD_NAME, NEW_NAME)


def downgrade() -> None:
    _rename(NEW_NAME, OLD_NAME)
