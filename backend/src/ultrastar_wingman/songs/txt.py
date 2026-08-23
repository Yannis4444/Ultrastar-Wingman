"""USDX song `.txt` parsing.

USDX files are `#TAG:value` headers followed by note lines. They come in every
encoding a Windows karaoke library ever produced: UTF-8, UTF-8 with BOM (USDX
itself writes those) and legacy single-byte code pages, so the encoding is
detected instead of assumed.
"""

import codecs
import logging
from pathlib import Path

from charset_normalizer import from_bytes
from pydantic import BaseModel

logger = logging.getLogger(__name__)

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
        stripped = line.strip().lstrip("\ufeff")
        if not stripped.startswith("#"):
            continue
        name, separator, value = stripped[1:].partition(":")
        if separator and value.strip():
            tags.setdefault(name.strip().upper(), value.strip())
    return tags


def _year(value: str | None) -> int | None:
    # Libraries contain "unknown", "1998-2000" and empty years; none of them is fatal.
    if value is None or not value.strip().isdigit():
        return None
    return int(value.strip())
