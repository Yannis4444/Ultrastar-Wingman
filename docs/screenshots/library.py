"""The fake song library the documentation screenshots are taken against.

Reads ``songs.json`` and writes one folder per song into a scratch directory: a
header-only USDX ``.txt``, a generated cover, ``wingman.json`` with the song's USDB id
and, where the entry asks for one, a placeholder video file. Nothing is downloaded and
no lyrics are written.

What the scanner needs, and why each file is here:

* a ``*.txt`` with ``#TITLE`` and ``#ARTIST``. Everything else in it is optional;
* ``#END`` in **milliseconds**, which is where ``duration_seconds`` comes from when
  there is no audio file to measure. The library has no audio: the stand-in launcher
  plays nothing, and a real mp3 is neither ours to ship nor needed;
* ``#COVER`` naming a file that exists. ``cover_png`` draws it with ``zlib`` and
  ``struct`` alone, because the repository has no image library and a screenshot library
  of flat gray squares would look like a bug;
* ``#VIDEO`` naming a file that exists. The scanner only checks that it is a file, so a
  placeholder is enough to make the *Video* facet say yes;
* ``#DUETSINGERP1`` / ``#DUETSINGERP2``, which is what makes the parser call a song a
  duet without a single note line;
* ``wingman.json`` with a ``usdb_id``. Without it every song gets a random
  ``local:<uuid>`` id and no two seed runs agree on what to put in a documentation link.

From the repository root::

    venv\\Scripts\\python.exe docs\\screenshots\\library.py <target directory>
"""

from __future__ import annotations

import argparse
import colorsys
import json
import re
import struct
import sys
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SONGS_FILE = Path(__file__).with_name("songs.json")

COVER_SIZE = 256

# What Ultrastar Deluxe survives in a song directory name (``karaoke/usdx.py``). A name
# outside it makes the launcher copy the folder before every sing, which works but hides
# the real setup the documentation describes.
_UNSAFE_IN_NAME = re.compile(r"[^a-zA-Z0-9.,\-_()+ ]")

# A placeholder video: never played, never parsed, only counted. The bytes are an MPEG-4
# file type box, so a file manager that peeks at it is not lied to about the format.
_VIDEO_BYTES = bytes.fromhex("0000001c667479706d703432000000006d70343269736f6d")


@dataclass(frozen=True)
class FixtureSong:
    """One entry of ``songs.json``."""

    usdb_id: int
    artist: str
    title: str
    year: int | None
    genre: str | None
    language: str | None
    edition: str | None
    duration: int
    video: bool
    duet: bool

    @property
    def song_id(self) -> str:
        """The id the scanner mints for this folder, thanks to ``wingman.json``."""
        return f"usdb:{self.usdb_id}"

    @property
    def directory_name(self) -> str:
        return _UNSAFE_IN_NAME.sub("", f"{self.artist} - {self.title} ({self.usdb_id})").strip()


def load_songs(path: Path = SONGS_FILE) -> list[FixtureSong]:
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return [
        FixtureSong(
            usdb_id=int(entry["usdb_id"]),
            artist=str(entry["artist"]),
            title=str(entry["title"]),
            year=entry.get("year"),
            genre=entry.get("genre"),
            language=entry.get("language"),
            edition=entry.get("edition"),
            duration=int(entry["duration"]),
            video=bool(entry.get("video", False)),
            duet=bool(entry.get("duet", False)),
        )
        for entry in data["songs"]
    ]


def write_library(songs: list[FixtureSong], target: Path) -> list[Path]:
    """Write every song into ``target``. Existing folders are overwritten in place, so a
    second run over the same directory changes nothing anybody can see."""
    target.mkdir(parents=True, exist_ok=True)
    written = []
    for song in songs:
        written.append(write_song(song, target / song.directory_name))
    return written


def write_song(song: FixtureSong, directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "cover.png").write_bytes(cover_png(song))
    if song.video:
        (directory / "video.mp4").write_bytes(_VIDEO_BYTES)
    (directory / f"{directory.name}.txt").write_text(song_txt(song), encoding="utf-8")
    (directory / "wingman.json").write_text(
        json.dumps({"usdb_id": song.usdb_id}, indent=2) + "\n", encoding="utf-8"
    )
    return directory


def song_txt(song: FixtureSong) -> str:
    """Headers and an ``E``, and nothing between them. A USDX file is headers plus note
    lines; note lines are lyrics, so this library has none."""
    lines = [f"#TITLE:{song.title}", f"#ARTIST:{song.artist}", "#MP3:song.mp3", "#COVER:cover.png"]
    if song.video:
        lines.append("#VIDEO:video.mp4")
    for tag, value in (
        ("LANGUAGE", song.language),
        ("GENRE", song.genre),
        ("YEAR", song.year),
        ("EDITION", song.edition),
    ):
        if value is not None:
            lines.append(f"#{tag}:{value}")
    lines.append("#CREATOR:Wingman documentation")
    lines.append("#BPM:200")
    lines.append("#GAP:0")
    # Milliseconds in the file, seconds in the app: `scanner.played_seconds` divides.
    lines.append(f"#END:{song.duration * 1000}")
    if song.duet:
        lines.append("#DUETSINGERP1:Singer 1")
        lines.append("#DUETSINGERP2:Singer 2")
    lines.append("E")
    return "\n".join(lines) + "\n"


# --- covers ------------------------------------------------------------------------------


def cover_png(song: FixtureSong) -> bytes:
    """An abstract cover for one song: two-tone ground, a record, a few bars.

    Deterministic in the song's own text, so the same song has the same cover in every
    run and two songs never look alike. No text is drawn — a cover with a title on it
    would have to be readable at every size the app uses one, and this is a placeholder.
    """
    seed = zlib.crc32(f"{song.artist}|{song.title}".encode())
    hue = (seed % 360) / 360.0
    accent_hue = (hue + 0.42 + ((seed >> 9) % 12) / 100.0) % 1.0
    top = _rgb(hue, 0.55, 0.30)
    bottom = _rgb((hue + 0.06) % 1.0, 0.62, 0.16)
    record = _rgb(accent_hue, 0.62, 0.88)
    hole = _rgb((hue + 0.03) % 1.0, 0.50, 0.22)
    bar = _rgb(accent_hue, 0.25, 0.97)

    size = COVER_SIZE
    centre_x = size // 2 + ((seed >> 3) % 41) - 20
    centre_y = size // 2 - 14 + ((seed >> 7) % 29) - 14
    radius = 68 + ((seed >> 11) % 26)
    bar_widths = [50 + ((seed >> (13 + index * 5)) % 90) for index in range(3)]

    rows = bytearray()
    for y in range(size):
        rows.append(0)  # PNG filter type "none"
        blend = y / (size - 1)
        ground = _mix(top, bottom, blend)
        row = bytearray()
        for x in range(size):
            colour = ground
            distance = (x - centre_x) ** 2 + (y - centre_y) ** 2
            if distance <= radius * radius:
                colour = record
                if distance <= (radius // 4) ** 2:
                    colour = hole
            elif _in_bar(x, y, size, bar_widths):
                colour = bar
            row += bytes(colour)
        rows += row
    return _png(size, size, bytes(rows))


def _in_bar(x: int, y: int, size: int, widths: list[int]) -> bool:
    """Three short bars near the bottom edge, like the spine of a record sleeve."""
    for index, width in enumerate(widths):
        top = size - 46 + index * 12
        if top <= y < top + 6 and 20 <= x < 20 + width:
            return True
    return False


def _rgb(hue: float, saturation: float, value: float) -> tuple[int, int, int]:
    red, green, blue = colorsys.hsv_to_rgb(hue, saturation, value)
    return round(red * 255), round(green * 255), round(blue * 255)


def _mix(
    start: tuple[int, int, int], end: tuple[int, int, int], amount: float
) -> tuple[int, int, int]:
    return (
        round(start[0] + (end[0] - start[0]) * amount),
        round(start[1] + (end[1] - start[1]) * amount),
        round(start[2] + (end[2] - start[2]) * amount),
    )


def _png(width: int, height: int, raw: bytes) -> bytes:
    """A truecolour 8-bit PNG. Four chunks and a signature — the format's whole minimum."""
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            _chunk(b"IHDR", header),
            _chunk(b"IDAT", zlib.compress(raw, 9)),
            _chunk(b"IEND", b""),
        ]
    )


def _chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", type=Path, help="the directory to write the song folders into")
    arguments = parser.parse_args()
    songs = load_songs()
    written = write_library(songs, arguments.target)
    print(f"wrote {len(written)} song folders to {arguments.target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
