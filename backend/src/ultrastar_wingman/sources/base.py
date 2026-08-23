"""The song source seam.

One of the extension points from architecture.md: today USDB, later USDB.eu,
local folders or UltraSinger. A source knows how to turn its own song id into a
finished song directory inside the library; everything else about it (how it
searches, whether it needs a login) is source-specific and deliberately not part
of this Protocol — the download queue only ever calls `download()`.
"""

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Protocol

# Progress callback handed to `download()`: (percent, step). `percent` is None while a
# step has no measurable progress; `step` is shown to the user as-is.
ProgressReport = Callable[[float | None, str], Awaitable[None]]


class DownloadError(RuntimeError):
    """A download failed for a reason the user should read (bad login, no video URL,
    yt-dlp exited non-zero). The message ends up in the `downloads` row and in the UI."""


class UnknownSourceError(LookupError):
    def __init__(self, source: str) -> None:
        super().__init__(f"unknown song source '{source}'")
        self.source = source


class SongSource(Protocol):
    @property
    def source(self) -> str:
        """Source id, also the prefix of the song ids it produces (`usdb`)."""
        ...

    @property
    def display_name(self) -> str: ...

    async def download(self, source_song_id: str, work_dir: Path, report: ProgressReport) -> Path:
        """Fetch the song and return the finished song directory inside the library.

        `work_dir` is an empty scratch directory owned by the caller — assemble the song
        there and move it into the library, so a failed download leaves nothing behind.
        Raises `DownloadError` for anything the user can act on.
        """
        ...


SOURCES: dict[str, SongSource] = {}


def register(source: SongSource) -> SongSource:
    if source.source in SOURCES:
        raise ValueError(f"song source '{source.source}' is already registered")
    SOURCES[source.source] = source
    return source


def get_source(source: str) -> SongSource:
    found = SOURCES.get(source)
    if found is None:
        raise UnknownSourceError(source)
    return found
