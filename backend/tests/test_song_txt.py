import pytest

from conftest import FIXTURES
from ultrastar_wingman.songs.txt import (
    SongTxtEncodingError,
    SongTxtError,
    decode,
    load_song_txt,
    parse_song_txt,
    read_song_txt,
    rewrite_headers,
)

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
        "is_duet": False,
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


def test_a_duet_is_recognized_by_its_body() -> None:
    assert read_song_txt(SONGS / "duet_body.txt").is_duet is True


def test_a_duet_is_recognized_by_its_headers_alone() -> None:
    # No "P1" line in the body of this one; the two singer headers are the whole mark.
    assert read_song_txt(SONGS / "duet_headers.txt").is_duet is True


def test_a_solo_is_not_a_duet() -> None:
    assert read_song_txt(SONGS / "minimal.txt").is_duet is False
    assert read_song_txt(SONGS / "utf8.txt").is_duet is False


def test_the_older_duet_singer_headers_count_too() -> None:
    assert parse_song_txt("#TITLE:T\n#ARTIST:A\n#P1:Her\n#P2:Him\n: 0 4 0 la\nE\n").is_duet is True


@pytest.mark.parametrize("line", ["P 2", "p2", "P02"])
def test_a_singer_line_is_read_however_it_is_spaced_and_cased(line: str) -> None:
    body = f"#TITLE:T\n#ARTIST:A\nP1\n: 0 4 0 la\n{line}\n: 8 4 0 la\nE\n"
    assert parse_song_txt(body).is_duet is True


def test_one_singer_marker_alone_is_not_a_duet() -> None:
    # A converted solo song keeps its "P1" and never hands over.
    assert parse_song_txt("#TITLE:T\n#ARTIST:A\nP1\n: 0 4 0 la\nE\n").is_duet is False


def test_one_duet_singer_header_alone_is_not_a_duet() -> None:
    assert (
        parse_song_txt("#TITLE:T\n#ARTIST:A\n#DUETSINGERP1:Her\n: 0 4 0 la\nE\n").is_duet is False
    )


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


# --- writing headers back ------------------------------------------------------------
#
# The rule for every one of these: outside the headers the caller named, the file's bytes
# come back out exactly as they went in — BOM, line endings, unknown tags, body and all.


def rewritten(path: object, changes: dict[str, str | None]) -> tuple[bytes, bytes]:
    """The file's bytes before and after `changes`, ready to be compared line by line."""
    raw = SONGS.joinpath(str(path)).read_bytes()
    file = load_song_txt(raw)
    return raw, file.encode(rewrite_headers(file.text, changes))


def test_a_rewrite_touches_only_the_named_header() -> None:
    before, after = rewritten("junk.txt", {"YEAR": "1998"})

    # One line differs; every other byte of the file — the CRLF endings, the unknown tags,
    # the `#NOCOLON` line, the junk line and the notes — is where it was.
    assert after.replace(b"#YEAR:1998", b"#YEAR:unknown") == before
    assert b"#UNKNOWN_TAG:whatever\r\n" in after
    assert after.count(b"\r\n") == before.count(b"\r\n")


def test_a_rewrite_keeps_the_utf8_bom_and_the_encoding() -> None:
    before, after = rewritten("utf8_bom.txt", {"GENRE": "Trip-Hop"})

    assert after.startswith(b"\xef\xbb\xbf")
    # Still the same file, still UTF-8: the Icelandic title survives untranscoded.
    assert "Jóga".encode() in after
    assert parse_song_txt(load_song_txt(after).text).genre == "Trip-Hop"
    assert parse_song_txt(load_song_txt(before).text).genre is None


def test_a_rewrite_of_a_code_page_file_stays_in_its_code_page() -> None:
    _, after = rewritten("cp1252.txt", {"EDITION": "Straßenfeger"})

    file = load_song_txt(after)
    # Which single-byte code page the detector settles on is its business (cp1250 and
    # cp1252 spell this file identically); that it stays a single-byte file is not.
    assert file.encoding != "utf-8"
    # "groß" is one byte in cp1252 and two in UTF-8; the file was not transcoded, and the
    # new value went in in the file's own code page rather than in the app's.
    assert "groß.mp3".encode("cp1252") in after
    assert "#EDITION:Straßenfeger".encode("cp1252") in after
    assert parse_song_txt(file.text).edition == "Straßenfeger"


def test_a_rewrite_keeps_the_tag_spelling_it_found() -> None:
    # junk.txt writes "#title:" in lower case; a rewrite is not a reformat.
    _, after = rewritten("junk.txt", {"TITLE": "Tidy Tags"})

    assert b"#title:Tidy Tags\r\n" in after
    # And the duplicate the parser already ignored is still ignored, not promoted.
    assert b"#TITLE:Ignored Second Title\r\n" in after
    assert parse_song_txt(load_song_txt(after).text).title == "Tidy Tags"


def test_an_empty_header_is_filled_rather_than_doubled() -> None:
    # "#GENRE:" parses as "no genre" but is still the line the new genre belongs on.
    _, after = rewritten("junk.txt", {"GENRE": "Funk"})

    assert after.count(b"#GENRE") == 1
    assert b"#GENRE:Funk\r\n" in after


def test_removing_a_header_removes_every_copy_of_it() -> None:
    text = "#TITLE:T\r\n#ARTIST:A\r\n#GENRE:Rock\r\n#GENRE:Pop\r\n: 0 4 0 la\r\nE\r\n"

    result = rewrite_headers(text, {"GENRE": None})

    # Deleting only the first would hand the song to the duplicate behind it.
    assert "GENRE" not in result
    assert result == "#TITLE:T\r\n#ARTIST:A\r\n: 0 4 0 la\r\nE\r\n"


def test_a_missing_header_is_added_to_the_header_block() -> None:
    _, after = rewritten("minimal.txt", {"YEAR": "1975", "EDITION": "Party"})

    text = load_song_txt(after).text
    # After the headers and before the notes, in the order they were asked for.
    assert text == (
        "#TITLE:Only Title And Artist\r\n"
        "#ARTIST:Someone\r\n"
        "#YEAR:1975\r\n"
        "#EDITION:Party\r\n"
        ": 0 4 0 la\r\n"
        "E\r\n"
    )
    txt = parse_song_txt(text)
    assert (txt.year, txt.edition) == (1975, "Party")


def test_an_added_header_copies_the_line_ending_around_it() -> None:
    result = rewrite_headers("#TITLE:T\r\n#ARTIST:A\r\n: 0 4 0 la\r\nE\r\n", {"GENRE": "Rock"})

    assert result == "#TITLE:T\r\n#ARTIST:A\r\n#GENRE:Rock\r\n: 0 4 0 la\r\nE\r\n"
    assert "\n#GENRE" not in result.replace("\r\n#GENRE", "")


def test_a_header_added_to_a_file_without_a_last_newline_gets_one() -> None:
    result = rewrite_headers("#TITLE:T\r\n#ARTIST:A", {"GENRE": "Rock"})

    assert result == "#TITLE:T\r\n#ARTIST:A\r\n#GENRE:Rock\r\n"


def test_a_rewrite_leaves_a_duet_a_duet() -> None:
    before, after = rewritten("duet_body.txt", {"LANGUAGE": "Englisch"})

    assert parse_song_txt(load_song_txt(after).text).is_duet is True
    # The singer switches are body lines, and the body is not the editor's business.
    assert after.count(b"P1\r\n") == before.count(b"P1\r\n")
    assert after.count(b"P2\r\n") == before.count(b"P2\r\n")


def test_a_file_whose_bytes_cannot_be_reproduced_is_not_writable() -> None:
    """A UTF-8 BOM in front of a byte that is not UTF-8 at all. Reading such a file is fine
    — the scanner replaces what it cannot read, and the tags come through — but writing it
    back would silently change the bytes it could not read."""
    raw = b"\xef\xbb\xbf#TITLE:Broken\r\n#ARTIST:Bytes\r\n: 0 4 0 \xffla\r\nE\r\n"

    assert parse_song_txt(decode(raw)).title == "Broken"
    with pytest.raises(SongTxtEncodingError):
        load_song_txt(raw)


def test_a_value_the_file_cannot_spell_is_refused_rather_than_transcoded() -> None:
    file = load_song_txt(SONGS.joinpath("cp1252.txt").read_bytes())

    with pytest.raises(UnicodeEncodeError):
        file.encode(rewrite_headers(file.text, {"TITLE": "上を向いて歩こう"}))


@pytest.mark.parametrize("codec", ["utf-16-le", "utf-16-be", "utf-32-le", "utf-32-be"])
def test_a_wide_file_keeps_its_byte_order(codec: str) -> None:
    """A big-endian file stays big-endian: `utf-16`'s own encoder would put a little-endian
    mark in front of it, which is a rewrite of every byte in the file."""
    marked = ("﻿#TITLE:Wide\r\n#ARTIST:Load\r\n").encode(codec)
    file = load_song_txt(marked)

    after = file.encode(rewrite_headers(file.text, {"YEAR": "1999"}))

    assert after.startswith("﻿".encode(codec))
    assert parse_song_txt(load_song_txt(after).text).year == 1999
    assert after.replace("#YEAR:1999\r\n".encode(codec), b"") == marked


@pytest.mark.parametrize("ending", ["\u2028", "\x85"])
def test_a_line_ending_python_knows_is_an_ending_and_not_a_value(ending: str) -> None:
    """`rewrite_headers` cuts the file up with `splitlines`, so it has to recognize every
    ending `splitlines` breaks on. Reading one of them as part of the value would drop it
    and glue the line behind it onto the rewritten header. U+0085 is not exotic at all: it
    is what byte 0x85 becomes when the detector reads a file as latin-1."""
    text = f"#TITLE:T{ending}#ARTIST:A{ending}#GENRE:Rock{ending}: 0 4 0 la{ending}E{ending}"

    result = rewrite_headers(text, {"GENRE": "Pop"})

    assert result == text.replace("Rock", "Pop")
    assert parse_song_txt(result).genre == "Pop"


def test_a_header_added_to_such_a_file_copies_that_ending() -> None:
    result = rewrite_headers("#TITLE:T\u2028#ARTIST:A\u2028E\u2028", {"YEAR": "1999"})

    assert result == "#TITLE:T\u2028#ARTIST:A\u2028#YEAR:1999\u2028E\u2028"
