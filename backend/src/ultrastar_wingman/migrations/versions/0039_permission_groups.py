"""replace roles with permission groups

Revision ID: 0039
Revises: 0038

An account held exactly one role — `guest`, `user`, `trusted` or `admin` — and a role was a
bundle of capabilities in `role_permissions`. From here on an account is in **User** without
a row and in any number of other groups by a row each, holding the union of their bundles
(docs/dev/permission-groups.md). In order — additions first, rebuilds after, the drop last:

1. `groups` (`ix_groups_name_lower` on `lower(name)`), with the three built-ins `guest` /
   *Guest*, `user` / *User*, `admin` / *Admin* and **Trusted** under the fixed id
   `7a1c4e9b2d6f48a3b5e0c8d1f2a3b4c5` (`permissions.TRUSTED_GROUP_ID`).
2. `group_capabilities`, with every `role_permissions` row of `guest`, `user` and `trusted`
   (the last under the Trusted id) copied **as it stands** — the host may have edited them.
   `admin`'s rows are not copied: Admin holds every capability by rule. A row of any other
   role string (only a hand edit makes one) is not copied either.
3. `user_groups` (`ix_user_groups_group_id` for the member counts), from `users.role`:
   `admin` → an Admin row, `trusted` → a Trusted row, anything else → none.
4. `tag_permissions` rebuilt: `group_id` filled from `role` (`guest`, `user` as they are,
   `trusted` → the Trusted id); every row whose `role` is set and is none of those three is
   **deleted** — `admin` (Admin sees every tag by rule) and any other string (it matched no
   account the API could make) — then `role`, its check and `uq_tag_permissions_role` go,
   and the check and `uq_tag_permissions_group` are made over `group_id`.
   `ix_tag_permissions_tag_id` is recreated explicitly.
5. `users` rebuilt without `role`; `ix_users_username_lower` and `ix_users_oidc_subject`
   recreated explicitly, exactly as 0009 does.
6. `role_permissions` dropped.

**What this keeps.** This migration never takes a right away from any account the API could
have made, nor from a caller without one; where the old bundles were not nested, a helper may
gain one:

- Every caller without an account: Guest's rows are copied unchanged.
- Every `user` account: its set was User's rows, and is now User's rows.
- Every `admin` account: every capability, before and after — and every one of them becomes
  an Admin row, so the last-admin invariant holds after the upgrade whenever it held before.
- Every `trusted` account: its set was Trusted's rows and is now User's ∪ Trusted's. Equal
  whenever User's rows are a subset of Trusted's, which Wingman's defaults are; where a host
  had taken from Trusted something User still holds, that helper **gains** it.
- Tags: a Guest or User row keeps meaning what it meant (Guest's rows still reach no
  account); a Trusted member now also gets User's rows. The rows deleted in step 4 gave
  no account the API could have made anything.
- An account whose `role` is `guest` or none of the four — neither reachable through the API,
  only a hand edit makes one — becomes a plain account in User. An unknown string held
  nothing (unless a second hand edit gave that string role or tag rows of its own, which are
  not copied) and gains User's; `guest` held Guest's and now holds User's, a loss only where
  the host had given Guest something User lacks.

**Run it again after a failure halfway.** On this stack the revision is not atomic: the
`sqlite3` module begins its transaction at the first INSERT, so a CREATE before it is committed
on the spot while everything after rolls back. A failure leaves the step-1 `groups` table
(empty) behind and every old table as it was, and the next start runs this revision again
from the top. So every CREATE of steps 1–3 is `IF NOT EXISTS`, every insert there is
insert-if-missing, and steps 4 and 5 only run while the `role` column they remove is still
there.

Everything is written out literally — the Trusted id, the built-in rows, the downgrade's
capability list — never imported from `auth.permissions` (0006's rule): a migration must keep
producing the same database after the module changes. The two rebuilds use `copy_from`
(0009's and 0012's precedent: `env.py` sets no `render_as_batch`, and a reflected rebuild
drops the expression index reflection misses), so every index is recreated by name.

**The downgrade is best effort**, a development tool and not a path a party takes:
`role_permissions` comes back from the rows of Guest, User and Trusted, with an `admin` row
for every capability Wingman had when this revision was written; `users.role` is `admin` for
an Admin member, `trusted` for a Trusted member, `user` otherwise; tag rows for Guest, User and
Trusted go back to their role. **Custom groups, every membership in them and every tag row
for them are lost**, and so is a renamed Trusted's name.
"""

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0039"
down_revision: str | None = "0038"
branch_labels: str | None = None
depends_on: str | None = None

TRUSTED_GROUP_ID = "7a1c4e9b2d6f48a3b5e0c8d1f2a3b4c5"

# The rows `groups` starts with: the three built-ins and Trusted.
GROUPS: tuple[tuple[str, str], ...] = (
    ("guest", "Guest"),
    ("user", "User"),
    ("admin", "Admin"),
    (TRUSTED_GROUP_ID, "Trusted"),
)

GROUP_NAME_INDEX = "ix_groups_name_lower"
MEMBER_GROUP_INDEX = "ix_user_groups_group_id"
TAG_PERMISSION_INDEX = "ix_tag_permissions_tag_id"
USERNAME_INDEX = "ix_users_username_lower"
SUBJECT_INDEX = "ix_users_oidc_subject"

# Every capability when this revision was written, for the downgrade's `admin` rows (0006's
# `_ALL` precedent).
_ALL = (
    "songs.view",
    "songs.rescan",
    "songs.edit",
    "songs.delete",
    "karaoke.sing",
    "karaoke.stop",
    "music.view",
    "music.control",
    "music.manage",
    "players.view",
    "players.avatar",
    "players.manage",
    "wishlist.view",
    "wishlist.add",
    "wishlist.manage",
    "playlists.view",
    "playlists.manage",
    "playlists.moderate",
    "tags.manage",
    "comments.write",
    "comments.moderate",
    "downloads.view",
    "downloads.manage",
    "usdb.search",
    "stats.view",
    "stats.history",
    "stats.manage",
    "stats.moderate",
    "stats.hide",
    "achievements.manage",
    "devices.manage",
    "settings.view",
    "settings.manage",
    "users.view",
    "users.manage",
    "permissions.manage",
)

# A role, as the group it becomes: `guest` and `user` keep their word, `trusted` is the
# Trusted id. Used by the copies of steps 2 and 4.
_ROLE_TO_GROUP = f"CASE role WHEN 'trusted' THEN '{TRUSTED_GROUP_ID}' ELSE role END"
# And back, for the downgrade.
_GROUP_TO_ROLE = f"CASE group_id WHEN '{TRUSTED_GROUP_ID}' THEN 'trusted' ELSE group_id END"

_INSERT_GROUP = sa.text(
    "INSERT INTO groups (id, name, created_at) SELECT :id, :name, :created_at "
    "WHERE NOT EXISTS (SELECT 1 FROM groups WHERE id = :id)"
)

_COPY_CAPABILITIES = sa.text(
    "INSERT INTO group_capabilities (group_id, capability) "
    f"SELECT {_ROLE_TO_GROUP}, capability FROM role_permissions "
    "WHERE role IN ('guest', 'user', 'trusted') "
    "AND NOT EXISTS (SELECT 1 FROM group_capabilities AS g "
    f"WHERE g.group_id = {_ROLE_TO_GROUP} AND g.capability = role_permissions.capability)"
)

_COPY_MEMBERSHIPS = sa.text(
    "INSERT INTO user_groups (user_id, group_id) "
    f"SELECT id, CASE role WHEN 'admin' THEN 'admin' ELSE '{TRUSTED_GROUP_ID}' END FROM users "
    "WHERE role IN ('admin', 'trusted') "
    "AND NOT EXISTS (SELECT 1 FROM user_groups AS m WHERE m.user_id = users.id "
    f"AND m.group_id = CASE users.role WHEN 'admin' THEN 'admin' ELSE '{TRUSTED_GROUP_ID}' END)"
)

# `tag_permissions` as 0013 created it, and with the `group_id` step 4 adds before the rebuild.
_tag_permissions_with_both = sa.Table(
    "tag_permissions",
    sa.MetaData(),
    sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
    sa.Column("tag_id", sa.String(length=32), nullable=False),
    sa.Column("action", sa.String(length=16), nullable=False),
    sa.Column("role", sa.String(length=16), nullable=True),
    sa.Column("user_id", sa.String(length=32), nullable=True),
    sa.Column("group_id", sa.String(length=32), nullable=True),
    sa.CheckConstraint(
        "action IN ('view', 'view_songs', 'assign')", name="ck_tag_permissions_action"
    ),
    sa.CheckConstraint(
        "(role IS NULL) <> (user_id IS NULL)", name="ck_tag_permissions_one_subject"
    ),
    sa.UniqueConstraint("tag_id", "action", "role", name="uq_tag_permissions_role"),
    sa.UniqueConstraint("tag_id", "action", "user_id", name="uq_tag_permissions_user"),
)
# As this revision leaves it, with the `role` the downgrade adds before its rebuild.
_tag_permissions_downgrading = sa.Table(
    "tag_permissions",
    sa.MetaData(),
    sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
    sa.Column("tag_id", sa.String(length=32), nullable=False),
    sa.Column("action", sa.String(length=16), nullable=False),
    sa.Column("user_id", sa.String(length=32), nullable=True),
    sa.Column("group_id", sa.String(length=32), nullable=True),
    sa.Column("role", sa.String(length=16), nullable=True),
    sa.CheckConstraint(
        "action IN ('view', 'view_songs', 'assign')", name="ck_tag_permissions_action"
    ),
    sa.CheckConstraint(
        "(group_id IS NULL) <> (user_id IS NULL)", name="ck_tag_permissions_one_subject"
    ),
    sa.UniqueConstraint("tag_id", "action", "group_id", name="uq_tag_permissions_group"),
    sa.UniqueConstraint("tag_id", "action", "user_id", name="uq_tag_permissions_user"),
)

# `users` as 0009 left it.
_users_with_role = sa.Table(
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
# And as this revision leaves it, with the `role` the downgrade adds before its rebuild.
_users_downgrading = sa.Table(
    "users",
    sa.MetaData(),
    sa.Column("id", sa.String(length=32), primary_key=True),
    sa.Column("username", sa.Text(), nullable=False),
    sa.Column("password_hash", sa.Text(), nullable=True),
    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    sa.Column("auth_provider", sa.Text(), nullable=False, server_default="local"),
    sa.Column("oidc_subject", sa.Text(), nullable=True),
    sa.Column("role", sa.String(length=16), nullable=True),
)


def _columns(table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table)}


def _now() -> str:
    # The text SQLAlchemy's `DateTime` stores on SQLite, so the ORM reads the rows back.
    return datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S.%f")


def upgrade() -> None:
    # 1. The groups, the built-ins and Trusted.
    op.create_table(
        "groups",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        if_not_exists=True,
    )
    op.create_index(
        GROUP_NAME_INDEX, "groups", [sa.text("lower(name)")], unique=True, if_not_exists=True
    )
    created_at = _now()
    for group_id, name in GROUPS:
        op.execute(_INSERT_GROUP.bindparams(id=group_id, name=name, created_at=created_at))

    # 2. What each group may do, copied from the roles as the host left them.
    op.create_table(
        "group_capabilities",
        sa.Column("group_id", sa.String(length=32), primary_key=True),
        sa.Column("capability", sa.String(length=64), primary_key=True),
        if_not_exists=True,
    )
    op.execute(_COPY_CAPABILITIES)

    # 3. Who is in which group.
    op.create_table(
        "user_groups",
        sa.Column("user_id", sa.String(length=32), primary_key=True),
        sa.Column("group_id", sa.String(length=32), primary_key=True),
        if_not_exists=True,
    )
    op.create_index(MEMBER_GROUP_INDEX, "user_groups", ["group_id"], if_not_exists=True)
    op.execute(_COPY_MEMBERSHIPS)

    # 4. Tag rows name a group instead of a role.
    if "role" in _columns("tag_permissions"):
        if "group_id" not in _columns("tag_permissions"):
            op.add_column(
                "tag_permissions", sa.Column("group_id", sa.String(length=32), nullable=True)
            )
        op.execute(
            sa.text(
                f"UPDATE tag_permissions SET group_id = {_ROLE_TO_GROUP} "
                "WHERE role IN ('guest', 'user', 'trusted')"
            )
        )
        op.execute(
            sa.text(
                "DELETE FROM tag_permissions "
                "WHERE role IS NOT NULL AND role NOT IN ('guest', 'user', 'trusted')"
            )
        )
        with op.batch_alter_table("tag_permissions", copy_from=_tag_permissions_with_both) as batch:
            batch.drop_constraint("uq_tag_permissions_role", type_="unique")
            batch.drop_constraint("ck_tag_permissions_one_subject", type_="check")
            batch.drop_column("role")
            batch.create_check_constraint(
                "ck_tag_permissions_one_subject", "(group_id IS NULL) <> (user_id IS NULL)"
            )
            batch.create_unique_constraint(
                "uq_tag_permissions_group", ["tag_id", "action", "group_id"]
            )
        op.create_index(TAG_PERMISSION_INDEX, "tag_permissions", ["tag_id"])

    # 5. `users.role` goes: a column nothing writes would read as the truth.
    if "role" in _columns("users"):
        with op.batch_alter_table("users", copy_from=_users_with_role) as batch:
            batch.drop_column("role")
        op.create_index(USERNAME_INDEX, "users", [sa.text("lower(username)")], unique=True)
        op.create_index(SUBJECT_INDEX, "users", ["oidc_subject"], unique=True)

    # 6. The roles' own table.
    op.execute(sa.text("DROP TABLE IF EXISTS role_permissions"))


def downgrade() -> None:
    op.create_table(
        "role_permissions",
        sa.Column("role", sa.String(length=16), primary_key=True),
        sa.Column("capability", sa.String(length=64), primary_key=True),
        if_not_exists=True,
    )
    op.execute(
        sa.text(
            "INSERT INTO role_permissions (role, capability) "
            f"SELECT {_GROUP_TO_ROLE}, capability FROM group_capabilities "
            f"WHERE group_id IN ('guest', 'user', '{TRUSTED_GROUP_ID}') "
            "AND NOT EXISTS (SELECT 1 FROM role_permissions AS r "
            f"WHERE r.role = {_GROUP_TO_ROLE} AND r.capability = group_capabilities.capability)"
        )
    )
    for capability in _ALL:
        op.execute(
            sa.text(
                "INSERT INTO role_permissions (role, capability) SELECT 'admin', :capability "
                "WHERE NOT EXISTS (SELECT 1 FROM role_permissions "
                "WHERE role = 'admin' AND capability = :capability)"
            ).bindparams(capability=capability)
        )

    # `users.role`: added nullable, filled, then made NOT NULL by the rebuild.
    op.add_column("users", sa.Column("role", sa.String(length=16), nullable=True))
    op.execute(
        sa.text(
            "UPDATE users SET role = CASE "
            "WHEN EXISTS (SELECT 1 FROM user_groups AS m "
            "WHERE m.user_id = users.id AND m.group_id = 'admin') THEN 'admin' "
            "WHEN EXISTS (SELECT 1 FROM user_groups AS m "
            f"WHERE m.user_id = users.id AND m.group_id = '{TRUSTED_GROUP_ID}') THEN 'trusted' "
            "ELSE 'user' END"
        )
    )
    with op.batch_alter_table("users", copy_from=_users_downgrading) as batch:
        batch.alter_column("role", existing_type=sa.String(length=16), nullable=False)
    op.create_index(USERNAME_INDEX, "users", [sa.text("lower(username)")], unique=True)
    op.create_index(SUBJECT_INDEX, "users", ["oidc_subject"], unique=True)

    # Tag rows go back to their role; a custom group's go.
    op.add_column("tag_permissions", sa.Column("role", sa.String(length=16), nullable=True))
    op.execute(
        sa.text(
            f"UPDATE tag_permissions SET role = {_GROUP_TO_ROLE} "
            f"WHERE group_id IN ('guest', 'user', '{TRUSTED_GROUP_ID}')"
        )
    )
    op.execute(sa.text("DELETE FROM tag_permissions WHERE group_id IS NOT NULL AND role IS NULL"))
    with op.batch_alter_table("tag_permissions", copy_from=_tag_permissions_downgrading) as batch:
        batch.drop_constraint("uq_tag_permissions_group", type_="unique")
        batch.drop_constraint("ck_tag_permissions_one_subject", type_="check")
        batch.drop_column("group_id")
        batch.create_check_constraint(
            "ck_tag_permissions_one_subject", "(role IS NULL) <> (user_id IS NULL)"
        )
        batch.create_unique_constraint("uq_tag_permissions_role", ["tag_id", "action", "role"])
    op.create_index(TAG_PERMISSION_INDEX, "tag_permissions", ["tag_id"])

    op.drop_index(MEMBER_GROUP_INDEX, table_name="user_groups")
    op.drop_table("user_groups")
    op.drop_table("group_capabilities")
    op.drop_index(GROUP_NAME_INDEX, table_name="groups")
    op.drop_table("groups")
