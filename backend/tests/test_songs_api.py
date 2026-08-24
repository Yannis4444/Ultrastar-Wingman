import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ultrastar_wingman.songs import scanner
from ultrastar_wingman.songs.model import Song

# Smallest possible real image, so the content type comes from a genuine file.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)


def make_song(identifier: str, artist: str, title: str, **columns: object) -> Song:
    return Song(
        id=identifier,
        source=identifier.split(":")[0],
        source_id=None,
        title=title,
        artist=artist,
        fingerprint=f"{artist}|{title}".lower(),
        directory=f"/library/{identifier}",
        txt_file=f"/library/{identifier}/song.txt",
        **columns,
    )


@pytest.fixture
async def library(session: AsyncSession, tmp_path: Path) -> AsyncIterator[Path]:
    cover = tmp_path / "cover.png"
    cover.write_bytes(PNG)
    audio = tmp_path / "song.mp3"
    audio.write_bytes(b"not really mpeg frames, but a real file")
    session.add_all(
        [
            make_song(
                "usdb:1234",
                "Mark Ronson",
                "Uptown Funk",
                cover_file=str(cover),
                audio_file=str(audio),
                video_file="/library/usdb:1234/clip.mp4",
                duration_seconds=270,
                language="English",
                genre="Funk",
                year=2014,
                edition="Party",
                creator="someone",
            ),
            make_song("local:aaaa", "abba", "Mamma Mia"),
            make_song("local:bbbb", "ABBA", "Dancing Queen"),
            make_song(
                "local:cccc",
                "Zappa",
                "Bobby Brown",
                cover_file="/library/gone.jpg",
                audio_file="/library/gone.mp3",
            ),
        ]
    )
    await session.commit()
    yield tmp_path


async def test_list_songs_is_sorted_by_artist_and_title(client: AsyncClient, library: Path) -> None:
    response = await client.get("/api/v1/songs")

    assert response.status_code == 200
    # Case-insensitive: "abba" and "ABBA" belong together, not around "Mark Ronson".
    assert [(song["artist"], song["title"]) for song in response.json()["songs"]] == [
        ("ABBA", "Dancing Queen"),
        ("abba", "Mamma Mia"),
        ("Mark Ronson", "Uptown Funk"),
        ("Zappa", "Bobby Brown"),
    ]


async def test_song_detail_carries_the_full_contract(client: AsyncClient, library: Path) -> None:
    response = await client.get("/api/v1/songs/usdb:1234")

    assert response.status_code == 200
    assert response.json() == {
        "id": "usdb:1234",
        "source": "usdb",
        "title": "Uptown Funk",
        "artist": "Mark Ronson",
        "duration_seconds": 270,
        "has_video": True,
        "language": "English",
        "genre": "Funk",
        "year": 2014,
        "edition": "Party",
        "creator": "someone",
    }


async def test_a_song_without_a_video_says_so(client: AsyncClient, library: Path) -> None:
    response = await client.get("/api/v1/songs/local:aaaa")
    assert response.status_code == 200
    assert response.json()["has_video"] is False
    assert response.json()["duration_seconds"] is None


async def test_unknown_song_is_404(client: AsyncClient, library: Path) -> None:
    assert (await client.get("/api/v1/songs/local:nope")).status_code == 404
    assert (await client.get("/api/v1/songs/local:nope/cover")).status_code == 404


async def test_cover_is_served_with_its_content_type(client: AsyncClient, library: Path) -> None:
    response = await client.get("/api/v1/songs/usdb:1234/cover")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content == PNG


async def test_a_missing_cover_file_is_404(client: AsyncClient, library: Path) -> None:
    # No cover tag at all, and a cover that vanished from disk.
    assert (await client.get("/api/v1/songs/local:aaaa/cover")).status_code == 404
    assert (await client.get("/api/v1/songs/local:cccc/cover")).status_code == 404


async def test_audio_is_served_with_its_content_type(client: AsyncClient, library: Path) -> None:
    response = await client.get("/api/v1/songs/usdb:1234/audio")

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"


async def test_a_missing_audio_file_is_404(client: AsyncClient, library: Path) -> None:
    # No audio tag at all, and an audio file that vanished from disk.
    assert (await client.get("/api/v1/songs/local:aaaa/audio")).status_code == 404
    assert (await client.get("/api/v1/songs/local:cccc/audio")).status_code == 404


async def test_rescan_starts_a_scan(client: AsyncClient) -> None:
    # The startup scan is cancelled first so this test does not race with it.
    await scanner.stop_scan()

    response = await client.post("/api/v1/songs/rescan")

    assert response.status_code == 202
    assert response.json() == {"status": "started"}
    await scanner.stop_scan()


async def test_a_second_rescan_while_one_runs_is_409(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    await scanner.stop_scan()
    running = asyncio.Event()

    async def blocked(session_factory: async_sessionmaker[AsyncSession]) -> scanner.ScanResult:
        await running.wait()
        return scanner.ScanResult(added=0, removed=0, updated=0, total=0)

    monkeypatch.setattr(scanner, "scan_library", blocked)
    started = await client.post("/api/v1/songs/rescan")
    assert started.status_code == 202

    second = await client.post("/api/v1/songs/rescan")

    assert second.status_code == 409
    assert second.json() == {"status": "running"}
    running.set()
    await scanner.stop_scan()


async def test_the_startup_scan_survives_unset_directories(client: AsyncClient) -> None:
    # Nothing configured: the lifespan must come up and the library stay empty.
    response = await client.get("/api/v1/songs")
    assert response.status_code == 200
    assert response.json() == {"songs": []}
