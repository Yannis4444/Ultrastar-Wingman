"""a tag is what people put on songs again — the rule columns go

Revision ID: 0017
Revises: 0016

The rule builder 0016 made room for is gone: browsing by genre would have needed one
hand-made tag per genre, so the song's own metadata became built-in *facets* instead —
Duet, Video, Genre, Language, Edition and Decade, computed on the client out of the song
list it already has. Nothing derives a `song_tags` row any more, so `tags.rule_kind` and
`tags.rule_value` have no reader left.

The rows an automatic tag carried go first, and for the same reason 0016's downgrade drops
them: they were the rule's answer, nobody put them there, and without the column nothing
would ever take them off again — a "Duet" tag would freeze on the songs that happened to
be duets the last time a scan ran. A tag that had a rule survives as an ordinary empty tag,
keeping its name, colour and permission rows; whoever wants it back tags songs by hand.

`songs.is_duet` stays: the Duet facet reads it, and the parser fills it on every scan.
0016 stays exactly as it is — a migration has to keep producing the same database after
the code around it changes, which is what lets an old database and a new one arrive at the
same schema by the same path. So a fresh database grows the two columns in 0016 and loses
them again here, and the two cases need no separate code.

The downgrade puts the columns back, nullable and empty. It cannot restore a rule: which
tag followed what was in the columns this dropped, and the rows they derived went with
them. Every tag comes back manual, which is exactly what it is now.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # Before the column goes: it is the only thing that says which rows were derived.
    op.execute(
        sa.text(
            "DELETE FROM song_tags WHERE tag_id IN "
            "(SELECT id FROM tags WHERE rule_kind IS NOT NULL)"
        )
    )
    # Plain `ALTER TABLE ... DROP COLUMN`, not `batch_alter_table`: batch mode recreates
    # the table, and `ix_tags_name_lower` is an index over an *expression* — reflecting
    # and rebuilding one of those is exactly what batch mode does badly. SQLite has
    # supported the statement since 3.35, and 0016's own downgrade already uses it.
    op.drop_column("tags", "rule_value")
    op.drop_column("tags", "rule_kind")


def downgrade() -> None:
    op.add_column("tags", sa.Column("rule_kind", sa.String(length=32), nullable=True))
    op.add_column("tags", sa.Column("rule_value", sa.Text(), nullable=True))
