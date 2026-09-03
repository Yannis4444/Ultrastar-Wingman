"""The badge pictures Wingman ships, and which picture an achievement is drawn with.

`images/` beside this module holds one PNG per built-in, named by its id
(`builtin-score-9000.png`), plus `images/small/` with the same files at 256 px for the
40 px rows and the TV (`docs/dev/achievement-artwork.md` is how they are made). Hatchling
ships the directory in the wheel because it is under the package; the frozen build lists it
in the installer's `datas`, which is why `images_dir` looks in the unpacked bundle first,
the way `db.migrations_dir` does.

A built-in is drawn with its shipped picture unless the host uploaded another: an upload
wins, removing the upload (or a reset) goes back to the shipped one, and only a
non-built-in can be drawn with a glyph at all. The read model says which of the two it is
(`image_shipped`) so the editor can name the way back.

A leaf beside `model.py`: `schema.py`, `service.py` and `api.py` all ask it, and it must
stay importable from `schema.py`, which is FastAPI-free.
"""

import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .model import Achievement

PictureSize = Literal["small", "full"]


def images_dir() -> Path:
    """Where the shipped pictures are — the unpacked bundle when frozen, the package
    directory otherwise."""
    bundle_dir = getattr(sys, "_MEIPASS", None)
    if bundle_dir is not None:
        return Path(bundle_dir) / "ultrastar_wingman" / "achievements" / "images"
    return Path(__file__).parent / "images"


def shipped_picture(achievement_id: str, size: PictureSize = "full") -> Path | None:
    """The packaged picture under that id at that size, or `None` when Wingman ships none.

    Checked on the disk rather than against `builtin.py`: a built-in without a picture (one
    added before its artwork exists) is drawn with its glyph, and the file is the truth.
    """
    directory = images_dir() if size == "full" else images_dir() / size
    path = directory / f"{achievement_id}.png"
    return path if path.is_file() else None


@dataclass(frozen=True)
class Picture:
    path: Path
    shipped: bool


def picture_of(achievement: Achievement, size: PictureSize = "full") -> Picture | None:
    """The picture this achievement is drawn with, uploaded first.

    An upload answers every size — nothing here resizes, that would take an image library
    (`images.py`) — so a row asking for `small` gets the whole upload and the browser scales
    it. Only the shipped pictures have a small variant.

    An upload whose file has gone is still the upload (`has_image` has never checked the
    disk; the endpoint's 404 is what says the file is missing), so the shipped picture never
    silently stands in for a picture somebody put there.
    """
    if achievement.icon_file is not None:
        return Picture(Path(achievement.icon_file), shipped=False)
    if not achievement.built_in:
        return None
    shipped = shipped_picture(achievement.id, size)
    return None if shipped is None else Picture(shipped, shipped=True)
