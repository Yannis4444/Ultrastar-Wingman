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
    # How many different people were scored in it — the third figure of the session
    # picker's meta line ("12 Aug 2026 · 5 singers · 23 scores"). A walk-in counts by the
    # name USDX scored them under, a registered player by their id, so one person who sang
    # both ways is two singers: the name is all Wingman knows about the walk-in half.
    singer_count: int
    # Kept out of the Scores page's party picker (`stats.hide`), and out of nothing else.
    # The stored flag, always — `current` says whether it is in force.
    hidden: bool
    # Whether this is the party being sung right now (`service.current_session`). Reported
    # so a client never has to re-derive `SESSION_GAP`, and because `hidden` is dormant on
    # it: tonight's party is never kept out of the picker.
    current: bool


class SessionList(BaseModel):
    """The parties this caller may open, newest first.

    The two counts are over *every* one of them, hidden ones included, and so are not the
    length and the sum of `sessions` whenever a hidden party dropped out of it. They are
    what the picker's head row says ("3 parties · 60 scores"), and that row stands for
    `GET /stats/scores` — which hiding does not touch, so the figures have to add up to
    what opening it really shows.
    """

    sessions: list[SessionRead]
    session_count: int
    score_count: int


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


class SingDetail(BaseModel):
    """One sing whole: what was sung, when, in which party and what everybody got — the sing
    view. Named apart from `SingRead`, which is the *Recently played* row."""

    sing_id: str
    song_id: str
    # NULL when the song left the library — the sing outlives it (`sings.song_id` is
    # deliberately not a foreign key), exactly as in `ScoreWithContext`.
    song: SongRead | None
    # The song is in the library *and* no tag keeps it back from this caller: whether the
    # view may offer the song itself. The song is not withheld from `song` when this is
    # false — a score list shows it too, the leak `test_tags_api` accepts.
    song_listed: bool
    # The party as the session listing reads it, hidden or not. NULL for a sing recorded
    # before migration 0008, which belongs to no party.
    session: SessionRead | None
    started_at: datetime
    # NULL when Wingman went down mid-song.
    ended_at: datetime | None
    # Every score of the sing, best first (score descending, id ascending), `placement` and
    # `field_size` as they were stored and never recounted.
    scores: list[ScoreWithContext]
