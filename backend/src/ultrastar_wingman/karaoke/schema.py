"""Karaoke read models. FastAPI-free on purpose: the service builds these for the
event bus, and the event bus must not depend on the routing layer."""

from datetime import datetime

from pydantic import BaseModel

from ..auth.model import as_utc
from ..players.schema import PlayerRead
from ..songs.schema import SongRead
from .model import Score


class SlotRead(BaseModel):
    """A singing position of the running song: its color and who is on it."""

    color: str
    player: PlayerRead | None


class CurrentSing(BaseModel):
    sing_id: str
    song: SongRead
    started_at: datetime
    slots: list[SlotRead]


class CurrentSingRead(BaseModel):
    sing: CurrentSing | None


class ScoreRead(BaseModel):
    id: int
    sing_id: str
    player_id: str | None
    player_name: str
    score: int
    difficulty: int | None
    # Where this score came in among the scores of its own sing (`1` is the best, ties share
    # it) and how many scores that sing had. Written when the sing was recorded and never
    # corrected afterwards, so they are what happened that evening and not what the rows say
    # today — see `model.Score`. Both NULL together for a score old enough that migration
    # 0026's backfill could not reach it.
    placement: int | None
    field_size: int | None
    recorded_at: datetime


def read_score(score: Score) -> ScoreRead:
    return ScoreRead(
        id=score.id,
        sing_id=score.sing_id,
        player_id=score.player_id,
        player_name=score.player_name,
        score=score.score,
        difficulty=score.difficulty,
        placement=score.placement,
        field_size=score.field_size,
        # SQLite drops the offset on write, so a score read back is naive. Everything we
        # write is UTC — see `as_utc`.
        recorded_at=as_utc(score.recorded_at),
    )
