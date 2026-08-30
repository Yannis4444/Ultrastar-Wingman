"""Library changes that are not a scan. Today that is one thing: deleting a song.

Knows nothing about FastAPI — the API layer turns these exceptions into status codes.

Deleting a song takes the song *directory* with it, not only the row: a row alone would be
put straight back by the next startup scan, so "delete" would mean "hide until the next
restart". The files go first and the row second — the other way round, a failed `rmtree`
would leave a folder nothing points at any more, which the next scan re-imports under a
fresh `local:` id and a lost history.

What the referencing tables do is deliberately *nothing*, which is exactly what a song
leaving the library in a scan already means to them, and every one of them documents it:
scores and sings survive (`stats` outer-joins the song, so a score keeps counting),
`song_tags`, `song_comments`, `favorites` and `playlist_entries` stay as orphans their
listings already skip, and a finished download keeps its row as history. A `usdb:1234`
that is downloaded again gets that very id back (`scanner.scan_song_directory`), so its
tags, its comments and what it scored come back with it.

The one exception is the wishlist: a wish is "somebody should sing this tonight", and
after the file is gone nobody can. Those rows go, with the count broadcast the wishlist
tiles listen for.
"""

import asyncio
import logging
import shutil
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from ..events import SongDeleted, event_bus
from ..karaoke import service as karaoke
from ..library import service as library
from . import scanner
from .model import Song

logger = logging.getLogger(__name__)


class SongIsPlayingError(RuntimeError):
    """The song is on the TV right now. USDX holds its files open, and taking the folder
    away underneath a running song is not something to do to a party."""

    def __init__(self, song_id: str) -> None:
        super().__init__(f"'{song_id}' is playing right now")
        self.song_id = song_id


class LibraryRootError(RuntimeError):
    """The song's folder is a configured library directory, holds one, or is the root of a
    drive. Deleting it would take every other song with it — and, one level higher still,
    whatever else lives beside them — so it is refused whatever the database says."""

    def __init__(self, directory: Path) -> None:
        super().__init__(f"'{directory}' holds a configured library directory")
        self.directory = directory


class SongGoneError(RuntimeError):
    """The row was already deleted while this request waited for the scanner's lock. The
    caller is told the same thing it would have been told a moment earlier — the song is
    not there — rather than a 204 claiming a deletion it did not do."""

    def __init__(self, song_id: str) -> None:
        super().__init__(f"'{song_id}' is no longer in the library")
        self.song_id = song_id


class SongFilesError(RuntimeError):
    """The folder could not be removed — on Windows usually a file still open somewhere.
    The row is untouched, so the song is still whole (or whatever survived is, and the next
    scan reconciles it)."""

    def __init__(self, directory: Path, cause: OSError) -> None:
        super().__init__(f"cannot delete '{directory}': {cause}")
        self.directory = directory


async def delete_song(session: AsyncSession, song: Song) -> None:
    """Delete a song: its folder on disk, then its row. Raises `SongGoneError`,
    `SongIsPlayingError`, `LibraryRootError` or `SongFilesError` — in each case nothing has
    been deleted."""
    song_id = song.id
    # The scanner's lock: a scan that listed the directories before this ran would
    # otherwise re-add the row after the commit below, and the song would be back.
    async with scanner.library_lock():
        # Everything below is decided on the row as it is *now*, not as it was when the
        # request arrived — waiting for the lock can take a whole scan. `populate_existing`
        # because the identity map would otherwise hand back the very object being checked,
        # so a row somebody else deleted in the meantime would still look alive.
        current = await session.get(Song, song_id, populate_existing=True)
        if current is None:
            raise SongGoneError(song_id)
        # Inside the lock, so a sing that starts while this waits is still seen.
        playing = karaoke.current_sing()
        if playing is not None and playing.song.id == song_id:
            raise SongIsPlayingError(song_id)

        directory = Path(current.directory)
        roots = await scanner.configured_roots(session)
        # `resolve()` and `rmtree` both touch the file system, so both belong in a thread.
        await asyncio.to_thread(_remove_directory, directory, roots)
        await session.delete(current)
        await session.commit()
        logger.info("song '%s' deleted with its directory %s", song_id, directory)

    # After the commit: the wishes for a song nobody can sing any more, and the news for
    # every other phone in the room. Both are about a song that no longer exists, so
    # neither may run before the row is actually gone.
    await library.clear_wishes(session, song_id)
    await event_bus.broadcast(SongDeleted(song_id=song_id))


def _remove_directory(directory: Path, roots: list[Path]) -> None:
    """Blocking. Removes the song folder, or does nothing when it is already gone —
    a row whose files vanished is exactly what this endpoint has to be able to clean up."""
    resolved = directory.resolve()
    # A configured root, *or anything above one* — `D:\` above `D:\songs` is the same
    # catastrophe one level bigger — and a drive root even when nothing is configured under
    # it. `is_relative_to` is the equality check as well: a root is relative to itself.
    if resolved == Path(resolved.anchor) or any(
        root.resolve().is_relative_to(resolved) for root in roots
    ):
        raise LibraryRootError(resolved)
    if not resolved.is_dir():
        logger.info("song directory %s is already gone", resolved)
        return
    try:
        shutil.rmtree(resolved)
    except OSError as error:
        raise SongFilesError(resolved, error) from error
