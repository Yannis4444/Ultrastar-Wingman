"""What the launcher decides before it starts anything.

Pure functions only — nothing here launches Ultrastar Deluxe, which is a machine
singleton: the answers below are what `UsdxLauncher.start` builds its command line from.
"""

from pathlib import Path

from ultrastar_wingman.karaoke.usdx import COPY_DIR_NAME, _copy_into_songs_dir, _needs_copy


def make_song_dir(parent: Path, name: str) -> Path:
    directory = parent / name
    directory.mkdir(parents=True)
    (directory / "song.txt").write_text("#TITLE:Title\n#ARTIST:Artist\n", encoding="utf-8")
    (directory / "song.mp3").write_bytes(b"not really an mp3")
    return directory


def test_a_plain_name_inside_the_usdx_songs_dir_is_started_where_it_lies(tmp_path: Path) -> None:
    usdx_songs = tmp_path / "usdx" / "songs"
    song_dir = make_song_dir(usdx_songs, "Artist - Title (123)")

    assert _needs_copy(song_dir, usdx_songs) is False


def test_a_non_ascii_name_is_copied_even_inside_the_usdx_songs_dir(tmp_path: Path) -> None:
    """The reported failure: USDX gets the path through Pascal's `ParamStr`, so an accent
    in the directory name is enough for it to find no song and open the library instead."""
    usdx_songs = tmp_path / "usdx" / "songs"
    song_dir = make_song_dir(usdx_songs, "Céline Dion - My Heart Will Go On (3440)")

    assert _needs_copy(song_dir, usdx_songs) is True


def test_a_song_in_a_wingman_library_outside_usdx_is_copied(tmp_path: Path) -> None:
    """The regression this file exists for.

    A plain ASCII song directory, in the library Wingman scans — but that library is not
    USDX's own songs directory. `-SongPath` only *adds* a song path, so USDX would load
    its whole library next to it and open on the alphabetically first song.
    """
    usdx_songs = tmp_path / "usdx" / "songs"
    usdx_songs.mkdir(parents=True)
    song_dir = make_song_dir(tmp_path / "library", "Artist - Title (123)")

    assert _needs_copy(song_dir, usdx_songs) is True


def test_a_song_in_a_sibling_directory_of_the_usdx_songs_dir_is_copied(tmp_path: Path) -> None:
    """`songs2` starts with the same characters as `songs` but is not inside it."""
    usdx_songs = tmp_path / "usdx" / "songs"
    usdx_songs.mkdir(parents=True)
    song_dir = make_song_dir(tmp_path / "usdx" / "songs2", "Artist - Title (123)")

    assert _needs_copy(song_dir, usdx_songs) is True


def test_the_copy_lands_in_the_usdx_songs_dir_under_an_ascii_name(tmp_path: Path) -> None:
    usdx_songs = tmp_path / "usdx" / "songs"
    song_dir = make_song_dir(tmp_path / "library", "Céline Dion - My Heart Will Go On (3440)")

    destination = _copy_into_songs_dir(song_dir, usdx_songs)

    # Inside the songs directory USDX itself loads from: that is what makes USDX drop the
    # library path instead of loading it as well.
    assert destination == usdx_songs / COPY_DIR_NAME
    assert destination.is_relative_to(usdx_songs)
    assert _needs_copy(destination, usdx_songs) is False
    assert sorted(path.name for path in destination.iterdir()) == ["song.mp3", "song.txt"]


def test_copying_replaces_what_an_earlier_crash_left_behind(tmp_path: Path) -> None:
    usdx_songs = tmp_path / "usdx" / "songs"
    leftover = usdx_songs / COPY_DIR_NAME
    leftover.mkdir(parents=True)
    (leftover / "stale.txt").write_text("from a run that never cleaned up", encoding="utf-8")
    song_dir = make_song_dir(tmp_path / "library", "Artist - Title (123)")

    destination = _copy_into_songs_dir(song_dir, usdx_songs)

    assert sorted(path.name for path in destination.iterdir()) == ["song.mp3", "song.txt"]
