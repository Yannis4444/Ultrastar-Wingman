"""Statistics read models. FastAPI-free like the other schemas."""

from datetime import datetime

from pydantic import BaseModel

from ..karaoke.schema import ScoreRead
from ..songs.schema import SongRead


class SessionRead(BaseModel):
    """One recorded party. `name` is NULL until somebody names it."""

    id: str
    name: str | None
    started_at: datetime
    last_activity_at: datetime
    sing_count: int
    score_count: int


class SessionList(BaseModel):
    sessions: list[SessionRead]


class ScoreWithContext(ScoreRead):
    """A score plus what it was scored on. `song` is NULL when that song left the library —
    the score itself outlives it (`sings.song_id` is deliberately not a foreign key)."""

    song: SongRead | None
    sing_started_at: datetime


class ScoreList(BaseModel):
    scores: list[ScoreWithContext]


class SingRead(BaseModel):
    """One run of one song. `song` is NULL when that song left the library — the sing
    outlives it (`sings.song_id` is deliberately not a foreign key)."""

    sing_id: str
    song_id: str
    song: SongRead | None
    started_at: datetime


class SingList(BaseModel):
    sings: list[SingRead]
