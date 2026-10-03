"""Where the USDX installation lives.

One setting (`usdx.base_path`) covers the normal install; every derived path has
an override for people whose portable install is spread over several folders.

`songs_dir` is USDX's *own* songs directory, not Wingman's `songs.directory`.
The two are the same in the common setup and were the same thing in the old app,
but Wingman happily scans libraries USDX knows nothing about — and the launcher
copies into the directory USDX itself loads from, because a song started from
anywhere else once brought the whole library up with it (see `usdx.py`).
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
    values = {
        key: str(await settings.get(key)).strip()
        for key in (
            BASE_PATH,
            EXECUTABLE,
            CONFIG_FILE,
            AVATARS_DIR,
            ULTRASTAR_DB,
            SONGS_DIR,
            SONGS_DIRECTORY,
        )
    }
    return await anyio.to_thread.run_sync(_resolve, values)


def _resolve(values: dict[str, str]) -> UsdxPaths:
    """Blocking: touches the file system to check what the settings point at."""
    problems: list[str] = []
    base = values[BASE_PATH]
    resolved: dict[str, Path] = {}

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
