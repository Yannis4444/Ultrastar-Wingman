import asyncio
import logging
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from test_downloads_loudness import DEFAULT_GAIN, fake_ffmpeg, kinds, silent_audio, tags_of
from test_song_scanner import make_song_dir
from ultrastar_wingman.downloads import loudness, media, service
from ultrastar_wingman.downloads.model import INTERRUPTED_ERROR, Download
from ultrastar_wingman.settings import SettingsService
from ultrastar_wingman.songs import scanner
from ultrastar_wingman.songs.model import Song
from ultrastar_wingman.sources import SOURCES, DownloadError, ProgressReport

# Safety net for the barrier/event synchronisation below: a deadlock has to fail the
# test, not hang the suite.
TIMEOUT = 10.0


class FakeSource:
    """A song source that writes a song directory without touching the network."""

    source = "fake"
    display_name = "Fake"

    def __init__(self, library: Path) -> None:
        self.library = library
        self.error: str | None = None
        # Holds every download inside `download()` until the test releases it.
        self.gate: asyncio.Event | None = None
        # Releases only once as many downloads as it has parties are running at once.
        self.barrier: asyncio.Barrier | None = None
        # Return a directory that holds no song txt at all.
        self.broken = False
        self.concurrent = 0
        self.max_concurrent = 0
        self.work_dirs: list[Path] = []
        # Write a `song.mp3` the fake ffmpeg understands (`test_downloads_loudness`), so the
        # loudness step has something to tag. Off by default: without an audio file the
        # step never looks for an ffmpeg, whatever this machine has.
        self.audio = False

    async def download(self, source_song_id: str, work_dir: Path, report: ProgressReport) -> Path:
        self.concurrent += 1
        self.max_concurrent = max(self.max_concurrent, self.concurrent)
        try:
            await report(None, "fetching")
            if self.barrier is not None:
                await self.barrier.wait()
            if self.gate is not None:
                await self.gate.wait()
            for percent in (0.0, 0.5, 40.0, 100.0):
                await report(percent, "downloading video")
            if self.error is not None:
                raise DownloadError(self.error)
            # A real source assembles the song in work_dir and moves it into the library.
            self.work_dirs.append(work_dir)
            if self.broken:
                return self.library
            if not self.audio:
                return make_song_dir(self.library, f"Song {source_song_id}", title=source_song_id)
            directory = make_song_dir(
                self.library, f"Song {source_song_id}", title=source_song_id, tags="#MP3:song.mp3\n"
            )
            silent_audio(directory / "song.mp3")
            return directory
        finally:
            self.concurrent -= 1


@pytest.fixture
def library(tmp_path: Path) -> Path:
    directory = tmp_path / "library"
    directory.mkdir()
    return directory


@pytest.fixture
def fake_source(library: Path) -> Iterator[FakeSource]:
    source = FakeSource(library)
    SOURCES[source.source] = source
    try:
        yield source
    finally:
        del SOURCES[source.source]


@pytest.fixture
async def queue(
    session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """The queue running against the test database. Always stopped: a leaked worker
    would keep using a disposed engine in the next test."""
    await service.start(session_factory, tmp_path)
    try:
        yield session_factory
    finally:
        await service.stop()


async def idle() -> None:
    await asyncio.wait_for(service.wait_for_idle(), timeout=TIMEOUT)


async def run_download(
    session: AsyncSession, source_song_id: str = "1", force: bool = False
) -> Download:
    row = await service.enqueue(session, "fake", source_song_id, force)
    await idle()
    await session.refresh(row)
    return row


def history_row(source_song_id: str, status: str, age: timedelta, **values: object) -> Download:
    """A row from an earlier run: both timestamps are set explicitly, so the column
    defaults (and `onupdate`) do not drag it back into the present."""
    moment = datetime.now(UTC) - age
    return Download(
        source="fake",
        source_song_id=source_song_id,
        status=status,
        created_at=moment,
        updated_at=moment,
        **values,
    )


async def stored(session_factory: async_sessionmaker[AsyncSession]) -> list[Download]:
    """Every row, read through a session of its own — the test's session would answer a
    pruned row from its identity map."""
    async with session_factory() as session:
        return list(await session.scalars(select(Download).order_by(Download.id)))


def broadcast_downloads(events: list[dict[str, object]]) -> list[dict[str, object]]:
    return [
        cast(dict[str, object], event["download"])
        for event in events
        if event["event"] == "download.updated"
    ]


async def test_finished_download_registers_the_song(
    queue: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    fake_source: FakeSource,
    broadcast_events: list[dict[str, object]],
) -> None:
    row = await run_download(session, "1234")

    assert row.status == "finished"
    assert row.progress == 100.0
    assert row.error is None
    assert row.song_id == "fake:1234"
    # Labels for the history: the request never carried them.
    assert (row.title, row.artist) == ("1234", "Artist")

    song = await session.get(Song, "fake:1234")
    assert song is not None
    assert song.source == "fake"
    assert song.source_id == "1234"
    assert song.title == "1234"
    assert Path(song.directory) == fake_source.library / "Song 1234"
    # The source got a scratch directory of its own, cleaned up afterwards.
    assert not fake_source.work_dirs[0].exists()

    updates = broadcast_downloads(broadcast_events)
    statuses = [update["status"] for update in updates]
    assert statuses[0] == "queued"
    assert "running" in statuses
    assert statuses[-1] == "finished"
    percents = [update["progress"] for update in updates]
    # The 0.5% step is throttled away, a full percent of movement is not.
    assert 0.5 not in percents
    assert 40.0 in percents


async def test_failed_download_keeps_the_reason(
    queue: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    fake_source: FakeSource,
) -> None:
    fake_source.error = "no video url in the txt"

    row = await run_download(session)

    assert row.status == "failed"
    assert row.error == "no video url in the txt"
    assert row.song_id is None
    assert list(await session.scalars(select(Song))) == []


async def test_the_console_says_what_was_queued_and_how_it_ended(
    queue: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    fake_source: FakeSource,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="ultrastar_wingman.downloads.service")

    await run_download(session, "1234")
    fake_source.error = "the video is private"
    await run_download(session, "99")

    lines = [record.getMessage() for record in caplog.records]
    assert lines == [
        "Download of FAKE song 1234 queued",
        "Downloaded Artist - 1234 (FAKE song 1234)",
        "Download of FAKE song 99 queued",
        "Download of FAKE song 99 failed: the video is private",
    ]
    # A source's own failure is a reason, not a bug: no traceback under it.
    assert not caplog.records[-1].exc_info


async def with_fake_ffmpeg(session: AsyncSession, directory: Path, **control: object) -> str:
    ffmpeg = fake_ffmpeg(directory, **control)
    await SettingsService(session).set(media.FFMPEG_SETTING, ffmpeg)
    return ffmpeg


async def test_a_download_is_tagged_with_its_loudness(
    queue: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    fake_source: FakeSource,
    broadcast_events: list[dict[str, object]],
    tmp_path: Path,
) -> None:
    fake_source.audio = True
    await with_fake_ffmpeg(session, tmp_path / "tools")

    row = await run_download(session, "1234")

    assert row.status == "finished"
    song = await session.get(Song, "fake:1234")
    assert song is not None and song.audio_file is not None
    await session.refresh(song)
    assert (song.replay_gain_db, song.replay_gain_peak) == DEFAULT_GAIN
    assert tags_of(Path(song.audio_file))["REPLAYGAIN_TRACK_GAIN"] == "7.90 dB"
    steps = [update["step"] for update in broadcast_downloads(broadcast_events)]
    assert steps.index("adding to the library") < steps.index(loudness.LOUDNESS_STEP)
    assert steps[-1] == "done"


async def test_with_the_setting_off_nothing_is_tagged(
    queue: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    fake_source: FakeSource,
    broadcast_events: list[dict[str, object]],
    tmp_path: Path,
) -> None:
    fake_source.audio = True
    ffmpeg = await with_fake_ffmpeg(session, tmp_path / "tools")
    await run_download(session, "1234")
    await SettingsService(session).set(loudness.NORMALIZE_SETTING, False)
    broadcast_events.clear()

    # The same song again, under the same id: the row still carries the first file's values.
    row = await run_download(session, "1234", force=True)

    assert row.status == "finished"
    song = await session.get(Song, "fake:1234")
    assert song is not None
    await session.refresh(song)
    assert (song.replay_gain_db, song.replay_gain_peak) == (None, None)
    # One file was tagged, the first; the second download never ran ffmpeg.
    assert kinds(ffmpeg).count("measure") == 1
    steps = [update["step"] for update in broadcast_downloads(broadcast_events)]
    assert loudness.LOUDNESS_STEP not in steps


async def test_a_failed_normalization_never_fails_the_download(
    queue: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    fake_source: FakeSource,
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    fake_source.audio = True
    await with_fake_ffmpeg(session, tmp_path / "tools", measure_fails=True)
    caplog.set_level(logging.INFO, logger="ultrastar_wingman")

    row = await run_download(session, "1234")

    assert (row.status, row.error, row.song_id) == ("finished", None, "fake:1234")
    song = await session.get(Song, "fake:1234")
    assert song is not None
    await session.refresh(song)
    assert (song.replay_gain_db, song.replay_gain_peak) == (None, None)
    warnings = [record for record in caplog.records if record.levelno >= logging.WARNING]
    assert [record.getMessage() for record in warnings] == [
        "Could not even out the loudness of Artist - 1234: ffmpeg failed with exit code 1: "
        "Error while filtering: Invalid data found when processing input"
    ]


async def test_no_ffmpeg_at_all_never_fails_the_download(
    queue: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    fake_source: FakeSource,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    fake_source.audio = True

    async def no_ffmpeg(*args: object, **kwargs: object) -> str:
        raise DownloadError("ffmpeg not found")

    monkeypatch.setattr(media, "ensure_ffmpeg", no_ffmpeg)
    caplog.set_level(logging.WARNING, logger="ultrastar_wingman")

    row = await run_download(session, "1234")

    assert row.status == "finished"
    [record] = caplog.records
    assert (
        record.getMessage() == "Could not even out the loudness of Artist - 1234: ffmpeg not found"
    )
    # A missing tool is a reason, not a bug.
    assert not record.exc_info


async def test_unusable_result_directory_fails_the_download(
    queue: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    fake_source: FakeSource,
) -> None:
    fake_source.broken = True

    row = await run_download(session)

    assert row.status == "failed"
    assert row.error is not None
    assert "song txt" in row.error
    assert list(await session.scalars(select(Song))) == []


async def test_parallel_limit_is_respected(
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    fake_source: FakeSource,
    tmp_path: Path,
) -> None:
    await SettingsService(session).set("downloads.parallel", 2)
    # Two downloads have to be inside `download()` at the same time for the barrier to
    # release, and `max_concurrent` shows that a third one never joined them.
    fake_source.barrier = asyncio.Barrier(2)
    await service.start(session_factory, tmp_path)
    try:
        for number in range(4):
            await service.enqueue(session, "fake", str(number))
        await idle()
    finally:
        await service.stop()

    assert fake_source.max_concurrent == 2
    rows = list(await session.scalars(select(Download)))
    assert [row.status for row in rows] == ["finished"] * 4


async def test_enqueue_refuses_a_duplicate(
    queue: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    fake_source: FakeSource,
) -> None:
    fake_source.gate = asyncio.Event()
    await service.enqueue(session, "fake", "1")
    with pytest.raises(service.AlreadyQueuedError):
        await service.enqueue(session, "fake", "1")
    # force does not help: the very same download is already on its way.
    with pytest.raises(service.AlreadyQueuedError):
        await service.enqueue(session, "fake", "1", force=True)
    fake_source.gate.set()
    await idle()


async def test_enqueue_refuses_a_song_already_in_the_library(
    queue: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    fake_source: FakeSource,
) -> None:
    first = await run_download(session, "1")
    assert first.status == "finished"

    with pytest.raises(service.AlreadyDownloadedError):
        await service.enqueue(session, "fake", "1")

    forced = await run_download(session, "1", force=True)
    assert forced.status == "finished"
    assert forced.song_id == "fake:1"
    # The re-download refreshed the existing song instead of adding a second one.
    assert len(list(await session.scalars(select(Song)))) == 1


async def test_enqueue_refuses_an_unknown_source(
    queue: async_sessionmaker[AsyncSession], session: AsyncSession
) -> None:
    with pytest.raises(LookupError):
        await service.enqueue(session, "nope", "1")


async def test_startup_fails_interrupted_and_requeues_pending(
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    fake_source: FakeSource,
    broadcast_events: list[dict[str, object]],
    tmp_path: Path,
) -> None:
    interrupted = Download(source="fake", source_song_id="1", status="running", progress=42.0)
    pending = Download(source="fake", source_song_id="2", status="queued")
    session.add_all([interrupted, pending])
    await session.commit()

    await service.start(session_factory, tmp_path)
    try:
        await idle()
    finally:
        await service.stop()

    await session.refresh(interrupted)
    await session.refresh(pending)
    assert interrupted.status == "failed"
    assert interrupted.error == INTERRUPTED_ERROR
    assert pending.status == "finished"
    assert pending.song_id == "fake:2"
    assert INTERRUPTED_ERROR in [
        update["error"] for update in broadcast_downloads(broadcast_events)
    ]


async def test_list_downloads_is_newest_first(client: AsyncClient, fake_source: FakeSource) -> None:
    # The startup library scan would delete songs outside the (unconfigured) song
    # directories; ending it first keeps this test independent of its timing.
    await scanner.stop_scan()
    fake_source.gate = asyncio.Event()
    for number in range(3):
        response = await client.post(
            "/api/v1/downloads", json={"source": "fake", "source_song_id": str(number)}
        )
        assert response.status_code == 202
        assert response.json()["status"] == "queued"
    fake_source.gate.set()
    await idle()

    listed = (await client.get("/api/v1/downloads")).json()["downloads"]
    assert [item["source_song_id"] for item in listed] == ["2", "1", "0"]
    assert {item["status"] for item in listed} == {"finished"}


async def test_post_download_conflicts_and_unknown_source(
    client: AsyncClient, fake_source: FakeSource
) -> None:
    await scanner.stop_scan()
    body = {"source": "fake", "source_song_id": "9"}
    assert (await client.post("/api/v1/downloads", json=body)).status_code == 202
    await idle()

    conflict = await client.post("/api/v1/downloads", json=body)
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == "already_downloaded"

    forced = await client.post("/api/v1/downloads", json={**body, "force": True})
    assert forced.status_code == 202
    await idle()

    unknown = await client.post("/api/v1/downloads", json={"source": "nope", "source_song_id": "1"})
    assert unknown.status_code == 404


async def test_a_dismissed_download_leaves_the_panel(
    client: AsyncClient, fake_source: FakeSource, broadcast_events: list[dict[str, object]]
) -> None:
    await scanner.stop_scan()
    fake_source.error = "no video url in the txt"
    await client.post("/api/v1/downloads", json={"source": "fake", "source_song_id": "1"})
    await idle()

    listed = (await client.get("/api/v1/downloads")).json()["downloads"]
    assert [(row["status"], row["current_session"], row["dismissed_at"]) for row in listed] == [
        ("failed", True, None)
    ]

    dismissed = await client.post(f"/api/v1/downloads/{listed[0]['id']}/dismiss")
    assert dismissed.status_code == 200
    assert dismissed.json()["dismissed_at"] is not None
    # Gone from the panel for every client, not just the one that dismissed it.
    assert (await client.get("/api/v1/downloads")).json()["downloads"] == []
    assert broadcast_downloads(broadcast_events)[-1]["dismissed_at"] is not None

    # Dismissing again is a no-op, not an error: two tabs may well both do it.
    again = await client.post(f"/api/v1/downloads/{listed[0]['id']}/dismiss")
    assert again.status_code == 200


async def test_dismiss_refuses_an_unfinished_or_unknown_download(
    client: AsyncClient, fake_source: FakeSource
) -> None:
    await scanner.stop_scan()
    fake_source.gate = asyncio.Event()
    created = await client.post("/api/v1/downloads", json={"source": "fake", "source_song_id": "1"})
    conflict = await client.post(f"/api/v1/downloads/{created.json()['id']}/dismiss")
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == "still_running"
    fake_source.gate.set()
    await idle()

    unknown = await client.post("/api/v1/downloads/4711/dismiss")
    assert unknown.status_code == 404
    assert unknown.json()["detail"] == "unknown_download"


async def test_clearing_the_finished_ones_keeps_the_failures(
    client: AsyncClient, fake_source: FakeSource
) -> None:
    await scanner.stop_scan()
    for number in ("1", "2"):
        await client.post("/api/v1/downloads", json={"source": "fake", "source_song_id": number})
    await idle()
    fake_source.error = "no video url in the txt"
    await client.post("/api/v1/downloads", json={"source": "fake", "source_song_id": "3"})
    await idle()

    cleared = await client.post("/api/v1/downloads/dismiss-finished")
    assert cleared.status_code == 200
    assert {row["source_song_id"] for row in cleared.json()["downloads"]} == {"1", "2"}

    # The bulk button must never take away an error nobody has read.
    left = (await client.get("/api/v1/downloads")).json()["downloads"]
    assert [(row["source_song_id"], row["status"]) for row in left] == [("3", "failed")]

    # Nothing left to clear: the second call changes nothing.
    assert (await client.post("/api/v1/downloads/dismiss-finished")).json()["downloads"] == []


async def test_old_history_is_not_part_of_the_current_session(
    queue: async_sessionmaker[AsyncSession],
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    fake_source: FakeSource,
) -> None:
    # `queue` started the service, which is what marks the beginning of this session.
    old_failure = history_row("1", "failed", timedelta(days=2), error="boom")
    old_queued = history_row("2", "queued", timedelta(days=2))
    # A long download that started before midnight: its last progress report may well be
    # older than anything else on screen, and the default filter must still show it.
    old_running = history_row("4", "running", timedelta(days=2), progress=3.0, step="video")
    session.add_all([old_failure, old_queued, old_running])
    await session.commit()
    await run_download(session, "3")

    # Read back, not held in memory: SQLite has no timezone type, so the comparison has to
    # survive an aware timestamp coming back naive.
    by_id = {row.source_song_id: row.current_session for row in await stored(session_factory)}
    assert by_id["1"] is False
    # Still on its way, whenever it was queued: the running work is always this session's.
    assert by_id["2"] is True
    assert by_id["3"] is True
    assert by_id["4"] is True


async def test_retention_drops_completed_rows_past_the_age_limit(
    session_factory: async_sessionmaker[AsyncSession], session: AsyncSession, tmp_path: Path
) -> None:
    aged = timedelta(days=service.RETENTION_DAYS + 1)
    session.add_all(
        [
            history_row("1", "failed", aged, error="boom"),
            history_row("2", "finished", aged, song_id="fake:2"),
            history_row("3", "failed", timedelta(days=1), error="boom"),
            # Old but not done: a queue entry is never retention's business, and a row a
            # worker is downloading into right now least of all.
            history_row("4", "queued", aged),
            history_row("5", "running", aged, progress=42.0, step="downloading the video"),
        ]
    )
    await session.commit()

    assert await service.prune(session_factory) == 2
    assert [row.source_song_id for row in await stored(session_factory)] == ["3", "4", "5"]


async def test_retention_caps_the_history_but_spares_unread_failures(
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(service, "HISTORY_CAP", 3)
    recent = timedelta(minutes=1)
    session.add_all(
        [
            # The oldest row of all, and the one thing the cap may not touch.
            history_row("failure", "failed", recent, error="boom"),
            history_row("read", "failed", recent, error="boom", dismissed_at=datetime.now(UTC)),
            *(history_row(str(number), "finished", recent) for number in range(4)),
        ]
    )
    await session.commit()

    await service.prune(session_factory)

    assert [row.source_song_id for row in await stored(session_factory)] == [
        "failure",
        "1",
        "2",
        "3",
    ]


async def test_startup_prunes_the_history(
    session_factory: async_sessionmaker[AsyncSession], session: AsyncSession, tmp_path: Path
) -> None:
    session.add(
        history_row("1", "finished", timedelta(days=service.RETENTION_DAYS + 1), song_id="fake:1")
    )
    await session.commit()

    await service.start(session_factory, tmp_path)
    try:
        await idle()
    finally:
        await service.stop()

    assert await stored(session_factory) == []


async def test_a_finished_download_prunes_what_it_pushed_past_the_cap(
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    fake_source: FakeSource,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    # Between restarts too: a party downloading all evening must not grow the table.
    monkeypatch.setattr(service, "HISTORY_CAP", 1)
    await service.start(session_factory, tmp_path)
    try:
        await service.enqueue(session, "fake", "1")
        await idle()
        await service.enqueue(session, "fake", "2")
        await idle()
    finally:
        await service.stop()

    assert [row.source_song_id for row in await stored(session_factory)] == ["2"]
