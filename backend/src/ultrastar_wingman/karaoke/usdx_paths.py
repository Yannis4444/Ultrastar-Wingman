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
    """Everything the launcher needs, all absolute. Only `executable` is checked to exist:
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
    logger.info("songs directory set to the bundled Ultrastar Deluxe's: %s", songs)
    return songs
