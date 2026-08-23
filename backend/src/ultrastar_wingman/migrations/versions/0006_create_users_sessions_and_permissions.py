"""create users, sessions and role_permissions tables, link players to users

Revision ID: 0006
Revises: 0005

The seeded role defaults are written out literally instead of imported from
`auth.permissions`: a migration must keep producing the same database after the module's
defaults change. A test asserts the two agree today
(`test_permissions.test_the_migration_seeds_the_module_defaults`).
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | None = None
depends_on: str | None = None

_ALL = (
    "songs.view",
    "songs.rescan",
    "karaoke.sing",
    "karaoke.stop",
    "players.view",
    "players.manage",
    "downloads.view",
    "downloads.manage",
    "usdb.search",
    "settings.view",
    "settings.manage",
    "users.manage",
    "permissions.manage",
)
_GUEST = ("songs.view", "players.view", "karaoke.sing")
_USER = (*_GUEST, "karaoke.stop", "players.manage")
_TRUSTED = (*_USER, "downloads.view", "downloads.manage", "usdb.search", "songs.rescan")

DEFAULTS: dict[str, tuple[str, ...]] = {
    "guest": _GUEST,
    "user": _USER,
    "trusted": _TRUSTED,
    # Stored for completeness; the code hands admin every capability regardless, so a
    # damaged table can never lock the administrators out.
    "admin": _ALL,
}


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("username", sa.Text(), nullable=False),
        # argon2id, never a reversible encoding.
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    # Unique case-insensitively, like player names (ASCII fold only — see migration 0003).
    op.create_index("ix_users_username_lower", "users", [sa.text("lower(username)")], unique=True)

    op.create_table(
        "sessions",
        # sha256 of the cookie value: the raw token is never persisted.
        sa.Column("token_hash", sa.String(length=64), primary_key=True),
        # Null for a host session, which is trusted by device rather than by account.
        sa.Column("user_id", sa.String(length=32), nullable=True),
        sa.Column("is_host", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])

    role_permissions = op.create_table(
        "role_permissions",
        sa.Column("role", sa.String(length=16), primary_key=True),
        sa.Column("capability", sa.String(length=64), primary_key=True),
    )
    op.bulk_insert(
        role_permissions,
        [
            {"role": role, "capability": capability}
            for role, capabilities in DEFAULTS.items()
            for capability in capabilities
        ],
    )

    # A registered player belongs to exactly one account; deleting the account unlinks the
    # player instead of deleting it, so its scores keep their owner.
    op.add_column("players", sa.Column("user_id", sa.String(length=32), nullable=True))
    op.create_index("ix_players_user_id", "players", ["user_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_players_user_id", table_name="players")
    op.drop_column("players", "user_id")
    op.drop_table("role_permissions")
    op.drop_index("ix_sessions_user_id", table_name="sessions")
    op.drop_table("sessions")
    op.drop_index("ix_users_username_lower", table_name="users")
    op.drop_table("users")
