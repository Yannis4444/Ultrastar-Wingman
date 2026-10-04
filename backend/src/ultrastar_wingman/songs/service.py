"""Library changes that are not a scan: deleting a song, and fixing its metadata.

Knows nothing about FastAPI — the API layer turns these exceptions into status codes.

Editing writes the song's `.txt`, not only the row. Every startup scan re-parses every txt
and copies what it finds over the row (`scanner._mutable_values`), so a DB-only edit would
last exactly until the next start — and USDX, which reads the same file, would never have
heard of it at all. The file is therefore the one place the new values go; the row is then
refreshed from the file as it was actually written, which is what makes the next scan a
no-op instead of a revert.

What an edit does *not* touch is the song's identity. `Song.id` is
`<source>:<source_id>` — a USDB id out of `wingman.json` or a uuid (`model.song_id`), never
anything derived from the metadata — and the scan matches a directory to a row by its path,
which an edit does not move either. So a song keeps its id through an edit and a rescan,
and with it every tag, favorite, wish, playlist entry, comment and score hanging off that
id. The one derived value that does change is `fingerprint` ("the same song from another
source"), which is an index and never a key: it is recomputed here exactly as the scanner
would compute it.

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
import os
import shutil
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from ..events import SongDeleted, SongUpdated, event_bus
from ..karaoke import service as karaoke
from ..library import service as library
from . import scanner
from .fingerprint import fingerprint
from .model import Song
from .schema import SongMetadata, read_song, song_label, song_metadata
from .txt import (
    SongTxt,
    SongTxtEncodingError,
    SongTxtError,
    load_song_txt,
    parse_song_txt,
    read_song_txt,
    rewrite_headers,
)

logger = logging.getLogger(__name__)

# The txt header each editable value lives in.
_HEADERS: dict[str, str] = {
    "title": "TITLE",
    "artist": "ARTIST",
    "language": "LANGUAGE",
    "genre": "GENRE",
    "year": "YEAR",
    "edition": "EDITION",
}

# Where the new bytes are written before they replace the file. In the song's own directory,
# so the replace stays on one volume — and named after the txt, so a crash between the two
# leaves something obviously ours next to it rather than a stray file in a temp folder.
_TEMPORARY_SUFFIX = ".wingman-new"


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


class SongTxtMissingError(RuntimeError):
    """The song's txt is not there any more — deleted or renamed under the row. Nothing is
    written: there is no file to preserve the rest of, and inventing one would produce a
    song whose lyrics are gone."""

    def __init__(self, path: Path) -> None:
        super().__init__(f"'{path}' cannot be read")
        self.path = path


class SongTxtUnreadableError(RuntimeError):
    """The file cannot be rewritten without changing bytes nobody asked to change: its
    encoding does not round trip, or it no longer parses as a song at all."""

    def __init__(self, path: Path) -> None:
        super().__init__(f"'{path}' cannot be rewritten safely")
        self.path = path


class SongChangedError(RuntimeError):
    """The txt says something else than the editor was opened on — the song was downloaded
    again, or somebody edited the file by hand in the meantime. Saving would put the values
    from before that back, so the caller is asked to look again instead."""

    def __init__(self, song_id: str) -> None:
        super().__init__(f"'{song_id}' changed on disk since the editor was opened")
        self.song_id = song_id


class UnwritableValueError(RuntimeError):
    """A value cannot be said in the file's own encoding — a Japanese title in a cp1252
    file. Transcoding the whole file would rewrite every byte of it, so the value is
    refused instead."""

    def __init__(self, encoding: str) -> None:
        super().__init__(f"the new metadata cannot be written as {encoding}")
        self.encoding = encoding


class SongTxtWriteError(RuntimeError):
    """The new file could not be put in place — on Windows usually the txt being held open,
    which is what a running USDX does with the song on the TV. The old file is untouched."""

    def __init__(self, path: Path, cause: OSError) -> None:
        super().__init__(f"cannot write '{path}': {cause}")
        self.path = path


async def edit_song(
    session: AsyncSession, song: Song, values: SongMetadata, expected: SongMetadata
) -> Song:
    """Write the new metadata into the song's txt and refresh the row from what was
    written. Raises `SongGoneError`, `SongTxtMissingError`, `SongTxtUnreadableError`,
    `SongChangedError`, `UnwritableValueError` or `SongTxtWriteError` — in each case the
    file and the row are exactly as they were."""
    song_id = song.id
    # The scanner's lock, for the same reason a delete takes it: a scan running over this
    # song while its txt is being replaced would read whichever half it caught.
    async with scanner.library_lock():
        current = await session.get(Song, song_id, populate_existing=True)
        if current is None:
            raise SongGoneError(song_id)
        path = Path(current.txt_file)
        # Everything from here to the replace is one blocking unit of file work, and it has
        # to be: the check that the file still says what the editor saw is only worth
        # anything if nothing can slip between it and the write.
        txt = await asyncio.to_thread(_rewrite_txt, path, song_id, values, expected)
        current.title = txt.title
        current.artist = txt.artist
        # Recomputed exactly as `scanner._mutable_values` would: it is derived from the
        # artist and the title, so an edit of either moves it.
        current.fingerprint = fingerprint(txt.artist, txt.title)
        current.language = txt.language
        current.genre = txt.genre
        current.year = txt.year
        current.edition = txt.edition
        await session.commit()
        logger.info("Details of %s edited", song_label(current))

    await event_bus.broadcast(SongUpdated(song=read_song(current)))
    return current


def _rewrite_txt(path: Path, song_id: str, values: SongMetadata, expected: SongMetadata) -> SongTxt:
    """Blocking. Reads the txt, refuses if it has moved on, writes the new headers into it
    and returns the file as it parses *after* the write — which is what the next scan will
    read, and therefore what the row has to be set to."""
    try:
        raw = path.read_bytes()
    except OSError as error:
        raise SongTxtMissingError(path) from error
    try:
        file = load_song_txt(raw)
        before = parse_song_txt(file.text)
    except (SongTxtEncodingError, SongTxtError) as error:
        raise SongTxtUnreadableError(path) from error
    # Against the *file*, never against the database row: a re-download refreshes the row
    # too, so comparing rows would find nothing while the download's metadata is exactly
    # what this save would overwrite.
    if song_metadata(before) != expected:
        raise SongChangedError(song_id)
    text = rewrite_headers(file.text, _changes(values))
    try:
        data = file.encode(text)
    except UnicodeEncodeError as error:
        raise UnwritableValueError(file.encoding) from error
    _replace(path, data)
    return read_song_txt(path)


def _changes(values: SongMetadata) -> dict[str, str | None]:
    """The six headers to set, in the order a file missing them grows them."""
    written = values.model_dump()
    return {
        header: None if written[name] is None else str(written[name])
        for name, header in _HEADERS.items()
    }


def _replace(path: Path, data: bytes) -> None:
    """Blocking. The new bytes beside the old file, then one atomic replace: a failure
    anywhere in here leaves the reader — USDX included — with the whole old file rather
    than half of a new one."""
    temporary = path.with_name(path.name + _TEMPORARY_SUFFIX)
    try:
        temporary.write_bytes(data)
        os.replace(temporary, path)
    except OSError as error:
        temporary.unlink(missing_ok=True)
        raise SongTxtWriteError(path, error) from error


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
        label = song_label(current)
        await session.delete(current)
        await session.commit()
        logger.info("Deleted %s and its folder %s", label, directory)

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
        logger.debug("song directory %s is already gone", resolved)
        return
    try:
        shutil.rmtree(resolved)
    except OSError as error:
        raise SongFilesError(resolved, error) from error
