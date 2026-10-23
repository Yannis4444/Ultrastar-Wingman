"""a song's ReplayGain

Revision ID: 0037
Revises: 0036

Two nullable columns on `songs`: `replay_gain_db` and `replay_gain_peak`, the ReplayGain of the
song's audio file — the track gain in dB against -18 LUFS and the true peak as a linear value
(`downloads.loudness`). Wingman writes them when it tags a download, or finds the file tagged
already, and the host screen will play the background music and the song previews at that gain.

No backfill: a value is the audio file's, and reading it takes an ffmpeg run per song, which a
migration is no place for. The songs already in the library read NULL, "not known", until a
pass over the library fills them. A scan never does.

Autogenerate also proposed index changes on `players.user_id` and `sessions.user_id`: a
difference between the models and earlier revisions that has nothing to do with this one, so
they are left out.

Idempotent the way 0035 is: a column already there is left alone.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0037"
down_revision: str | None = "0036"
branch_labels: str | None = None
depends_on: str | None = None

COLUMNS = ("replay_gain_db", "replay_gain_peak")


def _present() -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns("songs")}


def upgrade() -> None:
    present = _present()
    for name in COLUMNS:
        if name not in present:
            op.add_column("songs", sa.Column(name, sa.Float(), nullable=True))


def downgrade() -> None:
    present = _present()
    for name in reversed(COLUMNS):
        if name in present:
            op.drop_column("songs", name)
