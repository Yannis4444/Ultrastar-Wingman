"""The USDB source: login handling, search parsing and the download pipeline.

No network anywhere: every request goes through an `httpx.MockTransport` that answers with
the captured-shape fixture pages in `fixtures/usdb`, and yt-dlp and ffmpeg are the same kind
of fake python scripts the media tests use. The credentials are made up.
"""

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import cast
from urllib.parse import parse_qsl

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from test_downloads_media import fake_executable
from test_downloads_queue import idle
from ultrastar_wingman.downloads import media, service
from ultrastar_wingman.downloads.model import Download
from ultrastar_wingman.settings import SettingsService
from ultrastar_wingman.songs.model import Song
from ultrastar_wingman.songs.scanner import SONGS_DIRECTORY
from ultrastar_wingman.sources import usdb

FIXTURES = Path(__file__).parent / "fixtures" / "usdb"

USDB_URL = "http://usdb.test"
USERNAME = "wingman"
PASSWORD = "not-a-real-password"

SONG_DIR_NAME = "Test Artist - Test Song (1234)"

# What `downloads.video_format` is set to for the tests, and what yt-dlp must be handed.
VIDEO_FORMAT = "best"

# Writes the video where it was told to and reports progress the way yt-dlp does with
# --newline --progress-template. The argument list goes next to the script, not into the
# work dir — everything in there ends up in the library.
FAKE_YTDLP = """
import pathlib
import sys

arguments = sys.argv[1:]
destination = pathlib.Path(arguments[arguments.index("--output") + 1])
destination.write_bytes(b"video-bytes")
pathlib.Path(__file__).with_name("ytdlp-argv.txt").write_text(
    "\\n".join(arguments), encoding="utf-8"
)
# Two streams, the way the default format (video + audio) makes yt-dlp count: each one
# runs from 0 to 100 on its own.
print("[wingman]   0.0%")
print("[wingman]  50.0%")
print("[wingman] 100.0%")
print("[wingman]   0.0%")
print("[wingman] 100.0%")
"""

FAKE_FFMPEG = """
import pathlib
import sys

pathlib.Path(sys.argv[-1]).write_bytes(b"mp3-bytes")
"""


def page(name: str) -> httpx.Response:
    return httpx.Response(
        200,
        content=(FIXTURES / name).read_bytes(),
        headers={"content-type": "text/html; charset=utf-8"},
    )


def image(content: bytes) -> httpx.Response:
    return httpx.Response(200, content=content, headers={"content-type": "image/jpeg"})


class FakeUsdb:
    """A stand-in for usdb.animux.de: tracks its own login state, answers with the fixture
    pages and records every request that reached it."""

    def __init__(self) -> None:
        self.requests: list[str] = []
        self.forms: list[dict[str, str]] = []
        self.logged_in = False
        self.list_page = "list_full.html"
        self.txt_page = "gettxt.html"
        self.cover = image(b"cover-bytes")
        self.background = image(b"background-bytes")
        # Answer the next search or download as logged out — USDB drops the session cookie
        # server side whenever it feels like it.
        self.expire_once = False
        self.expire_always = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = request.url
        self.requests.append(f"{request.method} {url}")
        form = {}
        if request.method == "POST":
            form = dict(parse_qsl(request.content.decode()))
            self.forms.append(form)
        link = url.params.get("link")
        if link == "home":
            self.logged_in = form.get("login") == "Login" and (
                form.get("user"),
                form.get("pass"),
            ) == (USERNAME, PASSWORD)
            return page("home.html")
        if link == "browse":
            return page("browse.html" if self.logged_in else "logged_out.html")
        if url.host != httpx.URL(USDB_URL).host:
            # The background image is hosted somewhere else entirely.
            return self.background
        if url.path.startswith("/data/cover/"):
            return self.cover
        if self.expire_once or self.expire_always:
            self.expire_once = False
            self.logged_in = False
        if not self.logged_in:
            return page("logged_out.html")
        if link == "list":
            return page(self.list_page)
        if link == "gettxt":
            return page(self.txt_page)
        raise AssertionError(f"unexpected request to {url}")

    def count(self, link: str) -> int:
        return sum(1 for one in self.requests if f"link={link}" in one)

    @property
    def cover_requests(self) -> int:
        return sum(1 for one in self.requests if "/data/cover/" in one)


@dataclass(frozen=True)
class Environment:
    """Where a download lands and where the fake tools live."""

    library: Path
    tools: Path

    @property
    def song_dir(self) -> Path:
        return self.library / SONG_DIR_NAME

    @property
    def txt(self) -> str:
        return (self.song_dir / f"{SONG_DIR_NAME}.txt").read_text(encoding="utf-8")


@pytest.fixture
async def site(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[FakeUsdb]:
    """USDB replaced by the fake, with the module state reset: an asyncio lock binds to the
    first event loop that waits for it and pytest-asyncio gives every test its own."""
    fake = FakeUsdb()
    transport = httpx.MockTransport(fake.handler)
    async with httpx.AsyncClient(transport=transport, base_url=USDB_URL) as client:
        monkeypatch.setattr(usdb, "_client", client)
        monkeypatch.setattr(usdb, "_status", None)
        monkeypatch.setattr(usdb, "_lock", asyncio.Lock())
        yield fake


@pytest.fixture
async def credentials(session: AsyncSession) -> None:
    settings = SettingsService(session)
    await settings.set(usdb.USERNAME_SETTING, USERNAME)
    await settings.set(usdb.PASSWORD_SETTING, PASSWORD)


@pytest.fixture
async def environment(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    credentials: None,
) -> Environment:
    """Everything a download needs: a library, fake tools and the source configured the way
    the app lifespan configures it."""
    library = tmp_path / "library"
    library.mkdir()
    tools = tmp_path / "tools"
    tools.mkdir()
    settings = SettingsService(session)
    await settings.set(SONGS_DIRECTORY, str(library))
    await settings.set(media.YTDLP_PATH_SETTING, str(fake_executable(tools, "yt-dlp", FAKE_YTDLP)))
    await settings.set(media.FFMPEG_SETTING, str(fake_executable(tools, "ffmpeg", FAKE_FFMPEG)))
    # The default format contains `height<=1080`, which cmd turns into a redirection when
    # the fake executable's .cmd wrapper forwards it. A configured format is also what the
    # download must pick up, so setting it is the test of that.
    await settings.set(media.VIDEO_FORMAT_SETTING, VIDEO_FORMAT)
    monkeypatch.setattr(usdb, "_session_factory", session_factory)
    monkeypatch.setattr(usdb, "_data_dir", tmp_path)
    return Environment(library=library, tools=tools)


@pytest.fixture
async def queue(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[None]:
    """The real download queue. Always stopped: a leaked worker would keep using a disposed
    engine in the next test."""
    await service.start(session_factory)
    try:
        yield
    finally:
        await service.stop()


async def download(session: AsyncSession, source_song_id: str = "1234") -> Download:
    row = await service.enqueue(session, usdb.SOURCE_ID, source_song_id)
    await idle()
    await session.refresh(row)
    return row


# --- session handling --------------------------------------------------------------------


async def test_login_uses_the_configured_credentials(
    site: FakeUsdb, credentials: None, session: AsyncSession
) -> None:
    assert await usdb.status(session) == usdb.UsdbStatus(logged_in=True)
    assert site.logged_in
    assert site.forms[0] == {"user": USERNAME, "pass": PASSWORD, "login": "Login"}


async def test_missing_credentials_are_reported_without_asking_usdb(
    site: FakeUsdb, session: AsyncSession
) -> None:
    assert await usdb.status(session) == usdb.UsdbStatus(logged_in=False, error="no_credentials")
    assert site.requests == []


async def test_wrong_credentials_fail_every_operation(
    site: FakeUsdb, session: AsyncSession
) -> None:
    settings = SettingsService(session)
    await settings.set(usdb.USERNAME_SETTING, USERNAME)
    await settings.set(usdb.PASSWORD_SETTING, "wrong")

    assert await usdb.status(session) == usdb.UsdbStatus(
        logged_in=False, error="invalid_credentials"
    )
    with pytest.raises(usdb.UsdbLoginError, match="invalid_credentials") as raised:
        await usdb.search(session)
    # The message is stored on the download row and `download.updated` goes to every
    # websocket, anonymous ones included — so it must not name the USDB account.
    assert USERNAME not in str(raised.value)


async def test_an_expired_session_is_retried_once(
    site: FakeUsdb, credentials: None, session: AsyncSession
) -> None:
    assert (await usdb.status(session)).logged_in
    site.expire_once = True

    result = await usdb.search(session)

    assert [song.usdb_id for song in result.results] == [1234, 42, 7]
    # The search was repeated after a second login, not silently returned as empty.
    assert (site.count("list"), site.count("home")) == (2, 2)


async def test_a_session_that_stays_logged_out_fails(
    site: FakeUsdb, credentials: None, session: AsyncSession
) -> None:
    site.expire_always = True

    with pytest.raises(usdb.UsdbLoginError, match="login_failed"):
        await usdb.search(session)

    # Retried exactly once: a logged-out answer must not become a login loop.
    assert site.count("list") == 2


async def test_status_endpoint_caches_until_refreshed(
    site: FakeUsdb, credentials: None, client: AsyncClient
) -> None:
    first = await client.get("/api/v1/sources/usdb/status")
    assert first.json() == {"logged_in": True, "error": None}
    asked = len(site.requests)

    assert (await client.get("/api/v1/sources/usdb/status")).json()["logged_in"] is True
    assert len(site.requests) == asked

    refreshed = await client.get("/api/v1/sources/usdb/status", params={"refresh": True})
    assert refreshed.json()["logged_in"] is True
    assert len(site.requests) > asked


# --- search ------------------------------------------------------------------------------


async def test_search_parses_the_result_table(
    site: FakeUsdb, credentials: None, session: AsyncSession
) -> None:
    result = await usdb.search(session, artist="Queen", title="Rhapsody", page=2)

    assert (result.page, result.pages) == (2, 3)
    assert site.forms[-1] == {
        "interpret": "Queen",
        "title": "Rhapsody",
        "order": "rating",
        "ud": "desc",
        "limit": "30",
        "start": "30",
    }
    complete, sparse, empty = result.results
    assert complete == usdb.UsdbSong(
        usdb_id=1234,
        artist="Queen",
        title="Bohemian Rhapsody",
        edition="SingStar",
        language="English",
        golden=True,
        rating=3.5,
    )
    # A row that rendered nothing but artist and title: no invented values.
    assert sparse == usdb.UsdbSong(usdb_id=42, artist="Nirvana", title="Lithium")
    # Empty cells are as good as missing ones — and a title that looks like a page number
    # must not be mistaken for one.
    assert (empty.usdb_id, empty.title, empty.language) == (7, "1999", "Deutsch")
    assert (empty.edition, empty.rating, empty.golden) == (None, None, False)


async def test_search_without_a_paginator_has_no_page_count(
    site: FakeUsdb, credentials: None, session: AsyncSession
) -> None:
    site.list_page = "list_single_page.html"

    result = await usdb.search(session, order="title", direction="asc", page=1, limit=200)

    assert result.pages is None
    assert result.results[0] == usdb.UsdbSong(
        usdb_id=99,
        artist="Rammstein",
        title="Sonne",
        edition="[SC]-Songs",
        language="German",
        golden=True,
        rating=2.0,
    )
    # The limit is capped, and the order is passed through as asked.
    assert site.forms[-1]["limit"] == str(usdb.MAX_LIMIT)
    assert (site.forms[-1]["order"], site.forms[-1]["ud"]) == ("title", "asc")


async def test_search_marks_songs_that_are_already_in_the_library(
    site: FakeUsdb, credentials: None, session: AsyncSession, tmp_path: Path
) -> None:
    site.list_page = "list_single_page.html"
    assert (await usdb.search(session)).results[0].downloaded is False

    session.add(
        Song(
            id="usdb:99",
            source=usdb.SOURCE_ID,
            source_id="99",
            title="Sonne",
            artist="Rammstein",
            fingerprint="rammsteinsonne",
            directory=str(tmp_path / "Rammstein - Sonne (99)"),
            txt_file="song.txt",
        )
    )
    await session.commit()

    assert (await usdb.search(session)).results[0].downloaded is True


async def test_search_marks_songs_that_are_still_downloading(
    site: FakeUsdb, credentials: None, session: AsyncSession
) -> None:
    site.list_page = "list_single_page.html"
    session.add(Download(source=usdb.SOURCE_ID, source_song_id="99", status="running"))
    await session.commit()

    assert (await usdb.search(session)).results[0].downloaded is True


async def test_search_endpoint_reports_a_broken_usdb_as_a_bad_gateway(
    site: FakeUsdb, client: AsyncClient
) -> None:
    response = await client.get("/api/v1/sources/usdb/search", params={"artist": "Queen"})

    assert response.status_code == 502
    assert response.json()["detail"] == "no_credentials"


# --- covers ------------------------------------------------------------------------------


async def test_cover_endpoint_proxies_the_image_and_caches_it(
    site: FakeUsdb, client: AsyncClient
) -> None:
    response = await client.get("/api/v1/sources/usdb/songs/1234/cover")

    assert response.status_code == 200
    assert response.content == b"cover-bytes"
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"] == "public, max-age=86400"
    # One request for one static image: the id is enough, no detail page is scraped — and
    # no login round-trip either, USDB serves its covers to anyone.
    assert site.requests == ["GET http://usdb.test/data/cover/1234.jpg"]

    assert (await client.get("/api/v1/sources/usdb/songs/1234/cover")).content == b"cover-bytes"
    # Paging back over results that were already on screen costs USDB nothing.
    assert site.cover_requests == 1


@pytest.mark.parametrize(
    "answer",
    [
        pytest.param(httpx.Response(404, text="not found"), id="404"),
        # USDB answers a request without a session with a normal HTML page, and a song
        # without a cover with an error page — neither is an image.
        pytest.param(
            httpx.Response(
                200, text="<html>no cover</html>", headers={"content-type": "text/html"}
            ),
            id="html",
        ),
    ],
)
async def test_a_song_without_a_cover_is_a_404_and_is_asked_for_once(
    site: FakeUsdb, client: AsyncClient, answer: httpx.Response
) -> None:
    site.cover = answer

    assert (await client.get("/api/v1/sources/usdb/songs/1234/cover")).status_code == 404
    assert (await client.get("/api/v1/sources/usdb/songs/1234/cover")).status_code == 404
    # The miss is cached too: a coverless song must not be re-asked on every page flip.
    assert site.cover_requests == 1


async def test_the_cover_cache_forgets_the_oldest_entries(
    site: FakeUsdb, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(usdb, "COVER_CACHE_SIZE", 2)

    for usdb_id in (1, 2, 3):
        assert await usdb.cover(session, usdb_id) == (b"cover-bytes", "image/jpeg")
    assert list(usdb._cover_cache) == [2, 3]

    # The evicted one is fetched again, the kept one is not.
    await usdb.cover(session, 1)
    await usdb.cover(session, 3)
    assert site.cover_requests == 4


# --- download ----------------------------------------------------------------------------


async def test_the_progress_runs_from_zero_to_a_hundred_once(
    site: FakeUsdb,
    environment: Environment,
    queue: None,
    session: AsyncSession,
    broadcast_events: list[dict[str, object]],
) -> None:
    """Every step is a slice of one bar: fetching the text, the two yt-dlp streams and the
    library scan move it forward, so the ring in the UI never restarts."""
    await download(session)

    percentages = [
        cast(float, update["progress"])
        for event in broadcast_events
        if event["event"] == "download.updated"
        and (update := cast(dict[str, object], event["download"]))["progress"] is not None
    ]

    assert percentages[0] == 0.0
    assert percentages[-1] == 100.0
    pairs = zip(percentages, percentages[1:], strict=False)
    assert all(later >= earlier for earlier, later in pairs)


async def test_download_puts_the_song_into_the_library(
    site: FakeUsdb, environment: Environment, queue: None, session: AsyncSession
) -> None:
    row = await download(session)

    assert (row.status, row.error, row.progress) == ("finished", None, 100.0)
    assert row.song_id == "usdb:1234"
    assert (row.artist, row.title) == ("Test Artist", "Test Song")
    assert sorted(entry.name for entry in environment.song_dir.iterdir()) == [
        f"{SONG_DIR_NAME}.txt",
        "background.jpg",
        "cover.jpg",
        "song.mp3",
        "video.mp4",
    ]
    assert (environment.song_dir / "cover.jpg").read_bytes() == b"cover-bytes"
    assert (environment.song_dir / "background.jpg").read_bytes() == b"background-bytes"

    txt = environment.txt
    assert "\r" not in txt
    assert txt.splitlines()[:5] == [
        "#VIDEO:video.mp4",
        "#MP3:song.mp3",
        "#AUDIO:song.mp3",
        "#COVER:cover.jpg",
        "#BACKGROUND:background.jpg",
    ]
    # Every other line survived, the remote file names and the meta string did not.
    assert "#TITLE:Test Song" in txt
    assert "#VIDEOGAP:1.5" in txt
    assert "remote-audio.mp3" not in txt
    assert "remote-cover.jpg" not in txt
    assert "dQw4w9WgXcQ" not in txt
    assert txt.endswith("E\n")

    song = await session.get(Song, "usdb:1234")
    assert song is not None
    assert (song.source, song.source_id) == (usdb.SOURCE_ID, "1234")
    assert Path(song.directory) == environment.song_dir
    assert song.audio_file == str(environment.song_dir / "song.mp3")
    assert song.video_file == str(environment.song_dir / "video.mp4")
    # The video url was built from the meta string of the #VIDEO tag.
    arguments = (environment.tools / "ytdlp-argv.txt").read_text(encoding="utf-8").splitlines()
    assert arguments[-1] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    # The configured download quality, not a compiled-in format string.
    assert arguments[arguments.index("--format") + 1] == VIDEO_FORMAT


@pytest.mark.parametrize(
    "cover",
    [
        pytest.param(httpx.Response(404, text="not found"), id="404"),
        # The old app used curl and happily saved the error page as cover.jpg.
        pytest.param(
            httpx.Response(
                200, text="<html>no cover</html>", headers={"content-type": "text/html"}
            ),
            id="html",
        ),
    ],
)
async def test_download_skips_a_cover_that_is_not_an_image(
    site: FakeUsdb,
    environment: Environment,
    queue: None,
    session: AsyncSession,
    cover: httpx.Response,
) -> None:
    site.cover = cover

    row = await download(session)

    assert row.status == "finished"
    assert not (environment.song_dir / "cover.jpg").exists()
    # The tag stays: USDX and our own scanner both ignore a file that is not there.
    assert "#COVER:cover.jpg" in environment.txt


async def test_download_fails_when_usdb_serves_no_txt(
    site: FakeUsdb, environment: Environment, queue: None, session: AsyncSession
) -> None:
    site.txt_page = "gettxt_missing.html"

    row = await download(session)

    assert row.status == "failed"
    assert row.error == "txt_not_found — check the USDB login"
    assert list(environment.library.iterdir()) == []


async def test_download_fails_without_a_video(
    site: FakeUsdb, environment: Environment, queue: None, session: AsyncSession
) -> None:
    site.txt_page = "gettxt_no_video.html"

    row = await download(session)

    assert row.status == "failed"
    assert row.error is not None
    assert row.error.startswith("no_video")
    assert list(environment.library.iterdir()) == []


async def test_download_refuses_an_existing_directory(
    site: FakeUsdb, environment: Environment, queue: None, session: AsyncSession
) -> None:
    environment.song_dir.mkdir()

    row = await download(session)

    assert row.status == "failed"
    assert row.error is not None
    assert row.error.startswith("directory_exists")
    assert list(environment.song_dir.iterdir()) == []


def test_directory_names_are_windows_safe() -> None:
    assert usdb._directory_name("AC/DC", 'T:N"R', "5") == "ACDC - TNR (5)"
    assert len(usdb._directory_name("Artist", "x" * 400, "5")) == 255
