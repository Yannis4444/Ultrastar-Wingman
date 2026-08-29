"""The `wishes`, `favorites`, `playlists`, `playlist_entries` and `playlist_members` tables.

No foreign keys, like the rest of the schema: SQLite only enforces them with
`PRAGMA foreign_keys` on, which Wingman does not set, so a decorative constraint would be
worse than none. Deleting an account removes its rows explicitly
(`library.service.delete_user_data`, called by `auth.service.delete_user`).
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


def _now() -> datetime:
    return datetime.now(UTC)


class Wish(Base):
    """One person wanting to sing one song.

    A wish belongs to an account when its owner is logged in and to a browser (the
    `wingman_guest` cookie) otherwise — the old app keyed wishlists by IP address, so a
    phone changing networks lost its wishes and everybody behind a NAT shared one list.
    """

    __tablename__ = "wishes"
    __table_args__ = (
        CheckConstraint("(user_id IS NULL) <> (guest_id IS NULL)", name="ck_wishes_one_owner"),
        # One wish per song per owner. The NULL half of each pair never collides: SQLite
        # treats NULLs as distinct in a unique index, which is exactly what is wanted here.
        UniqueConstraint("song_id", "user_id", name="uq_wishes_song_user"),
        UniqueConstraint("song_id", "guest_id", name="uq_wishes_song_guest"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Not a foreign key: a song leaving the library must not fail the delete. Such a wish
    # simply drops out of the listing.
    song_id: Mapped[str] = mapped_column(String(64), index=True)
    user_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    guest_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Favorite(Base):
    """A song one account marked. Per user and persisted — the old favorites were UI-only."""

    __tablename__ = "favorites"

    user_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    song_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Playlist(Base):
    """A named, ordered list of songs.

    Three ways in: the owner, a `PlaylistMember` row, and `is_global` — which shows the
    list to everybody who may view playlists without letting any of them change it. The
    column is `is_global` and not `global` because `global` is a Python keyword.
    """

    __tablename__ = "playlists"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    name: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Playlists need an account to belong to, so the host session (admin, but nobody) has
    # to log in to create one. The owner is the implicit admin of their own list.
    owner_user_id: Mapped[str] = mapped_column(String(32), index=True)
    is_global: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class PlaylistEntry(Base):
    """One song in one playlist. `position` stays dense (0..n-1) after every mutation."""

    __tablename__ = "playlist_entries"

    playlist_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    song_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    position: Mapped[int] = mapped_column(Integer)


class PlaylistMember(Base):
    """One account the owner shared a playlist with, and how far that reaches.

    `followed` is the member's own switch, not the sharer's: unfollowing hides the list
    from the member's own listing and leaves the access untouched, so the owner does not
    have to grant it again when the member wants it back.
    """

    __tablename__ = "playlist_members"
    __table_args__ = (
        CheckConstraint("access IN ('read', 'write', 'admin')", name="ck_playlist_members_access"),
    )

    playlist_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(32), primary_key=True, index=True)
    access: Mapped[str] = mapped_column(String(8))
    followed: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
