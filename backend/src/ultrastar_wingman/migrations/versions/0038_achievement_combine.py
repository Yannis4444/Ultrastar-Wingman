"""how an achievement's conditions combine

Revision ID: 0038
Revises: 0037

One column on `achievements`: `combine`, `all` or `any` — whether every condition of the
definition has to hold, or one of them is enough (`docs/dev/achievements.md`, *Conditions*).

`all` is what every definition written before this revision meant, so the column arrives with
that as its server default and every row already in the table — the shipped built-ins among
them — reads `all` from here on, meaning exactly what it meant before. The `definition` column
is not touched: it stays the list of conditions it always was.

Idempotent the way 0035 and 0037 are: a column already there is left alone.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0038"
down_revision: str | None = "0037"
branch_labels: str | None = None
depends_on: str | None = None


def _present() -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns("achievements")}


def upgrade() -> None:
    if "combine" not in _present():
        # NOT NULL with a default: SQLite adds such a column only with one, and the default is
        # what fills the rows that are already there.
        op.add_column(
            "achievements",
            sa.Column("combine", sa.String(8), nullable=False, server_default="all"),
        )


def downgrade() -> None:
    if "combine" in _present():
        op.drop_column("achievements", "combine")
