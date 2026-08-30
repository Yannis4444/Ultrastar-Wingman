"""a tag can follow a rule, and a song knows whether it is a duet

Revision ID: 0016
Revises: 0015

Three columns for one feature. `tags.rule_kind` / `tags.rule_value` are the rule a tag
follows — NULL for every tag that exists today, which is what "people set this one
themselves" means. `songs.is_duet` is the fact the first of those rules reads.

`is_duet` is NOT NULL with a server default of 0, not nullable: the parser answers yes or
no for every file it can read, so "unknown" would be a state nothing can produce. The
default is what fills the column for the songs already in the table — and it is only a
placeholder until the next scan, which re-parses every `.txt` it finds (the scanner has no
mtime cache) and writes the real value into every row. That happens on the next start,
before anybody can create a duet tag, so no data backfill belongs here: the value lives in
files this migration must not read.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "songs",
        sa.Column("is_duet", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )
    # Unindexed, like the other tag columns: the rules are read one tag at a time, and the
    # table holds a handful of rows.
    op.add_column("tags", sa.Column("rule_kind", sa.String(length=32), nullable=True))
    op.add_column("tags", sa.Column("rule_value", sa.Text(), nullable=True))


def downgrade() -> None:
    # The rows an automatic tag derived go with the rule that put them there: without the
    # column they would look like assignments people made, and nothing would ever take
    # them off again.
    op.execute(
        sa.text(
            "DELETE FROM song_tags WHERE tag_id IN "
            "(SELECT id FROM tags WHERE rule_kind IS NOT NULL)"
        )
    )
    op.drop_column("tags", "rule_value")
    op.drop_column("tags", "rule_kind")
    op.drop_column("songs", "is_duet")
