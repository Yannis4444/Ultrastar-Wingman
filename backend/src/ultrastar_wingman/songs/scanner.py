"""Library scan: configured directories in, `songs` rows out.

One scan at a time (a second request gets a 409). All file system work happens in
a worker thread; nothing is ever written into a song directory — the old app
dropped a `wingman.json` cache into every folder, which is exactly the kind of
side effect that makes a library un-reproducible.
"""

import asyncio
import contextlib
import logging
import re
from dataclasses import dataclass
from pathlib import Path

import mutagen
from pydantic import BaseModel, ConfigDict, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..events import SongsScanFinished, SongsScanStarted, event_bus
from ..settings import SettingsService
from .fingerprint import fingerprint
from .model import USDB_SOURCE, Song, song_id
from .txt import SongTxt, SongTxtError, read_song_txt

logger = logging.getLogger(__name__)

SONGS_DIRECTORY = "songs.directory"
ADDITIONAL_DIRECTORIES = "songs.additional_directories"

# Old wingman.json ids: "USDB-1234" is usable, "USDB-None" and raw numbers are not.
_LEGACY_USDB_ID = re.compile(r"USDB-(\d+)")

_scan_lock = asyncio.Lock()


class ScanBusyError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("a library scan is already running")


@dataclass(frozen=True)
class ScanResult:
    added: int
    removed: int
    updated: int
    total: int


_scan_task: asyncio.Task[ScanResult] | None = None


@dataclass(frozen=True)
class ScannedSong:
    """One song directory as found on disk. Paths are absolute."""

    directory: Path
    txt_file: Path
    txt: SongTxt
    cover_file: Path | None
    audio_file: Path | None
    video_file: Path | None
    duration_seconds: int | None
    usdb_id: int | None


class WingmanMetadata(BaseModel):
    """The old app's `wingman.json`, read for its USDB id only."""

    model_config = ConfigDict(extra="ignore")

    usdb_id: int | str | None = None
    id: str | None = None


async def scan_library(session_factory: async_sessionmaker[AsyncSession]) -> ScanResult:
    """Reconcile the DB with the configured song directories. Raises `ScanBusyError`
    while another scan is running."""
    if _scan_lock.locked():
        raise ScanBusyError
    # No await between the check and the acquire, so this cannot race on one event loop.
    async with _scan_lock:
        result = ScanResult(added=0, removed=0, updated=0, total=0)
        await event_bus.broadcast(SongsScanStarted())
        try:
            async with session_factory() as session:
                roots = await _configured_roots(session)
                scanned = await asyncio.to_thread(_scan_roots, roots)
                result = await _reconcile(session, scanned)
            logger.info(
                "library scan finished: %d added, %d removed, %d updated, %d total",
                result.added,
                result.removed,
                result.updated,
                result.total,
            )
            return result
        finally:
            # Always announce the end, even on failure — the UI must not spin forever.
            await event_bus.broadcast(
                SongsScanFinished(
                    added=result.added,
                    removed=result.removed,
                    updated=result.updated,
                    total=result.total,
                )
            )


def start_scan(session_factory: async_sessionmaker[AsyncSession]) -> bool:
    """Kick off a scan in the background. False when one is already running."""
    global _scan_task
    if _scan_task is not None and not _scan_task.done():
        return False
    _scan_task = asyncio.create_task(scan_library(session_factory))
    _scan_task.add_done_callback(_log_failure)
    return True


async def stop_scan() -> None:
    """Cancel a running scan (shutdown), so it cannot outlive the database engine."""
    global _scan_task
    task, _scan_task = _scan_task, None
    if task is None or task.done():
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


def _log_failure(task: asyncio.Task[ScanResult]) -> None:
    if task.cancelled():
        return
    error = task.exception()
    if error is not None:
        logger.error("library scan failed", exc_info=error)


async def _configured_roots(session: AsyncSession) -> list[Path]:
    settings = SettingsService(session)
    values = [str(await settings.get(SONGS_DIRECTORY))]
    values += str(await settings.get(ADDITIONAL_DIRECTORIES)).splitlines()
    return [Path(value.strip()) for value in values if value.strip()]


async def _reconcile(session: AsyncSession, scanned: list[ScannedSong]) -> ScanResult:
    existing = {row.directory: row for row in await session.scalars(select(Song))}
    taken_ids = {row.id for row in existing.values()}
    added = updated = removed = 0

    found_directories = set()
    for song in scanned:
        directory = str(song.directory)
        found_directories.add(directory)
        row = existing.get(directory)
        if row is None:
            identifier = _unique_id(song.usdb_id, taken_ids)
            taken_ids.add(identifier)
            session.add(_new_row(identifier, song))
            added += 1
        elif _apply_values(row, song):
            updated += 1

    for directory, row in existing.items():
        if directory not in found_directories:
            await session.delete(row)
            removed += 1

    await session.commit()
    return ScanResult(added=added, removed=removed, updated=updated, total=len(scanned))


def _unique_id(usdb_id: int | None, taken: set[str]) -> str:
    identifier = song_id(usdb_id)
    if identifier not in taken:
        return identifier
    # Two directories claiming the same USDB id (a duplicated download) must not collide.
    logger.warning("song id '%s' is already taken, falling back to a local id", identifier)
    return song_id(None)


def _new_row(identifier: str, scanned: ScannedSong) -> Song:
    source, _, source_id = identifier.partition(":")
    row = Song(
        id=identifier,
        source=source,
        # A local song has no source id; the uuid in its song id is not one.
        source_id=source_id if source == USDB_SOURCE else None,
        directory=str(scanned.directory),
    )
    _apply_values(row, scanned)
    return row


def _apply_values(row: Song, scanned: ScannedSong) -> bool:
    """Set the columns a rescan may change. True when something actually changed."""
    values = _mutable_values(scanned)
    if all(getattr(row, name) == value for name, value in values.items()):
        return False
    for name, value in values.items():
        setattr(row, name, value)
    return True


def _mutable_values(scanned: ScannedSong) -> dict[str, object]:
    txt = scanned.txt
    return {
        "title": txt.title,
        "artist": txt.artist,
        "fingerprint": fingerprint(txt.artist, txt.title),
        "txt_file": str(scanned.txt_file),
        "cover_file": _as_str(scanned.cover_file),
        "audio_file": _as_str(scanned.audio_file),
        "video_file": _as_str(scanned.video_file),
        "duration_seconds": scanned.duration_seconds,
        "language": txt.language,
        "genre": txt.genre,
        "year": txt.year,
        "edition": txt.edition,
        "creator": txt.creator,
    }


def _as_str(path: Path | None) -> str | None:
    return None if path is None else str(path)


def _scan_roots(roots: list[Path]) -> list[ScannedSong]:
    """Blocking: every direct subdirectory of every root is one candidate song."""
    songs: list[ScannedSong] = []
    seen: set[Path] = set()
    for root in roots:
        if not root.is_dir():
            logger.warning("configured song directory does not exist: %s", root)
            continue
        for directory in sorted(entry for entry in root.iterdir() if entry.is_dir()):
            resolved = directory.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            song = _scan_directory(resolved)
            if song is not None:
                songs.append(song)
    return songs


def _scan_directory(directory: Path) -> ScannedSong | None:
    txt_files = sorted(directory.glob("*.txt"))
    if not txt_files:
        logger.debug("no song txt in %s", directory)
        return None
    txt_file = txt_files[0]
    try:
        txt = read_song_txt(txt_file)
    except (SongTxtError, ValueError, OSError) as error:
        logger.warning("ignoring %s: %s", txt_file, error)
        return None
    audio_file = _song_file(directory, txt.audio)
    return ScannedSong(
        directory=directory,
        txt_file=txt_file,
        txt=txt,
        cover_file=_song_file(directory, txt.cover),
        audio_file=audio_file,
        video_file=_song_file(directory, txt.video),
        duration_seconds=None if audio_file is None else audio_duration_seconds(audio_file),
        usdb_id=_usdb_id(directory),
    )


def _song_file(directory: Path, name: str | None) -> Path | None:
    """Resolve a file tag against the song directory. Tags come from an external file, so a
    name that escapes the directory (`../../secrets`) is refused, not resolved."""
    if not name:
        return None
    candidate = (directory / name.strip()).resolve()
    if not candidate.is_relative_to(directory):
        logger.warning("song file '%s' points outside of %s", name, directory)
        return None
    if candidate.is_file():
        return candidate
    # Libraries copied from Windows to Linux keep tags like "Song.MP3" for "song.mp3".
    wanted = candidate.name.casefold()
    for entry in directory.iterdir():
        if entry.name.casefold() == wanted and entry.is_file():
            return entry
    logger.debug("song file '%s' is missing in %s", name, directory)
    return None


def audio_duration_seconds(path: Path) -> int | None:
    """Best effort: an unreadable or exotic audio file simply has no known duration."""
    try:
        audio = mutagen.File(path)
        return None if audio is None else round(audio.info.length)
    except Exception:
        logger.debug("could not read the duration of %s", path, exc_info=True)
        return None


def _usdb_id(directory: Path) -> int | None:
    """USDB id from the old app's `wingman.json`, if it has a usable one."""
    path = directory / "wingman.json"
    if not path.is_file():
        return None
    try:
        metadata = WingmanMetadata.model_validate_json(path.read_bytes())
    except (ValidationError, OSError) as error:
        logger.warning("ignoring %s: %s", path, error)
        return None
    if isinstance(metadata.usdb_id, int):
        return metadata.usdb_id
    if isinstance(metadata.usdb_id, str) and metadata.usdb_id.isdigit():
        return int(metadata.usdb_id)
    legacy = _LEGACY_USDB_ID.fullmatch(metadata.id or "")
    return None if legacy is None else int(legacy.group(1))
