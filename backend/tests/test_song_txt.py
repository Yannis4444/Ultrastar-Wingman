import pytest

from conftest import FIXTURES
from ultrastar_wingman.songs.txt import SongTxtError, decode, parse_song_txt, read_song_txt

SONGS = FIXTURES / "songs"


def test_all_tags_are_parsed() -> None:
    txt = read_song_txt(SONGS / "utf8.txt")
    assert txt.model_dump() == {
        "title": "Uptown Funk",
        "artist": "Mark Ronson feat. Bruno Mars",
        # AUDIO wins over the historic MP3 tag ("legacy.mp3" in the fixture).
        "audio": "song.mp3",
        "cover": "cover.jpg",
        "video": "video.mp4",
        "background": "background.jpg",
        "language": "English",
        "genre": "Funk",
        "year": 2014,
        "edition": "Party Classics",
        "creator": "wingman",
        # Both in seconds here: "#START:12.5" already is, "#END:210000" is milliseconds.
        "start": 12.5,
        "end": 210.0,
    }


def test_the_playback_window_is_normalized_to_seconds() -> None:
    txt = parse_song_txt("#TITLE:t\n#ARTIST:a\n#START:25,6\n#END:225000\n")
    # A German editor writes the decimal with a comma.
    assert (txt.start, txt.end) == (25.6, 225.0)


@pytest.mark.parametrize("value", ["unknown", "", "0", "-4"])
def test_an_unusable_playback_window_is_no_window(value: str) -> None:
    # Zero means "not set" to USDX, and nothing before it can be parsed as a time.
    txt = parse_song_txt(f"#TITLE:t\n#ARTIST:a\n#START:{value}\n#END:{value}\n")
    assert (txt.start, txt.end) == (None, None)


def test_utf8_bom_is_stripped_and_unicode_survives() -> None:
    # USDX itself writes UTF-8 with BOM; the BOM must not end up in the first tag.
    txt = read_song_txt(SONGS / "utf8_bom.txt")
    assert txt.title == "Jóga"
    assert txt.artist == "Björk"
    assert txt.audio == "jóga.mp3"


def test_legacy_code_page_is_detected() -> None:
    txt = read_song_txt(SONGS / "cp1252.txt")
    assert txt.title == "Über den Wolken"
    assert txt.artist == "Reinhard Mey"
    assert txt.audio == "groß.mp3"
    assert txt.language == "Deutsch"


def test_optional_tags_default_to_none() -> None:
    txt = read_song_txt(SONGS / "minimal.txt")
    assert (txt.title, txt.artist) == ("Only Title And Artist", "Someone")
    assert txt.audio is None
    assert txt.cover is None
    assert txt.year is None


def test_junk_lines_unknown_tags_and_crlf_are_tolerated() -> None:
    txt = read_song_txt(SONGS / "junk.txt")
    # Tag names are case-insensitive, values are stripped and the first tag wins.
    assert txt.title == "Junky Tags"
    assert txt.artist == "Spaced Out"
    assert txt.audio == "legacy.mp3"
    # "#YEAR:unknown" and an empty "#GENRE:" are missing values, not errors.
    assert txt.year is None
    assert txt.genre is None


def test_a_song_without_artist_is_refused() -> None:
    with pytest.raises(SongTxtError):
        read_song_txt(SONGS / "no_artist.txt")


def test_a_song_without_title_is_refused() -> None:
    with pytest.raises(SongTxtError):
        parse_song_txt("#ARTIST:Someone\n: 0 4 0 la\nE\n")


@pytest.mark.parametrize("encoding", ["utf-16", "utf-32"])
def test_wide_encodings_are_detected_by_their_bom(encoding: str) -> None:
    raw = "#TITLE:Wide\n#ARTIST:Load\n".encode(encoding)
    txt = parse_song_txt(decode(raw))
    assert (txt.title, txt.artist) == ("Wide", "Load")


def test_undetectable_bytes_still_yield_the_tags() -> None:
    # Random high bytes in the lyrics must not lose the header.
    raw = b"#TITLE:Broken\n#ARTIST:Bytes\n: 0 4 0 \x81\x8d\x8f\x90\x9d\nE\n"
    txt = parse_song_txt(decode(raw))
    assert (txt.title, txt.artist) == ("Broken", "Bytes")
