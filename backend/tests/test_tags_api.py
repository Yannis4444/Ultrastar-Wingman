"""Tags: who may see one, who may see the songs under it, who may set it.

The interesting half is what a *missing* `view_songs` does. It is not a filter on the song
list — it is what "this song is not there" means for that caller, everywhere: the detail,
the cover, the audio, wishing for it, favoriting it, putting it in a playlist, singing it
and its score history all answer 404, because a 403 would confirm the song exists.

Roles are bundles and not a ladder, so every grant is spelled out per role; only `admin`
(the host screen included) is exempt, the same way it is exempt from `role_permissions`.
"""

import sqlite3
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, get_args

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from conftest import BASE_URL, add_session, add_user
from test_wishlist_api import OTHER_SONG, SONG, THIRD_SONG, add_songs, factory
from ultrastar_wingman.app import create_app
from ultrastar_wingman.auth.deps import COOKIE_NAME
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.db import migrations_dir
from ultrastar_wingman.karaoke.model import KaraokeSession, Sing
from ultrastar_wingman.library.model import PlaylistEntry
from ultrastar_wingman.settings import Setting as SettingRow
from ultrastar_wingman.songs.model import Song
from ultrastar_wingman.tags.model import (
    BROKEN_TAG_ID,
    TAG_ACTIONS,
    TAG_COLORS,
    SongTag,
    TagPermission,
)
from ultrastar_wingman.tags.schema import TagAction, TagColor

# The one tag the app seeds, by name, so a test that renames it does not have to know its id.
BROKEN = "broken"

# The other tag most of these tests need: one everybody may see, whose songs are folded
# away by default and which trusted accounts may set. Nothing seeds it — the `archive`
# fixture makes it, the way the handbook tells a party to make it themselves.
ARCHIVE = "archive"
ARCHIVE_GRANTS: list[dict[str, str]] = [
    {"action": "view", "role": "guest"},
    {"action": "view", "role": "user"},
    {"action": "view", "role": "trusted"},
    {"action": "view_songs", "role": "guest"},
    {"action": "view_songs", "role": "user"},
    {"action": "view_songs", "role": "trusted"},
    {"action": "assign", "role": "trusted"},
]


@dataclass
class Party:
    """One app, one client per identity — never two lifespans, they fight over the scanner."""

    app: FastAPI
    clients: dict[str, AsyncClient]
    ids: dict[str, str]

    def __getitem__(self, identity: str) -> AsyncClient:
        return self.clients[identity]


def _client(app: FastAPI, token: str | None = None) -> AsyncClient:
    cookies = {} if token is None else {COOKIE_NAME: token}
    return AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL, cookies=cookies)


@pytest.fixture
async def party(bootstrap_settings: BootstrapSettings) -> AsyncIterator[Party]:
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await add_songs(app, SONG, OTHER_SONG, THIRD_SONG)
        clients = {"anonymous": _client(app)}
        ids: dict[str, str] = {}
        for role in ("user", "trusted", "admin"):
            ids[role] = await add_user(factory(app), f"{role}-account", role)
            await add_session(factory(app), f"{role}-token", ids[role])
            clients[role] = _client(app, f"{role}-token")
        # The host screen: an administrator by device, with no account behind it.
        await add_session(factory(app), "host-token", None, is_host=True)
        clients["host"] = _client(app, "host-token")
        try:
            yield Party(app=app, clients=clients, ids=ids)
        finally:
            for client in clients.values():
                await client.aclose()


@pytest.fixture
async def archive(party: Party) -> str:
    """A tag of the party's own making: everybody may see it and the songs under it,
    trusted accounts may set it, and `hide_by_default` folds those songs away. Wingman used
    to seed one like this; it now ships `broken` alone, and this is the shape the handbook
    describes for anybody who wants it back."""
    created = await make_tag(
        party["admin"],
        name=ARCHIVE,
        icon="archive",
        color="neutral",
        hide_by_default=True,
        permissions=ARCHIVE_GRANTS,
    )
    return str(created["id"])


async def tags_of(client: AsyncClient) -> list[dict[str, Any]]:
    response = await client.get("/api/v1/tags")
    assert response.status_code == 200, response.text
    tags: list[dict[str, Any]] = response.json()["tags"]
    return tags


async def names(client: AsyncClient) -> list[str]:
    return [tag["name"] for tag in await tags_of(client)]


async def library_ids(client: AsyncClient) -> list[str]:
    response = await client.get("/api/v1/songs")
    assert response.status_code == 200, response.text
    return [song["id"] for song in response.json()["songs"]]


async def assignments_of(client: AsyncClient) -> dict[str, list[str]]:
    response = await client.get("/api/v1/tags/assignments")
    assert response.status_code == 200, response.text
    return {row["tag_id"]: row["song_ids"] for row in response.json()["assignments"]}


async def tag_song(
    client: AsyncClient, song_id: str, tag_id: str, expect: int = 204
) -> dict[str, Any] | None:
    response = await client.put(f"/api/v1/songs/{song_id}/tags/{tag_id}")
    assert response.status_code == expect, response.text
    return None if response.status_code == 204 else dict(response.json())


async def make_tag(client: AsyncClient, **body: Any) -> dict[str, Any]:
    payload = {"name": "spicy", "color": "pink", **body}
    response = await client.post("/api/v1/tags", json=payload)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


def test_the_schema_literals_mirror_the_columns() -> None:
    """`Literal` cannot be built from a tuple, so the two are written out twice."""
    assert set(get_args(TagColor)) == set(TAG_COLORS)
    assert set(get_args(TagAction)) == set(TAG_ACTIONS)


async def test_the_seeded_tag_reaches_only_the_helpers(party: Party) -> None:
    """`broken` is the one tag the app arrives with, and it is for helpers. Its id is the
    one `tags.model` names, which is what keeps migration 0013 and the module in step."""
    assert await names(party["anonymous"]) == []
    assert await names(party["user"]) == []
    assert await names(party["trusted"]) == [BROKEN]
    assert await names(party["admin"]) == [BROKEN]
    assert await names(party["host"]) == [BROKEN]

    seeded = {tag["name"]: tag for tag in await tags_of(party["admin"])}
    assert seeded[BROKEN]["id"] == BROKEN_TAG_ID
    assert seeded[BROKEN]["show_in_list"] is True
    assert seeded[BROKEN]["hide_by_default"] is True
    assert seeded[BROKEN]["icon"] == "alert"
    assert seeded[BROKEN]["color"] == "gold"


async def test_only_a_tag_manager_is_shown_who_a_tag_is_for(party: Party, archive: str) -> None:
    """`tags.manage` is trusted and above, so a plain account sees the tag and not the
    accounts named on it."""
    plain = {tag["name"]: tag for tag in await tags_of(party["user"])}
    assert plain[ARCHIVE]["permissions"] is None
    # It may see the tag but not set it: `assign` on it is trusted's.
    assert plain[ARCHIVE]["can_assign"] is False

    managed = {tag["name"]: tag for tag in await tags_of(party["trusted"])}
    assert managed[ARCHIVE]["can_assign"] is True
    assert {(row["action"], row["role"]) for row in managed[ARCHIVE]["permissions"]} == {
        (row["action"], row["role"]) for row in ARCHIVE_GRANTS
    }
    assert all(row["user_id"] is None for row in managed[ARCHIVE]["permissions"])


async def test_a_manager_lists_a_tag_they_may_not_view(party: Party, archive: str) -> None:
    """Managing a tag is not the same right as knowing it. A manager who granted themselves
    no `view` still needs the tag on the page they manage it from — otherwise unticking
    *See tag* makes the tag disappear from under the hand that unticked it. Everybody else
    never learns that it exists."""
    secret = await make_tag(party["admin"], name="scratch")
    await tag_song(party["admin"], THIRD_SONG, secret["id"])

    listed = {tag["id"]: tag for tag in await tags_of(party["trusted"])}
    assert listed[secret["id"]]["can_view"] is False
    # A tag a manager may not view is one they may not set either.
    assert listed[secret["id"]]["can_assign"] is False
    assert listed[archive]["can_view"] is True
    assert secret["id"] not in {tag["id"] for tag in await tags_of(party["user"])}

    # The two listings hold the same tags, so the client never has assignments for a tag
    # it never heard of. The song under `scratch` is still hidden from trusted by it.
    trusted_rows = await assignments_of(party["trusted"])
    assert set(trusted_rows) == set(listed)
    assert trusted_rows[secret["id"]] == []
    assert secret["id"] not in await assignments_of(party["user"])


async def test_a_broken_song_is_gone_for_a_guest_and_a_plain_account(party: Party) -> None:
    """Every route that takes a song id has to answer as if the song were never there."""
    await tag_song(party["trusted"], SONG, BROKEN_TAG_ID)

    for identity in ("anonymous", "user"):
        client = party[identity]
        assert SONG not in await library_ids(client)
        for path in (f"/api/v1/songs/{SONG}", f"/api/v1/songs/{SONG}/cover"):
            response = await client.get(path)
            assert response.status_code == 404, f"{identity} {path}: {response.text}"
            assert response.json() == {"detail": f"unknown song '{SONG}'"}
        assert (await client.get(f"/api/v1/songs/{SONG}/audio")).status_code == 404
        assert (await client.post("/api/v1/wishlist", json={"song_id": SONG})).status_code == 404
        sing = await client.post(
            "/api/v1/karaoke/sing", json={"song_id": SONG, "slots": [{"color": "blue"}]}
        )
        assert sing.status_code == 404, sing.text
        assert sing.json() == {"detail": f"unknown song '{SONG}'"}

    # The account-only routes, with the account that may reach them.
    user = party["user"]
    assert (await user.put(f"/api/v1/favorites/{SONG}")).status_code == 404
    playlist = await user.post("/api/v1/playlists", json={"name": "Party"})
    assert playlist.status_code == 201, playlist.text
    entry = await user.post(
        f"/api/v1/playlists/{playlist.json()['id']}/entries", json={"song_id": SONG}
    )
    assert entry.status_code == 404, entry.text
    # `stats.history` is a `user` right, so this 404 is the tag and not the capability.
    assert (await user.get(f"/api/v1/stats/songs/{SONG}/scores")).status_code == 404


async def test_a_broken_song_stays_for_the_people_who_may_see_the_tag(party: Party) -> None:
    await tag_song(party["trusted"], SONG, BROKEN_TAG_ID)

    for identity in ("trusted", "admin", "host"):
        assert SONG in await library_ids(party[identity]), identity
        assert (await party[identity].get(f"/api/v1/songs/{SONG}")).status_code == 200


async def test_an_archived_song_stays_visible_to_everybody(party: Party, archive: str) -> None:
    """`hide_by_default` is a client-side default, not a permission: the backend stores the
    flag and keeps serving the song."""
    await tag_song(party["trusted"], OTHER_SONG, archive)

    for identity in ("anonymous", "user", "trusted"):
        assert OTHER_SONG in await library_ids(party[identity]), identity


async def test_a_tag_nobody_was_granted_view_songs_on_hides_its_songs(party: Party) -> None:
    """Default-deny is what makes "keep these out of the list" one new tag with no rows."""
    secret = await make_tag(party["admin"], name="scratch")
    await tag_song(party["admin"], THIRD_SONG, secret["id"])

    for identity in ("anonymous", "user", "trusted"):
        assert THIRD_SONG not in await library_ids(party[identity]), identity
    assert THIRD_SONG in await library_ids(party["admin"])
    assert THIRD_SONG in await library_ids(party["host"])


async def test_assigning_is_a_403_only_for_a_tag_the_caller_can_see(
    party: Party, archive: str
) -> None:
    """A tag they may not view is a 404, exactly like a song they may not see. Only a tag
    they already know about is a 403."""
    refused = await tag_song(party["user"], OTHER_SONG, archive, expect=403)
    assert refused == {"detail": "missing_tag_permission:assign"}
    hidden = await tag_song(party["user"], OTHER_SONG, BROKEN_TAG_ID, expect=404)
    assert hidden == {"detail": f"unknown tag '{BROKEN_TAG_ID}'"}
    assert await tag_song(party["user"], OTHER_SONG, "nope", expect=404) is not None


async def test_tagging_and_untagging_are_both_idempotent(party: Party, archive: str) -> None:
    await tag_song(party["trusted"], OTHER_SONG, archive)
    await tag_song(party["trusted"], OTHER_SONG, archive)
    assert (await assignments_of(party["trusted"]))[archive] == [OTHER_SONG]

    for _ in range(2):
        response = await party["trusted"].delete(f"/api/v1/songs/{OTHER_SONG}/tags/{archive}")
        assert response.status_code == 204, response.text
    assert (await assignments_of(party["trusted"]))[archive] == []


async def test_who_tagged_a_song_is_recorded_and_the_host_is_nobody(
    party: Party, archive: str
) -> None:
    await tag_song(party["trusted"], SONG, archive)
    await tag_song(party["host"], OTHER_SONG, archive)

    async with factory(party.app)() as session:
        rows = {
            row.song_id: row.user_id
            for row in await session.scalars(select(SongTag).where(SongTag.tag_id == archive))
        }
    assert rows == {SONG: party.ids["trusted"], OTHER_SONG: None}


async def test_replacing_the_permissions_can_name_a_single_account(
    party: Party, archive: str
) -> None:
    response = await party["admin"].put(
        f"/api/v1/tags/{archive}/permissions",
        json={
            "permissions": [
                {"action": "view", "user_id": party.ids["user"]},
                {"action": "view_songs", "role": "guest"},
                {"action": "view_songs", "role": "user"},
                {"action": "assign", "user_id": party.ids["user"]},
            ]
        },
    )

    assert response.status_code == 200, response.text
    named = [row for row in response.json()["permissions"] if row["user_id"] is not None]
    assert {row["username"] for row in named} == {"user-account"}
    # The rows that were not sent are gone: the plain account may now set the tag, and
    # trusted — which the tag had been granted to — may not even see it any more. It still
    # *lists* the tag, because trusted manages tags; `can_view` is what says the
    # difference, and the 404 below is the part with teeth.
    await tag_song(party["user"], SONG, archive)
    listed = {tag["name"]: tag for tag in await tags_of(party["trusted"])}
    assert listed[ARCHIVE]["can_view"] is False
    assert listed[BROKEN]["can_view"] is True
    assert await tag_song(party["trusted"], OTHER_SONG, archive, expect=404) is not None


async def test_a_manager_can_create_edit_and_delete_a_tag(party: Party, archive: str) -> None:
    created = await make_tag(
        party["trusted"],
        name="  Duets  ",
        icon="mic",
        color="blue",
        show_in_list=True,
        permissions=[
            {"action": "view", "role": "guest"},
            {"action": "view_songs", "role": "guest"},
        ],
    )

    assert created["name"] == "Duets"
    assert created["icon"] == "mic"
    assert created["show_in_list"] is True
    assert created["hide_by_default"] is False
    assert await names(party["anonymous"]) == [ARCHIVE, "Duets"]

    patched = await party["trusted"].patch(
        f"/api/v1/tags/{created['id']}", json={"name": "Duet", "icon": None, "color": "gold"}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["name"] == "Duet"
    assert patched.json()["icon"] is None
    assert patched.json()["color"] == "gold"
    # A PATCH that does not mention the icon keeps it.
    kept = await party["trusted"].patch(f"/api/v1/tags/{created['id']}", json={"name": "Duo"})
    assert kept.json()["icon"] is None
    assert kept.json()["show_in_list"] is True

    assert (await party["trusted"].delete(f"/api/v1/tags/{created['id']}")).status_code == 204
    assert await names(party["anonymous"]) == [ARCHIVE]


async def test_deleting_a_tag_takes_its_songs_and_its_permissions_with_it(party: Party) -> None:
    await tag_song(party["trusted"], SONG, BROKEN_TAG_ID)

    assert (await party["admin"].delete(f"/api/v1/tags/{BROKEN_TAG_ID}")).status_code == 204

    async with factory(party.app)() as session:
        assert (
            list(await session.scalars(select(SongTag).where(SongTag.tag_id == BROKEN_TAG_ID)))
            == []
        )
        assert (
            list(
                await session.scalars(
                    select(TagPermission).where(TagPermission.tag_id == BROKEN_TAG_ID)
                )
            )
            == []
        )
    # And the song it was hiding is back for everybody.
    assert SONG in await library_ids(party["anonymous"])


async def test_a_duplicate_name_is_refused_case_insensitively(party: Party, archive: str) -> None:
    response = await party["admin"].post(
        "/api/v1/tags", json={"name": "BROKEN", "color": "neutral"}
    )

    assert response.status_code == 409
    assert response.json() == {"detail": "duplicate_tag_name"}
    # And on a rename, which the unique index would otherwise turn into a 500.
    renamed = await party["admin"].patch(f"/api/v1/tags/{archive}", json={"name": "Broken"})
    assert renamed.status_code == 409
    # Renaming a tag to what it is already called is not a clash with itself.
    assert (
        await party["admin"].patch(f"/api/v1/tags/{archive}", json={"name": "Archive"})
    ).status_code == 200


async def test_a_bad_body_is_refused_before_anything_is_written(party: Party) -> None:
    bad_bodies: list[dict[str, Any]] = [
        {"name": "x", "color": "chartreuse"},
        {"name": "x", "color": "blue", "icon": "Not An Icon"},
        {"name": "", "color": "blue"},
        {"name": "x", "color": "blue", "permissions": [{"action": "view"}]},
        {
            "name": "x",
            "color": "blue",
            "permissions": [{"action": "view", "role": "g", "user_id": "u"}],
        },
        {"name": "x", "color": "blue", "permissions": [{"action": "sing", "role": "guest"}]},
    ]
    for body in bad_bodies:
        response = await party["admin"].post("/api/v1/tags", json=body)
        assert response.status_code == 422, f"{body}: {response.text}"

    for body in (
        {"name": "x", "color": "blue", "permissions": [{"action": "view", "role": "wizard"}]},
        {"name": "x", "color": "blue", "permissions": [{"action": "view", "user_id": "nobody"}]},
    ):
        response = await party["admin"].post("/api/v1/tags", json=body)
        assert response.status_code == 422, f"{body}: {response.text}"
    assert await names(party["admin"]) == [BROKEN]


async def test_the_same_row_twice_is_one_row(party: Party) -> None:
    """The unique index would make a duplicated row a 500; the service drops it instead."""
    created = await make_tag(
        party["admin"],
        permissions=[{"action": "view", "role": "guest"}, {"action": "view", "role": "guest"}],
    )

    assert created["permissions"] == [
        {"action": "view", "role": "guest", "user_id": None, "username": None}
    ]


async def test_a_tag_on_a_song_that_left_the_library_waits_for_it(
    party: Party, archive: str
) -> None:
    """`usdb:1234` coming back is the same song, so its tags come back with it."""
    await tag_song(party["trusted"], SONG, archive)
    async with factory(party.app)() as session:
        await session.execute(delete(Song).where(Song.id == SONG))
        await session.commit()

    assert (await assignments_of(party["trusted"]))[archive] == []

    await add_songs(party.app, SONG)

    assert (await assignments_of(party["trusted"]))[archive] == [SONG]


async def test_assignments_hold_only_viewable_tags_and_visible_songs(
    party: Party, archive: str
) -> None:
    await tag_song(party["trusted"], SONG, BROKEN_TAG_ID)
    await tag_song(party["trusted"], SONG, archive)
    await tag_song(party["trusted"], OTHER_SONG, archive)

    # A guest may view `archive`, but the song under it is hidden by `broken`.
    assert await assignments_of(party["anonymous"]) == {archive: [OTHER_SONG]}
    assert await assignments_of(party["trusted"]) == {
        archive: [OTHER_SONG, SONG],
        BROKEN_TAG_ID: [SONG],
    }


async def test_the_song_count_holds_the_songs_the_caller_may_not_see(
    party: Party, archive: str
) -> None:
    """`song_count` counts every song under a tag, `view_songs` or no `view_songs` — the
    tag admin's "N songs" and the delete confirmation would otherwise lie to the one
    person entitled to the truth about what they are about to take away.

    Nothing leaks: a number is not a listing. Which songs those are still comes from
    `GET /tags/assignments`, which drops every one the caller may not see — the two
    disagreeing is the point of the field.
    """
    secret = await make_tag(party["admin"], name="scratch")
    await tag_song(party["admin"], SONG, secret["id"])
    await tag_song(party["admin"], OTHER_SONG, secret["id"])

    listed = {tag["id"]: tag for tag in await tags_of(party["trusted"])}
    assert listed[secret["id"]]["can_view"] is False
    assert listed[secret["id"]]["song_count"] == 2
    assert (await assignments_of(party["trusted"]))[secret["id"]] == []

    # And the manager's own view of a tag they may see agrees with the ids they get.
    # `THIRD_SONG` because `scratch` has taken the other two away from trusted entirely.
    await tag_song(party["trusted"], THIRD_SONG, archive)
    listed = {tag["id"]: tag for tag in await tags_of(party["trusted"])}
    assert listed[archive]["song_count"] == 1
    assert (await assignments_of(party["trusted"]))[archive] == [THIRD_SONG]


async def test_the_song_count_leaves_out_a_song_that_left_the_library(
    party: Party, archive: str
) -> None:
    """The tag stays on `usdb:1234` for the day it comes back, but a song that is not in
    the library is not one of the songs the tag is on today."""
    await tag_song(party["trusted"], SONG, archive)
    await tag_song(party["trusted"], OTHER_SONG, archive)
    async with factory(party.app)() as session:
        await session.execute(delete(Song).where(Song.id == SONG))
        await session.commit()

    listed = {tag["id"]: tag for tag in await tags_of(party["admin"])}
    assert listed[archive]["song_count"] == 1

    await add_songs(party.app, SONG)

    listed = {tag["id"]: tag for tag in await tags_of(party["admin"])}
    assert listed[archive]["song_count"] == 2


async def test_a_freshly_written_tag_answers_with_its_count(party: Party) -> None:
    """Create, PATCH and the permissions PUT all return a `TagRead`, and the editor reads
    the count straight off the answer."""
    created = await make_tag(party["admin"], name="scratch")
    assert created["song_count"] == 0
    await tag_song(party["admin"], SONG, created["id"])

    patched = await party["admin"].patch(
        f"/api/v1/tags/{created['id']}", json={"name": "scratched"}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["song_count"] == 1

    granted = await party["admin"].put(
        f"/api/v1/tags/{created['id']}/permissions",
        json={"permissions": [{"action": "view", "role": "user"}]},
    )
    assert granted.status_code == 200, granted.text
    assert granted.json()["song_count"] == 1


async def test_deleting_an_account_drops_the_rows_that_named_it(party: Party, archive: str) -> None:
    user_id = party.ids["user"]
    granted = await party["admin"].put(
        f"/api/v1/tags/{archive}/permissions",
        json={"permissions": [{"action": "view", "user_id": user_id}]},
    )
    assert granted.status_code == 200, granted.text
    await tag_song(party["admin"], SONG, archive)

    assert (await party["admin"].delete(f"/api/v1/users/{user_id}")).status_code == 204

    async with factory(party.app)() as session:
        assert (
            list(
                await session.scalars(select(TagPermission).where(TagPermission.user_id == user_id))
            )
            == []
        )
        # The tagging itself stays, like a score keeps its player.
        assert list(await session.scalars(select(SongTag.song_id))) == [SONG]


async def test_the_changes_are_broadcast(
    party: Party, broadcast_events: list[dict[str, object]]
) -> None:
    created = await make_tag(party["admin"], permissions=[{"action": "view", "role": "guest"}])
    await tag_song(party["admin"], SONG, created["id"])
    await party["admin"].put(f"/api/v1/tags/{created['id']}/permissions", json={"permissions": []})
    await party["admin"].delete(f"/api/v1/tags/{created['id']}")

    assert [event["event"] for event in broadcast_events] == [
        "tags.changed",
        "song_tags.changed",
        "tags.changed",
        "tags.changed",
    ]
    assert broadcast_events[1] == {
        "event": "song_tags.changed",
        "song_id": SONG,
        "tag_id": created["id"],
    }


async def test_the_recently_played_tab_hides_a_hidden_song(party: Party) -> None:
    """`GET /stats/sessions/current/sings` is the Songs page's Recent tab — a song list a
    stranger browses, so it hides exactly what `GET /songs` hides. It used to be an
    accepted leak: it carries the whole `SongRead`, so a guest saw a broken song's title
    and cover there while the library itself kept it back."""
    started = datetime.now(UTC) - timedelta(minutes=5)
    async with factory(party.app)() as session:
        karaoke_session = KaraokeSession(started_at=started, last_activity_at=started)
        session.add(karaoke_session)
        await session.flush()
        for index, song_id in enumerate((SONG, OTHER_SONG)):
            session.add(
                Sing(
                    song_id=song_id,
                    session_id=karaoke_session.id,
                    started_at=started + timedelta(minutes=index),
                )
            )
        await session.commit()
    await tag_song(party["trusted"], SONG, BROKEN_TAG_ID)

    async def played(client: AsyncClient) -> list[str]:
        response = await client.get("/api/v1/stats/sessions/current/sings")
        assert response.status_code == 200, response.text
        return [row["song_id"] for row in response.json()["sings"]]

    # The row goes whole — not a sing with `song: null`, which would still say a song was
    # played that this caller cannot see.
    assert await played(party["anonymous"]) == [OTHER_SONG]
    assert await played(party["user"]) == [OTHER_SONG]
    assert await played(party["trusted"]) == [OTHER_SONG, SONG]


async def test_the_leaks_we_accept(party: Party) -> None:
    """What a hidden song still shows, on purpose.

    Filtering these would cost more than it buys, and none of them is a song *list* a
    stranger browses:

    * `karaoke.started` and `GET /karaoke/current` — the TV is showing the song; a phone in
      the same room learning its title is not a leak.
    * the statistics score lists (`/stats/latest`, a session's and a player's scores) carry
      the song title of everything that was ever sung, hidden or not: a score belongs to
      the singer, and dropping rows would make two people disagree about a scoreboard. The
      current session's *sings* are no longer among them — that one is the Songs page's
      Recent tab, a song list rather than a scoreboard, and
      `test_the_recently_played_tab_hides_a_hidden_song` above pins it down.
    * every websocket event carries ids only, so a client that may not resolve one learns
      nothing from it.
    * `PlaylistRead.song_count`, `duration_seconds` and `cover_song_ids` are what the row
      in the listing shows — recomputed per caller, two people would disagree about how
      long the same playlist is. The playlist *detail* does drop the hidden entries.
    * `GET /favorites` answers ids the caller marked themselves, and nothing else.
    * `GET /tags/rules` suggests the languages, genres and editions the *whole* library
      holds, a hidden song's included (`test_tags_rules` pins that down). A datalist that
      changed per reader would show two managers different options for the same rule, and
      a metadata value is not a song.
    * somebody who already has the id can still learn a hidden song is *in* a playlist —
      `GET /playlists?song_id=…` fills `contains`, and adding it again is a 409. Both need
      the id first, which is what the 404s above keep back.
    """
    playlist = await party["trusted"].post(
        "/api/v1/playlists", json={"name": "Mix", "is_global": True}
    )
    playlist_id = playlist.json()["id"]
    assert (
        await party["trusted"].post(
            f"/api/v1/playlists/{playlist_id}/entries", json={"song_id": SONG}
        )
    ).status_code == 201
    await tag_song(party["trusted"], SONG, BROKEN_TAG_ID)

    detail = await party["anonymous"].get(f"/api/v1/playlists/{playlist_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["entries"] == []
    # The count above them is deliberately the whole list.
    assert detail.json()["song_count"] == 1
    assert detail.json()["cover_song_ids"] == [SONG]


async def test_a_playlist_holding_a_hidden_song_can_still_be_reordered(party: Party) -> None:
    """The order the caller sends is the list they were shown. Demanding the whole playlist
    would leave one broken song in it enough to freeze the order for good."""
    user = party["user"]
    playlist_id = (await user.post("/api/v1/playlists", json={"name": "Party"})).json()["id"]
    for song_id in (SONG, OTHER_SONG, THIRD_SONG):
        entry = await user.post(
            f"/api/v1/playlists/{playlist_id}/entries", json={"song_id": song_id}
        )
        assert entry.status_code == 201, entry.text
    await tag_song(party["trusted"], OTHER_SONG, BROKEN_TAG_ID)

    async def entries(client: AsyncClient) -> list[str]:
        response = await client.get(f"/api/v1/playlists/{playlist_id}")
        assert response.status_code == 200, response.text
        return [entry["song"]["id"] for entry in response.json()["entries"]]

    assert await entries(user) == [SONG, THIRD_SONG]
    reordered = await user.put(
        f"/api/v1/playlists/{playlist_id}/entries", json={"song_ids": [THIRD_SONG, SONG]}
    )

    assert reordered.status_code == 200, reordered.text
    assert await entries(user) == [THIRD_SONG, SONG]
    # The hidden entry kept the slot it was in, so it is still in the middle for the people
    # who can see it — the playlist itself is this account's, so this is the stored order.
    async with factory(party.app)() as db:
        rows = await db.scalars(select(PlaylistEntry).order_by(PlaylistEntry.position))
        assert [row.song_id for row in rows] == [THIRD_SONG, OTHER_SONG, SONG]
    # And an order naming a song the caller cannot see is still a mismatch.
    refused = await user.put(
        f"/api/v1/playlists/{playlist_id}/entries",
        json={"song_ids": [SONG, OTHER_SONG, THIRD_SONG]},
    )
    assert refused.status_code == 422, refused.text


async def test_a_hidden_song_drops_out_of_the_wishlist(party: Party) -> None:
    assert (await party["user"].post("/api/v1/wishlist", json={"song_id": SONG})).status_code == 201

    await tag_song(party["trusted"], SONG, BROKEN_TAG_ID)

    async def wished(client: AsyncClient) -> list[str]:
        response = await client.get("/api/v1/wishlist")
        assert response.status_code == 200, response.text
        return [wish["song"]["id"] for wish in response.json()["wishes"]]

    assert await wished(party["anonymous"]) == []
    assert await wished(party["trusted"]) == [SONG]


# --- the built-in marks ------------------------------------------------------------

# Favorites and Sung: not rows in `tags`, so `/api/v1/tags` carries them in a list of
# their own and one route of their own changes them.


async def built_ins_of(client: AsyncClient) -> dict[str, dict[str, Any]]:
    response = await client.get("/api/v1/tags")
    assert response.status_code == 200, response.text
    return {row["id"]: row for row in response.json()["built_ins"]}


async def set_built_in(
    client: AsyncClient, built_in_id: str, expect: int = 200, **body: Any
) -> dict[str, Any]:
    response = await client.patch(f"/api/v1/tags/built-in/{built_in_id}", json=body)
    assert response.status_code == expect, response.text
    return dict(response.json())


async def test_everybody_reads_the_built_in_marks(party: Party) -> None:
    """A guest with no account has to know what colour to paint the hearts, so the config
    rides on the listing every reader already makes — a pink heart and a blue microphone,
    both on the song rows, until somebody says otherwise."""
    for identity in ("anonymous", "user", "trusted", "admin", "host"):
        rows = await built_ins_of(party[identity])
        assert list(rows) == ["favorites", "sung"]
        assert rows["favorites"] == {"id": "favorites", "color": "pink", "show_in_list": True}
        assert rows["sung"] == {"id": "sung", "color": "blue", "show_in_list": True}


async def test_a_tag_manager_recolours_a_built_in_mark(
    party: Party, broadcast_events: list[dict[str, object]]
) -> None:
    """`tags.manage` is the right: what a mark looks like is a decision about tags, not a
    setting. And an open song list has to repaint, so the same `tags.changed` goes out."""
    assert await set_built_in(party["trusted"], "favorites", color="gold") == {
        "id": "favorites",
        "color": "gold",
        "show_in_list": True,
    }
    assert await set_built_in(party["admin"], "sung", show_in_list=False) == {
        "id": "sung",
        "color": "blue",
        "show_in_list": False,
    }

    assert [event["event"] for event in broadcast_events] == ["tags.changed", "tags.changed"]
    rows = await built_ins_of(party["anonymous"])
    assert rows["favorites"]["color"] == "gold"
    assert rows["sung"]["show_in_list"] is False


async def test_a_built_in_patch_touches_only_what_it_names(party: Party) -> None:
    await set_built_in(party["admin"], "favorites", color="neutral", show_in_list=False)

    assert await set_built_in(party["admin"], "favorites", show_in_list=True) == {
        "id": "favorites",
        "color": "neutral",
        "show_in_list": True,
    }


async def test_a_plain_account_cannot_change_a_built_in_mark(party: Party) -> None:
    """It is one global decision, like a tag's colour — and a guest may not even try."""
    await set_built_in(party["user"], "favorites", expect=403, color="gold")
    await set_built_in(party["anonymous"], "favorites", expect=403, color="gold")

    assert (await built_ins_of(party["anonymous"]))["favorites"]["color"] == "pink"


async def test_a_built_in_mark_refuses_a_colour_no_tag_may_wear(party: Party) -> None:
    """The same four colours a tag has: a mark drawn in red would be the one thing §1.6
    keeps off a glyph, and an unknown name would leave it in whatever it inherited."""
    await set_built_in(party["admin"], "favorites", expect=422, color="red")
    await set_built_in(party["admin"], "favorites", expect=422, color="mauve")

    assert (await built_ins_of(party["admin"]))["favorites"]["color"] == "pink"


async def test_only_the_two_built_in_ids_exist(party: Party) -> None:
    """`recent` is a mode — a time-ordered list — and not a mark, so there is nothing to
    configure about it; a tag id is not a built-in id either."""
    await set_built_in(party["admin"], "recent", expect=422, color="gold")
    await set_built_in(party["admin"], BROKEN_TAG_ID, expect=422, color="gold")


async def test_the_reserved_ids_are_not_tags(party: Party) -> None:
    """Everywhere a real tag id is expected, `favorites` and `sung` are simply unknown —
    they are not rows in `tags`, and no route may pretend otherwise. A tag id is 32 hex
    characters, so nothing a manager creates can ever collide with the two words."""
    admin = party["admin"]
    for built_in_id in ("favorites", "sung"):
        assert (
            await admin.patch(f"/api/v1/tags/{built_in_id}", json={"color": "gold"})
        ).status_code == 404
        assert (
            await admin.put(
                f"/api/v1/tags/{built_in_id}/permissions",
                json={"permissions": [{"action": "view", "role": "user"}]},
            )
        ).status_code == 404
        assert (await admin.delete(f"/api/v1/tags/{built_in_id}")).status_code == 404
        await tag_song(admin, SONG, built_in_id, expect=404)
        assert (await admin.delete(f"/api/v1/songs/{SONG}/tags/{built_in_id}")).status_code == 404

    # And a tag *named* "Favorites" is fine — it is the id that is reserved, not the word.
    named = await make_tag(admin, name="Favorites", color="pink")
    assert named["id"] != "favorites"


async def test_a_stored_built_in_colour_the_app_no_longer_knows_falls_back(
    party: Party,
) -> None:
    """Only a hand-edited database can get there, and a mark with no colour class would
    inherit whatever the row around it is painted in."""
    async with factory(party.app)() as db:
        await db.merge(SettingRow(key="tags.built_in.favorites.color", value='"chartreuse"'))
        await db.commit()

    assert (await built_ins_of(party["anonymous"]))["favorites"]["color"] == "pink"


async def test_the_built_ins_stay_out_of_the_settings_api(party: Party) -> None:
    """They are stored as settings, but they are not settings: `settings.view` is an
    administrator's right while the marks are drawn for every guest, and the one gate on
    changing them is `tags.manage`."""
    response = await party["admin"].get("/api/v1/settings")
    assert response.status_code == 200, response.text
    assert not [row for row in response.json() if row["key"].startswith("tags.built_in.")]

    refused = await party["admin"].patch(
        "/api/v1/settings/tags.built_in.favorites.color", json={"value": "gold"}
    )
    assert refused.status_code == 404, refused.text


# --- the migration -----------------------------------------------------------------

# The id 0013 seeded `archive` with, and 0015 takes back out. Written out here rather than
# imported: `tags.model` no longer names it, which is the point of the revision.
SEEDED_ARCHIVE_ID = "a96ea6e6f3504493817d2db6813e030a"


def _config(database_url: str) -> Config:
    """Alembic runs sync: `migrations/env.py` calls `asyncio.run`, which cannot happen
    inside a running event loop — hence a sync test."""
    config = Config()
    config.set_main_option("script_location", str(migrations_dir()))
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    return config


def _upgrade(database_url: str, revision: str) -> None:
    command.upgrade(_config(database_url), revision)


def _downgrade(database_url: str, revision: str) -> None:
    command.downgrade(_config(database_url), revision)


def _tag_ids(database: Path) -> set[str]:
    with sqlite3.connect(database) as connection:
        return {row[0] for row in connection.execute("SELECT id FROM tags")}


def _tag_name(database: Path, tag_id: str) -> str | None:
    with sqlite3.connect(database) as connection:
        row = connection.execute("SELECT name FROM tags WHERE id = ?", (tag_id,)).fetchone()
    return None if row is None else str(row[0])


def _permission_count(database: Path, tag_id: str) -> int:
    with sqlite3.connect(database) as connection:
        count: int = connection.execute(
            "SELECT count(*) FROM tag_permissions WHERE tag_id = ?", (tag_id,)
        ).fetchone()[0]
    return count


def test_migration_0015_removes_the_untouched_archive_seed(tmp_path: Path) -> None:
    """A database nobody ever used `archive` in loses the row, its permissions and nothing
    else — and a database migrated all the way to head has `broken` alone, which is what a
    fresh install gets."""
    database = tmp_path / "wingman.db"
    url = f"sqlite+aiosqlite:///{database}"
    _upgrade(url, "0014")
    assert SEEDED_ARCHIVE_ID in _tag_ids(database)

    _upgrade(url, "head")

    assert _tag_ids(database) == {BROKEN_TAG_ID}
    assert _permission_count(database, SEEDED_ARCHIVE_ID) == 0
    # `broken` is untouched: 0015 knows exactly one row.
    assert _permission_count(database, BROKEN_TAG_ID) == 3

    # And the downgrade puts it back the way 0013 had it.
    _downgrade(url, "0014")

    assert _tag_ids(database) == {BROKEN_TAG_ID, SEEDED_ARCHIVE_ID}
    assert _permission_count(database, SEEDED_ARCHIVE_ID) == len(ARCHIVE_GRANTS)


def test_migration_0015_keeps_an_archive_tag_somebody_renamed(tmp_path: Path) -> None:
    """A renamed tag is somebody's own tag now, whatever id it happens to carry."""
    database = tmp_path / "wingman.db"
    url = f"sqlite+aiosqlite:///{database}"
    _upgrade(url, "0014")
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE tags SET name = 'Put away' WHERE id = ?", (SEEDED_ARCHIVE_ID,))

    _upgrade(url, "head")

    assert SEEDED_ARCHIVE_ID in _tag_ids(database)
    assert _permission_count(database, SEEDED_ARCHIVE_ID) == len(ARCHIVE_GRANTS)


def test_migration_0015_keeps_an_archive_tag_that_holds_songs(tmp_path: Path) -> None:
    """One `song_tags` row is a party using the tag, and taking it away would untag their
    songs behind their back."""
    database = tmp_path / "wingman.db"
    url = f"sqlite+aiosqlite:///{database}"
    _upgrade(url, "0014")
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO song_tags (tag_id, song_id, user_id, created_at) "
            "VALUES (?, 'usdb:1', NULL, '2026-08-01 20:00:00')",
            (SEEDED_ARCHIVE_ID,),
        )

    _upgrade(url, "head")

    assert SEEDED_ARCHIVE_ID in _tag_ids(database)
    assert _permission_count(database, SEEDED_ARCHIVE_ID) == len(ARCHIVE_GRANTS)


def test_migration_0015_survives_an_archive_somebody_already_deleted(tmp_path: Path) -> None:
    """Deleting the tag by hand is what the revision does anyway, so arriving to find it
    gone must be a no-op and not a failure."""
    database = tmp_path / "wingman.db"
    url = f"sqlite+aiosqlite:///{database}"
    _upgrade(url, "0014")
    with sqlite3.connect(database) as connection:
        connection.execute("DELETE FROM tag_permissions WHERE tag_id = ?", (SEEDED_ARCHIVE_ID,))
        connection.execute("DELETE FROM tags WHERE id = ?", (SEEDED_ARCHIVE_ID,))

    _upgrade(url, "head")

    assert _tag_ids(database) == {BROKEN_TAG_ID}
    assert _permission_count(database, BROKEN_TAG_ID) == 3


def test_migration_0015_does_not_hand_a_kept_tag_back_a_revoked_grant(tmp_path: Path) -> None:
    """The downgrade re-seeds into an empty space and nowhere else. A tag the upgrade kept
    is the party's own, and putting a grant they revoked back under them would be this
    revision undoing their work instead of its own."""
    database = tmp_path / "wingman.db"
    url = f"sqlite+aiosqlite:///{database}"
    _upgrade(url, "0014")
    with sqlite3.connect(database) as connection:
        connection.execute("UPDATE tags SET name = 'Put away' WHERE id = ?", (SEEDED_ARCHIVE_ID,))
        connection.execute(
            "DELETE FROM tag_permissions WHERE tag_id = ? AND action = 'view' AND role = 'guest'",
            (SEEDED_ARCHIVE_ID,),
        )
    _upgrade(url, "head")

    _downgrade(url, "0014")

    assert _permission_count(database, SEEDED_ARCHIVE_ID) == len(ARCHIVE_GRANTS) - 1
    assert _tag_name(database, SEEDED_ARCHIVE_ID) == "Put away"


def test_migration_0015_leaves_a_partys_own_archive_tag_alone_on_the_way_back(
    tmp_path: Path,
) -> None:
    """The downgrade re-seeds — but `ix_tags_name_lower` is unique, so a party that made
    their own `archive` after upgrading must not have the insert fail under them."""
    database = tmp_path / "wingman.db"
    url = f"sqlite+aiosqlite:///{database}"
    _upgrade(url, "head")
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO tags (id, name, icon, color, show_in_list, hide_by_default, created_at) "
            "VALUES ('mine', 'Archive', NULL, 'blue', 0, 1, '2026-08-01 20:00:00')"
        )

    _downgrade(url, "0014")

    assert _tag_ids(database) == {BROKEN_TAG_ID, "mine"}
    assert _permission_count(database, SEEDED_ARCHIVE_ID) == 0
