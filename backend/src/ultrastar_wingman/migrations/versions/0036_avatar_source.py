"""where a player's picture came from

Revision ID: 0036
Revises: 0035

A single sign-on login takes the identity provider's picture as the player's avatar, but
never over one somebody chose by hand. Three columns on `players` carry that:

- `avatar_source`, `manual` or `oidc`. NOT NULL with a server default of `manual`, which is
  also the right value for every row already in the table: before this revision the only
  way to get a picture was to upload one. A row with no picture reads `manual` too, and the
  login rule asks whether there is a picture before it asks where it came from.
- `avatar_source_url` and `avatar_source_etag`, nullable: the address an `oidc` picture was
  downloaded from and the `ETag` that answer carried, so the next login can ask whether it
  changed instead of downloading it again. NULL for an uploaded picture.

No backfill and no index: the columns are read with the row, never selected on.

Idempotent the way 0035 is: a column already there is left alone.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0036"
down_revision: str | None = "0035"
branch_labels: str | None = None
depends_on: str | None = None

NAMES = ("avatar_source", "avatar_source_url", "avatar_source_etag")


def _columns() -> list[sa.Column[str]]:
    """Built per call: a `Column` belongs to the first table it is added to, and the test
    suite runs this revision more than once in one process."""
    return [
        sa.Column(NAMES[0], sa.Text(), nullable=False, server_default=sa.text("'manual'")),
        sa.Column(NAMES[1], sa.Text(), nullable=True),
        sa.Column(NAMES[2], sa.Text(), nullable=True),
    ]


def _present() -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns("players")}


def upgrade() -> None:
    present = _present()
    for column in _columns():
        if column.name not in present:
            op.add_column("players", column)


def downgrade() -> None:
    present = _present()
    for name in reversed(NAMES):
        if name in present:
            op.drop_column("players", name)
