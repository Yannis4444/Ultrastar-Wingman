"""create wishes, favorites and playlists tables, seed their capabilities

Revision ID: 0007
Revises: 0006

The new capabilities are written out literally, exactly like the defaults in 0006: a
migration must keep producing the same database after the module's defaults change.
`test_permissions.test_the_migration_seeds_the_module_defaults` asserts the two agree today.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | None = None
depends_on: str | None = None

_WISHLIST = ("wishlist.view", "wishlist.add", "playlists.view")
_MANAGE = (*_WISHLIST, "playlists.manage")

# Wishing is what the guest cookie exists for, so a guest may wish; owning a playlist needs
# an account, so managing one starts at `user`.
NEW_CAPABILITIES: dict[str, tuple[str, ...]] = {
    "guest": _WISHLIST,
    "user": _MANAGE,
    "trusted": _MANAGE,
    # Stored for completeness only — the code hands admin every capability regardless.
    "admin": _MANAGE,
}

role_permissions = sa.table(
    "role_permissions", sa.column("role", sa.String), sa.column("capability", sa.String)
)


def upgrade() -> None:
    op.create_table(
        "wishes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        # Not a foreign key: a song leaving the library must not fail the delete.
        sa.Column("song_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=32), nullable=True),
        # The `wingman_guest` cookie of a browser that wished without an account.
        sa.Column("guest_id", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("(user_id IS NULL) <> (guest_id IS NULL)", name="ck_wishes_one_owner"),
        # One wish per song per owner. The NULL half of each pair never collides: SQLite
        # treats NULLs as distinct in a unique index, which is what is wanted here.
        sa.UniqueConstraint("song_id", "user_id", name="uq_wishes_song_user"),
        sa.UniqueConstraint("song_id", "guest_id", name="uq_wishes_song_guest"),
    )
    op.create_index("ix_wishes_song_id", "wishes", ["song_id"])

    op.create_table(
        "favorites",
        sa.Column("user_id", sa.String(length=32), primary_key=True),
        sa.Column("song_id", sa.String(length=64), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "playlists",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("owner_user_id", sa.String(length=32), nullable=False),
        sa.Column("shared", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_playlists_owner_user_id", "playlists", ["owner_user_id"])

    op.create_table(
        "playlist_entries",
        sa.Column("playlist_id", sa.String(length=32), primary_key=True),
        sa.Column("song_id", sa.String(length=64), primary_key=True),
        # Dense, 0..n-1, rewritten by the service after every mutation.
        sa.Column("position", sa.Integer(), nullable=False),
    )

    op.bulk_insert(
        role_permissions,
        [
            {"role": role, "capability": capability}
            for role, capabilities in NEW_CAPABILITIES.items()
            for capability in capabilities
        ],
    )


def downgrade() -> None:
    op.execute(
        role_permissions.delete().where(role_permissions.c.capability.in_(sorted(set(_MANAGE))))
    )
    op.drop_table("playlist_entries")
    op.drop_index("ix_playlists_owner_user_id", table_name="playlists")
    op.drop_table("playlists")
    op.drop_table("favorites")
    op.drop_index("ix_wishes_song_id", table_name="wishes")
    op.drop_table("wishes")
