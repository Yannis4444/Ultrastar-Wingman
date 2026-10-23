"""The `songs` table: Wingman's own view of the library, source of truth for song metadata."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text, text
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
    # Where a preview of the song starts (`txt.SongTxt.preview_start`): `#PREVIEWSTART`, or
    # the first sung word less a lead-in, or NULL for the beginning. Filled by every scan.
    preview_start_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    language: Mapped[str | None] = mapped_column(Text, nullable=True)
    genre: Mapped[str | None] = mapped_column(Text, nullable=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    edition: Mapped[str | None] = mapped_column(Text, nullable=True)
    creator: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Two singers share the song (`songs.txt._is_duet`). Not nullable: the parser answers
    # yes or no for every file, and "unknown" would be a third state nothing can produce —
    # the migration fills the column for the songs scanned before it existed.
    is_duet: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"))
    # The audio file's ReplayGain (`downloads.loudness`): the track gain in dB and the true
    # peak as a linear value, written when Wingman tags the file or finds it tagged, and 0 with
    # no peak for a silent file (`loudness.SILENT_GAIN`: it plays as it is, and the pass over
    # the library does not measure it again). NULL is "not known", never "no gain". A rescan
    # leaves both alone — they are the file's, and
    # reading them takes an ffmpeg run per song — except when the audio file's name changes,
    # which makes them another file's (`scanner._apply_values`).
    replay_gain_db: Mapped[float | None] = mapped_column(Float, nullable=True)
    replay_gain_peak: Mapped[float | None] = mapped_column(Float, nullable=True)
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
