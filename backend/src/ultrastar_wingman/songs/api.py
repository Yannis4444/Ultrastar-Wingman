"""Song endpoints: the library as the frontend and external clients see it."""

import logging
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import require
from ..db import SessionDep
from . import scanner
from .model import Song
from .schema import SongList, SongRead, read_song

logger = logging.getLogger(__name__)

router = APIRouter(tags=["songs"])


class ScanStatus(BaseModel):
    status: Literal["started", "running"]


@router.get("/songs", response_model=SongList, dependencies=[Depends(require("songs.view"))])
async def list_songs(session: SessionDep) -> SongList:
    # Case-insensitive so "abba" and "ABBA" sort together; the id breaks ties between
    # two copies of the same song so the order is stable across requests.
    songs = await session.scalars(
        select(Song).order_by(func.lower(Song.artist), func.lower(Song.title), Song.id)
    )
    return SongList(songs=[read_song(song) for song in songs])


@router.post(
    "/songs/rescan",
    response_model=ScanStatus,
    status_code=202,
    dependencies=[Depends(require("songs.rescan"))],
    responses={409: {"model": ScanStatus, "description": "A scan is already running."}},
)
async def rescan_songs(request: Request, response: Response) -> ScanStatus:
    """Start a library scan. 409 while one is still running; progress arrives as
    `songs.scan_started` / `songs.scan_finished` websocket events."""
    if scanner.start_scan(request.app.state.session_factory):
        return ScanStatus(status="started")
    response.status_code = 409
    return ScanStatus(status="running")


@router.get(
    "/songs/{song_id}",
    response_model=SongRead,
    dependencies=[Depends(require("songs.view"))],
)
async def get_song(song_id: str, session: SessionDep) -> SongRead:
    return read_song(await _song(song_id, session))


@router.get(
    "/songs/{song_id}/cover",
    response_class=FileResponse,
    dependencies=[Depends(require("songs.view"))],
    responses={200: {"content": {"image/*": {}}, "description": "The cover image file."}},
)
async def get_song_cover(song_id: str, session: SessionDep) -> FileResponse:
    song = await _song(song_id, session)
    cover = None if song.cover_file is None else Path(song.cover_file)
    if cover is None or not cover.is_file():
        raise HTTPException(status_code=404, detail=f"song '{song_id}' has no cover")
    return FileResponse(cover)


async def _song(song_id: str, session: AsyncSession) -> Song:
    song = await session.get(Song, song_id)
    if song is None:
        raise HTTPException(status_code=404, detail=f"unknown song '{song_id}'")
    return song
