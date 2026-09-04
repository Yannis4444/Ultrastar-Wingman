"""The import/export archive: a `.tar.gz` holding one directory per achievement.

```
builtin-score-9000/achievement.json
builtin-score-9000/icon.png          (only when the achievement has an uploaded picture)
```

The format layer and nothing else — no FastAPI, no database, no filesystem. `build_archive`
turns rows into bytes, `read_archive` turns a stranger's bytes back into achievements, and
`achievements/service.py` is what reads the icons off the disk and writes the rows.

**The file is meant to be opened and edited by hand**, which is the whole reason it is a
directory of small JSON files rather than one blob: `json.dumps(indent=2,
ensure_ascii=False)` with the fields in a fixed, readable order, so a diff between two
exports reads like a diff between two catalogues. It is also why `AchievementFile` forbids
extra keys: a `"colour"` that was quietly ignored is exactly the mistake a hand-edited file
invites, and a rejection that names the key is one keystroke away from a fix.

**`built_in` is not in the file.** An imported achievement is a built-in if and only if its
*id* is one of the ids Wingman ships (`builtin.BY_ID`) — a flag in a file a stranger wrote
would otherwise be a way to mint an undeletable row. Writing `"built_in"` into the JSON is
therefore a rejection like any other unknown key, rather than a field with no effect.

**A built-in's `definition` is read but never applied.** What one of the shipped achievements
asks for is `builtin.py`'s, and `service.import_archive` leaves those ids' stored conditions
alone. The format still carries the field — an export is a faithful copy of the
row, which is what makes the round trip work — it simply has no effect on a built-in, and
that is where an archive would otherwise be a way past the 409 `PATCH` gives.

**Reading is the defensive half**, because the input is a file somebody uploaded:

* nothing is ever extracted to a path from the tar — members are read in memory with
  `extractfile`, so no member name can ever become a path on this machine;
* a member that is not a regular file (a symlink, a hardlink, a device, a fifo) is refused;
  a directory member is skipped, because other tar writers emit one per directory;
* a member name that is absolute, that names a drive, that holds a `..` or a `.`, or that
  has anything but the two segments this format allows, is refused;
* the caps below are checked *while* the archive is being read. A cap checked after the
  fact is not a cap: a gzip bomb is a few kilobytes on the wire and gigabytes in memory.

Every rejection is one of the `ArchiveError`s below, naming the member or the achievement it
was about — somebody who exported from one instance and imported into another has to be told
*which* achievement and *what* was wrong, never "invalid archive".
"""

import gzip
import io
import json
import tarfile
from dataclasses import dataclass
from typing import IO, Annotated, Any, cast

from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints, ValidationError

from ..images import IMAGE_MEDIA_TYPES, MAX_IMAGE_BYTES
from ..tags.schema import TagColor
from .schema import AchievementDescription, AchievementIcon, AchievementName, Condition

# The upload itself. Icons are capped at 5 MB apiece by `images.py`, so this is a few dozen
# of them plus every JSON file beside them — far more than a catalogue ever is, and small
# enough that a request never buffers a meaningful amount of memory.
MAX_ARCHIVE_BYTES = 32 * 1024 * 1024

# What the archive is allowed to *decompress* to. This is the cap that matters: the ratio
# between the two is what a gzip bomb lives in, and 32 MB of compressed zeros is a few
# hundred gigabytes without it. Four times the compressed cap, because JSON compresses well
# and pictures do not.
MAX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024

# Two members per achievement, plus a directory entry apiece from tar writers that emit
# them. 512 is well past any catalogue somebody hand-maintains.
MAX_MEMBERS = 512

# One `achievement.json`. A definition is a handful of conditions — a few hundred bytes —
# and the presentation fields are capped by their own models, so this is only here to stop a
# single member eating the whole uncompressed budget.
MAX_JSON_BYTES = 256 * 1024

ACHIEVEMENT_FILE = "achievement.json"
ICON_STEM = "icon"

# Windows resolves these to devices in *every* directory and under any extension, so an
# achievement called `con` would have `con.png` written to the console rather than to the
# icons directory. They are the one thing the pattern below lets through that is not a file
# name on the platform Wingman ships on. Nothing Wingman mints is one — a uuid4 hex is 32
# characters and a shipped slug starts with `builtin-` — so refusing them costs no archive
# anybody has.
RESERVED_NAMES = frozenset(
    {"con", "prn", "aux", "nul"}
    | {f"com{digit}" for digit in "123456789"}
    | {f"lpt{digit}" for digit in "123456789"}
)


def _is_a_file_name(achievement_id: str) -> str:
    if achievement_id in RESERVED_NAMES:
        raise ValueError(f"'{achievement_id}' is a reserved device name and cannot be an id")
    return achievement_id


# The id is the directory name in the archive *and* the stem of the icon file on disk
# (`images.store_image`), so it is checked as strictly as a filename has to be: lowercase,
# no dots, no separators, and no longer than the column. A uuid4 hex and a `builtin-…` slug
# both fit; nothing that could walk out of a directory does.
ArchiveAchievementId = Annotated[
    str,
    StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,63}$"),
    AfterValidator(_is_a_file_name),
]

# What a member name has to look like, spelled out for the error messages. One sentence
# beats a regex when the person reading it is holding a text editor.
MEMBER_SHAPE = f"'<achievement id>/{ACHIEVEMENT_FILE}' or '<achievement id>/{ICON_STEM}.png'"


class ArchiveError(ValueError):
    """Anything wrong with an archive. Every subclass carries a sentence a person can act
    on — the API hands the message straight to the caller."""


class ArchiveTooLargeError(ArchiveError):
    """The upload, or what it decompresses to, is past a cap."""


class MalformedArchiveError(ArchiveError):
    """Not a gzipped tar at all, or one that ends in the middle of itself."""


class ArchiveMemberError(ArchiveError):
    """A member this format does not allow: a bad name, a link, or too many of them."""


class AchievementFileError(ArchiveError):
    """One achievement's `achievement.json` cannot be read. Names the directory it is in."""

    def __init__(self, achievement_id: str, problem: str) -> None:
        super().__init__(f"'{achievement_id}/{ACHIEVEMENT_FILE}': {problem}")
        self.achievement_id = achievement_id


class ArchiveIconError(ArchiveError):
    """One achievement's picture is not one this instance would accept as an upload."""

    def __init__(self, achievement_id: str, problem: str) -> None:
        super().__init__(f"the icon of '{achievement_id}': {problem}")
        self.achievement_id = achievement_id


class EmptyArchiveError(ArchiveError):
    """A well-formed archive holding no achievement at all."""


class AchievementFile(BaseModel):
    """`achievement.json`, as a stranger's file is parsed and as an export writes it.

    `extra="forbid"`: see the module docstring — a hand-edited file's typo has to be a
    rejection that names the key, and `built_in` has to be a rejection rather than a field
    that quietly does nothing.

    `definition` goes through the very same `Condition` models the API parses a `POST` body
    with, so an archive can never put a row in the table that nobody could ever earn.
    """

    model_config = ConfigDict(extra="forbid")

    id: ArchiveAchievementId
    name: AchievementName
    description: AchievementDescription = ""
    icon: AchievementIcon | None = None
    color: TagColor = "neutral"
    hidden: bool = False
    enabled: bool = True
    # Left out by a hand-written file: a new achievement lands at the end of the catalogue
    # and an existing one keeps the place it already has. An export always writes it.
    sort_order: int | None = None
    definition: list[Condition]


@dataclass(frozen=True)
class ArchiveImage:
    """An uploaded picture on its way through an archive. The extension is one of
    `images.IMAGE_MEDIA_TYPES` — it is what says which content type the bytes claim to be."""

    extension: str
    data: bytes


@dataclass(frozen=True)
class ArchiveEntry:
    """One achievement on its way *into* an archive.

    `definition` is the raw JSON column rather than parsed conditions, deliberately: an
    export is a faithful copy of the row, so a definition somebody hand-edited into a shape
    the models refuse is exported as it stands and can be fixed in the archive. Reading is
    the half that validates — see `ArchivedAchievement`.
    """

    id: str
    name: str
    description: str
    icon: str | None
    color: str
    hidden: bool
    enabled: bool
    sort_order: int
    definition: list[dict[str, Any]]
    icon_image: ArchiveImage | None = None


@dataclass(frozen=True)
class ArchivedAchievement:
    """One achievement read *out* of an archive: the parsed file, and its picture if it
    brought one."""

    achievement: AchievementFile
    icon_image: ArchiveImage | None


def build_archive(entries: list[ArchiveEntry]) -> bytes:
    """The `.tar.gz` bytes for these achievements.

    Deterministic: the same entries give the same bytes, every time and on every machine.
    Members are sorted by id, the gzip header carries no filename and no timestamp, and every
    tar header has a zeroed mtime, owner and mode. That is what makes two exports diffable
    and what lets a test assert on it — a tar that stamped `time.time()` into every header
    would differ from itself a second later.
    """
    buffer = io.BytesIO()
    # `mtime=0` and `filename=""`: both live in the gzip header, and both would otherwise
    # make the bytes depend on when and where the export ran.
    #
    # USTAR rather than the default PAX: PAX writes a header block of its own carrying
    # timestamps. An id is at most 64 characters and the longest name beside it is
    # `/achievement.json` (17), so every name stays under USTAR's 100-character limit.
    with (
        gzip.GzipFile(filename="", mode="wb", fileobj=buffer, compresslevel=9, mtime=0) as gz,
        tarfile.open(fileobj=gz, mode="w", format=tarfile.USTAR_FORMAT) as tar,
    ):
        for entry in sorted(entries, key=lambda one: one.id):
            _add_member(tar, f"{entry.id}/{ACHIEVEMENT_FILE}", dump_file(entry))
            if entry.icon_image is not None:
                _add_member(
                    tar,
                    f"{entry.id}/{ICON_STEM}{entry.icon_image.extension}",
                    entry.icon_image.data,
                )
    return buffer.getvalue()


def _add_member(tar: tarfile.TarFile, name: str, data: bytes) -> None:
    """One file in the tar, with a header that says nothing about this machine.

    Every field a tar header would otherwise fill from the filesystem is zeroed — the
    timestamp, the owner and its name, the group and its name — and the mode is a fixed
    0644. Without that, the same catalogue exported twice would be two different files.
    """
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mtime = 0
    info.mode = 0o644
    info.type = tarfile.REGTYPE
    info.uid = 0
    info.gid = 0
    info.uname = ""
    info.gname = ""
    tar.addfile(info, io.BytesIO(data))


def dump_file(entry: ArchiveEntry) -> bytes:
    """One `achievement.json`.

    The field order is fixed and is the order this document's table lists them in: what the
    achievement *is* first, how it behaves second, what it asks for last. Two spaces of
    indent, no escaped non-ASCII (a badge called *Hüftschwung* reads as itself) and a
    trailing newline, because this is a text file people open.
    """
    document = {
        "id": entry.id,
        "name": entry.name,
        "description": entry.description,
        "icon": entry.icon,
        "color": entry.color,
        "hidden": entry.hidden,
        "enabled": entry.enabled,
        "sort_order": entry.sort_order,
        "definition": entry.definition,
    }
    return (json.dumps(document, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def read_archive(data: bytes) -> list[ArchivedAchievement]:
    """Every achievement in the archive, in the order its directories sort.

    Raises one of the `ArchiveError`s and never anything else — see the module docstring for
    what is refused and why. Nothing here touches the filesystem: the caller gets bytes.
    """
    if len(data) > MAX_ARCHIVE_BYTES:
        raise ArchiveTooLargeError(f"an archive may not be larger than {MAX_ARCHIVE_BYTES} bytes")
    files, images = _read_members(data)
    for orphan in sorted(set(images) - set(files)):
        # A picture with nothing to belong to. Named rather than dropped: it is almost always
        # a directory that lost its JSON on the way, and silently importing the rest would
        # take the picture off the achievement it was meant for.
        raise AchievementFileError(orphan, f"the directory holds an icon but no {ACHIEVEMENT_FILE}")
    if not files:
        raise EmptyArchiveError(
            "the archive holds no achievement at all: every one of them is a directory "
            f"with an {ACHIEVEMENT_FILE} in it"
        )
    return [
        ArchivedAchievement(
            achievement=_parse_file(achievement_id, files[achievement_id]),
            icon_image=images.get(achievement_id),
        )
        for achievement_id in sorted(files)
    ]


def _read_members(data: bytes) -> tuple[dict[str, bytes], dict[str, ArchiveImage]]:
    """The raw bytes of every member, keyed by the directory it was in.

    The decompressed stream is counted as it is read (`_CappedReader`), so a bomb is stopped
    at the cap rather than after it has already been unpacked into memory.
    """
    stream = _CappedReader(gzip.GzipFile(fileobj=io.BytesIO(data), mode="rb"))
    files: dict[str, bytes] = {}
    images: dict[str, ArchiveImage] = {}
    try:
        # `r|` — a single forward pass over the capped reader. A seekable `r:gz` would let
        # tarfile decompress on its own and the cap would have nothing to count. In this mode
        # tarfile only ever calls `read`, which is the whole of `_CappedReader`; the cast is
        # what says so to a type checker that wants the full file protocol.
        with tarfile.open(fileobj=cast(IO[bytes], stream), mode="r|") as tar:
            for index, member in enumerate(tar):
                if index >= MAX_MEMBERS:
                    raise ArchiveMemberError(
                        f"an archive may not hold more than {MAX_MEMBERS} files"
                    )
                _read_member(tar, member, files, images)
    except ArchiveError:
        # Ours already says what was wrong; the catch below must not relabel it.
        raise
    except (tarfile.TarError, EOFError, OSError) as error:
        # `gzip.BadGzipFile` is an `OSError`, and a truncated stream is an `EOFError`.
        raise MalformedArchiveError(f"this is not a readable .tar.gz archive: {error}") from error
    return files, images


def _read_member(
    tar: tarfile.TarFile,
    member: tarfile.TarInfo,
    files: dict[str, bytes],
    images: dict[str, ArchiveImage],
) -> None:
    """One member, read into memory. Never extracted — no name from the tar becomes a path."""
    name = member.name.rstrip("/") if member.isdir() else member.name
    segments = _segments(name)
    if member.isdir():
        # Some tar writers emit one per directory and some do not. Its name still had to be
        # a name this format allows, but there is nothing in it to read.
        return
    if not member.isreg():
        # Symlinks, hardlinks, devices and fifos. None of them is a file this format has,
        # and every one of them is a way of pointing at something outside the archive.
        raise ArchiveMemberError(f"'{name}' is not a regular file")
    if len(segments) != 2:
        raise _not_a_member(name)
    achievement_id, filename = segments
    if filename == ACHIEVEMENT_FILE:
        if achievement_id in files:
            raise ArchiveMemberError(f"'{name}' is in the archive twice")
        files[achievement_id] = _member_bytes(tar, member, MAX_JSON_BYTES, name)
        return
    stem, _, extension = filename.rpartition(".")
    extension = f".{extension}"
    if stem != ICON_STEM or extension not in IMAGE_MEDIA_TYPES:
        raise _not_a_member(name)
    if achievement_id in images:
        raise ArchiveMemberError(f"'{achievement_id}' has more than one icon in the archive")
    images[achievement_id] = ArchiveImage(
        extension=extension,
        data=_member_bytes(tar, member, MAX_IMAGE_BYTES, name),
    )


def _not_a_member(name: str) -> ArchiveMemberError:
    """The refusal a member name that is not one of the format's two files gets. It spells
    the shape out, because the person reading it is holding a text editor."""
    return ArchiveMemberError(
        f"'{name}' is not a member this format allows: every file is {MEMBER_SHAPE}"
    )


def _segments(name: str) -> list[str]:
    """The member's path, split — or an `ArchiveMemberError` saying why it is not one.

    Absolute names, drive letters, backslashes, `..` and `.` are all refused. Nothing here
    is ever turned into a path, so this is not the defence against a traversal; it is what
    keeps the format the two-segment shape it says it is, and what makes the refusal
    readable rather than a `KeyError` three functions later.
    """
    if "\x00" in name:
        raise ArchiveMemberError("a member name holds a null byte")
    if "\\" in name:
        raise ArchiveMemberError(f"'{name}' holds a backslash, which is a path separator here")
    if name.startswith("/") or (len(name) > 1 and name[1] == ":"):
        raise ArchiveMemberError(f"'{name}' is an absolute path")
    segments = name.split("/")
    if any(segment in ("", ".", "..") for segment in segments):
        raise ArchiveMemberError(f"'{name}' is not a plain relative name inside the archive")
    return segments


def _member_bytes(tar: tarfile.TarFile, member: tarfile.TarInfo, cap: int, name: str) -> bytes:
    """A member's content, in memory, refused the moment it is over `cap`.

    The header's own size is checked first so an absurd member is never read at all, and the
    read itself asks for one byte more than the cap so an honest-looking header cannot lie
    its way past it.
    """
    if member.size > cap:
        raise ArchiveMemberError(f"'{name}' is larger than the {cap} bytes it may be")
    extracted = tar.extractfile(member)
    if extracted is None:
        raise ArchiveMemberError(f"'{name}' has no content to read")
    data = extracted.read(cap + 1)
    if len(data) > cap:
        raise ArchiveMemberError(f"'{name}' is larger than the {cap} bytes it may be")
    return data


def _parse_file(achievement_id: str, data: bytes) -> AchievementFile:
    """One `achievement.json`, through the same models the API parses a request with."""
    try:
        # `utf-8-sig`: a Windows editor writes a BOM in front of the file it saved, and a
        # format whose whole purpose is being edited by hand cannot refuse one over it.
        document = json.loads(data.decode("utf-8-sig"))
    except UnicodeDecodeError as error:
        raise AchievementFileError(achievement_id, "it is not UTF-8 text") from error
    except json.JSONDecodeError as error:
        raise AchievementFileError(achievement_id, f"it is not valid JSON ({error})") from error
    if not isinstance(document, dict):
        raise AchievementFileError(achievement_id, "it has to hold one JSON object")
    try:
        parsed = AchievementFile.model_validate(document)
    except ValidationError as error:
        raise AchievementFileError(achievement_id, _readable(error)) from error
    if parsed.id != achievement_id:
        # The directory is the id, so that two directories can never quietly be the same
        # achievement — and so that copying a directory to make a new achievement is caught
        # the moment the id inside was not changed with it.
        raise AchievementFileError(
            achievement_id, f"its id says '{parsed.id}' but its directory says '{achievement_id}'"
        )
    return parsed


def _readable(error: ValidationError) -> str:
    """Pydantic's report as one line a person can act on — the field, and what is wrong."""
    return "; ".join(
        f"{'.'.join(str(part) for part in problem['loc']) or 'the file'}: {problem['msg']}"
        for problem in error.errors()
    )


class _CappedReader:
    """A read-only stream that refuses to hand out more than `MAX_UNCOMPRESSED_BYTES`.

    Wrapped around the gzip stream rather than around the upload, because the uncompressed
    size is the one an attacker controls for free: a few kilobytes of zeros decompress to
    whatever they like. Counting inside `read` is what makes this a cap rather than a check
    — a limit tested after the unpacking has already happened protects nothing.
    """

    def __init__(self, stream: gzip.GzipFile) -> None:
        self._stream = stream
        self._read = 0

    def read(self, size: int = -1) -> bytes:
        chunk = self._stream.read(size)
        self._read += len(chunk)
        if self._read > MAX_UNCOMPRESSED_BYTES:
            raise ArchiveTooLargeError(
                f"the archive unpacks to more than the {MAX_UNCOMPRESSED_BYTES} bytes it may"
            )
        return chunk

    def close(self) -> None:
        self._stream.close()
