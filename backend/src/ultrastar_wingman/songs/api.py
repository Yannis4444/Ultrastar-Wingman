"""Song endpoints: the library as the frontend and external clients see it."""

import logging
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import HiddenSongsDep, require
from ..db import SessionDep
from . import scanner, service
from .model import Song
from .schema import SongEdit, SongList, SongRead, read_song

logger = logging.getLogger(__name__)

router = APIRouter(tags=["songs"])


class ScanStatus(BaseModel):
    status: Literal["started", "running"]


@router.get("/songs", response_model=SongList, dependencies=[Depends(require("songs.view"))])
async def list_songs(session: SessionDep, hidden: HiddenSongsDep) -> SongList:
    # Case-insensitive so "abba" and "ABBA" sort together; the id breaks ties between
    # two copies of the same song so the order is stable across requests.
    songs = await session.scalars(
        select(Song).order_by(func.lower(Song.artist), func.lower(Song.title), Song.id)
    )
    # Songs carrying a tag this caller holds no `view_songs` on are not theirs to see —
    # filtered here rather than in SQL so every route uses the one set the dependency built.
    return SongList(songs=[read_song(song) for song in songs if song.id not in hidden])


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
async def get_song(song_id: str, session: SessionDep, hidden: HiddenSongsDep) -> SongRead:
    return read_song(await song_or_404(song_id, session, hidden))


@router.patch(
    "/songs/{song_id}",
    response_model=SongRead,
    dependencies=[Depends(require("songs.edit"))],
    responses={
        409: {"description": "The file moved on, is unreadable, or could not be written."},
        422: {"description": "A value is empty, or cannot be written in the file's encoding."},
    },
)
async def edit_song(
    song_id: str, edit: SongEdit, session: SessionDep, hidden: HiddenSongsDep
) -> SongRead:
    """Correct a song's metadata. The values go into the song's `.txt` — the file USDX reads
    and the next library scan re-imports — and the row is then refreshed from it.

    `expected` is the metadata the editor was opened on. 409 `song_file_changed` when the
    file says something else by now (the song was downloaded again, or edited by hand):
    saving over that would put the older values back.
    """
    song = await song_or_404(song_id, session, hidden)
    try:
        edited = await service.edit_song(session, song, edit.values, edit.expected)
    except service.SongGoneError as error:
        raise HTTPException(status_code=404, detail=f"unknown song '{song_id}'") from error
    except service.SongChangedError as error:
        raise HTTPException(status_code=409, detail="song_file_changed") from error
    except service.SongTxtMissingError as error:
        raise HTTPException(status_code=409, detail="song_txt_missing") from error
    except service.SongTxtUnreadableError as error:
        logger.warning("editing song '%s' failed: %s", song_id, error)
        raise HTTPException(status_code=409, detail="song_txt_unreadable") from error
    except service.SongTxtWriteError as error:
        logger.warning("editing song '%s' failed: %s", song_id, error)
        raise HTTPException(status_code=409, detail="song_files_in_use") from error
    except service.UnwritableValueError as error:
        raise HTTPException(status_code=422, detail="value_not_encodable") from error
    return read_song(edited)


@router.delete(
    "/songs/{song_id}",
    status_code=204,
    dependencies=[Depends(require("songs.delete"))],
    responses={409: {"description": "The song is playing, or its files could not be removed."}},
)
async def delete_song(song_id: str, session: SessionDep, hidden: HiddenSongsDep) -> None:
    """Delete a song from the library, its folder on disk included. Admin-only by default.

    409 while that very song is playing, and 409 when the folder cannot be removed — a file
    still open in another program, which is what Windows says to a running USDX. Nothing is
    deleted in either case.
    """
    song = await song_or_404(song_id, session, hidden)
    try:
        await service.delete_song(session, song)
    except service.SongGoneError as error:
        # Somebody else deleted it while this request waited for the scanner's lock, so it
        # answers what it would have answered a moment earlier.
        raise HTTPException(status_code=404, detail=f"unknown song '{song_id}'") from error
    except service.SongIsPlayingError as error:
        raise HTTPException(status_code=409, detail="song_is_playing") from error
    except service.LibraryRootError as error:
        raise HTTPException(status_code=409, detail="song_directory_is_a_library_root") from error
    except service.SongFilesError as error:
        logger.warning("deleting song '%s' failed: %s", song_id, error)
        raise HTTPException(status_code=409, detail="song_files_in_use") from error


@router.get(
    "/songs/{song_id}/cover",
    response_class=FileResponse,
    dependencies=[Depends(require("songs.view"))],
    responses={200: {"content": {"image/*": {}}, "description": "The cover image file."}},
)
async def get_song_cover(song_id: str, session: SessionDep, hidden: HiddenSongsDep) -> FileResponse:
    song = await song_or_404(song_id, session, hidden)
    cover = None if song.cover_file is None else Path(song.cover_file)
    if cover is None or not cover.is_file():
        raise HTTPException(status_code=404, detail=f"song '{song_id}' has no cover")
    return FileResponse(cover)


@router.get(
    "/songs/{song_id}/audio",
    response_class=FileResponse,
    dependencies=[Depends(require("songs.view"))],
    responses={200: {"content": {"audio/*": {}}, "description": "The audio file."}},
)
async def get_song_audio(song_id: str, session: SessionDep, hidden: HiddenSongsDep) -> FileResponse:
    """The song's audio file, for the preview player in the song details."""
    song = await song_or_404(song_id, session, hidden)
    audio = None if song.audio_file is None else Path(song.audio_file)
    if audio is None or not audio.is_file():
        raise HTTPException(status_code=404, detail=f"song '{song_id}' has no audio")
    return FileResponse(audio)


async def song_or_404(song_id: str, session: AsyncSession, hidden: frozenset[str]) -> Song:
    """The song, or a 404. Shared with the wishlist, favorites, playlist, statistics,
    karaoke and tag routes: every one of them has to reject an id that is not in the
    library.

    `hidden` (`auth.deps.HiddenSongsDep`) is what a tag's `view_songs` keeps back. Such a
    song answers exactly like one that was never there — a 403 would confirm it exists.
    """
    song = await session.get(Song, song_id)
    if song is None or song_id in hidden:
        raise HTTPException(status_code=404, detail=f"unknown song '{song_id}'")
    return song
