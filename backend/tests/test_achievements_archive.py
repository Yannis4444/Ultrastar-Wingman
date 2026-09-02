"""The import/export archive — the format layer, and the two routes over it.

`archive.py` is a parser of external data, which `docs/dev/testing.md` says gets edge-case
tests: an archive arrives as a file somebody uploaded, and the failure mode it invites is a
tar that writes where it likes. So the adversarial half of this file is as long as the happy
half — a `..` in a name, an absolute path, a symlink, a gzip bomb, a member that is too big,
too many members, an `achievement.json` that is not JSON — and every one of them has to be a
clean 4xx naming the problem, never a 500 and never a byte written outside the data dir.

The happy half is the round trip the format exists for: export the seventeen built-ins,
import them back, nothing changed; export, edit the JSON in a text editor, import, the edit
took.
"""

import gzip
import io
import json
import tarfile
import tracemalloc
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import delete, select

from conftest import admin_client, authenticate_admin
from ultrastar_wingman.achievements import archive, service
from ultrastar_wingman.achievements.archive import (
    ACHIEVEMENT_FILE,
    ArchiveEntry,
    ArchiveImage,
    ArchiveMemberError,
    ArchiveTooLargeError,
    build_archive,
)
from ultrastar_wingman.achievements.builtin import BUILT_INS
from ultrastar_wingman.achievements.model import Achievement
from ultrastar_wingman.app import create_app
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.songs import scanner

# The smallest real png there is, so the declared content type, the magic bytes and the
# header dimensions all genuinely agree — the same three `images.py` checks on an upload.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)

# A second real picture, in the other format, so an archive can genuinely *replace* a stored
# one rather than write the same bytes over them.
JPEG = bytes.fromhex("ffd8ffe000104a46494600010100000100010000ffc0000b080001000101011100ffd9")

BUILT_IN_IDS = [built_in.id for built_in in BUILT_INS]

EXPORT = "/api/v1/achievements/export"
IMPORT = "/api/v1/achievements/import"


@dataclass
class Instance:
    """One app and one administrator on it — the only identity that may import or export."""

    app: FastAPI
    client: AsyncClient
    data_dir: Path

    @property
    def icons(self) -> Path:
        return self.data_dir / "achievement_icons"


@pytest.fixture
async def instance(bootstrap_settings: BootstrapSettings) -> AsyncIterator[Instance]:
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        # The startup scan reconciles the library against a disk this file never wrote to.
        await scanner.stop_scan()
        await authenticate_admin(app)
        client = admin_client(app)
        try:
            yield Instance(app=app, client=client, data_dir=bootstrap_settings.data_dir)
        finally:
            # Let the pass an import started finish rather than cancelling it mid-query.
            await service.wait_for_passes()
            await client.aclose()


def entry(achievement_id: str = "test-one", **fields: Any) -> ArchiveEntry:
    values: dict[str, Any] = {
        "name": "Test",
        "description": "",
        "icon": "trophy",
        "color": "gold",
        "hidden": False,
        "enabled": True,
        "sort_order": 0,
        "definition": [{"scope": "global", "metric": "any_score", "comparator": ">=", "value": 1}],
    }
    values.update(fields)
    return ArchiveEntry(id=achievement_id, **values)


def file_member(name: str, data: bytes) -> tuple[tarfile.TarInfo, bytes | None]:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    return info, data


def link_member(name: str, target: str, kind: bytes) -> tuple[tarfile.TarInfo, bytes | None]:
    info = tarfile.TarInfo(name)
    info.type = kind
    info.linkname = target
    return info, None


def tar_gz(members: list[tuple[tarfile.TarInfo, bytes | None]]) -> bytes:
    """A `.tar.gz` built by hand, so a test can put things in it that Wingman never would."""
    buffer = io.BytesIO()
    with (
        gzip.GzipFile(fileobj=buffer, mode="wb") as gz,
        tarfile.open(fileobj=gz, mode="w") as tar,
    ):
        for info, data in members:
            tar.addfile(info, None if data is None else io.BytesIO(data))
    return buffer.getvalue()


def one_achievement(achievement_id: str = "test-one", **fields: Any) -> dict[str, Any]:
    """The JSON of one valid `achievement.json`, as a dict a test can then break."""
    document: dict[str, Any] = {
        "id": achievement_id,
        "name": "Test",
        "description": "",
        "icon": "trophy",
        "color": "gold",
        "hidden": False,
        "enabled": True,
        "sort_order": 0,
        "definition": [{"scope": "global", "metric": "any_score", "comparator": ">=", "value": 1}],
    }
    document.update(fields)
    return document


def json_member(
    achievement_id: str, document: dict[str, Any]
) -> tuple[tarfile.TarInfo, bytes | None]:
    return file_member(f"{achievement_id}/{ACHIEVEMENT_FILE}", json.dumps(document).encode("utf-8"))


def members_of(data: bytes) -> dict[str, bytes]:
    """Everything in an archive this test wrote itself — safe to unpack, and only ever in
    memory."""
    found: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for member in tar:
            extracted = tar.extractfile(member)
            assert extracted is not None
            found[member.name] = extracted.read()
    return found


def edited(data: bytes, achievement_id: str, **changes: Any) -> bytes:
    """An export, opened in a text editor and packed again — what the format exists for."""
    members = []
    for name, content in members_of(data).items():
        if name == f"{achievement_id}/{ACHIEVEMENT_FILE}":
            document = json.loads(content)
            document.update(changes)
            content = json.dumps(document, indent=2).encode("utf-8")
        members.append(file_member(name, content))
    return tar_gz(members)


async def export(client: AsyncClient, ids: list[str]) -> bytes:
    response = await client.post(EXPORT, json={"ids": ids})
    assert response.status_code == 200, response.text
    return response.content


async def upload(client: AsyncClient, data: bytes) -> Any:
    return await client.post(
        IMPORT, files={"file": ("achievements.tar.gz", data, "application/gzip")}
    )


async def catalogue(client: AsyncClient) -> list[dict[str, Any]]:
    """The managing copy — `manage=true`, behind `achievements.manage`. What an import stored
    is read the way the achievements page reads it: every row whole, definition included.
    Without it a hidden achievement comes back blank and a definition comes back `None`, for
    a manager as much as for anybody (`achievements/api.py`)."""
    response = await client.get("/api/v1/achievements", params={"manage": "true"})
    assert response.status_code == 200, response.text
    rows: list[dict[str, Any]] = response.json()["achievements"]
    return rows


def files_under(directory: Path) -> set[Path]:
    return {path for path in directory.rglob("*") if path.is_file()}


def stored_icons(icons_dir: Path) -> dict[str, bytes]:
    """Every picture in the icons directory, by file name. Sync on purpose: ruff's ASYNC
    rules ban pathlib calls inside async functions."""
    if not icons_dir.is_dir():
        return {}
    return {path.name: path.read_bytes() for path in icons_dir.rglob("*") if path.is_file()}


async def stored_rows(instance: Instance, ids: list[str]) -> dict[str, dict[str, Any]]:
    """Every column of the named rows, the raw `definition` among them.

    The catalogue answer parses the definition back through the condition models, so two rows
    holding different JSON read as equal there. A round trip is only a fixed point if what is
    *stored* comes back too.
    """
    async with instance.app.state.session_factory() as session:
        rows = await session.scalars(select(Achievement).where(Achievement.id.in_(ids)))
        return {
            row.id: {column.name: getattr(row, column.name) for column in COLUMNS} for row in rows
        }


COLUMNS = list(Achievement.__table__.columns)

# One achievement with every optional field an achievement has, all set at once: a score
# filter with both ends, an explicit list of songs, a selector with a clause of each kind of
# field, and both flags away from their defaults. The round trip has to survive all of it,
# not only the shapes the built-ins happen to use.
MAXIMAL: dict[str, Any] = {
    "name": "Everything At Once",
    "description": "Every field there is, set at the same time.",
    "icon": "trophy",
    "color": "gold",
    "hidden": True,
    "enabled": False,
    "definition": [
        {
            "scope": "session",
            "metric": "number_of_scores",
            "comparator": ">=",
            "value": 3,
            "score_filter": {"min": 1000, "max": 9000},
            "songs": {"ids": ["song-a", "song-b"]},
        },
        {
            "scope": "global",
            "metric": "different_songs",
            "comparator": "<=",
            "value": 5,
            "match": {
                "combine": "any",
                "clauses": [
                    {"field": "artist", "op": "contains", "value": "Queen"},
                    {"field": "is_duet", "op": "equals", "value": True},
                    {"field": "year", "op": ">=", "value": 1990},
                ],
            },
        },
    ],
}


class Zeros(io.RawIOBase):
    """A stream of zeros nobody ever holds: a bomb has to be built without building what it
    unpacks to, or the test is the thing that runs out of memory."""

    def __init__(self, size: int) -> None:
        self._left = size

    def readable(self) -> bool:
        return True

    def readinto(self, buffer: Any) -> int:
        count = min(len(buffer), self._left)
        self._left -= count
        buffer[:count] = bytes(count)
        return count


def bomb(members: int, size: int) -> bytes:
    """An archive of `members` icons of `size` zeros apiece — a few hundred kilobytes on the
    wire and hundreds of megabytes once unpacked."""
    buffer = io.BytesIO()
    with (
        gzip.GzipFile(fileobj=buffer, mode="wb", compresslevel=1, mtime=0) as gz,
        tarfile.open(fileobj=gz, mode="w|") as tar,
    ):
        for index in range(members):
            info = tarfile.TarInfo(f"one-{index:03d}/icon.png")
            info.size = size
            tar.addfile(info, io.BufferedReader(Zeros(size)))
    return buffer.getvalue()


# --- writing ----------------------------------------------------------------------------


def test_the_archive_is_a_directory_per_achievement() -> None:
    data = build_archive([entry("one"), entry("two", icon_image=ArchiveImage(".png", PNG))])

    assert sorted(members_of(data)) == [
        f"one/{ACHIEVEMENT_FILE}",
        f"two/{ACHIEVEMENT_FILE}",
        "two/icon.png",
    ]


def test_the_json_is_one_a_person_can_read_and_edit() -> None:
    data = build_archive([entry("one", name="Gölden Voice")])

    text = members_of(data)[f"one/{ACHIEVEMENT_FILE}"].decode("utf-8")

    # Indented, non-ASCII left alone, and a trailing newline — this is a text file.
    assert text.startswith('{\n  "id": "one",\n')
    assert "Gölden Voice" in text
    assert text.endswith("}\n")
    # The field order is the one the document describes, and `built_in` is not among them.
    assert list(json.loads(text)) == [
        "id",
        "name",
        "description",
        "icon",
        "color",
        "hidden",
        "enabled",
        "sort_order",
        "definition",
    ]


def test_the_same_achievements_give_the_same_bytes() -> None:
    """Deterministic, so two exports are diffable and a change in one is a change worth
    looking at. A tar that stamped the clock into every header would differ from itself."""
    entries = [entry("two"), entry("one", icon_image=ArchiveImage(".png", PNG))]

    assert build_archive(entries) == build_archive(entries)
    # And the order the caller happened to hand them over in makes no difference.
    assert build_archive(entries) == build_archive(list(reversed(entries)))


# --- reading: the round trip ------------------------------------------------------------


async def test_the_seventeen_built_ins_round_trip_unchanged(instance: Instance) -> None:
    before = await catalogue(instance.client)
    data = await export(instance.client, BUILT_IN_IDS)

    response = await upload(instance.client, data)

    assert response.status_code == 200, response.text
    assert response.json() == {"created": [], "updated": sorted(BUILT_IN_IDS)}
    assert await catalogue(instance.client) == before


async def test_the_built_ins_come_back_column_for_column(instance: Instance) -> None:
    """The catalogue answer re-parses every definition, so comparing it cannot see the stored
    JSON drift. This compares the rows themselves, and then exports again: a format that is
    not a fixed point turns a shared catalogue into a diff on every hand-over."""
    before = await stored_rows(instance, BUILT_IN_IDS)
    data = await export(instance.client, BUILT_IN_IDS)

    assert (await upload(instance.client, data)).status_code == 200

    assert await stored_rows(instance, BUILT_IN_IDS) == before
    assert await export(instance.client, BUILT_IN_IDS) == data


async def test_an_achievement_with_every_field_set_comes_back_column_for_column(
    instance: Instance,
) -> None:
    created = await instance.client.post("/api/v1/achievements", json=MAXIMAL)
    assert created.status_code == 201, created.text
    achievement_id = created.json()["id"]
    stored = await instance.client.put(
        f"/api/v1/achievements/{achievement_id}/icon",
        files={"file": ("icon.png", PNG, "image/png")},
    )
    assert stored.status_code == 200, stored.text
    before = await stored_rows(instance, [achievement_id])
    data = await export(instance.client, [achievement_id])

    # Everything the archive has to put back, taken away first — including the picture, so
    # the import is what restores it and not the file that happened to still be lying there.
    wrecked = await instance.client.patch(
        f"/api/v1/achievements/{achievement_id}",
        json={
            "name": "Wrecked",
            "color": "neutral",
            "icon": None,
            "hidden": False,
            "enabled": True,
            "definition": [],
        },
    )
    assert wrecked.status_code == 200, wrecked.text
    assert (
        await instance.client.delete(f"/api/v1/achievements/{achievement_id}/icon")
    ).status_code == 200

    assert (await upload(instance.client, data)).status_code == 200

    assert await stored_rows(instance, [achievement_id]) == before
    assert stored_icons(instance.icons) == {f"{achievement_id}.png": PNG}
    assert await export(instance.client, [achievement_id]) == data


async def test_an_edit_to_the_json_is_what_the_import_stores(instance: Instance) -> None:
    data = await export(instance.client, ["builtin-score-9000"])

    response = await upload(
        instance.client,
        edited(
            data,
            "builtin-score-9000",
            name="Golden Larynx",
            definition=[
                {"scope": "global", "metric": "any_score", "comparator": ">=", "value": 9800}
            ],
        ),
    )

    assert response.status_code == 200, response.text
    row = next(one for one in await catalogue(instance.client) if one["id"] == "builtin-score-9000")
    assert row["name"] == "Golden Larynx"
    assert row["definition"][0]["value"] == 9800
    # Still one of the shipped set: the flag is the row's, never the archive's.
    assert row["built_in"] is True


async def test_an_unknown_id_in_the_archive_is_created(instance: Instance) -> None:
    document = one_achievement("brand-new", name="Brand New")
    # A hand-written file that never said where in the list it goes.
    document.pop("sort_order")
    data = tar_gz([json_member("brand-new", document)])

    response = await upload(instance.client, data)

    assert response.status_code == 200, response.text
    assert response.json() == {"created": ["brand-new"], "updated": []}
    row = next(one for one in await catalogue(instance.client) if one["id"] == "brand-new")
    assert row["name"] == "Brand New"
    # An id Wingman does not ship is not a built-in, whatever the archive would like.
    assert row["built_in"] is False
    # And it landed at the end of the catalogue rather than on top of a built-in's place.
    assert row["sort_order"] == len(BUILT_INS)


async def test_a_definition_the_models_cannot_read_is_exported_as_it_stands(
    instance: Instance,
) -> None:
    """An export is a faithful copy of the row, so a definition somebody hand-edited into a
    shape the condition models refuse comes out as it is — which is what lets it be fixed in
    the archive. Reading is the half that validates, so importing it back unchanged is the
    refusal that names it."""
    async with instance.app.state.session_factory() as session:
        broken = await session.get(Achievement, "builtin-score-9000")
        assert broken is not None
        broken.definition = [{"metric": "vibes"}]
        await session.commit()

    data = await export(instance.client, ["builtin-score-9000"])

    document = json.loads(members_of(data)[f"builtin-score-9000/{ACHIEVEMENT_FILE}"])
    assert document["definition"] == [{"metric": "vibes"}]
    response = await upload(instance.client, data)
    assert response.status_code == 422, response.text
    assert "builtin-score-9000" in response.json()["detail"]


async def test_an_id_wingman_ships_comes_back_as_a_built_in(instance: Instance) -> None:
    """The one case where an import creates a built-in: the id itself is what says so, which
    is what lets a shipped achievement be handed from one instance to another."""
    async with instance.app.state.session_factory() as session:
        # Straight out of the table: the API refuses to delete a built-in, and this is the
        # instance that never had it rather than one that threw it away.
        await session.execute(delete(Achievement).where(Achievement.id == "builtin-score-9000"))
        await session.commit()
    data = tar_gz(
        [
            json_member(
                "builtin-score-9000", one_achievement("builtin-score-9000", name="Golden Voice")
            )
        ]
    )

    response = await upload(instance.client, data)

    assert response.status_code == 200, response.text
    assert response.json()["created"] == ["builtin-score-9000"]
    row = next(one for one in await catalogue(instance.client) if one["id"] == "builtin-score-9000")
    assert row["built_in"] is True


async def test_an_uploaded_picture_travels_with_it(instance: Instance) -> None:
    created = await instance.client.post(
        "/api/v1/achievements",
        json={"name": "Encore", "color": "gold", "definition": []},
    )
    assert created.status_code == 201, created.text
    achievement_id = created.json()["id"]
    stored = await instance.client.put(
        f"/api/v1/achievements/{achievement_id}/icon",
        files={"file": ("icon.png", PNG, "image/png")},
    )
    assert stored.status_code == 200, stored.text

    data = await export(instance.client, [achievement_id])
    assert f"{achievement_id}/icon.png" in members_of(data)

    removed = await instance.client.delete(f"/api/v1/achievements/{achievement_id}/icon")
    assert removed.json()["has_image"] is False

    response = await upload(instance.client, data)

    assert response.status_code == 200, response.text
    row = next(one for one in await catalogue(instance.client) if one["id"] == achievement_id)
    assert row["has_image"] is True
    # A picture that arrived through an archive is as new as an uploaded one, so it carries
    # the cache buster too — a client holding the old one has to be told to ask again.
    assert isinstance(row["icon_version"], int)
    assert stored_icons(instance.icons) == {f"{achievement_id}.png": PNG}


async def test_an_archive_without_a_picture_clears_the_one_that_is_there(
    instance: Instance,
) -> None:
    """The archive is the whole description of the achievement it names, so importing one
    that brought no picture is what makes importing it twice mean the same thing twice."""
    data = await export(instance.client, ["builtin-score-9000"])
    stored = await instance.client.put(
        "/api/v1/achievements/builtin-score-9000/icon",
        files={"file": ("icon.png", PNG, "image/png")},
    )
    assert stored.status_code == 200, stored.text

    response = await upload(instance.client, data)

    assert response.status_code == 200, response.text
    row = next(one for one in await catalogue(instance.client) if one["id"] == "builtin-score-9000")
    assert row["has_image"] is False
    assert row["icon_version"] is None
    assert stored_icons(instance.icons) == {}


# --- reading: what a stranger's archive is refused for ------------------------------------


@pytest.mark.parametrize(
    ("name", "members"),
    [
        # A traversal, in the three shapes a tar writes one.
        ("a parent segment", [file_member(f"../{ACHIEVEMENT_FILE}", b"{}")]),
        ("a traversal deeper in", [file_member(f"one/../../{ACHIEVEMENT_FILE}", b"{}")]),
        ("an absolute path", [file_member(f"/etc/{ACHIEVEMENT_FILE}", b"{}")]),
        ("a windows drive", [file_member(f"C:/wingman/{ACHIEVEMENT_FILE}", b"{}")]),
        ("a backslash", [file_member(f"one\\{ACHIEVEMENT_FILE}", b"{}")]),
        # Anything that is not a plain file in a plain directory.
        ("a symlink", [link_member(f"one/{ACHIEVEMENT_FILE}", "/etc/passwd", tarfile.SYMTYPE)]),
        ("a hardlink", [link_member(f"one/{ACHIEVEMENT_FILE}", "wingman.db", tarfile.LNKTYPE)]),
        ("a fifo", [link_member(f"one/{ACHIEVEMENT_FILE}", "", tarfile.FIFOTYPE)]),
        # The shape of the format itself.
        ("a file at the top level", [file_member(ACHIEVEMENT_FILE, b"{}")]),
        ("a file too deep", [file_member(f"one/two/{ACHIEVEMENT_FILE}", b"{}")]),
        ("a file this format has no name for", [file_member("one/notes.txt", b"hello")]),
        ("an icon that is not an image", [file_member("one/icon.exe", b"MZ")]),
        (
            "the same achievement twice",
            [
                json_member("one", one_achievement("one")),
                json_member("one", one_achievement("one")),
            ],
        ),
    ],
)
def test_a_member_this_format_does_not_allow_is_refused(
    name: str, members: list[tuple[tarfile.TarInfo, bytes | None]]
) -> None:
    with pytest.raises(ArchiveMemberError) as refused:
        archive.read_archive(tar_gz(members))

    # The message names the member, so somebody with a text editor knows what to fix.
    assert str(refused.value), name


def test_a_directory_member_is_allowed_because_other_tar_writers_emit_one() -> None:
    directory = tarfile.TarInfo("one")
    directory.type = tarfile.DIRTYPE

    parsed = archive.read_archive(
        tar_gz([(directory, None), json_member("one", one_achievement("one"))])
    )

    assert [one.achievement.id for one in parsed] == ["one"]


@pytest.mark.parametrize(
    ("problem", "document"),
    [
        ("no name at all", {"id": "one", "definition": []}),
        ("a name that is empty", one_achievement("one", name="")),
        ("a colour that is not one of the four", one_achievement("one", color="chartreuse")),
        ("an icon that is not a glyph name", one_achievement("one", icon="../../etc/passwd")),
        ("a definition that is not a list", one_achievement("one", definition={})),
        (
            "a metric the engine has no such thing as",
            one_achievement(
                "one", definition=[{"metric": "vibes", "comparator": ">=", "value": 1}]
            ),
        ),
        (
            "a score filter no score could survive",
            one_achievement(
                "one",
                definition=[
                    {
                        "metric": "any_score",
                        "comparator": ">=",
                        "value": 1,
                        "score_filter": {"min": 9000, "max": 100},
                    }
                ],
            ),
        ),
        # `built_in` is deliberately not a field: an imported achievement is one of the
        # shipped set only if its id says so.
        ("a built_in flag", one_achievement("one", built_in=True)),
        ("a key nobody spelled right", one_achievement("one", colour="gold")),
        ("an id that is not the directory it is in", one_achievement("somewhere-else")),
        ("an id that is not a safe file name", one_achievement("../evil")),
    ],
)
def test_an_achievement_file_the_models_refuse_is_refused(
    problem: str, document: dict[str, Any]
) -> None:
    with pytest.raises(archive.AchievementFileError) as refused:
        archive.read_archive(tar_gz([json_member("one", document)]))

    # It names the file it was about, which is the whole point of a directory per achievement.
    assert f"one/{ACHIEVEMENT_FILE}" in str(refused.value), problem


@pytest.mark.parametrize(
    "hostile",
    [
        "dot.dot",
        "Uppercase",
        "with space",
        "-leading-dash",
        "x" * 65,
        # Windows resolves these to devices in every directory and under any extension, so
        # `con.png` in the icons directory is the console rather than a file.
        "con",
        "nul",
        "com1",
        "lpt9",
    ],
)
def test_an_id_that_is_not_a_plain_file_name_is_refused(hostile: str) -> None:
    """The id is the stem of the icon file `images.store_image` writes, which makes it the
    one field of the archive that becomes a path on this machine.

    Every name here is one the *member* rules would happily let through — each is a legal
    two-segment member name and the directory is the id, so nothing but the id's own rules
    can be what refuses it.
    """
    with pytest.raises(archive.AchievementFileError):
        archive.read_archive(tar_gz([json_member(hostile, one_achievement(hostile))]))


async def test_an_accepted_id_can_only_ever_name_a_file_in_the_icons_directory(
    instance: Instance,
) -> None:
    """The other half of the rule above: what an id *is* allowed to be lands where it is
    served from and nowhere else, whatever the archive would like it to be."""
    document = one_achievement("a-perfectly-ordinary-id")
    data = tar_gz(
        [
            json_member("a-perfectly-ordinary-id", document),
            file_member("a-perfectly-ordinary-id/icon.png", PNG),
        ]
    )

    assert (await upload(instance.client, data)).status_code == 200, "the archive is a valid one"

    assert files_under(instance.icons) == {instance.icons / "a-perfectly-ordinary-id.png"}


@pytest.mark.parametrize(
    ("problem", "content"),
    [
        ("not JSON at all", b"name: Golden Voice\n"),
        ("truncated JSON", b'{"id": "one",'),
        ("a JSON list", b"[]"),
        ("not even UTF-8", b'{"id": "\xff\xfe"}'),
    ],
)
def test_an_achievement_file_that_is_not_a_json_object_is_refused(
    problem: str, content: bytes
) -> None:
    with pytest.raises(archive.AchievementFileError):
        archive.read_archive(tar_gz([file_member(f"one/{ACHIEVEMENT_FILE}", content)]))


def test_a_file_a_windows_editor_saved_with_a_bom_still_reads() -> None:
    """Notepad puts one in front of what it saves, and this format exists to be hand-edited."""
    content = b"\xef\xbb\xbf" + json.dumps(one_achievement("one")).encode("utf-8")

    parsed = archive.read_archive(tar_gz([file_member(f"one/{ACHIEVEMENT_FILE}", content)]))

    assert [one.achievement.id for one in parsed] == ["one"]


def test_a_directory_without_an_achievement_file_is_refused() -> None:
    with pytest.raises(archive.AchievementFileError):
        archive.read_archive(tar_gz([file_member("one/icon.png", PNG)]))


def test_an_archive_holding_no_achievement_at_all_is_refused() -> None:
    with pytest.raises(archive.EmptyArchiveError):
        archive.read_archive(tar_gz([]))


@pytest.mark.parametrize(
    ("problem", "data"),
    [
        ("not a file we know", b"this is not an archive"),
        ("gzip holding something else", gzip.compress(b"not a tar at all")),
        ("a truncated archive", build_archive([entry("one")])[:40]),
    ],
)
def test_something_that_is_not_a_tar_gz_is_refused(problem: str, data: bytes) -> None:
    with pytest.raises(archive.MalformedArchiveError):
        archive.read_archive(data)


def test_the_upload_itself_is_capped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(archive, "MAX_ARCHIVE_BYTES", 128)

    with pytest.raises(ArchiveTooLargeError):
        archive.read_archive(build_archive([entry("one")]) + b"\x00" * 128)


def test_a_gzip_bomb_is_stopped_while_it_unpacks(monkeypatch: pytest.MonkeyPatch) -> None:
    """A few kilobytes on the wire and megabytes in memory. The cap is counted inside the
    read, so the bomb never finishes unpacking — a limit checked afterwards is not a limit."""
    monkeypatch.setattr(archive, "MAX_UNCOMPRESSED_BYTES", 64 * 1024)
    bomb = tar_gz([file_member("one/icon.png", b"\x00" * (4 * 1024 * 1024))])
    # It really is a bomb: four megabytes of member behind a few kilobytes of upload.
    assert len(bomb) < 32 * 1024

    with pytest.raises(ArchiveTooLargeError):
        archive.read_archive(bomb)


def test_a_bomb_is_refused_having_allocated_the_cap_and_not_the_archive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """What makes this a cap rather than a check is *where* it is counted. A hundred
    megabytes of member behind half a megabyte of upload has to be refused without the
    hundred megabytes ever existing — which is the one thing an assertion on the exception
    alone cannot tell you."""
    monkeypatch.setattr(archive, "MAX_UNCOMPRESSED_BYTES", 1024 * 1024)
    data = bomb(20, 5 * 1024 * 1024)
    assert len(data) < 1024 * 1024, "a bomb is small on the wire, which is the whole trick"

    tracemalloc.start()
    try:
        with pytest.raises(ArchiveTooLargeError):
            archive.read_archive(data)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()

    # Well under the hundred megabytes it holds: the reader stopped inside the unpacking.
    assert peak < 16 * 1024 * 1024


def test_one_member_may_not_be_larger_than_its_cap() -> None:
    oversized = json.dumps(one_achievement("one", description="x")).encode() + b" " * (
        archive.MAX_JSON_BYTES
    )

    with pytest.raises(ArchiveMemberError) as refused:
        archive.read_archive(tar_gz([file_member(f"one/{ACHIEVEMENT_FILE}", oversized)]))

    assert "larger than" in str(refused.value)


def test_an_archive_may_not_hold_more_members_than_the_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(archive, "MAX_MEMBERS", 3)
    many = [json_member(f"one-{index}", one_achievement(f"one-{index}")) for index in range(5)]

    with pytest.raises(ArchiveMemberError) as refused:
        archive.read_archive(tar_gz(many))

    assert "more than" in str(refused.value)


# --- the routes ---------------------------------------------------------------------------


async def test_an_export_naming_an_id_the_catalogue_does_not_hold_is_a_404(
    instance: Instance,
) -> None:
    response = await instance.client.post(EXPORT, json={"ids": ["builtin-score-9000", "nope"]})

    assert response.status_code == 404
    assert "nope" in response.json()["detail"]


async def test_an_export_has_to_name_at_least_one(instance: Instance) -> None:
    assert (await instance.client.post(EXPORT, json={"ids": []})).status_code == 422


async def test_the_export_is_answered_as_a_file_to_save(instance: Instance) -> None:
    response = await instance.client.post(EXPORT, json={"ids": ["builtin-score-9000"]})

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/gzip"
    assert "attachment; filename=" in response.headers["content-disposition"]
    assert response.headers["content-disposition"].endswith('.tar.gz"')


@pytest.mark.parametrize(
    ("problem", "expected", "members"),
    [
        ("a traversal", 422, [file_member(f"../{ACHIEVEMENT_FILE}", b"{}")]),
        (
            "a symlink",
            422,
            [link_member(f"one/{ACHIEVEMENT_FILE}", "/etc/passwd", tarfile.SYMTYPE)],
        ),
        ("nothing in it", 422, []),
        ("a broken definition", 422, [json_member("one", one_achievement("one", definition=[{}]))]),
    ],
)
async def test_a_hostile_archive_is_a_clean_4xx_naming_the_problem(
    instance: Instance, problem: str, expected: int, members: list[tuple[tarfile.TarInfo, Any]]
) -> None:
    response = await upload(instance.client, tar_gz(members))

    assert response.status_code == expected, response.text
    # A sentence, not a stack trace: whoever exported this has to know what to fix.
    assert isinstance(response.json()["detail"], str)
    assert response.json()["detail"]


async def test_an_upload_that_is_not_an_archive_at_all_is_a_422(instance: Instance) -> None:
    response = await upload(instance.client, b"definitely not a tar.gz")

    assert response.status_code == 422
    assert "tar.gz" in response.json()["detail"]


async def test_an_upload_past_the_cap_is_a_413(
    instance: Instance, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(archive, "MAX_ARCHIVE_BYTES", 128)

    response = await upload(instance.client, build_archive([entry("one")]) + b"\x00" * 256)

    assert response.status_code == 413, response.text


async def test_an_archive_that_unpacks_past_the_cap_is_a_413_through_the_route(
    instance: Instance, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The upload cap is the one the route itself applies; this one lives in the reader, and
    a bomb is exactly the archive that sails past the first and has to meet the second."""
    monkeypatch.setattr(archive, "MAX_UNCOMPRESSED_BYTES", 1024 * 1024)

    response = await upload(instance.client, bomb(4, 1024 * 1024))

    assert response.status_code == 413, response.text
    assert isinstance(response.json()["detail"], str)


async def test_an_import_that_cannot_write_a_picture_leaves_every_picture_alone(
    instance: Instance, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A full disk on the last achievement of an archive.

    Icons cannot join the transaction, so the order matters: nothing that is being served is
    touched until the commit has gone through. The archive below *clears* two pictures and
    replaces a third — so an import that wrote as it went would have deleted the first two
    before finding out it could not finish, and then answered that nothing had happened.
    """
    ids = ["aaa-one", "bbb-two", "ccc-three"]
    setup = tar_gz([json_member(one, one_achievement(one)) for one in ids])
    assert (await upload(instance.client, setup)).status_code == 200
    for one in ids:
        stored = await instance.client.put(
            f"/api/v1/achievements/{one}/icon", files={"file": ("icon.png", PNG, "image/png")}
        )
        assert stored.status_code == 200, stored.text
    # Two entries with no picture at all and one with a new one, so the import has both a
    # removal and a write to do.
    data = tar_gz(
        [json_member(one, one_achievement(one, name="Renamed")) for one in ids]
        + [file_member("ccc-three/icon.jpg", JPEG)]
    )
    before_icons = stored_icons(instance.icons)
    before_rows = await stored_rows(instance, ids)

    async def full_disk(*args: Any, **fields: Any) -> Path:
        raise OSError("no space left on device")

    monkeypatch.setattr(service, "store_image", full_disk)

    with pytest.raises(OSError, match="no space left on device"):
        await upload(instance.client, data)

    assert stored_icons(instance.icons) == before_icons
    assert await stored_rows(instance, ids) == before_rows


async def test_an_import_leaves_nothing_behind_beside_the_icons(instance: Instance) -> None:
    """Pictures are staged before the commit and moved in after it, so the staging has to be
    gone by the time the request is answered — on the way out of a failure too."""
    data = tar_gz(
        [json_member("with-a-picture", one_achievement("with-a-picture"))]
        + [file_member("with-a-picture/icon.png", PNG)]
    )

    assert (await upload(instance.client, data)).status_code == 200
    assert (await upload(instance.client, b"not an archive at all")).status_code == 422

    assert files_under(instance.icons) == {instance.icons / "with-a-picture.png"}


async def test_a_hostile_archive_writes_nothing_anywhere(instance: Instance) -> None:
    """The one assertion the whole defensive half exists for: whatever a member is called,
    no file appears outside `achievement_icons` — and for a refused archive, not even there.
    """
    before = files_under(instance.data_dir)
    hostile = [
        tar_gz([file_member(f"../../{ACHIEVEMENT_FILE}", b"{}")]),
        tar_gz([file_member(f"/tmp/{ACHIEVEMENT_FILE}", b"{}")]),
        tar_gz([link_member("one/icon.png", "../../wingman.db", tarfile.SYMTYPE)]),
        tar_gz([file_member(f"one/../../{ACHIEVEMENT_FILE}", b"{}")]),
        tar_gz([json_member("one", one_achievement("../../evil"))]),
    ]

    for data in hostile:
        response = await upload(instance.client, data)
        assert response.status_code == 422, response.text

    assert files_under(instance.data_dir) == before


async def test_an_import_broadcasts_the_catalogue_changed(
    instance: Instance, broadcast_events: list[dict[str, object]]
) -> None:
    data = tar_gz([json_member("brand-new", one_achievement("brand-new"))])

    assert (await upload(instance.client, data)).status_code == 200

    assert {"event": "achievements.changed"} in broadcast_events


async def test_an_import_broadcasts_it_once_for_the_whole_archive(
    instance: Instance, broadcast_events: list[dict[str, object]]
) -> None:
    """One refetch per import and not one per row: every client reloads the catalogue on the
    event, and a seventeen-achievement archive would be sixteen wasted round trips."""
    data = tar_gz(
        [json_member(f"new-{index}", one_achievement(f"new-{index}")) for index in range(4)]
    )

    assert (await upload(instance.client, data)).status_code == 200

    assert [one for one in broadcast_events if one["event"] == "achievements.changed"] == [
        {"event": "achievements.changed"}
    ]


async def test_a_refused_import_broadcasts_nothing(
    instance: Instance, broadcast_events: list[dict[str, object]]
) -> None:
    assert (await upload(instance.client, b"not an archive")).status_code == 422

    assert broadcast_events == []
