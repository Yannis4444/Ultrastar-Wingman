"""progress remembers which party it was counted in

Revision ID: 0029
Revises: 0028

`player_achievements.progress_session_id` is the party `progress_current` was counted in,
for progress that came from a session-scoped condition ("sing ten songs in one evening").
NULL for a global one, which was counted over the whole record and belongs to no party.

The column exists because the engine has no clock. `evaluate.py` measures a session-scoped
condition in one party — the one that satisfied it, or the player's **newest** party while
none has — and writes down which party that was; the API compares it against the party that
is still going and answers `0` for a number counted at a party that is over. A bar that says
"9 of 10" all winter, from an evening in September, is the thing this replaces — and doing it
this way needs no pass at midnight.

Nullable, no server default: NULL is exactly right for the rows already in the table.
Progress written before this revision was the best any single party ever reached, so it
names no party — and every one of those rows is rewritten the next time a pass runs for that
player (a sing they are scored in, or any edit to the catalogue), which is what puts it on
the new rule.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0029"
down_revision: str | None = "0028"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "player_achievements",
        sa.Column("progress_session_id", sa.String(length=32), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("player_achievements", "progress_session_id")
