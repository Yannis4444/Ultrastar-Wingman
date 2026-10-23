"""Loudness normalization: ReplayGain tags measured and written with ffmpeg.

Ultrastar Deluxe evens out the volume of its songs when its own `[Sound] ReplayGain`
option is on: it reads `REPLAYGAIN_TRACK_GAIN` (and `REPLAYGAIN_TRACK_PEAK`, a clipping
guard) out of ffmpeg's metadata of the audio file — the stream's for an Ogg file, the
container's for everything else — and never writes them itself. So Wingman writes them.

The values are ReplayGain 2.0: EBU R128 integrated loudness over the whole file, against a
reference of -18 LUFS, so the gain is `-18 - I` dB; the peak is the true peak as a linear
value (1.0 is full scale). USDX parses the gain as the first word of the tag, a `+` allowed,
and plays at `10^(gain/20)`, lowered to `1/peak` when the peak says that would clip. It
applies no pre-amp of its own. The format is decided in docs/dev/loudness.md.

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
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, NamedTuple

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
# Reading the tags or copying the streams into a new file never decodes anything.
TAG_TIMEOUT_SECONDS = 120.0

# What the temporary copy is called while it is being written, beside the original: the
# same folder, so `os.replace` is a rename and never a copy across drives, and the same
# suffix, because that is how ffmpeg picks the container it writes.
TEMP_MARKER = ".wingman-loudness"

# The formats a copy is ever written for: the ones whose tags were proven to come back
# where USDX reads them, with the samples unchanged (docs/dev/loudness.md). Anything else —
# an m4a, a wav, a video named as the audio — is never copied at all, so a format nobody
# has tried is never rewritten on the strength of a read-back alone.
WRITABLE_SUFFIXES = frozenset({".mp3", ".ogg", ".opus", ".flac"})

# How far the copy's length may stray from the original's before the copy is refused: the
# two are the same packets, so anything more is a copy that lost some of them.
DURATION_TOLERANCE_SECONDS = 0.5
DURATION_TOLERANCE_SHARE = 0.01
# How far its start may move: an mp3 without an info frame gains one in the copy, and the
# decoder then skips the encoder's delay, so the song would play some 12 ms early against
# its lyrics. Same packets, other samples — refused.
START_TOLERANCE_SECONDS = 0.001

_STDERR_TAIL_LINES = 5

_NUMBER = r"-?inf|-?\d+(?:\.\d+)?"
_INTEGRATED = re.compile(rf"Integrated loudness:\s*I:\s*(?P<value>{_NUMBER})\s*LUFS")
_TRUE_PEAK = re.compile(rf"True peak:\s*Peak:\s*(?P<value>{_NUMBER})\s*dBFS")
# ffmpeg's dump of an input (never of an output): `Duration: 00:03:59.98, start: 0.025057`.
_DURATION = re.compile(r"Duration:\s*(?P<h>\d+):(?P<m>\d{2}):(?P<s>\d{2}(?:\.\d+)?)")
_START = re.compile(r"Duration:[^\n]*?start:\s*(?P<s>-?\d+(?:\.\d+)?)")

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
      `.wav`, an `.m4a`), so the file was left alone.
    - `silent`: nothing to measure.
    - `missing`: no audio file at all.
    - `in_use`: measured, but another program holds the file open, so it could not be
      replaced. Worth trying again later.
    - `failed`: ffmpeg could not read or write the file. `detail` says why.
    """

    status: Status
    gain: ReplayGain | None = None
    detail: str | None = None

    @property
    def stored(self) -> ReplayGain | None:
        """The values to keep on the song row, or None to keep none."""
        return self.gain if self.status in STORED else None


class LoudnessError(RuntimeError):
    """ffmpeg could not measure, read or write a file."""


class FileInUseError(LoudnessError):
    """The tagged copy is written, but the original cannot be replaced: on Windows that is
    another program holding it open — Ultrastar Deluxe playing it, a browser streaming it."""


class UnsupportedFormatError(LoudnessError):
    """The format has nowhere to keep the tags, or is not one a copy is written for
    (`WRITABLE_SUFFIXES`)."""


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
    gain, _ = await _read(ffmpeg, file)
    return gain


async def _read(ffmpeg: str, file: Path) -> tuple[ReplayGain | None, str]:
    """`read_tags`, and ffmpeg's dump of the file, for its length and its start."""
    stdout, stderr = await _ffmpeg(
        ffmpeg,
        [
            # The default log level, for the dump's `Duration:` line.
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
    return _replay_gain(_ffmetadata(stdout)), stderr


async def write_tags(ffmpeg: str, file: Path, gain_db: float, peak: float | None) -> None:
    """Write the gain tag into `file`, and the peak tag beside it when there is a peak,
    keeping every stream and every other tag ffmpeg knows — a cover picture included — as
    it is. Atomic: a copy is written beside the file and only takes its place once it reads
    back with the tags in it, as long as the file and starting where it starts, and the
    copy never outlives a failure.
    A format outside `WRITABLE_SUFFIXES` and a read-only file are refused before anything
    is copied. Raises `FileInUseError`, `UnsupportedFormatError` or `LoudnessError`."""
    if file.suffix.casefold() not in WRITABLE_SUFFIXES:
        raise UnsupportedFormatError(f"{_kind(file)} is not a format Wingman tags")
    if not await asyncio.to_thread(os.access, file, os.W_OK):
        # Windows refuses to replace it anyway, and would call that "access denied", which
        # reads like a file in use; elsewhere it would be replaced against the host's will.
        raise LoudnessError(f"{file.name} is read-only")
    temporary = temporary_path(file)
    values = {GAIN_TAG: format_gain(gain_db)}
    if peak is not None:
        values[PEAK_TAG] = format_peak(peak)
    tags: list[str] = []
    for key, value in values.items():
        # Both levels: an Ogg file keeps its comments on the stream and an existing value
        # there would win over a new one on the container, while an mp3 writes only the
        # container's. Neither writes a key twice.
        tags += ["-metadata", f"{key}={value}", "-metadata:s:a:0", f"{key}={value}"]
    # ID3v2.3 rather than ffmpeg's default 2.4: it is what every tag reader can read.
    container = ["-id3v2_version", "3"] if file.suffix.casefold() == ".mp3" else []
    try:
        await asyncio.to_thread(_remove, temporary)
        _, copy_log = await _ffmpeg(
            ffmpeg,
            [
                # The default log level, for the dump's `Duration:` line of the original:
                # an exit code of 0 is not taken as proof that the copy lost nothing.
                "-nostats",
                "-i",
                str(file),
                "-map",
                "0",
                "-c",
                "copy",
                "-map_metadata",
                "0",
                *container,
                *tags,
                "-y",
                str(temporary),
            ],
            TAG_TIMEOUT_SECONDS,
        )
        written, read_log = await _read(ffmpeg, temporary)
        if written is None or not math.isclose(written.gain_db, gain_db, abs_tol=0.005):
            raise UnsupportedFormatError(f"{_kind(file)} keeps no {GAIN_TAG}")
        _check_length(file, _duration(copy_log), _duration(read_log))
        _check_start(file, _start(copy_log), _start(read_log))
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


def _check_length(file: Path, original: float | None, copy: float | None) -> None:
    """Refuse a copy that does not play as long as the file it would replace. A file whose
    length ffmpeg cannot tell is not held to one; a copy whose length it cannot tell, of a
    file whose length it can, is refused."""
    if original is None:
        return
    allowed = max(DURATION_TOLERANCE_SECONDS, original * DURATION_TOLERANCE_SHARE)
    if copy is None or abs(copy - original) > allowed:
        length = "of unknown length" if copy is None else f"{copy:.2f} s long"
        raise LoudnessError(
            f"the tagged copy of {file.name} is {length}, the file {original:.2f} s"
        )


def _check_start(file: Path, original: float | None, copy: float | None) -> None:
    """Refuse a copy whose audio starts elsewhere than the file's, under the same rule for
    an unknown start as `_check_length`."""
    if original is None:
        return
    if copy is None or abs(copy - original) > START_TOLERANCE_SECONDS:
        start = "at an unknown point" if copy is None else f"at {copy:.3f} s"
        raise LoudnessError(
            f"the tagged copy of {file.name} starts {start}, the file at {original:.3f} s"
        )


def _duration(stderr: str) -> float | None:
    """The input's length out of ffmpeg's dump of it, in seconds; None for `Duration: N/A`
    or no dump at all."""
    match = _DURATION.search(stderr)
    if match is None:
        return None
    return int(match["h"]) * 3600 + int(match["m"]) * 60 + float(match["s"])


def _start(stderr: str) -> float | None:
    """Where the input's first sample plays, in seconds, out of the same line."""
    match = _START.search(stderr)
    return None if match is None else float(match["s"])


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
