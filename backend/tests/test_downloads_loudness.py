"""Loudness normalization: measuring, reading and writing ReplayGain tags with ffmpeg.

Two kinds of test. Most run against `FAKE_FFMPEG`, a stand-in that keeps a "file" as JSON
(its audio and its tags) and answers the three things `downloads.loudness` asks of ffmpeg —
the ebur128 summary, the ffmetadata dump and the stream copy. The last two run the real
ffmpeg over files it generates itself, to prove the tags come back under the names Ultrastar
Deluxe asks for; they are skipped where there is no ffmpeg (`WINGMAN_TEST_FFMPEG`, else the
one on `PATH`).
"""

import json
import logging
import math
import os
import shutil
import sqlite3
import stat
import subprocess
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy.ext.asyncio import AsyncSession

from test_downloads_media import fake_executable
from ultrastar_wingman.db import migrations_dir
from ultrastar_wingman.downloads import loudness
from ultrastar_wingman.downloads.loudness import Outcome, ReplayGain
from ultrastar_wingman.songs.model import Song

# A file is `{"audio": ..., "tags": {...}}`; anything that is not JSON is a corrupt file.
FAKE_FFMPEG = r"""
import json
import pathlib
import sys
import time

arguments = sys.argv[1:]
here = pathlib.Path(__file__).parent
with (here / "ffmpeg-calls.jsonl").open("a", encoding="utf-8") as log:
    log.write(json.dumps(arguments) + "\n")
control_file = here / "ffmpeg-control.json"
control = json.loads(control_file.read_text(encoding="utf-8")) if control_file.is_file() else {}
output = pathlib.Path(arguments[-1])


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


if "-vn" in arguments:
    # `media.extract_audio`: whatever the video, the audio is a fresh, untagged file.
    output.write_text(json.dumps({"audio": "extracted", "tags": {}}), encoding="utf-8")
    sys.exit(0)

source = pathlib.Path(arguments[arguments.index("-i") + 1])
try:
    song = json.loads(source.read_text(encoding="utf-8"))
except (OSError, ValueError):
    fail(f"{source}: Invalid data found when processing input")
# The dump of the input every run prints at the default log level.
if "duration" in song:
    seconds = song["duration"]
    sys.stderr.write(
        f"Input #0, mp3, from '{source}':\n"
        f"  Duration: 00:{int(seconds) // 60:02d}:{seconds % 60:05.2f}, "
        f"start: {song.get('start', 0.0):.6f}\n"
    )

if any("ebur128" in argument for argument in arguments):
    if control.get("measure_fails"):
        fail("Error while filtering: Invalid data found when processing input")
    time.sleep(control.get("measure_sleep", 0))
    sys.stderr.write(
        "[Parsed_ebur128_0 @ 0000020d] Summary:\n\n"
        "  Integrated loudness:\n"
        f"    I:         {control.get('integrated', '-25.9')} LUFS\n"
        "    Threshold: -35.9 LUFS\n\n"
        "  Loudness range:\n"
        "    LRA:         5.6 LU\n\n"
        "  True peak:\n"
        f"    Peak:      {control.get('true_peak', '-14.4')} dBFS\n"
    )
    sys.exit(0)

if "ffmetadata" in arguments:
    print(";FFMETADATA1")
    for key, value in song["tags"].items():
        print(f"{key}={value}")
    sys.exit(0)

if control.get("write_fails"):
    fail("Could not write header (incorrect codec parameters ?): Invalid argument")
tags = dict(song["tags"])
if not control.get("drops_tags"):
    for flag, value in zip(arguments, arguments[1:]):
        if flag.startswith("-metadata"):
            key, _, text = value.partition("=")
            tags[key] = text
copy = {"audio": song["audio"], "tags": tags}
if "duration" in song:
    copy["duration"] = song["duration"] / 2 if control.get("truncates") else song["duration"]
    copy["start"] = control.get("moves_start_to", song.get("start", 0.0))
output.write_text(json.dumps(copy), encoding="utf-8")
"""

# What the fake measures by default: -25.9 LUFS, a true peak of -14.4 dBFS.
DEFAULT_GAIN = ReplayGain(gain_db=7.9, peak=round(10 ** (-14.4 / 20), 6))


def fake_ffmpeg(directory: Path, **control: object) -> str:
    """The fake, in a directory of its own, behaving as `control` says (`measure_fails`,
    `write_fails`, `drops_tags`, `truncates`, `moves_start_to`, `measure_sleep`, `integrated`,
    `true_peak`)."""
    directory.mkdir(parents=True, exist_ok=True)
    if control:
        (directory / "ffmpeg-control.json").write_text(json.dumps(control), encoding="utf-8")
    return str(fake_executable(directory, "ffmpeg", FAKE_FFMPEG))


def fake_audio(
    path: Path, tags: dict[str, str] | None = None, duration: float | None = None
) -> Path:
    """A fake audio file; with `duration`, the fake's dump of it says how long it plays."""
    path.parent.mkdir(parents=True, exist_ok=True)
    content: dict[str, object] = {"audio": "song", "tags": tags or {}}
    if duration is not None:
        content["duration"] = duration
    path.write_text(json.dumps(content), encoding="utf-8")
    return path


def tags_of(path: Path) -> dict[str, str]:
    return dict(json.loads(path.read_text(encoding="utf-8"))["tags"])


def ffmpeg_calls(ffmpeg: str) -> list[list[str]]:
    log = Path(ffmpeg).parent / "ffmpeg-calls.jsonl"
    if not log.is_file():
        return []
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]


def kinds(ffmpeg: str) -> list[str]:
    """Each call by what it was: `measure`, `read` or `write`."""

    def kind(arguments: list[str]) -> str:
        if any("ebur128" in argument for argument in arguments):
            return "measure"
        return "read" if "ffmetadata" in arguments else "write"

    return [kind(arguments) for arguments in ffmpeg_calls(ffmpeg)]


@pytest.fixture
def ffmpeg(tmp_path: Path) -> str:
    return fake_ffmpeg(tmp_path / "tools")


# --- measure -----------------------------------------------------------------------------


async def test_measure_is_replaygain_2_against_minus_18_lufs(ffmpeg: str, tmp_path: Path) -> None:
    song = fake_audio(tmp_path / "song.mp3")

    measured = await loudness.measure(ffmpeg, song)

    assert measured == DEFAULT_GAIN
    [arguments] = ffmpeg_calls(ffmpeg)
    # The whole file, the first audio stream, the true peak, no per-frame log, no output.
    assert arguments[arguments.index("-map") + 1] == "0:a:0"
    assert arguments[arguments.index("-af") + 1] == "ebur128=framelog=verbose:peak=true"
    assert arguments[-3:] == ["-f", "null", "-"]
    assert "-nostdin" in arguments


async def test_a_loud_song_gets_a_negative_gain(tmp_path: Path) -> None:
    ffmpeg = fake_ffmpeg(tmp_path / "tools", integrated="-9.4", true_peak="0.3")

    measured = await loudness.measure(ffmpeg, fake_audio(tmp_path / "song.mp3"))

    assert measured is not None
    assert measured.gain_db == -8.6
    # Above full scale: a true peak between samples is what the clipping guard is for.
    assert measured.peak == round(10 ** (0.3 / 20), 6)
    assert measured.peak > 1.0


async def test_silence_is_not_measured(tmp_path: Path) -> None:
    ffmpeg = fake_ffmpeg(tmp_path / "tools", integrated="-70.0", true_peak="-inf")

    assert await loudness.measure(ffmpeg, fake_audio(tmp_path / "song.mp3")) is None


async def test_measure_reports_what_ffmpeg_said(tmp_path: Path) -> None:
    ffmpeg = fake_ffmpeg(tmp_path / "tools", measure_fails=True)

    with pytest.raises(loudness.LoudnessError, match="Invalid data found"):
        await loudness.measure(ffmpeg, fake_audio(tmp_path / "song.mp3"))


async def test_a_run_without_a_summary_is_a_failure(tmp_path: Path) -> None:
    ffmpeg = str(fake_executable(tmp_path, "ffmpeg", "print('hello')\n"))

    with pytest.raises(loudness.LoudnessError, match="measured no loudness"):
        await loudness.measure(ffmpeg, fake_audio(tmp_path / "song.mp3"))


async def test_an_ffmpeg_that_cannot_be_started_is_a_failure(tmp_path: Path) -> None:
    with pytest.raises(loudness.LoudnessError, match="cannot run"):
        await loudness.measure(str(tmp_path / "no-ffmpeg-here"), fake_audio(tmp_path / "a.mp3"))


async def test_an_ffmpeg_that_takes_too_long_is_stopped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(loudness, "MEASURE_TIMEOUT_SECONDS", 0.2)
    ffmpeg = fake_ffmpeg(tmp_path / "tools", measure_sleep=1)

    with pytest.raises(loudness.LoudnessError, match="took longer than"):
        await loudness.measure(ffmpeg, fake_audio(tmp_path / "song.mp3"))


# --- read_tags ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("tags", "expected"),
    [
        ({}, None),
        (
            {"REPLAYGAIN_TRACK_GAIN": "-6.50 dB", "REPLAYGAIN_TRACK_PEAK": "0.988553"},
            ReplayGain(-6.5, 0.988553),
        ),
        # Other taggers write the keys in lower case, and ffmpeg's lookups ignore case.
        ({"replaygain_track_gain": "-3.2 dB"}, ReplayGain(-3.2, None)),
        # USDX strips a `+`, though the standard has none.
        ({"REPLAYGAIN_TRACK_GAIN": "+2.10 dB"}, ReplayGain(2.1, None)),
        ({"REPLAYGAIN_TRACK_GAIN": "-1.5"}, ReplayGain(-1.5, None)),
        # A gain USDX cannot parse plays unevened there, so it counts as no tag.
        ({"REPLAYGAIN_TRACK_GAIN": "loud"}, None),
        ({"REPLAYGAIN_TRACK_GAIN": "nan dB"}, None),
        # A peak without a gain is nothing USDX does anything with.
        ({"REPLAYGAIN_TRACK_PEAK": "0.5"}, None),
        ({"REPLAYGAIN_TRACK_GAIN": "-4 dB", "REPLAYGAIN_TRACK_PEAK": "?"}, ReplayGain(-4, None)),
        # Opus's own tag: Q7.8 against -23 LUFS, which USDX lifts by 5 dB.
        ({"R128_TRACK_GAIN": "-512"}, ReplayGain(3.0, None)),
        (
            {"REPLAYGAIN_TRACK_GAIN": "-1.00 dB", "R128_TRACK_GAIN": "-512"},
            ReplayGain(-1.0, None),
        ),
    ],
)
async def test_read_tags_reads_what_usdx_reads(
    ffmpeg: str, tmp_path: Path, tags: dict[str, str], expected: ReplayGain | None
) -> None:
    song = fake_audio(tmp_path / "song.mp3", tags)

    assert await loudness.read_tags(ffmpeg, song) == expected


async def test_read_tags_asks_for_the_stream_and_the_container(ffmpeg: str, tmp_path: Path) -> None:
    await loudness.read_tags(ffmpeg, fake_audio(tmp_path / "song.ogg"))

    [arguments] = ffmpeg_calls(ffmpeg)
    assert arguments[arguments.index("-i") + 2 :] == [
        "-map_metadata",
        "0:s:a:0",
        "-map_metadata",
        "0",
        "-f",
        "ffmetadata",
        "-",
    ]


def test_the_ffmetadata_format_is_unescaped() -> None:
    text = (
        ";FFMETADATA1\n"
        "title=A \\= B\\; C\n"
        "comment=first\\\n"
        "second\n"
        "REPLAYGAIN_TRACK_GAIN=-1.00 dB\n"
        "[STREAM]\n"
        "REPLAYGAIN_TRACK_PEAK=9\n"
    )

    assert loudness._ffmetadata(text) == {
        "TITLE": "A = B; C",
        "COMMENT": "first\nsecond",
        "REPLAYGAIN_TRACK_GAIN": "-1.00 dB",
    }


# --- write_tags --------------------------------------------------------------------------


async def test_write_tags_replaces_the_file_with_a_tagged_copy(ffmpeg: str, tmp_path: Path) -> None:
    song = fake_audio(tmp_path / "library" / "song.mp3", {"TITLE": "Kept"})

    await loudness.write_tags(ffmpeg, song, -6.5, 0.988553)

    assert tags_of(song) == {
        "TITLE": "Kept",
        "REPLAYGAIN_TRACK_GAIN": "-6.50 dB",
        "REPLAYGAIN_TRACK_PEAK": "0.988553",
    }
    assert [path.name for path in song.parent.iterdir()] == ["song.mp3"]
    write, read_back = ffmpeg_calls(ffmpeg)
    # Every stream copied, the tags kept, both dictionaries written, ID3v2.3 for an mp3.
    assert write[write.index("-map") + 1] == "0"
    assert write[write.index("-c") + 1] == "copy"
    assert write[write.index("-map_metadata") + 1] == "0"
    assert write[write.index("-id3v2_version") + 1] == "3"
    assert "-metadata:s:a:0" in write
    assert write[-1] == str(loudness.temporary_path(song))
    # The copy is what was read back, before it took the original's place.
    assert read_back[read_back.index("-i") + 1] == str(loudness.temporary_path(song))


async def test_only_an_mp3_is_told_its_id3_version(ffmpeg: str, tmp_path: Path) -> None:
    song = fake_audio(tmp_path / "song.ogg")

    await loudness.write_tags(ffmpeg, song, 1.0, 0.5)

    assert "-id3v2_version" not in ffmpeg_calls(ffmpeg)[0]
    assert tags_of(song)["REPLAYGAIN_TRACK_GAIN"] == "1.00 dB"


async def test_a_gain_without_a_peak_writes_no_peak(ffmpeg: str, tmp_path: Path) -> None:
    song = fake_audio(tmp_path / "song.mp3")

    await loudness.write_tags(ffmpeg, song, -2.0, None)

    assert tags_of(song) == {"REPLAYGAIN_TRACK_GAIN": "-2.00 dB"}


async def test_a_format_that_keeps_no_tag_is_left_alone(tmp_path: Path) -> None:
    ffmpeg = fake_ffmpeg(tmp_path / "tools", drops_tags=True)
    song = fake_audio(tmp_path / "library" / "song.mp3")

    with pytest.raises(loudness.UnsupportedFormatError):
        await loudness.write_tags(ffmpeg, song, -6.5, 0.9)

    assert tags_of(song) == {}
    assert [path.name for path in song.parent.iterdir()] == ["song.mp3"]


@pytest.mark.parametrize("name", ["song.wav", "song.m4a", "video.mp4", "video.MKV", "song"])
async def test_a_format_nobody_has_tried_is_never_copied(
    ffmpeg: str, tmp_path: Path, name: str
) -> None:
    """A Matroska video would take the tags, and be rewritten whole for them."""
    song = fake_audio(tmp_path / "library" / name)

    with pytest.raises(loudness.UnsupportedFormatError):
        await loudness.write_tags(ffmpeg, song, -6.5, 0.9)

    assert ffmpeg_calls(ffmpeg) == []
    assert [path.name for path in song.parent.iterdir()] == [name]


@pytest.mark.parametrize("name", ["song.MP3", "song.ogg", "song.opus", "song.flac"])
async def test_the_formats_proven_to_keep_the_tag_are_written(
    ffmpeg: str, tmp_path: Path, name: str
) -> None:
    song = fake_audio(tmp_path / "library" / name)

    await loudness.write_tags(ffmpeg, song, -6.5, 0.9)

    assert tags_of(song)["REPLAYGAIN_TRACK_GAIN"] == "-6.50 dB"


async def test_a_read_only_file_is_never_copied(ffmpeg: str, tmp_path: Path) -> None:
    song = fake_audio(tmp_path / "library" / "song.mp3")
    song.chmod(stat.S_IREAD)
    try:
        with pytest.raises(loudness.LoudnessError, match="read-only") as raised:
            await loudness.write_tags(ffmpeg, song, -6.5, 0.9)
        outcome = await loudness.normalize(ffmpeg, song)
    finally:
        song.chmod(stat.S_IREAD | stat.S_IWRITE)

    # Not "in use", which is what Windows' "access denied" would otherwise have read as.
    assert not isinstance(raised.value, loudness.FileInUseError)
    assert (outcome.status, outcome.gain) == ("failed", DEFAULT_GAIN)
    assert tags_of(song) == {}
    assert kinds(ffmpeg) == ["read", "measure"]
    assert [path.name for path in song.parent.iterdir()] == ["song.mp3"]


async def test_a_copy_shorter_than_the_file_is_refused(tmp_path: Path) -> None:
    ffmpeg = fake_ffmpeg(tmp_path / "tools", truncates=True)
    song = fake_audio(tmp_path / "library" / "song.mp3", duration=240.0)

    with pytest.raises(loudness.LoudnessError, match=r"120\.00 s long, the file 240\.00 s"):
        await loudness.write_tags(ffmpeg, song, -6.5, 0.9)

    assert tags_of(song) == {}
    assert [path.name for path in song.parent.iterdir()] == ["song.mp3"]


async def test_a_copy_as_long_as_the_file_is_kept(ffmpeg: str, tmp_path: Path) -> None:
    song = fake_audio(tmp_path / "library" / "song.mp3", duration=240.0)

    await loudness.write_tags(ffmpeg, song, -6.5, 0.9)

    assert tags_of(song)["REPLAYGAIN_TRACK_GAIN"] == "-6.50 dB"


@pytest.mark.parametrize(
    ("original", "copy", "kept"),
    [
        (None, None, True),
        (None, 3.0, True),
        (240.0, 240.0, True),
        # The tolerance: half a second, or a hundredth of a long file.
        (240.0, 242.3, True),
        (20.0, 20.45, True),
        (20.0, 20.6, False),
        (240.0, 237.5, False),
        (240.0, None, False),
    ],
)
def test_the_length_check(original: float | None, copy: float | None, kept: bool) -> None:
    if kept:
        loudness._check_length(Path("song.mp3"), original, copy)
    else:
        with pytest.raises(loudness.LoudnessError):
            loudness._check_length(Path("song.mp3"), original, copy)


@pytest.mark.parametrize(
    ("stderr", "seconds"),
    [
        ("Input #0, mp3, from 'a.mp3':\n  Duration: 00:03:59.98, start: 0.025057\n", 239.98),
        ("  Duration: 01:00:00.50, start", 3600.5),
        ("  Duration: N/A, start: 0.000000, bitrate: N/A\n", None),
        ("", None),
    ],
)
def test_the_length_is_read_off_the_dump(stderr: str, seconds: float | None) -> None:
    assert loudness._duration(stderr) == (None if seconds is None else pytest.approx(seconds))


async def test_a_copy_that_starts_elsewhere_is_refused(tmp_path: Path) -> None:
    """What an mp3 without an info frame turns into: the same packets, 12 ms of the
    encoder's delay skipped, the song early against its lyrics."""
    ffmpeg = fake_ffmpeg(tmp_path / "tools", moves_start_to=0.011995)
    song = fake_audio(tmp_path / "library" / "song.mp3", duration=240.0)

    with pytest.raises(loudness.LoudnessError, match=r"starts at 0\.012 s, the file at 0\.000"):
        await loudness.write_tags(ffmpeg, song, -6.5, 0.9)

    assert tags_of(song) == {}
    assert [path.name for path in song.parent.iterdir()] == ["song.mp3"]


@pytest.mark.parametrize(
    ("original", "copy", "kept"),
    [
        (None, None, True),
        (None, 0.5, True),
        (0.025057, 0.025057, True),
        (-0.0065, -0.0065, True),
        (0.0, 0.011995, False),
        (0.0, None, False),
    ],
)
def test_the_start_check(original: float | None, copy: float | None, kept: bool) -> None:
    if kept:
        loudness._check_start(Path("song.mp3"), original, copy)
    else:
        with pytest.raises(loudness.LoudnessError):
            loudness._check_start(Path("song.mp3"), original, copy)


@pytest.mark.parametrize(
    ("stderr", "start"),
    [
        ("  Duration: 00:03:59.98, start: 0.025057, bitrate: 128 kb/s\n", 0.025057),
        ("  Duration: 00:00:05.00, start: -0.006500, bitrate: 106 kb/s\n", -0.0065),
        ("  Duration: N/A, start: 0.000000, bitrate: N/A\n", 0.0),
        ("  Duration: 00:00:05.00, bitrate: 106 kb/s\n  start: 3\n", None),
        ("", None),
    ],
)
def test_the_start_is_read_off_the_dump(stderr: str, start: float | None) -> None:
    assert loudness._start(stderr) == (None if start is None else pytest.approx(start))


async def test_a_failed_copy_leaves_the_original_and_no_copy(tmp_path: Path) -> None:
    ffmpeg = fake_ffmpeg(tmp_path / "tools", write_fails=True)
    song = fake_audio(tmp_path / "library" / "song.mp3")
    # A copy a crash left behind is no reason to fail; it is written over.
    loudness.temporary_path(song).write_text("half a file", encoding="utf-8")

    with pytest.raises(loudness.LoudnessError, match="Could not write header"):
        await loudness.write_tags(ffmpeg, song, -6.5, 0.9)

    assert tags_of(song) == {}
    assert [path.name for path in song.parent.iterdir()] == ["song.mp3"]


async def test_a_file_in_use_is_its_own_failure(
    ffmpeg: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """What Windows answers while another program holds the file open."""

    def refuse(source: Path, destination: Path) -> None:
        raise PermissionError(32, "The process cannot access the file", str(destination))

    monkeypatch.setattr(loudness.os, "replace", refuse)
    song = fake_audio(tmp_path / "library" / "song.mp3")

    with pytest.raises(loudness.FileInUseError, match="in use"):
        await loudness.write_tags(ffmpeg, song, -6.5, 0.9)

    assert tags_of(song) == {}
    assert [path.name for path in song.parent.iterdir()] == ["song.mp3"]


# --- normalize ---------------------------------------------------------------------------


async def test_normalize_measures_and_tags_an_untagged_file(ffmpeg: str, tmp_path: Path) -> None:
    song = fake_audio(tmp_path / "song.mp3")

    outcome = await loudness.normalize(ffmpeg, song)

    assert outcome == Outcome("tagged", DEFAULT_GAIN)
    assert outcome.stored == DEFAULT_GAIN
    assert kinds(ffmpeg) == ["read", "measure", "write", "read"]
    assert tags_of(song) == {
        "REPLAYGAIN_TRACK_GAIN": "7.90 dB",
        "REPLAYGAIN_TRACK_PEAK": f"{DEFAULT_GAIN.peak:.6f}",
    }


async def test_normalize_leaves_a_tagged_file_alone(ffmpeg: str, tmp_path: Path) -> None:
    song = fake_audio(tmp_path / "song.mp3", {"REPLAYGAIN_TRACK_GAIN": "-3.00 dB"})

    outcome = await loudness.normalize(ffmpeg, song)

    assert outcome == Outcome("already_tagged", ReplayGain(-3.0, None))
    assert outcome.stored == ReplayGain(-3.0, None)
    assert kinds(ffmpeg) == ["read"]


@pytest.mark.parametrize(
    ("control", "status", "gain"),
    [
        ({"integrated": "-70.0", "true_peak": "-inf"}, "silent", None),
        ({"measure_fails": True}, "failed", None),
        ({"write_fails": True}, "failed", DEFAULT_GAIN),
        ({"drops_tags": True}, "unsupported", DEFAULT_GAIN),
    ],
)
async def test_normalize_turns_every_failure_into_an_outcome(
    tmp_path: Path, control: dict[str, object], status: str, gain: ReplayGain | None
) -> None:
    ffmpeg = fake_ffmpeg(tmp_path / "tools", **control)
    song = fake_audio(tmp_path / "song.mp3")

    outcome = await loudness.normalize(ffmpeg, song)

    assert (outcome.status, outcome.gain) == (status, gain)
    # Only a measured file whose format keeps no tag is worth remembering: its numbers are
    # true, and trying again would change nothing.
    assert outcome.stored == (gain if status == "unsupported" else None)
    assert tags_of(song) == {}


async def test_normalize_says_when_the_file_is_in_use(
    ffmpeg: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(source: Path, destination: Path) -> None:
        raise PermissionError(13, "Access is denied", str(destination))

    monkeypatch.setattr(loudness.os, "replace", refuse)

    outcome = await loudness.normalize(ffmpeg, fake_audio(tmp_path / "song.mp3"))

    # Measured, so a retry knows what to write; not stored, so a retry is looked for.
    assert (outcome.status, outcome.gain, outcome.stored) == ("in_use", DEFAULT_GAIN, None)


async def test_normalize_of_a_missing_or_corrupt_file(ffmpeg: str, tmp_path: Path) -> None:
    missing = await loudness.normalize(ffmpeg, tmp_path / "gone.mp3")
    corrupt = tmp_path / "corrupt.mp3"
    corrupt.write_bytes(b"\xff\xfb not json")

    assert missing.status == "missing"
    assert ffmpeg_calls(ffmpeg) == []
    outcome = await loudness.normalize(ffmpeg, corrupt)
    assert outcome.status == "failed"
    assert outcome.detail is not None and "Invalid data found" in outcome.detail


# --- normalize_song ----------------------------------------------------------------------


async def add_song(session: AsyncSession, audio_file: Path | None) -> Song:
    song = Song(
        id="usdb:7",
        source="usdb",
        source_id="7",
        title="Loud Song",
        artist="Band",
        fingerprint="band|loudsong",
        directory=str(audio_file.parent if audio_file else Path("/nowhere")),
        txt_file="song.txt",
        audio_file=None if audio_file is None else str(audio_file),
    )
    session.add(song)
    await session.commit()
    return song


async def test_normalize_song_keeps_the_values_on_the_row(
    session: AsyncSession, ffmpeg: str, tmp_path: Path
) -> None:
    song = await add_song(session, fake_audio(tmp_path / "song.mp3"))

    outcome = await loudness.normalize_song(session, ffmpeg, song)

    assert outcome.status == "tagged"
    await session.refresh(song)
    assert (song.replay_gain_db, song.replay_gain_peak) == DEFAULT_GAIN


async def test_normalize_song_forgets_what_it_cannot_vouch_for(
    session: AsyncSession, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    ffmpeg = fake_ffmpeg(tmp_path / "tools", measure_fails=True)
    song = await add_song(session, fake_audio(tmp_path / "song.mp3"))
    song.replay_gain_db, song.replay_gain_peak = -1.0, 0.5
    await session.commit()

    with caplog.at_level(logging.INFO, logger="ultrastar_wingman.downloads.loudness"):
        outcome = await loudness.normalize_song(session, ffmpeg, song)

    assert outcome.status == "failed"
    await session.refresh(song)
    assert (song.replay_gain_db, song.replay_gain_peak) == (None, None)
    [record] = [record for record in caplog.records if record.levelno >= logging.INFO]
    assert record.levelno == logging.WARNING
    # Named by the song, the way every lifecycle line in the console is.
    assert "Band - Loud Song" in record.getMessage()


async def test_normalize_song_without_audio(session: AsyncSession, ffmpeg: str) -> None:
    song = await add_song(session, None)

    outcome = await loudness.normalize_song(session, ffmpeg, song)

    assert outcome.status == "missing"
    assert ffmpeg_calls(ffmpeg) == []


# --- the real ffmpeg ---------------------------------------------------------------------


def real_ffmpeg() -> str | None:
    configured = os.environ.get("WINGMAN_TEST_FFMPEG", "").strip()
    return configured or shutil.which("ffmpeg")


REAL_FFMPEG = real_ffmpeg()
needs_ffmpeg = pytest.mark.skipif(
    REAL_FFMPEG is None, reason="no ffmpeg: set WINGMAN_TEST_FFMPEG or put one on PATH"
)


def run(*arguments: str) -> subprocess.CompletedProcess[str]:
    assert REAL_FFMPEG is not None
    return subprocess.run(
        [REAL_FFMPEG, "-hide_banner", "-nostdin", "-y", *arguments],
        capture_output=True,
        # ffmpeg writes UTF-8 whatever the console's code page, and the paths below are not
        # plain ASCII.
        encoding="utf-8",
        errors="replace",
        check=False,
        stdin=subprocess.DEVNULL,
    )


def decoded_md5(file: Path) -> str:
    """The audio as samples: a stream copy that changed one of them changed the song."""
    result = run("-loglevel", "error", "-i", str(file), "-map", "0:a:0", "-f", "md5", "-")
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def generate(
    path: Path,
    codec: str,
    cover: Path | None = None,
    *,
    source: str = "sine=frequency=440:duration=5",
    tags: dict[str, str] | None = None,
    options: tuple[str, ...] = (),
) -> Path:
    """Five seconds of a quiet tone (or `source`), with a title and `tags`, and with
    `cover` as its picture; `options` go to the output as they are."""
    inputs = ["-f", "lavfi", "-i", source]
    extra = [
        argument
        for key, value in (tags or {}).items()
        for argument in ("-metadata", f"{key}={value}")
    ]
    extra += options
    maps = ["-map", "0:a"]
    if cover is not None:
        inputs += ["-i", str(cover)]
        maps += ["-map", "1", "-c:v", "copy", "-disposition:v", "attached_pic"]
    result = run(
        "-loglevel",
        "error",
        *inputs,
        *maps,
        "-ac",
        "2",
        "-ar",
        "48000",
        "-c:a",
        codec,
        "-metadata",
        "title=Kept Title",
        *extra,
        str(path),
    )
    if "Unknown encoder" in result.stderr:
        pytest.skip(f"this ffmpeg has no {codec} encoder")
    assert result.returncode == 0, result.stderr
    return path


def listing(directory: Path) -> list[str]:
    return sorted(path.name for path in directory.iterdir())


def make_cover(directory: Path) -> Path:
    cover = directory / "cover.jpg"
    picture = ["-f", "lavfi", "-i", "color=c=red:s=64x64", "-frames:v", "1", str(cover)]
    made = run("-loglevel", "error", *picture)
    assert made.returncode == 0, made.stderr
    return cover


@needs_ffmpeg
@pytest.mark.parametrize(
    ("name", "codec"),
    [
        ("song.mp3", "libmp3lame"),
        ("song.ogg", "libvorbis"),
        ("song.opus", "libopus"),
        ("song.flac", "flac"),
    ],
)
async def test_a_real_file_is_tagged_the_way_usdx_reads_it(
    tmp_path: Path, name: str, codec: str
) -> None:
    assert REAL_FFMPEG is not None
    cover = make_cover(tmp_path) if name.endswith(".mp3") else None
    song = generate(tmp_path / name, codec, cover)
    before = decoded_md5(song)

    outcome = await loudness.normalize(REAL_FFMPEG, song)

    assert outcome.status == "tagged", outcome.detail
    assert outcome.gain is not None and outcome.gain.peak is not None
    # A sine at ffmpeg's default amplitude of 1/8 is far below -18 LUFS: a gain upwards.
    assert 0 < outcome.gain.gain_db < 20
    assert 0 < outcome.gain.peak < 1
    # What USDX's `av_dict_get` asks for, in the dictionary it asks: the audio stream's for
    # an Ogg file (Vorbis or Opus), the container's for everything else.
    level = "stream_tags" if name.endswith((".ogg", ".opus")) else "format_tags"
    dump = run("-i", str(song)).stderr
    assert f"REPLAYGAIN_TRACK_GAIN: {loudness.format_gain(outcome.gain.gain_db)}" in dump
    assert f"REPLAYGAIN_TRACK_PEAK: {loudness.format_peak(outcome.gain.peak)}" in dump
    assert await loudness.read_tags(REAL_FFMPEG, song) == outcome.gain
    assert _tag_level(dump, "REPLAYGAIN_TRACK_GAIN") == level
    # Nothing else moved: the samples, the title, the picture.
    assert decoded_md5(song) == before
    assert _tag_level(dump, "title") == level
    if cover is not None:
        assert "(attached pic)" in dump
    assert [path.name for path in song.parent.iterdir() if loudness.TEMP_MARKER in path.name] == []
    # A second pass finds the tag and leaves the file alone.
    again = await loudness.normalize(REAL_FFMPEG, song)
    assert again == Outcome("already_tagged", outcome.gain)


@needs_ffmpeg
@pytest.mark.parametrize(("name", "codec"), [("song.wav", "pcm_s16le"), ("song.m4a", "aac")])
async def test_a_real_file_that_keeps_no_tag_is_left_alone(
    tmp_path: Path, name: str, codec: str
) -> None:
    assert REAL_FFMPEG is not None
    song = generate(tmp_path / name, codec)
    content = song.read_bytes()

    outcome = await loudness.normalize(REAL_FFMPEG, song)

    assert outcome.status == "unsupported", outcome.detail
    assert outcome.gain is not None and math.isfinite(outcome.gain.gain_db)
    assert song.read_bytes() == content
    assert sorted(path.name for path in song.parent.iterdir()) == [name]


@needs_ffmpeg
async def test_a_real_mp3_keeps_everything_but_the_old_gain(tmp_path: Path) -> None:
    """Brackets, spaces and umlauts on the way through, an existing pair written in lower
    case by another tagger replaced rather than doubled, the other ID3 frames and the
    picture kept, the samples untouched."""
    assert REAL_FFMPEG is not None
    folder = tmp_path / "Mötley Crüe - Kickstart [Live] (1985)"
    folder.mkdir()
    old = {"replaygain_track_gain": "+3.00 dB", "replaygain_track_peak": "0.500000"}
    song = generate(
        folder / "Mötley Crüe - Kickstart [Live].mp3",
        "libmp3lame",
        make_cover(tmp_path),
        tags={"artist": "Mötley Crüe", **old},
    )
    before = decoded_md5(song)
    assert await loudness.read_tags(REAL_FFMPEG, song) == ReplayGain(3.0, 0.5)

    await loudness.write_tags(REAL_FFMPEG, song, -4.25, 0.912345)

    dump = run("-i", str(song)).stderr
    tag_lines = [line.strip() for line in dump.splitlines() if "replaygain_track" in line.lower()]
    assert sorted(tag_lines) == [
        "REPLAYGAIN_TRACK_GAIN: -4.25 dB",
        "REPLAYGAIN_TRACK_PEAK: 0.912345",
    ]
    assert await loudness.read_tags(REAL_FFMPEG, song) == ReplayGain(-4.25, 0.912345)
    assert "Mötley Crüe" in dump and "Kept Title" in dump
    assert "(attached pic)" in dump
    assert decoded_md5(song) == before
    assert sorted(path.name for path in folder.iterdir()) == [song.name]


@needs_ffmpeg
@pytest.mark.skipif(os.name != "nt", reason="only Windows refuses to replace an open file")
async def test_a_real_file_held_open_is_in_use_and_intact(tmp_path: Path) -> None:
    """Python opens a file the way most Windows programs do, without `FILE_SHARE_DELETE`:
    ffmpeg may read it, nothing may replace it."""
    assert REAL_FFMPEG is not None
    song = generate(tmp_path / "song.mp3", "libmp3lame")
    content = song.read_bytes()

    with song.open("rb"):
        outcome = await loudness.normalize(REAL_FFMPEG, song)

    assert outcome.status == "in_use", outcome.detail
    assert outcome.gain is not None and outcome.stored is None
    assert song.read_bytes() == content
    assert listing(tmp_path) == ["song.mp3"]


@needs_ffmpeg
async def test_a_real_mp3_without_an_info_frame_is_left_alone(tmp_path: Path) -> None:
    """ffmpeg's copy of it gains a Xing frame, and with it the encoder delay its decoder
    skips: other samples, 12 ms earlier. Wingman's own downloads always carry the frame."""
    assert REAL_FFMPEG is not None
    song = generate(tmp_path / "song.mp3", "libmp3lame", options=("-write_xing", "0"))
    content = song.read_bytes()

    outcome = await loudness.normalize(REAL_FFMPEG, song)

    assert outcome.status == "failed", outcome.detail
    assert outcome.detail is not None and "starts at" in outcome.detail
    assert song.read_bytes() == content
    assert listing(tmp_path) == ["song.mp3"]


@needs_ffmpeg
async def test_real_silence_gets_no_gain(tmp_path: Path) -> None:
    """ebur128 answers -70 LUFS and a peak of -inf for digital silence: a gain of +52 dB."""
    assert REAL_FFMPEG is not None
    song = generate(tmp_path / "silence.mp3", "libmp3lame", source="anullsrc=r=48000:cl=stereo:d=5")
    content = song.read_bytes()

    assert await loudness.measure(REAL_FFMPEG, song) is None
    assert await loudness.normalize(REAL_FFMPEG, song) == Outcome("silent")
    assert song.read_bytes() == content


@needs_ffmpeg
@pytest.mark.parametrize("content", [b"", b"not audio at all\n" * 100])
async def test_a_real_file_that_is_no_audio_fails_cleanly(tmp_path: Path, content: bytes) -> None:
    assert REAL_FFMPEG is not None
    song = tmp_path / "song.mp3"
    song.write_bytes(content)

    outcome = await loudness.normalize(REAL_FFMPEG, song)

    assert outcome.status == "failed"
    assert outcome.detail is not None and "Invalid data found" in outcome.detail
    assert song.read_bytes() == content
    assert listing(tmp_path) == ["song.mp3"]


def _tag_level(dump: str, key: str) -> str | None:
    """Where ffmpeg's own dump of the input lists `key`: the container's metadata block
    (indented four spaces) or a stream's (six)."""
    for line in dump.splitlines():
        stripped = line.lstrip(" ")
        if stripped.split(":", 1)[0].strip() == key:
            return "stream_tags" if len(line) - len(stripped) >= 6 else "format_tags"
    return None


# --- the migration -----------------------------------------------------------------------


def test_migration_0037_adds_the_two_columns_empty(tmp_path: Path) -> None:
    """No backfill: a song scanned before 0037 has a gain nobody has read yet."""
    database = tmp_path / "wingman.db"
    config = Config()
    config.set_main_option("script_location", str(migrations_dir()))
    config.set_main_option("sqlalchemy.url", f"sqlite+aiosqlite:///{database}".replace("%", "%%"))
    command.upgrade(config, "0036")
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO songs (id, source, title, artist, fingerprint, directory, txt_file, "
            "is_duet, created_at, updated_at) VALUES ('usdb:1', 'usdb', 'T', 'A', 'a|t', "
            "'C:/songs/A - T', 'C:/songs/A - T/A - T.txt', 0, '2026-10-01', '2026-10-01')"
        )

    command.upgrade(config, "0037")

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT replay_gain_db, replay_gain_peak FROM songs"
        ).fetchall() == [(None, None)]

    command.downgrade(config, "0036")

    with sqlite3.connect(database) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info('songs')")}
        assert not columns & {"replay_gain_db", "replay_gain_peak"}
        assert connection.execute("SELECT id FROM songs").fetchall() == [("usdb:1",)]
