"""Loudness normalization: ReplayGain tags measured and read with ffmpeg, written with mutagen.

Ultrastar Deluxe evens out the volume of its songs when its own `[Sound] ReplayGain`
option is on: it reads `REPLAYGAIN_TRACK_GAIN` (and `REPLAYGAIN_TRACK_PEAK`, a clipping
guard) out of ffmpeg's metadata of the audio file — the stream's for an Ogg file, the
container's for everything else — and never writes them itself. So Wingman writes them.

The values are ReplayGain 2.0: EBU R128 integrated loudness over the whole file, against a
reference of -18 LUFS, so the gain is `-18 - I` dB; the peak is the true peak as a linear
value (1.0 is full scale). USDX parses the gain as the first word of the tag, a `+` allowed,
and plays at `10^(gain/20)`, lowered to `1/peak` when the peak says that would clip. It
applies no pre-amp of its own. The format is decided in docs/dev/loudness.md.

The tags are written by mutagen, which rewrites the tag and touches no audio frame — never
by an ffmpeg stream copy, whose mp3 muxer adds an info frame to a file that has none and so
moves where its decoded audio starts (docs/dev/loudness.md). ffmpeg still reads them back:
its dictionary is what USDX sees.

Here because ffmpeg is the downloads' tool (`media.ensure_ffmpeg`), and because a download
is the first thing that tags a file. Every function takes the ffmpeg to run; nothing here
resolves one, so a pass over the library can hand in the same one for every song.

Nothing in here may fail a download: `normalize` and `normalize_song` turn every failure
into an `Outcome`, and only the three building blocks below them raise `LoudnessError`.
"""

import asyncio
import contextlib
import logging
import math
import os
import re
import shutil
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, NamedTuple

# Every format's class by name, never `mutagen.File` guessing alone: what a file is tagged
# as is decided here, and the frozen exe carries what is imported.
import mutagen
from mutagen.flac import FLAC
from mutagen.id3 import ID3, TXXX, Encoding, ID3v1SaveOptions
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4, AtomDataType, MP4FreeForm
from mutagen.oggopus import OggOpus
from mutagen.oggvorbis import OggVorbis
from sqlalchemy.ext.asyncio import AsyncSession

from ..songs.model import Song
from ..songs.schema import song_label

logger = logging.getLogger(__name__)

NORMALIZE_SETTING = "downloads.normalize_loudness"
# The download's step while the tag is written, as the downloads panel shows it.
LOUDNESS_STEP = "normalizing loudness"

GAIN_TAG = "REPLAYGAIN_TRACK_GAIN"
PEAK_TAG = "REPLAYGAIN_TRACK_PEAK"
# Opus's own scheme, which USDX falls back to when an Ogg Opus file has no ReplayGain tag:
# a Q7.8 number of dB against -23 LUFS, so USDX adds 5 dB to land on the same reference.
R128_TAG = "R128_TRACK_GAIN"
R128_OFFSET_DB = 5.0

REFERENCE_LUFS = -18.0
# ebur128's absolute gate. A file measured at the gate holds nothing it could gate on:
# silence, or so close to it that a gain of fifty decibels is not an answer.
SILENCE_LUFS = -70.0

# A ten-minute song takes a few seconds on a laptop. The bound is for a file ffmpeg chokes
# on, not for a slow machine.
MEASURE_TIMEOUT_SECONDS = 300.0
# Reading the tags never decodes anything.
TAG_TIMEOUT_SECONDS = 120.0

# What the temporary copy is called while it is being tagged, beside the original: the
# same folder, so `os.replace` is a rename and never a copy across drives.
TEMP_MARKER = ".wingman-loudness"

# The formats ever tagged: the ones whose tags were proven to come back where USDX reads
# them, with the samples unchanged (docs/dev/loudness.md). Anything else — a wav, a raw
# aac, a video named as the audio — is never copied at all.
WRITABLE_SUFFIXES = frozenset({".mp3", ".ogg", ".opus", ".flac", ".m4a"})

# What a write replaces, compared case-insensitively (`_is_replay_gain_key`).
_REPLACED_KEYS = frozenset({GAIN_TAG.casefold(), PEAK_TAG.casefold()})
# The longest ID3v1 tag mutagen takes off the end of an mp3 (and the most it reads as one).
_ID3V1_BYTES = 128
# An ID3v2 header, and the footer an ID3v2.4 tag may end in: the same ten bytes, `3DI` first.
_ID3V2_HEADER_BYTES = 10
_ID3V2_FOOTER_FLAG = 0x10
_COMPARE_CHUNK_BYTES = 1 << 20

_STDERR_TAIL_LINES = 5

_NUMBER = r"-?inf|-?\d+(?:\.\d+)?"
_INTEGRATED = re.compile(rf"Integrated loudness:\s*I:\s*(?P<value>{_NUMBER})\s*LUFS")
_TRUE_PEAK = re.compile(rf"True peak:\s*Peak:\s*(?P<value>{_NUMBER})\s*dBFS")

Status = Literal["tagged", "already_tagged", "unsupported", "silent", "missing", "in_use", "failed"]
# What is worth keeping on the song row: the values are the file's, whether Wingman wrote
# them or found them, or measured them for a file whose format keeps no tag.
STORED: frozenset[Status] = frozenset({"tagged", "already_tagged", "unsupported"})


class ReplayGain(NamedTuple):
    """A track gain in dB and its peak as a linear value. The peak is None for a tag that
    carries none, which USDX reads as "no clipping guard"."""

    gain_db: float
    peak: float | None


@dataclass(frozen=True)
class Outcome:
    """What `normalize` did to one file.

    - `tagged`: measured and written.
    - `already_tagged`: the file had a gain USDX can read, so it was left alone.
    - `unsupported`: measured, but the file's format keeps no such tag (a raw `.aac`, a
      `.wav`), or the file is not what its name says or is too damaged for mutagen to load,
      so the file was left alone.
    - `silent`: nothing to measure.
    - `missing`: no audio file at all.
    - `in_use`: measured, but another program holds the file open, so it could not be
      replaced. Worth trying again later.
    - `failed`: the file could not be read, measured or tagged. `detail` says why.
    """

    status: Status
    gain: ReplayGain | None = None
    detail: str | None = None

    @property
    def stored(self) -> ReplayGain | None:
        """The values to keep on the song row, or None to keep none."""
        return self.gain if self.status in STORED else None


class LoudnessError(RuntimeError):
    """A file could not be measured, read or tagged."""


class FileInUseError(LoudnessError):
    """The tagged copy is written, but the original cannot be replaced: on Windows that is
    another program holding it open — Ultrastar Deluxe playing it, a browser streaming it."""


class UnsupportedFormatError(LoudnessError):
    """The format has nowhere to keep the tags, is not one Wingman tags
    (`WRITABLE_SUFFIXES`), or the file is not what its name says."""


async def measure(ffmpeg: str, file: Path) -> ReplayGain | None:
    """The ReplayGain 2.0 values of `file`'s first audio stream, or None for silence.
    Raises `LoudnessError`."""
    _, stderr = await _ffmpeg(
        ffmpeg,
        [
            "-nostats",
            "-i",
            str(file),
            "-map",
            "0:a:0",
            # framelog=verbose: the per-frame line goes below the log level, ten lines a
            # second of a song otherwise. The summary is written whatever the level.
            "-af",
            "ebur128=framelog=verbose:peak=true",
            "-f",
            "null",
            "-",
        ],
        MEASURE_TIMEOUT_SECONDS,
    )
    summary = stderr.rpartition("Summary:")[2]
    integrated = _INTEGRATED.search(summary)
    true_peak = _TRUE_PEAK.search(summary)
    if integrated is None or true_peak is None:
        raise LoudnessError(f"ffmpeg measured no loudness in {file.name}")
    loudness = float(integrated.group("value"))
    if loudness <= SILENCE_LUFS:
        return None
    peak_db = float(true_peak.group("value"))
    peak = 0.0 if math.isinf(peak_db) else 10.0 ** (peak_db / 20.0)
    return ReplayGain(gain_db=round(REFERENCE_LUFS - loudness, 2), peak=round(peak, 6))


async def read_tags(ffmpeg: str, file: Path) -> ReplayGain | None:
    """The gain USDX would read out of `file`, or None when it would find none.
    Raises `LoudnessError`."""
    stdout, _ = await _ffmpeg(
        ffmpeg,
        [
            "-nostats",
            "-i",
            str(file),
            # Both dictionaries into one: the audio stream's (where an Ogg file keeps its
            # comments) and the container's (everything else). Which one wins a key both
            # carry was not checked: every file tested carries the tags on one level only.
            "-map_metadata",
            "0:s:a:0",
            "-map_metadata",
            "0",
            "-f",
            "ffmetadata",
            "-",
        ],
        TAG_TIMEOUT_SECONDS,
    )
    return _replay_gain(_ffmetadata(stdout))


async def write_tags(ffmpeg: str, file: Path, gain_db: float, peak: float | None) -> None:
    """Write the gain tag into `file`, and the peak tag beside it when there is a peak,
    replacing any of the two already there in whatever case, and touching nothing else:
    no audio frame, no other tag, no picture. Atomic: the file is copied beside itself, the
    copy is tagged with mutagen, and it only takes the file's place once ffmpeg reads the
    new gain back out of it — what USDX will read. The copy never outlives a failure.
    A format outside `WRITABLE_SUFFIXES` and a read-only file are refused before anything
    is copied. `ffmpeg` is only the reader. Raises `FileInUseError`, `UnsupportedFormatError`
    or `LoudnessError`."""
    suffix = file.suffix.casefold()
    if suffix not in WRITABLE_SUFFIXES:
        raise UnsupportedFormatError(f"{_kind(file)} is not a format Wingman tags")
    if not await asyncio.to_thread(os.access, file, os.W_OK):
        # Windows refuses to replace it anyway, and would call that "access denied", which
        # reads like a file in use; elsewhere it would be replaced against the host's will.
        raise LoudnessError(f"{file.name} is read-only")
    temporary = temporary_path(file)
    values = {GAIN_TAG: format_gain(gain_db)}
    if peak is not None:
        values[PEAK_TAG] = format_peak(peak)
    try:
        await asyncio.to_thread(_tagged_copy, file, temporary, values)
        written = await read_tags(ffmpeg, temporary)
        if written is None or not math.isclose(written.gain_db, gain_db, abs_tol=0.005):
            raise UnsupportedFormatError(f"ffmpeg finds no {GAIN_TAG} in {_kind(file)}")
        try:
            await asyncio.to_thread(os.replace, temporary, file)
        except PermissionError as error:
            raise FileInUseError(f"{file.name} is in use: {error.strerror or error}") from error
        except OSError as error:
            raise LoudnessError(
                f"could not replace {file.name}: {error.strerror or error}"
            ) from error
    finally:
        with contextlib.suppress(OSError):
            await asyncio.to_thread(_remove, temporary)


async def normalize(ffmpeg: str, file: Path) -> Outcome:
    """Read, and unless the file already carries a gain, measure and write. Never raises:
    every failure is an outcome, logged at debug level here — the caller knows which song
    it is and says so (`normalize_song`)."""
    if not await asyncio.to_thread(file.is_file):
        return Outcome("missing", detail=f"{file.name} is not there")
    try:
        existing = await read_tags(ffmpeg, file)
    except LoudnessError as error:
        return _failed(file, error)
    if existing is not None:
        logger.debug("%s already carries a gain of %s dB", file, existing.gain_db)
        return Outcome("already_tagged", existing)
    try:
        measured = await measure(ffmpeg, file)
    except LoudnessError as error:
        return _failed(file, error)
    if measured is None:
        logger.debug("%s is silent, so it gets no gain", file)
        return Outcome("silent")
    try:
        await write_tags(ffmpeg, file, measured.gain_db, measured.peak)
    except FileInUseError as error:
        return Outcome("in_use", measured, str(error))
    except UnsupportedFormatError as error:
        return Outcome("unsupported", measured, str(error))
    except LoudnessError as error:
        return _failed(file, error, measured)
    logger.debug("tagged %s with a gain of %s dB, peak %s", file, *measured)
    return Outcome("tagged", measured)


async def normalize_song(session: AsyncSession, ffmpeg: str, song: Song) -> Outcome:
    """`normalize` the song's audio file and keep what came of it on the row: the values
    for an outcome in `STORED`, nothing for any other — a song whose file could not be
    tagged reads as not normalized, which is what a later pass over the library looks
    for. Logs the outcome by the song's name; commits."""
    if song.audio_file is None:
        outcome = Outcome("missing", detail="the song names no audio file")
    else:
        outcome = await normalize(ffmpeg, Path(song.audio_file))
    stored = outcome.stored
    song.replay_gain_db = None if stored is None else stored.gain_db
    song.replay_gain_peak = None if stored is None else stored.peak
    await session.commit()
    label = song_label(song)
    if outcome.status in ("failed", "in_use"):
        logger.warning("Could not even out the loudness of %s: %s", label, outcome.detail)
    elif outcome.status == "unsupported":
        logger.info(
            "The loudness of %s is measured, but its audio file keeps no tag: %s",
            label,
            outcome.detail,
        )
    else:
        logger.debug("loudness of %s: %s %s", label, outcome.status, outcome.gain)
    return outcome


def format_gain(gain_db: float) -> str:
    """`-6.50 dB`: the ReplayGain spelling, which USDX splits at the space."""
    return f"{gain_db:.2f} dB"


def format_peak(peak: float) -> str:
    return f"{peak:.6f}"


def temporary_path(file: Path) -> Path:
    return file.with_name(f"{file.stem}{TEMP_MARKER}{file.suffix}")


def _kind(file: Path) -> str:
    """`a .wav file`, for the line that says why a file was left alone."""
    return f"a {file.suffix} file" if file.suffix else "a file without an extension"


def _tagged_copy(file: Path, temporary: Path, values: dict[str, str]) -> None:
    """Blocking. Copy `file` to `temporary` and write `values` into the copy's tag.
    Raises `UnsupportedFormatError` when mutagen cannot load the copy as the format its
    name says, `LoudnessError` for everything else — and nothing but these two."""
    try:
        # A copy a crash left behind is written over, never tagged a second time.
        _remove(temporary)
        shutil.copy2(file, temporary)
    except OSError as error:
        raise LoudnessError(f"could not copy {file.name}: {error.strerror or error}") from error
    suffix = file.suffix.casefold()
    try:
        _WRITERS[suffix](file, temporary, values)
    except _NotThatFormatError as error:
        kind = _FORMAT_NAMES[suffix]
        raise UnsupportedFormatError(f"{file.name} is not {kind} mutagen reads: {error}") from error
    except LoudnessError:
        raise
    except Exception as error:
        # Not only `MutagenError` and `OSError`: on a damaged file mutagen's parsers and its
        # byte shuffling also raise `IndexError`, `ValueError` and the like, and none of them
        # may get past `normalize`.
        raise LoudnessError(f"could not tag {file.name}: {_reason(error)}") from error


class _NotThatFormatError(Exception):
    """mutagen cannot load the file as the format its suffix names."""


def _load(load: Callable[[], Any]) -> Any:
    """`load()`, its refusal turned into `_NotThatFormatError`. The file is the copy just
    made, so a refusal is the content's and not the disk's — whatever mutagen raises: its
    parsers die on a damaged file with an `IndexError` as readily as with a `MutagenError`."""
    try:
        return load()
    except Exception as error:
        raise _NotThatFormatError(_reason(error)) from error


def _reason(error: Exception) -> str:
    """The error's message, or its name for one that carries none (mutagen raises a bare
    `ValueError` or `HeaderNotFoundError` here and there)."""
    return str(error) or type(error).__name__


def _is_replay_gain_key(name: str) -> bool:
    """Whether a tag of `name` is the track gain or the track peak, in whatever case:
    mutagen keys a frame or an atom by its exact name, and ffmpeg's dictionary ignores case,
    so a `replaygain_track_gain` left beside the new one would be the same key twice. Both
    always go, so an old peak never stays beside a new gain written without one."""
    return name.casefold() in _REPLACED_KEYS


def _tag_mp3(file: Path, temporary: Path, values: dict[str, str]) -> None:
    """ID3v2 `TXXX` frames, in the version the tag already has — ID3v2.3 for a file
    without one. mutagen rewrites the ID3v2 tag at the head of the file and nothing after
    it; an ID3v1 tag at the end, which mutagen would rewrite out of the ID3v2 frames (and,
    loaded, copy into them), is put back byte for byte. Then every byte after the tag is
    held to the original's: the audio frames, an APEv2 tag, the ID3v1."""
    _absorb_id3v2_footer(temporary)
    size = temporary.stat().st_size
    audio = _load(lambda: MP3(temporary, load_v1=False, translate=False))
    if audio.tags is None:
        audio.add_tags()
        tag_size, version = 0, 3
    elif audio.tags.version >= (2, 3, 0):
        # Saved in the version it was read in, as it was read: an unknown frame survives
        # only that way, and translating would turn the other frames into the other
        # version's.
        tag_size, version = audio.tags.size, audio.tags.version[1]
    else:
        # ID3v2.2, which mutagen reads but cannot write: translated to 2.3.
        audio = _load(lambda: MP3(temporary, load_v1=False, v2_version=3))
        tag_size, version = audio.tags.size, 3
    tags = audio.tags
    for frame in tags.getall("TXXX"):
        if _is_replay_gain_key(frame.desc):
            del tags[frame.HashKey]
    for key, value in values.items():
        tags.add(TXXX(encoding=Encoding.LATIN1, desc=key, text=[value]))
    # `v23_sep=None`: a 2.3 frame holding several values keeps them as it held them.
    audio.save(v1=ID3v1SaveOptions.REMOVE, v2_version=version, v23_sep=None)
    new_tag_size = ID3(temporary, load_v1=False, translate=False).size
    removed = (size - tag_size) - (temporary.stat().st_size - new_tag_size)
    if 0 < removed <= _ID3V1_BYTES:
        # What `REMOVE` took off the end: the ID3v1 tag, as the original has it.
        with file.open("rb") as original, temporary.open("ab") as copy:
            original.seek(-removed, os.SEEK_END)
            copy.write(original.read(removed))
    if not _same_bytes(file, tag_size, temporary, new_tag_size):
        raise LoudnessError(f"tagging {file.name} would change more than its ID3v2 tag")


def _absorb_id3v2_footer(temporary: Path) -> None:
    """Blocking. Fold the ten-byte footer an ID3v2.4 tag may end in into the tag, as padding.

    mutagen leaves a footer out of the tag's size and rewrites the tag without one, so the
    old footer would stay behind between the new tag and the first audio frame — junk ffmpeg
    skips, losing the info frame behind it, so the decoded audio would start 23 ms earlier.
    In the copy alone: the footer's bytes zeroed, its flag cleared and the declared size ten
    bytes longer, so the tag mutagen reads ends where the original's really ends."""
    with temporary.open("r+b") as copy:
        header = copy.read(_ID3V2_HEADER_BYTES)
        if (
            len(header) < _ID3V2_HEADER_BYTES
            or header[:3] != b"ID3"
            or header[3] != 4
            or not header[5] & _ID3V2_FOOTER_FLAG
            or any(byte & 0x80 for byte in header[6:10])
        ):
            return
        size = sum(header[6 + index] << (7 * (3 - index)) for index in range(4))
        longer = size + _ID3V2_HEADER_BYTES
        copy.seek(_ID3V2_HEADER_BYTES + size)
        if copy.read(3) != b"3DI" or longer >= 1 << 28:
            return
        copy.seek(_ID3V2_HEADER_BYTES + size)
        copy.write(bytes(_ID3V2_HEADER_BYTES))
        copy.seek(5)
        copy.write(bytes([header[5] & ~_ID3V2_FOOTER_FLAG & 0xFF]))
        copy.write(bytes((longer >> shift) & 0x7F for shift in (21, 14, 7, 0)))


def _tag_ogg(file: Path, temporary: Path, values: dict[str, str]) -> None:
    """Vorbis comments, for Ogg Vorbis or Ogg Opus whichever the suffix says: an `.ogg`
    may hold Opus, so the content decides."""
    audio = _load(lambda: mutagen.File(temporary, options=[OggVorbis, OggOpus]))
    if audio is None:
        raise _NotThatFormatError("neither Ogg Vorbis nor Ogg Opus")
    _set_comments(audio, values)


def _tag_flac(file: Path, temporary: Path, values: dict[str, str]) -> None:
    """Vorbis comments in the FLAC metadata block, added when there is none."""
    audio = _load(lambda: FLAC(temporary))
    if audio.tags is None:
        audio.add_tags()
    _set_comments(audio, values)


def _set_comments(audio: Any, values: dict[str, str]) -> None:
    for key in (GAIN_TAG, PEAK_TAG):
        # Every comment of the key, in whatever case: mutagen compares Vorbis comment keys
        # case-insensitively, as ffmpeg's dictionary does.
        with contextlib.suppress(KeyError):
            del audio.tags[key]
    for key, value in values.items():
        audio.tags[key] = [value]
    audio.save()


def _tag_m4a(file: Path, temporary: Path, values: dict[str, str]) -> None:
    """iTunes freeform atoms, `----:com.apple.iTunes:<key>`, which ffmpeg reads under the
    bare key into the container's dictionary. A freeform atom of the same name under any
    other mean is the same key there, so it goes too."""
    audio = _load(lambda: MP4(temporary))
    if audio.tags is None:
        audio.add_tags()
    tags = audio.tags
    for name in list(tags.keys()):
        if name.startswith("----:") and _is_replay_gain_key(name.rpartition(":")[2]):
            del tags[name]
    for key, value in values.items():
        tags[f"----:com.apple.iTunes:{key}"] = [
            MP4FreeForm(value.encode("ascii"), dataformat=AtomDataType.UTF8)
        ]
    audio.save()


_WRITERS: dict[str, Callable[[Path, Path, dict[str, str]], None]] = {
    ".mp3": _tag_mp3,
    ".ogg": _tag_ogg,
    ".opus": _tag_ogg,
    ".flac": _tag_flac,
    ".m4a": _tag_m4a,
}
_FORMAT_NAMES = {
    ".mp3": "an mp3",
    ".ogg": "an Ogg file",
    ".opus": "an Ogg Opus file",
    ".flac": "a FLAC file",
    ".m4a": "an MPEG-4 audio file",
}


def _same_bytes(first: Path, first_start: int, second: Path, second_start: int) -> bool:
    """Blocking. Whether `first` from `first_start` on and `second` from `second_start` on
    hold the same bytes."""
    with first.open("rb") as one, second.open("rb") as other:
        one.seek(first_start)
        other.seek(second_start)
        while True:
            chunk = one.read(_COMPARE_CHUNK_BYTES)
            if chunk != other.read(_COMPARE_CHUNK_BYTES):
                return False
            if not chunk:
                return True


def _failed(file: Path, error: LoudnessError, measured: ReplayGain | None = None) -> Outcome:
    logger.debug("loudness of %s: %s", file, error)
    return Outcome("failed", measured, str(error))


def _ffmetadata(text: str) -> dict[str, str]:
    r"""ffmpeg's `ffmetadata` format, keys upper-cased (ffmpeg's own lookups ignore case,
    USDX's included): `key=value` lines under `;FFMETADATA1`, `\` escaping `=`, `;`, `#`,
    `\` and a newline. Sections (`[CHAPTER]`, `[STREAM]`) end the global part."""
    values: dict[str, str] = {}
    lines = iter(text.splitlines())
    for line in lines:
        if line.startswith("["):
            break
        if not line or line.startswith((";", "#")):
            continue
        # A value ending in an unescaped backslash continues on the next line.
        while _escapes_newline(line):
            line = line[:-1] + "\n" + next(lines, "")
        key, separator, value = _split_unescaped(line)
        if separator:
            values[key.upper()] = value
    return values


def _escapes_newline(line: str) -> bool:
    trailing = len(line) - len(line.rstrip("\\"))
    return trailing % 2 == 1


def _split_unescaped(line: str) -> tuple[str, bool, str]:
    key: list[str] = []
    value: list[str] = []
    target = key
    separator = False
    characters = iter(line)
    for character in characters:
        if character == "\\":
            target.append(next(characters, ""))
        elif character == "=" and not separator:
            separator = True
            target = value
        else:
            target.append(character)
    return "".join(key), separator, "".join(value)


def _replay_gain(tags: dict[str, str]) -> ReplayGain | None:
    """The gain as USDX reads it: the first word of the gain tag, a leading `+` allowed;
    a peak only alongside a gain. A tag USDX could not parse is no tag at all — the file
    plays unevened there, so it is worth measuring."""
    gain = _parse_gain(tags.get(GAIN_TAG))
    if gain is not None:
        return ReplayGain(gain_db=gain, peak=_parse_float(tags.get(PEAK_TAG)))
    r128 = _parse_float(tags.get(R128_TAG))
    if r128 is not None:
        return ReplayGain(gain_db=round(r128 / 256.0 + R128_OFFSET_DB, 2), peak=None)
    return None


def _parse_gain(value: str | None) -> float | None:
    words = (value or "").split()
    if not words:
        return None
    return _parse_float(words[0].removeprefix("+"))


def _parse_float(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        number = float(value.strip())
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def _remove(path: Path) -> None:
    """Blocking."""
    path.unlink(missing_ok=True)


async def _ffmpeg(ffmpeg: str, arguments: Sequence[str], seconds: float) -> tuple[str, str]:
    """Run ffmpeg to the end and answer its stdout and stderr. Raises `LoudnessError` when
    it cannot be started, fails, or runs past `seconds` — and then it is stopped,
    as it is when the caller is cancelled: an ffmpeg left running would hold the file.

    stdin is closed and `-nostdin` given, the `media._run` rule: ffmpeg must never read the
    host's keys in the console window."""
    command = [ffmpeg, "-hide_banner", "-nostdin", *arguments]
    logger.debug("running %s", command)
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except OSError as error:
        raise LoudnessError(f"cannot run '{ffmpeg}': {error}") from error
    try:
        async with asyncio.timeout(seconds):
            stdout, stderr = await process.communicate()
    except TimeoutError:
        raise LoudnessError(f"ffmpeg took longer than {seconds:.0f} s") from None
    finally:
        if process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                process.kill()
            await process.wait()
    errors = stderr.decode(errors="replace")
    if process.returncode != 0:
        tail = " ".join(line.strip() for line in errors.splitlines()[-_STDERR_TAIL_LINES:])
        raise LoudnessError(
            f"ffmpeg failed with exit code {process.returncode}: {tail or 'no error output'}"
        )
    return stdout.decode("utf-8", errors="replace"), errors
