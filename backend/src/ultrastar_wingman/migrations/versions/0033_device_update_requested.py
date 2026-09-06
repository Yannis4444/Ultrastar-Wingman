"""the update a host asks a device for over Wi-Fi

Revision ID: 0033
Revises: 0032

`update_requested_at` on `devices` is the one thing the host asks *of* a device: while it
stands, the answer to that device's own reports carries the bundled firmware for it to fetch
over Wi-Fi. Nothing is pushed, so the column is the whole mechanism — the offer rides on the
next report, and it is cleared by the report that carries the new version or by the ten
minutes after which a silent failure may be retried.

A revision of its own rather than a column added to 0032, which created the table: 0032 has
been merged, so a database somewhere has already run it and would never see the column again.
Migrations are append-only once they leave the branch they were written on.

Insert-if-missing all the same, because that branch existed: a database created while the
column was still part of 0032 already has it, and a second `ADD COLUMN` of the same name is
an error SQLite offers no `IF NOT EXISTS` for.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0033"
down_revision: str | None = "0032"
branch_labels: str | None = None
depends_on: str | None = None

COLUMN = "update_requested_at"


def _has_the_column() -> bool:
    return COLUMN in {column["name"] for column in sa.inspect(op.get_bind()).get_columns("devices")}


def upgrade() -> None:
    if _has_the_column():
        return
    op.add_column("devices", sa.Column(COLUMN, sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    if not _has_the_column():
        return
    op.drop_column("devices", COLUMN)
