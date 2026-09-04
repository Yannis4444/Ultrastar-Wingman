"""Statistics endpoints. Read-only apart from naming a session, keeping one out of the party
picker, and the two corrections `stats.moderate` may make to a recorded score.

The read routes fire no events: the frontend already listens to `scores.recorded` and
`karaoke.ended` and refreshes from these routes when one arrives. The two moderation routes
broadcast `scores.changed` (see `events.py`), because nothing else tells the other screens
in the room that a score just moved, and hiding a party broadcasts `sessions.changed` for
the same reason.
"""

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import HiddenSongsDep, Principal, PrincipalDep, missing_permission, require
from ..db import SessionDep
from ..karaoke.model import KaraokeSession, Score
from ..karaoke.schema import ScoreRead
from ..players import service as players
from ..players.model import Player
from ..songs.api import song_or_404
from . import service
from .schema import ScoreList, SessionList, SessionRead, SingList

logger = logging.getLogger(__name__)

router = APIRouter(tags=["stats"])

UNKNOWN_SESSION: dict[int | str, dict[str, Any]] = {404: {"description": "Unknown session."}}
UNKNOWN_SCORE: dict[int | str, dict[str, Any]] = {404: {"description": "Unknown score."}}


class SessionUpdate(BaseModel):
    """`None` clears the name again."""

    name: str | None


class SessionVisibility(BaseModel):
    """Whether this party is kept out of the Scores page's party picker."""

    hidden: bool


class ScoreUpdate(BaseModel):
    """Who really sang it. Neither the number nor the song is editable: USDX awarded that
    score for that song, and the only thing Wingman can get wrong is which player was on the
    microphone."""

    player_id: str


async def visible_session_ids(session: SessionDep, principal: PrincipalDep) -> frozenset[str]:
    """The parties this caller may open — `None` in spirit for a `stats.history` holder,
    who may open every one; see `may_see_every_session` below.

    Three ways in, in order of how much they say about the caller:

    * the party that is still going is `stats.view`, which even an anonymous phone holds —
      tonight's scoreboard is what the Scores page is opened for at a party;
    * a party the caller sang in themselves, which is identity rather than a capability:
      the same reasoning as "your own scores" on the user page. The link is a score row
      carrying their player id (`service.sessions_of_player`), so it needs an account that
      is linked to a player — a guest phone has no identity at all and gets tonight alone;
    * every party ever, which is `stats.history`.
    """
    ids: set[str] = set()
    current = await service.current_session(session)
    if current is not None:
        ids.add(current.id)
    player_id = (
        None
        if principal.user is None
        else await players.player_id_of_user(session, principal.user.id)
    )
    if player_id is not None:
        ids |= await service.sessions_of_player(session, player_id)
    return frozenset(ids)


VisibleSessionsDep = Annotated[frozenset[str], Depends(visible_session_ids)]


def may_see_every_session(principal: Principal) -> bool:
    return "stats.history" in principal.capabilities


@router.get(
    "/stats/sessions", response_model=SessionList, dependencies=[Depends(require("stats.view"))]
)
async def list_sessions(
    session: SessionDep,
    principal: PrincipalDep,
    visible: VisibleSessionsDep,
    include_hidden: bool = Query(
        default=False,
        description=(
            "List the parties kept out of the picker as well. Honoured only for a caller "
            "who holds `stats.hide`; everybody else gets the default list whatever they ask."
        ),
    ),
) -> SessionList:
    """Every recorded party, newest first — or, without `stats.history`, the one still going
    plus the ones this caller sang in.

    A short list rather than a 403: tonight's scoreboard is what a guest phone opens the
    Scores page for, and the page keeps working with a session picker of one. The list holds
    exactly the parties the caller may open, so it never names one only to say no to it.

    A party somebody kept out of the picker (`stats.hide`) drops out of `sessions` here, and
    **out of nothing else**: `GET /stats/scores` still adds it up, `visible_session_ids`
    still opens it, a singer's own scores and a song's best scores still hold it, and the
    achievements pass never saw this flag at all. The party being sung is never dropped,
    whatever the flag says — a phone at that party would otherwise be left with an empty
    page — which is the same rule that stops it from being hidden in the first place.

    `include_hidden` asks for the hidden ones too, and is honoured only for a caller who
    holds `stats.hide`; anybody else gets the default list whatever they ask, without a 403,
    the same way this route already answers a short list instead of refusing.

    `session_count` and `score_count` count every party this caller may open, hidden ones
    included, because they are what the picker's head row says and that row stands for
    `GET /stats/scores` — which hiding does not touch.
    """
    rows = await service.sessions(session)
    if not may_see_every_session(principal):
        rows = [row for row in rows if row.id in visible]
    # Counted before the hidden ones drop out, and never again after: these two are the
    # head row, and the head row is `GET /stats/scores`.
    session_count = len(rows)
    score_count = sum(row.score_count for row in rows)
    if not (include_hidden and "stats.hide" in principal.capabilities):
        rows = [row for row in rows if row.current or not row.hidden]
    return SessionList(sessions=rows, session_count=session_count, score_count=score_count)


@router.get(
    "/stats/sessions/current/sings",
    response_model=SingList,
    dependencies=[Depends(require("stats.view"))],
)
async def list_current_session_sings(session: SessionDep, hidden: HiddenSongsDep) -> SingList:
    """What the running party has played, newest first, one entry per song — the Songs
    page's "Recently played" tab.

    Never a 404: when the last party is over (nothing sung for `SESSION_GAP`) the list is
    simply empty, which is exactly what the tab has to show. A literal path segment rather
    than a magic `session_id`, so `current` can never collide with a real session id.

    A sing of a song a tag keeps back from this caller drops out whole — this is a song
    list a stranger browses (the Recent tab of the Songs page), so it has to hide the same
    songs `GET /songs` does. Filtered here rather than in the service, which stays
    principal-free, and in Python rather than in SQL so every route uses the one set the
    dependency built — the same shape as `songs.api.list_songs`. The score lists below are
    deliberately *not* filtered: a score belongs to its singer (see
    `test_tags_api.test_the_leaks_we_accept`).
    """
    sings = await service.current_session_sings(session)
    return SingList(sings=[sing for sing in sings if sing.song_id not in hidden])


@router.patch(
    "/stats/sessions/{session_id}",
    response_model=SessionRead,
    dependencies=[Depends(require("stats.manage"))],
    responses=UNKNOWN_SESSION,
)
async def rename_session(session_id: str, body: SessionUpdate, session: SessionDep) -> SessionRead:
    """Name a session ("Yannis' birthday"). Sessions are recorded rows, so the name sticks
    to the same party forever."""
    return await service.rename_session(
        session, await _session_or_404(session_id, session), body.name
    )


@router.put(
    "/stats/sessions/{session_id}/hidden",
    response_model=SessionRead,
    dependencies=[Depends(require("stats.hide"))],
    responses={
        **UNKNOWN_SESSION,
        409: {"description": "The party being sung cannot be hidden."},
    },
)
async def set_session_hidden(
    session_id: str, body: SessionVisibility, session: SessionDep
) -> SessionRead:
    """Keep a party out of the Scores page's party picker, or put it back.

    Its own route under its own capability rather than a second field on `PATCH
    /stats/sessions/{id}`: naming a party is `stats.manage`, which the party's helpers hold,
    and deciding which evenings the room still gets to look at is not the same right. One
    route, one capability, so a holder of the one can never reach the other.

    **Hiding changes what that one list holds and nothing else.** Every score of the party
    stays exactly where it was: in `GET /stats/scores`, in the singer's own record, in a
    song's best scores, in what a reader may open, and in what an achievement is worked out
    from. Nobody's badge and nobody's best score moves because a list was tidied.

    Hiding the party being sung is a 409: the evening in progress is what the Scores page is
    for. Putting it back is always allowed, so a flag set before the room sang into that
    party again has a way out.
    """
    try:
        return await service.set_session_hidden(
            session, await _session_or_404(session_id, session), body.hidden
        )
    except service.SessionRunningError as error:
        raise HTTPException(
            status_code=409, detail=f"session '{error.session_id}' is the party being sung"
        ) from error


async def readable_session(
    session_id: str, principal: PrincipalDep, visible: VisibleSessionsDep
) -> None:
    """A party the caller may open: the one still going, one they sang in themselves, or —
    with `stats.history` — any of them. Checked before the session is looked up, so which
    parties were ever recorded stays out of reach as well."""
    if not may_see_every_session(principal) and session_id not in visible:
        raise missing_permission("stats.history")


@router.get(
    "/stats/scores",
    response_model=ScoreList,
    dependencies=[Depends(require("stats.view"))],
)
async def list_all_scores(
    session: SessionDep, principal: PrincipalDep, visible: VisibleSessionsDep
) -> ScoreList:
    """Every score of every party this caller may open, newest first — the session picker's
    head row ("All parties", or "All my scores" for a reader without `stats.history`).

    Its own route rather than a reserved session id: it pairs with the two `/stats/scores/…`
    corrections below, and a route that answers "every party at once" is not a party — it
    has no name, no date and nothing to rename.

    What it holds is exactly the parties above it added up: a sing that belongs to no party
    (`sings.session_id` is NULL, which only rows older than migration 0008 are) is in no
    session listing and is left out here too, or the head row would not agree with the
    sessions it claims to sum.

    Not filtered by `HiddenSongsDep`, deliberately and like every other score list: a score
    belongs to its singer, and dropping rows per reader would make two people at the same
    party disagree about the same scoreboard (`test_tags_api.test_the_leaks_we_accept`).
    """
    return ScoreList(
        scores=await service.all_scores(
            session, None if may_see_every_session(principal) else visible
        )
    )


@router.patch(
    "/stats/scores/{score_id}",
    response_model=ScoreRead,
    dependencies=[Depends(require("stats.moderate"))],
    responses={404: {"description": "Unknown score or player."}},
)
async def reassign_score(score_id: int, body: ScoreUpdate, session: SessionDep) -> ScoreRead:
    """Put a score on the singer it belongs to — the fix for a wrongly picked player.

    The sing, its session and the number itself are untouched, and so are the `placement`
    and `field_size` of every score of that sing — by design: the numbers did not move, only
    the name on one of them, so the score that came first still came first.

    Nothing stops two scores of the same sing from ending up on one player: swapping the two
    singers of a duet goes through that state on its way, and a rule against it would block
    the very correction this route exists for.
    """
    score = await _score_or_404(score_id, session)
    player = await session.get(Player, body.player_id)
    if player is None:
        raise HTTPException(status_code=404, detail=f"unknown player '{body.player_id}'")
    return await service.reassign_score(session, score, player)


@router.delete(
    "/stats/scores/{score_id}",
    status_code=204,
    dependencies=[Depends(require("stats.moderate"))],
    responses=UNKNOWN_SCORE,
)
async def delete_score(score_id: int, session: SessionDep) -> None:
    """Take one score off the record. The sing it belonged to stays, even when it was the
    last score on it — the song *was* played, and that is what the Recent tab and a party's
    `sing_count` are counted from.

    The `placement` and `field_size` of the scores that remain stay as they were, by design:
    they record the field the song was actually sung against, and that is exactly what is no
    longer reconstructible once this row is gone."""
    await service.delete_score(session, await _score_or_404(score_id, session))


@router.get(
    "/stats/sessions/{session_id}/scores",
    response_model=ScoreList,
    dependencies=[Depends(require("stats.view")), Depends(readable_session)],
    responses={
        **UNKNOWN_SESSION,
        403: {"description": "A party this caller was not at, without history."},
    },
)
async def list_session_scores(session_id: str, session: SessionDep) -> ScoreList:
    """What was scored during one session, newest first."""
    await _session_or_404(session_id, session)
    return ScoreList(scores=await service.session_scores(session, session_id))


@router.get(
    "/stats/songs/{song_id}/scores",
    response_model=ScoreList,
    # Every score a song ever got reaches back over every party, so it is the archive.
    dependencies=[Depends(require("stats.history"))],
    responses={404: {"description": "Unknown song."}},
)
async def list_song_scores(song_id: str, session: SessionDep, hidden: HiddenSongsDep) -> ScoreList:
    """Every score one song ever got, across all sessions, newest first."""
    await song_or_404(song_id, session, hidden)
    return ScoreList(scores=await service.song_scores(session, song_id))


async def own_player_or_history_right(
    player_id: str, session: SessionDep, principal: PrincipalDep
) -> None:
    """Your own totals are identity, not a capability: they are what "Your scores" shows
    whoever is logged in, and taking `stats.history` away must not empty that page.
    Everybody else's history is the archive. Checked before the player is looked up."""
    own = (
        None
        if principal.user is None
        else await players.player_id_of_user(session, principal.user.id)
    )
    if own != player_id:
        principal.require("stats.history")


@router.get(
    "/stats/players/{player_id}/scores",
    response_model=ScoreList,
    dependencies=[Depends(require("stats.view")), Depends(own_player_or_history_right)],
    responses={
        403: {"description": "Somebody else's history, without `stats.history`."},
        404: {"description": "Unknown player."},
    },
)
async def list_player_scores(player_id: str, session: SessionDep) -> ScoreList:
    """Every score one player ever got, across all sessions, newest first — what the user
    page turns into their totals."""
    if await session.get(Player, player_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown player '{player_id}'")
    return ScoreList(scores=await service.player_scores(session, player_id))


@router.get(
    "/stats/latest", response_model=ScoreList, dependencies=[Depends(require("stats.view"))]
)
async def list_latest_scores(
    session: SessionDep, limit: int = Query(default=10, ge=1, le=200)
) -> ScoreList:
    """The most recent scores across everything — the home page's scoreboard."""
    return ScoreList(scores=await service.latest_scores(session, limit))


async def _session_or_404(session_id: str, session: AsyncSession) -> KaraokeSession:
    karaoke_session = await session.get(KaraokeSession, session_id)
    if karaoke_session is None:
        raise HTTPException(status_code=404, detail=f"unknown session '{session_id}'")
    return karaoke_session


async def _score_or_404(score_id: int, session: AsyncSession) -> Score:
    score = await session.get(Score, score_id)
    if score is None:
        raise HTTPException(status_code=404, detail=f"unknown score '{score_id}'")
    return score
