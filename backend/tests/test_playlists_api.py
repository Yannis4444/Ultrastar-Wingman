"""Playlists: who may see one, who may change it, who it is shared with — and keeping the
entry positions dense.

Three ways in, and they are what most of this file pins down: the owner, a `playlist_members`
row (read, write or admin), and the global flag, which shows a list to everybody who may view
playlists and lets none of them change it. `playlists.moderate` is the fourth, row-level, and
only ever reaches what its holder can already see.
"""

from collections.abc import AsyncIterator
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from sqlalchemy import select

from conftest import add_session, add_user, admin_client, authenticate_admin
from test_wishlist_api import (
    OTHER_SONG,
    SONG,
    THIRD_SONG,
    account,
    add_songs,
    factory,
    guest,
    set_cookie,
)
from ultrastar_wingman.app import create_app
from ultrastar_wingman.auth.deps import COOKIE_NAME
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.library.model import Favorite, Playlist, PlaylistEntry, PlaylistMember
from ultrastar_wingman.songs.model import Song


@pytest.fixture
async def app_with_songs(bootstrap_settings: BootstrapSettings) -> AsyncIterator[FastAPI]:
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await add_songs(app, SONG, OTHER_SONG, THIRD_SONG)
        yield app


async def create(
    client: AsyncClient,
    name: str,
    is_global: bool = False,
    description: str | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"name": name, "is_global": is_global}
    if description is not None:
        body["description"] = description
    response = await client.post("/api/v1/playlists", json=body)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


async def detail(client: AsyncClient, playlist_id: str) -> dict[str, Any]:
    response = await client.get(f"/api/v1/playlists/{playlist_id}")
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def add_entry(client: AsyncClient, playlist_id: str, song_id: str) -> dict[str, Any]:
    response = await client.post(
        f"/api/v1/playlists/{playlist_id}/entries", json={"song_id": song_id}
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def account_id(client: AsyncClient) -> str:
    """The id of the account a client is logged in as."""
    me = (await client.get("/api/v1/auth/me")).json()
    return str(me["user"]["id"])


async def share(
    owner: AsyncClient, playlist_id: str, user_id: str, access: str
) -> list[dict[str, Any]]:
    response = await owner.put(
        f"/api/v1/playlists/{playlist_id}/members", json={"user_id": user_id, "access": access}
    )
    assert response.status_code in (200, 201), response.text
    members: list[dict[str, Any]] = response.json()["members"]
    return members


async def listed(client: AsyncClient, **params: str) -> list[dict[str, Any]]:
    response = await client.get("/api/v1/playlists", params=params)
    assert response.status_code == 200, response.text
    rows: list[dict[str, Any]] = response.json()["playlists"]
    return rows


def song_ids(playlist: dict[str, Any]) -> list[str]:
    return [entry["song"]["id"] for entry in playlist["entries"]]


async def stored_positions(app: FastAPI, playlist_id: str) -> list[tuple[str, int]]:
    async with factory(app)() as session:
        rows = await session.scalars(
            select(PlaylistEntry)
            .where(PlaylistEntry.playlist_id == playlist_id)
            .order_by(PlaylistEntry.position)
        )
        return [(row.song_id, row.position) for row in rows]


async def test_create_list_read_update_and_delete(app_with_songs: FastAPI) -> None:
    client = await account(app_with_songs, "singer")
    async with client:
        playlist = await create(client, "  Party  ", description="  The good ones  ")
        assert playlist["name"] == "Party"
        assert playlist == {
            "id": playlist["id"],
            "name": "Party",
            "description": "The good ones",
            "is_global": False,
            "owner_username": "singer",
            "owner_player_id": None,
            "song_count": 0,
            "duration_seconds": 0,
            "cover_song_ids": [],
            "my_access": "owner",
            "followed": True,
            "can_edit": True,
            "can_manage": True,
            "contains": None,
        }

        assert await listed(client) == [playlist]

        renamed = await client.patch(
            f"/api/v1/playlists/{playlist['id']}", json={"name": "Encore", "is_global": True}
        )
        assert renamed.status_code == 200
        assert renamed.json()["name"] == "Encore"
        assert renamed.json()["is_global"] is True
        # The PATCH did not name the description, so it is still there.
        assert renamed.json()["description"] == "The good ones"

        assert (await detail(client, str(playlist["id"])))["entries"] == []

        assert (await client.delete(f"/api/v1/playlists/{playlist['id']}")).status_code == 204
        assert await listed(client) == []


async def test_an_explicit_null_clears_the_description(app_with_songs: FastAPI) -> None:
    """The only way to say "no description": leaving the field out means "keep it"."""
    client = await account(app_with_songs, "singer")
    async with client:
        playlist = await create(client, "Party", description="A sentence")

        kept = await client.patch(f"/api/v1/playlists/{playlist['id']}", json={"name": "Encore"})
        assert kept.json()["description"] == "A sentence"

        cleared = await client.patch(
            f"/api/v1/playlists/{playlist['id']}", json={"description": None}
        )
        assert cleared.json()["description"] is None


async def set_duration(app: FastAPI, song_id: str, seconds: int) -> None:
    async with factory(app)() as session:
        song = await session.get(Song, song_id)
        assert song is not None
        song.duration_seconds = seconds
        await session.commit()


async def test_the_song_count_and_duration_add_up(app_with_songs: FastAPI) -> None:
    """A song with no length counts towards the number but not the clock — one unknown
    must not make the whole sum unknown."""
    await set_duration(app_with_songs, SONG, 210)
    await set_duration(app_with_songs, OTHER_SONG, 185)
    client = await account(app_with_songs, "singer")
    async with client:
        playlist = await create(client, "Party")
        for song in (SONG, OTHER_SONG, THIRD_SONG):
            row = await add_entry(client, str(playlist["id"]), song)

        assert row["song_count"] == 3
        assert row["duration_seconds"] == 395
        assert (await listed(client))[0]["duration_seconds"] == 395


async def test_a_song_that_left_the_library_leaves_the_count(app_with_songs: FastAPI) -> None:
    """The entry stays — the song may come back — but the number beside the name is what
    the list holds *now*, and the detail already skips the orphan. The two saying
    different things is a playlist that claims three songs and shows two."""
    await set_duration(app_with_songs, SONG, 210)
    await set_duration(app_with_songs, OTHER_SONG, 185)
    client = await account(app_with_songs, "singer")
    async with client:
        playlist = await create(client, "Party")
        playlist_id = str(playlist["id"])
        for song in (SONG, OTHER_SONG):
            await add_entry(client, playlist_id, song)

        async with factory(app_with_songs)() as session:
            gone = await session.get(Song, SONG)
            assert gone is not None
            await session.delete(gone)
            await session.commit()

        rows = await detail(client, playlist_id)
        assert song_ids(rows) == [OTHER_SONG]
        assert rows["song_count"] == 1
        assert rows["duration_seconds"] == 185
        assert (await listed(client))[0]["song_count"] == 1
        # The entry is still stored, so the song brings its place back with it.
        assert await stored_positions(app_with_songs, playlist_id) == [(SONG, 0), (OTHER_SONG, 1)]


async def test_the_listing_names_the_first_songs_for_the_cover_mosaic(
    app_with_songs: FastAPI,
) -> None:
    """Four ids at most, in playlist order, so a row draws its 2x2 of covers without one
    detail request per playlist."""
    await add_songs(app_with_songs, "local:dddd", "local:eeee")
    client = await account(app_with_songs, "singer")
    async with client:
        playlist = await create(client, "Party")
        for song in (SONG, OTHER_SONG, THIRD_SONG, "local:dddd", "local:eeee"):
            row = await add_entry(client, str(playlist["id"]), song)

        assert row["cover_song_ids"] == [SONG, OTHER_SONG, THIRD_SONG, "local:dddd"]
        assert (await listed(client))[0]["cover_song_ids"] == row["cover_song_ids"]

        # The mosaic follows the order the songs are in, not the order they arrived.
        reordered = await client.put(
            f"/api/v1/playlists/{playlist['id']}/entries",
            json={"song_ids": ["local:eeee", "local:dddd", THIRD_SONG, OTHER_SONG, SONG]},
        )
        assert reordered.status_code == 200, reordered.text
        assert reordered.json()["cover_song_ids"] == [
            "local:eeee",
            "local:dddd",
            THIRD_SONG,
            OTHER_SONG,
        ]


async def test_a_playlist_needs_an_account(app_with_songs: FastAPI) -> None:
    """401, not 403: a playlist has to belong to somebody, so "log in" is the useful answer
    rather than "the guest role lacks a capability it could never hold"."""
    async with guest(app_with_songs) as client:
        refused = await client.post("/api/v1/playlists", json={"name": "Party"})

        assert refused.status_code == 401
        assert refused.json() == {"detail": "not_authenticated"}
        # Viewing is still open to guests: global playlists are for everybody.
        assert (await client.get("/api/v1/playlists")).status_code == 200


async def test_the_host_session_has_to_log_in_to_own_a_playlist(app_with_songs: FastAPI) -> None:
    """The host UI is an administrator by device, but not a person a playlist could belong to."""
    await add_session(factory(app_with_songs), "host-token", is_host=True)
    async with guest(app_with_songs) as client:
        set_cookie(client, COOKIE_NAME, "host-token")

        refused = await client.post("/api/v1/playlists", json={"name": "Party"})

        assert refused.status_code == 401
        assert refused.json() == {"detail": "not_authenticated"}


async def test_a_private_playlist_is_invisible_to_everybody_else(app_with_songs: FastAPI) -> None:
    owner = await account(app_with_songs, "owner")
    other = await account(app_with_songs, "other")
    async with owner, other:
        private = await create(owner, "Secret")
        everybodys = await create(owner, "Singalong", is_global=True)

        assert [row["name"] for row in await listed(other)] == ["Singalong"]
        assert (await other.get(f"/api/v1/playlists/{private['id']}")).status_code == 404
        visible = await detail(other, str(everybodys["id"]))
        # Global, but still somebody else's — and nobody named this reader on it.
        assert visible["my_access"] is None
        assert visible["followed"] is False
        assert visible["can_edit"] is False
        assert visible["owner_username"] == "owner"


async def test_a_global_playlist_is_listed_for_an_anonymous_guest(app_with_songs: FastAPI) -> None:
    owner = await account(app_with_songs, "owner")
    async with owner, guest(app_with_songs) as visitor:
        await create(owner, "Secret")
        await create(owner, "Singalong", is_global=True)

        rows = await listed(visitor)

        assert [row["name"] for row in rows] == ["Singalong"]
        assert rows[0]["my_access"] is None
        assert rows[0]["followed"] is False
        assert rows[0]["can_edit"] is False
        assert rows[0]["can_manage"] is False


async def test_a_non_owner_may_view_a_global_playlist_but_not_change_it(
    app_with_songs: FastAPI,
) -> None:
    owner = await account(app_with_songs, "owner")
    other = await account(app_with_songs, "other")
    async with owner, other:
        everybodys = await create(owner, "Singalong", is_global=True)
        await add_entry(owner, str(everybodys["id"]), SONG)
        playlist_id = everybodys["id"]

        assert song_ids(await detail(other, str(playlist_id))) == [SONG]
        for response in (
            await other.post(
                f"/api/v1/playlists/{playlist_id}/entries", json={"song_id": OTHER_SONG}
            ),
            await other.delete(f"/api/v1/playlists/{playlist_id}/entries/{SONG}"),
            await other.put(f"/api/v1/playlists/{playlist_id}/entries", json={"song_ids": [SONG]}),
        ):
            assert response.status_code == 403, response.text
            assert response.json() == {"detail": "not_playlist_editor"}
        for response in (
            await other.patch(f"/api/v1/playlists/{playlist_id}", json={"name": "Mine now"}),
            await other.delete(f"/api/v1/playlists/{playlist_id}"),
            await other.get(f"/api/v1/playlists/{playlist_id}/members"),
        ):
            assert response.status_code == 403, response.text
            assert response.json() == {"detail": "not_playlist_manager"}


async def test_mutating_somebody_elses_private_playlist_is_404(app_with_songs: FastAPI) -> None:
    """403 would confirm the playlist exists, which is exactly what a private one hides."""
    owner = await account(app_with_songs, "owner")
    other = await account(app_with_songs, "other")
    async with owner, other:
        private = await create(owner, "Secret")

        refused = await other.delete(f"/api/v1/playlists/{private['id']}")

        assert refused.status_code == 404


async def moderator(app: FastAPI, username: str = "boss") -> AsyncClient:
    """A client holding `playlists.moderate` — `trusted` holds it by default now, so the
    party's helpers can tidy up the global lists without being administrators."""
    user = await add_user(factory(app), username, "trusted")
    await add_session(factory(app), f"{username}-token", user)
    client = guest(app)
    set_cookie(client, COOKIE_NAME, f"{username}-token")
    return client


async def test_a_moderator_may_change_anybody_s_global_playlist(app_with_songs: FastAPI) -> None:
    owner = await account(app_with_songs, "owner")
    helper = await moderator(app_with_songs)
    async with owner, helper:
        everybodys = await create(owner, "Party", is_global=True)

        renamed = await helper.patch(
            f"/api/v1/playlists/{everybodys['id']}", json={"name": "Moderated"}
        )

        assert renamed.status_code == 200
        assert renamed.json()["name"] == "Moderated"
        # Somebody else's playlist: moderation is not membership.
        assert renamed.json()["my_access"] is None
        assert renamed.json()["can_manage"] is True
        # And the songs are theirs to fix too.
        assert (
            await helper.post(
                f"/api/v1/playlists/{everybodys['id']}/entries", json={"song_id": SONG}
            )
        ).status_code == 201


async def test_a_moderator_may_delete_anybody_s_global_playlist(app_with_songs: FastAPI) -> None:
    owner = await account(app_with_songs, "owner")
    helper = await moderator(app_with_songs)
    async with owner, helper:
        everybodys = await create(owner, "Party", is_global=True)

        deleted = await helper.delete(f"/api/v1/playlists/{everybodys['id']}")

        assert deleted.status_code == 204
        assert (await owner.get(f"/api/v1/playlists/{everybodys['id']}")).status_code == 404


async def test_even_a_moderator_never_reaches_a_private_playlist(app_with_songs: FastAPI) -> None:
    """Moderation follows what can be looked at: a playlist nobody named the moderator on
    is a 404 for them, so nothing can be deleted that could not be read."""
    owner = await account(app_with_songs, "owner")
    helper = await moderator(app_with_songs)
    async with owner, helper:
        private = await create(owner, "Secret")

        refused = await helper.patch(f"/api/v1/playlists/{private['id']}", json={"name": "Nope"})

        assert refused.status_code == 404
        assert (await owner.get(f"/api/v1/playlists/{private['id']}")).json()["name"] == "Secret"


async def test_a_members_only_playlist_is_404_to_a_stranger_and_to_a_moderator(
    app_with_songs: FastAPI,
) -> None:
    """Sharing with somebody is not the same as making a list global: it stays invisible to
    everybody who was not named on it, moderators included."""
    owner = await account(app_with_songs, "owner")
    member = await account(app_with_songs, "member")
    stranger = await account(app_with_songs, "stranger")
    helper = await moderator(app_with_songs)
    async with owner, member, stranger, helper:
        playlist = await create(owner, "Duets")
        await share(owner, str(playlist["id"]), await account_id(member), "read")

        assert [row["name"] for row in await listed(member)] == ["Duets"]
        for outsider in (stranger, helper):
            assert (await outsider.get(f"/api/v1/playlists/{playlist['id']}")).status_code == 404
            assert await listed(outsider) == []


async def test_without_moderate_somebody_else_s_global_playlist_is_403(
    app_with_songs: FastAPI,
) -> None:
    owner = await account(app_with_songs, "owner")
    other = await account(app_with_songs, "other")
    async with owner, other:
        everybodys = await create(owner, "Party", is_global=True)

        refused = await other.delete(f"/api/v1/playlists/{everybodys['id']}")

        assert refused.status_code == 403
        assert refused.json() == {"detail": "not_playlist_manager"}


async def test_a_read_member_may_look_but_neither_edit_nor_manage(
    app_with_songs: FastAPI,
) -> None:
    owner = await account(app_with_songs, "owner")
    reader = await account(app_with_songs, "reader")
    async with owner, reader:
        playlist = await create(owner, "Duets")
        playlist_id = str(playlist["id"])
        await add_entry(owner, playlist_id, SONG)
        await share(owner, playlist_id, await account_id(reader), "read")

        seen = await detail(reader, playlist_id)
        assert song_ids(seen) == [SONG]
        assert seen["my_access"] == "read"
        assert seen["followed"] is True
        assert (seen["can_edit"], seen["can_manage"]) == (False, False)

        refused = await reader.post(
            f"/api/v1/playlists/{playlist_id}/entries", json={"song_id": OTHER_SONG}
        )
        assert refused.status_code == 403
        assert refused.json() == {"detail": "not_playlist_editor"}

        unmanageable = await reader.patch(
            f"/api/v1/playlists/{playlist_id}", json={"name": "Mine now"}
        )
        assert unmanageable.status_code == 403
        assert unmanageable.json() == {"detail": "not_playlist_manager"}


async def test_a_write_member_edits_the_songs_but_not_the_playlist(
    app_with_songs: FastAPI,
) -> None:
    owner = await account(app_with_songs, "owner")
    writer = await account(app_with_songs, "writer")
    async with owner, writer:
        playlist = await create(owner, "Duets")
        playlist_id = str(playlist["id"])
        await share(owner, playlist_id, await account_id(writer), "write")

        added = await add_entry(writer, playlist_id, SONG)
        assert added["my_access"] == "write"
        assert (added["can_edit"], added["can_manage"]) == (True, False)
        assert (
            await writer.delete(f"/api/v1/playlists/{playlist_id}/entries/{SONG}")
        ).status_code == 204

        for response in (
            await writer.patch(f"/api/v1/playlists/{playlist_id}", json={"name": "Mine now"}),
            await writer.delete(f"/api/v1/playlists/{playlist_id}"),
            await writer.put(
                f"/api/v1/playlists/{playlist_id}/members",
                json={"user_id": await account_id(owner), "access": "read"},
            ),
        ):
            assert response.status_code == 403, response.text
            assert response.json() == {"detail": "not_playlist_manager"}


async def test_an_admin_member_renames_shares_and_deletes(app_with_songs: FastAPI) -> None:
    owner = await account(app_with_songs, "owner")
    deputy = await account(app_with_songs, "deputy")
    third = await account(app_with_songs, "third")
    async with owner, deputy, third:
        playlist = await create(owner, "Duets")
        playlist_id = str(playlist["id"])
        await share(owner, playlist_id, await account_id(deputy), "admin")

        renamed = await deputy.patch(f"/api/v1/playlists/{playlist_id}", json={"name": "Trios"})
        assert renamed.status_code == 200
        assert renamed.json()["my_access"] == "admin"
        assert renamed.json()["can_manage"] is True

        members = await share(deputy, playlist_id, await account_id(third), "read")
        assert [(row["username"], row["access"]) for row in members] == [
            ("deputy", "admin"),
            ("third", "read"),
        ]

        assert (await deputy.delete(f"/api/v1/playlists/{playlist_id}")).status_code == 204
        assert (await owner.get(f"/api/v1/playlists/{playlist_id}")).status_code == 404


async def test_a_member_row_only_ever_names_somebody_who_is_not_the_owner(
    app_with_songs: FastAPI,
) -> None:
    owner = await account(app_with_songs, "owner")
    async with owner:
        playlist = await create(owner, "Duets")
        playlist_id = str(playlist["id"])

        already = await owner.put(
            f"/api/v1/playlists/{playlist_id}/members",
            json={"user_id": await account_id(owner), "access": "read"},
        )
        assert already.status_code == 409
        assert already.json() == {"detail": "already_owner"}

        unknown = await owner.put(
            f"/api/v1/playlists/{playlist_id}/members",
            json={"user_id": "nobody", "access": "read"},
        )
        assert unknown.status_code == 404


async def test_sharing_creates_then_changes_and_finally_removes_the_row(
    app_with_songs: FastAPI,
) -> None:
    owner = await account(app_with_songs, "owner")
    friend = await account(app_with_songs, "friend")
    async with owner, friend:
        playlist = await create(owner, "Duets")
        playlist_id = str(playlist["id"])
        friend_id = await account_id(friend)

        created = await owner.put(
            f"/api/v1/playlists/{playlist_id}/members",
            json={"user_id": friend_id, "access": "read"},
        )
        assert created.status_code == 201

        changed = await owner.put(
            f"/api/v1/playlists/{playlist_id}/members",
            json={"user_id": friend_id, "access": "write"},
        )
        assert changed.status_code == 200
        assert [row["access"] for row in changed.json()["members"]] == ["write"]

        removed = await owner.delete(f"/api/v1/playlists/{playlist_id}/members/{friend_id}")
        assert removed.status_code == 204
        assert (await owner.get(f"/api/v1/playlists/{playlist_id}/members")).json() == {
            "members": []
        }
        assert (await friend.get(f"/api/v1/playlists/{playlist_id}")).status_code == 404

        missing = await owner.delete(f"/api/v1/playlists/{playlist_id}/members/{friend_id}")
        assert missing.status_code == 404
        assert missing.json() == {"detail": "not_a_member"}


async def test_unfollowing_hides_the_list_and_keeps_the_access(app_with_songs: FastAPI) -> None:
    """Unfollow is the member's own switch, not a way to be un-shared with: the row stays,
    so the owner does not have to grant the access again."""
    owner = await account(app_with_songs, "owner")
    friend = await account(app_with_songs, "friend")
    async with owner, friend:
        playlist = await create(owner, "Duets")
        playlist_id = str(playlist["id"])
        await share(owner, playlist_id, await account_id(friend), "write")

        assert (await friend.delete(f"/api/v1/playlists/{playlist_id}/follow")).status_code == 204

        rows = await listed(friend)
        assert [(row["name"], row["followed"], row["my_access"]) for row in rows] == [
            ("Duets", False, "write")
        ]
        # The access is untouched, so the songs are still the member's to change.
        assert (await add_entry(friend, playlist_id, SONG))["followed"] is False

        assert (await friend.put(f"/api/v1/playlists/{playlist_id}/follow")).status_code == 204
        assert (await listed(friend))[0]["followed"] is True
        # Idempotent, both ways.
        assert (await friend.put(f"/api/v1/playlists/{playlist_id}/follow")).status_code == 204


async def test_only_a_member_has_a_follow_switch(app_with_songs: FastAPI) -> None:
    """The owner always sees their own list and a plain global viewer has no row to flip."""
    owner = await account(app_with_songs, "owner")
    other = await account(app_with_songs, "other")
    async with owner, other:
        everybodys = await create(owner, "Party", is_global=True)
        playlist_id = str(everybodys["id"])

        for response in (
            await owner.delete(f"/api/v1/playlists/{playlist_id}/follow"),
            await other.delete(f"/api/v1/playlists/{playlist_id}/follow"),
        ):
            assert response.status_code == 404
            assert response.json() == {"detail": "not_a_member"}


async def test_song_id_says_which_playlists_already_hold_a_song(app_with_songs: FastAPI) -> None:
    client = await account(app_with_songs, "singer")
    async with client:
        holding = await create(client, "Aaa holding")
        await create(client, "Bbb empty")
        await add_entry(client, str(holding["id"]), SONG)

        assert [(row["name"], row["contains"]) for row in await listed(client, song_id=SONG)] == [
            ("Aaa holding", True),
            ("Bbb empty", False),
        ]
        # An unknown song is in nothing, and asking nothing leaves the field null.
        assert [row["contains"] for row in await listed(client, song_id="usdb:404")] == [
            False,
            False,
        ]
        assert [row["contains"] for row in await listed(client)] == [None, None]


async def test_a_copy_is_the_caller_s_own_private_list(app_with_songs: FastAPI) -> None:
    owner = await account(app_with_songs, "owner")
    fan = await account(app_with_songs, "fan")
    async with owner, fan:
        original = await create(owner, "Party", is_global=True, description="The good ones")
        for song in (SONG, OTHER_SONG):
            await add_entry(owner, str(original["id"]), song)
        await share(owner, str(original["id"]), await account_id(fan), "read")

        response = await fan.post(f"/api/v1/playlists/{original['id']}/copy", json={})

        assert response.status_code == 201, response.text
        copy = response.json()
        assert copy["name"] == "Party (copy)"
        assert copy["description"] == "The good ones"
        assert copy["is_global"] is False
        assert copy["my_access"] == "owner"
        assert copy["owner_username"] == "fan"
        assert song_ids(copy) == [SONG, OTHER_SONG]
        # Nobody carried over, and the original is untouched.
        assert (await fan.get(f"/api/v1/playlists/{copy['id']}/members")).json() == {"members": []}
        assert (await owner.get(f"/api/v1/playlists/{original['id']}/members")).json()["members"]

        named = await fan.post(f"/api/v1/playlists/{original['id']}/copy", json={"name": "Mine"})
        assert named.json()["name"] == "Mine"


async def test_a_copy_needs_no_body_at_all(app_with_songs: FastAPI) -> None:
    """The "Save a copy" row has nothing to say beyond the id in the path, so it sends
    nothing. An empty object works too, and both mean the default name."""
    owner = await account(app_with_songs, "owner")
    async with owner:
        original = await create(owner, "Party")
        await add_entry(owner, str(original["id"]), SONG)

        bodyless = await owner.post(f"/api/v1/playlists/{original['id']}/copy")

        assert bodyless.status_code == 201, bodyless.text
        assert bodyless.json()["name"] == "Party (copy)"
        assert song_ids(bodyless.json()) == [SONG]


async def test_a_copy_of_a_maximum_length_name_is_still_marked_as_one(
    app_with_songs: FastAPI,
) -> None:
    """The name is what gets cut back to fit, never the "(copy)" — otherwise a copy of a
    64-character list would be called exactly what it was copied from."""
    owner = await account(app_with_songs, "owner")
    async with owner:
        original = await create(owner, "x" * 64)

        copy = await owner.post(f"/api/v1/playlists/{original['id']}/copy", json={})

        assert copy.status_code == 201
        assert copy.json()["name"] == "x" * 57 + " (copy)"
        assert len(copy.json()["name"]) == 64


async def test_a_playlist_the_caller_may_not_see_cannot_be_copied(
    app_with_songs: FastAPI,
) -> None:
    """404, not 403: copying is reading, so an invisible list stays invisible — a
    moderator's included, because moderation never reaches further than looking does."""
    owner = await account(app_with_songs, "owner")
    stranger = await account(app_with_songs, "stranger")
    helper = await moderator(app_with_songs)
    async with owner, stranger, helper:
        private = await create(owner, "Secret")
        await add_entry(owner, str(private["id"]), SONG)

        for outsider in (stranger, helper):
            refused = await outsider.post(f"/api/v1/playlists/{private['id']}/copy", json={})
            assert refused.status_code == 404, refused.text
        assert [row["name"] for row in await listed(stranger)] == []


async def test_the_host_session_moderates_a_global_list_but_owns_nothing(
    app_with_songs: FastAPI,
) -> None:
    """An administrator by device, but nobody: it holds `playlists.moderate`, so a global
    list is its to tidy — and a private one is still a 404, a copy still needs an account,
    and there is no membership of its own to follow."""
    owner = await account(app_with_songs, "owner")
    await add_session(factory(app_with_songs), "host-token", is_host=True)
    async with owner, guest(app_with_songs) as boss:
        set_cookie(boss, COOKIE_NAME, "host-token")
        everybodys = await create(owner, "Party", is_global=True)
        playlist_id = str(everybodys["id"])
        private = await create(owner, "Secret")

        seen = await detail(boss, playlist_id)
        assert (seen["my_access"], seen["followed"]) == (None, False)
        assert (seen["can_edit"], seen["can_manage"]) == (True, True)
        assert (await boss.get(f"/api/v1/playlists/{playlist_id}/members")).status_code == 200

        assert (await boss.get(f"/api/v1/playlists/{private['id']}")).status_code == 404
        assert (await boss.delete(f"/api/v1/playlists/{playlist_id}/follow")).status_code == 404
        needs_an_account = await boss.post(f"/api/v1/playlists/{playlist_id}/copy", json={})
        assert needs_an_account.status_code == 401
        assert needs_an_account.json() == {"detail": "not_authenticated"}


async def test_copying_is_a_right_a_role_holds(app_with_songs: FastAPI) -> None:
    """403 rather than 401: `playlists.manage` is checked before the account is, so the
    permission matrix can see the route."""
    owner = await account(app_with_songs, "owner")
    async with owner, guest(app_with_songs) as visitor:
        everybodys = await create(owner, "Party", is_global=True)

        refused = await visitor.post(f"/api/v1/playlists/{everybodys['id']}/copy", json={})

        assert refused.status_code == 403
        assert refused.json() == {"detail": "missing_permission:playlists.manage"}


async def test_entries_are_appended_and_a_duplicate_is_409(app_with_songs: FastAPI) -> None:
    client = await account(app_with_songs, "singer")
    async with client:
        playlist = await create(client, "Party")
        playlist_id = str(playlist["id"])

        await add_entry(client, playlist_id, SONG)
        rows = await add_entry(client, playlist_id, OTHER_SONG)

        assert song_ids(rows) == [SONG, OTHER_SONG]
        assert rows["song_count"] == 2
        assert await stored_positions(app_with_songs, playlist_id) == [(SONG, 0), (OTHER_SONG, 1)]

        duplicate = await client.post(
            f"/api/v1/playlists/{playlist_id}/entries", json={"song_id": SONG}
        )
        assert duplicate.status_code == 409
        assert duplicate.json() == {"detail": "duplicate_entry"}

        unknown_song = await client.post(
            f"/api/v1/playlists/{playlist_id}/entries", json={"song_id": "usdb:404"}
        )
        assert unknown_song.status_code == 404


async def test_removing_an_entry_keeps_the_positions_dense(app_with_songs: FastAPI) -> None:
    client = await account(app_with_songs, "singer")
    async with client:
        playlist = await create(client, "Party")
        playlist_id = str(playlist["id"])
        for song in (SONG, OTHER_SONG, THIRD_SONG):
            await add_entry(client, playlist_id, song)

        removed = await client.delete(f"/api/v1/playlists/{playlist_id}/entries/{OTHER_SONG}")

        assert removed.status_code == 204
        assert await stored_positions(app_with_songs, playlist_id) == [(SONG, 0), (THIRD_SONG, 1)]
        assert song_ids(await detail(client, playlist_id)) == [SONG, THIRD_SONG]

        missing = await client.delete(f"/api/v1/playlists/{playlist_id}/entries/{OTHER_SONG}")
        assert missing.status_code == 404
        assert missing.json() == {"detail": "unknown_entry"}


async def test_reordering_must_be_a_permutation(app_with_songs: FastAPI) -> None:
    client = await account(app_with_songs, "singer")
    async with client:
        playlist = await create(client, "Party")
        playlist_id = str(playlist["id"])
        for song in (SONG, OTHER_SONG, THIRD_SONG):
            await add_entry(client, playlist_id, song)

        reordered = await client.put(
            f"/api/v1/playlists/{playlist_id}/entries",
            json={"song_ids": [THIRD_SONG, SONG, OTHER_SONG]},
        )

        assert reordered.status_code == 200
        assert song_ids(reordered.json()) == [THIRD_SONG, SONG, OTHER_SONG]
        assert await stored_positions(app_with_songs, playlist_id) == [
            (THIRD_SONG, 0),
            (SONG, 1),
            (OTHER_SONG, 2),
        ]

        # Anything but a permutation would silently add or drop songs.
        for order in ([SONG, OTHER_SONG], [SONG, OTHER_SONG, THIRD_SONG, "usdb:404"], [SONG] * 3):
            refused = await client.put(
                f"/api/v1/playlists/{playlist_id}/entries", json={"song_ids": order}
            )
            assert refused.status_code == 422, order
            assert refused.json() == {"detail": "order_mismatch"}
        assert song_ids(await detail(client, playlist_id)) == [THIRD_SONG, SONG, OTHER_SONG]


async def test_unknown_playlists_are_404(app_with_songs: FastAPI) -> None:
    client = await account(app_with_songs, "singer")
    async with client:
        assert (await client.get("/api/v1/playlists/nope")).status_code == 404
        assert (await client.patch("/api/v1/playlists/nope", json={"name": "x"})).status_code == 404
        assert (await client.delete("/api/v1/playlists/nope")).status_code == 404
        assert (
            await client.post("/api/v1/playlists/nope/entries", json={"song_id": SONG})
        ).status_code == 404
        assert (await client.get("/api/v1/playlists/nope/members")).status_code == 404
        assert (await client.put("/api/v1/playlists/nope/follow")).status_code == 404
        assert (await client.post("/api/v1/playlists/nope/copy", json={})).status_code == 404


async def test_the_name_is_trimmed_and_bounded(app_with_songs: FastAPI) -> None:
    client = await account(app_with_songs, "singer")
    async with client:
        assert (await client.post("/api/v1/playlists", json={"name": "   "})).status_code == 422
        assert (await client.post("/api/v1/playlists", json={"name": "x" * 65})).status_code == 422
        assert (
            await client.post("/api/v1/playlists", json={"name": "Party", "description": "x" * 501})
        ).status_code == 422
        assert (await create(client, "x" * 64))["name"] == "x" * 64


async def test_every_mutation_announces_the_playlist(
    app_with_songs: FastAPI, broadcast_events: list[dict[str, object]]
) -> None:
    """One event name for the lot: the client refetches, so what changed matters less than
    that something did. Ids only — the bus is anonymous."""
    owner = await account(app_with_songs, "owner")
    friend = await account(app_with_songs, "friend")
    async with owner, friend:
        playlist = await create(owner, "Party")
        playlist_id = str(playlist["id"])
        assert broadcast_events[-1] == {"event": "playlists.changed", "playlist_id": playlist_id}
        friend_id = await account_id(friend)

        for call in (
            owner.patch(f"/api/v1/playlists/{playlist_id}", json={"name": "Encore"}),
            owner.post(f"/api/v1/playlists/{playlist_id}/entries", json={"song_id": SONG}),
            owner.post(f"/api/v1/playlists/{playlist_id}/entries", json={"song_id": OTHER_SONG}),
            owner.put(
                f"/api/v1/playlists/{playlist_id}/entries",
                json={"song_ids": [OTHER_SONG, SONG]},
            ),
            owner.put(
                f"/api/v1/playlists/{playlist_id}/members",
                json={"user_id": friend_id, "access": "write"},
            ),
            friend.delete(f"/api/v1/playlists/{playlist_id}/follow"),
            friend.put(f"/api/v1/playlists/{playlist_id}/follow"),
            owner.delete(f"/api/v1/playlists/{playlist_id}/members/{friend_id}"),
            owner.delete(f"/api/v1/playlists/{playlist_id}/entries/{SONG}"),
            owner.delete(f"/api/v1/playlists/{playlist_id}"),
        ):
            broadcast_events.clear()
            await call
            assert broadcast_events == [{"event": "playlists.changed", "playlist_id": playlist_id}]


async def test_a_copy_announces_the_copy_and_not_the_original(
    app_with_songs: FastAPI, broadcast_events: list[dict[str, object]]
) -> None:
    """The original did not change; the caller's new list did."""
    owner = await account(app_with_songs, "owner")
    async with owner:
        original = await create(owner, "Party")
        broadcast_events.clear()

        copy = await owner.post(f"/api/v1/playlists/{original['id']}/copy", json={})

        assert copy.status_code == 201
        assert broadcast_events == [
            {"event": "playlists.changed", "playlist_id": copy.json()["id"]}
        ]


async def test_deleting_an_account_announces_that_several_lists_changed(
    bootstrap_settings: BootstrapSettings, broadcast_events: list[dict[str, object]]
) -> None:
    """No id: an account leaving deletes some playlists and hands others to a new owner."""
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await authenticate_admin(app)
        singer = await account(app, "singer")
        async with admin_client(app) as admin, singer:
            await create(singer, "Party")
            user_id = await account_id(singer)
            broadcast_events.clear()

            assert (await admin.delete(f"/api/v1/users/{user_id}")).status_code == 204

            assert broadcast_events == [{"event": "playlists.changed", "playlist_id": None}]


async def members_of(app: FastAPI, playlist_id: str) -> list[tuple[str, str]]:
    async with factory(app)() as session:
        rows = await session.scalars(
            select(PlaylistMember).where(PlaylistMember.playlist_id == playlist_id)
        )
        return [(row.user_id, row.access) for row in rows]


async def test_deleting_a_user_deletes_the_playlists_nobody_can_inherit(
    bootstrap_settings: BootstrapSettings,
) -> None:
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await add_songs(app, SONG)
        await authenticate_admin(app)
        singer = await account(app, "singer")
        async with admin_client(app) as admin, singer:
            playlist = await create(singer, "Party", is_global=True)
            await add_entry(singer, str(playlist["id"]), SONG)
            assert (await singer.put(f"/api/v1/favorites/{SONG}")).status_code == 204
            user = (await singer.get("/api/v1/auth/me")).json()["user"]

            assert (await admin.delete(f"/api/v1/users/{user['id']}")).status_code == 204

            async with factory(app)() as session:
                assert list(await session.scalars(select(Playlist))) == []
                assert list(await session.scalars(select(PlaylistEntry))) == []
                assert list(await session.scalars(select(Favorite))) == []


async def test_deleting_a_user_hands_their_playlist_to_its_earliest_admin(
    bootstrap_settings: BootstrapSettings,
) -> None:
    """Admin access exists so a list survives its creator. The earliest admin member gets
    it, and the row it was granted through goes — the new owner is the implicit admin."""
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await add_songs(app, SONG)
        await authenticate_admin(app)
        owner = await account(app, "owner")
        first = await account(app, "first")
        second = await account(app, "second")
        reader = await account(app, "reader")
        async with admin_client(app) as admin, owner, first, second, reader:
            playlist = await create(owner, "Party")
            playlist_id = str(playlist["id"])
            await add_entry(owner, playlist_id, SONG)
            first_id = await account_id(first)
            await share(owner, playlist_id, first_id, "admin")
            await share(owner, playlist_id, await account_id(second), "admin")
            await share(owner, playlist_id, await account_id(reader), "read")
            owner_id = (await owner.get("/api/v1/auth/me")).json()["user"]["id"]

            assert (await admin.delete(f"/api/v1/users/{owner_id}")).status_code == 204

            inherited = await detail(first, playlist_id)
            assert inherited["my_access"] == "owner"
            assert inherited["owner_username"] == "first"
            assert song_ids(inherited) == [SONG]
            # The heir's own member row is gone; everybody else keeps theirs.
            assert first_id not in [user_id for user_id, _ in await members_of(app, playlist_id)]
            assert sorted(access for _, access in await members_of(app, playlist_id)) == [
                "admin",
                "read",
            ]


async def test_deleting_a_user_drops_their_membership_of_other_lists(
    bootstrap_settings: BootstrapSettings,
) -> None:
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await authenticate_admin(app)
        owner = await account(app, "owner")
        friend = await account(app, "friend")
        async with admin_client(app) as admin, owner, friend:
            playlist = await create(owner, "Party")
            playlist_id = str(playlist["id"])
            friend_id = await account_id(friend)
            await share(owner, playlist_id, friend_id, "write")

            assert (await admin.delete(f"/api/v1/users/{friend_id}")).status_code == 204

            assert await members_of(app, playlist_id) == []
            assert (await detail(owner, playlist_id))["name"] == "Party"


async def test_looking_up_a_user_to_share_with(app_with_songs: FastAPI) -> None:
    """`/users/lookup` is identity, not a capability, so it is not in the permission matrix
    — this is where it is pinned down instead."""
    singer = await account(app_with_songs, "Singalong Sue")
    await account(app_with_songs, "Sandra")
    async with singer:
        response = await singer.get("/api/v1/users/lookup", params={"q": "sing"})

        assert response.status_code == 200, response.text
        assert [row["username"] for row in response.json()["users"]] == ["Singalong Sue"]
        # Everything the share dialog draws a row with, and nothing about rights.
        assert set(response.json()["users"][0]) == {
            "id",
            "username",
            "player_id",
            "avatar_version",
        }
        # A prefix, not a substring: "along" is inside the name but does not start it.
        assert (await singer.get("/api/v1/users/lookup", params={"q": "alon"})).json() == {
            "users": []
        }
        # One character is too little, padding does not make it two.
        assert (await singer.get("/api/v1/users/lookup", params={"q": "s"})).status_code == 422
        assert (await singer.get("/api/v1/users/lookup", params={"q": " s "})).status_code == 422


async def test_a_wildcard_in_a_lookup_is_a_character(app_with_songs: FastAPI) -> None:
    """`%` and `_` are what a name may contain, never a pattern the caller gets to write."""
    singer = await account(app_with_songs, "singer")
    async with singer:
        assert (await singer.get("/api/v1/users/lookup", params={"q": "%%"})).json() == {
            "users": []
        }
        assert (await singer.get("/api/v1/users/lookup", params={"q": "_i"})).json() == {
            "users": []
        }


async def test_the_host_session_may_look_users_up_and_a_guest_may_not(
    app_with_songs: FastAPI,
) -> None:
    await account(app_with_songs, "singer")
    await add_session(factory(app_with_songs), "host-token", is_host=True)
    async with guest(app_with_songs) as visitor:
        refused = await visitor.get("/api/v1/users/lookup", params={"q": "si"})
        assert refused.status_code == 401
        assert refused.json() == {"detail": "not_authenticated"}

        set_cookie(visitor, COOKIE_NAME, "host-token")
        allowed = await visitor.get("/api/v1/users/lookup", params={"q": "si"})
        assert allowed.status_code == 200
        assert [row["username"] for row in allowed.json()["users"]] == ["singer"]
