"""USDX song `.txt` parsing.

USDX files are `#TAG:value` headers followed by note lines. They come in every
encoding a Windows karaoke library ever produced: UTF-8, UTF-8 with BOM (USDX
itself writes those) and legacy single-byte code pages, so the encoding is
detected instead of assumed.
"""

import codecs
import logging
import re
from pathlib import Path

from charset_normalizer import from_bytes
from pydantic import BaseModel

logger = logging.getLogger(__name__)

# A body line that hands the song to another singer: "P1", "P 2", "P3". Note lines start
# with ":", "*", "F", "R", "G", "-" or "E", so a bare "P<n>" can be nothing else.
_SINGER_LINE = re.compile(r"P\s*(\d+)", re.IGNORECASE)

# The header pairs that name a duet's two singers — the current spelling and the one
# older files use. Either pair, complete, marks a duet even when the body has no switch.
_DUET_HEADER_PAIRS: tuple[tuple[str, str], ...] = (
    ("DUETSINGERP1", "DUETSINGERP2"),
    ("P1", "P2"),
)

# The character a UTF-8 BOM decodes to. It sits in front of the first line, which is a
# header in every readable file, but the line loops must not trip over it either way.
_BOM_CHARACTER = "\ufeff"

_BOMS: tuple[tuple[bytes, str], ...] = (
    (codecs.BOM_UTF8, "utf-8-sig"),
    (codecs.BOM_UTF32_LE, "utf-32"),
    (codecs.BOM_UTF32_BE, "utf-32"),
    (codecs.BOM_UTF16_LE, "utf-16"),
    (codecs.BOM_UTF16_BE, "utf-16"),
)


class SongTxtError(ValueError):
    """The file is not a usable USDX song: TITLE or ARTIST is missing."""


class SongTxt(BaseModel):
    """Header data of a song `.txt`. File tags are names relative to the song directory,
    resolved to real paths by the scanner."""

    title: str
    artist: str
    audio: str | None = None
    cover: str | None = None
    video: str | None = None
    background: str | None = None
    language: str | None = None
    genre: str | None = None
    year: int | None = None
    edition: str | None = None
    creator: str | None = None
    # Two people share this song: the body hands it over at least once, or both duet
    # singer headers name somebody. A fact about the file, not a tag anybody set.
    is_duet: bool = False
    # The playback window USDX honours, both in **seconds** — `#START` is written in
    # seconds, `#END` in milliseconds, and normalizing that here keeps the unit trap in
    # one place. `start` skips the intro, `end` cuts the song off before the audio ends.
    start: float | None = None
    end: float | None = None


def parse_song_txt(text: str) -> SongTxt:
    tags = _tags(text)
    title, artist = tags.get("TITLE"), tags.get("ARTIST")
    if not title or not artist:
        raise SongTxtError("song txt without a TITLE and ARTIST tag")
    return SongTxt(
        title=title,
        artist=artist,
        # AUDIO is the current tag, MP3 the historic one; both name the audio file.
        audio=tags.get("AUDIO") or tags.get("MP3"),
        cover=tags.get("COVER"),
        video=tags.get("VIDEO"),
        background=tags.get("BACKGROUND"),
        language=tags.get("LANGUAGE"),
        genre=tags.get("GENRE"),
        year=_year(tags.get("YEAR")),
        edition=tags.get("EDITION"),
        creator=tags.get("CREATOR"),
        is_duet=_is_duet(text, tags),
        start=_positive(_decimal(tags.get("START"))),
        # Milliseconds in the file, seconds in the model.
        end=_positive(_milliseconds_to_seconds(_decimal(tags.get("END")))),
    )


def read_song_txt(path: Path) -> SongTxt:
    """Blocking: callers in async paths go through `asyncio.to_thread`."""
    return parse_song_txt(decode(path.read_bytes()))


def decode(raw: bytes) -> str:
    for bom, encoding in _BOMS:
        if raw.startswith(bom):
            return raw.decode(encoding)
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        match = from_bytes(raw).best()
        if match is not None:
            return str(match)
        # Nothing recognized it: cp1252 with replacements still yields readable tags.
        logger.warning("could not detect the encoding of a song txt, assuming cp1252")
        return raw.decode("cp1252", errors="replace")


def _tags(text: str) -> dict[str, str]:
    """First occurrence of each tag wins; unknown tags, empty values and note/junk lines
    are ignored (`#GENRE:` with nothing behind it means "no genre", not an empty genre)."""
    tags: dict[str, str] = {}
    for line in text.splitlines():
        stripped = line.strip().lstrip(_BOM_CHARACTER)
        if not stripped.startswith("#"):
            continue
        name, separator, value = stripped[1:].partition(":")
        if separator and value.strip():
            tags.setdefault(name.strip().upper(), value.strip())
    return tags


def _is_duet(text: str, tags: dict[str, str]) -> bool:
    """Whether two singers share the song.

    Two independent marks, either of which is enough: both duet singer headers, or a body
    that switches singer. *Two* different singer numbers are needed in the body — a file
    that opens with "P1" and never hands over is one person singing under a marker, which
    is what a converted solo song looks like.
    """
    if any(first in tags and second in tags for first, second in _DUET_HEADER_PAIRS):
        return True
    singers: set[int] = set()
    for line in text.splitlines():
        stripped = line.strip().lstrip(_BOM_CHARACTER)
        if stripped.startswith("#"):
            continue
        match = _SINGER_LINE.fullmatch(stripped)
        if match is not None:
            singers.add(int(match.group(1)))
            if len(singers) > 1:
                return True
    return False


def _year(value: str | None) -> int | None:
    # Libraries contain "unknown", "1998-2000" and empty years; none of them is fatal.
    if value is None or not value.strip().isdigit():
        return None
    return int(value.strip())


def _decimal(value: str | None) -> float | None:
    """A numeric tag. Editors on a German locale write "25,6" instead of "25.6", and a
    tag nobody can read is a tag that is not there."""
    if value is None:
        return None
    try:
        return float(value.strip().replace(",", "."))
    except ValueError:
        logger.debug("ignoring the unreadable numeric tag value '%s'", value)
        return None


def _milliseconds_to_seconds(value: float | None) -> float | None:
    return None if value is None else value / 1000


def _positive(value: float | None) -> float | None:
    """Zero means "not set" in USDX, and a negative window is nonsense either way."""
    return None if value is None or value <= 0 else value
