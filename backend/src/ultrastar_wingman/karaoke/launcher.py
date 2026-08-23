"""The karaoke launcher seam.

One of the extension points from architecture.md: Wingman drives an external
singing application, today Ultrastar Deluxe (`usdx.UsdxLauncher`), tomorrow
possibly another USDX fork. Everything USDX-specific — command line, config
file rewriting, the song copy workaround — lives behind this Protocol.
"""

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

# Called once after the launched process exited, with no arguments: the caller knows
# what it started. Awaited by the launcher's monitor task.
ExitCallback = Callable[[], Awaitable[None]]


@dataclass(frozen=True)
class LaunchSlot:
    """One singing position: a color, and the player on it (`None` = nobody)."""

    color: str
    player_name: str | None
    avatar_file: Path | None


@dataclass(frozen=True)
class Launch:
    """A started process. `song_dir` is the directory the launcher actually handed to the
    application — not necessarily the song's own, see the copy workaround in `usdx`."""

    pid: int | None
    song_dir: Path


class KaraokeLauncher(Protocol):
    on_exit: ExitCallback | None

    @property
    def is_running(self) -> bool: ...

    async def start(self, song_dir: Path, slots: Sequence[LaunchSlot]) -> Launch:
        """Configure the application for `slots` and start it on `song_dir`."""
        ...

    async def stop(self) -> None:
        """Kill the running process. Idempotent: fine to call when nothing runs."""
        ...
