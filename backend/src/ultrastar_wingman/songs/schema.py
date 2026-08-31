"""Song read models. Separate from `api.py` so modules that must not import FastAPI
(the karaoke service, the event bus) can still speak in song payloads."""

from pydantic import BaseModel, field_validator

from .model import Song
from .txt import SongTxt

# The largest year a four-digit `#YEAR` header can hold. Nothing older than the year 0 was
# ever recorded either, so a year the editor *writes* is bounded on both ends rather than
# free. A year it merely *read* is not — see `SongEdit`.
MAX_YEAR = 9999


class SongRead(BaseModel):
    id: str
    source: str
    title: str
    artist: str
    # The span USDX plays (`#START`/`#END` applied), so a progress bar built on it lines
    # up with what the TV shows.
    duration_seconds: int | None
    has_video: bool
    # Two singers take turns in the file. Read out of the `.txt` by the parser, and — like
    # `has_video`, the genre and the year — what the *Duet* facet filters on: the built-in
    # facets are computed on the client, over the song list it already has.
    is_duet: bool
    language: str | None
    genre: str | None
    year: int | None
    edition: str | None
    creator: str | None


class SongList(BaseModel):
    songs: list[SongRead]


class SongMetadata(BaseModel):
    """The headers the song editor writes, and nothing else.

    Deliberately not every column of `SongRead`: `duration_seconds`, `has_video` and
    `is_duet` are facts about the files rather than values anybody types, and the txt's
    `#CREATOR` says who built the karaoke file — not something to fix about the song.
    Title and artist have to say something, everything else may be emptied, and an emptied
    value is `None`: in a txt "no genre" is no `#GENRE` header at all.

    The model says what a file *may say*, not what may be written into one — it describes
    `expected`, the values the editor was opened on, as much as the new ones. So the year
    carries no bound here: real libraries hold `#YEAR:20144`, and a bound on both halves
    would make that very song the one song this editor cannot fix. `SongEdit` bounds the
    half that is written.
    """

    title: str
    artist: str
    language: str | None = None
    genre: str | None = None
    year: int | None = None
    edition: str | None = None

    @field_validator("title", "artist")
    @classmethod
    def _said(cls, value: str) -> str:
        stripped = _one_line(value).strip()
        if not stripped:
            raise ValueError("must not be empty")
        return stripped

    @field_validator("language", "genre", "edition")
    @classmethod
    def _optional(cls, value: str | None) -> str | None:
        return None if value is None else (_one_line(value).strip() or None)


class SongEdit(BaseModel):
    """What the editor sends: the new metadata, and the metadata it was opened on.

    `expected` is how a lost edit is caught. The file may have been re-downloaded or edited
    by hand since the form was filled in, and the request that arrives afterwards would
    otherwise put the old values back over the new ones — so the service compares
    `expected` against what the txt says *now* and refuses when the two have drifted apart.
    """

    values: SongMetadata
    expected: SongMetadata

    @field_validator("values")
    @classmethod
    def _writable_year(cls, value: SongMetadata) -> SongMetadata:
        """A `#YEAR` this app writes is a four-digit one. The bound sits on `values` alone
        and not on the field: `expected` is the same model reporting a file as it is, and a
        file whose year is out of these bounds is exactly the file somebody opened the
        editor to fix."""
        if value.year is not None and not 0 <= value.year <= MAX_YEAR:
            raise ValueError(f"year must be between 0 and {MAX_YEAR}")
        return value


def _one_line(value: str) -> str:
    """A header is one line. A value carrying a line break would write itself into the file
    as extra lines — a header of its own invention, or a note line in the middle of the
    tags. Measured with `splitlines`, which is what everything reading the file back uses:
    it breaks on more than CR and LF (a vertical tab, U+2028, …), and a value that survives
    the write only to split on the next read is the same hole one step later."""
    if value.splitlines() not in ([], [value]):
        raise ValueError("must not contain a line break")
    return value


def song_metadata(txt: SongTxt) -> SongMetadata:
    """What a parsed txt says about the six editable values. `model_construct`, not the
    validators: this describes a file as it is rather than checking it, and it has to come
    out of the same class as `expected` — pydantic's `==` compares the type first, so a
    stricter model for one of the two sides would make every comparison a mismatch."""
    return SongMetadata.model_construct(
        title=txt.title,
        artist=txt.artist,
        language=txt.language,
        genre=txt.genre,
        year=txt.year,
        edition=txt.edition,
    )


def read_song(song: Song) -> SongRead:
    return SongRead(
        id=song.id,
        source=song.source,
        title=song.title,
        artist=song.artist,
        duration_seconds=song.duration_seconds,
        # File paths stay server-side; the UI only needs to know a video exists.
        has_video=song.video_file is not None,
        is_duet=song.is_duet,
        language=song.language,
        genre=song.genre,
        year=song.year,
        edition=song.edition,
        creator=song.creator,
    )
