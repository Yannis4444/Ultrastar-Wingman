import asyncio
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import cast

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from test_song_scanner import make_song_dir
from ultrastar_wingman.downloads import service
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
            return make_song_dir(self.library, f"Song {source_song_id}", title=source_song_id)
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
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    """The queue running against the test database. Always stopped: a leaked worker
    would keep using a disposed engine in the next test."""
    await service.start(session_factory)
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
) -> None:
    await SettingsService(session).set("downloads.parallel", 2)
    # Two downloads have to be inside `download()` at the same time for the barrier to
    # release, and `max_concurrent` shows that a third one never joined them.
    fake_source.barrier = asyncio.Barrier(2)
    await service.start(session_factory)
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
) -> None:
    interrupted = Download(source="fake", source_song_id="1", status="running", progress=42.0)
    pending = Download(source="fake", source_song_id="2", status="queued")
    session.add_all([interrupted, pending])
    await session.commit()

    await service.start(session_factory)
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
