"""a score remembers where it came in and how big the field was

Revision ID: 0026
Revises: 0025

`scores.placement` is where a score came in among the scores of its own sing (`1` is the
best), `scores.field_size` is how many scores that sing had. Both are written once, when a
sing's scores are imported, and never touched again: a moderator who deletes or reassigns one
score of a sing months later must not be able to rewrite who won it at the time. That is the
whole reason they are stored rather than computed on read — once a score is gone, no query
can tell a win from a solo any more.

Nullable, no server default: `0` would be a placement nobody can have and a field nobody sang
in, so "Wingman does not know" has to be NULL.

**The history is backfilled**, with the two counting subqueries below, rather than left NULL.
A sing that still holds every score it was given backfills exactly — the rule is the one
`karaoke.model.placements` applies to a fresh sing, standard competition ranking, so an
evening seeded before this migration ranks the way the next evening will. A sing that lost a
score to `stats.moderate` before this migration ran backfills as if that score had never been
there, which is approximate and is the honest best available: what was deleted is not on the
record any more, and there is nothing left to reconstruct it from. The alternative — leaving
every past party NULL — would have made the achievements this column exists for blind to
every evening Wingman has already recorded, which is a worse answer to the same uncertainty.

A score whose sing row is gone (nothing writes that today) is skipped by the `WHERE` and keeps
its NULL pair: unknown is what it is. The count subquery would have answered for it — it
counts the row itself — so the `WHERE EXISTS` is the only thing standing between an orphan and
a placement invented out of nothing.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0026"
down_revision: str | None = "0025"
branch_labels: str | None = None
depends_on: str | None = None

# Standard competition ranking, spelled in SQL: how many scores of the same sing beat this
# one, plus one. Ties share the better placement and the one behind them skips — the same
# rule as `karaoke.model.placements`, which is what a sing recorded from now on goes through.
_BACKFILL = """
    UPDATE scores
    SET placement = 1 + (
            SELECT COUNT(*) FROM scores AS other
            WHERE other.sing_id = scores.sing_id AND other.score > scores.score
        ),
        field_size = (
            SELECT COUNT(*) FROM scores AS other WHERE other.sing_id = scores.sing_id
        )
    WHERE EXISTS (SELECT 1 FROM sings WHERE sings.id = scores.sing_id)
"""


def upgrade() -> None:
    op.add_column("scores", sa.Column("placement", sa.Integer(), nullable=True))
    op.add_column("scores", sa.Column("field_size", sa.Integer(), nullable=True))
    op.execute(_BACKFILL)


def downgrade() -> None:
    op.drop_column("scores", "field_size")
    op.drop_column("scores", "placement")
