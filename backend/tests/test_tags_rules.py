"""Automatic tags: a tag that carries a rule, and the scanner that keeps it honest.

Two halves. The first is the registry — what each rule matches, how it treats case,
whitespace and a field nobody filled in, and what it offers the editor as suggestions. The
second is the lifecycle over the real API and a real library on disk: setting a rule,
changing it, taking it off, and what a rescan does when a `.txt` is edited underneath.

The invariant behind all of it: a tag is either manual or automatic. An automatic tag's
`song_tags` rows are derived, so nobody may add or remove one by hand (409), and setting a
rule on a tag people had been using replaces what they put there.
"""

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from conftest import BASE_URL, add_session, add_user, admin_client, authenticate_admin
from test_song_scanner import configure, make_song_dir
from test_songs_api import make_song
from ultrastar_wingman.app import create_app
from ultrastar_wingman.auth.deps import COOKIE_NAME
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.songs import scanner
from ultrastar_wingman.songs.model import Song
from ultrastar_wingman.songs.scanner import scan_library
from ultrastar_wingman.tags import rules, service
from ultrastar_wingman.tags.model import MAX_RULE_VALUE_LENGTH, SongTag, Tag

# The duet headers, as a `make_song_dir` tag block.
DUET_HEADERS = "#DUETSINGERP1:Her\n#DUETSINGERP2:Him\n"


def factory(app: FastAPI) -> async_sessionmaker[AsyncSession]:
    session_factory: async_sessionmaker[AsyncSession] = app.state.session_factory
    return session_factory


def _client(app: FastAPI, token: str | None = None) -> AsyncClient:
    cookies = {} if token is None else {COOKIE_NAME: token}
    return AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL, cookies=cookies)


@pytest.fixture
async def app(bootstrap_settings: BootstrapSettings) -> AsyncIterator[FastAPI]:
    """One app, its startup scan stopped: every test here scans on purpose, and a scan
    still running in the background would reconcile against a library that is not there
    yet."""
    application = create_app(bootstrap_settings)
    async with application.router.lifespan_context(application):
        await scanner.stop_scan()
        yield application


@pytest.fixture
async def admin(app: FastAPI) -> AsyncIterator[AsyncClient]:
    await authenticate_admin(app)
    async with admin_client(app) as client:
        yield client


@pytest.fixture
async def plain_user(app: FastAPI) -> AsyncIterator[AsyncClient]:
    """An ordinary account: it may see songs, and it holds nothing on any tag."""
    user_id = await add_user(factory(app), "listener", "user")
    await add_session(factory(app), "listener-token", user_id)
    async with _client(app, "listener-token") as client:
        yield client


@pytest.fixture
async def library(app: FastAPI, tmp_path: Path) -> Path:
    """A small library on disk, scanned in: a duet with a video, two solos in two
    languages — one of them spelled sloppily — and a song with no metadata at all."""
    root = tmp_path / "songs"
    make_song_dir(
        root,
        "duet",
        title="Summer Nights",
        artist="Grease",
        tags=f"{DUET_HEADERS}#LANGUAGE:English\n#GENRE:Pop\n#EDITION:Party Classics\n"
        "#VIDEO:clip.mp4\n",
        files=("clip.mp4",),
    )
    # " english " is the same language as "English", however this library writes it.
    make_song_dir(
        root, "solo-en", title="Yesterday", artist="Beatles", tags="#LANGUAGE: english \n"
    )
    make_song_dir(root, "solo-de", title="99 Luftballons", artist="Nena", tags="#LANGUAGE:German\n")
    make_song_dir(root, "unlabelled", title="Untitled", artist="Nobody")
    async with factory(app)() as session:
        await configure(session, root)
    await scan_library(factory(app))
    return root


async def song_ids(client: AsyncClient) -> list[str]:
    response = await client.get("/api/v1/songs")
    assert response.status_code == 200, response.text
    return [song["id"] for song in response.json()["songs"]]


async def song_id_of(client: AsyncClient, title: str) -> str:
    response = await client.get("/api/v1/songs")
    assert response.status_code == 200, response.text
    return next(song["id"] for song in response.json()["songs"] if song["title"] == title)


async def make_tag(client: AsyncClient, **body: Any) -> dict[str, Any]:
    payload = {"name": "automatic", "color": "blue", **body}
    response = await client.post("/api/v1/tags", json=payload)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


async def patch_tag(client: AsyncClient, tag_id: str, expect: int = 200, **body: Any) -> Any:
    response = await client.patch(f"/api/v1/tags/{tag_id}", json=body)
    assert response.status_code == expect, response.text
    return response.json()


async def carried_songs(client: AsyncClient, tag_id: str) -> list[str]:
    """The titles under one tag, so an assertion reads like the library does."""
    response = await client.get("/api/v1/tags/assignments")
    assert response.status_code == 200, response.text
    ids = next(row["song_ids"] for row in response.json()["assignments"] if row["tag_id"] == tag_id)
    songs = await client.get("/api/v1/songs")
    titles = {song["id"]: song["title"] for song in songs.json()["songs"]}
    return sorted(titles[song_id] for song_id in ids)


# --- the registry ------------------------------------------------------------------


def test_every_rule_is_registered_under_its_own_kind() -> None:
    assert list(rules.RULES) == ["duet", "has_video", "language", "genre", "edition"]
    assert all(kind == rule.kind for kind, rule in rules.RULES.items())
    assert [rule.needs_value for rule in rules.all_rules()] == [False, False, True, True, True]


def test_an_unknown_kind_is_refused() -> None:
    with pytest.raises(rules.UnknownRuleKindError):
        rules.get("year_between")


def test_a_flag_rule_takes_no_value_and_a_value_rule_needs_one() -> None:
    assert rules.get("duet").normalized(None) is None
    # An empty string is not somebody sending a value, it is an empty field.
    assert rules.get("has_video").normalized("  ") is None
    with pytest.raises(rules.RuleValueError):
        rules.get("duet").normalized("English")
    with pytest.raises(rules.RuleValueError):
        rules.get("language").normalized(None)
    with pytest.raises(rules.RuleValueError):
        rules.get("language").normalized("   ")


def test_a_value_is_stored_trimmed() -> None:
    assert rules.get("genre").normalized("  Pop  ") == "Pop"


async def test_a_value_rule_ignores_case_and_whitespace_and_never_matches_a_null(
    session: AsyncSession,
) -> None:
    session.add_all(
        [
            make_song("local:a", "Artist", "Loud", language="English"),
            make_song("local:b", "Artist", "Louder", language=" english "),
            make_song("local:c", "Artist", "Quiet", language="German"),
            make_song("local:d", "Artist", "Silent", language=None),
        ]
    )
    await session.commit()

    condition = rules.get("language").condition(" ENGLISH ")

    matched = set(await session.scalars(select(Song.id).where(condition)))

    # "Silent" has no language at all, and a song in no language is in no language rule.
    assert matched == {"local:a", "local:b"}


async def test_the_flag_rules_read_the_songs_own_columns(session: AsyncSession) -> None:
    session.add_all(
        [
            make_song("local:a", "Artist", "Duet", is_duet=True),
            make_song("local:b", "Artist", "Solo", is_duet=False),
            make_song("local:c", "Artist", "Clip", video_file="/library/local_c/clip.mp4"),
        ]
    )
    await session.commit()

    duets = set(await session.scalars(select(Song.id).where(rules.get("duet").condition(None))))
    videos = set(
        await session.scalars(select(Song.id).where(rules.get("has_video").condition(None)))
    )
    assert duets == {"local:a"}
    assert videos == {"local:c"}


async def test_the_registry_listing_carries_the_librarys_values(
    admin: AsyncClient, library: Path
) -> None:
    response = await admin.get("/api/v1/tags/rules")
    assert response.status_code == 200, response.text
    listed = {rule["kind"]: rule for rule in response.json()["rules"]}

    assert list(listed) == ["duet", "has_video", "language", "genre", "edition"]
    assert listed["duet"] == {
        "kind": "duet",
        "label": "Duet",
        "needs_value": False,
        "suggestions": [],
    }
    # " english " and "English" are one suggestion, and the tidy spelling is the one kept.
    assert listed["language"]["suggestions"] == ["English", "German"]
    assert listed["language"]["needs_value"] is True
    assert listed["genre"]["suggestions"] == ["Pop"]
    assert listed["edition"]["suggestions"] == ["Party Classics"]


async def test_the_rule_listing_is_open_to_anybody_who_may_see_songs(
    admin: AsyncClient, plain_user: AsyncClient, library: Path
) -> None:
    """And it suggests the whole library's values, including a song this reader may not
    see — one of the leaks `test_tags_api.test_the_leaks_we_accept` writes down. The duet
    is the only song with a genre, and a tag nobody holds `view_songs` on hides it."""
    await make_tag(admin, name="duets", rule={"kind": "duet"})
    visible = (await plain_user.get("/api/v1/songs")).json()["songs"]
    assert all(song["title"] != "Summer Nights" for song in visible)

    response = await plain_user.get("/api/v1/tags/rules")

    assert response.status_code == 200, response.text
    listed = {rule["kind"]: rule for rule in response.json()["rules"]}
    assert listed["genre"]["suggestions"] == ["Pop"]


# --- the lifecycle -----------------------------------------------------------------


async def test_a_tag_created_with_a_rule_arrives_on_its_songs(
    admin: AsyncClient, library: Path
) -> None:
    tag = await make_tag(admin, name="duets", rule={"kind": "duet"})

    assert tag["rule"] == {"kind": "duet", "value": None}
    # The response already knows: nobody has to wait for the next scan.
    assert tag["song_count"] == 1
    assert await carried_songs(admin, tag["id"]) == ["Summer Nights"]


async def test_a_value_rule_matches_the_library_however_it_is_spelled(
    admin: AsyncClient, library: Path
) -> None:
    tag = await make_tag(admin, name="english", rule={"kind": "language", "value": " ENGLISH "})

    assert tag["rule"] == {"kind": "language", "value": "ENGLISH"}
    assert await carried_songs(admin, tag["id"]) == ["Summer Nights", "Yesterday"]


async def test_the_video_rule_follows_the_file_and_not_the_tag(
    admin: AsyncClient, library: Path
) -> None:
    tag = await make_tag(admin, name="video", rule={"kind": "has_video"})
    assert await carried_songs(admin, tag["id"]) == ["Summer Nights"]


async def test_a_rescan_follows_an_edited_txt_in_and_out(
    app: FastAPI, admin: AsyncClient, library: Path
) -> None:
    tag = await make_tag(admin, name="german", rule={"kind": "language", "value": "German"})
    assert await carried_songs(admin, tag["id"]) == ["99 Luftballons"]

    make_song_dir(
        library, "solo-en", title="Yesterday", artist="Beatles", tags="#LANGUAGE:German\n"
    )
    await scan_library(factory(app))
    assert await carried_songs(admin, tag["id"]) == ["99 Luftballons", "Yesterday"]

    make_song_dir(
        library, "solo-de", title="99 Luftballons", artist="Nena", tags="#LANGUAGE:English\n"
    )
    await scan_library(factory(app))
    assert await carried_songs(admin, tag["id"]) == ["Yesterday"]


async def test_a_song_that_leaves_the_library_takes_the_automatic_tag_with_it(
    app: FastAPI, admin: AsyncClient, library: Path
) -> None:
    """Unlike a manual tag, whose row waits for the song to come back: a derived row says
    nothing a rescan cannot say again."""
    tag = await make_tag(admin, name="duets", rule={"kind": "duet"})
    for entry in sorted((library / "duet").iterdir()):
        entry.unlink()
    (library / "duet").rmdir()

    await scan_library(factory(app))

    assert await carried_songs(admin, tag["id"]) == []
    async with factory(app)() as session:
        assert list(await session.scalars(select(SongTag.song_id))) == []


async def test_a_second_scan_changes_nothing(
    app: FastAPI, admin: AsyncClient, library: Path, broadcast_events: list[dict[str, object]]
) -> None:
    tag = await make_tag(admin, name="duets", rule={"kind": "duet"})
    await scan_library(factory(app))
    broadcast_events.clear()

    await scan_library(factory(app))

    assert [event["event"] for event in broadcast_events if event["event"] == "tags.changed"] == []
    assert await carried_songs(admin, tag["id"]) == ["Summer Nights"]


async def test_setting_a_rule_replaces_what_people_had_put_on_the_tag(
    app: FastAPI, admin: AsyncClient, library: Path
) -> None:
    tag = await make_tag(admin, name="mixed", permissions=[{"action": "assign", "role": "admin"}])
    unlabelled = await song_id_of(admin, "Untitled")
    assert (await admin.put(f"/api/v1/songs/{unlabelled}/tags/{tag['id']}")).status_code == 204
    assert await carried_songs(admin, tag["id"]) == ["Untitled"]

    # The count the editor warns with, before it sends the rule.
    listed = await admin.get("/api/v1/tags")
    before = next(row for row in listed.json()["tags"] if row["id"] == tag["id"])
    assert before["song_count"] == 1

    updated = await patch_tag(admin, tag["id"], rule={"kind": "duet"})

    assert updated["rule"] == {"kind": "duet", "value": None}
    assert await carried_songs(admin, tag["id"]) == ["Summer Nights"]
    async with factory(app)() as session:
        # Every row under the tag is the rule's now — nobody's, not even the admin's.
        rows = list(await session.scalars(select(SongTag.user_id)))
        assert rows == [None]


async def test_changing_the_rule_re_evaluates_the_tag(admin: AsyncClient, library: Path) -> None:
    tag = await make_tag(admin, name="lang", rule={"kind": "language", "value": "English"})
    assert await carried_songs(admin, tag["id"]) == ["Summer Nights", "Yesterday"]

    await patch_tag(admin, tag["id"], rule={"kind": "language", "value": "German"})

    assert await carried_songs(admin, tag["id"]) == ["99 Luftballons"]


async def test_taking_the_rule_off_takes_every_song_off(
    app: FastAPI, admin: AsyncClient, library: Path
) -> None:
    tag = await make_tag(admin, name="duets", rule={"kind": "duet"})
    assert await carried_songs(admin, tag["id"]) == ["Summer Nights"]

    updated = await patch_tag(admin, tag["id"], rule=None)

    assert updated["rule"] is None
    assert updated["song_count"] == 0
    assert await carried_songs(admin, tag["id"]) == []
    async with factory(app)() as session:
        assert list(await session.scalars(select(SongTag.song_id))) == []


async def test_a_patch_that_does_not_mention_the_rule_keeps_it(
    admin: AsyncClient, library: Path
) -> None:
    tag = await make_tag(admin, name="duets", rule={"kind": "duet"})

    updated = await patch_tag(admin, tag["id"], name="duet songs")

    assert updated["rule"] == {"kind": "duet", "value": None}
    assert await carried_songs(admin, tag["id"]) == ["Summer Nights"]


async def test_an_automatic_tag_is_nobodys_to_set(admin: AsyncClient, library: Path) -> None:
    tag = await make_tag(
        admin,
        name="duets",
        rule={"kind": "duet"},
        permissions=[{"action": "assign", "role": "admin"}],
    )
    duet = await song_id_of(admin, "Summer Nights")
    solo = await song_id_of(admin, "Yesterday")

    assigned = await admin.put(f"/api/v1/songs/{solo}/tags/{tag['id']}")
    unassigned = await admin.delete(f"/api/v1/songs/{duet}/tags/{tag['id']}")

    assert assigned.status_code == 409
    assert assigned.json()["detail"] == "tag_is_automatic"
    assert unassigned.status_code == 409
    # And the rows are exactly what the rule says, both attempts notwithstanding.
    assert await carried_songs(admin, tag["id"]) == ["Summer Nights"]


async def test_an_automatic_tag_is_listed_as_not_assignable(
    admin: AsyncClient, library: Path
) -> None:
    """What the song modal reads: an automatic tag draws as a locked row rather than a
    toggle that would 409. The permission rows behind it are untouched, so taking the rule
    off hands the tag back to the people it was granted to."""
    tag = await make_tag(
        admin,
        name="duets",
        rule={"kind": "duet"},
        permissions=[{"action": "view", "role": "user"}, {"action": "assign", "role": "user"}],
    )
    listed = await admin.get("/api/v1/tags")
    row = next(item for item in listed.json()["tags"] if item["id"] == tag["id"])
    assert row["can_view"] is True
    assert row["can_assign"] is False

    await patch_tag(admin, tag["id"], rule=None)

    listed = await admin.get("/api/v1/tags")
    row = next(item for item in listed.json()["tags"] if item["id"] == tag["id"])
    assert row["can_assign"] is True


async def test_an_automatic_tag_hides_its_songs_like_a_manual_one(
    admin: AsyncClient, plain_user: AsyncClient, library: Path
) -> None:
    """`view_songs` is the same right whoever put the tag there. Nobody is granted it here,
    so the duet leaves the plain account's library — and comes back when the rule goes."""
    tag = await make_tag(admin, name="duets", rule={"kind": "duet"})
    duet = await song_id_of(admin, "Summer Nights")

    visible = await song_ids(plain_user)
    assert duet not in visible
    assert len(visible) == 3
    assert (await plain_user.get(f"/api/v1/songs/{duet}")).status_code == 404

    await patch_tag(admin, tag["id"], rule=None)

    assert duet in await song_ids(plain_user)


async def test_a_rule_the_registry_does_not_know_is_refused(
    admin: AsyncClient, library: Path
) -> None:
    unknown = await admin.post(
        "/api/v1/tags", json={"name": "a", "color": "blue", "rule": {"kind": "year_between"}}
    )
    missing = await admin.post(
        "/api/v1/tags", json={"name": "b", "color": "blue", "rule": {"kind": "language"}}
    )
    extraneous = await admin.post(
        "/api/v1/tags",
        json={"name": "c", "color": "blue", "rule": {"kind": "duet", "value": "English"}},
    )

    assert unknown.status_code == 422
    assert missing.status_code == 422
    assert extraneous.status_code == 422
    # Nothing was written on the way to any of those.
    assert [row["name"] for row in (await admin.get("/api/v1/tags")).json()["tags"]] == ["broken"]


async def test_a_rule_value_longer_than_the_bound_is_refused(
    admin: AsyncClient, library: Path
) -> None:
    """`rule_value` is TEXT, so nothing but the request model stops a novel from being
    stored as an edition."""
    too_long = "e" * (MAX_RULE_VALUE_LENGTH + 1)

    created = await admin.post(
        "/api/v1/tags",
        json={"name": "long", "color": "blue", "rule": {"kind": "edition", "value": too_long}},
    )
    tag = await make_tag(admin, name="editions", rule={"kind": "edition", "value": "e" * 100})
    await patch_tag(admin, tag["id"], expect=422, rule={"kind": "edition", "value": too_long})

    assert created.status_code == 422
    # The bound itself is usable: a hundred characters go in and come back out.
    listed = (await admin.get("/api/v1/tags")).json()["tags"]
    stored = next(row for row in listed if row["id"] == tag["id"])
    assert stored["rule"] == {"kind": "edition", "value": "e" * 100}


async def test_a_bad_rule_on_a_patch_leaves_the_tag_as_it_was(
    admin: AsyncClient, library: Path
) -> None:
    tag = await make_tag(admin, name="duets", rule={"kind": "duet"})

    await patch_tag(admin, tag["id"], expect=422, rule={"kind": "language"})

    assert await carried_songs(admin, tag["id"]) == ["Summer Nights"]


async def test_a_rule_nobody_can_read_leaves_the_rows_alone(
    app: FastAPI, admin: AsyncClient, library: Path
) -> None:
    """A database written by a build that knew one more rule. Deriving nothing would strip
    the tag off every song it is on, which is worse than leaving it standing."""
    tag = await make_tag(admin, name="duets", rule={"kind": "duet"})
    async with factory(app)() as session:
        row = await session.get(Tag, tag["id"])
        assert row is not None
        row.rule_kind = "year_between"
        row.rule_value = "1990-1999"
        await session.commit()
        assert await service.apply_rules(session) == 0

    assert await carried_songs(admin, tag["id"]) == ["Summer Nights"]


async def test_a_reconcile_waits_for_whoever_is_rewriting_the_same_rows(
    app: FastAPI, admin: AsyncClient, library: Path
) -> None:
    """A scan and a rule change rewrite the same `song_tags` rows from two sessions, each
    reading what the tag carries before writing what it should. Interleaved, the scan
    would insert a row the change had just inserted and die on the `(tag_id, song_id)`
    primary key — so both take `_rules_lock`, and the second one in sees a finished
    answer rather than half of one."""
    tag = await make_tag(admin, name="duets", rule={"kind": "duet"})

    async with factory(app)() as session:
        await service._rules_lock.acquire()
        reconcile = asyncio.create_task(service.apply_rules(session))
        # It got as far as the lock and no further: nothing was read, nothing written.
        await asyncio.sleep(0)
        assert reconcile.done() is False
        service._rules_lock.release()
        assert await reconcile == 0

    assert await carried_songs(admin, tag["id"]) == ["Summer Nights"]


async def test_a_download_arrives_already_tagged(
    app: FastAPI, admin: AsyncClient, library: Path, tmp_path: Path
) -> None:
    """`scan_song_directory` is the path a finished download takes; the song must not have
    to wait for the next full scan to get its automatic tags."""
    tag = await make_tag(admin, name="duets", rule={"kind": "duet"})
    make_song_dir(
        library, "fresh", title="Islands In The Stream", artist="Kenny & Dolly", tags=DUET_HEADERS
    )

    async with factory(app)() as session:
        await scanner.scan_song_directory(session, library / "fresh")

    assert await carried_songs(admin, tag["id"]) == ["Islands In The Stream", "Summer Nights"]
