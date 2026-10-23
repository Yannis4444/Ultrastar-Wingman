"""Loudness normalization: measuring and reading ReplayGain tags with ffmpeg, writing them
with mutagen.

Two kinds of test. Most run against `FAKE_FFMPEG`, a stand-in that answers the two things
`downloads.loudness` asks of ffmpeg — the ebur128 summary and the ffmetadata dump. Its
"file" is either JSON (`fake_audio`: its tags, nothing to play) or a real audio file out of
`fixtures/loudness/`, whose tags it reads with mutagen the way ffmpeg files them. The writer
is the real mutagen, so every test that writes a tag writes it into a real file, and none of
these needs an ffmpeg. The fixtures are 0.2 s of mono silence at 48 kHz, made once with
ffmpeg 2024-07-15:

    ffmpeg -f lavfi -i anullsrc=r=48000:cl=mono:d=0.2 -c:a <codec> -fflags +bitexact
           -flags:a +bitexact -map_metadata -1 [-id3v2_version 0] silence.<suffix>

with `libmp3lame` (and `-id3v2_version 0`: no tag at all), `libvorbis`, `libopus`, `flac` and
`aac`. The tests with "real" in their name run the real ffmpeg over files it generates
itself, to prove the tags come back under the names Ultrastar Deluxe asks for and the audio
does not move; they are skipped where there is no ffmpeg (`WINGMAN_TEST_FFMPEG`, else the
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
from typing import Any

import mutagen
import pytest
from alembic import command
from alembic.config import Config
from mutagen.apev2 import APEv2
from mutagen.id3 import APIC, ID3, TIT2, TPE1, TXXX, Encoding
from mutagen.mp4 import MP4, AtomDataType, MP4FreeForm, MP4Tags
from mutagen.oggvorbis import OggVorbis
from sqlalchemy.ext.asyncio import AsyncSession

from test_downloads_media import fake_executable
from ultrastar_wingman.db import migrations_dir
from ultrastar_wingman.downloads import loudness
from ultrastar_wingman.downloads.loudness import Outcome, ReplayGain
from ultrastar_wingman.songs.model import Song

FIXTURES = Path(__file__).parent / "fixtures" / "loudness"

# A JSON file is `{"audio": ..., "tags": {...}}`; a real audio file's tags are read with
# mutagen; anything else is a corrupt file.
FAKE_FFMPEG = r"""
import json
import pathlib
import shutil
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


def real_tags(path):
    # ffmpeg's dictionary of a real file: an ID3v2 TXXX frame under its description, a
    # Vorbis comment under its key, an MP4 freeform atom under its name.
    import mutagen
    from mutagen.id3 import ID3

    try:
        audio = mutagen.File(path)
    except mutagen.MutagenError:
        return None
    if audio is None:
        return None
    if audio.tags is None:
        return {}
    if isinstance(audio.tags, ID3):
        return {frame.desc: str(frame.text[0]) for frame in audio.tags.getall("TXXX")}
    if hasattr(audio.tags, "as_dict"):
        # A slice is the comments as stored; iterating them would give the keys alone.
        return dict(audio.tags[:])
    return {
        name.rpartition(":")[2]: bytes(values[0]).decode()
        for name, values in audio.tags.items()
        if name.startswith("----:")
    }


if "-vn" in arguments:
    # `media.extract_audio`: whatever the video, the audio is a fresh, untagged mp3.
    shutil.copyfile(SILENT_MP3, output)
    sys.exit(0)

source = pathlib.Path(arguments[arguments.index("-i") + 1])
if control.get("unreadable_copies") and ".wingman-loudness" in source.name:
    fail(f"{source}: Invalid data found when processing input")
try:
    song = json.loads(source.read_text(encoding="utf-8"))
except (OSError, ValueError):
    tags = real_tags(source)
    if tags is None:
        fail(f"{source}: Invalid data found when processing input")
    song = {"audio": "real", "tags": tags}

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
    if not control.get("hides_tags"):
        for key, value in song["tags"].items():
            print(f"{key}={value}")
    sys.exit(0)

fail(f"the fake has no answer for {arguments}")
""".replace("SILENT_MP3", repr(str(FIXTURES / "silence.mp3")))

# What the fake measures by default: -25.9 LUFS, a true peak of -14.4 dBFS.
DEFAULT_GAIN = ReplayGain(gain_db=7.9, peak=round(10 ** (-14.4 / 20), 6))
# What the write tests write, and how it reads in the file.
GAIN, PEAK = -6.5, 0.988553
WRITTEN = [("REPLAYGAIN_TRACK_GAIN", "-6.50 dB"), ("REPLAYGAIN_TRACK_PEAK", "0.988553")]


def fake_ffmpeg(directory: Path, **control: object) -> str:
    """The fake, in a directory of its own, behaving as `control` says (`measure_fails`,
    `measure_sleep`, `integrated`, `true_peak`, `hides_tags` — the dump shows no tag at all,
    as for a format whose tag ffmpeg does not read — and `unreadable_copies`, a read of the
    temporary copy failing)."""
    directory.mkdir(parents=True, exist_ok=True)
    if control:
        (directory / "ffmpeg-control.json").write_text(json.dumps(control), encoding="utf-8")
    return str(fake_executable(directory, "ffmpeg", FAKE_FFMPEG))


def fake_audio(path: Path, tags: dict[str, str] | None = None) -> Path:
    """A JSON stand-in for an audio file, for what never writes: the fake reads its tags,
    mutagen can read nothing in it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"audio": "song", "tags": tags or {}}), encoding="utf-8")
    return path


def silent_audio(path: Path, kind: str | None = None) -> Path:
    """A real audio file at `path`: the fixture of `kind` (`mp3`, `ogg`, `opus`, `flac`,
    `m4a`), by default the one `path`'s suffix names."""
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(FIXTURES / f"silence.{kind or path.suffix.casefold().lstrip('.')}", path)
    return path


def replay_gain_entries(path: Path) -> list[tuple[str, str]]:
    """Every tag of a real file whose name holds "replaygain", in any case, with its value —
    as mutagen keys it, so a pair written twice in two cases is two entries here."""
    audio = mutagen.File(path)
    tags = audio.tags
    if tags is None:
        return []
    if isinstance(tags, ID3):
        pairs = [(frame.desc, str(frame.text[0])) for frame in tags.getall("TXXX")]
    elif isinstance(tags, MP4Tags):
        pairs = [(name, bytes(values[0]).decode()) for name, values in tags.items()]
    else:
        # Vorbis comments: a slice is the (key, value) pairs as stored, in their case.
        pairs = list(tags[:])
    return sorted((name, value) for name, value in pairs if "replaygain" in name.casefold())


def tags_of(path: Path) -> dict[str, str]:
    """The ReplayGain tags of a real file as ffmpeg's dictionary holds them."""
    return {name.rpartition(":")[2]: value for name, value in replay_gain_entries(path)}


def ffmpeg_calls(ffmpeg: str) -> list[list[str]]:
    log = Path(ffmpeg).parent / "ffmpeg-calls.jsonl"
    if not log.is_file():
        return []
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]


def kinds(ffmpeg: str) -> list[str]:
    """Each call by what it was: `measure` or `read`. ffmpeg never writes."""

    def kind(arguments: list[str]) -> str:
        if any("ebur128" in argument for argument in arguments):
            return "measure"
        return "read" if "ffmetadata" in arguments else "other"

    return [kind(arguments) for arguments in ffmpeg_calls(ffmpeg)]


def listing(directory: Path) -> list[str]:
    return sorted(path.name for path in directory.iterdir())


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


async def test_write_tags_tags_a_copy_and_puts_it_in_place(ffmpeg: str, tmp_path: Path) -> None:
    song = silent_audio(tmp_path / "library" / "song.mp3")
    tags = ID3()
    tags.add(TIT2(encoding=Encoding.UTF8, text=["Kept"]))
    tags.save(song)

    await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    assert replay_gain_entries(song) == WRITTEN
    assert ID3(song)["TIT2"].text == ["Kept"]
    assert listing(song.parent) == ["song.mp3"]
    # ffmpeg only read the copy back, before it took the original's place.
    [read_back] = ffmpeg_calls(ffmpeg)
    assert kinds(ffmpeg) == ["read"]
    assert read_back[read_back.index("-i") + 1] == str(loudness.temporary_path(song))


@pytest.mark.parametrize("name", ["song.mp3", "song.ogg", "song.m4a"])
async def test_a_gain_without_a_peak_leaves_no_peak(ffmpeg: str, tmp_path: Path, name: str) -> None:
    """Not even an old one: USDX would cap the new gain by it."""
    song = silent_audio(tmp_path / name)
    await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    await loudness.write_tags(ffmpeg, song, -2.0, None)

    assert tags_of(song) == {"REPLAYGAIN_TRACK_GAIN": "-2.00 dB"}


@pytest.mark.parametrize(
    ("name", "kind", "where"),
    [
        ("song.mp3", "mp3", ID3),
        ("song.MP3", "mp3", ID3),
        ("song.ogg", "ogg", None),
        ("song.opus", "opus", None),
        # An `.ogg` may hold Opus: the content decides how it is tagged.
        ("song.ogg", "opus", None),
        ("song.flac", "flac", None),
        ("song.m4a", "m4a", MP4Tags),
    ],
)
async def test_every_format_wingman_tags_is_written(
    ffmpeg: str, tmp_path: Path, name: str, kind: str, where: type | None
) -> None:
    song = silent_audio(tmp_path / "library" / name, kind)

    await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    assert tags_of(song) == dict(WRITTEN)
    if where is not None:
        assert isinstance(mutagen.File(song).tags, where)
    assert listing(song.parent) == [name]


@pytest.mark.parametrize("name", ["song.wav", "song.aac", "video.mp4", "video.MKV", "song"])
async def test_a_format_nobody_has_tried_is_never_copied(
    ffmpeg: str, tmp_path: Path, name: str
) -> None:
    """A Matroska video, an mp4 named as the audio: neither is a song's audio file to tag."""
    song = fake_audio(tmp_path / "library" / name)

    with pytest.raises(loudness.UnsupportedFormatError):
        await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    assert ffmpeg_calls(ffmpeg) == []
    assert listing(song.parent) == [name]


async def test_an_existing_pair_in_another_case_is_replaced(ffmpeg: str, tmp_path: Path) -> None:
    """mutagen keys a `TXXX` frame by its exact description, ffmpeg's dictionary ignores
    case: a lower-case pair left beside the new one would be the same key twice."""
    song = silent_audio(tmp_path / "song.mp3")
    tags = ID3()
    tags.add(TXXX(encoding=Encoding.UTF8, desc="replaygain_track_gain", text=["+3.00 dB"]))
    tags.add(TXXX(encoding=Encoding.UTF8, desc="Replaygain_Track_Peak", text=["0.5"]))
    tags.add(TXXX(encoding=Encoding.UTF8, desc="replaygain_album_gain", text=["+1.00 dB"]))
    tags.save(song)

    await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    # The album gain is no key Wingman writes, and stays.
    assert replay_gain_entries(song) == [*WRITTEN, ("replaygain_album_gain", "+1.00 dB")]


async def test_an_existing_vorbis_comment_in_another_case_is_replaced(
    ffmpeg: str, tmp_path: Path
) -> None:
    song = silent_audio(tmp_path / "song.ogg")
    audio: Any = OggVorbis(song)
    audio.tags["replaygain_track_gain"] = ["+3.00 dB"]
    audio.tags["Replaygain_Track_Peak"] = ["0.5"]
    audio.save()

    await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    assert replay_gain_entries(song) == WRITTEN


async def test_an_existing_freeform_atom_under_another_mean_is_replaced(
    ffmpeg: str, tmp_path: Path
) -> None:
    """ffmpeg files a freeform atom under its name alone, whatever its mean."""
    song = silent_audio(tmp_path / "song.m4a")
    audio: Any = MP4(song)
    if audio.tags is None:
        audio.add_tags()
    audio.tags["----:org.hydrogenaudio.replaygain:replaygain_track_gain"] = [
        MP4FreeForm(b"+3.00 dB", dataformat=AtomDataType.UTF8)
    ]
    audio.save()

    await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    assert replay_gain_entries(song) == [
        ("----:com.apple.iTunes:" + name, value) for name, value in WRITTEN
    ]


def syncsafe(size: int) -> bytes:
    return bytes((size >> shift) & 0x7F for shift in (21, 14, 7, 0))


def id3v2_tag(version: int, frames: bytes, *, footer: bool = False) -> bytes:
    """An ID3v2 tag of `version` (2, 3 or 4) around `frames`, made by hand: mutagen writes
    neither 2.2, nor an unknown frame, nor the ten-byte footer a 2.4 tag may end in."""
    flags = 0x10 if footer else 0
    size = syncsafe(len(frames))
    tag = b"ID3" + bytes([version, 0, flags]) + size + frames
    return tag + (b"3DI" + bytes([version, 0, flags]) + size if footer else b"")


def id3v1_tag(title: str) -> bytes:
    """128 bytes: title, artist, album, year, comment, genre."""

    def field(text: str) -> bytes:
        return text.encode("latin-1").ljust(30, b"\0")

    artist, album, comment = field("V1 Artist"), field("V1 Album"), field("")
    return b"TAG" + field(title) + artist + album + b"1999" + comment + bytes([17])


@pytest.mark.parametrize(("version", "kept"), [(3, (2, 3, 0)), (4, (2, 4, 0))])
async def test_the_id3_version_is_the_one_the_file_has(
    ffmpeg: str, tmp_path: Path, version: int, kept: tuple[int, int, int]
) -> None:
    song = silent_audio(tmp_path / "song.mp3")
    tags = ID3()
    tags.add(TIT2(encoding=Encoding.LATIN1, text=["Kept"]))
    tags.save(song, v2_version=version)

    await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    assert ID3(song).version == kept
    assert ID3(song)["TIT2"].text == ["Kept"]


async def test_an_mp3_without_a_tag_gets_an_id3v2_3_one(ffmpeg: str, tmp_path: Path) -> None:
    song = silent_audio(tmp_path / "song.mp3")
    audio_bytes = song.read_bytes()

    await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    assert ID3(song).version == (2, 3, 0)
    assert replay_gain_entries(song) == WRITTEN
    # Everything after the new tag is the file as it was.
    assert song.read_bytes()[ID3(song).size :] == audio_bytes


async def test_an_id3v2_2_tag_becomes_2_3(ffmpeg: str, tmp_path: Path) -> None:
    """mutagen reads ID3v2.2 but cannot write it."""
    title = b"\x00Old Title"
    frame = b"TT2" + len(title).to_bytes(3, "big") + title
    song = tmp_path / "song.mp3"
    song.write_bytes(id3v2_tag(2, frame) + (FIXTURES / "silence.mp3").read_bytes())

    await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    assert ID3(song).version == (2, 3, 0)
    assert ID3(song)["TIT2"].text == ["Old Title"]
    assert replay_gain_entries(song) == WRITTEN


async def test_a_frame_mutagen_does_not_know_is_kept(ffmpeg: str, tmp_path: Path) -> None:
    """mutagen writes an unknown frame back only into the version it was read from."""
    data = b"whatever another tagger keeps here"
    frame = b"ZWNG" + syncsafe(len(data)) + b"\x00\x00" + data
    song = tmp_path / "song.mp3"
    song.write_bytes(id3v2_tag(4, frame) + (FIXTURES / "silence.mp3").read_bytes())

    await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    assert frame in song.read_bytes()
    assert replay_gain_entries(song) == WRITTEN


async def test_an_id3v2_4_footer_is_not_left_behind(ffmpeg: str, tmp_path: Path) -> None:
    """mutagen counts no footer in the tag's size and writes none, so the old one would stay
    between the new tag and the audio — junk that made ffmpeg skip the info frame behind it
    and start the song 23 ms early. It is folded into the tag instead."""
    title = b"\x00Kept"
    frame = b"TIT2" + syncsafe(len(title)) + b"\x00\x00" + title
    audio = (FIXTURES / "silence.mp3").read_bytes()
    song = tmp_path / "song.mp3"
    song.write_bytes(id3v2_tag(4, frame, footer=True) + audio)

    await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    tags = ID3(song, load_v1=False)
    assert song.read_bytes()[tags.size :] == audio
    assert b"3DI" not in song.read_bytes()
    assert tags["TIT2"].text == ["Kept"]
    assert replay_gain_entries(song) == WRITTEN


async def test_a_frame_with_several_values_keeps_them(ffmpeg: str, tmp_path: Path) -> None:
    """In ID3v2.3, the values of a text frame are kept apart as they were, never joined."""
    song = silent_audio(tmp_path / "song.mp3")
    tags = ID3()
    tags.add(TPE1(encoding=Encoding.UTF16, text=["Alice", "Bob"]))
    tags.save(song, v2_version=3, v23_sep=None)

    await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    assert ID3(song)["TPE1"].text == ["Alice", "Bob"]


async def test_the_picture_and_the_id3v1_and_apev2_tags_are_kept_as_they_are(
    ffmpeg: str, tmp_path: Path
) -> None:
    """mutagen would write an ID3v1 tag anew out of the ID3v2 frames, and — loaded — copy
    its fields into them; it is put back byte for byte instead, behind the APEv2 tag."""
    song = silent_audio(tmp_path / "song.mp3")
    tags = ID3()
    tags.add(TIT2(encoding=Encoding.UTF8, text=["A v2 title, longer than the v1 one has room for"]))
    tags.add(APIC(encoding=Encoding.UTF8, mime="image/png", type=3, desc="", data=b"PNG" * 50))
    tags.save(song)
    ape = APEv2()
    ape["Artist"] = "APE Artist"
    ape.save(song)
    v1 = id3v1_tag("V1 Title")
    with song.open("ab") as file:
        file.write(v1)
    before = song.read_bytes()
    tag_size = ID3(song).size

    await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    after = song.read_bytes()
    assert after[ID3(song).size :] == before[tag_size:]
    assert after.endswith(v1)
    assert dict(APEv2(song)) == {"Artist": "APE Artist"}
    written = ID3(song, load_v1=False)
    assert sorted(written.keys()) == [
        "APIC:",
        "TIT2",
        "TXXX:REPLAYGAIN_TRACK_GAIN",
        "TXXX:REPLAYGAIN_TRACK_PEAK",
    ]
    assert written["APIC:"].data == b"PNG" * 50


async def test_an_id3v1_tag_alone_is_kept_beside_the_new_id3v2_one(
    ffmpeg: str, tmp_path: Path
) -> None:
    song = silent_audio(tmp_path / "song.mp3")
    v1 = id3v1_tag("V1 Title")
    with song.open("ab") as file:
        file.write(v1)
    before = song.read_bytes()

    await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    tags = ID3(song, load_v1=False)
    # Nothing of the ID3v1 tag was copied into the new one.
    assert sorted(tags.keys()) == ["TXXX:REPLAYGAIN_TRACK_GAIN", "TXXX:REPLAYGAIN_TRACK_PEAK"]
    assert song.read_bytes()[tags.size :] == before


async def test_a_change_beyond_the_tag_is_refused(
    ffmpeg: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    song = silent_audio(tmp_path / "library" / "song.mp3")
    content = song.read_bytes()
    monkeypatch.setattr(loudness, "_same_bytes", lambda *arguments: False)

    with pytest.raises(loudness.LoudnessError, match="more than its ID3v2 tag"):
        await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    assert song.read_bytes() == content
    assert listing(song.parent) == ["song.mp3"]


def test_the_bytes_are_compared_from_where_each_tag_ends(tmp_path: Path) -> None:
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.write_bytes(b"old tag|" + b"audio" * 1000)
    second.write_bytes(b"a longer new tag|" + b"audio" * 1000)

    assert loudness._same_bytes(first, 8, second, 17)
    assert not loudness._same_bytes(first, 8, second, 16)
    second.write_bytes(b"a longer new tag|" + b"audio" * 1000 + b"!")
    assert not loudness._same_bytes(first, 8, second, 17)


@pytest.mark.parametrize(("name", "kind"), [("song.mp3", "ogg"), ("song.flac", "mp3")])
async def test_a_file_that_is_not_what_its_name_says_is_left_alone(
    ffmpeg: str, tmp_path: Path, name: str, kind: str
) -> None:
    """ffmpeg reads whatever the content is; mutagen is told the format by the name."""
    song = silent_audio(tmp_path / "library" / name, kind)
    content = song.read_bytes()

    with pytest.raises(loudness.UnsupportedFormatError, match="is not"):
        await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    assert song.read_bytes() == content
    assert listing(song.parent) == [name]


def _raise(error: Exception) -> Any:
    def raising(*arguments: object, **keywords: object) -> Any:
        raise error

    return raising


@pytest.mark.parametrize(
    ("name", "target", "status"),
    [
        # mutagen's Vorbis comment parser on a damaged comment header.
        ("song.ogg", "File", "unsupported"),
        # mutagen moving the bytes of a damaged MP4 behind its tag.
        ("song.m4a", "save", "failed"),
    ],
)
async def test_a_damaged_file_mutagen_trips_over_is_an_outcome(
    ffmpeg: str,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    target: str,
    status: str,
) -> None:
    """On a damaged file mutagen raises more than `MutagenError`, an `IndexError` while
    loading or a bare `ValueError` while saving among them — what a fuzzed file did. Neither
    may get past `normalize`."""
    if target == "File":
        monkeypatch.setattr(loudness.mutagen, "File", _raise(IndexError("index out of range")))
    else:
        monkeypatch.setattr(loudness.MP4, "save", _raise(ValueError()))
    song = silent_audio(tmp_path / "library" / name)
    content = song.read_bytes()

    outcome = await loudness.normalize(ffmpeg, song)

    assert (outcome.status, outcome.gain) == (status, DEFAULT_GAIN)
    assert outcome.detail is not None
    assert ("index out of range" if target == "File" else "ValueError") in outcome.detail
    assert song.read_bytes() == content
    assert listing(song.parent) == [name]


async def test_a_tag_ffmpeg_does_not_read_back_is_left_alone(tmp_path: Path) -> None:
    ffmpeg = fake_ffmpeg(tmp_path / "tools", hides_tags=True)
    song = silent_audio(tmp_path / "library" / "song.mp3")
    content = song.read_bytes()

    with pytest.raises(loudness.UnsupportedFormatError, match="ffmpeg finds no"):
        await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    assert song.read_bytes() == content
    assert listing(song.parent) == ["song.mp3"]


async def test_a_copy_ffmpeg_cannot_read_leaves_the_original_and_no_copy(tmp_path: Path) -> None:
    ffmpeg = fake_ffmpeg(tmp_path / "tools", unreadable_copies=True)
    song = silent_audio(tmp_path / "library" / "song.mp3")
    content = song.read_bytes()
    # A copy a crash left behind is no reason to fail; it is written over.
    loudness.temporary_path(song).write_text("half a file", encoding="utf-8")

    with pytest.raises(loudness.LoudnessError, match="Invalid data found"):
        await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    assert song.read_bytes() == content
    assert listing(song.parent) == ["song.mp3"]


async def test_a_read_only_file_is_never_copied(ffmpeg: str, tmp_path: Path) -> None:
    song = fake_audio(tmp_path / "library" / "song.mp3")
    song.chmod(stat.S_IREAD)
    try:
        with pytest.raises(loudness.LoudnessError, match="read-only") as raised:
            await loudness.write_tags(ffmpeg, song, GAIN, PEAK)
        outcome = await loudness.normalize(ffmpeg, song)
    finally:
        song.chmod(stat.S_IREAD | stat.S_IWRITE)

    # Not "in use", which is what Windows' "access denied" would otherwise have read as.
    assert not isinstance(raised.value, loudness.FileInUseError)
    assert (outcome.status, outcome.gain) == ("failed", DEFAULT_GAIN)
    assert kinds(ffmpeg) == ["read", "measure"]
    assert listing(song.parent) == ["song.mp3"]


async def test_a_file_in_use_is_its_own_failure(
    ffmpeg: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """What Windows answers while another program holds the file open."""

    def refuse(source: Path, destination: Path) -> None:
        raise PermissionError(32, "The process cannot access the file", str(destination))

    monkeypatch.setattr(loudness.os, "replace", refuse)
    song = silent_audio(tmp_path / "library" / "song.mp3")
    content = song.read_bytes()

    with pytest.raises(loudness.FileInUseError, match="in use"):
        await loudness.write_tags(ffmpeg, song, GAIN, PEAK)

    assert song.read_bytes() == content
    assert listing(song.parent) == ["song.mp3"]


# --- normalize ---------------------------------------------------------------------------


async def test_normalize_measures_and_tags_an_untagged_file(ffmpeg: str, tmp_path: Path) -> None:
    song = silent_audio(tmp_path / "song.mp3")

    outcome = await loudness.normalize(ffmpeg, song)

    assert outcome == Outcome("tagged", DEFAULT_GAIN)
    assert outcome.stored == DEFAULT_GAIN
    assert kinds(ffmpeg) == ["read", "measure", "read"]
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
        ({"unreadable_copies": True}, "failed", DEFAULT_GAIN),
        ({"hides_tags": True}, "unsupported", DEFAULT_GAIN),
    ],
)
async def test_normalize_turns_every_failure_into_an_outcome(
    tmp_path: Path, control: dict[str, object], status: str, gain: ReplayGain | None
) -> None:
    ffmpeg = fake_ffmpeg(tmp_path / "tools", **control)
    song = silent_audio(tmp_path / "song.mp3")
    content = song.read_bytes()

    outcome = await loudness.normalize(ffmpeg, song)

    assert (outcome.status, outcome.gain) == (status, gain)
    # Only a measured file whose format keeps no tag is worth remembering: its numbers are
    # true, and trying again would change nothing.
    assert outcome.stored == (gain if status == "unsupported" else None)
    assert song.read_bytes() == content


async def test_normalize_says_when_the_file_is_in_use(
    ffmpeg: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def refuse(source: Path, destination: Path) -> None:
        raise PermissionError(13, "Access is denied", str(destination))

    monkeypatch.setattr(loudness.os, "replace", refuse)

    outcome = await loudness.normalize(ffmpeg, silent_audio(tmp_path / "song.mp3"))

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
    song = await add_song(session, silent_audio(tmp_path / "song.mp3"))

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
    """The audio as samples: a write that changed one of them changed the song."""
    result = run("-loglevel", "error", "-i", str(file), "-map", "0:a:0", "-f", "md5", "-")
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def duration_line(dump: str) -> str:
    """`Duration: 00:00:05.04, start: 0.023021, bitrate: …` without the bitrate, which a
    bigger tag lowers: where the decoded audio starts is what USDX times the lyrics by."""
    [line] = [line.strip() for line in dump.splitlines() if line.strip().startswith("Duration:")]
    return line.partition(", bitrate")[0]


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
        ("song.m4a", "aac"),
    ],
)
async def test_a_real_file_is_tagged_the_way_usdx_reads_it(
    tmp_path: Path, name: str, codec: str
) -> None:
    assert REAL_FFMPEG is not None
    cover = make_cover(tmp_path) if name.endswith((".mp3", ".flac")) else None
    song = generate(tmp_path / name, codec, cover)
    before = decoded_md5(song)
    starts = duration_line(run("-i", str(song)).stderr)

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
    # Nothing else moved: the samples, where they start, the title, the picture.
    assert decoded_md5(song) == before
    assert duration_line(dump) == starts
    assert _tag_level(dump, "title") == level
    if cover is not None:
        assert "(attached pic)" in dump
    assert listing(tmp_path) == sorted([name, *(["cover.jpg"] if cover else [])])
    # A second pass finds the tag and leaves the file alone.
    again = await loudness.normalize(REAL_FFMPEG, song)
    assert again == Outcome("already_tagged", outcome.gain)


@needs_ffmpeg
@pytest.mark.parametrize(("name", "codec"), [("song.wav", "pcm_s16le"), ("song.aac", "aac")])
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
    assert listing(tmp_path) == [name]


@needs_ffmpeg
async def test_a_real_mp3_without_an_info_frame_keeps_its_start(tmp_path: Path) -> None:
    """What ffmpeg's stream copy got wrong: its mp3 muxer gave such a file an info frame,
    the decoder then skipped the encoder's delay, and the song played 12 ms early against
    its lyrics. mutagen touches no frame, so the samples and their start stay."""
    assert REAL_FFMPEG is not None
    song = generate(tmp_path / "song.mp3", "libmp3lame", options=("-write_xing", "0"))
    before = decoded_md5(song)
    starts = duration_line(run("-i", str(song)).stderr)
    assert "start: 0.000000" in starts

    outcome = await loudness.normalize(REAL_FFMPEG, song)

    assert outcome.status == "tagged", outcome.detail
    assert decoded_md5(song) == before
    assert duration_line(run("-i", str(song)).stderr) == starts


@needs_ffmpeg
async def test_a_real_mp3_with_an_id3v2_4_footer_keeps_its_start(tmp_path: Path) -> None:
    """The footer left behind was junk ffmpeg skipped together with the info frame after it:
    another MD5, and a start 23 ms earlier."""
    assert REAL_FFMPEG is not None
    plain = generate(tmp_path / "plain.mp3", "libmp3lame", options=("-id3v2_version", "0"))
    title = b"\x00Kept"
    frame = b"TIT2" + syncsafe(len(title)) + b"\x00\x00" + title
    song = tmp_path / "song.mp3"
    song.write_bytes(id3v2_tag(4, frame, footer=True) + plain.read_bytes())
    plain.unlink()
    before = decoded_md5(song)
    starts = duration_line(run("-i", str(song)).stderr)

    outcome = await loudness.normalize(REAL_FFMPEG, song)

    assert outcome.status == "tagged", outcome.detail
    assert decoded_md5(song) == before
    assert duration_line(run("-i", str(song)).stderr) == starts


@needs_ffmpeg
async def test_a_real_mp3_keeps_its_id3v1_and_apev2_tags(tmp_path: Path) -> None:
    """[ID3v2][audio][APEv2][ID3v1], the order taggers write them in: every byte after the
    ID3v2 tag is the same after the write."""
    assert REAL_FFMPEG is not None
    song = generate(tmp_path / "song.mp3", "libmp3lame")
    ape = APEv2()
    ape["Artist"] = "APE Artist"
    ape.save(song)
    v1 = id3v1_tag("V1 Title")
    with song.open("ab") as file:
        file.write(v1)
    before = song.read_bytes()
    tag_size = ID3(song).size
    samples = decoded_md5(song)

    outcome = await loudness.normalize(REAL_FFMPEG, song)

    assert outcome.status == "tagged", outcome.detail
    after = song.read_bytes()
    assert after[ID3(song).size :] == before[tag_size:]
    assert after.endswith(v1)
    assert dict(APEv2(song)) == {"Artist": "APE Artist"}
    assert decoded_md5(song) == samples
    assert await loudness.read_tags(REAL_FFMPEG, song) == outcome.gain


@needs_ffmpeg
async def test_a_real_mp3_without_any_tag_gets_one(tmp_path: Path) -> None:
    assert REAL_FFMPEG is not None
    song = generate(tmp_path / "song.mp3", "libmp3lame", options=("-id3v2_version", "0"))
    content = song.read_bytes()
    assert content[:3] != b"ID3"

    outcome = await loudness.normalize(REAL_FFMPEG, song)

    assert outcome.status == "tagged", outcome.detail
    assert song.read_bytes()[ID3(song).size :] == content
    assert await loudness.read_tags(REAL_FFMPEG, song) == outcome.gain


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
    assert listing(folder) == [song.name]


@needs_ffmpeg
@pytest.mark.skipif(os.name != "nt", reason="only Windows refuses to replace an open file")
async def test_a_real_file_held_open_is_in_use_and_intact(tmp_path: Path) -> None:
    """Python opens a file the way most Windows programs do, without `FILE_SHARE_DELETE`:
    it may be read and copied, nothing may replace it."""
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
async def test_a_real_read_only_file_is_left_alone(tmp_path: Path) -> None:
    assert REAL_FFMPEG is not None
    song = generate(tmp_path / "song.mp3", "libmp3lame")
    content = song.read_bytes()
    song.chmod(stat.S_IREAD)
    try:
        outcome = await loudness.normalize(REAL_FFMPEG, song)
    finally:
        song.chmod(stat.S_IREAD | stat.S_IWRITE)

    assert outcome.status == "failed"
    assert outcome.detail is not None and "read-only" in outcome.detail
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
