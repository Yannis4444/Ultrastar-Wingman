"""create tags, tag_permissions and song_tags, and seed broken and archive

Revision ID: 0013
Revises: 0012

Tags are global, and everything personal about one is a `tag_permissions` row: who may
know it exists (`view`), who may see the songs carrying it (`view_songs`), who may put it
on a song (`assign`). A tag nobody was granted `view_songs` on hides its songs from
everybody but an administrator — which is what makes "keep the broken ones out of the
list" one tag and not a setting.

Two tags are seeded. Both are ordinary rows: whoever holds `tags.manage` may rename,
recolor or delete them. Only `broken` is still there at head — 0015 takes the `archive`
row back out again, and `tags.model` names `BROKEN_TAG_ID` alone. This revision keeps
seeding both, because a migration must go on producing the same database it always did.

* **broken** — trusted and above; a guest or a plain account never sees a song marked
  broken at all.
* **archive** — everybody may see it and the songs under it; `hide_by_default` only asks
  the client to fold them away, which is a default and not a permission.

`tags.manage` itself is seeded for `trusted` (and for `admin`, which the code hands every
capability regardless). The values are written out literally, exactly like 0006 to 0012: a
migration must keep producing the same database after the module's defaults change.
`test_permissions.test_the_migration_seeds_the_module_defaults` asserts the two agree
today. Insert-if-missing like 0012's, so re-running against a hand-edited database cannot
duplicate a row.

The name index is created explicitly over `lower(name)` rather than reflected, the same
way 0006 creates the one on usernames: autogenerate does not carry expression indexes.
"""

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | None = None
depends_on: str | None = None

NAME_INDEX = "ix_tags_name_lower"
PERMISSION_INDEX = "ix_tag_permissions_tag_id"
SONG_TAG_INDEX = "ix_song_tags_song_id"

MANAGE = "tags.manage"
MANAGE_ROLES = ("trusted", "admin")

# Written out literally. `tags.model.BROKEN_TAG_ID` mirrors the first; the second lives
# here and in 0015, which removes the row it seeds.
BROKEN_TAG_ID = "9f95e47cdadc42a59273e16d7b0e5ace"
ARCHIVE_TAG_ID = "a96ea6e6f3504493817d2db6813e030a"

# tag id -> the (action, role) pairs it is seeded with. Roles are not a ladder, so
# "trusted and above" is one row per role — admin needs none, it holds everything.
SEEDED_PERMISSIONS: dict[str, tuple[tuple[str, str], ...]] = {
    BROKEN_TAG_ID: (("view", "trusted"), ("view_songs", "trusted"), ("assign", "trusted")),
    ARCHIVE_TAG_ID: (
        ("view", "guest"),
        ("view", "user"),
        ("view", "trusted"),
        ("view_songs", "guest"),
        ("view_songs", "user"),
        ("view_songs", "trusted"),
        ("assign", "trusted"),
    ),
}

_SEED_MANAGE = sa.text(
    "INSERT INTO role_permissions (role, capability) "
    "SELECT :role, :capability WHERE NOT EXISTS ("
    "SELECT 1 FROM role_permissions WHERE role = :role AND capability = :capability)"
)

role_permissions = sa.table(
    "role_permissions", sa.column("role", sa.String), sa.column("capability", sa.String)
)


def upgrade() -> None:
    tags = op.create_table(
        "tags",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        # An icon name the frontend resolves; the backend ships no list of them.
        sa.Column("icon", sa.String(length=32), nullable=True),
        sa.Column("color", sa.String(length=16), nullable=False),
        sa.Column("show_in_list", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("hide_by_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(NAME_INDEX, "tags", [sa.text("lower(name)")], unique=True)

    tag_permissions = op.create_table(
        "tag_permissions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tag_id", sa.String(length=32), nullable=False),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=True),
        sa.Column("user_id", sa.String(length=32), nullable=True),
        sa.CheckConstraint(
            "action IN ('view', 'view_songs', 'assign')", name="ck_tag_permissions_action"
        ),
        # A row speaks for a role or for one account, never for both and never for neither.
        sa.CheckConstraint(
            "(role IS NULL) <> (user_id IS NULL)", name="ck_tag_permissions_one_subject"
        ),
        sa.UniqueConstraint("tag_id", "action", "role", name="uq_tag_permissions_role"),
        sa.UniqueConstraint("tag_id", "action", "user_id", name="uq_tag_permissions_user"),
    )
    op.create_index(PERMISSION_INDEX, "tag_permissions", ["tag_id"])

    op.create_table(
        "song_tags",
        sa.Column("tag_id", sa.String(length=32), primary_key=True),
        sa.Column("song_id", sa.String(length=64), primary_key=True),
        # Who tagged it. NULL for the host screen, which is an administrator but nobody.
        sa.Column("user_id", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(SONG_TAG_INDEX, "song_tags", ["song_id"])

    now = datetime.now(UTC)
    op.bulk_insert(
        tags,
        [
            {
                "id": BROKEN_TAG_ID,
                "name": "broken",
                "icon": "alert",
                "color": "gold",
                "show_in_list": True,
                "hide_by_default": True,
                "created_at": now,
            },
            {
                "id": ARCHIVE_TAG_ID,
                "name": "archive",
                "icon": "archive",
                "color": "neutral",
                "show_in_list": False,
                "hide_by_default": True,
                "created_at": now,
            },
        ],
    )
    op.bulk_insert(
        tag_permissions,
        [
            {"tag_id": tag_id, "action": action, "role": role, "user_id": None}
            for tag_id, rows in SEEDED_PERMISSIONS.items()
            for action, role in rows
        ],
    )

    for role in MANAGE_ROLES:
        op.execute(_SEED_MANAGE.bindparams(role=role, capability=MANAGE))


def downgrade() -> None:
    op.execute(role_permissions.delete().where(role_permissions.c.capability == MANAGE))
    op.drop_index(SONG_TAG_INDEX, table_name="song_tags")
    op.drop_table("song_tags")
    op.drop_index(PERMISSION_INDEX, table_name="tag_permissions")
    op.drop_table("tag_permissions")
    op.drop_index(NAME_INDEX, table_name="tags")
    op.drop_table("tags")
