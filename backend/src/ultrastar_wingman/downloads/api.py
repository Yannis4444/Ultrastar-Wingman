"""Download endpoints. Progress is not polled here — it arrives as `download.updated`."""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..db import SessionDep
from ..sources.base import UnknownSourceError
from . import service
from .model import Download
from .schema import DownloadList, DownloadRead, read_download

logger = logging.getLogger(__name__)

router = APIRouter(tags=["downloads"])

# The history is unbounded; the UI shows the recent ones and nobody scrolls further.
HISTORY_LIMIT = 100


class DownloadCreate(BaseModel):
    source: str
    source_song_id: str
    # Download again although the library already has the song (a broken or better version).
    force: bool = False


@router.get("/downloads", response_model=DownloadList)
async def list_downloads(session: SessionDep) -> DownloadList:
    downloads = await session.scalars(
        select(Download).order_by(Download.id.desc()).limit(HISTORY_LIMIT)
    )
    return DownloadList(downloads=[read_download(row) for row in downloads])


@router.post(
    "/downloads",
    response_model=DownloadRead,
    status_code=202,
    responses={
        404: {"description": "Unknown song source."},
        409: {"description": "Already queued, or already in the library."},
    },
)
async def create_download(body: DownloadCreate, session: SessionDep) -> DownloadRead:
    try:
        row = await service.enqueue(session, body.source, body.source_song_id, body.force)
    except UnknownSourceError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except service.AlreadyQueuedError as error:
        raise HTTPException(status_code=409, detail="already_queued") from error
    except service.AlreadyDownloadedError as error:
        raise HTTPException(status_code=409, detail="already_downloaded") from error
    return read_download(row)
