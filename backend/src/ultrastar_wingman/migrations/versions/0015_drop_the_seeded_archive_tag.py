"""drop the seeded archive tag

Revision ID: 0015
Revises: 0014

0013 seeded two tags. `broken` earns its place — a song nobody may see is a permission and
not a preference, so it has to exist before anybody can be granted it. `archive` never did:
"fold these away by default" is one tick on any tag somebody makes, and a tag that arrives
with the app is a tag every party has to decide what to do with. So it goes, and a fresh
database has `broken` alone.

0013 itself is left exactly as it was: a migration must keep producing the same database
after the module's defaults change, which is what lets an old database and a new one arrive
at the same schema by the same path. A fresh database therefore gets the row here and loses
it again one revision later, and the two cases need no separate code.

Only an *untouched* seed is removed: the id 0013 wrote, still called `archive`, and on no
song. A renamed tag, or one somebody has been tagging songs with, is that party's work and
stays — together with its permission rows, which go only when the tag itself does. The
name is compared case-sensitively on purpose: renaming it to `Archive` is a decision too.

Downgrade puts the row back, permissions and all, but only if nothing is standing where it
was — neither the id nor a tag called `archive` (`ix_tags_name_lower` is unique over
`lower(name)`, so re-seeding blindly could fail on a party's own archive tag). That one
check gates the permission rows too: a tag the upgrade *kept* is the party's own, and
handing it back a grant they took away would be the upgrade undoing their work rather than
its own.
"""

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | None = None
depends_on: str | None = None

# The id 0013 wrote. Written out literally, like every other value in a migration.
ARCHIVE_TAG_ID = "a96ea6e6f3504493817d2db6813e030a"
ARCHIVE_NAME = "archive"

# The rows 0013 gave it, so the downgrade restores what it removed.
ARCHIVE_PERMISSIONS: tuple[tuple[str, str], ...] = (
    ("view", "guest"),
    ("view", "user"),
    ("view", "trusted"),
    ("view_songs", "guest"),
    ("view_songs", "user"),
    ("view_songs", "trusted"),
    ("assign", "trusted"),
)

# "Still the seed nobody touched", as one condition both deletes are guarded by.
_UNTOUCHED = (
    "SELECT 1 FROM tags WHERE id = :tag_id AND name = :name "
    "AND NOT EXISTS (SELECT 1 FROM song_tags WHERE song_tags.tag_id = :tag_id)"
)

_DROP_PERMISSIONS = sa.text(
    f"DELETE FROM tag_permissions WHERE tag_id = :tag_id AND EXISTS ({_UNTOUCHED})"
)
_DROP_TAG = sa.text(f"DELETE FROM tags WHERE id = :tag_id AND EXISTS ({_UNTOUCHED})")

# Is anything standing where the row goes back — its id, or its name? `ix_tags_name_lower`
# is unique over `lower(name)`, so re-seeding blindly could fail on a party's own archive.
_ROW_IS_TAKEN = sa.text("SELECT 1 FROM tags WHERE id = :tag_id OR lower(name) = lower(:name)")

_SEED_TAG = sa.text(
    "INSERT INTO tags (id, name, icon, color, show_in_list, hide_by_default, created_at) "
    "VALUES (:tag_id, :name, 'archive', 'neutral', 0, 1, :created_at)"
)
# Insert-if-missing like 0013's, so a hand-edited database that kept the permission rows
# after losing the tag cannot trip `uq_tag_permissions_role`.
_SEED_PERMISSION = sa.text(
    "INSERT INTO tag_permissions (tag_id, action, role, user_id) "
    "SELECT :tag_id, :action, :role, NULL WHERE NOT EXISTS ("
    "SELECT 1 FROM tag_permissions WHERE tag_id = :tag_id AND action = :action AND role = :role)"
)


def upgrade() -> None:
    parameters = {"tag_id": ARCHIVE_TAG_ID, "name": ARCHIVE_NAME}
    # The permission rows first: dropping the tag would take the guard with it.
    op.execute(_DROP_PERMISSIONS.bindparams(**parameters))
    op.execute(_DROP_TAG.bindparams(**parameters))


def downgrade() -> None:
    connection = op.get_bind()
    taken = connection.execute(
        _ROW_IS_TAKEN.bindparams(tag_id=ARCHIVE_TAG_ID, name=ARCHIVE_NAME)
    ).first()
    # Something is already there: either the seed the upgrade deliberately kept, or a tag
    # the party made themselves. Both are theirs — putting rows back into either one would
    # re-grant what they revoked, so the downgrade leaves it exactly as it found it.
    if taken is not None:
        return

    connection.execute(
        _SEED_TAG.bindparams(tag_id=ARCHIVE_TAG_ID, name=ARCHIVE_NAME, created_at=datetime.now(UTC))
    )
    for action, role in ARCHIVE_PERMISSIONS:
        connection.execute(
            _SEED_PERMISSION.bindparams(tag_id=ARCHIVE_TAG_ID, action=action, role=role)
        )
