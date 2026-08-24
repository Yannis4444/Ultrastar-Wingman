"""record where an account authenticates: local password or an OIDC subject

Revision ID: 0009
Revises: 0008

An OIDC account has no password at all, so `password_hash` becomes nullable — which SQLite
cannot do in place, hence the table rebuild. `copy_from` (instead of letting batch mode
reflect) is deliberate: the unique index is on the expression `lower(username)`, which
SQLite reflection skips, so a reflected rebuild would silently drop it. With `copy_from`
nothing is reflected and the index is recreated here, explicitly, in both directions.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | None = None
depends_on: str | None = None

USERNAME_INDEX = "ix_users_username_lower"
SUBJECT_INDEX = "ix_users_oidc_subject"

# The `users` table as migration 0006 created it.
_before = sa.Table(
    "users",
    sa.MetaData(),
    sa.Column("id", sa.String(length=32), primary_key=True),
    sa.Column("username", sa.Text(), nullable=False),
    sa.Column("password_hash", sa.Text(), nullable=False),
    sa.Column("role", sa.String(length=16), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
)

# And as this migration leaves it.
_after = sa.Table(
    "users",
    sa.MetaData(),
    sa.Column("id", sa.String(length=32), primary_key=True),
    sa.Column("username", sa.Text(), nullable=False),
    sa.Column("password_hash", sa.Text(), nullable=True),
    sa.Column("role", sa.String(length=16), nullable=False),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("auth_provider", sa.Text(), nullable=False, server_default="local"),
    sa.Column("oidc_subject", sa.Text(), nullable=True),
)


def upgrade() -> None:
    with op.batch_alter_table("users", copy_from=_before) as batch:
        batch.alter_column("password_hash", existing_type=sa.Text(), nullable=True)
    op.create_index(USERNAME_INDEX, "users", [sa.text("lower(username)")], unique=True)

    # Every account that exists today is a local one; the server default keeps it that way
    # for rows written by an older Wingman that somehow still runs against this database.
    op.add_column(
        "users", sa.Column("auth_provider", sa.Text(), nullable=False, server_default="local")
    )
    op.add_column("users", sa.Column("oidc_subject", sa.Text(), nullable=True))
    # No partial WHERE: a SQLite unique index treats every NULL as distinct, so the local
    # accounts (subject NULL) do not collide with each other.
    op.create_index(SUBJECT_INDEX, "users", ["oidc_subject"], unique=True)


def downgrade() -> None:
    # An OIDC account survives as a local account nobody can log into: an empty hash is not
    # a valid argon2 hash, so every password fails against it. Deleting the account instead
    # would take its playlists and wishes with it.
    op.execute(sa.text("UPDATE users SET password_hash = '' WHERE password_hash IS NULL"))
    op.drop_index(SUBJECT_INDEX, table_name="users")
    with op.batch_alter_table("users", copy_from=_after) as batch:
        batch.drop_column("oidc_subject")
        batch.drop_column("auth_provider")
        batch.alter_column("password_hash", existing_type=sa.Text(), nullable=False)
    op.create_index(USERNAME_INDEX, "users", [sa.text("lower(username)")], unique=True)
