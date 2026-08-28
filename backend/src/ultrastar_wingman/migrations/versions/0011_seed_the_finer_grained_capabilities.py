"""seed the finer-grained capabilities and move player management to trusted

Revision ID: 0011
Revises: 0010

Five rights were split out of ones that were too coarse:

* `players.avatar` — somebody else's picture, out of `players.manage`. Your own picture
  needs no capability at all any more, so a plain account keeps what it had.
* `players.manage` moves from `user` to `trusted`: it deletes players, anybody's, and
  every account held it.
* `users.view` — reading the account list, out of `users.manage`.
* `stats.history` — the parties before tonight, out of `stats.view`.
* `playlists.moderate` — somebody else's shared playlist, out of a hardcoded admin check.
* `wishlist.manage` — taking a song off the wishlist for everybody (a new right).

The values are written out literally, exactly like 0006 to 0008: a migration must keep
producing the same database after the module's defaults change.
`test_permissions.test_the_migration_seeds_the_module_defaults` asserts the two agree today.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | None = None
depends_on: str | None = None

_ALL_NEW = (
    "players.avatar",
    "wishlist.manage",
    "playlists.moderate",
    "stats.history",
    "users.view",
)
_TRUSTED = ("players.avatar", "wishlist.manage", "stats.history", "users.view")

NEW_CAPABILITIES: dict[str, tuple[str, ...]] = {
    # A guest gets none of them: tonight's scoreboard is `stats.view`, which it already has.
    "user": ("stats.history",),
    "trusted": _TRUSTED,
    # Stored for completeness only — the code hands admin every capability regardless.
    "admin": _ALL_NEW,
}

# What each role gains, and — for `user` — what it loses. Deleting any player in the party
# was never meant to come with a plain account.
MOVED_TO_TRUSTED = "players.manage"

role_permissions = sa.table(
    "role_permissions", sa.column("role", sa.String), sa.column("capability", sa.String)
)


def upgrade() -> None:
    op.bulk_insert(
        role_permissions,
        [
            {"role": role, "capability": capability}
            for role, capabilities in NEW_CAPABILITIES.items()
            for capability in capabilities
        ],
    )
    op.execute(
        role_permissions.delete().where(
            sa.and_(
                role_permissions.c.role == "user",
                role_permissions.c.capability == MOVED_TO_TRUSTED,
            )
        )
    )


def downgrade() -> None:
    op.execute(role_permissions.delete().where(role_permissions.c.capability.in_(sorted(_ALL_NEW))))
    op.bulk_insert(role_permissions, [{"role": "user", "capability": MOVED_TO_TRUSTED}])
