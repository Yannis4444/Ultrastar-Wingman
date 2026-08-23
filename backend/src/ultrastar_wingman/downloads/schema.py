"""Download read models. FastAPI-free: the event bus speaks in these too."""

from datetime import datetime

from pydantic import BaseModel

from .model import Download


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
        created_at=download.created_at,
        updated_at=download.updated_at,
    )
