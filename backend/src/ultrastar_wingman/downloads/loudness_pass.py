"""The pass over the library: a ReplayGain tag for every song that has none yet.

Every download is tagged as it arrives (`service._normalize`); this is for the songs that
were in the library before, or came from somewhere else. It never runs on its own — not on
a rescan, not at startup: the host starts it from the Settings page and watches it run,
because it rewrites the host's own files. What it found out stays on the song rows
(`loudness.keep`), so a second pass only visits what is left: the rows whose
`replay_gain_db` is still NULL. A file that could not be tagged (read-only, damaged, in
use) keeps nothing and is tried again by the next pass.

Module state, like the download queue: there is one library per Wingman process, so one
pass at a time. A restart forgets the pass; what it did stays on the rows.

While a song is being sung, or Ultrastar Deluxe stands open on its own, the pass writes
nothing: it looks before each song and again right before the write, and holds still
until the room is free (`busy`). The write itself runs under the scanner's lock, so a scan,
a metadata edit or a deletion never meets a song folder half way through a tag, and so does
storing what came of it on the row.

The look before the write is not a lock: a song started a moment later (the tagged copy
and its read-back take a second or so, and `busy` only turns true once Ultrastar Deluxe has
been launched) still never meets half a file. The copy takes the file's place in one
`os.replace`; on Windows a file Ultrastar Deluxe holds open refuses that (`in_use`, tried
again at the end), and one it opens afterwards is the tagged file whole.
"""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..events import LoudnessChanged, event_bus
from ..karaoke import service as karaoke
from ..songs import scanner
from ..songs.model import Song
from ..songs.schema import song_label
from . import loudness, media
from .schema import (
    LoudnessCounts,
    LoudnessPassEnd,
    LoudnessPassRead,
    LoudnessPassState,
    LoudnessPassStatus,
    LoudnessSongRead,
)

logger = logging.getLogger(__name__)

# How often a pass that holds still for a song looks again whether it is over.
WAIT_SECONDS = 1.0


class PassRunningError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("a loudness pass is already running")


class _SongMovedError(Exception):
    """The song is gone, names another audio file, or got its values elsewhere (a
    download) while the pass was measuring it: nothing of this measurement is written."""


def _no_counts() -> LoudnessCounts:
    return LoudnessCounts.model_validate(dict.fromkeys(LoudnessCounts.model_fields, 0))


@dataclass
class _Progress:
    state: LoudnessPassState = "idle"
    waiting: bool = False
    total: int = 0
    done: int = 0
    counts: LoudnessCounts = field(default_factory=_no_counts)
    song: LoudnessSongRead | None = None
    ended: LoudnessPassEnd | None = None
    error: str | None = None


_progress = _Progress()
_task: asyncio.Task[None] | None = None


def busy() -> bool:
    """Whether a song is being sung or Ultrastar Deluxe stands open on its own: either may
    have the very file open that the pass would replace."""
    return karaoke.current_sing() is not None or karaoke.usdx_is_open()


def is_running() -> bool:
    return _task is not None and not _task.done()


def read() -> LoudnessPassStatus:
    """The pass as `GET /downloads/loudness` answers it: the song in hand included."""
    return LoudnessPassStatus(**_public().model_dump(), song=_progress.song)


def _public() -> LoudnessPassRead:
    return LoudnessPassRead(
        state=_progress.state,
        waiting=_progress.waiting,
        total=_progress.total,
        done=_progress.done,
        counts=_progress.counts.model_copy(),
        ended=_progress.ended,
        error=_progress.error,
    )


async def start(
    session_factory: async_sessionmaker[AsyncSession], data_dir: Path
) -> LoudnessPassStatus:
    """Start a pass in the background. Raises `PassRunningError` while one runs. `data_dir`
    is where Wingman keeps its own ffmpeg (`media.ensure_ffmpeg`)."""
    global _progress, _task
    # No await between the check and the task: nothing can start a second pass in between.
    if is_running():
        raise PassRunningError
    _progress = _Progress(state="running")
    # The task says that it started, not this request: every message of the pass then
    # leaves from one task, in order, and a pass with nothing to do can never have its
    # `finished` overtaken on some socket by the `running` of this press.
    _task = asyncio.create_task(_run(session_factory, data_dir), name="loudness-pass")
    return read()


async def stop() -> None:
    """Stop the pass and wait until it has. A song being measured is given up (ffmpeg is
    stopped, nothing was written); a song being written is finished first. Stopping no
    pass is not a mistake. The lifespan calls this too, so no pass outlives the database."""
    task = _task
    if task is None or task.done():
        return
    if _progress.state != "stopping":
        _progress.state = "stopping"
        await _broadcast()
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
    if _progress.state != "idle":
        # Cancelled before its first step, so `_run` never got to say how it ended.
        _end("stopped")
        await _broadcast()


async def _run(session_factory: async_sessionmaker[AsyncSession], data_dir: Path) -> None:
    try:
        await _broadcast()
        await _pass(session_factory, data_dir)
    except asyncio.CancelledError:
        _end("stopped")
        logger.info(
            "Stopped evening out the loudness after %d of %d songs%s",
            _progress.done,
            _progress.total,
            _counts_line(),
        )
        await _broadcast()
        raise
    except Exception as error:
        # A bug, or a database gone: the pass says so and stops, Wingman carries on.
        logger.exception("the loudness pass failed")
        _end("failed", f"{type(error).__name__}: {error}")
        await _broadcast()


async def _pass(session_factory: async_sessionmaker[AsyncSession], data_dir: Path) -> None:
    async with session_factory() as session:
        song_ids = list(
            await session.scalars(
                select(Song.id)
                .where(Song.audio_file.is_not(None), Song.replay_gain_db.is_(None))
                # The song list's own order (`songs.api`), so the host can follow along.
                .order_by(func.lower(Song.artist), func.lower(Song.title), Song.id)
            )
        )
        if not song_ids:
            # No ffmpeg is looked for, let alone downloaded, for a pass with nothing to do.
            logger.info("Every song's loudness is known already")
            _end("finished")
            await _broadcast()
            return
        try:
            ffmpeg = await media.ensure_ffmpeg(session, data_dir)
        except Exception as error:
            # No ffmpeg, and none could be fetched: one sentence, and the pass never starts.
            logger.warning("Could not even out the loudness of the songs: %s", error)
            _end("failed", str(error))
            await _broadcast()
            return

    _progress.total = len(song_ids)
    logger.info("Evening out the loudness of %s", _songs(len(song_ids)))
    await _broadcast()
    retry: list[str] = []
    for song_id in song_ids:
        if await _visit(session_factory, ffmpeg, song_id, last_try=False) == "in_use":
            retry.append(song_id)
    # Once more at the end, for the files another program held open: by then the host
    # screen has usually moved on to another song.
    for song_id in retry:
        await _visit(session_factory, ffmpeg, song_id, last_try=True)
    _end("finished")
    logger.info("Evened out the loudness of %s%s", _songs(_progress.total), _counts_line())
    await _broadcast()


async def _visit(
    session_factory: async_sessionmaker[AsyncSession],
    ffmpeg: str,
    song_id: str,
    *,
    last_try: bool,
) -> loudness.Status | None:
    """Normalize one song and keep the outcome on its row. Answers the outcome's status,
    or None for a song that needs nothing any more. A file in use is counted only on its
    `last_try`; before that it is handed back to be tried again."""
    await _wait_until_free()
    # Short sessions: none is held open across a measurement, which can take minutes.
    async with session_factory() as session:
        song = await session.get(Song, song_id)
        if song is None or song.audio_file is None or song.replay_gain_db is not None:
            # Deleted, or given its values by a download, since the pass listed it.
            _progress.done += 1
            return None
        audio_file = song.audio_file
        label = song_label(song)
        _progress.song = LoudnessSongRead(id=song.id, title=song.title, artist=song.artist)
    await _broadcast()

    def window() -> contextlib.AbstractAsyncContextManager[None]:
        return _write_window(session_factory, song_id, audio_file)

    try:
        outcome = await loudness.normalize(ffmpeg, Path(audio_file), write_window=window)
    except _SongMovedError:
        logger.debug("%s changed while its loudness was measured; left for the next pass", label)
        _progress.song = None
        _progress.done += 1
        return None
    if outcome.status == "in_use" and not last_try:
        logger.debug("%s is in use; trying it again at the end: %s", label, outcome.detail)
        _progress.song = None
        return "in_use"

    # Under the scanner's lock again: a rescan that gives the row another audio file between
    # this look and the commit would otherwise end up with this file's numbers on it.
    async with scanner.library_lock(), session_factory() as session:
        current = await session.get(Song, song_id)
        if (
            current is not None
            and current.audio_file == audio_file
            and current.replay_gain_db is None
        ):
            loudness.keep(current, outcome)
            await session.commit()
    setattr(_progress.counts, outcome.status, getattr(_progress.counts, outcome.status) + 1)
    _progress.done += 1
    _progress.song = None
    if outcome.status in ("failed", "in_use"):
        logger.warning("Could not even out the loudness of %s: %s", label, outcome.detail)
    else:
        logger.debug("loudness of %s: %s %s", label, outcome.status, outcome.gain)
    return outcome.status


@contextlib.asynccontextmanager
async def _write_window(
    session_factory: async_sessionmaker[AsyncSession], song_id: str, audio_file: str
) -> AsyncIterator[None]:
    """Where the write happens: the room free, the scanner's lock held, and the row still
    naming the file that was measured. A song started while the lock was being waited for
    sends the pass back to waiting; a song started after it was taken finds the file
    replaced whole, never half written. Raises `_SongMovedError`."""
    while True:
        await _wait_until_free()
        # Read through the function on every call: the tests swap the lock per event loop.
        async with scanner.library_lock():
            if busy():
                continue
            async with session_factory() as session:
                row = (
                    await session.execute(
                        select(Song.audio_file, Song.replay_gain_db).where(Song.id == song_id)
                    )
                ).first()
            if row is None or row.audio_file != audio_file or row.replay_gain_db is not None:
                raise _SongMovedError
            yield
            return


async def _wait_until_free() -> None:
    if not busy():
        return
    logger.debug("evening out the loudness waits until the song is over")
    _progress.waiting = True
    await _broadcast()
    try:
        # A poll and not an event: the sing and a standalone Ultrastar Deluxe end in two
        # places of `karaoke.service`, and this is the only listener, once a second.
        while True:
            await asyncio.sleep(WAIT_SECONDS)
            if not busy():
                break
    finally:
        _progress.waiting = False
    await _broadcast()


def _end(ended: LoudnessPassEnd, error: str | None = None) -> None:
    _progress.state = "idle"
    _progress.waiting = False
    _progress.song = None
    _progress.ended = ended
    _progress.error = error


def _songs(count: int) -> str:
    return "1 song" if count == 1 else f"{count} songs"


def _counts_line() -> str:
    """`: 300 tagged, 20 already tagged, 2 failed`, the counts that are not zero."""
    parts = [
        f"{count} {status.replace('_', ' ')}"
        for status, count in _progress.counts.model_dump().items()
        if count
    ]
    return f": {', '.join(parts)}" if parts else ""


async def _broadcast() -> None:
    await event_bus.broadcast(LoudnessChanged(loudness=_public()))
