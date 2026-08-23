"""The shared wishlist: guest identity, aggregation, and the merge on login.

The guest cookie is the interesting part — it replaces the old app's IP-keyed wishlists,
so these tests pin down when it is issued and what logging in does with it.
"""

from collections.abc import AsyncIterator
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from conftest import (
    ADMIN_PASSWORD,
    BASE_URL,
    add_session,
    add_user,
    admin_client,
    authenticate_admin,
)
from test_songs_api import make_song
from ultrastar_wingman.app import create_app
from ultrastar_wingman.auth.deps import COOKIE_NAME, GUEST_COOKIE_MAX_AGE, GUEST_COOKIE_NAME
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.library.model import Wish
from ultrastar_wingman.songs import scanner
from ultrastar_wingman.songs.model import Song

SONG = "usdb:1234"
OTHER_SONG = "local:aaaa"
THIRD_SONG = "local:cccc"

# The host in BASE_URL. A cookie set without one lands in a second, never-sent jar entry
# that then collides with the server's own on read.
HOST = "wingman.test"


def set_cookie(client: AsyncClient, name: str, value: str) -> None:
    client.cookies.set(name, value, domain=HOST, path="/")


def factory(app: FastAPI) -> async_sessionmaker[AsyncSession]:
    session_factory: async_sessionmaker[AsyncSession] = app.state.session_factory
    return session_factory


async def add_songs(app: FastAPI, *song_ids: str) -> None:
    """Insert songs straight into the database.

    The startup scan is stopped first: it reconciles the library against disk, where these
    songs never existed, so a scan running afterwards would delete the rows again. Whether
    it got that far before being stopped is a race, so this is idempotent.
    """
    await scanner.stop_scan()
    async with factory(app)() as session:
        known = set(await session.scalars(select(Song.id)))
        session.add_all(
            make_song(song_id, "Artist", song_id) for song_id in song_ids if song_id not in known
        )
        await session.commit()


@pytest.fixture
async def app_with_songs(bootstrap_settings: BootstrapSettings) -> AsyncIterator[FastAPI]:
    """One app with a small library, so several clients can share its database."""
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await add_songs(app, SONG, OTHER_SONG, THIRD_SONG)
        yield app


def guest(app: FastAPI) -> AsyncClient:
    """A browser with no account: the wishlist is open to anonymous callers."""
    return AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL)


async def account(app: FastAPI, username: str) -> AsyncClient:
    """A logged-in `user` account, its password the shared test one."""
    user_id = await add_user(factory(app), username, "user")
    token = f"{username}-token"
    await add_session(factory(app), token, user_id)
    return AsyncClient(
        transport=ASGITransport(app=app), base_url=BASE_URL, cookies={COOKIE_NAME: token}
    )


async def wish(client: AsyncClient, song_id: str = SONG) -> dict[str, Any]:
    response = await client.post("/api/v1/wishlist", json={"song_id": song_id})
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def wishes(client: AsyncClient) -> list[dict[str, Any]]:
    """The wishlist as the API returns it. Loosely typed on purpose: these tests assert on
    the shape of the JSON, which is the contract the frontend reads."""
    response = await client.get("/api/v1/wishlist")
    assert response.status_code == 200, response.text
    listed: list[dict[str, Any]] = response.json()["wishes"]
    return listed


async def stored_wishes(app: FastAPI) -> list[Wish]:
    async with factory(app)() as session:
        return list(await session.scalars(select(Wish)))


async def test_an_anonymous_wish_issues_the_guest_cookie_once(app_with_songs: FastAPI) -> None:
    async with guest(app_with_songs) as client:
        first = await client.post("/api/v1/wishlist", json={"song_id": SONG})

        assert first.status_code == 201
        header = first.headers["set-cookie"]
        assert header.startswith(f"{GUEST_COOKIE_NAME}=")
        assert "HttpOnly" in header
        assert "SameSite=lax" in header
        assert f"Max-Age={GUEST_COOKIE_MAX_AGE}" in header
        issued = client.cookies[GUEST_COOKIE_NAME]

        # The second wish comes from the same browser: nothing new to hand out.
        second = await client.post("/api/v1/wishlist", json={"song_id": OTHER_SONG})
        assert second.status_code == 201
        assert GUEST_COOKIE_NAME not in second.headers.get("set-cookie", "")
        assert client.cookies[GUEST_COOKIE_NAME] == issued
        assert [row["mine"] for row in await wishes(client)] == [True, True]


async def test_reading_the_wishlist_never_issues_a_cookie(app_with_songs: FastAPI) -> None:
    """Every visitor collecting a cookie just for looking would be pointless."""
    singer = await account(app_with_songs, "singer")
    async with singer:
        await wish(singer, SONG)

    async with guest(app_with_songs) as client:
        response = await client.get("/api/v1/wishlist")

        assert response.status_code == 200
        assert "set-cookie" not in response.headers
        assert client.cookies.get(GUEST_COOKIE_NAME) is None
        # A browser that owns nothing owns nothing in particular: not every account's wishes.
        assert [row["mine"] for row in response.json()["wishes"]] == [False]


async def test_a_forged_guest_cookie_is_replaced(app_with_songs: FastAPI) -> None:
    """The cookie is client-supplied, so an id we did not issue is treated as absent."""
    async with guest(app_with_songs) as client:
        set_cookie(client, GUEST_COOKIE_NAME, "not-a-guest-id")

        response = await client.post("/api/v1/wishlist", json={"song_id": SONG})

        assert response.status_code == 201
        assert GUEST_COOKIE_NAME in response.headers["set-cookie"]
        assert len(client.cookies[GUEST_COOKIE_NAME]) == 32


async def test_counts_aggregate_across_guests_and_accounts(app_with_songs: FastAPI) -> None:
    singer = await account(app_with_songs, "singer")
    async with guest(app_with_songs) as first, guest(app_with_songs) as second, singer:
        await wish(first, SONG)
        await wish(second, SONG)
        await wish(singer, SONG)
        await wish(second, OTHER_SONG)

        assert [(row["song"]["id"], row["count"], row["mine"]) for row in await wishes(singer)] == [
            (SONG, 3, True),
            (OTHER_SONG, 1, False),
        ]
        # Same aggregate, different `mine`: the counts are everybody's, the flag is not.
        assert [(row["song"]["id"], row["mine"]) for row in await wishes(second)] == [
            (SONG, True),
            (OTHER_SONG, True),
        ]
        assert [(row["song"]["id"], row["mine"]) for row in await wishes(first)] == [
            (SONG, True),
            (OTHER_SONG, False),
        ]


async def test_the_wishlist_is_sorted_by_demand(app_with_songs: FastAPI) -> None:
    """Most wished for first, then most recently wished for — the party's own ranking."""
    async with guest(app_with_songs) as first, guest(app_with_songs) as second:
        await wish(first, OTHER_SONG)
        await wish(first, THIRD_SONG)
        await wish(first, SONG)
        await wish(second, SONG)

        assert [row["song"]["id"] for row in await wishes(first)] == [
            SONG,
            THIRD_SONG,
            OTHER_SONG,
        ]


async def test_the_same_identity_cannot_wish_twice(app_with_songs: FastAPI) -> None:
    async with guest(app_with_songs) as client, guest(app_with_songs) as other:
        await wish(client, SONG)

        conflict = await client.post("/api/v1/wishlist", json={"song_id": SONG})

        assert conflict.status_code == 409
        assert conflict.json() == {"detail": "already_wished"}
        # A second browser wishing for the same song is the normal case, not a conflict.
        assert (await wish(other, SONG))["count"] == 2


async def test_deleting_a_wish_removes_only_the_callers_own(app_with_songs: FastAPI) -> None:
    async with guest(app_with_songs) as first, guest(app_with_songs) as second:
        await wish(first, SONG)
        await wish(second, SONG)

        removed = await first.delete(f"/api/v1/wishlist/{SONG}")

        assert removed.status_code == 204
        assert [(row["count"], row["mine"]) for row in await wishes(second)] == [(1, True)]
        assert [(row["count"], row["mine"]) for row in await wishes(first)] == [(1, False)]


async def test_unknown_songs_and_wishes_are_404(app_with_songs: FastAPI) -> None:
    async with guest(app_with_songs) as client:
        unknown_song = await client.post("/api/v1/wishlist", json={"song_id": "usdb:404"})
        assert unknown_song.status_code == 404
        # No cookie for a request that changed nothing.
        assert client.cookies.get(GUEST_COOKIE_NAME) is None

        not_wished = await client.delete(f"/api/v1/wishlist/{SONG}")
        assert not_wished.status_code == 404
        assert not_wished.json() == {"detail": "not_wished"}


async def test_adding_and_removing_broadcast_the_new_count(
    app_with_songs: FastAPI, broadcast_events: list[dict[str, object]]
) -> None:
    async with guest(app_with_songs) as first, guest(app_with_songs) as second:
        await wish(first, SONG)
        await wish(second, SONG)
        await first.delete(f"/api/v1/wishlist/{SONG}")
        await second.delete(f"/api/v1/wishlist/{SONG}")

    updates = [event for event in broadcast_events if event["event"] == "wishlist.updated"]
    assert [(event["song_id"], event["count"]) for event in updates] == [
        (SONG, 1),
        (SONG, 2),
        (SONG, 1),
        # The last wish is gone: the UI has to drop the row, so 0 is a real payload.
        (SONG, 0),
    ]
    assert all(isinstance(event["latest"], str) for event in updates[:3])
    assert updates[-1]["latest"] is None


async def test_wishes_survive_a_restart(bootstrap_settings: BootstrapSettings) -> None:
    """The old app kept wishlists in memory, so a restart mid-party lost them."""
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await add_songs(app, SONG)
        async with guest(app) as client:
            await wish(client, SONG)
            cookie = client.cookies[GUEST_COOKIE_NAME]

    restarted = create_app(bootstrap_settings)
    async with restarted.router.lifespan_context(restarted), guest(restarted) as client:
        # The wish row itself is what has to survive.
        assert [row.song_id for row in await stored_wishes(restarted)] == [SONG]
        # And its song has to be there: the startup scan reconciles the library against
        # disk, where this test's songs only ever existed as database rows.
        await add_songs(restarted, SONG)
        set_cookie(client, GUEST_COOKIE_NAME, cookie)
        assert [(row["count"], row["mine"]) for row in await wishes(client)] == [(1, True)]


async def test_a_wish_for_a_song_that_left_the_library_is_not_listed(
    app_with_songs: FastAPI,
) -> None:
    async with guest(app_with_songs) as client:
        await wish(client, SONG)
        async with factory(app_with_songs)() as session:
            song = await session.get(Song, SONG)
            assert song is not None
            await session.delete(song)
            await session.commit()

        assert await wishes(client) == []
        # The row itself stays: nothing scans the wishlist when a song disappears.
        assert len(await stored_wishes(app_with_songs)) == 1


async def test_login_merges_the_guest_wishes_into_the_account(
    app_with_songs: FastAPI, broadcast_events: list[dict[str, object]]
) -> None:
    """Two guest wishes plus one the account already had: the account ends up with three,
    and the guest rows are gone."""
    singer = await account(app_with_songs, "singer")
    async with singer:
        await wish(singer, SONG)

    async with guest(app_with_songs) as browser:
        await wish(browser, SONG)
        await wish(browser, OTHER_SONG)
        await wish(browser, THIRD_SONG)
        guest_cookie = browser.cookies[GUEST_COOKIE_NAME]
        broadcast_events.clear()

        logged_in = await browser.post(
            "/api/v1/auth/login", json={"username": "singer", "password": ADMIN_PASSWORD}
        )

        assert logged_in.status_code == 200, logged_in.text
        assert sorted(
            (row["song"]["id"], row["count"], row["mine"]) for row in await wishes(browser)
        ) == [(OTHER_SONG, 1, True), (THIRD_SONG, 1, True), (SONG, 1, True)]
        # Every song the merge touched was announced, including the deduplicated one.
        assert {event["song_id"] for event in broadcast_events} == {SONG, OTHER_SONG, THIRD_SONG}
        # The cookie survives, but it owns nothing any more.
        assert browser.cookies[GUEST_COOKIE_NAME] == guest_cookie
        rows = await stored_wishes(app_with_songs)
        assert len(rows) == 3
        assert all(row.guest_id is None and row.user_id is not None for row in rows)


async def test_register_merges_the_guest_wishes_too(app_with_songs: FastAPI) -> None:
    async with guest(app_with_songs) as browser:
        await wish(browser, SONG)
        await wish(browser, OTHER_SONG)

        registered = await browser.post(
            "/api/v1/auth/register", json={"username": "newcomer", "password": "hunter2 hunter2"}
        )

        assert registered.status_code == 201, registered.text
        assert sorted((row["song"]["id"], row["mine"]) for row in await wishes(browser)) == [
            (OTHER_SONG, True),
            (SONG, True),
        ]
        rows = await stored_wishes(app_with_songs)
        assert [row.user_id for row in rows] == [registered.json()["id"]] * 2


async def test_a_login_without_a_guest_cookie_changes_nothing(app_with_songs: FastAPI) -> None:
    singer = await account(app_with_songs, "singer")
    async with singer:
        await wish(singer, SONG)

    async with guest(app_with_songs) as browser:
        logged_in = await browser.post(
            "/api/v1/auth/login", json={"username": "singer", "password": ADMIN_PASSWORD}
        )

        assert logged_in.status_code == 200, logged_in.text
        assert [(row["count"], row["mine"]) for row in await wishes(browser)] == [(1, True)]
        assert len(await stored_wishes(app_with_songs)) == 1


async def test_deleting_a_user_deletes_their_wishes(bootstrap_settings: BootstrapSettings) -> None:
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await add_songs(app, SONG)
        await authenticate_admin(app)
        singer = await account(app, "singer")
        async with admin_client(app) as admin, singer:
            await wish(singer, SONG)
            user = (await singer.get("/api/v1/auth/me")).json()["user"]

            assert (await admin.delete(f"/api/v1/users/{user['id']}")).status_code == 204

            assert await stored_wishes(app) == []
