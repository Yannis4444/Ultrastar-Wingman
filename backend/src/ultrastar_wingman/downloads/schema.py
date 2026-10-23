"""Download read models. FastAPI-free: the event bus speaks in these too."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from .model import Download

# What the pass over the library is doing (`loudness_pass`): nothing, working through the
# songs, or finishing the song in hand after a stop.
LoudnessPassState = Literal["idle", "running", "stopping"]
# How the last pass ended: every song visited, stopped by the host, or never started (no
# ffmpeg, or the songs could not be listed: `error` says which).
LoudnessPassEnd = Literal["finished", "stopped", "failed"]


class LoudnessCounts(BaseModel):
    """How many songs of the pass ended in each `loudness.Outcome` status. A song counts
    once, by its last try: a file in use is tried again at the end of the pass."""

    tagged: int
    already_tagged: int
    unsupported: int
    silent: int
    missing: int
    in_use: int
    failed: int


class LoudnessPassRead(BaseModel):
    """The pass over the library, as `loudness.changed` carries it to every socket: no
    song, because a song a tag hides from guests must not ride the anonymous socket (the
    music's `GUEST_VIEWER` rule). `GET /downloads/loudness` adds it (`LoudnessPassStatus`).

    `total` is the songs the pass set out to visit, `done` the ones it has finished — a
    song tried again at the end counts only then. `waiting` is true while the pass holds
    still for a song being sung or Ultrastar Deluxe standing open. `ended` and `error` are
    about the last pass, and stay until the next one starts: a restart forgets them."""

    state: LoudnessPassState
    waiting: bool
    total: int
    done: int
    counts: LoudnessCounts
    ended: LoudnessPassEnd | None
    error: str | None


class LoudnessSongRead(BaseModel):
    id: str
    title: str
    artist: str


class LoudnessPassStatus(LoudnessPassRead):
    """`LoudnessPassRead` and the song in hand, for the one reader allowed to see it."""

    song: LoudnessSongRead | None


class DownloadRead(BaseModel):
    id: int
    source: str
    source_song_id: str
    title: str | None
    artist: str | None
    status: str
    progress: float | None
    step: str | None
    error: str | None
    song_id: str | None
    # Computed, not stored: "this session" is a question about the running process, so the
    # answer has to be produced when the row is read, not when it was written.
    current_session: bool
    dismissed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class DownloadList(BaseModel):
    downloads: list[DownloadRead]


def read_download(download: Download) -> DownloadRead:
    return DownloadRead(
        id=download.id,
        source=download.source,
        source_song_id=download.source_song_id,
        title=download.title,
        artist=download.artist,
        status=download.status,
        progress=download.progress,
        step=download.step,
        error=download.error,
        song_id=download.song_id,
        current_session=download.current_session,
        dismissed_at=download.dismissed_at,
        created_at=download.created_at,
        updated_at=download.updated_at,
    )
