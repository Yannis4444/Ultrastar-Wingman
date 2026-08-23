"""Song read models. Separate from `api.py` so modules that must not import FastAPI
(the karaoke service, the event bus) can still speak in song payloads."""

from pydantic import BaseModel

from .model import Song


class SongRead(BaseModel):
    id: str
    source: str
    title: str
    artist: str
    duration_seconds: int | None
    has_video: bool
    language: str | None
    genre: str | None
    year: int | None
    edition: str | None
    creator: str | None


class SongList(BaseModel):
    songs: list[SongRead]


def read_song(song: Song) -> SongRead:
    return SongRead(
        id=song.id,
        source=song.source,
        title=song.title,
        artist=song.artist,
        duration_seconds=song.duration_seconds,
        # File paths stay server-side; the UI only needs to know a video exists.
        has_video=song.video_file is not None,
        language=song.language,
        genre=song.genre,
        year=song.year,
        edition=song.edition,
        creator=song.creator,
    )
