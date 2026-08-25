"""Download endpoints. Progress is not polled here — it arrives as `download.updated`."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from ..auth.deps import require
from ..db import SessionDep
from ..sources.base import UnknownSourceError
from . import service
from .model import Download
from .schema import DownloadList, DownloadRead, read_download
from .video_quality import PRESETS

logger = logging.getLogger(__name__)

router = APIRouter(tags=["downloads"])

# The most a panel ever shows; retention keeps the table itself in check.
HISTORY_LIMIT = 100


class DownloadCreate(BaseModel):
    source: str
    source_song_id: str
    # Download again although the library already has the song (a broken or better version).
    force: bool = False


class VideoQualityPresetRead(BaseModel):
    """A ready-made value for `downloads.video_format`, for the settings UI to offer."""

    key: str
    label: str
    description: str
    video_format: str


class VideoQualityPresetList(BaseModel):
    presets: list[VideoQualityPresetRead]


@router.get(
    "/downloads/video-quality",
    response_model=VideoQualityPresetList,
    # Read by the settings UI, so it goes with the settings and not with the queue.
    dependencies=[Depends(require("settings.view"))],
)
async def list_video_quality_presets() -> VideoQualityPresetList:
    """The download quality presets and the yt-dlp format string each one stands for. The
    single source of truth — no client may hardcode a format string."""
    return VideoQualityPresetList(
        presets=[
            VideoQualityPresetRead(
                key=preset.key,
                label=preset.label,
                description=preset.description,
                video_format=preset.video_format,
            )
            for preset in PRESETS
        ]
    )


@router.get(
    "/downloads", response_model=DownloadList, dependencies=[Depends(require("downloads.view"))]
)
async def list_downloads(session: SessionDep) -> DownloadList:
    """The queue and the recent history. Dismissed rows are gone from here: taking note of
    one is what empties the panel — the row itself lives on until retention drops it."""
    downloads = await session.scalars(
        select(Download)
        .where(Download.dismissed_at.is_(None))
        .order_by(Download.id.desc())
        .limit(HISTORY_LIMIT)
    )
    return DownloadList(downloads=[read_download(row) for row in downloads])


@router.post(
    "/downloads",
    response_model=DownloadRead,
    status_code=202,
    dependencies=[Depends(require("downloads.manage"))],
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


@router.post(
    "/downloads/dismiss-finished",
    response_model=DownloadList,
    dependencies=[Depends(require("downloads.manage"))],
)
async def dismiss_finished_downloads(session: SessionDep) -> DownloadList:
    """Clear the successes in one go. Failures stay: only their owner's explicit dismiss
    takes an error off the screen."""
    rows = await service.dismiss_finished(session)
    return DownloadList(downloads=[read_download(row) for row in rows])


@router.post(
    "/downloads/{download_id}/dismiss",
    response_model=DownloadRead,
    dependencies=[Depends(require("downloads.manage"))],
    responses={
        404: {"description": "No such download."},
        409: {"description": "The download is still queued or running."},
    },
)
async def dismiss_download(download_id: int, session: SessionDep) -> DownloadRead:
    """Mark one finished or failed download as read, taking it out of the panel."""
    try:
        row = await service.dismiss(session, download_id)
    except service.DownloadNotFoundError as error:
        raise HTTPException(status_code=404, detail="unknown_download") from error
    except service.DownloadStillRunningError as error:
        raise HTTPException(status_code=409, detail="still_running") from error
    return read_download(row)
