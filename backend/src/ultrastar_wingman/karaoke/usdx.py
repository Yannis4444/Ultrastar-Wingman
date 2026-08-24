"""The Ultrastar Deluxe launcher.

Load-bearing workarounds, all confirmed against a real USDX — do not "clean up":
- `-SongPath <dir> -SingleSong`, one process per song, killed to stop.
- `CREATE_NO_WINDOW` on Windows: without it the process never reports its exit,
  so score import would never run.
- A song outside the USDX songs directory, or with special characters in its
  directory name, has to be copied into the songs directory first — otherwise
  USDX ignores `-SongPath` and loads the whole default library instead.
"""

import asyncio
import logging
import re
import shutil
import sys
from collections.abc import Sequence
from pathlib import Path

from .colors import COLOR_NAMES, color_index
from .launcher import ExitCallback, Launch, LaunchSlot
from .slots import PLAYER_COUNTS
from .usdx_config import ConfiguredPlayer, write_player_config
from .usdx_paths import UsdxPaths

logger = logging.getLogger(__name__)

# Windows only. Not just cosmetic: USDX started without it never signals its exit.
CREATE_NO_WINDOW = 0x08000000

COPY_DIR_NAME = "ULTRASTAR_WINGMAN_SONG_COPY"

# USDX chokes on anything else in a song directory name.
_UNSUPPORTED_IN_DIR_NAME = re.compile(r"[^a-zA-Z0-9.,\-_()+ ]")

# What an empty slot is called in USDX, so the colors of the following slots stay put.
EMPTY_SLOT_NAME = "-"


class UsdxLauncher:
    """One process at a time. Not shared between songs: the karaoke service creates a
    launcher per sing with freshly resolved paths."""

    def __init__(self, paths: UsdxPaths, on_exit: ExitCallback | None = None) -> None:
        self.on_exit = on_exit
        self._paths = paths
        self._process: asyncio.subprocess.Process | None = None
        self._monitor: asyncio.Task[None] | None = None
        self._copy_dir: Path | None = None
        self._lock = asyncio.Lock()

    @property
    def is_running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    async def start(self, song_dir: Path, slots: Sequence[LaunchSlot]) -> Launch:
        async with self._lock:
            if self.is_running:
                raise RuntimeError("USDX is already running")
            await asyncio.to_thread(self._prepare, song_dir, slots)
            effective_dir = self._copy_dir or song_dir
            command = [str(self._paths.executable), "-SongPath", str(effective_dir), "-SingleSong"]
            logger.info("starting USDX: %s", command)
            try:
                self._process = await asyncio.create_subprocess_exec(
                    *command,
                    creationflags=CREATE_NO_WINDOW if sys.platform == "win32" else 0,
                )
            except OSError:
                # Nothing is running, so nothing will ever clean the copy up.
                await self._remove_copy()
                raise
            self._monitor = asyncio.create_task(self._wait_for_exit(self._process))
            return Launch(pid=self._process.pid, song_dir=effective_dir)

    async def stop(self) -> None:
        async with self._lock:
            if self._process is not None and self._process.returncode is None:
                self._process.kill()
                logger.info("killed USDX")

    def _prepare(self, song_dir: Path, slots: Sequence[LaunchSlot]) -> None:
        """Blocking: config rewrite plus, if needed, the song copy."""
        write_player_config(
            self._paths.config_file, self._paths.avatars_dir, _configured_players(slots)
        )
        self._copy_dir = None
        if _needs_copy(song_dir, self._paths.songs_dir):
            self._copy_dir = _copy_into_songs_dir(song_dir, self._paths.songs_dir)

    async def _wait_for_exit(self, process: asyncio.subprocess.Process) -> None:
        await process.wait()
        logger.info("USDX exited with code %s", process.returncode)
        try:
            await self._remove_copy()
        finally:
            # The callback has to run even if the copy could not be removed: it is what
            # imports the scores and tells everyone the song is over.
            if self.on_exit is not None:
                await self.on_exit()

    async def _remove_copy(self) -> None:
        copy_dir, self._copy_dir = self._copy_dir, None
        if copy_dir is not None:
            await asyncio.to_thread(shutil.rmtree, copy_dir, ignore_errors=True)


def _configured_players(slots: Sequence[LaunchSlot]) -> list[ConfiguredPlayer]:
    """Trailing empty slots are dropped (USDX would show them as extra singers);
    empty slots in between keep their place so the colors do not shift."""
    return [
        ConfiguredPlayer(
            name=slot.player_name or EMPTY_SLOT_NAME,
            color_index=color_index(slot.color),
            avatar_file=slot.avatar_file,
        )
        for slot in _playable(slots)
    ]


def _playable(slots: Sequence[LaunchSlot]) -> list[LaunchSlot]:
    """As many slots as there are singers, rounded up to a count USDX can actually play.

    USDX looks `[Game] Players` up in its own list of counts (`PLAYER_COUNTS`) and falls
    back to the *first* of them for anything else: written a five, it would play with one
    player and leave four singers without a microphone. So five singers are handed over
    as six slots, the sixth of them empty.
    """
    used = list(slots)
    while used and used[-1].player_name is None:
        used.pop()
    target = next((count for count in PLAYER_COUNTS if count >= len(used)), 0)
    if target == 0:
        # Unreachable through the API: the configured slots are a count USDX knows, and
        # nobody can sing on a slot that is not configured.
        logger.warning("USDX cannot play %d singers — leaving the count alone", len(used))
        return used
    # The caller's own slots first: they carry the colors the host configured.
    used.extend(list(slots)[len(used) : target])
    for color in COLOR_NAMES:
        if len(used) >= target:
            break
        if all(slot.color != color for slot in used):
            used.append(LaunchSlot(color=color, player_name=None, avatar_file=None))
    return used


def _needs_copy(song_dir: Path, songs_dir: Path) -> bool:
    if _UNSUPPORTED_IN_DIR_NAME.search(song_dir.name):
        return True
    return not song_dir.resolve().is_relative_to(songs_dir.resolve())


def _copy_into_songs_dir(song_dir: Path, songs_dir: Path) -> Path:
    """Blocking. The copy always lands in the same directory, so a leftover from a crash
    is overwritten rather than accumulating."""
    destination = songs_dir / COPY_DIR_NAME
    shutil.rmtree(destination, ignore_errors=True)
    shutil.copytree(song_dir, destination)
    logger.info("copied %s to %s for USDX", song_dir, destination)
    return destination
