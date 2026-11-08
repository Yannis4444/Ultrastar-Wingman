"""The shared wishlist: guest identity, aggregation, and the merge on login.

The guest cookie is the interesting part — it replaces the old app's IP-keyed wishlists,
so these tests pin down when it is issued and what logging in does with it.
"""

from collections.abc import AsyncIterator, Sequence
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
from ultrastar_wingman.karaoke import reel
from ultrastar_wingman.karaoke.weighting import FAIR_WISHES
from ultrastar_wingman.library import service as library
from ultrastar_wingman.library.model import Wish
from ultrastar_wingman.players.model import Player
from ultrastar_wingman.songs import scanner
from ultrastar_wingman.songs.model import Song
from ultrastar_wingman.tags import service as tags

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


async def test_clearing_a_song_drops_every_account_s_and_every_guest_s_wish(
    app_with_songs: FastAPI, broadcast_events: list[dict[str, object]]
) -> None:
    """What starting a song does to the wishlist (`test_karaoke_api` drives the same call
    through the sing flow): two accounts and a phone without one wished for it, and all
    three wishes go. Another song's wish stays."""
    one = await account(app_with_songs, "one")
    two = await account(app_with_songs, "two")
    async with one, two, guest(app_with_songs) as browser:
        await wish(one, SONG)
        await wish(two, SONG)
        await wish(browser, SONG)
        await wish(browser, OTHER_SONG)

        async with factory(app_with_songs)() as session:
            dropped = await library.clear_wishes(session, SONG)

    assert dropped == 3
    assert [row.song_id for row in await stored_wishes(app_with_songs)] == [OTHER_SONG]
    updates = [event for event in broadcast_events if event["event"] == "wishlist.updated"]
    assert (updates[-1]["song_id"], updates[-1]["count"]) == (SONG, 0)


async def test_clearing_the_wishes_of_a_song_nobody_wished_for_says_nothing(
    app_with_songs: FastAPI, broadcast_events: list[dict[str, object]]
) -> None:
    """Every start would otherwise make every client refetch the wishlist for nothing."""
    async with factory(app_with_songs)() as session:
        assert await library.clear_wishes(session, SONG) == 0

    assert [event for event in broadcast_events if event["event"] == "wishlist.updated"] == []


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


async def test_clearing_a_song_drops_everybody_s_wishes(
    app_with_songs: FastAPI, broadcast_events: list[dict[str, object]]
) -> None:
    """The host's answer to a wish the party is not going to sing: one song off the list,
    whoever put it there. `wishlist.manage` is seeded to `trusted` and up, so an
    administrator has it."""
    await authenticate_admin(app_with_songs)
    one = await account(app_with_songs, "one")
    two = await account(app_with_songs, "two")
    async with one, two, admin_client(app_with_songs) as admin:
        await wish(one, SONG)
        await wish(two, SONG)
        await wish(one, OTHER_SONG)

        cleared = await admin.delete(f"/api/v1/wishlist/{SONG}/wishes")

        assert cleared.status_code == 204
        assert [row["song"]["id"] for row in await wishes(admin)] == [OTHER_SONG]
        assert [row.song_id for row in await stored_wishes(app_with_songs)] == [OTHER_SONG]
    # The count reached zero, which is what tells every open page to drop the row.
    updates = [event for event in broadcast_events if event["event"] == "wishlist.updated"]
    assert updates[-1] == {
        "event": "wishlist.updated",
        "song_id": SONG,
        "count": 0,
        "latest": None,
    }


async def test_clearing_a_song_nobody_wished_for_is_404(app_with_songs: FastAPI) -> None:
    await authenticate_admin(app_with_songs)
    async with admin_client(app_with_songs) as admin:
        response = await admin.delete(f"/api/v1/wishlist/{SONG}/wishes")

        assert response.status_code == 404
        assert response.json() == {"detail": "not_wished"}


async def test_a_plain_account_may_not_clear_somebody_else_s_wish(
    app_with_songs: FastAPI,
) -> None:
    """`wishlist.add` takes back your own wish and nothing more — clearing the song for
    everybody is `wishlist.manage`, which a `user` does not hold."""
    one = await account(app_with_songs, "one")
    two = await account(app_with_songs, "two")
    async with one, two:
        await wish(one, SONG)

        refused = await two.delete(f"/api/v1/wishlist/{SONG}/wishes")

        assert refused.status_code == 403
        assert refused.json() == {"detail": "missing_permission:wishlist.manage"}
        assert len(await stored_wishes(app_with_songs)) == 1


# A hidden player's wishes. Only an account's wish leads to a player (`Player.user_id`), so
# these tests give an account a player of its own the way registering does.


async def singer(app: FastAPI, username: str) -> tuple[AsyncClient, str]:
    """A logged-in `user` account that sings as a player of its own, and that player's id."""
    user_id = await add_user(factory(app), username, "user")
    token = f"{username}-token"
    await add_session(factory(app), token, user_id)
    async with factory(app)() as session:
        player = Player(name=username, registered=True, user_id=user_id)
        session.add(player)
        await session.commit()
        player_id = player.id
    client = AsyncClient(
        transport=ASGITransport(app=app), base_url=BASE_URL, cookies={COOKIE_NAME: token}
    )
    return client, player_id


async def set_hidden(admin: AsyncClient, player_id: str, hidden: bool) -> None:
    response = await admin.patch(f"/api/v1/players/{player_id}", json={"hidden": hidden})
    assert response.status_code == 200, response.text


def listed(rows: list[dict[str, Any]]) -> list[tuple[str, int, bool]]:
    return [(row["song"]["id"], row["count"], row["mine"]) for row in rows]


def wishlist_updates(events: list[dict[str, object]]) -> list[tuple[object, object]]:
    return [
        (event["song_id"], event["count"])
        for event in events
        if event["event"] == "wishlist.updated"
    ]


async def test_a_hidden_player_s_wishes_leave_the_wishlist_until_they_are_shown_again(
    app_with_songs: FastAPI,
) -> None:
    """Filtered, never deleted: showing the player again brings every wish back. A guest's
    wish has no player behind it and is never touched."""
    await authenticate_admin(app_with_songs)
    alice, alice_player = await singer(app_with_songs, "alice")
    async with alice, guest(app_with_songs) as browser, admin_client(app_with_songs) as admin:
        await wish(alice, SONG)
        await wish(alice, OTHER_SONG)
        await wish(browser, OTHER_SONG)

        await set_hidden(admin, alice_player, True)

        assert listed(await wishes(browser)) == [(OTHER_SONG, 1, True)]
        assert listed(await wishes(admin)) == [(OTHER_SONG, 1, False)]
        # Her own phone still counts her own wishes, so it marks them and can take them back.
        assert sorted(listed(await wishes(alice))) == [(OTHER_SONG, 2, True), (SONG, 1, True)]
        assert len(await stored_wishes(app_with_songs)) == 3

        await set_hidden(admin, alice_player, False)

        assert listed(await wishes(browser)) == [(OTHER_SONG, 2, True), (SONG, 1, False)]


async def test_a_hidden_player_can_still_take_their_own_wish_back(
    app_with_songs: FastAPI,
) -> None:
    await authenticate_admin(app_with_songs)
    alice, alice_player = await singer(app_with_songs, "alice")
    async with alice, admin_client(app_with_songs) as admin:
        await wish(alice, SONG)
        await set_hidden(admin, alice_player, True)

        assert (await alice.delete(f"/api/v1/wishlist/{SONG}")).status_code == 204
        assert await stored_wishes(app_with_songs) == []


async def test_a_hidden_player_s_new_wish_counts_for_them_and_for_nobody_else(
    app_with_songs: FastAPI, broadcast_events: list[dict[str, object]]
) -> None:
    """The answer is the caller's own listing; the event is everybody's."""
    await authenticate_admin(app_with_songs)
    alice, alice_player = await singer(app_with_songs, "alice")
    async with alice, guest(app_with_songs) as browser, admin_client(app_with_songs) as admin:
        await wish(browser, SONG)
        await set_hidden(admin, alice_player, True)
        broadcast_events.clear()

        created = await wish(alice, SONG)

        assert (created["count"], created["mine"]) == (2, True)
        assert wishlist_updates(broadcast_events) == [(SONG, 1)]


async def test_hiding_and_showing_a_player_announce_the_songs_they_wished_for(
    app_with_songs: FastAPI, broadcast_events: list[dict[str, object]]
) -> None:
    """`wishlist.updated` is what every phone's wishlist and reel refetch on, with the count
    as everybody now counts it."""
    await authenticate_admin(app_with_songs)
    alice, alice_player = await singer(app_with_songs, "alice")
    async with alice, guest(app_with_songs) as browser, admin_client(app_with_songs) as admin:
        await wish(alice, SONG)
        await wish(alice, OTHER_SONG)
        await wish(browser, OTHER_SONG)
        broadcast_events.clear()

        await set_hidden(admin, alice_player, True)
        assert wishlist_updates(broadcast_events) == [(OTHER_SONG, 1), (SONG, 0)]
        broadcast_events.clear()

        await set_hidden(admin, alice_player, False)
        assert wishlist_updates(broadcast_events) == [(OTHER_SONG, 2), (SONG, 1)]


async def test_a_hide_that_changes_nothing_announces_no_wishes(
    app_with_songs: FastAPI, broadcast_events: list[dict[str, object]]
) -> None:
    """Hiding a hidden player, or showing a shown one, moves no count: no phone refetches."""
    await authenticate_admin(app_with_songs)
    alice, alice_player = await singer(app_with_songs, "alice")
    async with alice, admin_client(app_with_songs) as admin:
        await wish(alice, SONG)
        broadcast_events.clear()

        await set_hidden(admin, alice_player, False)
        assert wishlist_updates(broadcast_events) == []

        await set_hidden(admin, alice_player, True)
        broadcast_events.clear()
        await set_hidden(admin, alice_player, True)
        assert wishlist_updates(broadcast_events) == []


async def test_deleting_a_hidden_player_brings_their_account_s_wishes_back(
    app_with_songs: FastAPI, broadcast_events: list[dict[str, object]]
) -> None:
    """Without a player row nothing names the account as hidden, so its wishes count again,
    and every phone is told so."""
    await authenticate_admin(app_with_songs)
    alice, alice_player = await singer(app_with_songs, "alice")
    async with alice, admin_client(app_with_songs) as admin:
        await wish(alice, SONG)
        await set_hidden(admin, alice_player, True)
        assert await wishes(admin) == []
        broadcast_events.clear()

        assert (await admin.delete(f"/api/v1/players/{alice_player}")).status_code == 204

        assert listed(await wishes(admin)) == [(SONG, 1, False)]
        assert wishlist_updates(broadcast_events) == [(SONG, 1)]


async def test_hiding_a_player_without_an_account_announces_no_wishes(
    app_with_songs: FastAPI, broadcast_events: list[dict[str, object]]
) -> None:
    """A temporary player wishes as nobody: an anonymous phone's wish has a guest cookie
    behind it and no player, so there is nothing of theirs to take out of the list."""
    await authenticate_admin(app_with_songs)
    async with guest(app_with_songs) as browser, admin_client(app_with_songs) as admin:
        await wish(browser, SONG)
        created = await admin.post("/api/v1/players", json={"name": "Bob"})
        assert created.status_code == 201, created.text
        broadcast_events.clear()

        await set_hidden(admin, created.json()["id"], True)

        assert wishlist_updates(broadcast_events) == []
        assert listed(await wishes(browser)) == [(SONG, 1, True)]


async def test_logging_in_brings_a_hidden_player_s_wishes_back(
    app_with_songs: FastAPI, broadcast_events: list[dict[str, object]]
) -> None:
    await authenticate_admin(app_with_songs)
    alice, alice_player = await singer(app_with_songs, "alice")
    async with alice, guest(app_with_songs) as browser, admin_client(app_with_songs) as admin:
        await wish(alice, SONG)
        await set_hidden(admin, alice_player, True)
        assert await wishes(admin) == []
        broadcast_events.clear()

        logged_in = await browser.post(
            "/api/v1/auth/login", json={"username": "alice", "password": ADMIN_PASSWORD}
        )

        assert logged_in.status_code == 200, logged_in.text
        assert listed(await wishes(admin)) == [(SONG, 1, False)]
        assert wishlist_updates(broadcast_events) == [(SONG, 1)]


def record_draws(monkeypatch: pytest.MonkeyPatch) -> list[list[tuple[str, float]]]:
    """Record every draw the reel makes as its sorted ids, each with its weight rounded to
    four places, and land on the first."""
    draws: list[list[tuple[str, float]]] = []

    def choices(
        population: Sequence[str],
        weights: Sequence[float] | None = None,
        *,
        cum_weights: Sequence[float] | None = None,
        k: int = 1,
    ) -> list[str]:
        assert weights is not None
        draws.append(
            [
                (song_id, round(weight, 4))
                for song_id, weight in zip(population, weights, strict=True)
            ]
        )
        return [population[0]]

    monkeypatch.setattr(reel.random, "choices", choices)
    return draws


async def set_fair_wishes(admin: AsyncClient, on: bool) -> None:
    response = await admin.patch(f"/api/v1/settings/{FAIR_WISHES}", json={"value": on})
    assert response.status_code == 200, response.text


def weighed(rows: list[dict[str, Any]]) -> dict[str, tuple[int, float]]:
    """Song id to its count and its weight, rounded to four places."""
    return {row["song"]["id"]: (row["count"], round(row["weight"], 4)) for row in rows}


async def test_a_wish_weighs_less_the_more_wishes_its_owner_holds(
    app_with_songs: FastAPI,
) -> None:
    """Fair wishes, on by default: one wish of somebody holding `n` weighs (1 + ln n) / n,
    a guest's cookie is an owner of its own, and a song two owners wished for weighs both of
    their wishes. Off, a song weighs its count again."""
    await authenticate_admin(app_with_songs)
    alice = await account(app_with_songs, "alice")
    async with alice, guest(app_with_songs) as browser, admin_client(app_with_songs) as admin:
        await wish(alice, SONG)
        await wish(alice, OTHER_SONG)
        await wish(alice, THIRD_SONG)
        created = await wish(browser, SONG)

        # The answer to the wish weighs it the way the listing does.
        assert round(created["weight"], 4) == 1.6995
        # Alice holds three, so each of hers weighs (1 + ln 3) / 3; the guest holds one.
        expected = {SONG: (2, 1.6995), OTHER_SONG: (1, 0.6995), THIRD_SONG: (1, 0.6995)}
        assert weighed(await wishes(browser)) == expected
        # The same numbers on every phone: a weight does not depend on who reads.
        assert weighed(await wishes(admin)) == expected

        await set_fair_wishes(admin, False)

        assert weighed(await wishes(browser)) == {
            SONG: (2, 2.0),
            OTHER_SONG: (1, 1.0),
            THIRD_SONG: (1, 1.0),
        }


async def test_a_hidden_player_s_wishes_count_towards_nobody_s_number_of_wishes(
    app_with_songs: FastAPI,
) -> None:
    """Hidden, Alice owns no wishes in the room's pool, so the one she shares with the guest
    weighs the guest's alone — and her own phone weighs her own wishes in, as its count
    already does."""
    await authenticate_admin(app_with_songs)
    alice, alice_player = await singer(app_with_songs, "alice")
    async with alice, guest(app_with_songs) as browser, admin_client(app_with_songs) as admin:
        await wish(alice, SONG)
        await wish(alice, OTHER_SONG)
        await wish(browser, SONG)

        await set_hidden(admin, alice_player, True)

        assert weighed(await wishes(browser)) == {SONG: (1, 1.0)}
        assert weighed(await wishes(alice)) == {SONG: (2, 1.8466), OTHER_SONG: (1, 0.8466)}


async def test_a_song_gone_from_the_library_leaves_its_wisher_s_number_of_wishes(
    app_with_songs: FastAPI,
) -> None:
    """A wish whose song left the library is nobody's wish in the reel, so the wisher's
    other wishes weigh as if they held one fewer."""
    async with guest(app_with_songs) as browser:
        await wish(browser, SONG)
        await wish(browser, OTHER_SONG)
        assert weighed(await wishes(browser)) == {SONG: (1, 0.8466), OTHER_SONG: (1, 0.8466)}

        async with factory(app_with_songs)() as session:
            song = await session.get(Song, OTHER_SONG)
            assert song is not None
            await session.delete(song)
            await session.commit()

        assert weighed(await wishes(browser)) == {SONG: (1, 1.0)}


async def test_the_weighted_reel_draws_with_the_wishlist_s_weights(
    app_with_songs: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Every scope but the weighted one weighs each song the same; the weighted one weighs
    it what the listing says, and the switch off is one per wish."""
    draws = record_draws(monkeypatch)
    await authenticate_admin(app_with_songs)
    alice = await account(app_with_songs, "alice")
    async with alice, guest(app_with_songs) as browser, admin_client(app_with_songs) as admin:
        await wish(alice, SONG)
        await wish(alice, OTHER_SONG)
        await wish(browser, SONG)

        async with factory(app_with_songs)() as session:
            await reel.pick_song(session, "wishlist", tags.GUEST_VIEWER)
            await reel.pick_song(session, "weighted", tags.GUEST_VIEWER)
        await set_fair_wishes(admin, False)
        async with factory(app_with_songs)() as session:
            await reel.pick_song(session, "weighted", tags.GUEST_VIEWER)

    assert draws == [
        [(OTHER_SONG, 1.0), (SONG, 1.0)],
        [(OTHER_SONG, 0.8466), (SONG, 1.8466)],
        [(OTHER_SONG, 1.0), (SONG, 2.0)],
    ]


async def test_no_spin_picks_from_a_hidden_player_s_wishes(
    app_with_songs: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The top wish (the selector's start button) and both wishlist scopes of the reel (the
    TV's spin, the start button's random song, the background music) read the wishlist as
    nobody in particular, so a hidden player's own wish is never in them — nor in anybody's
    weight, because it counts towards nobody's number of wishes."""
    pools = record_draws(monkeypatch)

    async def top_and_pools() -> tuple[str | None, list[list[tuple[str, float]]]]:
        pools.clear()
        async with factory(app_with_songs)() as session:
            top = await reel.top_wish(session, tags.GUEST_VIEWER)
            await reel.pick_song(session, "wishlist", tags.GUEST_VIEWER)
            await reel.pick_song(session, "weighted", tags.GUEST_VIEWER)
        return None if top is None else top.id, [list(pool) for pool in pools]

    await authenticate_admin(app_with_songs)
    alice, alice_player = await singer(app_with_songs, "alice")
    friend = await account(app_with_songs, "friend")
    async with alice, friend, guest(app_with_songs) as browser:
        await wish(alice, SONG)
        await wish(alice, THIRD_SONG)
        await wish(friend, SONG)
        # Last, so it wins a tie of counts on being the newer wish.
        await wish(browser, OTHER_SONG)
    # The pools as `pick_song` sorts them: local:aaaa, local:cccc, usdb:1234. Alice holds two
    # wishes, so each of hers weighs (1 + ln 2) / 2 on the weighted scope; her friend and the
    # guest one each, which weighs 1.
    # Rounded to four places, as `record_draws` records them.
    everybody = (
        SONG,
        [
            [(OTHER_SONG, 1.0), (THIRD_SONG, 1.0), (SONG, 1.0)],
            [(OTHER_SONG, 1.0), (THIRD_SONG, 0.8466), (SONG, 1.8466)],
        ],
    )

    assert await top_and_pools() == everybody

    async with admin_client(app_with_songs) as admin:
        await set_hidden(admin, alice_player, True)
    assert await top_and_pools() == (
        OTHER_SONG,
        [[(OTHER_SONG, 1.0), (SONG, 1.0)], [(OTHER_SONG, 1.0), (SONG, 1.0)]],
    )

    async with admin_client(app_with_songs) as admin:
        await set_hidden(admin, alice_player, False)
    assert await top_and_pools() == everybody
