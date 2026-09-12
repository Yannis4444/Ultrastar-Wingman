"""where a preview of a song starts

Revision ID: 0035
Revises: 0034

One nullable column on `songs`: `preview_start_seconds`, where a preview of the song should
start — the file's own `#PREVIEWSTART`, or the first sung word less a lead-in worked out from
`#GAP`, `#BPM` and the first note (`songs.txt._preview_start`). What the host screen plays
from when the reel lands on a song, so the room hears the singing and not the intro.

No backfill: every scan re-parses every txt and writes the column, so the next start fills it.
Until then the value is NULL, which the player reads as the beginning of the file.

Idempotent the way 0033 is: a column already there is left alone.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0035"
down_revision: str | None = "0034"
branch_labels: str | None = None
depends_on: str | None = None

COLUMN = "preview_start_seconds"


def _present() -> bool:
    return COLUMN in {column["name"] for column in sa.inspect(op.get_bind()).get_columns("songs")}


def upgrade() -> None:
    if _present():
        return
    op.add_column("songs", sa.Column(COLUMN, sa.Float(), nullable=True))


def downgrade() -> None:
    if _present():
        op.drop_column("songs", COLUMN)
