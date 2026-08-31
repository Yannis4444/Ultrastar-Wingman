"""USDX song `.txt` parsing — and the one way anything writes one back.

USDX files are `#TAG:value` headers followed by note lines. They come in every
encoding a Windows karaoke library ever produced: UTF-8, UTF-8 with BOM (USDX
itself writes those) and legacy single-byte code pages, so the encoding is
detected instead of assumed.

Reading is lenient: a file nothing can decode still yields its tags, because a
library the scanner refuses to read is worse than a mangled lyric. Writing
(`load_song_txt` + `rewrite_headers`) is the opposite — it touches the headers it
was told to touch and leaves every other byte of the file exactly as it found it,
the BOM, the line endings, the unknown headers and the whole body included.
"""

import codecs
import logging
import re
from collections.abc import Mapping
from dataclasses import dataclass
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

# (BOM bytes, codec for what follows them). The codec never consumes or writes a BOM of
# its own — the exact bytes above are kept and put back — so a UTF-16 BE file stays big
# endian instead of being flipped by `utf-16`'s encoder. UTF-32 LE starts with the UTF-16
# LE mark, so the wider one has to be tested first.
_BOMS: tuple[tuple[bytes, str], ...] = (
    (codecs.BOM_UTF8, "utf-8"),
    (codecs.BOM_UTF32_LE, "utf-32-le"),
    (codecs.BOM_UTF32_BE, "utf-32-be"),
    (codecs.BOM_UTF16_LE, "utf-16-le"),
    (codecs.BOM_UTF16_BE, "utf-16-be"),
)

# What a file whose bytes nobody recognized is read as. Lossy on purpose (see `decode`).
_FALLBACK_ENCODING = "cp1252"

# Every character `str.splitlines` ends a line on. `rewrite_headers` splits the file with
# `splitlines`, so it has to cut a single line into body and ending in the same places —
# a header ending in one of the exotic ones (U+0085, which is what byte 0x85 of a latin-1
# file decodes to, or U+2028) would otherwise have its ending read as part of the value and
# the line behind it glued onto the rewritten one.
_LINE_BREAKS = "\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029"


class SongTxtError(ValueError):
    """The file is not a usable USDX song: TITLE or ARTIST is missing."""


class SongTxtEncodingError(ValueError):
    """The file's bytes do not survive a decode/encode round trip, so writing it back would
    change bytes nobody asked to change — a code page Python cannot reproduce, or a byte
    that is undefined in the code page it was read as. Reading such a file is still fine
    (`decode` replaces what it cannot read); rewriting it is not."""

    def __init__(self, encoding: str) -> None:
        super().__init__(f"a song txt read as {encoding} does not re-encode to its own bytes")
        self.encoding = encoding


@dataclass(frozen=True)
class SongTxtFile:
    """A song `.txt` as it sits on disk: the decoded text plus what it takes to put it back
    the way it came — the codec its bytes were in and the exact BOM in front of them."""

    text: str
    encoding: str
    bom: bytes

    def encode(self, text: str) -> bytes:
        """The bytes to write for `text`. Raises `UnicodeEncodeError` when a value cannot be
        said in this file's encoding — a Japanese title in a cp1252 file."""
        return self.bom + text.encode(self.encoding)


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
    """Lenient: a byte nothing can read becomes a replacement character rather than an
    error, because a song the scanner refuses to import is worse than a mangled lyric.
    Use `load_song_txt` when the file is going to be written back."""
    bom, encoding = detect_encoding(raw)
    try:
        return raw[len(bom) :].decode(encoding, errors="replace")
    except LookupError:
        # The detector named a code page this Python has no codec for.
        logger.warning("no codec for the detected encoding '%s', assuming cp1252", encoding)
        return raw[len(bom) :].decode(_FALLBACK_ENCODING, errors="replace")


def load_song_txt(raw: bytes) -> SongTxtFile:
    """The file as something that can be written back byte-for-byte. Raises
    `SongTxtEncodingError` when its bytes do not survive the round trip — which is the only
    honest answer, since a rewrite of such a file would silently change the rest of it."""
    bom, encoding = detect_encoding(raw)
    try:
        text = raw[len(bom) :].decode(encoding)
    except (UnicodeDecodeError, LookupError) as error:
        raise SongTxtEncodingError(encoding) from error
    file = SongTxtFile(text=text, encoding=encoding, bom=bom)
    # The proof rather than the promise: whatever the detector said, these very bytes have
    # to come back out of it before anything is allowed to rewrite the file.
    try:
        if file.encode(text) != raw:
            raise SongTxtEncodingError(encoding)
    except UnicodeEncodeError as error:
        raise SongTxtEncodingError(encoding) from error
    return file


def detect_encoding(raw: bytes) -> tuple[bytes, str]:
    """The file's BOM (empty when it has none) and the codec for the bytes behind it."""
    for bom, encoding in _BOMS:
        if raw.startswith(bom):
            return bom, encoding
    try:
        raw.decode("utf-8")
    except UnicodeDecodeError:
        match = from_bytes(raw).best()
        if match is not None and match.encoding:
            return b"", match.encoding
        logger.warning("could not detect the encoding of a song txt, assuming cp1252")
        return b"", _FALLBACK_ENCODING
    return b"", "utf-8"


def rewrite_headers(text: str, changes: Mapping[str, str | None]) -> str:
    """`text` with the named headers set to their new values — a `None` removing the header.

    Everything else is untouched: the body, the headers nobody named, the order, the
    indentation and each line's own ending. A header that is not there yet is appended to
    the file's leading header block, in the order `changes` names them.
    """
    lines = text.splitlines(keepends=True)
    for name, value in changes.items():
        found = [index for index, line in enumerate(lines) if _header_name(line) == name]
        if value is None:
            # Every occurrence, not only the first: the parser takes the first one, so a
            # duplicate left behind would step into the removed header's place.
            for index in reversed(found):
                del lines[index]
        elif found:
            # The first one is the one the parser reads; a later duplicate was already
            # inert and stays exactly as it was.
            lines[found[0]] = _with_value(lines[found[0]], value)
        else:
            index = _insertion_point(lines)
            terminator = _terminator_near(lines, index)
            # A file whose last line has no newline gets one, or the new header would be
            # written onto the end of it.
            if index > 0:
                body, ending = _split_terminator(lines[index - 1])
                if not ending:
                    lines[index - 1] = body + terminator
            lines.insert(index, f"#{name}:{value}{terminator}")
    return "".join(lines)


def _header_name(line: str) -> str | None:
    """The upper-case tag name of a header line, or None for a body line. A header with an
    empty value (`#GENRE:`) is still a header — it is the line a new genre replaces."""
    stripped = line.strip().lstrip(_BOM_CHARACTER)
    if not stripped.startswith("#"):
        return None
    name, separator, _ = stripped[1:].partition(":")
    return name.strip().upper() if separator else None


def _with_value(line: str, value: str) -> str:
    """The line with everything behind its first colon replaced. Keeps the tag's own
    spelling, whatever whitespace sits in front of it and the line's ending."""
    body, terminator = _split_terminator(line)
    head, separator, _ = body.partition(":")
    return f"{head}{separator}{value}{terminator}"


def _split_terminator(line: str) -> tuple[str, str]:
    """One line of `splitlines(keepends=True)` cut where `splitlines` cut it: what the line
    says, and the ending that closed it."""
    body = line.rstrip(_LINE_BREAKS)
    return body, line[len(body) :]


def _insertion_point(lines: list[str]) -> int:
    """Right after the last header of the leading header block — before the notes, and
    before whatever else follows them."""
    after_last_header = 0
    for index, line in enumerate(lines):
        if _header_name(line) is not None:
            after_last_header = index + 1
        elif line.strip():
            break
    return after_last_header


def _terminator_near(lines: list[str], index: int) -> str:
    """The line ending its neighbours use: a file written with CRLF must not grow a lone
    LF line. CRLF when there is nothing to copy — it is what USDX itself writes."""
    for neighbour in ([lines[index - 1]] if index > 0 else []) + lines:
        _, terminator = _split_terminator(neighbour)
        if terminator:
            return terminator
    return "\r\n"


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
