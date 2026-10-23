"""The pass that evens out the loudness of the songs already in the library.

The ffmpeg is `test_downloads_loudness`'s fake and the writer the real mutagen, so a song
that gets tagged is a real silent file out of `fixtures/loudness/`, and one that never gets
written may be a JSON stand-in.
"""

import asyncio
import contextlib
import json
import logging
from collections.abc import Callable
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import test_karaoke_api
from test_downloads_loudness import (
    DEFAULT_GAIN,
    fake_audio,
    fake_ffmpeg,
    ffmpeg_calls,
    kinds,
    listing,
    silent_audio,
    tags_of,
)
from test_karaoke_api import LAUNCH_URL, FakeUsdx, add_player, make_song_dir, sing
from ultrastar_wingman.app import create_app
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.downloads import loudness, loudness_pass, media
from ultrastar_wingman.downloads.schema import LoudnessPassRead, LoudnessPassStatus
from ultrastar_wingman.karaoke import service as karaoke
from ultrastar_wingman.settings import SettingsService
from ultrastar_wingman.songs import scanner
from ultrastar_wingman.songs.model import Song
from ultrastar_wingman.sources.base import DownloadError

LOGGER = "ultrastar_wingman.downloads"
EVENT_KEYS = set(LoudnessPassRead.model_fields) | {"event"}

# The fake-USDX fixtures, bound here so pytest can resolve them by name (the
# `test_devices_api` precedent): the real sing and the real Launch, not a stand-in for
# `busy`, are what prove the pass holds still for them.
fake_usdx = test_karaoke_api.fake_usdx
configured = test_karaoke_api.configured


# How long the fake ffmpeg measures where a test stops it mid-measurement.
MEASURE_SLEEP = 3


@pytest.fixture
def killed(monkeypatch: pytest.MonkeyPatch) -> list[asyncio.subprocess.Process]:
    """Every subprocess somebody killed. Not a stopwatch: on Windows the fake ffmpeg is a
    batch file in front of a python process, and killing the batch file leaves the python
    child holding the pipes for its whole sleep, which a real ffmpeg (one process) never
    does — so how long a stop takes says nothing here, and the kill is the evidence."""
    processes: list[asyncio.subprocess.Process] = []
    real_kill = asyncio.subprocess.Process.kill

    def kill(process: asyncio.subprocess.Process) -> None:
        processes.append(process)
        real_kill(process)

    monkeypatch.setattr(asyncio.subprocess.Process, "kill", kill)
    return processes


@pytest.fixture(autouse=True)
def quick_waits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(loudness_pass, "WAIT_SECONDS", 0.01)


class Room:
    """What `loudness_pass.busy` answers: whether a song is being sung."""

    def __init__(self) -> None:
        self.singing = False


@pytest.fixture
def room(monkeypatch: pytest.MonkeyPatch) -> Room:
    room = Room()
    monkeypatch.setattr(loudness_pass, "busy", lambda: room.singing)
    return room


def sing_after_measuring(monkeypatch: pytest.MonkeyPatch, room: Room) -> None:
    """Somebody presses Play while ffmpeg measures: the song in hand is measured, and the
    pass reaches its write with a song running."""
    real_measure = loudness.measure

    async def measure_then_sing(ffmpeg: str, file: Path) -> loudness.ReplayGain | None:
        measured = await real_measure(ffmpeg, file)
        room.singing = True
        return measured

    monkeypatch.setattr(loudness, "measure", measure_then_sing)


async def with_fake_ffmpeg(session: AsyncSession, directory: Path, **control: object) -> str:
    ffmpeg = fake_ffmpeg(directory, **control)
    await SettingsService(session).set(media.FFMPEG_SETTING, ffmpeg)
    return ffmpeg


async def add_song(
    session: AsyncSession,
    number: int,
    artist: str,
    title: str,
    audio_file: Path | None,
    gain: float | None = None,
) -> Song:
    song = Song(
        id=f"usdb:{number}",
        source="usdb",
        source_id=str(number),
        title=title,
        artist=artist,
        fingerprint=f"{artist}|{title}".casefold(),
        # Unique per row; the pass goes by `audio_file` alone.
        directory=f"/library/{number}",
        txt_file="song.txt",
        audio_file=None if audio_file is None else str(audio_file),
        replay_gain_db=gain,
    )
    session.add(song)
    await session.commit()
    return song


async def row(session: AsyncSession, song_id: str) -> tuple[float | None, float | None]:
    song = await session.get(Song, song_id, populate_existing=True)
    assert song is not None
    return song.replay_gain_db, song.replay_gain_peak


async def run_pass(
    session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> LoudnessPassStatus:
    await loudness_pass.start(session_factory, tmp_path)
    assert loudness_pass._task is not None
    await loudness_pass._task
    return loudness_pass.read()


async def until(condition: Callable[[], bool], seconds: float = 10.0) -> None:
    async with asyncio.timeout(seconds):
        while True:
            if condition():
                return
            await asyncio.sleep(0.01)


def measured_files(ffmpeg: str) -> list[str]:
    """The file of every measurement, in the order ffmpeg was asked."""
    return [
        Path(arguments[arguments.index("-i") + 1]).name
        for arguments in ffmpeg_calls(ffmpeg)
        if any("ebur128" in argument for argument in arguments)
    ]


def read_files(ffmpeg: str) -> list[str]:
    """The file of every read of a song's own file (not of a tagged copy), in order."""
    names = [
        Path(arguments[arguments.index("-i") + 1]).name
        for arguments in ffmpeg_calls(ffmpeg)
        if "ffmetadata" in arguments
    ]
    return [name for name in names if loudness.TEMP_MARKER not in name]


def loudness_events(events: list[dict[str, object]]) -> list[dict[str, object]]:
    payloads: list[dict[str, object]] = []
    for event in events:
        if event["event"] != "loudness.changed":
            continue
        # Never the song in hand: every socket gets this, a guest's too.
        assert set(event) == {"event", "loudness"}
        payload = event["loudness"]
        assert isinstance(payload, dict)
        assert set(payload) | {"event"} == EVENT_KEYS
        payloads.append(payload)
    return payloads


# --- one pass over a library -------------------------------------------------------------


async def test_a_pass_over_a_mixed_library(
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    tmp_path: Path,
    broadcast_events: list[dict[str, object]],
    caplog: pytest.LogCaptureFixture,
) -> None:
    ffmpeg = await with_fake_ffmpeg(session, tmp_path / "tools")
    library = tmp_path / "library"
    corrupt = library / "corrupt.mp3"
    corrupt.parent.mkdir(parents=True)
    corrupt.write_bytes(b"\xff\xfb not json")
    silent = library / "silent.mp3"
    silent.write_text(
        json.dumps({"audio": "song", "tags": {}, "integrated": "-70.0", "true_peak": "-inf"}),
        encoding="utf-8",
    )
    # Added out of order: the pass goes by artist, then title, whatever the case.
    await add_song(session, 1, "zebra", "Damaged", corrupt)
    await add_song(session, 2, "Abba", "Waterloo", silent_audio(library / "untagged.mp3"))
    await add_song(
        session,
        3,
        "abba",
        "Dancing Queen",
        fake_audio(library / "tagged.mp3", {"REPLAYGAIN_TRACK_GAIN": "-3.00 dB"}),
    )
    await add_song(session, 4, "Beatles", "Help", fake_audio(library / "help.wav"))
    await add_song(session, 5, "Cher", "Believe", silent)
    await add_song(session, 6, "Doors", "Gone", library / "not-there.mp3")
    # Never visited: one whose loudness is known, one without any audio.
    await add_song(session, 7, "Earlier", "Known", fake_audio(library / "known.mp3"), gain=-1.0)
    await add_song(session, 8, "Video", "Only", None)
    caplog.set_level(logging.DEBUG, logger=LOGGER)

    status = await run_pass(session_factory, tmp_path)

    assert (status.state, status.ended, status.error) == ("idle", "finished", None)
    assert (status.total, status.done, status.song, status.waiting) == (6, 6, None, False)
    assert status.counts.model_dump() == {
        "tagged": 1,
        "already_tagged": 1,
        "unsupported": 1,
        "silent": 1,
        "missing": 1,
        "in_use": 0,
        "failed": 1,
    }
    assert read_files(ffmpeg)[:5] == [
        "tagged.mp3",
        "untagged.mp3",
        "help.wav",
        "silent.mp3",
        "corrupt.mp3",
    ]
    assert await row(session, "usdb:2") == DEFAULT_GAIN
    assert await row(session, "usdb:3") == (-3.0, None)
    # Measured, its format keeps no tag: the numbers are still worth keeping.
    assert await row(session, "usdb:4") == DEFAULT_GAIN
    assert await row(session, "usdb:5") == loudness.SILENT_GAIN
    assert await row(session, "usdb:6") == (None, None)
    assert await row(session, "usdb:1") == (None, None)
    assert await row(session, "usdb:7") == (-1.0, None)
    assert tags_of(library / "untagged.mp3")["REPLAYGAIN_TRACK_GAIN"] == "7.90 dB"
    assert "known.mp3" not in read_files(ffmpeg)

    events = loudness_events(broadcast_events)
    assert events[0] | {"counts": None} == {
        "state": "running",
        "waiting": False,
        "total": 0,
        "done": 0,
        "counts": None,
        "ended": None,
        "error": None,
    }
    assert events[-1] == status.model_dump(mode="json", exclude={"song"})
    # The start, the total, one per song, and the end.
    assert len(events) == 1 + 1 + 6 + 1

    lines = [
        (record.levelno, record.getMessage())
        for record in caplog.records
        if record.levelno >= logging.INFO and record.name.endswith("loudness_pass")
    ]
    assert lines == [
        (logging.INFO, "Evening out the loudness of 6 songs"),
        (
            logging.WARNING,
            "Could not even out the loudness of zebra - Damaged: ffmpeg failed with exit code 1: "
            f"{corrupt}: Invalid data found when processing input",
        ),
        (
            logging.INFO,
            "Evened out the loudness of 6 songs: 1 tagged, 1 already tagged, 1 unsupported, "
            "1 silent, 1 missing, 1 failed",
        ),
    ]
    # Nothing else of Wingman said anything above debug about it: no line twice.
    assert [
        record.getMessage()
        for record in caplog.records
        if record.levelno >= logging.INFO and not record.name.endswith("loudness_pass")
    ] == []


async def test_a_second_pass_only_visits_what_is_left(
    session_factory: async_sessionmaker[AsyncSession], session: AsyncSession, tmp_path: Path
) -> None:
    ffmpeg = await with_fake_ffmpeg(session, tmp_path / "tools")
    library = tmp_path / "library"
    corrupt = library / "corrupt.mp3"
    corrupt.parent.mkdir(parents=True)
    corrupt.write_bytes(b"not audio")
    silent = library / "silent.mp3"
    silent.write_text(
        json.dumps({"audio": "song", "tags": {}, "integrated": "-70.0", "true_peak": "-inf"}),
        encoding="utf-8",
    )
    await add_song(session, 1, "A", "Tagged", silent_audio(library / "untagged.mp3"))
    await add_song(session, 2, "B", "Silent", silent)
    await add_song(session, 3, "C", "Wave", fake_audio(library / "help.wav"))
    await add_song(session, 4, "D", "Damaged", corrupt)
    await run_pass(session_factory, tmp_path)
    (Path(ffmpeg).parent / "ffmpeg-calls.jsonl").unlink()

    status = await run_pass(session_factory, tmp_path)

    # Only the damaged file, which is tried again in case somebody repaired it.
    assert (status.total, status.done, status.counts.failed) == (1, 1, 1)
    assert read_files(ffmpeg) == ["corrupt.mp3"]


async def test_a_pass_with_nothing_to_do_never_looks_for_ffmpeg(
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def no_ffmpeg(*arguments: object) -> str:
        raise AssertionError("ffmpeg was looked for")

    monkeypatch.setattr(media, "ensure_ffmpeg", no_ffmpeg)
    await add_song(session, 1, "A", "Known", fake_audio(tmp_path / "a.mp3"), gain=-2.0)

    status = await run_pass(session_factory, tmp_path)

    assert (status.state, status.ended, status.total, status.error) == ("idle", "finished", 0, None)


async def test_no_ffmpeg_refuses_the_pass_in_one_sentence(
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    sentence = "ffmpeg not found. Install it (e.g. apt/brew) or set the downloads.ffmpeg setting"

    async def no_ffmpeg(*arguments: object) -> str:
        raise DownloadError(sentence)

    monkeypatch.setattr(media, "ensure_ffmpeg", no_ffmpeg)
    song = silent_audio(tmp_path / "song.mp3")
    content = song.read_bytes()
    await add_song(session, 1, "A", "Song", song)
    caplog.set_level(logging.INFO, logger=LOGGER)

    status = await run_pass(session_factory, tmp_path)

    assert (status.state, status.ended, status.error, status.total) == (
        "idle",
        "failed",
        sentence,
        0,
    )
    assert song.read_bytes() == content
    [record] = [record for record in caplog.records if record.levelno >= logging.WARNING]
    assert record.getMessage() == f"Could not even out the loudness of the songs: {sentence}"
    assert record.exc_info is None


# --- holding still for a song ------------------------------------------------------------


async def test_the_pass_waits_for_a_song_before_it_starts_one(
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    tmp_path: Path,
    room: Room,
) -> None:
    ffmpeg = await with_fake_ffmpeg(session, tmp_path / "tools")
    await add_song(session, 1, "A", "Song", silent_audio(tmp_path / "library" / "song.mp3"))
    room.singing = True

    await loudness_pass.start(session_factory, tmp_path)
    await until(lambda: loudness_pass.read().waiting)

    assert ffmpeg_calls(ffmpeg) == []
    room.singing = False
    assert loudness_pass._task is not None
    await loudness_pass._task
    assert loudness_pass.read().counts.tagged == 1


async def test_a_song_started_mid_pass_holds_the_write_back(
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    tmp_path: Path,
    room: Room,
    monkeypatch: pytest.MonkeyPatch,
    broadcast_events: list[dict[str, object]],
) -> None:
    ffmpeg = await with_fake_ffmpeg(session, tmp_path / "tools")
    song = silent_audio(tmp_path / "library" / "song.mp3")
    content = song.read_bytes()
    await add_song(session, 1, "A", "Song", song)
    sing_after_measuring(monkeypatch, room)

    await loudness_pass.start(session_factory, tmp_path)
    await until(lambda: loudness_pass.read().waiting)
    await asyncio.sleep(0.1)

    # Measured, and not one byte written while the song runs.
    assert kinds(ffmpeg) == ["read", "measure"]
    assert song.read_bytes() == content
    assert listing(song.parent) == ["song.mp3"]
    assert await row(session, "usdb:1") == (None, None)
    assert loudness_events(broadcast_events)[-1]["waiting"] is True

    room.singing = False
    assert loudness_pass._task is not None
    await loudness_pass._task
    assert tags_of(song)["REPLAYGAIN_TRACK_GAIN"] == "7.90 dB"
    assert await row(session, "usdb:1") == DEFAULT_GAIN


async def test_a_song_started_while_the_write_waits_for_the_lock_holds_it_back(
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    tmp_path: Path,
    room: Room,
) -> None:
    """The look inside the scanner's lock: a scan held the write up, and somebody pressed
    Play meanwhile. The look before the lock was taken saw a free room."""
    ffmpeg = await with_fake_ffmpeg(session, tmp_path / "tools")
    song = silent_audio(tmp_path / "library" / "song.mp3")
    content = song.read_bytes()
    await add_song(session, 1, "A", "Song", song)
    lock = scanner.library_lock()

    async with lock:
        await loudness_pass.start(session_factory, tmp_path)
        await until(lambda: kinds(ffmpeg) == ["read", "measure"])
        await asyncio.sleep(0.1)
        assert not loudness_pass.read().waiting
        room.singing = True
    await until(lambda: loudness_pass.read().waiting)
    await asyncio.sleep(0.1)

    assert song.read_bytes() == content
    assert listing(song.parent) == ["song.mp3"]
    room.singing = False
    assert loudness_pass._task is not None
    await loudness_pass._task
    assert tags_of(song)["REPLAYGAIN_TRACK_GAIN"] == "7.90 dB"


async def startup_scan_done() -> None:
    """The lifespan's own scan, over a songs directory the test fills only afterwards: once
    it is done it cannot reconcile a row the test adds."""
    task = scanner._scan_task
    if task is not None:
        with contextlib.suppress(Exception):
            await task


async def song_in_usdx(session: AsyncSession, usdx: FakeUsdx) -> tuple[str, Path]:
    """A song USDX can be started with, its audio a real file the pass may tag."""
    directory = make_song_dir(usdx.songs_dir, "Artist - Title")
    audio = silent_audio(directory / "song.mp3")
    session.add(
        Song(
            id="usdb:1234",
            source="usdb",
            source_id="1234",
            title="Title",
            artist="Artist",
            fingerprint="artist|title",
            directory=str(directory),
            txt_file=str(directory / "song.txt"),
            audio_file=str(audio),
        )
    )
    await session.commit()
    return "usdb:1234", audio


async def test_a_sing_started_while_its_song_is_measured_holds_that_write_back(
    client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    configured: FakeUsdx,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The real sing flow, not a stand-in for `busy`: Play is pressed for the very song
    ffmpeg is measuring, and its file is not written until the song is over."""
    await startup_scan_done()
    ffmpeg = await with_fake_ffmpeg(session, tmp_path / "tools")
    song_id, audio = await song_in_usdx(session, configured)
    content = audio.read_bytes()
    player = await add_player(client, "Yannis")
    configured.behave(sleep=1.5)
    real_measure = loudness.measure

    async def measure_then_sing(ffmpeg: str, file: Path) -> loudness.ReplayGain | None:
        measured = await real_measure(ffmpeg, file)
        await sing(client, song_id, [{"color": "blue", "player_id": player["id"]}])
        return measured

    monkeypatch.setattr(loudness, "measure", measure_then_sing)

    await loudness_pass.start(session_factory, tmp_path)
    await until(lambda: loudness_pass.read().waiting)

    assert karaoke.current_sing() is not None
    assert kinds(ffmpeg) == ["read", "measure"]
    assert audio.read_bytes() == content
    assert await row(session, song_id) == (None, None)

    await karaoke.wait_for_sing_end()
    assert loudness_pass._task is not None
    await asyncio.wait_for(loudness_pass._task, 20)
    assert tags_of(audio)["REPLAYGAIN_TRACK_GAIN"] == "7.90 dB"
    assert await row(session, song_id) == DEFAULT_GAIN


async def test_an_ultrastar_deluxe_opened_by_hand_holds_the_pass_still(
    client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    configured: FakeUsdx,
    tmp_path: Path,
) -> None:
    """Launched for its own settings, USDX may play any song's preview in its menus: the
    pass waits for it to close, then carries on by itself."""
    await startup_scan_done()
    ffmpeg = await with_fake_ffmpeg(session, tmp_path / "tools")
    song = silent_audio(tmp_path / "library" / "song.mp3")
    await add_song(session, 1, "A", "Song", song)
    configured.behave(sleep=1.5)
    assert (await client.post(LAUNCH_URL)).json() == {"started": True}

    await loudness_pass.start(session_factory, tmp_path)
    await until(lambda: loudness_pass.read().waiting)

    assert karaoke.usdx_is_open()
    assert ffmpeg_calls(ffmpeg) == []
    assert loudness_pass._task is not None
    await asyncio.wait_for(loudness_pass._task, 20)
    assert not karaoke.usdx_is_open()
    assert loudness_pass.read().counts.tagged == 1
    assert tags_of(song)["REPLAYGAIN_TRACK_GAIN"] == "7.90 dB"


# --- the library changing under the pass -------------------------------------------------


async def test_a_song_given_another_audio_file_mid_measure_is_left_alone(
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A rescan found the txt naming another file (and cleared the numbers, the scanner's
    rule): the measurement is the old file's, so nothing of it is written anywhere."""
    await with_fake_ffmpeg(session, tmp_path / "tools")
    song = silent_audio(tmp_path / "library" / "song.mp3")
    content = song.read_bytes()
    await add_song(session, 1, "A", "Song", song)
    other = str(tmp_path / "library" / "other.mp3")
    real_measure = loudness.measure

    async def measure_then_rescan(*arguments: object) -> loudness.ReplayGain | None:
        measured = await real_measure(*arguments)  # type: ignore[arg-type]
        async with session_factory() as rescan:
            await rescan.execute(update(Song).values(audio_file=other))
            await rescan.commit()
        return measured

    monkeypatch.setattr(loudness, "measure", measure_then_rescan)

    status = await run_pass(session_factory, tmp_path)

    assert (status.ended, status.done) == ("finished", 1)
    assert set(status.counts.model_dump().values()) == {0}
    assert song.read_bytes() == content
    assert await row(session, "usdb:1") == (None, None)


async def test_a_song_given_another_audio_file_after_the_write_keeps_no_numbers(
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The rescan lands between the write and the row: the file is tagged, but the numbers
    are that file's and the row names another one now, so they stay off it."""
    await with_fake_ffmpeg(session, tmp_path / "tools")
    song = silent_audio(tmp_path / "library" / "song.mp3")
    await add_song(session, 1, "A", "Song", song)
    other = str(tmp_path / "library" / "other.mp3")
    real_write = loudness.write_tags

    async def write_then_rescan(*arguments: object) -> None:
        await real_write(*arguments)  # type: ignore[arg-type]
        async with session_factory() as rescan:
            await rescan.execute(update(Song).values(audio_file=other))
            await rescan.commit()

    monkeypatch.setattr(loudness, "write_tags", write_then_rescan)

    await run_pass(session_factory, tmp_path)

    assert tags_of(song)["REPLAYGAIN_TRACK_GAIN"] == "7.90 dB"
    assert await row(session, "usdb:1") == (None, None)


async def test_a_song_a_download_tagged_mid_measure_is_not_written_twice(
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A re-download landed and its own step tagged the song while the pass measured the
    file it replaced: the download's numbers stand, and the pass writes nothing."""
    await with_fake_ffmpeg(session, tmp_path / "tools")
    song = silent_audio(tmp_path / "library" / "song.mp3")
    content = song.read_bytes()
    await add_song(session, 1, "A", "Song", song)
    real_measure = loudness.measure

    async def measure_then_download(*arguments: object) -> loudness.ReplayGain | None:
        measured = await real_measure(*arguments)  # type: ignore[arg-type]
        async with session_factory() as download:
            await download.execute(update(Song).values(replay_gain_db=-4.0, replay_gain_peak=0.5))
            await download.commit()
        return measured

    monkeypatch.setattr(loudness, "measure", measure_then_download)

    status = await run_pass(session_factory, tmp_path)

    assert (status.done, status.counts.tagged) == (1, 0)
    assert song.read_bytes() == content
    assert await row(session, "usdb:1") == (-4.0, 0.5)


# --- stopping ----------------------------------------------------------------------------


async def test_stopping_mid_measurement_writes_nothing(
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    tmp_path: Path,
    broadcast_events: list[dict[str, object]],
    killed: list[asyncio.subprocess.Process],
) -> None:
    ffmpeg = await with_fake_ffmpeg(session, tmp_path / "tools", measure_sleep=MEASURE_SLEEP)
    first = silent_audio(tmp_path / "library" / "first.mp3")
    second = silent_audio(tmp_path / "other" / "second.mp3")
    content = first.read_bytes()
    await add_song(session, 1, "A", "First", first)
    await add_song(session, 2, "B", "Second", second)

    await loudness_pass.start(session_factory, tmp_path)
    await until(lambda: "measure" in kinds(ffmpeg))
    await loudness_pass.stop()

    # The measuring ffmpeg was stopped, not waited for (`killed`).
    assert len(killed) == 1
    status = loudness_pass.read()
    assert (status.state, status.ended, status.done, status.total) == ("idle", "stopped", 0, 2)
    assert first.read_bytes() == content
    assert listing(first.parent) == ["first.mp3"]
    assert await row(session, "usdb:1") == (None, None)
    assert "second.mp3" not in read_files(ffmpeg)
    states = [event["state"] for event in loudness_events(broadcast_events)]
    assert states[-2:] == ["stopping", "idle"]


async def test_stopping_while_waiting_for_a_song_writes_nothing(
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    tmp_path: Path,
    room: Room,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await with_fake_ffmpeg(session, tmp_path / "tools")
    song = silent_audio(tmp_path / "library" / "song.mp3")
    content = song.read_bytes()
    await add_song(session, 1, "A", "Song", song)
    sing_after_measuring(monkeypatch, room)
    await loudness_pass.start(session_factory, tmp_path)
    await until(lambda: loudness_pass.read().waiting)

    await loudness_pass.stop()

    assert loudness_pass.read().ended == "stopped"
    assert song.read_bytes() == content
    assert listing(song.parent) == ["song.mp3"]


async def test_stopping_mid_write_finishes_the_song_in_hand(
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await with_fake_ffmpeg(session, tmp_path / "tools")
    song = silent_audio(tmp_path / "library" / "song.mp3")
    await add_song(session, 1, "A", "Song", song)
    await add_song(session, 2, "B", "Next", silent_audio(tmp_path / "other" / "next.mp3"))
    writing = asyncio.Event()
    real_write = loudness.write_tags

    async def slow_write(*arguments: object) -> None:
        writing.set()
        await asyncio.sleep(0.3)
        await real_write(*arguments)  # type: ignore[arg-type]

    monkeypatch.setattr(loudness, "write_tags", slow_write)
    await loudness_pass.start(session_factory, tmp_path)
    await writing.wait()

    await loudness_pass.stop()

    # The file is tagged whole; the row learns it on the next pass, which finds the tag.
    assert tags_of(song)["REPLAYGAIN_TRACK_GAIN"] == "7.90 dB"
    assert listing(song.parent) == ["song.mp3"]
    assert loudness_pass.read().ended == "stopped"
    assert tags_of(tmp_path / "other" / "next.mp3") == {}


async def test_stopping_no_pass_is_no_mistake() -> None:
    await loudness_pass.stop()

    assert loudness_pass.read().state == "idle"


async def test_stopping_a_pass_that_never_got_going_ends_it(
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    tmp_path: Path,
    broadcast_events: list[dict[str, object]],
) -> None:
    """Stopped in the same breath as it was started: the task is cancelled before its first
    step, so the stop is what says how it ended."""
    await add_song(session, 1, "A", "Song", silent_audio(tmp_path / "library" / "song.mp3"))

    await loudness_pass.start(session_factory, tmp_path)
    await loudness_pass.stop()

    status = loudness_pass.read()
    assert (status.state, status.ended) == ("idle", "stopped")
    assert loudness_events(broadcast_events)[-1]["state"] == "idle"


async def test_shutting_down_stops_a_running_pass(
    bootstrap_settings: BootstrapSettings,
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
    killed: list[asyncio.subprocess.Process],
) -> None:
    """The lifespan stops a pass the host left running before the database goes, and
    leaves no task behind for the event loop to complain about."""
    caplog.set_level(logging.WARNING, logger="asyncio")
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await startup_scan_done()
        factory: async_sessionmaker[AsyncSession] = app.state.session_factory
        async with factory() as session:
            ffmpeg = await with_fake_ffmpeg(
                session, tmp_path / "tools", measure_sleep=MEASURE_SLEEP
            )
            song = silent_audio(tmp_path / "library" / "song.mp3")
            content = song.read_bytes()
            await add_song(session, 1, "A", "Song", song)
        await loudness_pass.start(factory, tmp_path)
        await until(lambda: "measure" in kinds(ffmpeg))

    assert len(killed) == 1
    task = loudness_pass._task
    assert task is not None and task.done()
    assert loudness_pass.read().ended == "stopped"
    assert song.read_bytes() == content
    assert [record.getMessage() for record in caplog.records if record.name == "asyncio"] == []


# --- a file in use -----------------------------------------------------------------------


@pytest.mark.parametrize("refusals", [1, 2])
async def test_a_file_in_use_is_tried_once_more_at_the_end(
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    refusals: int,
) -> None:
    ffmpeg = await with_fake_ffmpeg(session, tmp_path / "tools")
    held = silent_audio(tmp_path / "library" / "held.mp3")
    await add_song(session, 1, "A", "Held", held)
    await add_song(session, 2, "B", "Free", silent_audio(tmp_path / "other" / "free.mp3"))
    real_replace = loudness.os.replace
    refused: list[str] = []

    def replace(source: Path, destination: Path) -> None:
        if Path(destination).name == "held.mp3" and len(refused) < refusals:
            refused.append(Path(destination).name)
            raise PermissionError(32, "The process cannot access the file", str(destination))
        real_replace(source, destination)

    monkeypatch.setattr(loudness.os, "replace", replace)
    caplog.set_level(logging.INFO, logger=LOGGER)

    status = await run_pass(session_factory, tmp_path)

    # Held, then the next song, then held once more: never a third time.
    assert measured_files(ffmpeg) == ["held.mp3", "free.mp3", "held.mp3"]
    assert (status.total, status.done) == (2, 2)
    warnings = [record.getMessage() for record in caplog.records if record.levelno >= 30]
    if refusals == 1:
        assert (status.counts.tagged, status.counts.in_use) == (2, 0)
        assert await row(session, "usdb:1") == DEFAULT_GAIN
        assert warnings == []
    else:
        assert (status.counts.tagged, status.counts.in_use) == (1, 1)
        assert await row(session, "usdb:1") == (None, None)
        # Once, for the last try alone.
        assert len(warnings) == 1
        assert warnings[0].startswith("Could not even out the loudness of A - Held: ")
        assert "is in use" in warnings[0]


async def test_a_song_deleted_mid_pass_is_left_alone(
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await with_fake_ffmpeg(session, tmp_path / "tools")
    song = silent_audio(tmp_path / "library" / "song.mp3")
    content = song.read_bytes()
    await add_song(session, 1, "A", "Song", song)
    real_measure = loudness.measure

    async def measure_then_delete(*arguments: object) -> loudness.ReplayGain | None:
        measured = await real_measure(*arguments)  # type: ignore[arg-type]
        async with session_factory() as other:
            gone = await other.get(Song, "usdb:1")
            await other.delete(gone)
            await other.commit()
        return measured

    monkeypatch.setattr(loudness, "measure", measure_then_delete)

    status = await run_pass(session_factory, tmp_path)

    # Done, and counted under no outcome: nothing came of it.
    assert (status.ended, status.done) == ("finished", 1)
    assert set(status.counts.model_dump().values()) == {0}
    assert song.read_bytes() == content


# --- the routes --------------------------------------------------------------------------


async def test_the_routes_start_refuse_and_stop_a_pass(
    client: AsyncClient,
    session: AsyncSession,
    tmp_path: Path,
    room: Room,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await with_fake_ffmpeg(session, tmp_path / "tools")
    await add_song(session, 1, "A", "Song", silent_audio(tmp_path / "library" / "song.mp3"))
    # Holds still before the write, so it is still running for the second press.
    real_measure = loudness.measure
    sing_after_measuring(monkeypatch, room)

    idle = await client.get("/api/v1/downloads/loudness")
    assert idle.status_code == 200
    assert idle.json() | {"counts": None} == {
        "state": "idle",
        "waiting": False,
        "total": 0,
        "done": 0,
        "counts": None,
        "ended": None,
        "error": None,
        "song": None,
    }

    started = await client.post("/api/v1/downloads/loudness")
    assert (started.status_code, started.json()["state"]) == (202, "running")
    await until(lambda: loudness_pass.read().waiting)
    assert (await client.get("/api/v1/downloads/loudness")).json()["song"] == {
        "id": "usdb:1",
        "title": "Song",
        "artist": "A",
    }
    again = await client.post("/api/v1/downloads/loudness")
    assert (again.status_code, again.json()) == (409, {"detail": "loudness_running"})

    stopped = await client.delete("/api/v1/downloads/loudness")
    assert stopped.status_code == 200
    assert stopped.json()["state"] == "idle"
    assert stopped.json()["ended"] == "stopped"
    assert (await client.delete("/api/v1/downloads/loudness")).status_code == 200

    # A stopped pass takes the next press: the song it left is still to do.
    room.singing = False
    monkeypatch.setattr(loudness, "measure", real_measure)
    restarted = await client.post("/api/v1/downloads/loudness")
    assert (restarted.status_code, restarted.json()["state"]) == (202, "running")
    assert loudness_pass._task is not None
    await loudness_pass._task
    assert loudness_pass.read().counts.tagged == 1


async def test_the_pass_runs_whatever_the_normalize_setting_says(
    client: AsyncClient, session: AsyncSession, tmp_path: Path
) -> None:
    """The setting is about downloads; the button is its own decision."""
    await with_fake_ffmpeg(session, tmp_path / "tools")
    await SettingsService(session).set(loudness.NORMALIZE_SETTING, False)
    await add_song(session, 1, "A", "Song", silent_audio(tmp_path / "library" / "song.mp3"))

    assert (await client.post("/api/v1/downloads/loudness")).status_code == 202
    assert loudness_pass._task is not None
    await loudness_pass._task

    assert loudness_pass.read().counts.tagged == 1


async def test_a_guest_may_not_see_or_start_the_pass(anonymous_client: AsyncClient) -> None:
    for method in ("GET", "POST", "DELETE"):
        response = await anonymous_client.request(method, "/api/v1/downloads/loudness")
        assert response.status_code in (401, 403), method
    assert loudness_pass._task is None
