"""What the launcher decides before it starts anything.

Pure functions only — nothing here launches Ultrastar Deluxe, which is a machine
singleton: the answers below are what `UsdxLauncher.start` builds its command line from.
"""

from pathlib import Path

from ultrastar_wingman.karaoke.usdx import (
    COPY_DIR_NAME,
    COPY_TXT_NAME,
    _copy_into_songs_dir,
    _needs_copy,
)


def make_song(parent: Path, name: str, txt_name: str = "song.txt") -> Path:
    """A song directory with one `.txt` and one media file; answers the `.txt`."""
    directory = parent / name
    directory.mkdir(parents=True)
    txt = directory / txt_name
    txt.write_text("#TITLE:Title\n#ARTIST:Artist\n", encoding="utf-8")
    (directory / "song.mp3").write_bytes(b"not really an mp3")
    return txt


def test_a_plain_name_inside_the_usdx_songs_dir_is_started_where_it_lies(tmp_path: Path) -> None:
    usdx_songs = tmp_path / "usdx" / "songs"
    song_txt = make_song(usdx_songs, "Artist - Title (123)")

    assert _needs_copy(song_txt, usdx_songs) is False


def test_a_non_ascii_name_is_copied_even_inside_the_usdx_songs_dir(tmp_path: Path) -> None:
    """The reported failure: USDX gets the path through Pascal's `ParamStr`, so an accent
    in the directory name is enough for it to find no song and open the library instead."""
    usdx_songs = tmp_path / "usdx" / "songs"
    song_txt = make_song(usdx_songs, "Céline Dion - My Heart Will Go On (3440)")

    assert _needs_copy(song_txt, usdx_songs) is True


def test_a_non_ascii_txt_name_is_copied_too(tmp_path: Path) -> None:
    """`-Song` puts the file name on the command line as well, so the same rule applies
    to it: a plain directory does not save a `.txt` named with an accent."""
    usdx_songs = tmp_path / "usdx" / "songs"
    song_txt = make_song(usdx_songs, "Celine Dion - My Heart Will Go On (3440)", "Céline.txt")

    assert _needs_copy(song_txt, usdx_songs) is True


def test_a_song_in_a_wingman_library_outside_usdx_is_copied(tmp_path: Path) -> None:
    """The regression this file exists for.

    A plain ASCII song directory, in the library Wingman scans — but that library is not
    USDX's own songs directory. Under `-SongPath` that only *added* a song path, so USDX
    loaded its whole library next to it and opened on the alphabetically first song; the
    rule is kept under `-Song` (see `usdx.py`).
    """
    usdx_songs = tmp_path / "usdx" / "songs"
    usdx_songs.mkdir(parents=True)
    song_txt = make_song(tmp_path / "library", "Artist - Title (123)")

    assert _needs_copy(song_txt, usdx_songs) is True


def test_a_song_in_a_sibling_directory_of_the_usdx_songs_dir_is_copied(tmp_path: Path) -> None:
    """`songs2` starts with the same characters as `songs` but is not inside it."""
    usdx_songs = tmp_path / "usdx" / "songs"
    usdx_songs.mkdir(parents=True)
    song_txt = make_song(tmp_path / "usdx" / "songs2", "Artist - Title (123)")

    assert _needs_copy(song_txt, usdx_songs) is True


def test_the_copy_lands_in_the_usdx_songs_dir_under_an_ascii_name(tmp_path: Path) -> None:
    usdx_songs = tmp_path / "usdx" / "songs"
    song_txt = make_song(tmp_path / "library", "Céline Dion - My Heart Will Go On (3440)")

    copied = _copy_into_songs_dir(song_txt, usdx_songs)

    # Inside the songs directory USDX itself loads from: that is what made USDX drop the
    # library path instead of loading it as well.
    assert copied == usdx_songs / COPY_DIR_NAME / "song.txt"
    assert copied.is_relative_to(usdx_songs)
    assert _needs_copy(copied, usdx_songs) is False
    assert sorted(path.name for path in copied.parent.iterdir()) == ["song.mp3", "song.txt"]


def test_a_copied_txt_whose_name_is_the_problem_is_renamed(tmp_path: Path) -> None:
    """The directory name is replaced by the copy's; the file name has to be replaced
    inside it. The media file is left alone: USDX reads that one off the disk."""
    usdx_songs = tmp_path / "usdx" / "songs"
    song_txt = make_song(tmp_path / "library", "Artist - Title (123)", "Künstler & Lied!.txt")

    copied = _copy_into_songs_dir(song_txt, usdx_songs)

    assert copied == usdx_songs / COPY_DIR_NAME / COPY_TXT_NAME
    assert copied.read_text(encoding="utf-8") == "#TITLE:Title\n#ARTIST:Artist\n"
    assert _needs_copy(copied, usdx_songs) is False
    assert sorted(path.name for path in copied.parent.iterdir()) == [COPY_TXT_NAME, "song.mp3"]


def test_copying_replaces_what_an_earlier_crash_left_behind(tmp_path: Path) -> None:
    usdx_songs = tmp_path / "usdx" / "songs"
    leftover = usdx_songs / COPY_DIR_NAME
    leftover.mkdir(parents=True)
    (leftover / "stale.txt").write_text("from a run that never cleaned up", encoding="utf-8")
    song_txt = make_song(tmp_path / "library", "Artist - Title (123)")

    copied = _copy_into_songs_dir(song_txt, usdx_songs)

    assert sorted(path.name for path in copied.parent.iterdir()) == ["song.mp3", "song.txt"]
