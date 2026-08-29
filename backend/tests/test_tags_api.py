"""Tags: who may see one, who may see the songs under it, who may set it.

The interesting half is what a *missing* `view_songs` does. It is not a filter on the song
list — it is what "this song is not there" means for that caller, everywhere: the detail,
the cover, the audio, wishing for it, favoriting it, putting it in a playlist, singing it
and its score history all answer 404, because a 403 would confirm the song exists.

Roles are bundles and not a ladder, so every grant is spelled out per role; only `admin`
(the host screen included) is exempt, the same way it is exempt from `role_permissions`.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, get_args

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select

from conftest import BASE_URL, add_session, add_user
from test_wishlist_api import OTHER_SONG, SONG, THIRD_SONG, add_songs, factory
from ultrastar_wingman.app import create_app
from ultrastar_wingman.auth.deps import COOKIE_NAME
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.karaoke.model import KaraokeSession, Sing
from ultrastar_wingman.library.model import PlaylistEntry
from ultrastar_wingman.songs.model import Song
from ultrastar_wingman.tags.model import (
    ARCHIVE_TAG_ID,
    BROKEN_TAG_ID,
    TAG_ACTIONS,
    TAG_COLORS,
    SongTag,
    TagPermission,
)
from ultrastar_wingman.tags.schema import TagAction, TagColor

# The colors the two seeded tags use, so a test that renames one does not have to know them.
BROKEN = "broken"
ARCHIVE = "archive"


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


async def test_the_seeded_tags_reach_the_right_people(party: Party) -> None:
    """`broken` is for helpers; `archive` is for everybody. The ids are the ones
    `tags.model` names, which is what keeps migration 0013 and the module in step."""
    assert await names(party["anonymous"]) == [ARCHIVE]
    assert await names(party["user"]) == [ARCHIVE]
    # Alphabetical, case-insensitively.
    assert await names(party["trusted"]) == [ARCHIVE, BROKEN]
    assert await names(party["admin"]) == [ARCHIVE, BROKEN]
    assert await names(party["host"]) == [ARCHIVE, BROKEN]

    seeded = {tag["name"]: tag for tag in await tags_of(party["admin"])}
    assert seeded[BROKEN]["id"] == BROKEN_TAG_ID
    assert seeded[ARCHIVE]["id"] == ARCHIVE_TAG_ID
    assert seeded[BROKEN]["show_in_list"] is True
    assert seeded[BROKEN]["hide_by_default"] is True
    assert seeded[BROKEN]["icon"] == "alert"
    assert seeded[BROKEN]["color"] == "gold"
    assert seeded[ARCHIVE]["show_in_list"] is False
    assert seeded[ARCHIVE]["hide_by_default"] is True


async def test_only_a_tag_manager_is_shown_who_a_tag_is_for(party: Party) -> None:
    """`tags.manage` is trusted and above, so a plain account sees the tag and not the
    accounts named on it."""
    plain = {tag["name"]: tag for tag in await tags_of(party["user"])}
    assert plain[ARCHIVE]["permissions"] is None
    # It may see the tag but not set it: `assign` on `archive` is trusted's.
    assert plain[ARCHIVE]["can_assign"] is False

    managed = {tag["name"]: tag for tag in await tags_of(party["trusted"])}
    assert managed[ARCHIVE]["can_assign"] is True
    assert {(row["action"], row["role"]) for row in managed[ARCHIVE]["permissions"]} == {
        ("view", "guest"),
        ("view", "user"),
        ("view", "trusted"),
        ("view_songs", "guest"),
        ("view_songs", "user"),
        ("view_songs", "trusted"),
        ("assign", "trusted"),
    }
    assert all(row["user_id"] is None for row in managed[ARCHIVE]["permissions"])


async def test_a_manager_lists_a_tag_they_may_not_view(party: Party) -> None:
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
    assert listed[ARCHIVE_TAG_ID]["can_view"] is True
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


async def test_an_archived_song_stays_visible_to_everybody(party: Party) -> None:
    """`hide_by_default` is a client-side default, not a permission: the backend stores the
    flag and keeps serving the song."""
    await tag_song(party["trusted"], OTHER_SONG, ARCHIVE_TAG_ID)

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


async def test_assigning_is_a_403_only_for_a_tag_the_caller_can_see(party: Party) -> None:
    """A tag they may not view is a 404, exactly like a song they may not see. Only a tag
    they already know about is a 403."""
    refused = await tag_song(party["user"], OTHER_SONG, ARCHIVE_TAG_ID, expect=403)
    assert refused == {"detail": "missing_tag_permission:assign"}
    hidden = await tag_song(party["user"], OTHER_SONG, BROKEN_TAG_ID, expect=404)
    assert hidden == {"detail": f"unknown tag '{BROKEN_TAG_ID}'"}
    assert await tag_song(party["user"], OTHER_SONG, "nope", expect=404) is not None


async def test_tagging_and_untagging_are_both_idempotent(party: Party) -> None:
    await tag_song(party["trusted"], OTHER_SONG, ARCHIVE_TAG_ID)
    await tag_song(party["trusted"], OTHER_SONG, ARCHIVE_TAG_ID)
    assert (await assignments_of(party["trusted"]))[ARCHIVE_TAG_ID] == [OTHER_SONG]

    for _ in range(2):
        response = await party["trusted"].delete(
            f"/api/v1/songs/{OTHER_SONG}/tags/{ARCHIVE_TAG_ID}"
        )
        assert response.status_code == 204, response.text
    assert (await assignments_of(party["trusted"]))[ARCHIVE_TAG_ID] == []


async def test_who_tagged_a_song_is_recorded_and_the_host_is_nobody(party: Party) -> None:
    await tag_song(party["trusted"], SONG, ARCHIVE_TAG_ID)
    await tag_song(party["host"], OTHER_SONG, ARCHIVE_TAG_ID)

    async with factory(party.app)() as session:
        rows = {
            row.song_id: row.user_id
            for row in await session.scalars(
                select(SongTag).where(SongTag.tag_id == ARCHIVE_TAG_ID)
            )
        }
    assert rows == {SONG: party.ids["trusted"], OTHER_SONG: None}


async def test_replacing_the_permissions_can_name_a_single_account(party: Party) -> None:
    response = await party["admin"].put(
        f"/api/v1/tags/{ARCHIVE_TAG_ID}/permissions",
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
    # trusted — which the seed had granted it to — may not even see it any more. It still
    # *lists* the tag, because trusted manages tags; `can_view` is what says the
    # difference, and the 404 below is the part with teeth.
    await tag_song(party["user"], SONG, ARCHIVE_TAG_ID)
    listed = {tag["name"]: tag for tag in await tags_of(party["trusted"])}
    assert listed[ARCHIVE]["can_view"] is False
    assert listed[BROKEN]["can_view"] is True
    assert await tag_song(party["trusted"], OTHER_SONG, ARCHIVE_TAG_ID, expect=404) is not None


async def test_a_manager_can_create_edit_and_delete_a_tag(party: Party) -> None:
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


async def test_a_duplicate_name_is_refused_case_insensitively(party: Party) -> None:
    response = await party["admin"].post(
        "/api/v1/tags", json={"name": "BROKEN", "color": "neutral"}
    )

    assert response.status_code == 409
    assert response.json() == {"detail": "duplicate_tag_name"}
    # And on a rename, which the unique index would otherwise turn into a 500.
    renamed = await party["admin"].patch(f"/api/v1/tags/{ARCHIVE_TAG_ID}", json={"name": "Broken"})
    assert renamed.status_code == 409
    # Renaming a tag to what it is already called is not a clash with itself.
    assert (
        await party["admin"].patch(f"/api/v1/tags/{ARCHIVE_TAG_ID}", json={"name": "Archive"})
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
    assert await names(party["admin"]) == [ARCHIVE, BROKEN]


async def test_the_same_row_twice_is_one_row(party: Party) -> None:
    """The unique index would make a duplicated row a 500; the service drops it instead."""
    created = await make_tag(
        party["admin"],
        permissions=[{"action": "view", "role": "guest"}, {"action": "view", "role": "guest"}],
    )

    assert created["permissions"] == [
        {"action": "view", "role": "guest", "user_id": None, "username": None}
    ]


async def test_a_tag_on_a_song_that_left_the_library_waits_for_it(party: Party) -> None:
    """`usdb:1234` coming back is the same song, so its tags come back with it."""
    await tag_song(party["trusted"], SONG, ARCHIVE_TAG_ID)
    async with factory(party.app)() as session:
        await session.execute(delete(Song).where(Song.id == SONG))
        await session.commit()

    assert (await assignments_of(party["trusted"]))[ARCHIVE_TAG_ID] == []

    await add_songs(party.app, SONG)

    assert (await assignments_of(party["trusted"]))[ARCHIVE_TAG_ID] == [SONG]


async def test_assignments_hold_only_viewable_tags_and_visible_songs(party: Party) -> None:
    await tag_song(party["trusted"], SONG, BROKEN_TAG_ID)
    await tag_song(party["trusted"], SONG, ARCHIVE_TAG_ID)
    await tag_song(party["trusted"], OTHER_SONG, ARCHIVE_TAG_ID)

    # A guest may view `archive`, but the song under it is hidden by `broken`.
    assert await assignments_of(party["anonymous"]) == {ARCHIVE_TAG_ID: [OTHER_SONG]}
    assert await assignments_of(party["trusted"]) == {
        ARCHIVE_TAG_ID: [OTHER_SONG, SONG],
        BROKEN_TAG_ID: [SONG],
    }


async def test_deleting_an_account_drops_the_rows_that_named_it(party: Party) -> None:
    user_id = party.ids["user"]
    granted = await party["admin"].put(
        f"/api/v1/tags/{ARCHIVE_TAG_ID}/permissions",
        json={"permissions": [{"action": "view", "user_id": user_id}]},
    )
    assert granted.status_code == 200, granted.text
    await tag_song(party["admin"], SONG, ARCHIVE_TAG_ID)

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
