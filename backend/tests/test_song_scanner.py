import asyncio
import json
import wave
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ultrastar_wingman.settings import SettingsService
from ultrastar_wingman.songs import scanner
from ultrastar_wingman.songs.model import Song
from ultrastar_wingman.songs.scanner import (
    NotASongDirectoryError,
    ScanBusyError,
    scan_library,
    scan_song_directory,
)


def make_song_dir(
    root: Path,
    name: str,
    *,
    title: str = "Song",
    artist: str = "Artist",
    tags: str = "",
    files: tuple[str, ...] = (),
    wingman_json: dict[str, object] | None = None,
) -> Path:
    directory = root / name
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{name}.txt").write_text(
        f"#TITLE:{title}\n#ARTIST:{artist}\n{tags}: 0 4 0 la\nE\n", encoding="utf-8"
    )
    for file_name in files:
        (directory / file_name).write_bytes(b"x")
    if wingman_json is not None:
        (directory / "wingman.json").write_text(json.dumps(wingman_json), encoding="utf-8")
    return directory


def make_wav(path: Path, seconds: float) -> None:
    """Two seconds of silence at 500 Hz mono 8 bit is ~1 KB — enough for mutagen."""
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(1)
        audio.setframerate(500)
        audio.writeframes(b"\x80" * int(500 * seconds))


async def configure(session: AsyncSession, directory: Path | None, additional: str = "") -> None:
    settings = SettingsService(session)
    await settings.set("songs.directory", "" if directory is None else str(directory))
    await settings.set("songs.additional_directories", additional)


async def songs_in_db(session: AsyncSession) -> list[Song]:
    return list(await session.scalars(select(Song).order_by(Song.directory)))


async def test_scan_adds_every_song_directory(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
) -> None:
    library = tmp_path / "songs"
    make_song_dir(
        library,
        "first",
        title="Uptown Funk",
        artist="Mark Ronson feat. Bruno Mars",
        tags="#COVER:cover.jpg\n#AUDIO:song.mp3\n#VIDEO:clip.mp4\n#LANGUAGE:English\n"
        "#GENRE:Funk\n#YEAR:2014\n#EDITION:Party\n#CREATOR:someone\n",
        files=("cover.jpg", "song.mp3", "clip.mp4"),
    )
    make_song_dir(library, "second", title="Mamma Mia", artist="ABBA")
    # A directory without a txt is not a song, and files directly in the root are ignored.
    (library / "not a song").mkdir()
    (library / "loose.txt").write_text("#TITLE:x\n#ARTIST:y\n", encoding="utf-8")
    await configure(session, library)

    result = await scan_library(session_factory)

    assert (result.added, result.removed, result.updated, result.total) == (2, 0, 0, 2)
    first, second = await songs_in_db(session)
    assert (first.title, first.artist) == ("Uptown Funk", "Mark Ronson feat. Bruno Mars")
    assert first.fingerprint == "brunomars&markronson|uptownfunk"
    assert first.directory == str(library / "first")
    assert first.txt_file == str(library / "first" / "first.txt")
    assert first.cover_file == str(library / "first" / "cover.jpg")
    assert first.audio_file == str(library / "first" / "song.mp3")
    assert first.video_file == str(library / "first" / "clip.mp4")
    assert (first.language, first.genre, first.year) == ("English", "Funk", 2014)
    assert (first.edition, first.creator) == ("Party", "someone")
    assert second.title == "Mamma Mia"
    assert second.cover_file is None


async def test_the_duet_flag_comes_off_the_txt(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
) -> None:
    library = tmp_path / "songs"
    make_song_dir(library, "duet", tags="#DUETSINGERP1:Her\n#DUETSINGERP2:Him\n")
    make_song_dir(library, "solo")
    await configure(session, library)

    await scan_library(session_factory)

    duet, solo = await songs_in_db(session)
    assert duet.is_duet is True
    assert solo.is_duet is False


async def test_a_rescan_fills_the_duet_flag_the_migration_only_placeheld(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
) -> None:
    """The upgrade path, without a data migration.

    `0016` adds `is_duet` with a server default of 0, so every song already in the table
    reads "not a duet" whatever its `.txt` says. Nothing on disk changes at the upgrade —
    which is exactly the case the "an edited txt is followed" test does *not* cover — so
    this one puts the column back to the migration's placeholder and asserts that the very
    next scan reads the real value out of the file again.
    """
    library = tmp_path / "songs"
    make_song_dir(library, "duet", tags="#DUETSINGERP1:Her\n#DUETSINGERP2:Him\n")
    make_song_dir(library, "solo")
    await configure(session, library)
    await scan_library(session_factory)
    async with session_factory() as other:
        for row in await songs_in_db(other):
            row.is_duet = False
        await other.commit()

    result = await scan_library(session_factory)

    # No file moved and nothing was added: the duet alone is rewritten.
    assert (result.added, result.removed, result.updated) == (0, 0, 1)
    async with session_factory() as other:
        duet, solo = await songs_in_db(other)
        assert duet.is_duet is True
        assert solo.is_duet is False


async def test_a_rescan_reparses_every_txt_and_follows_an_edit(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
) -> None:
    """The scanner keeps no mtime or size cache, which is what lets a column added to the
    parser fill itself on the next start rather than needing a data migration."""
    library = tmp_path / "songs"
    make_song_dir(library, "song")
    await configure(session, library)
    await scan_library(session_factory)
    (before,) = await songs_in_db(session)
    assert before.is_duet is False
    # Only the body changes: same directory, same title, same artist, same file size class.
    make_song_dir(library, "song", tags="P1\n: 0 4 0 la\nP2\n")

    result = await scan_library(session_factory)

    assert (result.added, result.updated) == (0, 1)
    session.expire_all()
    (after,) = await songs_in_db(session)
    assert after.is_duet is True


async def test_songs_without_a_source_get_unique_local_ids(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
) -> None:
    # Regression: the old app gave every source-less song the literal id "USDB-None".
    library = tmp_path / "songs"
    make_song_dir(library, "one")
    make_song_dir(library, "two")
    await configure(session, library)

    await scan_library(session_factory)

    ids = {song.id for song in await songs_in_db(session)}
    assert len(ids) == 2
    assert all(identifier.startswith("local:") for identifier in ids)
    assert all(song.source == "local" for song in await songs_in_db(session))
    assert all(song.source_id is None for song in await songs_in_db(session))


@pytest.mark.parametrize(
    ("wingman_json", "expected_id"),
    [
        ({"usdb_id": "1234", "id": "USDB-1234"}, "usdb:1234"),
        ({"usdb_id": 1234}, "usdb:1234"),
        # Old ids of the form USDB-<n> are usable even without a usdb_id field.
        ({"id": "USDB-4711"}, "usdb:4711"),
        # The old app's bugs: an always-truthy f-string and str(None).
        ({"id": "USDB-None", "usdb_id": ""}, None),
        ({"usdb_id": "None"}, None),
        # A raw number as the id says nothing about the source.
        ({"id": "1234"}, None),
        ({}, None),
    ],
)
async def test_wingman_json_migration(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    wingman_json: dict[str, object],
    expected_id: str | None,
) -> None:
    library = tmp_path / "songs"
    make_song_dir(library, "song", wingman_json=wingman_json)
    await configure(session, library)

    await scan_library(session_factory)

    (song,) = await songs_in_db(session)
    if expected_id is None:
        assert song.id.startswith("local:")
        assert (song.source, song.source_id) == ("local", None)
    else:
        assert song.id == expected_id
        assert (song.source, song.source_id) == ("usdb", expected_id.removeprefix("usdb:"))


async def test_two_directories_with_the_same_usdb_id_do_not_collide(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
) -> None:
    # A duplicated download must not abort the scan on a primary key conflict.
    library = tmp_path / "songs"
    make_song_dir(library, "copy one", wingman_json={"usdb_id": 1234})
    make_song_dir(library, "copy two", wingman_json={"usdb_id": 1234})
    await configure(session, library)

    result = await scan_library(session_factory)

    assert result.added == 2
    ids = sorted(song.id for song in await songs_in_db(session))
    assert ids[0].startswith("local:")
    assert ids[1] == "usdb:1234"

    # The same holds across scans: a third copy cannot claim the taken id either.
    make_song_dir(library, "copy three", wingman_json={"usdb_id": 1234})
    assert (await scan_library(session_factory)).added == 1
    session.expire_all()
    assert len({song.id for song in await songs_in_db(session)}) == 3


async def test_a_broken_wingman_json_is_ignored(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
) -> None:
    library = tmp_path / "songs"
    directory = make_song_dir(library, "song")
    (directory / "wingman.json").write_text("{not json", encoding="utf-8")
    await configure(session, library)

    await scan_library(session_factory)

    (song,) = await songs_in_db(session)
    assert song.id.startswith("local:")


async def test_rescan_updates_changed_songs_and_keeps_their_id(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
) -> None:
    library = tmp_path / "songs"
    make_song_dir(library, "song", title="Old Title")
    await configure(session, library)
    await scan_library(session_factory)
    (before,) = await songs_in_db(session)

    make_song_dir(
        library,
        "song",
        title="New Title",
        artist="New Artist",
        tags="#COVER:cover.jpg\n",
        files=("cover.jpg",),
    )
    result = await scan_library(session_factory)

    assert (result.added, result.removed, result.updated, result.total) == (0, 0, 1, 1)
    session.expire_all()
    (after,) = await songs_in_db(session)
    assert after.id == before.id
    assert (after.title, after.artist) == ("New Title", "New Artist")
    assert after.fingerprint == "newartist|newtitle"
    assert after.cover_file == str(library / "song" / "cover.jpg")


async def test_an_unchanged_library_reports_no_changes(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
) -> None:
    library = tmp_path / "songs"
    make_song_dir(library, "song")
    await configure(session, library)
    await scan_library(session_factory)

    result = await scan_library(session_factory)

    assert (result.added, result.removed, result.updated, result.total) == (0, 0, 0, 1)


async def test_a_vanished_directory_is_removed(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
) -> None:
    library = tmp_path / "songs"
    make_song_dir(library, "gone")
    make_song_dir(library, "stays")
    await configure(session, library)
    await scan_library(session_factory)

    for path in sorted((library / "gone").iterdir()):
        path.unlink()
    (library / "gone").rmdir()
    result = await scan_library(session_factory)

    assert (result.added, result.removed, result.updated, result.total) == (0, 1, 0, 1)
    assert [song.directory for song in await songs_in_db(session)] == [str(library / "stays")]


async def test_additional_directories_are_scanned_too(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
) -> None:
    library, extra = tmp_path / "songs", tmp_path / "extra"
    make_song_dir(library, "main")
    make_song_dir(extra, "side")
    # One path per line, blank lines and a missing directory must not break the scan.
    await configure(session, library, additional=f"\n{extra}\n  \n{tmp_path / 'nowhere'}\n")

    result = await scan_library(session_factory)

    assert result.total == 2
    assert [song.directory for song in await songs_in_db(session)] == [
        str(extra / "side"),
        str(library / "main"),
    ]


async def test_unset_directories_scan_to_nothing(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    # This is what happens on a fresh install at startup: no settings, no crash.
    result = await scan_library(session_factory)
    assert (result.added, result.removed, result.updated, result.total) == (0, 0, 0, 0)


async def test_audio_duration_is_read_from_the_audio_file(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
) -> None:
    library = tmp_path / "songs"
    directory = make_song_dir(library, "with audio", tags="#MP3:song.wav\n")
    make_wav(directory / "song.wav", seconds=2)
    make_song_dir(library, "silent", tags="#MP3:missing.mp3\n")
    make_song_dir(library, "not audio", tags="#MP3:cover.jpg\n", files=("cover.jpg",))
    await configure(session, library)

    await scan_library(session_factory)

    durations = {song.directory: song.duration_seconds for song in await songs_in_db(session)}
    assert durations[str(library / "with audio")] == 2
    # A missing file has no path at all, an unreadable one no duration.
    assert durations[str(library / "silent")] is None
    assert durations[str(library / "not audio")] is None


async def test_the_duration_is_what_usdx_plays_not_the_file_length(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
) -> None:
    library = tmp_path / "songs"
    # USDX skips to #START and stops at #END, so a four second file plays for two.
    windowed = make_song_dir(library, "windowed", tags="#MP3:song.wav\n#START:1\n#END:3000\n")
    make_wav(windowed / "song.wav", seconds=4)
    # An #END past the end of the file changes nothing: the audio runs out first.
    late_end = make_song_dir(library, "late end", tags="#MP3:song.wav\n#END:99000\n")
    make_wav(late_end / "song.wav", seconds=2)
    # Without a readable audio file the window is the only length there is.
    make_song_dir(library, "window only", tags="#MP3:missing.mp3\n#END:5000\n")
    # A window that ends before it starts is a broken header, not a zero second song.
    broken = make_song_dir(library, "broken", tags="#MP3:song.wav\n#START:5\n#END:1000\n")
    make_wav(broken / "song.wav", seconds=2)
    await configure(session, library)

    await scan_library(session_factory)

    durations = {song.directory: song.duration_seconds for song in await songs_in_db(session)}
    assert durations[str(library / "windowed")] == 2
    assert durations[str(library / "late end")] == 2
    assert durations[str(library / "window only")] == 5
    assert durations[str(library / "broken")] is None


async def test_file_tags_may_not_escape_the_song_directory(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
) -> None:
    library = tmp_path / "songs"
    (tmp_path / "secret.jpg").write_bytes(b"x")
    make_song_dir(library, "song", tags="#COVER:../../secret.jpg\n")
    await configure(session, library)

    await scan_library(session_factory)

    (song,) = await songs_in_db(session)
    assert song.cover_file is None


async def test_file_tags_match_case_insensitively(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
) -> None:
    # Libraries copied from Windows keep tags like "Song.MP3" for a file named "song.mp3".
    library = tmp_path / "songs"
    make_song_dir(library, "song", tags="#MP3:SONG.mp3\n", files=("song.mp3",))
    await configure(session, library)

    await scan_library(session_factory)

    (song,) = await songs_in_db(session)
    assert song.audio_file == str(library / "song" / "song.mp3")


async def test_only_one_scan_runs_at_a_time(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with scanner._scan_lock:
        with pytest.raises(ScanBusyError):
            await scan_library(session_factory)


async def test_scan_announces_start_and_result(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    broadcast_events: list[dict[str, object]],
) -> None:
    library = tmp_path / "songs"
    make_song_dir(library, "song")
    await configure(session, library)

    await scan_library(session_factory)

    assert broadcast_events == [
        {"event": "songs.scan_started"},
        {
            "event": "songs.scan_finished",
            "added": 1,
            "removed": 0,
            "updated": 0,
            "total": 1,
        },
    ]


async def test_single_directory_scan_refuses_a_directory_without_a_txt(
    session: AsyncSession, tmp_path: Path
) -> None:
    empty = tmp_path / "not a song"
    empty.mkdir()

    with pytest.raises(NotASongDirectoryError):
        await scan_song_directory(session, empty)


async def test_single_directory_scan_waits_for_a_running_scan(
    session: AsyncSession, tmp_path: Path
) -> None:
    """A full scan reconciles against the directories it saw before this song existed —
    registering in between would have the scan delete the row right after."""
    directory = make_song_dir(tmp_path / "songs", "song")

    async with scanner._scan_lock:
        registration = asyncio.create_task(scan_song_directory(session, directory))
        # One event loop pass is enough for the task to reach the lock.
        await asyncio.sleep(0)
        assert not registration.done()

    assert (await asyncio.wait_for(registration, timeout=10)).startswith("local:")
