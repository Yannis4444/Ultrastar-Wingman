"""Karaoke read models. FastAPI-free on purpose: the service builds these for the
event bus, and the event bus must not depend on the routing layer."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from ..auth.model import as_utc
from ..players.schema import PlayerRead
from ..songs.schema import SongRead
from .model import Score

# What the reel may pick a song out of. The phone's Random song page offers the first four
# and its playlist reel the fifth; the player selector's start button is limited to the ones
# that need no account (`devices.settings.RANDOM_SCOPES`).
Scope = Literal["all", "favorites", "wishlist", "weighted", "playlist"]


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


class SelectionSlotRead(BaseModel):
    """A singing position of the open player selection: its color, who stands on it, and
    the card lying on its reader.

    `card_uid` without a `player` is a card Wingman does not know — somebody put a tag on
    the selector that belongs to nobody, and the slot says so instead of staying empty.
    """

    color: str
    player: PlayerRead | None
    card_uid: str | None


class SpinRead(BaseModel):
    """The reel that picked the selection's song, for a selection the server spun.

    `id` is 1 on opening and one more on every respin: the host screen animates a new spin
    on a new id and nothing else, and `spun_at` is when it started — the phone reveals the
    song when the reel on the TV lands, a fixed few seconds after that. Whose hidden tags and
    hearts the pick was made with is not in here; that stays with the selection.
    """

    id: int
    spun_at: datetime
    scope: Scope
    playlist_id: str | None


class SelectionRead(BaseModel):
    """Who is about to sing what, while the song is being set up.

    The opener's token is not in here: this is what the host screen and every other phone
    get, and whoever holds the token is the only one who may move the slots.
    """

    song: SongRead
    slots: list[SelectionSlotRead]
    opened_at: datetime
    updated_at: datetime
    # When the player selector will start the song by itself, while such a countdown is
    # running. None whenever there is none.
    auto_start_at: datetime | None
    # The reel, for a selection whose song the server picked. None for one opened with a
    # song. Defaulted so the generated client keeps the field optional: a selection built by
    # hand (the frontend's tests) predates the spin and is still a selection.
    spin: SpinRead | None = None


class SelectionOpened(BaseModel):
    """The answer to opening a selection: the selection, plus the token that owns it. The
    only time that token is readable."""

    selection: SelectionRead
    token: str


class CurrentSelectionRead(BaseModel):
    selection: SelectionRead | None


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
