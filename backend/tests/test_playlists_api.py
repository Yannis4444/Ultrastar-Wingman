"""Playlists: ownership, sharing, and keeping the entry positions dense."""

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
from ultrastar_wingman.library.model import Favorite, Playlist, PlaylistEntry


@pytest.fixture
async def app_with_songs(bootstrap_settings: BootstrapSettings) -> AsyncIterator[FastAPI]:
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await add_songs(app, SONG, OTHER_SONG, THIRD_SONG)
        yield app


async def create(client: AsyncClient, name: str, shared: bool = False) -> dict[str, Any]:
    response = await client.post("/api/v1/playlists", json={"name": name, "shared": shared})
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


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
        playlist = await create(client, "  Party  ")
        assert playlist["name"] == "Party"
        assert playlist == {
            "id": playlist["id"],
            "name": "Party",
            "shared": False,
            "owner_username": "singer",
            "song_count": 0,
            "mine": True,
        }

        listed = await client.get("/api/v1/playlists")
        assert listed.json() == {"playlists": [playlist]}

        renamed = await client.patch(
            f"/api/v1/playlists/{playlist['id']}", json={"name": "Encore", "shared": True}
        )
        assert renamed.status_code == 200
        assert renamed.json()["name"] == "Encore"
        assert renamed.json()["shared"] is True

        assert (await detail(client, str(playlist["id"])))["entries"] == []

        assert (await client.delete(f"/api/v1/playlists/{playlist['id']}")).status_code == 204
        assert (await client.get("/api/v1/playlists")).json() == {"playlists": []}


async def test_a_playlist_needs_an_account(app_with_songs: FastAPI) -> None:
    """401, not 403: a playlist has to belong to somebody, so "log in" is the useful answer
    rather than "the guest role lacks a capability it could never hold"."""
    async with guest(app_with_songs) as client:
        refused = await client.post("/api/v1/playlists", json={"name": "Party"})

        assert refused.status_code == 401
        assert refused.json() == {"detail": "not_authenticated"}
        # Viewing is still open to guests: shared playlists are for everybody.
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
        shared = await create(owner, "Singalong", shared=True)

        assert [
            row["name"] for row in (await other.get("/api/v1/playlists")).json()["playlists"]
        ] == ["Singalong"]
        assert (await other.get(f"/api/v1/playlists/{private['id']}")).status_code == 404
        visible = await detail(other, str(shared["id"]))
        # Shared, but still somebody else's.
        assert visible["mine"] is False
        assert visible["owner_username"] == "owner"


async def test_a_non_owner_may_view_a_shared_playlist_but_not_change_it(
    app_with_songs: FastAPI,
) -> None:
    owner = await account(app_with_songs, "owner")
    other = await account(app_with_songs, "other")
    async with owner, other:
        shared = await create(owner, "Singalong", shared=True)
        await add_entry(owner, str(shared["id"]), SONG)
        playlist_id = shared["id"]

        assert song_ids(await detail(other, str(playlist_id))) == [SONG]
        for response in (
            await other.patch(f"/api/v1/playlists/{playlist_id}", json={"name": "Mine now"}),
            await other.delete(f"/api/v1/playlists/{playlist_id}"),
            await other.post(
                f"/api/v1/playlists/{playlist_id}/entries", json={"song_id": OTHER_SONG}
            ),
            await other.delete(f"/api/v1/playlists/{playlist_id}/entries/{SONG}"),
            await other.put(f"/api/v1/playlists/{playlist_id}/entries", json={"song_ids": [SONG]}),
        ):
            assert response.status_code == 403, response.text
            assert response.json() == {"detail": "not_playlist_owner"}


async def test_mutating_somebody_elses_private_playlist_is_404(app_with_songs: FastAPI) -> None:
    """403 would confirm the playlist exists, which is exactly what a private one hides."""
    owner = await account(app_with_songs, "owner")
    other = await account(app_with_songs, "other")
    async with owner, other:
        private = await create(owner, "Secret")

        refused = await other.delete(f"/api/v1/playlists/{private['id']}")

        assert refused.status_code == 404


async def test_an_admin_may_change_anybody_s_playlist(app_with_songs: FastAPI) -> None:
    owner = await account(app_with_songs, "owner")
    admin_user = await add_user(factory(app_with_songs), "boss", "admin")
    await add_session(factory(app_with_songs), "boss-token", admin_user)
    admin = guest(app_with_songs)
    set_cookie(admin, COOKIE_NAME, "boss-token")
    async with owner, admin:
        private = await create(owner, "Secret")

        renamed = await admin.patch(
            f"/api/v1/playlists/{private['id']}", json={"name": "Moderated"}
        )

        assert renamed.status_code == 200
        assert renamed.json()["name"] == "Moderated"
        # Somebody else's playlist, so not the admin's own.
        assert renamed.json()["mine"] is False


async def test_entries_are_appended_and_a_duplicate_is_409(app_with_songs: FastAPI) -> None:
    client = await account(app_with_songs, "singer")
    async with client:
        playlist = await create(client, "Party")
        playlist_id = str(playlist["id"])

        await add_entry(client, playlist_id, SONG)
        listed = await add_entry(client, playlist_id, OTHER_SONG)

        assert song_ids(listed) == [SONG, OTHER_SONG]
        assert listed["song_count"] == 2
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


async def test_the_name_is_trimmed_and_bounded(app_with_songs: FastAPI) -> None:
    client = await account(app_with_songs, "singer")
    async with client:
        assert (await client.post("/api/v1/playlists", json={"name": "   "})).status_code == 422
        assert (await client.post("/api/v1/playlists", json={"name": "x" * 65})).status_code == 422
        assert (await create(client, "x" * 64))["name"] == "x" * 64


async def test_deleting_a_user_deletes_their_playlists_and_favorites(
    bootstrap_settings: BootstrapSettings,
) -> None:
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await add_songs(app, SONG)
        await authenticate_admin(app)
        singer = await account(app, "singer")
        async with admin_client(app) as admin, singer:
            playlist = await create(singer, "Party", shared=True)
            await add_entry(singer, str(playlist["id"]), SONG)
            assert (await singer.put(f"/api/v1/favorites/{SONG}")).status_code == 204
            user = (await singer.get("/api/v1/auth/me")).json()["user"]

            assert (await admin.delete(f"/api/v1/users/{user['id']}")).status_code == 204

            async with factory(app)() as session:
                assert list(await session.scalars(select(Playlist))) == []
                assert list(await session.scalars(select(PlaylistEntry))) == []
                assert list(await session.scalars(select(Favorite))) == []
