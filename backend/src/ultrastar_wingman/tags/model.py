"""The `tags`, `tag_permissions` and `song_tags` tables.

A tag is global — there is one "broken", not one per account — and everything personal
about it is a permission row: who may know it exists, who may see the songs carrying it,
who may put it on a song.

No foreign keys, like the rest of the schema: SQLite only enforces them with
`PRAGMA foreign_keys` on, which Wingman does not set. A `song_tags` row whose song left
the library is left alone rather than deleted, so a `usdb:1234` that comes back keeps its
tags; every read joins `songs` to drop the orphans.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base

# The colors a tag may be drawn in. Deliberately a short list of names and not free hex:
# a tag has to look at home next to the favorites star, whoever created it.
TAG_COLORS: tuple[str, ...] = ("neutral", "blue", "pink", "gold")

# What a permission row can grant.
#
# * `view` — know the tag exists at all (and, with `assign`, use it).
# * `view_songs` — see the songs carrying it. Missing it hides those songs everywhere.
# * `assign` — tag and untag songs with it. Only together with `view`.
TAG_ACTIONS: tuple[str, ...] = ("view", "view_songs", "assign")

# The longest a tag name may get.
MAX_NAME_LENGTH = 32

# Migration 0013 seeds these two with these exact ids, so tests and documentation can name
# them. Both are ordinary rows: whoever holds `tags.manage` may rename, recolor or delete
# them like any other tag.
BROKEN_TAG_ID = "9f95e47cdadc42a59273e16d7b0e5ace"
ARCHIVE_TAG_ID = "a96ea6e6f3504493817d2db6813e030a"


def _now() -> datetime:
    return datetime.now(UTC)


class Tag(Base):
    """One tag. `show_in_list` puts it on every song row (like the favorites star);
    `hide_by_default` asks the client to fold its songs away — a default for the people who
    may see the tag, not a permission. Hiding a song from somebody who may *not* see the
    tag is `view_songs`, and that one the backend enforces."""

    __tablename__ = "tags"
    # Unique case-insensitively, exactly like usernames and player names: two tags called
    # "Broken" and "broken" would be one tag as far as anybody reading the list is concerned.
    __table_args__ = (Index("ix_tags_name_lower", text("lower(name)"), unique=True),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    name: Mapped[str] = mapped_column(Text)
    # An `ICON_PATHS` key in the frontend. Validated by shape only — the backend has no
    # list of the icons the UI ships, and an unknown one simply draws nothing.
    icon: Mapped[str | None] = mapped_column(String(32), nullable=True)
    color: Mapped[str] = mapped_column(String(16))
    show_in_list: Mapped[bool] = mapped_column(Boolean, default=False)
    hide_by_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class TagPermission(Base):
    """One thing one subject may do with one tag. The subject is a role or a single
    account, never both — "trusted and above" is spelled out as one row per role, because
    roles are a set of bundles and not a ladder."""

    __tablename__ = "tag_permissions"
    __table_args__ = (
        CheckConstraint(
            "action IN ('view', 'view_songs', 'assign')", name="ck_tag_permissions_action"
        ),
        CheckConstraint(
            "(role IS NULL) <> (user_id IS NULL)", name="ck_tag_permissions_one_subject"
        ),
        # The NULL half of each pair never collides: SQLite treats NULLs as distinct in a
        # unique index, which is exactly what is wanted here.
        UniqueConstraint("tag_id", "action", "role", name="uq_tag_permissions_role"),
        UniqueConstraint("tag_id", "action", "user_id", name="uq_tag_permissions_user"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tag_id: Mapped[str] = mapped_column(String(32), index=True)
    action: Mapped[str] = mapped_column(String(16))
    role: Mapped[str | None] = mapped_column(String(16), nullable=True)
    user_id: Mapped[str | None] = mapped_column(String(32), nullable=True)


class SongTag(Base):
    """One tag on one song. `user_id` is who put it there — NULL for the host screen, which
    is an administrator but nobody. It stays behind when the account goes, like a score's
    player."""

    __tablename__ = "song_tags"

    tag_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    song_id: Mapped[str] = mapped_column(String(64), primary_key=True, index=True)
    user_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
