"""create song_comments and seed the comment capabilities

Revision ID: 0014
Revises: 0013

What people say about a song. A comment always belongs to an account — it carries that
account's name and picture — so `user_id` is NOT NULL and the row leaves with the account
(`comments.service.delete_user_data`). No foreign keys, like the rest of the schema.

`comments.write` is seeded for `user` and above, `comments.moderate` for `trusted` and
above: reading the conversation is part of looking at a song and needs no account, joining
it needs one, and tidying it up is a helper's job. The values are written out literally,
exactly like 0006 to 0013: a migration must keep producing the same database after the
module's defaults change. `test_permissions.test_the_migration_seeds_the_module_defaults`
asserts the two agree today. Insert-if-missing like 0012's and 0013's, so re-running
against a hand-edited database cannot duplicate a row.

`admin` gets its rows here as well, even though the code hands an administrator every
capability regardless — the drift test reads `role_permissions` and compares it against
`DEFAULT_ROLE_CAPABILITIES`, which includes admin.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | None = None
depends_on: str | None = None

SONG_INDEX = "ix_song_comments_song_id"
USER_INDEX = "ix_song_comments_user_id"

WRITE = "comments.write"
MODERATE = "comments.moderate"

# role -> the capabilities it is seeded with. Roles are bundles and not a ladder, so every
# grant is spelled out per role.
SEEDED: dict[str, tuple[str, ...]] = {
    "user": (WRITE,),
    "trusted": (WRITE, MODERATE),
    "admin": (WRITE, MODERATE),
}

_SEED = sa.text(
    "INSERT INTO role_permissions (role, capability) "
    "SELECT :role, :capability WHERE NOT EXISTS ("
    "SELECT 1 FROM role_permissions WHERE role = :role AND capability = :capability)"
)

role_permissions = sa.table(
    "role_permissions", sa.column("role", sa.String), sa.column("capability", sa.String)
)


def upgrade() -> None:
    op.create_table(
        "song_comments",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("song_id", sa.String(length=64), nullable=False),
        # Who said it. Never NULL: the host screen is an administrator but nobody, and an
        # anonymous reader may not write at all.
        sa.Column("user_id", sa.String(length=32), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(SONG_INDEX, "song_comments", ["song_id"])
    op.create_index(USER_INDEX, "song_comments", ["user_id"])

    for role, capabilities in SEEDED.items():
        for capability in capabilities:
            op.execute(_SEED.bindparams(role=role, capability=capability))


def downgrade() -> None:
    op.execute(
        role_permissions.delete().where(role_permissions.c.capability.in_((WRITE, MODERATE)))
    )
    op.drop_index(USER_INDEX, table_name="song_comments")
    op.drop_index(SONG_INDEX, table_name="song_comments")
    op.drop_table("song_comments")
