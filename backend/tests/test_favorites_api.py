"""Favorites: per account, persisted, and nobody else's business."""

from httpx import AsyncClient

from test_wishlist_api import OTHER_SONG, SONG, account, add_songs, guest
from ultrastar_wingman.app import create_app
from ultrastar_wingman.config import BootstrapSettings


async def favorites(client: AsyncClient) -> list[str]:
    response = await client.get("/api/v1/favorites")
    assert response.status_code == 200, response.text
    ids: list[str] = response.json()["song_ids"]
    return ids


async def test_an_anonymous_caller_is_401(bootstrap_settings: BootstrapSettings) -> None:
    """No capability to grant here: a favorite needs somebody to belong to."""
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await add_songs(app, SONG)
        async with guest(app) as client:
            assert (await client.get("/api/v1/favorites")).status_code == 401
            assert (await client.put(f"/api/v1/favorites/{SONG}")).status_code == 401
            assert (await client.delete(f"/api/v1/favorites/{SONG}")).status_code == 401


async def test_marking_and_unmarking_are_idempotent(bootstrap_settings: BootstrapSettings) -> None:
    """The UI sends a PUT on every click of a toggle; a double click must not be an error."""
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await add_songs(app, SONG, OTHER_SONG)
        client = await account(app, "singer")
        async with client:
            assert await favorites(client) == []

            assert (await client.put(f"/api/v1/favorites/{SONG}")).status_code == 204
            assert (await client.put(f"/api/v1/favorites/{SONG}")).status_code == 204
            assert (await client.put(f"/api/v1/favorites/{OTHER_SONG}")).status_code == 204
            assert await favorites(client) == [SONG, OTHER_SONG]

            assert (await client.delete(f"/api/v1/favorites/{SONG}")).status_code == 204
            assert (await client.delete(f"/api/v1/favorites/{SONG}")).status_code == 204
            assert await favorites(client) == [OTHER_SONG]


async def test_favorites_are_per_account(bootstrap_settings: BootstrapSettings) -> None:
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await add_songs(app, SONG, OTHER_SONG)
        first = await account(app, "alex")
        second = await account(app, "yannis")
        async with first, second:
            await first.put(f"/api/v1/favorites/{SONG}")
            await second.put(f"/api/v1/favorites/{OTHER_SONG}")

            assert await favorites(first) == [SONG]
            assert await favorites(second) == [OTHER_SONG]


async def test_an_unknown_song_cannot_be_favorited(bootstrap_settings: BootstrapSettings) -> None:
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        client = await account(app, "singer")
        async with client:
            assert (await client.put("/api/v1/favorites/usdb:404")).status_code == 404
            # Unmarking is not checked against the library: a favorite whose song is gone
            # still has to be removable.
            assert (await client.delete("/api/v1/favorites/usdb:404")).status_code == 204
