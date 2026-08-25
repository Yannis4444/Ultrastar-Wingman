"""The `songs` table: Wingman's own view of the library, source of truth for song metadata."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base

USDB_SOURCE = "usdb"
LOCAL_SOURCE = "local"


def _now() -> datetime:
    return datetime.now(UTC)


class Song(Base):
    """One song directory. File columns hold absolute paths — songs may live outside the
    USDX songs dir (see `songs.additional_directories`)."""

    __tablename__ = "songs"

    # "<source>:<source_id>": "usdb:1234" or "local:<uuid4 hex>". Stable across rescans.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    source: Mapped[str] = mapped_column(String(32))
    source_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str] = mapped_column(Text)
    artist: Mapped[str] = mapped_column(Text)
    # Content identity (normalized artist + title), for "same song from another source".
    fingerprint: Mapped[str] = mapped_column(String(512), index=True)
    directory: Mapped[str] = mapped_column(Text, unique=True)
    txt_file: Mapped[str] = mapped_column(Text)
    cover_file: Mapped[str | None] = mapped_column(Text, nullable=True)
    audio_file: Mapped[str | None] = mapped_column(Text, nullable=True)
    video_file: Mapped[str | None] = mapped_column(Text, nullable=True)
    # How long USDX plays the song, not how long the audio file is: `#START` and `#END`
    # are already applied (see `scanner.played_seconds`).
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    language: Mapped[str | None] = mapped_column(Text, nullable=True)
    genre: Mapped[str | None] = mapped_column(Text, nullable=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    edition: Mapped[str | None] = mapped_column(Text, nullable=True)
    creator: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )


def song_id(usdb_id: int | None) -> str:
    """`usdb:<n>` when the source is known, `local:<uuid4>` otherwise. The old app used
    `id or f"USDB-{usdb_id}" or uuid4().hex` — an always-truthy f-string, so every song
    without a USDB id collided on the literal id "USDB-None"."""
    if usdb_id is None:
        return f"{LOCAL_SOURCE}:{uuid.uuid4().hex}"
    return f"{USDB_SOURCE}:{usdb_id}"
