"""The download queue: rows in, songs in the library out.

Persisted first, queued second — the row is the source of truth, so a restart can say
what was pending (re-queued) and what was interrupted (failed, with a reason). Knows
nothing about FastAPI; the API layer turns these exceptions into status codes.
"""

import asyncio
import contextlib
import logging
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.sql.elements import ColumnElement

from ..events import DownloadUpdated, event_bus
from ..settings import SettingsService
from ..songs.model import Song
from ..songs.scanner import scan_song_directory
from ..sources.base import DownloadError, SongSource, get_source
from .model import (
    COMPLETED,
    FAILED,
    FINISHED,
    INTERRUPTED_ERROR,
    QUEUED,
    RUNNING,
    UNFINISHED,
    Download,
    mark_session_start,
)
from .schema import read_download

logger = logging.getLogger(__name__)

PARALLEL_SETTING = "downloads.parallel"

# Anything smaller is noise on the wire: a 200 MB video produces thousands of lines.
PROGRESS_STEP = 1.0

# How long a completed download stays in the history. Long enough that a failure nobody
# dismissed had every chance to be seen, short enough to bound the table.
RETENTION_DAYS = 30
# Above this many prunable rows the oldest ones go, whatever their age. A failure the user
# has not dismissed is never prunable — only the age limit above ever removes one.
HISTORY_CAP = 200

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


class DownloadNotFoundError(LookupError):
    def __init__(self, download_id: int) -> None:
        super().__init__(f"no download {download_id}")
        self.download_id = download_id


class DownloadStillRunningError(RuntimeError):
    """A queued or running download has nothing to dismiss yet — it is about to change."""

    def __init__(self, download_id: int) -> None:
        super().__init__(f"download {download_id} has not finished")
        self.download_id = download_id


async def start(session_factory: async_sessionmaker[AsyncSession]) -> None:
    """Reconcile what the last run left behind, then bring the workers up."""
    global _queue
    if _queue is not None:
        return
    # Before reconciling: the rows it fails as interrupted are news of this session.
    mark_session_start()
    await prune(session_factory)
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
                Download.status.in_(UNFINISHED),
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


async def dismiss(session: AsyncSession, download_id: int) -> Download:
    """Take a finished or failed row out of the panel. Raises `DownloadNotFoundError` or
    `DownloadStillRunningError`; dismissing twice is a no-op, not an error."""
    row = await session.get(Download, download_id)
    if row is None:
        raise DownloadNotFoundError(download_id)
    if row.status in UNFINISHED:
        raise DownloadStillRunningError(download_id)
    if row.dismissed_at is None:
        await _update(session, row, dismissed_at=datetime.now(UTC))
    return row


async def dismiss_finished(session: AsyncSession) -> list[Download]:
    """Dismiss every download that succeeded. Failures are deliberately left alone: a bulk
    button must not be able to throw away an error nobody has read."""
    rows = list(
        await session.scalars(
            select(Download).where(Download.status == FINISHED, Download.dismissed_at.is_(None))
        )
    )
    now = datetime.now(UTC)
    for row in rows:
        row.dismissed_at = now
    if rows:
        await session.commit()
        for row in rows:
            await event_bus.broadcast(DownloadUpdated(download=read_download(row)))
    return rows


def _prunable() -> ColumnElement[bool]:
    """Rows retention may drop on size alone: a success nobody needs to act on, or anything
    that was explicitly dismissed."""
    return or_(Download.status == FINISHED, Download.dismissed_at.is_not(None))


async def prune(session_factory: async_sessionmaker[AsyncSession]) -> int:
    """Bound the history. Two passes, in this order:

    1. every completed row older than `RETENTION_DAYS` goes, dismissed or not — a month-old
       failure is not news any more;
    2. beyond `HISTORY_CAP` prunable rows the oldest ones go, so a busy party cannot grow
       the table without limit between restarts.

    Queued and running rows are never touched, and an undismissed failure survives pass 2.
    """
    async with session_factory() as session:
        cutoff = datetime.now(UTC) - timedelta(days=RETENTION_DAYS)
        aged = list(
            await session.scalars(
                select(Download.id).where(
                    Download.status.in_(COMPLETED), Download.updated_at < cutoff
                )
            )
        )
        kept = (
            select(Download.id)
            .where(_prunable())
            .order_by(Download.id.desc())
            .limit(HISTORY_CAP)
            .scalar_subquery()
        )
        excess = list(
            await session.scalars(select(Download.id).where(_prunable(), Download.id.not_in(kept)))
        )
        removable = set(aged) | set(excess)
        if not removable:
            return 0
        await session.execute(delete(Download).where(Download.id.in_(removable)))
        await session.commit()
        logger.info("download history: pruned %d row(s)", len(removable))
        return len(removable)


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
        try:
            # Here and not only at startup: a long party downloading hundreds of songs must
            # not grow the history until the next restart gets around to it. Its own
            # `try`: housekeeping failing says nothing about the download, and an escaping
            # exception would end the worker for good.
            await prune(session_factory)
        except Exception:
            logger.exception("the download history could not be pruned")
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
