"""share playlists with other accounts, and let trusted moderate them

Revision ID: 0012
Revises: 0011

Three changes:

* `playlists.shared` becomes `playlists.is_global` — the flag never meant "shared with
  somebody", it meant "everybody may look at it", and real sharing now has a table of its
  own. (`global` is a Python keyword, hence the prefix.)
* `playlists.description` — a sentence under the name.
* `playlist_members` — one row per account a playlist was shared with, with the access it
  was given and whether that account still follows the list.

`playlists.moderate` moves from admin-only to `trusted` as well: with real sharing in
place, reaching into a *global* list is tidying up after the party, not the host stepping
in. The value is written out literally, exactly like 0006 to 0011, so this migration keeps
producing the same database after the module's defaults change — but insert-if-missing,
because `playlists.moderate` is grantable today and a host may already have ticked it.

The rename goes through `batch_alter_table` with an explicit `copy_from`: `env.py` sets no
`render_as_batch`, and letting batch mode reflect the table instead would be the mistake
0009's docstring describes — whatever reflection misses is silently dropped by the rebuild.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | None = None
depends_on: str | None = None

OWNER_INDEX = "ix_playlists_owner_user_id"
MEMBER_INDEX = "ix_playlist_members_user_id"

MODERATE = "playlists.moderate"
MODERATE_ROLE = "trusted"

# The `playlists` table as migration 0007 created it.
_before = sa.Table(
    "playlists",
    sa.MetaData(),
    sa.Column("id", sa.String(length=32), primary_key=True),
    sa.Column("name", sa.Text(), nullable=False),
    sa.Column("owner_user_id", sa.String(length=32), nullable=False),
    sa.Column("shared", sa.Boolean(), nullable=False, server_default=sa.false()),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Index(OWNER_INDEX, "owner_user_id"),
)

# And as this migration leaves it.
_after = sa.Table(
    "playlists",
    sa.MetaData(),
    sa.Column("id", sa.String(length=32), primary_key=True),
    sa.Column("name", sa.Text(), nullable=False),
    sa.Column("owner_user_id", sa.String(length=32), nullable=False),
    sa.Column("is_global", sa.Boolean(), nullable=False, server_default=sa.false()),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("description", sa.Text(), nullable=True),
    sa.Index(OWNER_INDEX, "owner_user_id"),
)

_SEED_MODERATE = sa.text(
    "INSERT INTO role_permissions (role, capability) "
    "SELECT 'trusted', 'playlists.moderate' WHERE NOT EXISTS ("
    "SELECT 1 FROM role_permissions WHERE role = 'trusted' AND capability = 'playlists.moderate')"
)

role_permissions = sa.table(
    "role_permissions", sa.column("role", sa.String), sa.column("capability", sa.String)
)


def upgrade() -> None:
    with op.batch_alter_table("playlists", copy_from=_before) as batch:
        batch.alter_column(
            "shared",
            new_column_name="is_global",
            existing_type=sa.Boolean(),
            existing_nullable=False,
            existing_server_default=sa.false(),
        )
    # Outside the batch: adding a nullable column needs no table rebuild.
    op.add_column("playlists", sa.Column("description", sa.Text(), nullable=True))

    op.create_table(
        "playlist_members",
        sa.Column("playlist_id", sa.String(length=32), primary_key=True),
        sa.Column("user_id", sa.String(length=32), primary_key=True),
        sa.Column("access", sa.String(length=8), nullable=False),
        # The member's own switch: unfollowing hides the list, the access stays.
        sa.Column("followed", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "access IN ('read', 'write', 'admin')", name="ck_playlist_members_access"
        ),
    )
    op.create_index(MEMBER_INDEX, "playlist_members", ["user_id"])

    op.execute(_SEED_MODERATE)


def downgrade() -> None:
    op.execute(
        role_permissions.delete().where(
            sa.and_(
                role_permissions.c.role == MODERATE_ROLE,
                role_permissions.c.capability == MODERATE,
            )
        )
    )
    op.drop_index(MEMBER_INDEX, table_name="playlist_members")
    op.drop_table("playlist_members")
    with op.batch_alter_table("playlists", copy_from=_after) as batch:
        batch.drop_column("description")
        batch.alter_column(
            "is_global",
            new_column_name="shared",
            existing_type=sa.Boolean(),
            existing_nullable=False,
            existing_server_default=sa.false(),
        )
