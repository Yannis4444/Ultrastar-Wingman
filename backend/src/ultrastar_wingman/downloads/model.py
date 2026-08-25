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

# Still on its way: the queue owns these, whichever run put them there.
UNFINISHED: tuple[str, ...] = (QUEUED, RUNNING)
# Nothing will happen to these again — the only rows retention may touch.
COMPLETED: tuple[str, ...] = (FINISHED, FAILED)

# What a row that was running when the process died gets as its error.
INTERRUPTED_ERROR = "interrupted by restart"


def _now() -> datetime:
    return datetime.now(UTC)


def as_utc(moment: datetime) -> datetime:
    """SQLite has no timezone type: what went in aware comes back naive. Everything this
    module writes is UTC, so a naive value read back is UTC too."""
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


# When this process took the queue over. The import-time value covers the window before
# `service.start()` runs — nothing may be classified against a `None` here.
_session_start = _now()


def mark_session_start() -> None:
    """Begin a new "this session". Called before the queue reconciles the last run, so the
    rows it fails as interrupted count as news of *this* run."""
    global _session_start
    _session_start = _now()


def session_start() -> datetime:
    return _session_start


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
    # Set when somebody took note of the row: it leaves the panel and becomes prunable.
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    @property
    def current_session(self) -> bool:
        """Whether this run is the one responsible for the row: it is still on its way, or
        it last changed after this run took over. Old history is neither."""
        return self.status in UNFINISHED or as_utc(self.updated_at) >= _session_start
