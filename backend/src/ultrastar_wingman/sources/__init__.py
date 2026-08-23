"""Song sources: the seam in `base`, and the one place implementations register.

Importing an implementation module here is what puts it into `SOURCES` — that is the
whole registration mechanism (architecture.md: a plain dict, no plugin framework).
"""

from . import usdb
from .base import (
    SOURCES,
    DownloadError,
    ProgressReport,
    SongSource,
    UnknownSourceError,
    get_source,
    register,
)

__all__ = [
    "SOURCES",
    "DownloadError",
    "ProgressReport",
    "SongSource",
    "UnknownSourceError",
    "get_source",
    "register",
    "usdb",
]
