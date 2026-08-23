"""The download queue: rows in, songs in the library out.

Persisted first, queued second — the row is the source of truth, so a restart can say
what was pending (re-queued) and what was interrupted (failed, with a reason). Knows
nothing about FastAPI; the API layer turns these exceptions into status codes.
"""

import asyncio
import contextlib
import logging
import tempfile
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..events import DownloadUpdated, event_bus
from ..settings import SettingsService
from ..songs.model import Song
from ..songs.scanner import scan_song_directory
from ..sources.base import DownloadError, SongSource, get_source
from .model import FAILED, FINISHED, INTERRUPTED_ERROR, QUEUED, RUNNING, Download
from .schema import read_download

logger = logging.getLogger(__name__)

PARALLEL_SETTING = "downloads.parallel"

# Anything smaller is noise on the wire: a 200 MB video produces thousands of lines.
PROGRESS_STEP = 1.0

_UNFINISHED = (QUEUED, RUNNING)

# Module state: there is one queue per Wingman process, started by the app lifespan.
_queue: asyncio.Queue[int] | None = None
_workers: list[asyncio.Task[None]] = []


class AlreadyQueuedError(RuntimeError):
    def __init__(self, source: str, source_song_id: str) -> None:
        super().__init__(f"'{source}:{source_song_id}' is already queued")
        self.source = source
        self.source_song_id = source_song_id


class AlreadyDownloadedError(RuntimeError):
    def __init__(self, song_id: str) -> None:
        super().__init__(f"song '{song_id}' is already in the library")
        self.song_id = song_id


async def start(session_factory: async_sessionmaker[AsyncSession]) -> None:
    """Reconcile what the last run left behind, then bring the workers up."""
    global _queue
    if _queue is not None:
        return
    queue: asyncio.Queue[int] = asyncio.Queue()
    for download_id in await _reconcile(session_factory):
        queue.put_nowait(download_id)
    _queue = queue
    parallel = await _parallel(session_factory)
    _workers.extend(
        asyncio.create_task(_worker(session_factory, queue), name=f"download-worker-{number}")
        for number in range(parallel)
    )
    logger.info("download queue started with %d worker(s)", parallel)


async def stop() -> None:
    """Cancel the workers so none of them outlives the database engine."""
    global _queue
    _queue = None
    workers, _workers[:] = list(_workers), []
    for worker in workers:
        worker.cancel()
    for worker in workers:
        with contextlib.suppress(asyncio.CancelledError):
            await worker


async def wait_for_idle() -> None:
    """Wait until every queued download has been processed. Used by the tests — the API
    reports progress through `download.updated` events."""
    if _queue is not None:
        await _queue.join()


async def enqueue(
    session: AsyncSession, source: str, source_song_id: str, force: bool = False
) -> Download:
    """Queue a download. Raises `UnknownSourceError`, `AlreadyQueuedError`, or
    `AlreadyDownloadedError` (unless `force`) — a duplicate download would produce a
    second copy of a song we already have."""
    song_source = get_source(source)
    unfinished = (
        await session.scalars(
            select(Download).where(
                Download.source == source,
                Download.source_song_id == source_song_id,
                Download.status.in_(_UNFINISHED),
            )
        )
    ).first()
    if unfinished is not None:
        raise AlreadyQueuedError(source, source_song_id)
    existing_song_id = f"{song_source.source}:{source_song_id}"
    if not force and await session.get(Song, existing_song_id) is not None:
        raise AlreadyDownloadedError(existing_song_id)

    row = Download(source=source, source_song_id=source_song_id, status=QUEUED)
    session.add(row)
    await session.commit()
    await event_bus.broadcast(DownloadUpdated(download=read_download(row)))
    if _queue is None:
        # Nothing is running to pick it up; the next startup re-queues it.
        logger.warning("download %d stored while the queue is down", row.id)
    else:
        _queue.put_nowait(row.id)
    return row


async def _parallel(session_factory: async_sessionmaker[AsyncSession]) -> int:
    async with session_factory() as session:
        value = await SettingsService(session).get(PARALLEL_SETTING)
    return max(1, int(value))


async def _reconcile(session_factory: async_sessionmaker[AsyncSession]) -> list[int]:
    """`running` rows cannot be resumed — their work dir is gone — so they fail with a
    reason. `queued` rows never started and are handed back to be queued again."""
    async with session_factory() as session:
        interrupted = list(
            await session.scalars(select(Download).where(Download.status == RUNNING))
        )
        for row in interrupted:
            row.status = FAILED
            row.error = INTERRUPTED_ERROR
        pending = list(
            await session.scalars(
                select(Download).where(Download.status == QUEUED).order_by(Download.id)
            )
        )
        await session.commit()
        for row in interrupted:
            await event_bus.broadcast(DownloadUpdated(download=read_download(row)))
        if interrupted or pending:
            logger.info(
                "download queue: %d interrupted, %d re-queued", len(interrupted), len(pending)
            )
        return [row.id for row in pending]


async def _worker(
    session_factory: async_sessionmaker[AsyncSession], queue: asyncio.Queue[int]
) -> None:
    while True:
        download_id = await queue.get()
        try:
            await _process(session_factory, download_id)
        except Exception:
            # A crash outside the download itself (a dead DB) must not kill the worker.
            logger.exception("download %d could not be processed", download_id)
        finally:
            queue.task_done()


async def _process(session_factory: async_sessionmaker[AsyncSession], download_id: int) -> None:
    async with session_factory() as session:
        row = await session.get(Download, download_id)
        if row is None or row.status != QUEUED:
            logger.info("skipping download %d (status %s)", download_id, row and row.status)
            return
        try:
            song_source = get_source(row.source)
        except LookupError as error:
            await _update(session, row, status=FAILED, error=str(error))
            return
        await _update(session, row, status=RUNNING, progress=None, step="starting")
        try:
            song_id = await _download(session, row, song_source)
        except Exception as error:
            # CancelledError is a BaseException: a shutdown leaves the row `running`, and
            # the next startup marks it interrupted.
            logger.warning("download %d failed: %s", row.id, error, exc_info=True)
            await _update(session, row, status=FAILED, error=_message(error))
            return
        # Neither the request nor the source seam carries the labels, so they come from
        # the song that was actually written — the UI has something to show in the history.
        song = await session.get(Song, song_id)
        await _update(
            session,
            row,
            status=FINISHED,
            progress=100.0,
            step="done",
            song_id=song_id,
            title=row.title if song is None else song.title,
            artist=row.artist if song is None else song.artist,
        )


async def _download(session: AsyncSession, row: Download, song_source: SongSource) -> str:
    report = _Reporter(session, row)
    # ignore_cleanup_errors: on Windows a file a just-exited subprocess still holds would
    # otherwise turn a finished download into a failure.
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as work_dir:
        directory = await song_source.download(row.source_song_id, Path(work_dir), report)
    await report(None, "adding to the library")
    return await scan_song_directory(
        session, directory, source=song_source.source, source_song_id=row.source_song_id
    )


class _Reporter:
    """Throttles a source's progress calls down to what the UI can use: a new step, or
    at least one percent of movement."""

    def __init__(self, session: AsyncSession, row: Download) -> None:
        self._session = session
        self._row = row
        self._last_percent: float | None = None

    async def __call__(self, percent: float | None, step: str) -> None:
        if not self._is_news(percent, step):
            return
        self._last_percent = percent
        await _update(self._session, self._row, progress=percent, step=step)

    def _is_news(self, percent: float | None, step: str) -> bool:
        if step != self._row.step or percent is None or self._last_percent is None:
            return True
        # 100% always gets through, however small the last step was.
        return percent >= 100.0 or abs(percent - self._last_percent) >= PROGRESS_STEP


async def _update(session: AsyncSession, row: Download, **values: object) -> None:
    for name, value in values.items():
        setattr(row, name, value)
    await session.commit()
    await event_bus.broadcast(DownloadUpdated(download=read_download(row)))


def _message(error: BaseException) -> str:
    if isinstance(error, DownloadError):
        return str(error)
    # An unexpected error still has to say something in the UI.
    return f"{type(error).__name__}: {error}"
