"""Statistics endpoints. Read-only apart from naming a session.

There are no statistics events: the frontend already listens to `scores.recorded` and
`karaoke.ended` and refreshes from these routes when one arrives.
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import require
from ..db import SessionDep
from ..karaoke.model import KaraokeSession
from ..players.model import Player
from ..songs.api import song_or_404
from . import service
from .schema import ScoreList, SessionList, SessionRead, SingList

logger = logging.getLogger(__name__)

router = APIRouter(tags=["stats"])

UNKNOWN_SESSION: dict[int | str, dict[str, Any]] = {404: {"description": "Unknown session."}}


class SessionUpdate(BaseModel):
    """`None` clears the name again."""

    name: str | None


@router.get(
    "/stats/sessions", response_model=SessionList, dependencies=[Depends(require("stats.view"))]
)
async def list_sessions(session: SessionDep) -> SessionList:
    """Every recorded party, newest first."""
    return SessionList(sessions=await service.sessions(session))


@router.get(
    "/stats/sessions/current/sings",
    response_model=SingList,
    dependencies=[Depends(require("stats.view"))],
)
async def list_current_session_sings(session: SessionDep) -> SingList:
    """What the running party has played, newest first, one entry per song — the Songs
    page's "Recently played" tab.

    Never a 404: when the last party is over (nothing sung for `SESSION_GAP`) the list is
    simply empty, which is exactly what the tab has to show. A literal path segment rather
    than a magic `session_id`, so `current` can never collide with a real session id.
    """
    return SingList(sings=await service.current_session_sings(session))


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


@router.get(
    "/stats/sessions/{session_id}/scores",
    response_model=ScoreList,
    dependencies=[Depends(require("stats.view"))],
    responses=UNKNOWN_SESSION,
)
async def list_session_scores(session_id: str, session: SessionDep) -> ScoreList:
    """What was scored during one session, newest first."""
    await _session_or_404(session_id, session)
    return ScoreList(scores=await service.session_scores(session, session_id))


@router.get(
    "/stats/songs/{song_id}/scores",
    response_model=ScoreList,
    dependencies=[Depends(require("stats.view"))],
    responses={404: {"description": "Unknown song."}},
)
async def list_song_scores(song_id: str, session: SessionDep) -> ScoreList:
    """Every score one song ever got, across all sessions, newest first."""
    await song_or_404(song_id, session)
    return ScoreList(scores=await service.song_scores(session, song_id))


@router.get(
    "/stats/players/{player_id}/scores",
    response_model=ScoreList,
    dependencies=[Depends(require("stats.view"))],
    responses={404: {"description": "Unknown player."}},
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
