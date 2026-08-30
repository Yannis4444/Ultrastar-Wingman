import asyncio
import shutil
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ultrastar_wingman.comments.model import SongComment
from ultrastar_wingman.db import Base
from ultrastar_wingman.karaoke import service as karaoke
from ultrastar_wingman.karaoke.model import KaraokeSession, Score, Sing
from ultrastar_wingman.karaoke.schema import CurrentSing
from ultrastar_wingman.library.model import Favorite, Playlist, PlaylistEntry, Wish
from ultrastar_wingman.songs import scanner, service
from ultrastar_wingman.songs.model import Song
from ultrastar_wingman.songs.schema import read_song
from ultrastar_wingman.tags.model import BROKEN_TAG_ID, SongTag

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
                is_duet=True,
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
        "is_duet": True,
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


async def test_every_listed_song_carries_the_facet_fields(
    client: AsyncClient, library: Path
) -> None:
    """The built-in facets are computed on the client, over the list it already has — so
    `is_duet` rides on every row of the listing, not only on the detail, exactly like
    `has_video` and the three metadata values beside it."""
    response = await client.get("/api/v1/songs")

    assert response.status_code == 200
    by_id = {song["id"]: song for song in response.json()["songs"]}
    assert by_id["usdb:1234"]["is_duet"] is True
    # The column is NOT NULL with a default of 0: a song the parser said nothing about
    # reads "not a duet", never null — there is no third answer to filter for.
    assert by_id["local:aaaa"]["is_duet"] is False
    for song in by_id.values():
        assert set(song) >= {"is_duet", "has_video", "genre", "language", "edition", "year"}


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


@pytest.fixture
async def deletable(session: AsyncSession, tmp_path: Path) -> Path:
    """One song whose directory really is on disk, files and all — deleting it has to take
    the folder with the row, so a fake path would prove nothing."""
    directory = tmp_path / "library" / "Queen - Bohemian Rhapsody"
    directory.mkdir(parents=True)
    (directory / "song.txt").write_text("#TITLE:Bohemian Rhapsody\n", encoding="utf-8")
    (directory / "cover.jpg").write_bytes(PNG)
    song = make_song("usdb:9", "Queen", "Bohemian Rhapsody")
    song.directory = str(directory)
    song.txt_file = str(directory / "song.txt")
    session.add(song)
    await session.commit()
    return directory


def on_disk(path: Path) -> bool:
    """Whether the folder is still there. A bare `path.is_dir()` inside an async test body
    trips ASYNC240, whose point is not blocking a real event loop — which one stat of a
    `tmp_path` directory does not."""
    return path.is_dir()


async def _count(session: AsyncSession, table: type[Base]) -> int:
    """How many rows the table holds right now — never through the identity map, which
    still remembers what the app's own session deleted."""
    session.expire_all()
    return await session.scalar(select(func.count()).select_from(table)) or 0


def _playing(song: Song) -> CurrentSing:
    return CurrentSing(
        sing_id="sing-1", song=read_song(song), started_at=datetime.now(UTC), slots=[]
    )


async def test_deleting_a_song_takes_its_row_and_its_folder(
    client: AsyncClient, deletable: Path, broadcast_events: list[dict[str, object]]
) -> None:
    response = await client.delete("/api/v1/songs/usdb:9")

    assert response.status_code == 204
    # The whole folder, not only the txt: a leftover directory is what the next startup
    # scan would import again, under a fresh id and without the song's history.
    assert not on_disk(deletable)
    assert (await client.get("/api/v1/songs/usdb:9")).status_code == 404
    assert (await client.get("/api/v1/songs")).json() == {"songs": []}
    # Every other phone in the room hears about it.
    assert {"event": "songs.deleted", "song_id": "usdb:9"} in broadcast_events


async def test_deleting_an_unknown_song_is_404(client: AsyncClient, library: Path) -> None:
    assert (await client.delete("/api/v1/songs/local:nope")).status_code == 404


async def test_deleting_a_song_whose_files_are_already_gone_still_works(
    client: AsyncClient, deletable: Path
) -> None:
    """A row pointing at a folder somebody removed by hand is exactly what this endpoint
    has to be able to clean up."""
    shutil.rmtree(deletable)

    assert (await client.delete("/api/v1/songs/usdb:9")).status_code == 204
    assert (await client.get("/api/v1/songs/usdb:9")).status_code == 404


async def test_deleting_a_song_keeps_what_people_did_with_it(
    client: AsyncClient, deletable: Path, session: AsyncSession
) -> None:
    """A score, a tag, a comment, a favorite and a playlist entry are about the *song*, not
    about the file: they stay, so a `usdb:9` downloaded again finds its history. Only the
    wishes go — a wish is "somebody should sing this tonight", and nobody can any more."""
    karaoke_session = KaraokeSession()
    session.add(karaoke_session)
    await session.flush()
    # Read out before the counts below expire the identity map: a lazy refresh of an
    # expired attribute is synchronous IO, which an async session cannot do.
    session_id = karaoke_session.id
    sing = Sing(song_id="usdb:9", session_id=session_id)
    session.add(sing)
    await session.flush()
    session.add_all(
        [
            Score(sing_id=sing.id, player_id=None, player_name="Alice", score=9000),
            SongTag(tag_id=BROKEN_TAG_ID, song_id="usdb:9"),
            SongComment(song_id="usdb:9", user_id="u-1", body="One for the birthday guest"),
            Favorite(user_id="u-1", song_id="usdb:9"),
            Wish(song_id="usdb:9", guest_id="g-1"),
            Playlist(id="p-1", name="Party", owner_user_id="u-1", is_global=True),
            PlaylistEntry(playlist_id="p-1", song_id="usdb:9", position=0),
        ]
    )
    await session.commit()

    assert (await client.delete("/api/v1/songs/usdb:9")).status_code == 204

    assert await _count(session, Sing) == 1
    assert await _count(session, Score) == 1
    assert await _count(session, SongTag) == 1
    assert await _count(session, SongComment) == 1
    assert await _count(session, Favorite) == 1
    assert await _count(session, PlaylistEntry) == 1
    assert await _count(session, Wish) == 0
    # And nothing that lists them trips over the song that is no longer there.
    assert (await client.get("/api/v1/wishlist")).json() == {"wishes": []}
    assert (await client.get("/api/v1/playlists/p-1")).json()["entries"] == []
    # The `song_tags` row is still there; the listing joins `songs` and skips the orphan.
    assignments = (await client.get("/api/v1/tags/assignments")).json()["assignments"]
    assert [row["song_ids"] for row in assignments] == [[]]
    # The score still counts in the party it was sung at; it simply has no song to name.
    scores = await client.get(f"/api/v1/stats/sessions/{session_id}/scores")
    assert scores.status_code == 200
    assert [(row["player_name"], row["song"]) for row in scores.json()["scores"]] == [
        ("Alice", None)
    ]


async def test_the_song_that_is_playing_cannot_be_deleted(
    client: AsyncClient, deletable: Path, session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    song = await session.get(Song, "usdb:9")
    assert song is not None
    monkeypatch.setattr(karaoke, "current_sing", lambda: _playing(song))

    response = await client.delete("/api/v1/songs/usdb:9")

    assert response.status_code == 409
    assert response.json() == {"detail": "song_is_playing"}
    # Refused before anything happened, so both halves of the song are still there.
    assert on_disk(deletable)
    assert (await client.get("/api/v1/songs/usdb:9")).status_code == 200


async def test_another_song_playing_does_not_block_a_delete(
    client: AsyncClient,
    deletable: Path,
    library: Path,
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    other = await session.get(Song, "local:aaaa")
    assert other is not None
    monkeypatch.setattr(karaoke, "current_sing", lambda: _playing(other))

    assert (await client.delete("/api/v1/songs/usdb:9")).status_code == 204


async def test_a_folder_that_will_not_go_leaves_the_row_alone(
    client: AsyncClient, deletable: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Windows refuses to remove a file another program has open. The song stays whole
    rather than becoming a row without files, or files without a row."""

    def locked(path: object, *args: object, **kwargs: object) -> None:
        raise OSError(32, "The process cannot access the file because it is being used")

    monkeypatch.setattr(service.shutil, "rmtree", locked)

    response = await client.delete("/api/v1/songs/usdb:9")

    assert response.status_code == 409
    assert response.json() == {"detail": "song_files_in_use"}
    assert on_disk(deletable)
    assert (await client.get("/api/v1/songs/usdb:9")).status_code == 200


async def test_a_song_claiming_a_library_root_is_refused(
    client: AsyncClient, session: AsyncSession, tmp_path: Path
) -> None:
    """`songs.directory` holds every song there is. Whatever a hand-edited row says, one
    delete must never be able to empty the library."""
    root = tmp_path / "the-whole-library"
    root.mkdir()
    song = make_song("local:root", "Root", "Song")
    song.directory = str(root)
    session.add(song)
    await session.commit()
    assert (
        await client.patch("/api/v1/settings/songs.directory", json={"value": str(root)})
    ).status_code == 200

    response = await client.delete("/api/v1/songs/local:root")

    assert response.status_code == 409
    assert response.json() == {"detail": "song_directory_is_a_library_root"}
    assert on_disk(root)
    assert (await client.get("/api/v1/songs/local:root")).status_code == 200


async def test_a_song_directory_holding_the_library_is_refused(
    client: AsyncClient, session: AsyncSession, tmp_path: Path
) -> None:
    """One level up from the library is the same catastrophe one level bigger: the songs
    folder would go with it, and so would everything else next to it."""
    above = tmp_path / "music"
    root = above / "songs"
    root.mkdir(parents=True)
    (above / "not-a-song.txt").write_text("something else entirely", encoding="utf-8")
    song = make_song("local:above", "Above", "Song")
    song.directory = str(above)
    session.add(song)
    await session.commit()
    assert (
        await client.patch("/api/v1/settings/songs.directory", json={"value": str(root)})
    ).status_code == 200

    response = await client.delete("/api/v1/songs/local:above")

    assert response.status_code == 409
    assert response.json() == {"detail": "song_directory_is_a_library_root"}
    assert on_disk(above)
    assert on_disk(root)


async def test_a_song_directory_that_is_a_drive_root_is_refused(
    client: AsyncClient, session: AsyncSession, tmp_path: Path
) -> None:
    """Nothing is configured under it, so the roots say nothing — but `C:\\` (or `/`) is
    never one song's folder, whatever the row claims."""
    song = make_song("local:anchor", "Anchor", "Song")
    song.directory = str(Path(tmp_path.anchor))
    session.add(song)
    await session.commit()

    response = await client.delete("/api/v1/songs/local:anchor")

    assert response.status_code == 409
    assert response.json() == {"detail": "song_directory_is_a_library_root"}


class WatchedLock(asyncio.Lock):
    """A lock that says when somebody else has started waiting for it — the only way a test
    can be sure the request it started is *past* its own 404 check and inside the delete."""

    def __init__(self) -> None:
        super().__init__()
        self.contended = asyncio.Event()

    async def acquire(self) -> Literal[True]:
        if self.locked():
            self.contended.set()
        return await super().acquire()


async def test_a_song_deleted_while_the_request_waited_is_a_404(
    client: AsyncClient,
    deletable: Path,
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two deletes of the same song at once. The second one reaches the scanner's lock after
    the first has committed, and must not report a deletion it did not do — the row it read
    on the way in is exactly what waiting for a lock makes stale."""
    lock = WatchedLock()
    monkeypatch.setattr(scanner, "_scan_lock", lock)
    await lock.acquire()
    pending = asyncio.ensure_future(client.delete("/api/v1/songs/usdb:9"))
    # Past `song_or_404` with a row it could still see, now queued behind the lock.
    await asyncio.wait_for(lock.contended.wait(), timeout=5)
    song = await session.get(Song, "usdb:9")
    assert song is not None
    await session.delete(song)
    await session.commit()
    lock.release()

    assert (await pending).status_code == 404
