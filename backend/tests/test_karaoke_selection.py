"""The player selection: the lock on the room, the phone that holds it, and the cards.

Two halves. The routes are what a phone does — open a selection, move the singers, press
Play, give it up — and the service functions are what the player selector device does, which
carries no token and is called straight from `devices.service`. The starts run against the
fake USDX of `test_karaoke_api`, so a selection that starts a song really starts one.
"""

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import test_karaoke_api
from conftest import BASE_URL, admin_client, authenticate_admin
from test_karaoke_api import FakeUsdx, add_player, sing, wait_for
from ultrastar_wingman.app import create_app
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.karaoke import selection, service
from ultrastar_wingman.karaoke.launcher import Launch
from ultrastar_wingman.players.model import Player
from ultrastar_wingman.settings import SettingsService

# The fake-USDX fixtures, bound here so pytest can resolve them by name — the same binding
# `test_achievements_triggers` does, and for the same reason: a selection's Play is the sing
# flow, and the only honest way to test it is to let a (fake) USDX start.
fake_usdx = test_karaoke_api.fake_usdx
configured = test_karaoke_api.configured
song = test_karaoke_api.song

# Two microphones: a room a test can fill with two cards.
TWO_SLOTS = "blue,red"


async def add_player_row(session: AsyncSession, name: str) -> str:
    """A player's id, written straight into the database — the device path takes ids, and
    no client is involved in it."""
    player = Player(name=name)
    session.add(player)
    await session.commit()
    return player.id


async def open_selection(
    client: AsyncClient,
    song_id: str,
    slots: list[dict[str, object]] | None = None,
    force: bool = False,
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/karaoke/selection",
        json={"song_id": song_id, "slots": slots or [], "force": force},
    )
    assert response.status_code == 201, response.text
    opened: dict[str, Any] = response.json()
    return opened


async def close_selection(client: AsyncClient, token: str | bytes) -> Response:
    """Give a selection up as its opener. The token rides in `X-Selection-Token` and never
    in the query: a URL lands in every access log on the way.

    Bytes are allowed because a header is bytes: that is how a token no browser would send
    reaches the route at all.
    """
    header = token if isinstance(token, bytes) else token.encode()
    return await client.delete("/api/v1/karaoke/selection", headers={b"X-Selection-Token": header})


def selection_events(events: list[dict[str, object]]) -> list[dict[str, Any]]:
    return [event for event in events if event["event"] == "selection.changed"]


async def two_slot_selection(session: AsyncSession, song_id: str) -> str:
    """A selection over two colors with nobody on them, opened without a phone. Returns the
    token, so a test can also speak as the opener."""
    await SettingsService(session).set("karaoke.player_colors", TWO_SLOTS)
    _, token = await selection.open_selection(session, song_id, [])
    return token


async def current_slots() -> list[dict[str, Any]]:
    current = await selection.current_selection()
    assert current is not None
    return [slot.model_dump() for slot in current.slots]


def player_names(slots: list[dict[str, Any]]) -> list[str | None]:
    return [None if slot["player"] is None else slot["player"]["name"] for slot in slots]


async def test_opening_a_selection_answers_the_hosts_slots_and_a_token(
    client: AsyncClient, song: str, broadcast_events: list[dict[str, object]]
) -> None:
    yannis = await add_player(client, "Yannis")

    opened = await open_selection(client, song, [{"color": "red", "player_id": yannis["id"]}])

    # The host's configured colors in the host's order, whatever the phone remembered.
    assert [slot["color"] for slot in opened["selection"]["slots"]] == [
        "blue",
        "red",
        "green",
        "yellow",
    ]
    assert player_names(opened["selection"]["slots"]) == [None, "Yannis", None, None]
    assert opened["selection"]["song"]["id"] == song
    assert opened["selection"]["auto_start_at"] is None
    assert opened["token"]
    # The room hears about it, and the token is the opener's alone.
    events = selection_events(broadcast_events)
    assert len(events) == 1
    assert events[0]["selection"]["song"]["id"] == song
    assert "token" not in events[0]["selection"]


async def test_a_second_selection_needs_force_and_kills_the_first_token(
    client: AsyncClient, song: str
) -> None:
    first = await open_selection(client, song)

    refused = await client.post("/api/v1/karaoke/selection", json={"song_id": song})

    assert refused.status_code == 409
    assert refused.json() == {"detail": "selection_open"}
    # Anybody who may sing may take over. The phone asks the room first; the backend does not.
    second = await open_selection(client, song, force=True)
    assert second["token"] != first["token"]
    # The old token is worth nothing on any of the three routes it used to open.
    stale = await client.put(
        "/api/v1/karaoke/selection/slots", json={"token": first["token"], "slots": []}
    )
    assert stale.status_code == 409
    assert stale.json() == {"detail": "not_the_opener"}
    stale_start = await client.post(
        "/api/v1/karaoke/selection/start", json={"token": first["token"]}
    )
    assert stale_start.status_code == 409
    assert stale_start.json() == {"detail": "not_the_opener"}
    stale_close = await close_selection(client, first["token"])
    assert stale_close.status_code == 409
    assert stale_close.json() == {"detail": "not_the_opener"}
    # The selection that took over is standing, whatever the phone before it does.
    assert (await client.get("/api/v1/karaoke/selection")).json()["selection"] is not None


async def test_a_stale_remembered_singer_still_answers_that_somebody_is_picking(
    client: AsyncClient, song: str
) -> None:
    """The phone opens with what it remembered from last night, and one of those singers
    has been deleted since. The answer it needs is still that somebody else is picking:
    that is what puts *Take over* on the screen."""
    await open_selection(client, song)

    refused = await client.post(
        "/api/v1/karaoke/selection",
        json={"song_id": song, "slots": [{"color": "blue", "player_id": "gone"}]},
    )

    assert refused.status_code == 409
    assert refused.json() == {"detail": "selection_open"}


async def test_the_selection_is_readable_without_a_token(client: AsyncClient, song: str) -> None:
    empty = await client.get("/api/v1/karaoke/selection")
    assert empty.status_code == 200
    assert empty.json() == {"selection": None}

    await open_selection(client, song)

    response = await client.get("/api/v1/karaoke/selection")
    assert response.status_code == 200
    current = response.json()["selection"]
    assert current["song"]["id"] == song
    assert "token" not in current


async def test_the_opener_moves_the_singers(
    client: AsyncClient, song: str, broadcast_events: list[dict[str, object]]
) -> None:
    alice = await add_player(client, "Alice")
    opened = await open_selection(client, song)

    response = await client.put(
        "/api/v1/karaoke/selection/slots",
        json={"token": opened["token"], "slots": [{"color": "green", "player_id": alice["id"]}]},
    )

    assert response.status_code == 200
    assert player_names(response.json()["slots"]) == [None, None, "Alice", None]
    assert player_names(selection_events(broadcast_events)[-1]["selection"]["slots"]) == [
        None,
        None,
        "Alice",
        None,
    ]


async def test_a_card_on_a_reader_beats_the_remembered_slot(
    session: AsyncSession, song: str
) -> None:
    """The phone remembers who sang last time; the cards say who is standing there now."""
    alice = await add_player_row(session, "Alice")
    bob = await add_player_row(session, "Bob")

    await selection.open_selection(
        session,
        song,
        [service.SlotRequest(color="blue", player_id=alice)],
        device_slots={
            "blue": selection.CardOnSlot(uid="A1", player_id=bob),
            "red": selection.CardOnSlot(uid="B2", player_id=None),
        },
    )

    slots = await current_slots()
    assert player_names(slots) == ["Bob", None, None, None]
    assert [slot["card_uid"] for slot in slots] == ["A1", "B2", None, None]
    # A card nobody owns still holds its slot: the TV says "unknown card" instead of empty.
    assert slots[1]["player"] is None


async def test_the_selection_starts_the_song_and_is_over(
    client: AsyncClient,
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    yannis = await add_player(client, "Yannis")
    opened = await open_selection(client, song, [{"color": "blue", "player_id": yannis["id"]}])

    response = await client.post("/api/v1/karaoke/selection/start", json={"token": opened["token"]})

    assert response.status_code == 202, response.text
    assert response.json()["song"]["id"] == song
    await wait_for(configured.argv_file)
    assert (await client.get("/api/v1/karaoke/selection")).json() == {"selection": None}
    # The song is up before the selection is taken down: a client that draws both never sees
    # a room with neither.
    names = [event["event"] for event in broadcast_events]
    over = len(names) - 1 - names[::-1].index("selection.changed")
    assert names.index("karaoke.started") < over
    assert selection_events(broadcast_events)[-1]["selection"] is None
    await service.wait_for_sing_end()


async def test_a_failing_start_leaves_the_selection_standing(
    client: AsyncClient, session: AsyncSession, song: str
) -> None:
    """Nobody on any slot: the sing flow refuses it, and the phone gets to fix that."""
    opened = await open_selection(client, song)

    response = await client.post("/api/v1/karaoke/selection/start", json={"token": opened["token"]})

    assert response.status_code == 422
    assert (await client.get("/api/v1/karaoke/selection")).json()["selection"] is not None


async def test_starting_without_a_selection_or_with_a_stale_token(
    client: AsyncClient, song: str
) -> None:
    gone = await client.post("/api/v1/karaoke/selection/start", json={"token": "nope"})
    assert gone.status_code == 404
    assert gone.json() == {"detail": "no_selection"}

    await open_selection(client, song)

    taken = await client.post("/api/v1/karaoke/selection/start", json={"token": "nope"})
    assert taken.status_code == 409
    assert taken.json() == {"detail": "not_the_opener"}


async def test_a_sing_does_not_play_over_a_selection(
    client: AsyncClient, configured: FakeUsdx, song: str
) -> None:
    yannis = await add_player(client, "Yannis")
    await open_selection(client, song)

    blocked = await client.post(
        "/api/v1/karaoke/sing",
        json={"song_id": song, "slots": [{"color": "blue", "player_id": yannis["id"]}]},
    )

    assert blocked.status_code == 409
    assert blocked.json() == {"detail": "selection_open"}
    # `force` is what takes the machine, here as everywhere else.
    forced = await client.post(
        "/api/v1/karaoke/sing",
        json={
            "song_id": song,
            "slots": [{"color": "blue", "player_id": yannis["id"]}],
            "force": True,
        },
    )
    assert forced.status_code == 202, forced.text
    await wait_for(configured.argv_file)
    await service.wait_for_sing_end()


async def test_the_opener_gives_the_selection_up(client: AsyncClient, song: str) -> None:
    opened = await open_selection(client, song)

    response = await close_selection(client, opened["token"])

    assert response.status_code == 204
    assert (await client.get("/api/v1/karaoke/selection")).json() == {"selection": None}
    # An unmounting phone must not have to look first.
    again = await close_selection(client, opened["token"])
    assert again.status_code == 204


async def test_the_host_screen_cancels_somebody_elses_selection(
    client: AsyncClient, song: str
) -> None:
    await open_selection(client, song)

    response = await client.delete("/api/v1/karaoke/selection")

    assert response.status_code == 204
    assert (await client.get("/api/v1/karaoke/selection")).json() == {"selection": None}


async def test_nobody_closes_somebody_elses_selection_with_the_wrong_token(
    bootstrap_settings: BootstrapSettings, session: AsyncSession, song: str
) -> None:
    """Taking somebody else's selection down without a token is the host screen's cancel:
    `karaoke.stop`. A guest may open and sing, so the route itself is open to them.

    A token is a claim to be the opener, and a stale one is refused whoever sends it: a
    phone that was taken over must not close the selection that took its place, and holding
    `karaoke.stop` does not turn its old token into the new one.
    """
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await authenticate_admin(app)
        async with (
            admin_client(app) as owner,
            AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL) as guest,
        ):
            await open_selection(owner, song)

            refused = await guest.delete("/api/v1/karaoke/selection")

            assert refused.status_code == 403
            assert refused.json() == {"detail": "missing_permission:karaoke.stop"}
            for client in (guest, owner):
                stale = await close_selection(client, "nope")
                assert stale.status_code == 409
                assert stale.json() == {"detail": "not_the_opener"}
            assert (await owner.get("/api/v1/karaoke/selection")).json()["selection"] is not None


async def test_the_token_in_the_query_is_not_read(
    bootstrap_settings: BootstrapSettings, song: str
) -> None:
    """`?token=` is gone: it landed in every access log on the way. A caller who may sing
    but not stop the room is refused with their own token in the URL, which is the only way
    to prove the query is nothing now."""
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await authenticate_admin(app)
        async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL) as guest:
            opened = await open_selection(guest, song)

            refused = await guest.delete(f"/api/v1/karaoke/selection?token={opened['token']}")

            assert refused.status_code == 403
            assert refused.json() == {"detail": "missing_permission:karaoke.stop"}
            assert (await guest.get("/api/v1/karaoke/selection")).json()["selection"] is not None
            # The same token in the header gives the selection up.
            assert (await close_selection(guest, opened["token"])).status_code == 204


async def test_a_token_that_is_not_ascii_is_refused_rather_than_a_crash(
    client: AsyncClient, song: str
) -> None:
    """`compare_digest` refuses to compare non-ASCII strings, and a phone can put anything
    at all in that field.

    The header carries its bytes: everything above ASCII arrives as the latin-1 string
    Starlette decodes it to, which is non-ASCII all the same.
    """
    await open_selection(client, song)

    for response in (
        await client.put("/api/v1/karaoke/selection/slots", json={"token": "ä", "slots": []}),
        await client.post("/api/v1/karaoke/selection/start", json={"token": "ä"}),
        await close_selection(client, "ä".encode()),
    ):
        assert response.status_code == 409, response.text
        assert response.json() == {"detail": "not_the_opener"}


async def test_a_selection_nobody_touches_is_dropped(
    client: AsyncClient,
    song: str,
    broadcast_events: list[dict[str, object]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await open_selection(client, song)
    monkeypatch.setattr(
        selection,
        "_now",
        lambda: datetime.now(UTC) + selection.DEFAULT_IDLE_TTL + timedelta(seconds=1),
    )

    response = await client.get("/api/v1/karaoke/selection")

    assert response.json() == {"selection": None}
    assert selection_events(broadcast_events)[-1]["selection"] is None


async def test_the_watchdog_drops_a_stale_selection_and_says_so_once(
    client: AsyncClient,
    song: str,
    broadcast_events: list[dict[str, object]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`expire_stale` is what the device watchdog calls, so the TV clears itself while
    nobody asks anything at all. The room hears about it exactly once."""
    await open_selection(client, song)
    monkeypatch.setattr(
        selection,
        "_now",
        lambda: datetime.now(UTC) + selection.DEFAULT_IDLE_TTL + timedelta(seconds=1),
    )

    await selection.expire_stale()
    await selection.expire_stale()

    assert await selection.current_selection() is None
    # The first event is the selection opening; after it, one "nothing is being picked".
    assert [event["selection"] for event in selection_events(broadcast_events)][1:] == [None]


async def test_shutdown_drops_the_selection(session: AsyncSession, song: str) -> None:
    """Wingman going down takes the room's selection with it: nothing survives the process
    that the next start would have to guess at."""
    await selection.open_selection(session, song, [])

    await service.shutdown()

    assert await selection.current_selection() is None


async def test_a_card_on_a_slot_puts_its_player_there(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    alice = await add_player_row(session, "Alice")
    await two_slot_selection(session, song)

    await selection.card_placed_on_slot(session_factory, "red", "A1", alice)

    assert player_names(await current_slots()) == [None, "Alice"]
    assert player_names(selection_events(broadcast_events)[-1]["selection"]["slots"]) == [
        None,
        "Alice",
    ]


async def test_a_card_nobody_owns_holds_its_slot(
    session: AsyncSession, session_factory: async_sessionmaker[AsyncSession], song: str
) -> None:
    await two_slot_selection(session, song)

    await selection.card_placed_on_slot(session_factory, "blue", "A1")

    slots = await current_slots()
    assert slots[0]["player"] is None
    assert slots[0]["card_uid"] == "A1"


async def test_a_card_takes_its_player_off_the_slot_they_stood_on(
    session: AsyncSession, session_factory: async_sessionmaker[AsyncSession], song: str
) -> None:
    """One person sings on one microphone: moving a card moves the singer."""
    alice = await add_player_row(session, "Alice")
    await two_slot_selection(session, song)
    await selection.card_placed_on_slot(session_factory, "blue", "A1", alice)

    await selection.card_placed_on_slot(session_factory, "red", "A1", alice)

    assert player_names(await current_slots()) == [None, "Alice"]


async def test_nothing_happens_at_the_device_without_a_selection(
    session: AsyncSession, session_factory: async_sessionmaker[AsyncSession], song: str
) -> None:
    alice = await add_player_row(session, "Alice")

    await selection.card_placed_on_slot(session_factory, "blue", "A1", alice)
    await selection.card_scanned(session_factory, "A1", alice)
    await selection.button_pressed(session, session_factory, "clear")

    assert await selection.current_selection() is None


async def test_a_card_leaving_empties_only_the_slot_it_is_still_on(
    session: AsyncSession, session_factory: async_sessionmaker[AsyncSession], song: str
) -> None:
    alice = await add_player_row(session, "Alice")
    await two_slot_selection(session, song)
    await selection.card_placed_on_slot(session_factory, "blue", "A1", alice)

    # Another card's uid, on the right slot: not this card, so not this slot's business.
    await selection.card_removed_from_slot("blue", "B2")
    assert player_names(await current_slots()) == ["Alice", None]

    await selection.card_removed_from_slot("blue", "A1")
    assert player_names(await current_slots()) == [None, None]


async def test_a_slot_the_phone_repointed_survives_its_card_leaving(
    session: AsyncSession, session_factory: async_sessionmaker[AsyncSession], song: str
) -> None:
    alice = await add_player_row(session, "Alice")
    bob = await add_player_row(session, "Bob")
    token = await two_slot_selection(session, song)
    await selection.card_placed_on_slot(session_factory, "blue", "A1", alice)

    await selection.set_slots(session, token, [service.SlotRequest(color="blue", player_id=bob)])
    await selection.card_removed_from_slot("blue", "A1")

    assert player_names(await current_slots()) == ["Bob", None]


async def test_a_card_lifted_after_the_phone_moved_its_singer_leaves_them_standing(
    session: AsyncSession, session_factory: async_sessionmaker[AsyncSession], song: str
) -> None:
    """The phone put Alice on the other microphone while her card still lay on the first
    reader. Lifting it is the card leaving that reader, not Alice leaving the room."""
    alice = await add_player_row(session, "Alice")
    token = await two_slot_selection(session, song)
    await selection.card_placed_on_slot(session_factory, "blue", "A1", alice)

    await selection.set_slots(session, token, [service.SlotRequest(color="red", player_id=alice)])
    await selection.card_removed_from_slot("blue", "A1")

    assert player_names(await current_slots()) == [None, "Alice"]


async def test_a_tap_elsewhere_leaves_an_unknown_card_where_it_lies(
    session: AsyncSession, session_factory: async_sessionmaker[AsyncSession], song: str
) -> None:
    """The phone draws an unknown card and sends the slot back as empty, because a card is
    not something it knows. That must not take the card off the slot."""
    bob = await add_player_row(session, "Bob")
    token = await two_slot_selection(session, song)
    await selection.card_placed_on_slot(session_factory, "blue", "A1")

    await selection.set_slots(session, token, [service.SlotRequest(color="red", player_id=bob)])

    slots = await current_slots()
    assert slots[0]["card_uid"] == "A1"
    assert player_names(slots) == [None, "Bob"]
    # And it is still that card's slot: taking the card away empties it.
    await selection.card_removed_from_slot("blue", "A1")
    assert (await current_slots())[0]["card_uid"] is None


async def test_naming_an_unknown_card_puts_its_player_on_the_slot_it_lies_on(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    """The host names the card on the admin page while it lies on the reader. The device
    reports nothing new — the card has not moved — so this is what fills the slot."""
    alice = await add_player_row(session, "Alice")
    await two_slot_selection(session, song)
    await selection.card_placed_on_slot(session_factory, "blue", "A1")

    await selection.card_identified(session_factory, "A1", alice)

    slots = await current_slots()
    assert player_names(slots) == ["Alice", None]
    # Still her card's slot: lifting it now empties it, as it would have all along.
    assert slots[0]["card_uid"] == "A1"
    assert player_names(selection_events(broadcast_events)[-1]["selection"]["slots"]) == [
        "Alice",
        None,
    ]


async def test_naming_a_card_takes_its_player_off_the_slot_they_stood_on(
    session: AsyncSession, session_factory: async_sessionmaker[AsyncSession], song: str
) -> None:
    """One person sings on one microphone: the same eviction a placed card makes."""
    alice = await add_player_row(session, "Alice")
    await two_slot_selection(session, song)
    await selection.card_placed_on_slot(session_factory, "red", "A1", alice)
    await selection.card_placed_on_slot(session_factory, "blue", "B2")

    await selection.card_identified(session_factory, "B2", alice)

    assert player_names(await current_slots()) == ["Alice", None]


async def test_naming_a_card_no_slot_holds_changes_nothing(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    alice = await add_player_row(session, "Alice")
    await two_slot_selection(session, song)
    await selection.card_placed_on_slot(session_factory, "blue", "A1", alice)
    before = len(selection_events(broadcast_events))

    # A card lying nowhere, and a card lying somewhere given to a player who is gone.
    await selection.card_identified(session_factory, "C3", alice)
    await selection.card_identified(session_factory, "A1", "nobody")

    assert player_names(await current_slots()) == ["Alice", None]
    assert len(selection_events(broadcast_events)) == before


async def test_naming_the_last_unknown_card_starts_the_full_room(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
) -> None:
    """Two people at the selector, one card Wingman did not know. Naming it fills the room,
    and a room that is full starts by itself."""
    alice = await add_player_row(session, "Alice")
    bob = await add_player_row(session, "Bob")
    await two_slot_selection(session, song)
    now = selection.AutoStart(delay_s=0)
    await selection.card_placed_on_slot(session_factory, "blue", "A1", alice, auto_start=now)
    await selection.card_placed_on_slot(session_factory, "red", "B2", auto_start=now)
    counting = await selection.current_selection()
    assert counting is not None and counting.auto_start_at is None

    await selection.card_identified(session_factory, "B2", bob, auto_start=now)

    await selection.wait_for_auto_start()
    await wait_for(configured.argv_file)
    assert await selection.current_selection() is None
    await service.wait_for_sing_end()


async def test_forgetting_a_card_leaves_it_lying_on_its_slot_as_an_unknown_one(
    session: AsyncSession, session_factory: async_sessionmaker[AsyncSession], song: str
) -> None:
    """The host said the card is nobody's. It is still on the reader and its owner is still
    standing there, so the slot holds the card and no longer holds a singer."""
    alice = await add_player_row(session, "Alice")
    await two_slot_selection(session, song)
    await selection.card_placed_on_slot(session_factory, "blue", "A1", alice)

    await selection.card_forgotten("A1")

    slots = await current_slots()
    assert player_names(slots) == [None, None]
    assert slots[0]["card_uid"] == "A1"
    await selection.card_removed_from_slot("blue", "A1")
    assert (await current_slots())[0]["card_uid"] is None


async def test_forgetting_a_card_stops_the_countdown(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
) -> None:
    alice = await add_player_row(session, "Alice")
    bob = await add_player_row(session, "Bob")
    await two_slot_selection(session, song)
    later = selection.AutoStart(delay_s=30)
    await selection.card_placed_on_slot(session_factory, "blue", "A1", alice, auto_start=later)
    await selection.card_placed_on_slot(session_factory, "red", "B2", bob, auto_start=later)

    await selection.card_forgotten("B2")

    stopped = await selection.current_selection()
    assert stopped is not None and stopped.auto_start_at is None
    await asyncio.wait_for(selection.wait_for_auto_start(), timeout=5)
    assert not configured.argv_file.exists()


async def test_singers_in_turn_fill_the_slots_in_order(
    session: AsyncSession, session_factory: async_sessionmaker[AsyncSession], song: str
) -> None:
    alice = await add_player_row(session, "Alice")
    bob = await add_player_row(session, "Bob")
    carol = await add_player_row(session, "Carol")
    await two_slot_selection(session, song)

    await selection.card_scanned(session_factory, "A1", alice)
    await selection.card_scanned(session_factory, "B2", bob)
    # The room is full: the third card finds nowhere to go.
    await selection.card_scanned(session_factory, "C3", carol)

    assert player_names(await current_slots()) == ["Alice", "Bob"]


async def test_scanning_again_takes_a_singer_off_their_slot(
    session: AsyncSession, session_factory: async_sessionmaker[AsyncSession], song: str
) -> None:
    alice = await add_player_row(session, "Alice")
    await two_slot_selection(session, song)
    await selection.card_scanned(session_factory, "A1", alice)

    await selection.card_scanned(session_factory, "A1", alice, rescan_removes=True)
    assert player_names(await current_slots()) == [None, None]

    # With the setting off, a second scan is somebody checking their card works.
    await selection.card_scanned(session_factory, "A1", alice)
    await selection.card_scanned(session_factory, "A1", alice, rescan_removes=False)
    assert player_names(await current_slots()) == ["Alice", None]


async def test_the_buttons_clear_and_cancel_the_selection(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    alice = await add_player_row(session, "Alice")
    await two_slot_selection(session, song)
    await selection.card_scanned(session_factory, "A1", alice)

    await selection.button_pressed(session, session_factory, "clear")
    assert player_names(await current_slots()) == [None, None]

    await selection.button_pressed(session, session_factory, "cancel")
    assert await selection.current_selection() is None
    assert selection_events(broadcast_events)[-1]["selection"] is None


async def test_the_start_button_starts_the_song(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    alice = await add_player_row(session, "Alice")
    await two_slot_selection(session, song)
    await selection.card_scanned(session_factory, "A1", alice)

    await selection.button_pressed(session, session_factory, "start")

    await wait_for(configured.argv_file)
    assert await selection.current_selection() is None
    assert any(event["event"] == "karaoke.started" for event in broadcast_events)
    await service.wait_for_sing_end()


async def test_the_start_button_with_nobody_on_a_slot_is_logged_and_not_raised(
    session: AsyncSession, session_factory: async_sessionmaker[AsyncSession], song: str
) -> None:
    """Nobody is on the other end of a button: the selection stands and the room tries
    again."""
    await two_slot_selection(session, song)

    await selection.button_pressed(session, session_factory, "start")

    assert await selection.current_selection() is not None


async def test_a_full_room_starts_by_itself(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    alice = await add_player_row(session, "Alice")
    bob = await add_player_row(session, "Bob")
    await two_slot_selection(session, song)
    now = selection.AutoStart(delay_s=0)

    await selection.card_placed_on_slot(session_factory, "blue", "A1", alice, auto_start=now)
    # One microphone still free: nothing is counting down yet.
    current = await selection.current_selection()
    assert current is not None and current.auto_start_at is None

    await selection.card_placed_on_slot(session_factory, "red", "B2", bob, auto_start=now)

    await selection.wait_for_auto_start()
    await wait_for(configured.argv_file)
    assert await selection.current_selection() is None
    assert any(event["event"] == "karaoke.started" for event in broadcast_events)
    await service.wait_for_sing_end()


async def test_an_unknown_card_does_not_start_anything(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
) -> None:
    """A full room of *known* players is what starts by itself. Wingman has no name to
    write into USDX for a card it does not know."""
    alice = await add_player_row(session, "Alice")
    await two_slot_selection(session, song)
    now = selection.AutoStart(delay_s=0)

    await selection.card_placed_on_slot(session_factory, "blue", "A1", alice, auto_start=now)
    await selection.card_placed_on_slot(session_factory, "red", "B2", auto_start=now)

    await selection.wait_for_auto_start()
    current = await selection.current_selection()
    assert current is not None and current.auto_start_at is None
    assert not configured.argv_file.exists()


async def test_taking_a_card_away_stops_the_countdown(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
) -> None:
    """The delay is exactly the moment to take a wrong card off the selector."""
    alice = await add_player_row(session, "Alice")
    bob = await add_player_row(session, "Bob")
    await two_slot_selection(session, song)
    later = selection.AutoStart(delay_s=30)

    await selection.card_placed_on_slot(session_factory, "blue", "A1", alice, auto_start=later)
    await selection.card_placed_on_slot(session_factory, "red", "B2", bob, auto_start=later)
    counting = await selection.current_selection()
    assert counting is not None and counting.auto_start_at is not None

    await selection.card_removed_from_slot("red", "B2")

    stopped = await selection.current_selection()
    assert stopped is not None and stopped.auto_start_at is None
    # Nothing is left to fire: the countdown was cancelled, not merely forgotten. Waiting on
    # it returns at once — a task that is still counting would hold this for 30 seconds.
    await asyncio.wait_for(selection.wait_for_auto_start(), timeout=5)
    assert not configured.argv_file.exists()


async def test_a_takeover_kills_the_countdown_the_last_selection_started(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
) -> None:
    """Somebody takes the room over while the last selection is counting down. That
    countdown belongs to a selection nobody can see any more, and it must not start the
    song the new one is only just picking singers for."""
    alice = await add_player_row(session, "Alice")
    bob = await add_player_row(session, "Bob")
    await two_slot_selection(session, song)
    later = selection.AutoStart(delay_s=30)
    await selection.card_placed_on_slot(session_factory, "blue", "A1", alice, auto_start=later)
    await selection.card_placed_on_slot(session_factory, "red", "B2", bob, auto_start=later)

    await selection.open_selection(session, song, [], force=True)

    await asyncio.wait_for(selection.wait_for_auto_start(), timeout=5)
    taken_over = await selection.current_selection()
    assert taken_over is not None and taken_over.auto_start_at is None
    assert player_names(await current_slots()) == [None, None]
    assert not configured.argv_file.exists()


async def test_a_selection_that_opens_on_a_full_selector_starts_by_itself(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
) -> None:
    """Everybody is already standing at the selector with their card down. Waiting for one
    of them to lift a card and put it back again would be a joke."""
    alice = await add_player_row(session, "Alice")
    bob = await add_player_row(session, "Bob")
    await SettingsService(session).set("karaoke.player_colors", TWO_SLOTS)

    await selection.open_selection(
        session,
        song,
        [],
        device_slots={
            "blue": selection.CardOnSlot(uid="A1", player_id=alice),
            "red": selection.CardOnSlot(uid="B2", player_id=bob),
        },
        session_factory=session_factory,
        auto_start=selection.AutoStart(delay_s=0),
    )

    await selection.wait_for_auto_start()
    await wait_for(configured.argv_file)
    assert await selection.current_selection() is None
    await service.wait_for_sing_end()


async def test_a_room_the_phone_remembered_starts_nothing(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
) -> None:
    """The same full room, filled from the phone's memory instead of from the readers. A
    phone has Play, and `set_slots` starts no countdown either."""
    alice = await add_player_row(session, "Alice")
    bob = await add_player_row(session, "Bob")
    await SettingsService(session).set("karaoke.player_colors", TWO_SLOTS)

    await selection.open_selection(
        session,
        song,
        [
            service.SlotRequest(color="blue", player_id=alice),
            service.SlotRequest(color="red", player_id=bob),
        ],
        session_factory=session_factory,
        auto_start=selection.AutoStart(delay_s=0),
    )

    current = await selection.current_selection()
    assert current is not None and current.auto_start_at is None
    assert not configured.argv_file.exists()


async def test_a_forced_sing_takes_the_room_and_ends_the_selection(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    """`force` means "take the machine". The TV must not keep showing a selection for a
    song nobody is going to sing."""
    await two_slot_selection(session, song)
    alice = await add_player(client, "Alice")

    await sing(client, song, [{"color": "blue", "player_id": alice["id"]}], force=True)

    await wait_for(configured.argv_file)
    assert await selection.current_selection() is None
    assert selection_events(broadcast_events)[-1]["selection"] is None
    await service.wait_for_sing_end()


class BlockingLauncher:
    """A launcher whose `start` hangs until the test lets it go.

    A forced start really does span a USDX exit and a score import, so this is what the
    selection lock would be held across if `start_selection` still held it.
    """

    def __init__(self, paths: Any) -> None:
        self.on_exit: Any = None
        self.started = asyncio.Event()
        self.release = asyncio.Event()
        self._running = False

    @property
    def is_running(self) -> bool:
        return self._running

    async def start(self, song_dir: Path, slots: Any) -> Any:
        self.started.set()
        await self.release.wait()
        self._running = True
        return Launch(pid=1, song_dir=song_dir)

    async def start_standalone(self) -> Any:
        raise NotImplementedError

    async def stop(self) -> None:
        self._running = False
        if self.on_exit is not None:
            on_exit, self.on_exit = self.on_exit, None
            await on_exit()


async def test_the_room_keeps_going_while_a_start_is_in_progress(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Play was pressed and USDX is coming up. The player selector keeps reporting every
    five seconds all the while, and none of it may wait behind the sing flow."""
    alice = await add_player_row(session, "Alice")
    bob = await add_player_row(session, "Bob")
    token = await two_slot_selection(session, song)
    await selection.card_placed_on_slot(session_factory, "blue", "A1", alice)
    launcher = BlockingLauncher(None)
    monkeypatch.setattr(service, "UsdxLauncher", lambda paths: launcher)

    start = asyncio.create_task(selection.start_selection(session, session_factory, token))
    await asyncio.wait_for(launcher.started.wait(), timeout=5)

    # A card arriving mid-start is answered, not queued behind USDX.
    await asyncio.wait_for(
        selection.card_placed_on_slot(session_factory, "red", "B2", bob), timeout=5
    )

    launcher.release.set()
    await asyncio.wait_for(start, timeout=5)
    assert await selection.current_selection() is None
    await service.stop_sing()
    await service.wait_for_sing_end()
