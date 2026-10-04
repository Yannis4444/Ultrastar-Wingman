"""Where the USDX installation lives.

One setting (`usdx.base_path`) covers the normal install; every derived path has
an override for people whose portable install is spread over several folders.

`songs_dir` is USDX's *own* songs directory, not Wingman's `songs.directory`.
The two are the same in the common setup and were the same thing in the old app,
but Wingman happily scans libraries USDX knows nothing about — and the launcher
copies into the directory USDX itself loads from, because a song started from
anywhere else once brought the whole library up with it (see `usdx.py`).

A Wingman that brings its own Ultrastar Deluxe (`config.BootstrapSettings.usdx_dir`, the
**bundled** mode) derives all five paths from that directory and reads none of the
`usdx.*` settings: they are not offered then, so a value left over from before must not
quietly win. The lifespan hands the directory in through `configure`, the way
`sources.usdb.configure` gets the data directory — the sing flow is reached from a device
report and a selection as well as from a request, and none of them carries the app.
"""

import logging
import os
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

import anyio
from sqlalchemy.ext.asyncio import AsyncSession

from ..settings import SettingsService
from ..songs.scanner import SONGS_DIRECTORY

logger = logging.getLogger(__name__)

BASE_PATH = "usdx.base_path"
EXECUTABLE = "usdx.executable"
CONFIG_FILE = "usdx.config_file"
AVATARS_DIR = "usdx.avatars_dir"
ULTRASTAR_DB = "usdx.ultrastar_db"
SONGS_DIR = "usdx.songs_dir"

# Every setting the bundled mode takes away. Not derived from the registry's prefix: a
# `usdx.*` setting added later is not automatically one a bundled build can do without.
KEYS = (BASE_PATH, EXECUTABLE, CONFIG_FILE, AVATARS_DIR, ULTRASTAR_DB, SONGS_DIR)

# The Ultrastar Deluxe this Wingman brings along, `None` when the host points at their own.
_bundled_dir: Path | None = None


def configure(bundled_dir: Path | None) -> None:
    """Set by the lifespan on every start, `None` included, so an app never inherits the
    mode of the one before it in the same process."""
    global _bundled_dir
    _bundled_dir = bundled_dir
    _writable_until.clear()


def bundled_dir() -> Path | None:
    """The directory of the bundled Ultrastar Deluxe, or `None` when there is none."""
    return _bundled_dir


# What each override is called relative to `usdx.base_path` in a standard install.
_DERIVED = {
    EXECUTABLE: "ultrastardx.exe",
    CONFIG_FILE: "config.ini",
    AVATARS_DIR: "avatars",
    ULTRASTAR_DB: "Ultrastar.db",
    SONGS_DIR: "songs",
}


@dataclass(frozen=True)
class UsdxPaths:
    """Everything the launcher needs, all absolute. Only `executable` is checked to exist (and,
    in the bundled mode, that a file can be made in `songs_dir` when it is there, a success
    standing for `WRITABLE_FOR_SECONDS`):
    `config_file` is written on demand (by Wingman itself, before every launch),
    `avatars_dir` and `songs_dir` are created by whoever writes into them first, and
    `ultrastar_db` only appears once somebody has scored."""

    executable: Path
    config_file: Path
    avatars_dir: Path
    ultrastar_db: Path
    songs_dir: Path


class UsdxPathsError(RuntimeError):
    """USDX is not configured (or configured wrongly). `problems` lists every
    reason at once, so the user fixes the settings in one pass."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("; ".join(problems))
        self.problems = problems


async def resolve_usdx_paths(session: AsyncSession) -> UsdxPaths:
    """Raises `UsdxPathsError` listing everything that is missing or wrong."""
    settings = SettingsService(session)
    bundled = _bundled_dir
    # In the bundled mode the `usdx.*` values are not even read: whatever is stored there
    # is from before, and nobody can see or change it any more.
    keys = (SONGS_DIRECTORY,) if bundled is not None else (*KEYS, SONGS_DIRECTORY)
    values = {key: str(await settings.get(key)).strip() for key in keys}
    return await anyio.to_thread.run_sync(_resolve, values, bundled)


def _resolve(values: dict[str, str], bundled: Path | None = None) -> UsdxPaths:
    """Blocking: touches the file system to check what the settings point at."""
    problems: list[str] = []
    resolved: dict[str, Path] = {}

    if bundled is not None:
        resolved = {key: bundled / name for key, name in _DERIVED.items()}
    else:
        base = values[BASE_PATH]
        for key, name in _DERIVED.items():
            if values[key]:
                resolved[key] = Path(values[key])
            elif base:
                resolved[key] = Path(base) / name
            else:
                problems.append(f"'{key}' is not set and cannot be derived from '{BASE_PATH}'")

    # Not one of USDX's own paths, but part of the same "is Wingman set up" report: with
    # no library there is nothing to sing in the first place.
    songs_directory = values[SONGS_DIRECTORY]
    if not songs_directory:
        problems.append(f"'{SONGS_DIRECTORY}' is not set")
    elif not Path(songs_directory).is_dir():
        problems.append(f"'{SONGS_DIRECTORY}' is not a directory: {songs_directory}")

    executable = resolved.get(EXECUTABLE)
    if executable is not None and not executable.is_file():
        # Not named after the setting in the bundled mode: there is no setting to fix, and
        # the sentence the UI turns it into must not send the host looking for one.
        if bundled is not None:
            problems.append(f"the bundled Ultrastar Deluxe is missing: {executable}")
        else:
            problems.append(f"'{EXECUTABLE}' is not a file: {executable}")
    if bundled is not None:
        problems.extend(_bundled_folder_problems(bundled, resolved[SONGS_DIR]))
    # The config file is created on demand, Ultrastar.db only exists after the first score
    # and USDX creates its songs directory on first start, so none of them has to be there.
    if problems:
        raise UsdxPathsError(problems)

    songs_dir = resolved[SONGS_DIR]
    if not songs_dir.is_dir():
        # Not fatal — the launcher creates it when it copies a song in — but a typo here
        # means USDX loads its whole library next to the song Wingman started.
        logger.warning("the USDX songs directory does not exist: %s", songs_dir)

    return UsdxPaths(
        executable=resolved[EXECUTABLE],
        config_file=resolved[CONFIG_FILE],
        avatars_dir=resolved[AVATARS_DIR],
        ultrastar_db=resolved[ULTRASTAR_DB],
        songs_dir=songs_dir,
    )


def _bundled_folder_problems(bundled: Path, songs_dir: Path) -> list[str]:
    """What is wrong with the folder the setup put the bundled Ultrastar Deluxe in. A silent
    install goes on where the setup's own dialog would have asked, so this is where such a
    folder is first said out loud. Only the bundled mode: a host's own installation is
    where they put it, and was checked by nobody."""
    problems: list[str] = []
    # The installer's `IsPlainAscii` (nothing past code point 127), not the launcher's
    # `_UNSUPPORTED_IN_NAME`: that one holds a single folder *name* to a whitelist that
    # has no room for the drive's colon or a backslash. The launcher copies an oddly named
    # song to a plain name, but the folders above USDX's songs folder come along with the
    # copy (see `usdx.py`), so no song can be started out of such a folder.
    if not str(bundled).isascii():
        problems.append(
            f"the bundled Ultrastar Deluxe is in a folder that is not plain ASCII: {bundled}"
        )
    # A missing one is the launcher's to create (see the warning in `_resolve`).
    if songs_dir.is_dir() and not _can_create_files_in(songs_dir):
        problems.append(f"the bundled songs folder cannot be written to: {songs_dir}")
    return problems


# How long a folder that took the write test is believed writable. Every phone that opens
# the home page asks for the status (and again whenever it comes back to the tab), so without
# this each of them would make and remove a file in the songs folder. A refusal is never
# remembered: the host who has just fixed the permissions sees the banner go at once.
WRITABLE_FOR_SECONDS = 60.0
_writable_until: dict[Path, float] = {}


def _can_create_files_in(directory: Path) -> bool:
    now = time.monotonic()
    if _writable_until.get(directory, 0.0) > now:
        return True
    if _write_test(directory):
        _writable_until[directory] = now + WRITABLE_FOR_SECONDS
        return True
    _writable_until.pop(directory, None)
    return False


def _write_test(directory: Path) -> bool:
    """Found out by creating a file there and removing it again. Not `os.access`: on Windows
    it reads the read-only attribute alone, which a folder ignores anyway, and knows nothing
    of the folder's permissions. And not `tempfile.mkstemp`: on Windows it takes a refusal
    for a name that is taken, asks `os.access` whether the folder is writable, hears yes and
    tries the next name, for ever."""
    name = directory / f".wingman-write-test-{uuid.uuid4().hex}"
    try:
        handle = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
    except OSError:
        return False
    os.close(handle)
    try:
        os.unlink(name)
    except OSError as error:
        # A folder that lets a file be made but not removed: writable all the same.
        logger.warning("cannot remove the write test %s: %s", name, error)
    return True


async def seed_songs_directory(session: AsyncSession) -> Path | None:
    """A bundled Wingman's first start: point `songs.directory` at the bundled Ultrastar
    Deluxe's own songs folder, so a fresh install sings with no settings at all.

    Only while the setting is empty: a folder the host typed later is theirs. And only once
    the folder is there: a folder that cannot be made is not stored, so the setting stays
    empty and the next start tries again. Returns the folder when it set one, `None`
    otherwise.
    """
    bundled = _bundled_dir
    if bundled is None:
        return None
    settings = SettingsService(session)
    if str(await settings.get(SONGS_DIRECTORY)).strip():
        return None
    songs = bundled / _DERIVED[SONGS_DIR]
    try:
        # Not `parents=True`: a mistyped `--usdx-dir` must not be conjured into existence
        # as an empty tree, and a drive that is not there must not be asked for one.
        await anyio.to_thread.run_sync(lambda: songs.mkdir(exist_ok=True))
    except OSError as error:
        # Stored anyway, the setting would never be seeded again once the drive is back or
        # the directory fixed. Wingman starts either way; the status says the setting is
        # empty.
        logger.warning("cannot create the songs folder %s: %s", songs, error)
        return None
    await settings.set(SONGS_DIRECTORY, str(songs))
    logger.info("Songs folder set to the one of the Ultrastar Deluxe that came along: %s", songs)
    return songs
