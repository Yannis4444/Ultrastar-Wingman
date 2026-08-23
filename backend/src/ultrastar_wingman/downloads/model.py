"""The `downloads` table: queue state that survives a restart.

The old app kept its download queue in memory, so a restart silently forgot what was
still to fetch and left half-finished jobs looking active forever.
"""

from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base

DownloadStatus = Literal["queued", "running", "finished", "failed"]

QUEUED: DownloadStatus = "queued"
RUNNING: DownloadStatus = "running"
FINISHED: DownloadStatus = "finished"
FAILED: DownloadStatus = "failed"

# What a row that was running when the process died gets as its error.
INTERRUPTED_ERROR = "interrupted by restart"


def _now() -> datetime:
    return datetime.now(UTC)


class Download(Base):
    """One queued or past download. `song_id` is filled once the finished song is in the
    library; `title`/`artist` are only labels for the UI and may be unknown up front."""

    __tablename__ = "downloads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(32))
    source_song_id: Mapped[str] = mapped_column(String(64))
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    artist: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), index=True)
    progress: Mapped[float | None] = mapped_column(Float, nullable=True)
    step: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Not a foreign key: a download stays in the history after its song was deleted.
    song_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )
