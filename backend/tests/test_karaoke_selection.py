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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import test_karaoke_api
from conftest import BASE_URL, admin_client, authenticate_admin
from test_karaoke_api import FakeUsdx, add_player, make_song_dir, sing, wait_for
from ultrastar_wingman.app import create_app
from ultrastar_wingman.auth import permissions
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.karaoke import reel, selection, service
from ultrastar_wingman.karaoke.launcher import Launch
from ultrastar_wingman.library.model import Wish
from ultrastar_wingman.players.model import Player
from ultrastar_wingman.settings import SettingsService
from ultrastar_wingman.songs.model import Song
from ultrastar_wingman.tags.service import Viewer

# The reel as the selector's start button spins it: no account behind it at all.
GUEST = Viewer(role=permissions.DEFAULT_ROLE, user_id=None)

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


async def open_spin(
    client: AsyncClient,
    scope: str,
    playlist_id: str | None = None,
    slots: list[dict[str, object]] | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """Open a selection by letting the server pick the song."""
    response = await client.post(
        "/api/v1/karaoke/selection",
        json={
            "spin": {"scope": scope, "playlist_id": playlist_id},
            "slots": slots or [],
            "force": force,
        },
    )
    assert response.status_code == 201, response.text
    opened: dict[str, Any] = response.json()
    return opened


async def respin(client: AsyncClient, token: str | None) -> Response:
    """Spin again as the opener — or, with no token, as a phone that has none."""
    headers = {} if token is None else {"X-Selection-Token": token}
    return await client.post("/api/v1/karaoke/selection/spin", headers=headers)


async def pick(client: AsyncClient, token: str | None) -> Response:
    """Move on from the reel to picking singers, as the opener."""
    headers = {} if token is None else {"X-Selection-Token": token}
    return await client.post("/api/v1/karaoke/selection/pick", headers=headers)


# A moment after the reel on the host screen has landed by itself.
LANDED = timedelta(seconds=selection.REVEAL_SECONDS) + timedelta(milliseconds=500)


def frozen_clock(monkeypatch: pytest.MonkeyPatch) -> list[datetime]:
    """Stop the selection module's clock, so a test says whether a press lands while the
    reel is still running or after it — rather than racing five and a half real seconds.
    Returns the one-element list that holds the time: `clock[0] += LANDED` moves it. The
    devices module keeps its own clock; a frozen one here leaves reports and heartbeats
    alone."""
    clock = [datetime.now(UTC)]
    monkeypatch.setattr(selection, "_now", lambda: clock[0])
    return clock


async def add_second_song(session: AsyncSession, configured: FakeUsdx) -> str:
    """One more song in the library, so "the top wish", "a random one" and every reel scope
    have something to choose between."""
    directory = make_song_dir(configured.songs_dir, "Other - Other")
    song = Song(
        id="usdb:9999",
        source="usdb",
        source_id="9999",
        title="Other",
        artist="Other",
        fingerprint="other|other",
        directory=str(directory),
        txt_file=str(directory / "song.txt"),
    )
    session.add(song)
    await session.commit()
    return song.id


def pick_last(monkeypatch: pytest.MonkeyPatch) -> list[list[str]]:
    """Make the reel land on the last candidate, and record what it had to choose from.

    The ids are sorted before the choice, so "the last one" is the greatest id whatever
    SQLite hands back — and the recorded lists are what a scope's pool is, a song repeated
    where it counts more than once.
    """
    pools: list[list[str]] = []

    def choice(candidates: list[str]) -> str:
        pools.append(list(candidates))
        return candidates[-1]

    monkeypatch.setattr(reel.random, "choice", choice)
    return pools


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


async def test_a_slot_a_card_holds_is_not_the_phones_to_repoint(
    session: AsyncSession, session_factory: async_sessionmaker[AsyncSession], song: str
) -> None:
    """The card in somebody's hand decides that microphone. A tap that says otherwise is
    answered with what the reader says, and refused nothing: the phone drew the slot as the
    card's and its next redraw agrees again."""
    alice = await add_player_row(session, "Alice")
    bob = await add_player_row(session, "Bob")
    token = await two_slot_selection(session, song)
    await selection.card_placed_on_slot(session_factory, "blue", "A1", alice)

    answered = await selection.set_slots(
        session, token, [service.SlotRequest(color="blue", player_id=bob)]
    )

    assert [slot.player.name for slot in answered.slots if slot.player is not None] == ["Alice"]
    assert answered.slots[0].card_uid == "A1"
    # And it is still the card's slot: lifting the card is what empties it.
    await selection.card_removed_from_slot("blue", "A1")
    assert player_names(await current_slots()) == [None, None]

    # With the card gone the slot is the phone's again, which is the other half of the rule:
    # the cards hold what they lie on, and nothing more.
    given = await selection.set_slots(
        session, token, [service.SlotRequest(color="blue", player_id=bob)]
    )
    assert [slot.player.name for slot in given.slots if slot.player is not None] == ["Bob"]
    assert given.slots[0].card_uid is None


async def test_a_put_written_before_a_card_landed_does_not_take_the_singer_off(
    session: AsyncSession, session_factory: async_sessionmaker[AsyncSession], song: str
) -> None:
    """The phone sends the whole assignment on every tap. One already on the wire when a
    card lands says nothing about that slot, and must not read as "the phone took them
    off"."""
    bob = await add_player_row(session, "Bob")
    token = await two_slot_selection(session, song)
    await selection.card_placed_on_slot(session_factory, "blue", "B2", bob)

    # A body from a moment ago: no blue at all.
    await selection.set_slots(session, token, [])

    slots = await current_slots()
    assert player_names(slots) == ["Bob", None]
    assert slots[0]["card_uid"] == "B2"


async def test_the_phone_cannot_put_a_cards_singer_on_a_second_microphone(
    session: AsyncSession, session_factory: async_sessionmaker[AsyncSession], song: str
) -> None:
    """One person sings on one microphone, and the card is what decides which: the slot the
    phone named goes empty rather than the room holding Bob twice."""
    bob = await add_player_row(session, "Bob")
    token = await two_slot_selection(session, song)
    await selection.card_placed_on_slot(session_factory, "blue", "B2", bob)

    await selection.set_slots(session, token, [service.SlotRequest(color="red", player_id=bob)])

    slots = await current_slots()
    assert player_names(slots) == ["Bob", None]
    assert slots[0]["card_uid"] == "B2"


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


async def test_the_selection_the_start_button_opens_belongs_to_nobody(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A `top_wish` press at a quiet room opens a selection and starts it in the same breath,
    so no token is ever handed out. A start that fails leaves nothing standing either: the
    phone finds an empty room, not a song nobody can press Play on.
    """
    alice = await add_player_row(session, "Alice")
    await SettingsService(session).set("karaoke.player_colors", TWO_SLOTS)
    session.add(Wish(song_id=song, guest_id="a-guest-cookie"))
    await session.commit()
    # A launcher that refuses, so the start comes back without a selection to inspect.
    monkeypatch.setattr(service, "start_sing", refuse_to_start)

    await selection.button_pressed(
        session,
        session_factory,
        "start",
        without_selection=selection.StartWithoutSelection(
            mode="top_wish", cards={"blue": selection.CardOnSlot(uid="A1", player_id=alice)}
        ),
    )

    assert await selection.current_selection() is None
    # And the room is not locked: the next phone opens one without having to force it.
    opened, _ = await selection.open_selection(session, song, [])
    assert opened.song.id == song


async def refuse_to_start(*args: Any, **kwargs: Any) -> None:
    raise service.AlreadyPlayingError


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

    async def start(self, song_txt: Path, slots: Any) -> Any:
        self.started.set()
        await self.release.wait()
        self._running = True
        return Launch(pid=1, song_txt=song_txt)

    async def start_standalone(self) -> Any:
        raise NotImplementedError

    async def stop(self) -> None:
        self._running = False
        if self.on_exit is not None:
            on_exit, self.on_exit = self.on_exit, None
            await on_exit()

    def bring_to_front(self) -> None:
        pass


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
    monkeypatch.setattr(service, "UsdxLauncher", lambda paths, **options: launcher)

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


# --- the reel on the host screen ---------------------------------------------------------


async def test_a_spin_opens_the_selection_on_a_song_the_server_picked(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
    broadcast_events: list[dict[str, object]],
) -> None:
    """The phone names a scope and the server picks: the selection opens on that song with
    the reel's first spin on it, and the room hears about the spin like about everything
    else — the viewer it was picked for excepted."""
    other = await add_second_song(session, configured)
    pools = pick_last(monkeypatch)
    alice = await add_player(client, "Alice")

    opened = await open_spin(client, "all", slots=[{"color": "red", "player_id": alice["id"]}])

    assert opened["selection"]["song"]["id"] == max(song, other)
    assert pools == [sorted([song, other])]
    spin = opened["selection"]["spin"]
    assert spin["id"] == 1
    assert spin["scope"] == "all"
    assert spin["playlist_id"] is None
    # Aware, and UTC: the phone times its reveal off this, and a naive stamp would be read
    # as local time by some clients and as UTC by others. Never stored, so unlike the
    # timestamps that come back off SQLite it needs no `as_utc` on the way out.
    assert datetime.fromisoformat(spin["spun_at"]).utcoffset() == timedelta(0)
    assert "viewer" not in spin
    # A spin is a selection like any other: the slots, the token, the countdown that is not.
    assert player_names(opened["selection"]["slots"]) == [None, "Alice", None, None]
    assert opened["selection"]["auto_start_at"] is None
    assert opened["token"]
    events = selection_events(broadcast_events)
    assert events[-1]["selection"]["spin"]["id"] == 1
    assert "viewer" not in events[-1]["selection"]["spin"]
    # And a selection opened with a song carries no spin at all.
    plain = await open_selection(client, song, force=True)
    assert plain["selection"]["spin"] is None


async def test_every_scope_picks_out_of_its_own_pool(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """What each scope has to choose from, as the phone's own reel documents it: the hearts
    of the caller, the wished songs once each or as often as they were wished for, and the
    songs of one playlist."""
    other = await add_second_song(session, configured)
    pools = pick_last(monkeypatch)
    assert (await client.put(f"/api/v1/favorites/{other}")).status_code == 204
    assert (await client.post("/api/v1/wishlist", json={"song_id": song})).status_code == 201
    assert (await client.post("/api/v1/wishlist", json={"song_id": other})).status_code == 201
    # A second wish for the fixture's song, from a phone with no account.
    session.add(Wish(song_id=song, guest_id="a-guest-cookie"))
    await session.commit()
    created = await client.post("/api/v1/playlists", json={"name": "Party"})
    assert created.status_code == 201, created.text
    playlist_id = created.json()["id"]
    entry = await client.post(f"/api/v1/playlists/{playlist_id}/entries", json={"song_id": song})
    assert entry.status_code == 201, entry.text

    favorites = await open_spin(client, "favorites")
    assert favorites["selection"]["song"]["id"] == other
    wishlist = await open_spin(client, "wishlist", force=True)
    assert wishlist["selection"]["song"]["id"] == max(song, other)
    weighted = await open_spin(client, "weighted", force=True)
    assert weighted["selection"]["song"]["id"] == max(song, other)
    playlist = await open_spin(client, "playlist", playlist_id=playlist_id, force=True)
    assert playlist["selection"]["song"]["id"] == song
    assert playlist["selection"]["spin"]["playlist_id"] == playlist_id

    # The pools themselves: a wished song counts once on the wishlist and as often as it was
    # wished for when weighted, and the candidates are sorted before every choice.
    assert pools == [
        [other],
        sorted([song, other]),
        sorted([song, song, other]),
        [song],
    ]


async def test_a_spin_hands_the_reels_song_to_the_music(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The host screen plays the song the reel lands on: the music learns the song, where
    its preview starts and when the reel lands, keeps it once the spin comes off, and lets
    go when the selection does."""
    from ultrastar_wingman.music import service as music_service

    row = await session.get(Song, song)
    assert row is not None
    row.audio_file = str(Path(row.directory) / "song.mp3")
    row.preview_start_seconds = 33.0
    row.replay_gain_db, row.replay_gain_peak = -6.5, 0.9
    await session.commit()

    opened = await open_spin(client, "all")
    token = opened["token"]
    state = await music_service.read()
    assert state.preview is not None
    assert state.preview.song.id == song
    assert state.preview.start_s == 33.0
    # The gain the host plays it at, off the same row (`downloads.loudness`).
    assert (state.preview.gain_db, state.preview.peak) == (-6.5, 0.9)
    spun_at = datetime.fromisoformat(opened["selection"]["spin"]["spun_at"])
    assert state.preview.reveal_at == spun_at + timedelta(seconds=selection.REVEAL_SECONDS)
    first = state.preview.id

    # The spin comes off: the song keeps playing while the singers are picked.
    assert (await pick(client, token)).status_code == 200
    state = await music_service.read()
    assert state.preview is not None
    assert state.preview.id == first
    assert (state.preview.gain_db, state.preview.peak) == (-6.5, 0.9)

    # The selection is given up: so is the song.
    assert (await close_selection(client, token)).status_code == 204
    assert (await music_service.read()).preview is None


async def test_a_selection_opened_with_a_song_hands_the_music_its_gain(
    client: AsyncClient, session: AsyncSession, song: str
) -> None:
    from ultrastar_wingman.music import service as music_service

    await give_audio(session, song)
    row = await session.get(Song, song)
    assert row is not None
    row.replay_gain_db, row.replay_gain_peak = 2.25, 0.5
    await session.commit()

    await open_selection(client, song)

    state = await music_service.read()
    assert state.preview is not None
    assert (state.preview.gain_db, state.preview.peak) == (2.25, 0.5)


async def give_audio(session: AsyncSession, song_id: str, preview_start: float = 33.0) -> None:
    """A file for the host screen to play, and where its preview starts."""
    row = await session.get(Song, song_id)
    assert row is not None
    row.audio_file = str(Path(row.directory) / "song.mp3")
    row.preview_start_seconds = preview_start
    await session.commit()


def music_events(events: list[dict[str, object]]) -> list[dict[str, Any]]:
    return [event for event in events if event["event"] == "music.changed"]


async def test_a_selection_opened_with_a_song_plays_it_at_once_and_keeps_it_playing(
    client: AsyncClient,
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    song: str,
    monkeypatch: pytest.MonkeyPatch,
    broadcast_events: list[dict[str, object]],
) -> None:
    """A phone's Sing opens the selection with a song: there is no reel to wait for, so
    the host plays it from the moment the selection opens. Moving the singers and a card
    landing keep the same song of the same selection, so neither restarts it — nor tells
    the room anything, however often the phone writes. A new selection restarts it, even of
    the same song; giving it up ends it."""
    from ultrastar_wingman.music import service as music_service

    await give_audio(session, song)
    clock = frozen_clock(monkeypatch)
    alice = await add_player(client, "Alice")
    bob = await add_player_row(session, "Bob")

    opened = await open_selection(client, song)
    state = await music_service.read()
    assert state.preview is not None
    assert state.preview.song.id == song
    assert state.preview.start_s == 33.0
    assert state.preview.reveal_at == clock[0]
    first = state.preview
    heard = len(music_events(broadcast_events))

    for color in ["blue", "red", "green", "blue"]:
        clock[0] += timedelta(milliseconds=300)
        response = await client.put(
            "/api/v1/karaoke/selection/slots",
            json={"token": opened["token"], "slots": [{"color": color, "player_id": alice["id"]}]},
        )
        assert response.status_code == 200, response.text
    await selection.card_placed_on_slot(session_factory, "red", "B2", bob)
    assert len(selection_events(broadcast_events)) >= 6
    assert len(music_events(broadcast_events)) == heard
    assert (await music_service.read()).preview == first

    clock[0] += timedelta(seconds=1)
    again = await open_selection(client, song, force=True)
    state = await music_service.read()
    assert state.preview is not None
    assert state.preview.id != first.id
    assert state.preview.reveal_at == clock[0]

    assert (await close_selection(client, again["token"])).status_code == 204
    assert (await music_service.read()).preview is None


async def test_a_picked_spin_plays_on_where_it_is_and_a_respin_restarts_it(
    client: AsyncClient,
    session: AsyncSession,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
    broadcast_events: list[dict[str, object]],
) -> None:
    """A respin is a new reel and a new song (here the same one, the library holding one),
    so the host starts it again from its preview point. Moving on to the singers is not: the
    preview keeps its id and its landing, so the host's song plays on where it is."""
    from ultrastar_wingman.music import service as music_service

    await give_audio(session, song)
    clock = frozen_clock(monkeypatch)
    opened = await open_spin(client, "all")
    token = opened["token"]
    first = (await music_service.read()).preview
    assert first is not None

    clock[0] += LANDED
    assert (await respin(client, token)).status_code == 200
    respun = (await music_service.read()).preview
    assert respun is not None
    assert respun.id != first.id
    assert respun.reveal_at == clock[0] + timedelta(seconds=selection.REVEAL_SECONDS)

    clock[0] += LANDED
    heard = len(music_events(broadcast_events))
    assert (await pick(client, token)).status_code == 200
    response = await client.put(
        "/api/v1/karaoke/selection/slots", json={"token": token, "slots": []}
    )
    assert response.status_code == 200, response.text
    assert (await music_service.read()).preview == respun
    assert len(music_events(broadcast_events)) == heard


async def test_a_pick_before_the_reel_lands_lands_the_song_now(
    client: AsyncClient,
    session: AsyncSession,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The phone's Play waits for the landing, the route does not. A pick while the reel
    still runs takes the reel off the TV and shows the song at once, so the speakers bring
    it in at once too — under the same id, so a host that has cued it keeps the file."""
    from ultrastar_wingman.music import service as music_service

    await give_audio(session, song)
    clock = frozen_clock(monkeypatch)
    opened = await open_spin(client, "all")
    spun = (await music_service.read()).preview
    assert spun is not None
    assert spun.reveal_at == clock[0] + timedelta(seconds=selection.REVEAL_SECONDS)

    clock[0] += timedelta(seconds=1)
    assert (await pick(client, opened["token"])).status_code == 200
    picked = (await music_service.read()).preview
    assert picked is not None
    assert picked.id == spun.id
    assert picked.reveal_at == clock[0]


async def test_the_switch_and_the_watchdog_reach_a_selection_opened_with_a_song(
    client: AsyncClient,
    session: AsyncSession,
    song: str,
) -> None:
    """*Song preview* off: a phone's Sing plays nothing. Switched on while the selection
    stands, its song comes in; off again, it goes; and a selection the watchdog drops for
    standing idle takes its song with it."""
    from ultrastar_wingman.music import service as music_service

    await give_audio(session, song)
    off = await client.patch("/api/v1/settings/sound.reel_preview", json={"value": False})
    assert off.status_code == 200, off.text

    await open_selection(client, song)
    assert (await music_service.read()).preview is None

    on = await client.patch("/api/v1/settings/sound.reel_preview", json={"value": True})
    assert on.status_code == 200, on.text
    assert (await music_service.read()).preview is not None

    await client.patch("/api/v1/settings/sound.reel_preview", json={"value": False})
    assert (await music_service.read()).preview is None
    await client.patch("/api/v1/settings/sound.reel_preview", json={"value": True})
    assert (await music_service.read()).preview is not None

    with pytest.MonkeyPatch.context() as later:
        later.setattr(
            selection,
            "_now",
            lambda: datetime.now(UTC) + selection.DEFAULT_IDLE_TTL + timedelta(seconds=1),
        )
        await selection.expire_stale()
    assert await selection.current_selection() is None
    assert (await music_service.read()).preview is None


async def test_the_selectors_spin_plays_until_its_start_takes_the_speakers(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The start button set to `random` opens the selector's own spin, which the host plays
    like a phone's; the press that starts the song ends it, and the sing ending brings back
    nothing, because the selection went with the start."""
    from ultrastar_wingman.music import service as music_service

    await give_audio(session, song)
    clock = frozen_clock(monkeypatch)
    alice = await add_player_row(session, "Alice")
    await SettingsService(session).set("karaoke.player_colors", TWO_SLOTS)
    cards = {"blue": selection.CardOnSlot(uid="A1", player_id=alice)}

    await selection.button_pressed(
        session,
        session_factory,
        "start",
        without_selection=selection.StartWithoutSelection(mode="random", cards=cards),
    )
    state = await music_service.read()
    assert state.preview is not None
    assert state.preview.song.id == song

    clock[0] += LANDED
    await selection.button_pressed(session, session_factory, "start")
    await wait_for(configured.argv_file)
    assert await selection.current_selection() is None
    assert (await music_service.read()).preview is None
    await service.wait_for_sing_end()
    assert (await music_service.read()).preview is None


async def test_the_top_wish_press_leaves_no_preview_behind(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
) -> None:
    """`top_wish` opens its selection and starts it in the same breath, so there is nothing
    to hear: the song goes straight to Ultrastar Deluxe, and nothing plays afterwards."""
    from ultrastar_wingman.music import service as music_service

    await give_audio(session, song)
    alice = await add_player_row(session, "Alice")
    await SettingsService(session).set("karaoke.player_colors", TWO_SLOTS)
    session.add(Wish(song_id=song, guest_id="a-guest-cookie"))
    await session.commit()

    await selection.button_pressed(
        session,
        session_factory,
        "start",
        without_selection=selection.StartWithoutSelection(
            mode="top_wish", cards={"blue": selection.CardOnSlot(uid="A1", player_id=alice)}
        ),
    )
    await wait_for(configured.argv_file)
    assert (await music_service.read()).preview is None
    await service.wait_for_sing_end()
    assert (await music_service.read()).preview is None


async def remaining_wishes(session: AsyncSession) -> set[tuple[str, str | None, str | None]]:
    return {
        (wish.song_id, wish.user_id, wish.guest_id) for wish in await session.scalars(select(Wish))
    }


async def test_a_phone_s_play_clears_every_wish_for_the_song(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    """Started from a selection, with a guest player on the microphone: the wish of an
    account that is not singing goes too, and so does the phone's. Another song's stays."""
    session.add_all(
        [
            Wish(song_id=song, user_id="watcher-account"),
            Wish(song_id=song, guest_id="a-phone"),
            Wish(song_id="local:other", user_id="watcher-account"),
        ]
    )
    await session.commit()
    guest_player = await add_player(client, "Alex")
    opened = await open_selection(
        client, song, [{"color": "blue", "player_id": guest_player["id"]}]
    )

    started = await client.post("/api/v1/karaoke/selection/start", json={"token": opened["token"]})

    assert started.status_code == 202, started.text
    assert await remaining_wishes(session) == {("local:other", "watcher-account", None)}
    updates = [event for event in broadcast_events if event["event"] == "wishlist.updated"]
    assert [(event["song_id"], event["count"]) for event in updates] == [(song, 0)]
    await service.wait_for_sing_end()


async def test_the_start_button_s_top_wish_takes_that_wish_off_the_list(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
) -> None:
    """The selector picks the top wish and starts it with nobody's phone involved: the
    wishes for it go exactly as they do for a phone's Play."""
    alice = await add_player_row(session, "Alice")
    await SettingsService(session).set("karaoke.player_colors", TWO_SLOTS)
    session.add_all(
        [
            Wish(song_id=song, guest_id="a-guest-cookie"),
            Wish(song_id=song, user_id="an-account"),
        ]
    )
    await session.commit()

    await selection.button_pressed(
        session,
        session_factory,
        "start",
        without_selection=selection.StartWithoutSelection(
            mode="top_wish", cards={"blue": selection.CardOnSlot(uid="A1", player_id=alice)}
        ),
    )

    await wait_for(configured.argv_file)
    assert await remaining_wishes(session) == set()
    await service.wait_for_sing_end()


async def test_a_spin_over_nothing_is_refused(
    bootstrap_settings: BootstrapSettings, client: AsyncClient, song: str
) -> None:
    """A wishlist nobody wished on, the favorites of a phone with no account behind it, and
    a playlist nobody can see: nothing to land on, and the room stays as it was."""
    nothing_wished = await client.post(
        "/api/v1/karaoke/selection", json={"spin": {"scope": "wishlist"}}
    )
    assert nothing_wished.status_code == 409
    assert nothing_wished.json() == {"detail": "empty_pool"}
    # An unknown playlist is the same 404 its own route answers — never a pool.
    unknown = await client.post(
        "/api/v1/karaoke/selection", json={"spin": {"scope": "playlist", "playlist_id": "gone"}}
    )
    assert unknown.status_code == 404
    assert (await client.get("/api/v1/karaoke/selection")).json() == {"selection": None}

    app = create_app(bootstrap_settings)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL) as guest,
    ):
        no_account = await guest.post(
            "/api/v1/karaoke/selection", json={"spin": {"scope": "favorites"}}
        )
        assert no_account.status_code == 409
        assert no_account.json() == {"detail": "empty_pool"}
        # Every song is a pool that always has this song in it.
        assert (await open_spin(guest, "all"))["selection"]["song"]["id"] == song


async def test_a_spin_at_an_open_room_answers_that_somebody_is_picking(
    client: AsyncClient, song: str
) -> None:
    """The lock comes first: a phone whose wishlist is empty has to be told to take over,
    not that its pool is."""
    await open_selection(client, song)

    refused = await client.post("/api/v1/karaoke/selection", json={"spin": {"scope": "wishlist"}})

    assert refused.status_code == 409
    assert refused.json() == {"detail": "selection_open"}


async def test_a_selection_needs_a_song_or_a_spin_and_not_both(
    client: AsyncClient, song: str
) -> None:
    for body in (
        {},
        {"song_id": song, "spin": {"scope": "all"}},
        # A playlist id goes with the playlist scope, and only there.
        {"spin": {"scope": "playlist"}},
        {"spin": {"scope": "all", "playlist_id": "x"}},
        {"spin": {"scope": "somewhere"}},
    ):
        response = await client.post("/api/v1/karaoke/selection", json=body)
        assert response.status_code == 422, body
    assert (await client.get("/api/v1/karaoke/selection")).json() == {"selection": None}


async def test_all_songs_leaves_out_what_a_tag_folds_away_and_the_wishlist_does_not(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The reel is the song list in another shape: *All songs* keeps back what the list keeps
    back until somebody asks. A wish is somebody asking, so the wishlist scope spins the
    folded-away song all the same."""
    other = await add_second_song(session, configured)
    folded, kept = max(song, other), min(song, other)
    pick_last(monkeypatch)
    tag = await client.post(
        "/api/v1/tags", json={"name": "archive", "color": "neutral", "hide_by_default": True}
    )
    assert tag.status_code == 201, tag.text
    assert (await client.put(f"/api/v1/songs/{folded}/tags/{tag.json()['id']}")).status_code == 204
    assert (await client.post("/api/v1/wishlist", json={"song_id": folded})).status_code == 201

    everything = await open_spin(client, "all")
    assert everything["selection"]["song"]["id"] == kept

    wished = await open_spin(client, "wishlist", force=True)
    assert wished["selection"]["song"]["id"] == folded


async def test_the_start_button_folds_away_what_the_guest_sees_folded(
    client: AsyncClient,
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The button spins as the guest, and the fold follows the guest's own song list: a
    `hide_by_default` tag folds its songs away for whoever may *view* it — an administrator
    always may, which is what the phone test above proves and nothing more. Here the rows
    decide. A tag the guest may view (and see the songs of) folds its song out of *All songs*
    and leaves it on the wishlist; a tag the guest may not view — while still seeing its
    songs — folds nothing, because on the guest's phone there is no criterion to fold with
    (`tags.ts`'s `defaultTagCriteria` is built over the tags the reader can see)."""
    other = await add_second_song(session, configured)
    folded, kept = max(song, other), min(song, other)
    pick_last(monkeypatch)
    tag = await client.post(
        "/api/v1/tags",
        json={
            "name": "archive",
            "color": "neutral",
            "hide_by_default": True,
            "permissions": [
                {"action": "view", "role": "guest"},
                {"action": "view_songs", "role": "guest"},
            ],
        },
    )
    assert tag.status_code == 201, tag.text
    tag_id = tag.json()["id"]
    assert (await client.put(f"/api/v1/songs/{folded}/tags/{tag_id}")).status_code == 204
    session.add(Wish(song_id=folded, guest_id="a-guest-cookie"))
    await session.commit()

    async def press(scope: str) -> str:
        await selection.close_selection(any_opener=True)
        await selection.button_pressed(
            session,
            session_factory,
            "start",
            without_selection=selection.StartWithoutSelection(mode="random", scope=scope),
        )
        spun = await selection.current_selection()
        assert spun is not None and spun.spin is not None
        assert spun.spin.scope == scope
        return spun.song.id

    assert await press("all") == kept
    assert await press("wishlist") == folded

    # The same tag, now one the guest may not know about but whose songs they still see:
    # nothing folds, and the greater id is back in the running.
    rows = await client.put(
        f"/api/v1/tags/{tag_id}/permissions",
        json={"permissions": [{"action": "view_songs", "role": "guest"}]},
    )
    assert rows.status_code == 200, rows.text
    assert await press("all") == folded


async def test_a_song_hidden_altogether_wins_in_no_scope(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A tag whose `view_songs` the caller does not hold hides the song everywhere, the reel
    included — a wish for it notwithstanding. Spun as the guest the start button is, through
    the service: the admin client sees everything."""
    other = await add_second_song(session, configured)
    hidden, seen = max(song, other), min(song, other)
    pick_last(monkeypatch)
    listed = await client.get("/api/v1/tags")
    broken = next(tag for tag in listed.json()["tags"] if tag["name"] == "broken")
    assert (await client.put(f"/api/v1/songs/{hidden}/tags/{broken['id']}")).status_code == 204
    assert (await client.post("/api/v1/wishlist", json={"song_id": hidden})).status_code == 201
    assert (await client.post("/api/v1/wishlist", json={"song_id": seen})).status_code == 201

    for scope in ("all", "wishlist", "weighted"):
        opened, _ = await selection.open_selection(
            session, None, [], force=True, spin=selection.Spin(scope=scope, viewer=GUEST)
        )
        assert opened.song.id == seen, scope


async def test_spinning_again_keeps_the_slots_and_bumps_the_id(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
    broadcast_events: list[dict[str, object]],
) -> None:
    """The people are the same, only the song was wrong. The host screen animates on the
    new id; the phone reveals the song when that reel lands — so the respin comes once the
    first reel has landed, or it would be the press that lands it."""
    other = await add_second_song(session, configured)
    pools = pick_last(monkeypatch)
    clock = frozen_clock(monkeypatch)
    alice = await add_player(client, "Alice")
    opened = await open_spin(client, "all", slots=[{"color": "red", "player_id": alice["id"]}])
    first = opened["selection"]["spin"]
    assert first["origin"] == "phone"
    assert first["revealed"] is False
    clock[0] += LANDED

    response = await respin(client, opened["token"])

    assert response.status_code == 200, response.text
    again = response.json()
    assert again["spin"]["id"] == 2
    assert again["spin"]["scope"] == "all"
    assert again["spin"]["spun_at"] > first["spun_at"]
    # The origin is the selection's for as long as it stands, and a new reel is unrevealed.
    assert again["spin"]["origin"] == "phone"
    assert again["spin"]["revealed"] is False
    assert again["song"]["id"] == max(song, other)
    assert player_names(again["slots"]) == [None, "Alice", None, None]
    assert again["auto_start_at"] is None
    assert len(pools) == 2
    assert selection_events(broadcast_events)[-1]["selection"]["spin"]["id"] == 2
    # The same selection all along: a phone watching `opened_at` sees no take-over.
    assert again["opened_at"] == opened["selection"]["opened_at"]


async def test_spinning_again_takes_the_openers_token_and_a_spun_selection(
    client: AsyncClient, song: str
) -> None:
    gone = await respin(client, "nope")
    assert gone.status_code == 404
    assert gone.json() == {"detail": "no_selection"}

    opened = await open_spin(client, "all")
    for token in (None, "nope"):
        stale = await respin(client, token)
        assert stale.status_code == 409, token
        assert stale.json() == {"detail": "not_the_opener"}
    assert (await client.get("/api/v1/karaoke/selection")).json()["selection"]["spin"]["id"] == 1

    # A selection opened with a song has no scope to pick from again.
    plain = await open_selection(client, song, force=True)
    refused = await respin(client, plain["token"])
    assert refused.status_code == 409
    assert refused.json() == {"detail": "not_a_spin"}
    assert opened["token"] != plain["token"]


async def test_a_scope_that_ran_dry_leaves_the_selection_standing(
    client: AsyncClient, song: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The last wish was taken back between the spin and the respin. The song it landed on
    stays: the phone can still press Play on it — and nothing else about the selection
    moves either, its idle clock included: a refusal writes nothing, so the room hears
    nothing and the `updated_at` it knows is still the right one."""
    clock = frozen_clock(monkeypatch)
    assert (await client.post("/api/v1/wishlist", json={"song_id": song})).status_code == 201
    opened = await open_spin(client, "wishlist")
    assert (await client.delete(f"/api/v1/wishlist/{song}")).status_code == 204
    clock[0] += LANDED

    refused = await respin(client, opened["token"])

    assert refused.status_code == 409
    assert refused.json() == {"detail": "empty_pool"}
    current = (await client.get("/api/v1/karaoke/selection")).json()["selection"]
    assert current["song"]["id"] == song
    assert current["spin"]["id"] == 1
    assert current["updated_at"] == opened["selection"]["updated_at"]
    assert current["spin"]["spun_at"] == opened["selection"]["spin"]["spun_at"]
    assert current["spin"]["revealed"] is False


async def test_a_spun_selection_never_counts_down(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
) -> None:
    """Everybody is standing at the selector with their card down, and the automatic start
    is on — and the song was spun. Pressing until the song is right must not race a
    countdown, so nothing counts, neither on opening nor when a card fills the room later."""
    alice = await add_player_row(session, "Alice")
    bob = await add_player_row(session, "Bob")
    await SettingsService(session).set("karaoke.player_colors", TWO_SLOTS)
    now = selection.AutoStart(delay_s=0)

    await selection.open_selection(
        session,
        None,
        [],
        device_slots={
            "blue": selection.CardOnSlot(uid="A1", player_id=alice),
            "red": selection.CardOnSlot(uid="B2", player_id=bob),
        },
        session_factory=session_factory,
        auto_start=now,
        spin=selection.Spin(scope="all", viewer=GUEST),
    )

    await selection.wait_for_auto_start()
    full = await selection.current_selection()
    assert full is not None and full.auto_start_at is None
    assert full.spin is not None and full.spin.origin == "phone"
    assert player_names(await current_slots()) == ["Alice", "Bob"]
    assert not configured.argv_file.exists()

    # A card lifted and put back down: the room is full again, and still nothing counts.
    await selection.card_removed_from_slot("red", "B2")
    await selection.card_placed_on_slot(session_factory, "red", "B2", bob, auto_start=now)
    await selection.wait_for_auto_start()
    refilled = await selection.current_selection()
    assert refilled is not None and refilled.auto_start_at is None
    assert not configured.argv_file.exists()


async def test_the_start_button_spins_again_at_an_empty_spun_room_and_starts_a_full_one(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
    broadcast_events: list[dict[str, object]],
) -> None:
    """The next press is the confirmation — when there is somebody to sing. With nobody on
    any slot it is the room saying "another one". Every press here comes after the reel has
    landed; one that comes earlier is `test_a_press_while_the_reel_runs_lands_it`."""
    clock = frozen_clock(monkeypatch)
    alice = await add_player_row(session, "Alice")
    await SettingsService(session).set("karaoke.player_colors", TWO_SLOTS)
    await selection.open_selection(
        session, None, [], spin=selection.Spin(scope="all", viewer=GUEST)
    )
    clock[0] += LANDED

    await selection.button_pressed(session, session_factory, "start")

    spun = await selection.current_selection()
    assert spun is not None and spun.spin is not None and spun.spin.id == 2
    assert not configured.argv_file.exists()
    assert selection_events(broadcast_events)[-1]["selection"]["spin"]["id"] == 2

    # An unknown card is nobody to sing: still a respin.
    clock[0] += LANDED
    await selection.card_placed_on_slot(session_factory, "blue", "X9")
    await selection.button_pressed(session, session_factory, "start")
    unknown = await selection.current_selection()
    assert unknown is not None and unknown.spin is not None and unknown.spin.id == 3
    assert not configured.argv_file.exists()

    clock[0] += LANDED
    await selection.card_placed_on_slot(session_factory, "blue", "A1", alice)
    await selection.button_pressed(session, session_factory, "start")

    await wait_for(configured.argv_file)
    assert await selection.current_selection() is None
    assert any(event["event"] == "karaoke.started" for event in broadcast_events)
    await service.wait_for_sing_end()


async def test_the_start_button_at_a_quiet_room_spins_without_a_card(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    """`random` at a quiet room spins the reel on the host screen, cards or none, and starts
    nothing: a token nobody holds, so a phone takes it over as it would anybody else's."""
    await SettingsService(session).set("karaoke.player_colors", TWO_SLOTS)

    await selection.button_pressed(
        session,
        session_factory,
        "start",
        without_selection=selection.StartWithoutSelection(mode="random"),
    )

    spun = await selection.current_selection()
    assert spun is not None
    assert spun.song.id == song
    assert spun.spin is not None and spun.spin.id == 1 and spun.spin.scope == "all"
    assert player_names(await current_slots()) == [None, None]
    assert spun.auto_start_at is None
    assert not configured.argv_file.exists()
    assert selection_events(broadcast_events)[-1]["selection"]["spin"]["id"] == 1
    # The room is locked like behind any other selection, and `force` is the way in.
    with pytest.raises(selection.SelectionOpenError):
        await selection.open_selection(session, song, [])
    await selection.open_selection(session, song, [], force=True)


async def test_the_start_button_seeds_the_spun_selection_with_the_cards(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
) -> None:
    alice = await add_player_row(session, "Alice")
    await SettingsService(session).set("karaoke.player_colors", TWO_SLOTS)

    await selection.button_pressed(
        session,
        session_factory,
        "start",
        without_selection=selection.StartWithoutSelection(
            mode="random",
            cards={
                "blue": selection.CardOnSlot(uid="A1", player_id=alice),
                "red": selection.CardOnSlot(uid="B2", player_id=None),
            },
        ),
    )

    slots = await current_slots()
    assert player_names(slots) == ["Alice", None]
    assert [slot["card_uid"] for slot in slots] == ["A1", "B2"]
    # Seeded, not started: the room presses again once it likes the song.
    assert not configured.argv_file.exists()


async def test_a_random_playlist_that_is_gone_falls_back_to_every_song(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
) -> None:
    """The host chose a playlist and deleted it since. The press spins all the same, out of
    every song, and says so — a respin then picks out of the same everything."""
    await selection.button_pressed(
        session,
        session_factory,
        "start",
        without_selection=selection.StartWithoutSelection(
            mode="random", scope="playlist", playlist_id="gone"
        ),
    )

    spun = await selection.current_selection()
    assert spun is not None and spun.spin is not None
    assert spun.song.id == song
    assert spun.spin.scope == "all"
    assert spun.spin.playlist_id is None


async def test_the_start_button_at_a_quiet_room_with_nothing_to_spin_to_stays_quiet(
    session: AsyncSession, session_factory: async_sessionmaker[AsyncSession], song: str
) -> None:
    """Nobody wished for anything: nothing to land on, and nobody to tell but the log."""
    await selection.button_pressed(
        session,
        session_factory,
        "start",
        without_selection=selection.StartWithoutSelection(mode="random", scope="wishlist"),
    )

    assert await selection.current_selection() is None


# --- a press while the reel runs, and moving on from it -----------------------------------


async def test_a_press_while_the_reel_runs_lands_it(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
    broadcast_events: list[dict[str, object]],
) -> None:
    """*Spin again* inside the reel's running time is the room not wanting to wait: the reel
    lands on the song it has, nothing is picked, and the room hears that it landed. The
    press after that is a respin like any other, the new reel unrevealed again."""
    await add_second_song(session, configured)
    pools = pick_last(monkeypatch)
    clock = frozen_clock(monkeypatch)
    opened = await open_spin(client, "all")
    before = opened["selection"]
    clock[0] += timedelta(seconds=2)

    landed = await respin(client, opened["token"])

    assert landed.status_code == 200, landed.text
    revealed = landed.json()
    assert revealed["spin"]["revealed"] is True
    assert revealed["spin"]["id"] == 1
    assert revealed["spin"]["spun_at"] == before["spin"]["spun_at"]
    assert revealed["spin"]["origin"] == "phone"
    assert revealed["song"]["id"] == before["song"]["id"]
    # Nothing was picked, and the press counted as the room being busy.
    assert len(pools) == 1
    assert revealed["updated_at"] > before["updated_at"]
    event = selection_events(broadcast_events)[-1]["selection"]["spin"]
    assert event["revealed"] is True
    assert event["origin"] == "phone"

    # Landed once, the next press spins again — still inside the first reel's window.
    again = await respin(client, opened["token"])
    assert again.status_code == 200, again.text
    assert again.json()["spin"]["id"] == 2
    assert again.json()["spin"]["revealed"] is False
    assert len(pools) == 2


async def test_the_start_button_while_the_reel_runs_lands_it_and_nothing_else(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The selector's press follows the same rule: while the reel runs it lands the reel —
    it neither starts the song, with somebody on a slot, nor spins again, with nobody — and
    once the reel is down the press means what it always meant."""
    clock = frozen_clock(monkeypatch)
    alice = await add_player_row(session, "Alice")
    await SettingsService(session).set("karaoke.player_colors", TWO_SLOTS)
    # Nobody on a slot: the press would be a respin, and is not.
    await selection.button_pressed(
        session,
        session_factory,
        "start",
        without_selection=selection.StartWithoutSelection(mode="random"),
    )
    spun = await selection.current_selection()
    assert spun is not None and spun.spin is not None
    assert spun.spin.origin == "device"
    assert spun.spin.revealed is False

    await selection.button_pressed(session, session_factory, "start")

    landed = await selection.current_selection()
    assert landed is not None and landed.spin is not None
    assert landed.spin.revealed is True
    assert landed.spin.id == 1
    assert landed.spin.origin == "device"
    clock[0] += LANDED
    await selection.button_pressed(session, session_factory, "start")
    again = await selection.current_selection()
    assert again is not None and again.spin is not None
    assert again.spin.id == 2 and again.spin.revealed is False
    assert not configured.argv_file.exists()

    # Somebody on a slot: the press would start the song, and does not either.
    await selection.card_placed_on_slot(session_factory, "blue", "A1", alice)
    await selection.button_pressed(session, session_factory, "start")
    held = await selection.current_selection()
    assert held is not None and held.spin is not None
    assert held.spin.revealed is True and held.spin.id == 2
    assert not configured.argv_file.exists()

    clock[0] += LANDED
    await selection.button_pressed(session, session_factory, "start")

    await wait_for(configured.argv_file)
    assert await selection.current_selection() is None
    await service.wait_for_sing_end()


async def test_picking_singers_takes_the_spin_off_the_selection(
    client: AsyncClient,
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    """Play on the phone's spin view: the song is right, on to the singers. The selection is
    an ordinary one from here — the same song, the same slots, the same token, no reel to
    spin again — and the selector's press starts it like at any selection opened with a
    song."""
    alice = await add_player(client, "Alice")
    opened = await open_spin(client, "all", slots=[{"color": "red", "player_id": alice["id"]}])

    response = await pick(client, opened["token"])

    assert response.status_code == 200, response.text
    picked = response.json()
    assert picked["spin"] is None
    assert picked["song"]["id"] == opened["selection"]["song"]["id"]
    assert player_names(picked["slots"]) == [None, "Alice", None, None]
    assert picked["opened_at"] == opened["selection"]["opened_at"]
    assert picked["updated_at"] >= opened["selection"]["updated_at"]
    assert picked["auto_start_at"] is None
    assert selection_events(broadcast_events)[-1]["selection"]["spin"] is None
    # No scope to pick from any more, and nothing left to move on from.
    for route in (respin, pick):
        refused = await route(client, opened["token"])
        assert refused.status_code == 409, refused.text
        assert refused.json() == {"detail": "not_a_spin"}
    # The token still moves the singers: the same selection, only the reel is gone.
    moved = await client.put(
        "/api/v1/karaoke/selection/slots",
        json={"token": opened["token"], "slots": [{"color": "blue", "player_id": alice["id"]}]},
    )
    assert moved.status_code == 200, moved.text
    assert player_names(moved.json()["slots"]) == ["Alice", None, None, None]

    await selection.button_pressed(session, session_factory, "start")

    await wait_for(configured.argv_file)
    assert await selection.current_selection() is None
    await service.wait_for_sing_end()


async def test_picking_singers_takes_the_openers_token_and_a_spun_selection(
    client: AsyncClient, song: str
) -> None:
    gone = await pick(client, "nope")
    assert gone.status_code == 404
    assert gone.json() == {"detail": "no_selection"}

    opened = await open_spin(client, "all")
    for token in (None, "nope"):
        stale = await pick(client, token)
        assert stale.status_code == 409, token
        assert stale.json() == {"detail": "not_the_opener"}
    assert (await client.get("/api/v1/karaoke/selection")).json()["selection"]["spin"]["id"] == 1

    # A selection opened with a song has no reel to move on from.
    plain = await open_selection(client, song, force=True)
    refused = await pick(client, plain["token"])
    assert refused.status_code == 409
    assert refused.json() == {"detail": "not_a_spin"}
    assert opened["token"] != plain["token"]


# --- the countdown on the selector's spin ------------------------------------------------


async def full_room_spun_by_the_selector(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    delay_s: int,
) -> None:
    """Alice's and Bob's cards on the two slot readers, the automatic start on with
    `delay_s`, and the start button pressed at a quiet room set to `random`."""
    alice = await add_player_row(session, "Alice")
    bob = await add_player_row(session, "Bob")
    await SettingsService(session).set("karaoke.player_colors", TWO_SLOTS)
    await selection.button_pressed(
        session,
        session_factory,
        "start",
        without_selection=selection.StartWithoutSelection(
            mode="random",
            cards={
                "blue": selection.CardOnSlot(uid="A1", player_id=alice),
                "red": selection.CardOnSlot(uid="B2", player_id=bob),
            },
        ),
        auto_start=selection.AutoStart(delay_s=delay_s),
    )


async def test_the_selectors_spin_counts_down_from_the_moment_the_reel_lands(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The room is full and the host turned the automatic start on, so the selector's own
    spin counts down like any other selection — but the delay runs from the reveal, not from
    the press: the room sees the song before it sees *Starting in…*."""
    clock = frozen_clock(monkeypatch)

    await full_room_spun_by_the_selector(session, session_factory, delay_s=10)

    spun = await selection.current_selection()
    assert spun is not None and spun.spin is not None
    assert spun.spin.origin == "device"
    assert player_names(await current_slots()) == ["Alice", "Bob"]
    assert spun.auto_start_at == spun.spin.spun_at + timedelta(
        seconds=selection.REVEAL_SECONDS + 10
    )
    assert spun.auto_start_at == clock[0] + timedelta(seconds=selection.REVEAL_SECONDS + 10)
    assert not configured.argv_file.exists()
    # A card lifted ends it, as at any selection.
    await selection.card_removed_from_slot("red", "B2")
    emptied = await selection.current_selection()
    assert emptied is not None and emptied.auto_start_at is None
    await selection.close_selection(any_opener=True)
    await selection.wait_for_auto_start()
    assert not configured.argv_file.exists()


async def test_a_press_that_lands_the_reel_puts_the_countdown_on_the_clock_from_now(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The reel was landed by a press, so there is nothing left to wait for: the countdown
    is worked out again from that moment — and with no delay it fires right there."""
    clock = frozen_clock(monkeypatch)
    await full_room_spun_by_the_selector(session, session_factory, delay_s=0)
    spun = await selection.current_selection()
    assert spun is not None
    assert spun.auto_start_at == clock[0] + timedelta(seconds=selection.REVEAL_SECONDS)
    clock[0] += timedelta(seconds=2)

    await selection.button_pressed(
        session, session_factory, "start", auto_start=selection.AutoStart(delay_s=0)
    )

    landed = await selection.current_selection()
    assert landed is not None and landed.spin is not None
    assert landed.spin.revealed is True
    assert landed.auto_start_at == clock[0]
    await selection.wait_for_auto_start()
    await wait_for(configured.argv_file)
    assert await selection.current_selection() is None
    await service.wait_for_sing_end()


async def test_cards_that_fill_the_room_after_a_respin_count_down_from_the_new_reveal(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A respin is a new reel and a new landing. The room fills up afterwards, and the
    countdown waits for *this* reel to land, not the first one's time."""
    clock = frozen_clock(monkeypatch)
    alice = await add_player_row(session, "Alice")
    bob = await add_player_row(session, "Bob")
    await SettingsService(session).set("karaoke.player_colors", TWO_SLOTS)
    countdown = selection.AutoStart(delay_s=10)
    await selection.button_pressed(
        session,
        session_factory,
        "start",
        without_selection=selection.StartWithoutSelection(mode="random"),
        auto_start=countdown,
    )
    empty = await selection.current_selection()
    assert empty is not None and empty.auto_start_at is None
    clock[0] += LANDED
    await selection.button_pressed(session, session_factory, "start", auto_start=countdown)
    respun = await selection.current_selection()
    assert respun is not None and respun.spin is not None and respun.spin.id == 2
    assert respun.spin.spun_at == clock[0]

    await selection.card_placed_on_slot(session_factory, "blue", "A1", alice, auto_start=countdown)
    await selection.card_placed_on_slot(session_factory, "red", "B2", bob, auto_start=countdown)

    full = await selection.current_selection()
    assert full is not None
    assert full.auto_start_at == clock[0] + timedelta(seconds=selection.REVEAL_SECONDS + 10)
    assert not configured.argv_file.exists()
    await selection.close_selection(any_opener=True)
    await selection.wait_for_auto_start()


async def test_after_moving_on_from_the_reel_the_ordinary_countdown_rule_applies(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
    broadcast_events: list[dict[str, object]],
) -> None:
    """A phone's spin over a room the cards fill counts nothing down while the reel is the
    thing on the screen. Moving on from the reel makes it an ordinary selection, and an
    ordinary selection over a room the cards fill counts down — the rule `open_selection`
    applies over those same cards, from the moment the spin came off."""
    clock = frozen_clock(monkeypatch)
    alice = await add_player_row(session, "Alice")
    bob = await add_player_row(session, "Bob")
    await SettingsService(session).set("karaoke.player_colors", TWO_SLOTS)
    at_once = selection.AutoStart(delay_s=0)
    _, token = await selection.open_selection(
        session,
        None,
        [],
        device_slots={
            "blue": selection.CardOnSlot(uid="A1", player_id=alice),
            "red": selection.CardOnSlot(uid="B2", player_id=bob),
        },
        session_factory=session_factory,
        auto_start=at_once,
        spin=selection.Spin(scope="all", viewer=GUEST),
    )
    spun = await selection.current_selection()
    assert spun is not None and spun.auto_start_at is None
    clock[0] += LANDED

    picked = await selection.pick_singers(token, session_factory, at_once)

    assert picked.spin is None
    assert picked.auto_start_at == clock[0]
    assert player_names(await current_slots()) == ["Alice", "Bob"]
    await selection.wait_for_auto_start()
    await wait_for(configured.argv_file)
    assert sings_started(broadcast_events) == 1
    assert await selection.current_selection() is None
    await service.wait_for_sing_end()


async def test_moving_on_from_the_reel_over_a_room_the_phone_filled_starts_nothing(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
) -> None:
    """The same full room, but out of the phone's memory and not off the readers: no card
    holds a slot, so moving on from the reel schedules nothing — a phone has Play, exactly
    as when it opens a selection over what it remembered."""
    alice = await add_player_row(session, "Alice")
    bob = await add_player_row(session, "Bob")
    await SettingsService(session).set("karaoke.player_colors", TWO_SLOTS)
    at_once = selection.AutoStart(delay_s=0)
    _, token = await selection.open_selection(
        session,
        None,
        [
            service.SlotRequest(color="blue", player_id=alice),
            service.SlotRequest(color="red", player_id=bob),
        ],
        session_factory=session_factory,
        auto_start=at_once,
        spin=selection.Spin(scope="all", viewer=GUEST),
    )

    picked = await selection.pick_singers(token, session_factory, at_once)

    assert picked.spin is None
    assert picked.auto_start_at is None
    assert player_names(await current_slots()) == ["Alice", "Bob"]
    await selection.wait_for_auto_start()
    assert not configured.argv_file.exists()
    still = await selection.current_selection()
    assert still is not None and still.auto_start_at is None


def sings_started(events: list[dict[str, object]]) -> int:
    return sum(event["event"] == "karaoke.started" for event in events)


async def test_the_selectors_countdown_fires_once_the_reel_has_landed(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
    broadcast_events: list[dict[str, object]],
) -> None:
    """The countdown on the selector's spin is a task sleeping on the real clock until the
    reveal plus the delay, and at that moment it starts the song — on the real clock here,
    with the reel shortened to under a second (`_REVEAL` is read when the countdown is put
    on the clock; `REVEAL_SECONDS` is the same figure at its full length). The sleep worked
    out from the reveal and `_start_locked` at the end of it are what is proven; neither
    cares about the figure."""
    reveal = timedelta(seconds=0.75)
    monkeypatch.setattr(selection, "_REVEAL", reveal)
    loop = asyncio.get_running_loop()
    pressed = loop.time()

    await full_room_spun_by_the_selector(session, session_factory, delay_s=0)

    spun = await selection.current_selection()
    assert spun is not None and spun.spin is not None
    assert spun.auto_start_at == spun.spin.spun_at + reveal
    # Not before the reel has landed.
    assert not configured.argv_file.exists()
    await selection.wait_for_auto_start()
    await wait_for(configured.argv_file)
    assert loop.time() - pressed >= 0.7
    assert sings_started(broadcast_events) == 1
    assert await selection.current_selection() is None
    await service.wait_for_sing_end()


async def test_a_press_that_lands_the_reel_takes_the_first_countdown_off_the_clock(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
    broadcast_events: list[dict[str, object]],
) -> None:
    """The first countdown was sleeping until the reel's own landing. The press that lands
    the reel early puts a second one on the clock from now, and the first has to be gone —
    not merely forgotten: two tasks would be one start too many. The reel is kept long
    enough that a first task left alive shows up as a slow test, never as a passing one."""
    monkeypatch.setattr(selection, "_REVEAL", timedelta(seconds=3))
    await full_room_spun_by_the_selector(session, session_factory, delay_s=0)
    counting = selection._selection
    assert counting is not None and counting.auto_start_task is not None
    first = counting.auto_start_task

    await selection.button_pressed(
        session, session_factory, "start", auto_start=selection.AutoStart(delay_s=0)
    )

    landed = await selection.current_selection()
    assert landed is not None and landed.spin is not None and landed.spin.revealed is True
    assert counting.auto_start_task is not first
    await selection.wait_for_auto_start()
    assert first.cancelled()
    await wait_for(configured.argv_file)
    assert sings_started(broadcast_events) == 1
    assert await selection.current_selection() is None
    await service.wait_for_sing_end()


async def test_spinning_again_under_a_countdown_puts_it_on_the_clock_from_the_new_reveal(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No press reaches this today: the selector spins again only with nobody on a slot, a
    countdown runs only with everybody on one, and the phone's *Spin again* takes a token a
    selector's spin never hands out. The branch in `_respin_locked` is there for the day one
    does, so it is proven on the function itself: the old task is gone, and the new moment
    is the new reel's landing plus the delay."""
    clock = frozen_clock(monkeypatch)
    countdown = selection.AutoStart(delay_s=10)
    await full_room_spun_by_the_selector(session, session_factory, delay_s=10)
    counting = selection._selection
    assert counting is not None and counting.auto_start_task is not None
    first = counting.auto_start_task
    clock[0] += timedelta(seconds=2)

    async with selection._lock:
        await selection._respin_locked(session, counting, countdown, session_factory)

    respun = await selection.current_selection()
    assert respun is not None and respun.spin is not None
    assert respun.spin.id == 2 and respun.spin.revealed is False
    assert respun.auto_start_at == clock[0] + timedelta(seconds=selection.REVEAL_SECONDS + 10)
    assert counting.auto_start_task is not first
    await selection.close_selection(any_opener=True)
    await selection.wait_for_auto_start()
    assert first.cancelled()
    assert not configured.argv_file.exists()
