"""The player selector: the token a device reports with, the diff its reports become, the
card table, the options, the bundled firmware and the watchdog.

The device half is REST like everything else, so most of this speaks HTTP. What the reports
*mean* is asserted on the selection next door (`GET /karaoke/selection`), because that is
where a card on a reader ends up, and the starts run against the fake USDX of
`test_karaoke_api` so a button that starts a song really starts one.
"""

import asyncio
import json
import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

import test_karaoke_api
from test_karaoke_api import FakeUsdx, add_player, wait_for
from test_karaoke_selection import (
    current_slots,
    player_names,
    selection_events,
    two_slot_selection,
)
from ultrastar_wingman.devices import firmware
from ultrastar_wingman.devices import service as devices
from ultrastar_wingman.karaoke import selection
from ultrastar_wingman.karaoke import service as karaoke

# The fake-USDX fixtures, bound here so pytest can resolve them by name — the same binding
# `test_karaoke_selection` does, and for the same reason.
fake_usdx = test_karaoke_api.fake_usdx
configured = test_karaoke_api.configured
song = test_karaoke_api.song

KNOWN_UID = "A1B2C3D4"
OTHER_UID = "B2C3D4E5"

# File names a hand-tampered manifest could carry. The last one is Windows' own trap: a name
# with a drive and no separator at all, which replaces the directory it is joined to.
TAMPERED_NAMES = ("../manifest.json", "..\\manifest.json", "..", "/etc/passwd", "C:manifest.json")


def reader(
    index: int, uid: str | None = None, state: str = "wired", version: str = "92"
) -> dict[str, Any]:
    return {"index": index, "state": state, "version": version, "uid": uid}


def button(index: int, presses: int = 0) -> dict[str, Any]:
    return {"index": index, "presses": presses}


def report_body(
    readers: list[dict[str, Any]] | None = None,
    buttons: list[dict[str, Any]] | None = None,
    protocol: int = 1,
    firmware_version: str = "0.1.0",
    uptime_s: int = 42,
    rssi: int = -61,
) -> dict[str, Any]:
    return {
        "protocol": protocol,
        "firmware": firmware_version,
        "uptime_s": uptime_s,
        "rssi": rssi,
        "readers": readers or [],
        "buttons": buttons or [],
    }


async def post_report(client: AsyncClient, token: str, **kwargs: Any) -> Response:
    return await client.post(
        "/api/v1/devices/report",
        json=report_body(**kwargs),
        headers={"Authorization": f"Bearer {token}"},
    )


async def create_device(client: AsyncClient, name: str = "Selector") -> dict[str, Any]:
    response = await client.post("/api/v1/devices", json={"name": name})
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


async def mapped_device(
    client: AsyncClient,
    reader_roles: dict[str, str] | None = None,
    button_actions: dict[str, str] | None = None,
    readers: int = 2,
    buttons: int = 1,
) -> tuple[str, str]:
    """A device that has reported once — so its readers are known to be wired — with the
    mapping the test needs. Returns its id and its token."""
    created = await create_device(client)
    device_id, token = created["device"]["id"], created["token"]
    response = await post_report(
        client,
        token,
        readers=[reader(index) for index in range(readers)],
        buttons=[button(index) for index in range(buttons)],
    )
    assert response.status_code == 200, response.text
    if reader_roles is not None or button_actions is not None:
        body: dict[str, Any] = {}
        if reader_roles is not None:
            body["reader_roles"] = reader_roles
        if button_actions is not None:
            body["button_actions"] = button_actions
        response = await client.patch(f"/api/v1/devices/{device_id}", json=body)
        assert response.status_code == 200, response.text
    return device_id, token


async def only_device(client: AsyncClient) -> dict[str, Any]:
    response = await client.get("/api/v1/devices")
    assert response.status_code == 200, response.text
    devices_read: list[dict[str, Any]] = response.json()["devices"]
    assert len(devices_read) == 1
    return devices_read[0]


def device_events(events: list[dict[str, object]]) -> list[dict[str, object]]:
    return [event for event in events if event["event"] == "devices.changed"]


class HoldAtTheLock:
    """Stands in for `devices._lock` so one report can be held at its door while another goes
    all the way through — which is how two reports of one device are made to arrive in the
    wrong order without waiting on a race to happen by itself.

    Armed for exactly one entrant: the next coroutine to reach the lock waits until the test
    lets it go, and everybody after it walks straight in.
    """

    def __init__(self, lock: asyncio.Lock) -> None:
        self._lock = lock
        self._armed = True
        self.at_the_door = asyncio.Event()
        self.let_go = asyncio.Event()

    async def __aenter__(self) -> None:
        if self._armed:
            self._armed = False
            self.at_the_door.set()
            await self.let_go.wait()
        await self._lock.acquire()

    async def __aexit__(self, *error: object) -> None:
        self._lock.release()


# --- the token --------------------------------------------------------------------------


async def test_a_new_device_answers_a_token_and_waits(client: AsyncClient) -> None:
    created = await create_device(client, "Living room")

    token = created["token"]
    assert token.startswith("wd_")
    assert len(token) == len("wd_") + 40
    assert int(token[3:], 16) >= 0
    device = created["device"]
    assert device["name"] == "Living room"
    assert device["online"] is False
    assert device["last_seen_at"] is None
    # Nothing is known about it until it says something: no versions, no readers, and no
    # verdict on whether Wingman can talk to it at all.
    assert device["compatible"] is None
    assert device["readers"] == []
    assert (await only_device(client))["online"] is False


async def test_a_report_without_a_token_or_with_a_wrong_one_is_refused(
    client: AsyncClient,
) -> None:
    await create_device(client)

    without = await client.post("/api/v1/devices/report", json=report_body())
    assert without.status_code == 401
    assert without.json() == {"detail": "unknown_device"}

    wrong = await post_report(client, "wd_" + "0" * 40)
    assert wrong.status_code == 401
    assert wrong.json() == {"detail": "unknown_device"}


async def test_a_token_that_is_not_ascii_is_refused_rather_than_a_crash(
    client: AsyncClient,
) -> None:
    """A device (or whatever else found the port) can put anything at all in that header,
    and hashing is only reached by something shaped like a token.

    The header goes out as bytes because httpx refuses to send a non-ASCII string as one;
    what arrives is exactly what a client with a strange token would send.
    """
    await create_device(client)

    response = await client.post(
        "/api/v1/devices/report",
        json=report_body(),
        headers={b"Authorization": "Bearer wd_ö".encode()},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "unknown_device"}


async def test_a_rotated_token_replaces_the_old_one(client: AsyncClient) -> None:
    created = await create_device(client)
    device_id, old = created["device"]["id"], created["token"]

    response = await client.post(f"/api/v1/devices/{device_id}/token")

    assert response.status_code == 200, response.text
    new = response.json()["token"]
    assert new != old
    assert (await post_report(client, old)).status_code == 401
    assert (await post_report(client, new)).status_code == 200


# --- reports ----------------------------------------------------------------------------


async def test_a_report_makes_the_device_online_and_records_its_readers(
    client: AsyncClient, broadcast_events: list[dict[str, object]]
) -> None:
    created = await create_device(client)
    token = created["token"]
    # The row being created is a change of its own; this test is about the report.
    broadcast_events.clear()

    response = await post_report(
        client,
        token,
        readers=[
            reader(0),
            reader(1, state="none", version="00"),
            reader(2, state="fault", version="3a"),
        ],
        buttons=[button(0, presses=3)],
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "protocol": 1, "interval_s": 5}
    device = await only_device(client)
    assert device["online"] is True
    assert device["compatible"] is True
    assert device["firmware_version"] == "0.1.0"
    assert device["last_seen_at"] is not None
    assert device["rssi"] == -61
    assert [(entry["index"], entry["state"]) for entry in device["readers"]] == [
        (0, "wired"),
        (1, "none"),
        (2, "fault"),
    ]
    assert device["buttons"] == [{"index": 0, "presses": 3, "action": "none"}]
    # The room hears about a device coming back exactly once.
    assert len(device_events(broadcast_events)) == 1


async def test_the_probe_survives_the_device_going_quiet(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The mapping page has to work on an unplugged device, so which readers answered is a
    column. What lies on them is not: nobody knows that while it says nothing."""
    _, token = await mapped_device(client)
    await post_report(
        client, token, readers=[reader(0, uid=KNOWN_UID), reader(1)], buttons=[button(0)]
    )
    monkeypatch.setattr(devices, "_now", lambda: datetime.now(UTC) + timedelta(minutes=1))

    device = await only_device(client)

    assert device["online"] is False
    assert [(entry["index"], entry["state"]) for entry in device["readers"]] == [
        (0, "wired"),
        (1, "wired"),
    ]
    assert [entry["uid"] for entry in device["readers"]] == [None, None]


async def test_every_button_is_listed_while_the_device_says_nothing(
    client: AsyncClient,
) -> None:
    """A button set to *nothing* is a row like any other. It used to disappear the moment
    nothing was known about the device — which is every button of every device after a
    restart — and the page that set it to nothing could not set it back."""
    device_id, _ = await mapped_device(client, button_actions={"0": "start"}, readers=1, buttons=3)
    # What a restarted Wingman has: the row, and not a word from the device since.
    devices._live.clear()

    device = await only_device(client)

    assert device["online"] is False
    assert device["buttons"] == [
        {"index": 0, "presses": 0, "action": "start"},
        {"index": 1, "presses": 0, "action": "none"},
        {"index": 2, "presses": 0, "action": "none"},
    ]
    # And the action can be given up again on a device that is saying nothing.
    response = await client.patch(
        f"/api/v1/devices/{device_id}", json={"button_actions": {"0": "none"}}
    )
    assert response.status_code == 200, response.text
    assert [entry["action"] for entry in response.json()["buttons"]] == ["none", "none", "none"]


async def test_a_saved_mapping_answers_with_the_device_as_it_stands(
    client: AsyncClient,
) -> None:
    """The answer to a save is the device, not a device: one that is standing there
    reporting must not read as offline with empty readers because its name changed."""
    device_id, token = await mapped_device(client, reader_roles={"0": "slot:blue"})
    await post_report(client, token, readers=[reader(0, uid=KNOWN_UID), reader(1)])

    response = await client.patch(f"/api/v1/devices/{device_id}", json={"name": "By the TV"})

    assert response.status_code == 200, response.text
    device = response.json()
    assert device["online"] is True
    assert device["readers"][0]["uid"] == KNOWN_UID
    assert device["rssi"] == -61


async def test_a_report_that_says_nothing_new_is_not_broadcast(
    client: AsyncClient, broadcast_events: list[dict[str, object]]
) -> None:
    """A device reports every five seconds whether or not anything happened. A socket
    message per device per five seconds is a busy TV for nothing.

    The uptime climbs and the signal wanders with every heartbeat, and neither is worth
    waking the room for: they are the two fields that are never the same twice.
    """
    _, token = await mapped_device(client)
    broadcast_events.clear()

    await post_report(client, token, readers=[reader(0), reader(1)], buttons=[button(0)])
    await post_report(
        client,
        token,
        readers=[reader(0), reader(1)],
        buttons=[button(0)],
        uptime_s=1234,
        rssi=-70,
    )

    assert device_events(broadcast_events) == []


async def test_a_reader_or_a_button_that_was_not_there_before_is_broadcast(
    client: AsyncClient, broadcast_events: list[dict[str, object]]
) -> None:
    """Somebody soldered another reader on and rebooted the device. The listing has a row
    more than it had, so the page holding it has to hear about it."""
    _, token = await mapped_device(client)
    broadcast_events.clear()
    await post_report(client, token, readers=[reader(0), reader(1)], buttons=[button(0)])

    await post_report(client, token, readers=[reader(0), reader(1), reader(2)], buttons=[button(0)])
    assert len(device_events(broadcast_events)) == 1

    await post_report(
        client, token, readers=[reader(0), reader(1), reader(2)], buttons=[button(0), button(1)]
    )
    assert len(device_events(broadcast_events)) == 2


@pytest.mark.parametrize(
    ("what", "body"),
    [
        # A snapshot has one entry per position, so two of them are two answers to the same
        # question and the last would quietly win.
        ("two entries for one reader", {"readers": [reader(0), reader(0, uid=KNOWN_UID)]}),
        ("two entries for one button", {"buttons": [button(0), button(0, presses=2)]}),
        # A reader answers in uppercase. A lowercase uid is another device's convention, and
        # the card table would hold two rows for one card.
        ("a uid in lowercase", {"readers": [reader(0, uid=KNOWN_UID.lower())]}),
        ("a uid nothing is that long", {"readers": [reader(0, uid="A" * 21)]}),
        ("a verdict the probe never gives", {"readers": [reader(0, state="melted")]}),
        ("a version byte that is not one", {"readers": [reader(0, version="zz")]}),
        ("presses below zero", {"buttons": [button(0, presses=-1)]}),
        # The protocol is the one number out of a report that is written to a column, and
        # SQLite stores 64 bits: a bigger one used to be an OverflowError halfway through
        # the write, which is a 500 for a body that had already been accepted.
        ("a protocol number nothing could be", {"protocol": 2**70}),
    ],
)
async def test_a_report_that_is_not_one_is_refused_before_anything_moves(
    client: AsyncClient, what: str, body: dict[str, Any]
) -> None:
    """The body is parsed, not read: a device (or whatever else has the token) cannot put
    the room into a state the protocol does not describe."""
    _, token = await mapped_device(client)

    response = await post_report(client, token, **body)

    assert response.status_code == 422, f"{what}: {response.text}"


async def test_another_protocol_is_recorded_and_then_refused(
    client: AsyncClient, broadcast_events: list[dict[str, object]]
) -> None:
    """A device Wingman cannot talk to still has to appear in the list, or the host has no
    way of learning that it needs updating."""
    created = await create_device(client)
    broadcast_events.clear()

    response = await post_report(client, created["token"], protocol=2, readers=[reader(0)])

    assert response.status_code == 426
    assert response.json() == {"detail": "protocol_unsupported", "supported": 1}
    device = await only_device(client)
    assert device["protocol"] == 2
    assert device["compatible"] is False
    assert device["last_seen_at"] is not None
    assert device["online"] is True
    assert len(device_events(broadcast_events)) == 1


async def test_a_device_that_was_updated_starts_from_nothing(
    client: AsyncClient,
    session: AsyncSession,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    """A report Wingman cannot read is a heartbeat and nothing else, so the first one after
    the firmware update is diffed against nothing: the card that was lying there all along
    is a card being put down."""
    alice = await add_player(client, "Alice")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})
    _, token = await mapped_device(client, reader_roles={"0": "slot:blue"})
    lying_there = [reader(0, uid=KNOWN_UID), reader(1)]
    assert (await post_report(client, token, protocol=2, readers=lying_there)).status_code == 426
    await two_slot_selection(session, song)
    broadcast_events.clear()

    await post_report(client, token, readers=lying_there)

    assert player_names(await current_slots()) == ["Alice", None]
    # And the room hears that this device can be talked to again.
    assert len(device_events(broadcast_events)) == 1


# --- the diff, on the selection ---------------------------------------------------------


async def test_a_card_on_a_slot_reader_puts_its_player_on_that_slot(
    client: AsyncClient, session: AsyncSession, song: str
) -> None:
    yannis = await add_player(client, "Yannis")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": yannis["id"]})
    _, token = await mapped_device(client, reader_roles={"0": "slot:blue"})
    await two_slot_selection(session, song)

    await post_report(client, token, readers=[reader(0, uid=KNOWN_UID), reader(1)])

    response = await client.get("/api/v1/karaoke/selection")
    slots = response.json()["selection"]["slots"]
    assert player_names(slots) == ["Yannis", None]
    assert slots[0]["card_uid"] == KNOWN_UID

    # And lifting it empties the slot again.
    await post_report(client, token, readers=[reader(0), reader(1)])

    assert player_names(await current_slots()) == [None, None]


async def test_a_card_nobody_owns_holds_the_slot_as_an_unknown_card(
    client: AsyncClient, session: AsyncSession, song: str
) -> None:
    _, token = await mapped_device(client, reader_roles={"0": "slot:blue"})
    await two_slot_selection(session, song)

    await post_report(client, token, readers=[reader(0, uid=OTHER_UID), reader(1)])

    slots = await current_slots()
    assert slots[0]["player"] is None
    assert slots[0]["card_uid"] == OTHER_UID


async def test_a_card_swapped_on_one_reader_takes_the_slot_over(
    client: AsyncClient, session: AsyncSession, song: str
) -> None:
    """One report, two cards: the one that left is taken off the slot before the one that
    arrived takes it, so the slot ends up holding the card that is really lying there."""
    alice = await add_player(client, "Alice")
    bob = await add_player(client, "Bob")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})
    await client.put(f"/api/v1/devices/cards/{OTHER_UID}", json={"player_id": bob["id"]})
    _, token = await mapped_device(client, reader_roles={"0": "slot:blue"})
    await two_slot_selection(session, song)

    await post_report(client, token, readers=[reader(0, uid=KNOWN_UID), reader(1)])
    await post_report(client, token, readers=[reader(0, uid=OTHER_UID), reader(1)])

    assert player_names(await current_slots()) == ["Bob", None]


async def test_a_report_that_was_overtaken_by_a_newer_one_changes_nothing(
    client: AsyncClient,
    session: AsyncSession,
    song: str,
    broadcast_events: list[dict[str, object]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The firmware retries after a client-side timeout, so two snapshots of one device can be
    in flight at once and the older one can reach the lock second. It must not put the card
    back on a slot the newer report has already emptied — nor its row back to what it said."""
    clock = [datetime.now(UTC)]
    monkeypatch.setattr(devices, "_now", lambda: clock[0])
    yannis = await add_player(client, "Yannis")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": yannis["id"]})
    _, token = await mapped_device(client, reader_roles={"0": "slot:blue"})
    await two_slot_selection(session, song)
    await post_report(client, token, readers=[reader(0, uid=KNOWN_UID), reader(1)])
    assert player_names(await current_slots()) == ["Yannis", None]
    stamped_first = (await only_device(client))["last_seen_at"]

    gate = HoldAtTheLock(devices._lock)
    monkeypatch.setattr(devices, "_lock", gate)
    # The retry of the report above: entered first, and held at the lock's door.
    retry = asyncio.create_task(
        post_report(client, token, readers=[reader(0, uid=KNOWN_UID), reader(1)])
    )
    await asyncio.wait_for(gate.at_the_door.wait(), 5)

    # The card is lifted while the retry stands there, and that report goes all the way in.
    clock[0] += timedelta(seconds=1)
    lifted = await post_report(client, token, readers=[reader(0), reader(1)])
    assert lifted.status_code == 200, lifted.text
    assert player_names(await current_slots()) == [None, None]
    settled = await only_device(client)
    assert settled["last_seen_at"] != stamped_first
    said_so_far = len(broadcast_events)

    # The device is fine and its newer state is already in, so the stale report is acked.
    gate.let_go.set()
    assert (await asyncio.wait_for(retry, 5)).status_code == 200

    # And nothing of it reached the room, the live state or the row.
    assert player_names(await current_slots()) == [None, None]
    assert len(broadcast_events) == said_so_far
    assert await only_device(client) == settled


async def test_a_reader_everybody_scans_in_turn_fills_the_slots(
    client: AsyncClient, session: AsyncSession, song: str
) -> None:
    alice = await add_player(client, "Alice")
    bob = await add_player(client, "Bob")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})
    await client.put(f"/api/v1/devices/cards/{OTHER_UID}", json={"player_id": bob["id"]})
    _, token = await mapped_device(client, reader_roles={"0": "sequential"})
    await two_slot_selection(session, song)

    await post_report(client, token, readers=[reader(0, uid=KNOWN_UID), reader(1)])
    await post_report(client, token, readers=[reader(0), reader(1)])
    await post_report(client, token, readers=[reader(0, uid=OTHER_UID), reader(1)])

    # Taking a card off a scanning reader does nothing: it is a scan, not a place.
    assert player_names(await current_slots()) == ["Alice", "Bob"]


async def test_scanning_again_takes_the_singer_off_or_leaves_them_standing(
    client: AsyncClient, session: AsyncSession, song: str
) -> None:
    """`rescan_removes` is the whole difference between "I am here" and "I am here, and I
    take it back"."""
    alice = await add_player(client, "Alice")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})
    _, token = await mapped_device(client, reader_roles={"0": "sequential"})
    await two_slot_selection(session, song)

    await post_report(client, token, readers=[reader(0, uid=KNOWN_UID), reader(1)])
    await post_report(client, token, readers=[reader(0), reader(1)])
    await post_report(client, token, readers=[reader(0, uid=KNOWN_UID), reader(1)])
    assert player_names(await current_slots()) == [None, None]

    response = await client.patch("/api/v1/devices/settings", json={"rescan_removes": False})
    assert response.status_code == 200, response.text
    await post_report(client, token, readers=[reader(0), reader(1)])
    await post_report(client, token, readers=[reader(0, uid=KNOWN_UID), reader(1)])
    await post_report(client, token, readers=[reader(0), reader(1)])
    await post_report(client, token, readers=[reader(0, uid=KNOWN_UID), reader(1)])

    assert player_names(await current_slots()) == ["Alice", None]


async def test_the_buttons_start_clear_and_cancel(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    alice = await add_player(client, "Alice")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})
    _, token = await mapped_device(
        client,
        reader_roles={"0": "slot:blue"},
        button_actions={"0": "start", "1": "clear", "2": "cancel"},
        buttons=3,
    )
    await two_slot_selection(session, song)
    lying_there = [reader(0, uid=KNOWN_UID), reader(1)]
    await post_report(client, token, readers=lying_there, buttons=[button(0), button(1), button(2)])

    # Clear empties the slots and leaves the selection standing.
    await post_report(
        client, token, readers=lying_there, buttons=[button(0), button(1, 1), button(2)]
    )
    assert player_names(await current_slots()) == [None, None]

    # Start sings what is on the slots, so somebody has to be on one again.
    await post_report(
        client, token, readers=[reader(0), reader(1)], buttons=[button(0), button(1, 1), button(2)]
    )
    await post_report(
        client, token, readers=lying_there, buttons=[button(0), button(1, 1), button(2)]
    )
    await post_report(
        client, token, readers=lying_there, buttons=[button(0, 1), button(1, 1), button(2)]
    )
    await wait_for(configured.argv_file)
    assert await selection.current_selection() is None
    assert any(event["event"] == "karaoke.started" for event in broadcast_events)
    await karaoke.wait_for_sing_end()

    # And cancel gives a selection up altogether.
    await two_slot_selection(session, song)
    await post_report(
        client, token, readers=lying_there, buttons=[button(0, 1), button(1, 1), button(2, 1)]
    )
    assert await selection.current_selection() is None


async def test_a_button_with_no_action_does_nothing(
    client: AsyncClient, session: AsyncSession, song: str
) -> None:
    _, token = await mapped_device(client, button_actions={"0": "none"})
    await two_slot_selection(session, song)

    await post_report(client, token, readers=[reader(0), reader(1)], buttons=[button(0, 7)])

    assert await selection.current_selection() is not None


async def test_the_first_report_places_the_cards_but_presses_nothing(
    client: AsyncClient, session: AsyncSession, song: str
) -> None:
    """A press counter counts since the device booted, so the first report's number is
    history and not a press. A card lying on a reader is a person standing in the room."""
    alice = await add_player(client, "Alice")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})
    created = await create_device(client)
    device_id, token = created["device"]["id"], created["token"]
    await post_report(client, token, readers=[reader(0), reader(1)], buttons=[button(0)])
    response = await client.patch(
        f"/api/v1/devices/{device_id}",
        json={"reader_roles": {"0": "slot:blue"}, "button_actions": {"0": "cancel"}},
    )
    assert response.status_code == 200, response.text
    # Everything the device knows is forgotten with the process, so this is what a Wingman
    # that was restarted sees: a card already lying there and a counter at 99.
    devices._live.clear()
    await two_slot_selection(session, song)

    await post_report(
        client, token, readers=[reader(0, uid=KNOWN_UID), reader(1)], buttons=[button(0, 99)]
    )

    assert player_names(await current_slots()) == ["Alice", None]


async def test_a_device_that_rebooted_has_not_pressed_its_buttons(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, song: str
) -> None:
    """The counter counts since boot, so a smaller number than last time is a device that
    lost its presses and not a device that collected one. Somebody knocked the power out;
    nobody started a song."""
    alice = await add_player(client, "Alice")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})
    _, token = await mapped_device(
        client, reader_roles={"0": "slot:blue"}, button_actions={"0": "start"}
    )
    lying_there = [reader(0, uid=KNOWN_UID), reader(1)]
    # Three presses from earlier in the evening, and then somebody puts their card down.
    await post_report(client, token, readers=[reader(0), reader(1)], buttons=[button(0, 3)])
    await two_slot_selection(session, song)
    await post_report(client, token, readers=lying_there, buttons=[button(0, 3)])
    assert player_names(await current_slots()) == ["Alice", None]

    await post_report(client, token, readers=lying_there, buttons=[button(0, 0)])

    assert await selection.current_selection() is not None
    assert not configured.argv_file.exists()

    # And the first press after the reboot is a press like any other.
    await post_report(client, token, readers=lying_there, buttons=[button(0, 1)])

    await wait_for(configured.argv_file)
    assert await selection.current_selection() is None
    await karaoke.wait_for_sing_end()


async def test_the_slots_are_dealt_with_before_the_reader_everybody_scans(
    client: AsyncClient, session: AsyncSession, song: str
) -> None:
    """One report, two cards: one on the blue slot's reader and one held against the reader
    everybody scans in turn. A scan takes the first *free* slot, so the slot reader has to
    have put its singer down first — whichever position the host wired them to."""
    alice = await add_player(client, "Alice")
    bob = await add_player(client, "Bob")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})
    await client.put(f"/api/v1/devices/cards/{OTHER_UID}", json={"player_id": bob["id"]})
    # The scanning reader comes *first*, which is what the order in the report would give it.
    _, token = await mapped_device(client, reader_roles={"0": "sequential", "1": "slot:blue"})
    await two_slot_selection(session, song)

    await post_report(client, token, readers=[reader(0, uid=OTHER_UID), reader(1, uid=KNOWN_UID)])

    # Alice's card lies on blue; Bob scanned, so he takes the slot that was left free.
    assert player_names(await current_slots()) == ["Alice", "Bob"]


async def test_a_full_room_starts_by_itself_after_the_delay(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    alice = await add_player(client, "Alice")
    bob = await add_player(client, "Bob")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})
    await client.put(f"/api/v1/devices/cards/{OTHER_UID}", json={"player_id": bob["id"]})
    response = await client.patch(
        "/api/v1/devices/settings", json={"auto_start": True, "auto_start_delay_s": 0}
    )
    assert response.status_code == 200, response.text
    _, token = await mapped_device(client, reader_roles={"0": "slot:blue", "1": "slot:red"})
    await two_slot_selection(session, song)

    await post_report(client, token, readers=[reader(0, uid=KNOWN_UID), reader(1)])
    current = await selection.current_selection()
    assert current is not None and current.auto_start_at is None

    await post_report(client, token, readers=[reader(0, uid=KNOWN_UID), reader(1, uid=OTHER_UID)])

    await selection.wait_for_auto_start()
    await wait_for(configured.argv_file)
    assert await selection.current_selection() is None
    assert any(event["event"] == "karaoke.started" for event in broadcast_events)
    await karaoke.wait_for_sing_end()


async def test_a_selection_opens_with_the_cards_that_are_already_lying_there(
    client: AsyncClient, session: AsyncSession, song: str
) -> None:
    """The people at the selector are already standing in the room: their slots are theirs
    before the phone's remembered assignment gets a say."""
    alice = await add_player(client, "Alice")
    bob = await add_player(client, "Bob")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})
    _, token = await mapped_device(client, reader_roles={"0": "slot:blue"})
    await post_report(client, token, readers=[reader(0, uid=KNOWN_UID), reader(1)])
    await two_slot_selection(session, song)
    await selection.close_selection(any_opener=True)

    response = await client.post(
        "/api/v1/karaoke/selection",
        json={"song_id": song, "slots": [{"color": "blue", "player_id": bob["id"]}]},
    )

    assert response.status_code == 201, response.text
    slots = response.json()["selection"]["slots"]
    assert player_names(slots) == ["Alice", None]
    assert slots[0]["card_uid"] == KNOWN_UID


async def test_an_offline_device_seeds_nothing(
    client: AsyncClient, session: AsyncSession, song: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    alice = await add_player(client, "Alice")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})
    _, token = await mapped_device(client, reader_roles={"0": "slot:blue"})
    await post_report(client, token, readers=[reader(0, uid=KNOWN_UID), reader(1)])
    monkeypatch.setattr(devices, "_now", lambda: datetime.now(UTC) + timedelta(minutes=1))

    response = await client.post("/api/v1/karaoke/selection", json={"song_id": song})

    assert response.status_code == 201, response.text
    assert player_names(response.json()["selection"]["slots"]) == [None, None, None, None]


async def open_with_remembered(
    client: AsyncClient, song: str, slots: list[dict[str, object]]
) -> list[dict[str, Any]]:
    """A selection opened the way a phone opens one: carrying who sang the last song."""
    response = await client.post(
        "/api/v1/karaoke/selection", json={"song_id": song, "slots": slots}
    )
    assert response.status_code == 201, response.text
    opened: list[dict[str, Any]] = response.json()["selection"]["slots"]
    return opened


async def test_an_online_selector_drops_the_remembered_singers(
    client: AsyncClient, song: str, caplog: pytest.LogCaptureFixture
) -> None:
    """The cards are how a room with a selector picks its singers: every scan fills the
    first free slot, so the last song's singers only stand in the queue's way."""
    alice = await add_player(client, "Alice")
    bob = await add_player(client, "Bob")
    await mapped_device(client, reader_roles={"0": "sequential"})
    caplog.set_level(logging.INFO, logger="ultrastar_wingman.karaoke.api")

    slots = await open_with_remembered(
        client,
        song,
        [
            {"color": "blue", "player_id": alice["id"]},
            {"color": "red", "player_id": bob["id"]},
        ],
    )

    assert player_names(slots) == [None, None, None, None]
    dropped = [record for record in caplog.records if "selector is online" in record.getMessage()]
    assert len(dropped) == 1


async def test_a_selector_that_has_gone_quiet_leaves_the_remembered_singers_alone(
    client: AsyncClient, song: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The rule is about a device standing in the room, not about a mapping in the database.

    Offline is the only way a mapped device says nothing: a role may not be set on a reader
    that has never reported as wired.
    """
    alice = await add_player(client, "Alice")
    await mapped_device(client, reader_roles={"0": "sequential"})
    monkeypatch.setattr(devices, "_now", lambda: datetime.now(UTC) + timedelta(minutes=1))

    slots = await open_with_remembered(client, song, [{"color": "blue", "player_id": alice["id"]}])

    assert player_names(slots) == ["Alice", None, None, None]


async def test_slot_readers_online_drop_the_remembered_singers_too(
    client: AsyncClient, song: str, caplog: pytest.LogCaptureFixture
) -> None:
    """Whichever way the readers are mapped, an online selector means the cards decide: the
    card lying on the blue reader seeds blue, the phone's memory seeds nothing."""
    alice = await add_player(client, "Alice")
    bob = await add_player(client, "Bob")
    carol = await add_player(client, "Carol")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})
    _, token = await mapped_device(client, reader_roles={"0": "slot:blue"})
    await post_report(client, token, readers=[reader(0, uid=KNOWN_UID), reader(1)])
    caplog.set_level(logging.INFO, logger="ultrastar_wingman.karaoke.api")

    slots = await open_with_remembered(
        client,
        song,
        [
            {"color": "blue", "player_id": bob["id"]},
            {"color": "red", "player_id": carol["id"]},
        ],
    )

    assert player_names(slots) == ["Alice", None, None, None]
    dropped = [record for record in caplog.records if "selector is online" in record.getMessage()]
    assert len(dropped) == 1


async def test_scanning_in_turn_still_opens_with_the_cards_that_are_lying_there(
    client: AsyncClient, song: str
) -> None:
    """The memory goes; the room does not. Alice's card is on the blue reader, so blue is
    hers before anybody scans."""
    alice = await add_player(client, "Alice")
    bob = await add_player(client, "Bob")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})
    _, token = await mapped_device(client, reader_roles={"0": "sequential", "1": "slot:blue"})
    await post_report(client, token, readers=[reader(0), reader(1, uid=KNOWN_UID)])

    slots = await open_with_remembered(client, song, [{"color": "red", "player_id": bob["id"]}])

    assert player_names(slots) == ["Alice", None, None, None]
    assert slots[0]["card_uid"] == KNOWN_UID


# --- the mapping ------------------------------------------------------------------------


async def test_a_role_on_a_reader_that_never_answered_is_refused(client: AsyncClient) -> None:
    device_id, _ = await mapped_device(client)

    response = await client.patch(
        f"/api/v1/devices/{device_id}", json={"reader_roles": {"5": "slot:blue"}}
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "reader_not_wired"}


async def test_a_role_on_a_reader_that_answered_with_a_fault_is_refused(
    client: AsyncClient,
) -> None:
    created = await create_device(client)
    device_id, token = created["device"]["id"], created["token"]
    await post_report(client, token, readers=[reader(0, state="fault", version="3a")])

    response = await client.patch(
        f"/api/v1/devices/{device_id}", json={"reader_roles": {"0": "slot:blue"}}
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "reader_not_wired"}


async def test_a_color_no_microphone_has_and_two_readers_on_one_slot_are_refused(
    client: AsyncClient,
) -> None:
    device_id, _ = await mapped_device(client)

    unknown = await client.patch(
        f"/api/v1/devices/{device_id}", json={"reader_roles": {"0": "slot:beige"}}
    )
    assert unknown.status_code == 422
    assert unknown.json() == {"detail": "unknown_color"}

    duplicate = await client.patch(
        f"/api/v1/devices/{device_id}",
        json={"reader_roles": {"0": "slot:blue", "1": "slot:blue"}},
    )
    assert duplicate.status_code == 422
    assert duplicate.json() == {"detail": "duplicate_slot"}

    nonsense = await client.patch(
        f"/api/v1/devices/{device_id}", json={"button_actions": {"0": "explode"}}
    )
    assert nonsense.status_code == 422
    assert nonsense.json() == {"detail": "unknown_action"}

    role = await client.patch(
        f"/api/v1/devices/{device_id}", json={"reader_roles": {"0": "whatever"}}
    )
    assert role.status_code == 422
    assert role.json() == {"detail": "unknown_role"}

    # A position no map has: not a number at all, and a number past the readers there could
    # ever be. Both are a client inventing positions, not a reader that came loose.
    for position in ("blue", "99"):
        nowhere = await client.patch(
            f"/api/v1/devices/{device_id}", json={"reader_roles": {position: "slot:blue"}}
        )
        assert nowhere.status_code == 422, nowhere.text
        assert nowhere.json() == {"detail": "unknown_position"}
    button_nowhere = await client.patch(
        f"/api/v1/devices/{device_id}", json={"button_actions": {"99": "start"}}
    )
    assert button_nowhere.status_code == 422
    assert button_nowhere.json() == {"detail": "unknown_position"}


async def test_taking_a_role_away_works_on_a_reader_that_came_loose(
    client: AsyncClient,
) -> None:
    """`unused` is the absence of a role, so it is allowed on a reader that stopped
    answering — otherwise a broken reader could never be unmapped."""
    device_id, token = await mapped_device(client, reader_roles={"0": "slot:blue"})
    await post_report(client, token, readers=[reader(0, state="none", version="00"), reader(1)])

    response = await client.patch(
        f"/api/v1/devices/{device_id}", json={"reader_roles": {"0": "unused"}}
    )

    assert response.status_code == 200, response.text
    assert [entry["role"] for entry in response.json()["readers"]] == ["unused", "unused"]


async def test_renaming_and_deleting_a_device(client: AsyncClient) -> None:
    device_id, _ = await mapped_device(client)

    renamed = await client.patch(f"/api/v1/devices/{device_id}", json={"name": "By the TV"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "By the TV"

    assert (await client.delete(f"/api/v1/devices/{device_id}")).status_code == 204
    assert (await client.get("/api/v1/devices")).json()["devices"] == []
    assert (
        await client.patch(f"/api/v1/devices/{device_id}", json={"name": "x"})
    ).status_code == 404


async def test_a_name_of_nothing_but_spaces_is_refused_and_a_padded_one_is_trimmed(
    client: AsyncClient,
) -> None:
    """A name is counted after it is stripped, so the list can never draw a nameless row."""
    assert (await client.post("/api/v1/devices", json={"name": "   "})).status_code == 422

    created = await create_device(client, "  Living room  ")
    assert created["device"]["name"] == "Living room"
    device_id = created["device"]["id"]

    renamed = await client.patch(f"/api/v1/devices/{device_id}", json={"name": "  By the TV  "})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "By the TV"

    blank = await client.patch(f"/api/v1/devices/{device_id}", json={"name": " "})
    assert blank.status_code == 422
    assert (await only_device(client))["name"] == "By the TV"


# --- the cards --------------------------------------------------------------------------


async def test_the_card_table(client: AsyncClient) -> None:
    alice = await add_player(client, "Alice")
    bob = await add_player(client, "Bob")

    # A reader answers in uppercase; a host typing a uid by hand may not.
    assigned = await client.put(
        f"/api/v1/devices/cards/{KNOWN_UID.lower()}", json={"player_id": alice["id"]}
    )
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["uid"] == KNOWN_UID

    # Assigning it again moves it: a card handed on to the next guest is theirs now.
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": bob["id"]})
    cards = (await client.get("/api/v1/devices/cards")).json()["cards"]
    assert [(card["uid"], card["player"]["name"]) for card in cards] == [(KNOWN_UID, "Bob")]

    assert (await client.delete(f"/api/v1/devices/cards/{KNOWN_UID}")).status_code == 204
    assert (await client.get("/api/v1/devices/cards")).json()["cards"] == []
    assert (await client.delete(f"/api/v1/devices/cards/{KNOWN_UID}")).status_code == 404


async def test_a_card_of_an_unknown_player_is_refused(client: AsyncClient) -> None:
    response = await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": "nope"})

    assert response.status_code == 404


async def test_something_that_is_not_a_card_id_is_refused(client: AsyncClient) -> None:
    """The uid is the key of the card table and it comes off a reader as hex. A row under
    anything else is a row no reader will ever look up."""
    alice = await add_player(client, "Alice")

    for uid in ("nope", "A1B2", "Z1B2C3D4", "A" * 21):
        response = await client.put(f"/api/v1/devices/cards/{uid}", json={"player_id": alice["id"]})
        assert response.status_code == 422, f"{uid}: {response.text}"
        assert response.json() == {"detail": "invalid_uid"}

    assert (await client.get("/api/v1/devices/cards")).json()["cards"] == []


async def test_the_cards_of_a_deleted_player_go_with_them(client: AsyncClient) -> None:
    alice = await add_player(client, "Alice")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})

    assert (await client.delete(f"/api/v1/players/{alice['id']}")).status_code == 204

    assert (await client.get("/api/v1/devices/cards")).json()["cards"] == []


async def test_naming_the_card_on_a_slot_fills_it_without_lifting_the_card(
    client: AsyncClient,
    session: AsyncSession,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    """The admin page's own path: a card nobody owned lies on the blue reader and shows as
    an unknown card. Naming it is what the room sees — the device reports nothing more,
    because the card has not moved."""
    alice = await add_player(client, "Alice")
    _, token = await mapped_device(client, reader_roles={"0": "slot:blue"})
    await two_slot_selection(session, song)
    await post_report(client, token, readers=[reader(0, uid=OTHER_UID), reader(1)])
    assert player_names(await current_slots()) == [None, None]

    response = await client.put(
        f"/api/v1/devices/cards/{OTHER_UID}", json={"player_id": alice["id"]}
    )

    assert response.status_code == 200, response.text
    read = await client.get("/api/v1/karaoke/selection")
    slots = read.json()["selection"]["slots"]
    assert player_names(slots) == ["Alice", None]
    assert slots[0]["card_uid"] == OTHER_UID
    assert player_names(selection_events(broadcast_events)[-1]["selection"]["slots"]) == [
        "Alice",
        None,
    ]


async def test_forgetting_the_card_on_a_slot_makes_it_an_unknown_card_again(
    client: AsyncClient, session: AsyncSession, song: str
) -> None:
    """The card is still on the reader, so the slot keeps it; nobody is scored for a card
    that belongs to nobody."""
    alice = await add_player(client, "Alice")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})
    _, token = await mapped_device(client, reader_roles={"0": "slot:blue"})
    await two_slot_selection(session, song)
    await post_report(client, token, readers=[reader(0, uid=KNOWN_UID), reader(1)])
    assert player_names(await current_slots()) == ["Alice", None]

    assert (await client.delete(f"/api/v1/devices/cards/{KNOWN_UID}")).status_code == 204

    slots = (await client.get("/api/v1/karaoke/selection")).json()["selection"]["slots"]
    assert player_names(slots) == [None, None]
    assert slots[0]["card_uid"] == KNOWN_UID


# --- the options ------------------------------------------------------------------------


async def test_the_three_options(client: AsyncClient) -> None:
    defaults = await client.get("/api/v1/devices/settings")
    assert defaults.status_code == 200, defaults.text
    assert defaults.json() == {
        "auto_start": False,
        "auto_start_delay_s": 3,
        "rescan_removes": True,
    }

    changed = await client.patch(
        "/api/v1/devices/settings", json={"auto_start": True, "auto_start_delay_s": 10}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json() == {
        "auto_start": True,
        "auto_start_delay_s": 10,
        "rescan_removes": True,
    }

    refused = await client.patch("/api/v1/devices/settings", json={"auto_start_delay_s": 99})
    assert refused.status_code == 422
    assert "0 and 30" in refused.json()["detail"]
    assert (await client.get("/api/v1/devices/settings")).json()["auto_start_delay_s"] == 10


async def test_the_options_stay_out_of_the_settings_api(client: AsyncClient) -> None:
    """They are stored as settings and they are not settings: the one gate on them is
    `devices.manage`, which is not `settings.manage`."""
    response = await client.get("/api/v1/settings")
    assert response.status_code == 200, response.text
    assert not [row for row in response.json() if row["key"].startswith("devices.")]

    assert (
        await client.patch("/api/v1/settings/devices.auto_start", json={"value": True})
    ).status_code == 404


# --- the firmware -----------------------------------------------------------------------


@pytest.fixture
def no_firmware(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A firmware directory with nothing in it. A checkout that never ran the build has
    exactly this, and the tests must not read whatever the developer's machine built."""
    directory = tmp_path / "firmware"
    directory.mkdir()
    monkeypatch.setattr(firmware, "firmware_dir", lambda: directory)
    return directory


async def test_a_checkout_without_a_build_has_no_firmware(
    client: AsyncClient, no_firmware: Path
) -> None:
    response = await client.get("/api/v1/devices/firmware")

    assert response.status_code == 404
    assert response.json() == {"detail": "no_firmware"}


async def test_the_bundled_image_is_served_and_nothing_else_is(
    client: AsyncClient, no_firmware: Path
) -> None:
    (no_firmware / "wingman-esp32.bin").write_bytes(b"\xe9firmware")
    (no_firmware / "secrets.txt").write_text("not yours", encoding="utf-8")
    (no_firmware / "manifest.json").write_text(
        json.dumps(
            {
                "version": "0.1.0",
                "protocol": 1,
                "builds": [{"chip": "ESP32", "file": "wingman-esp32.bin", "size": 9}],
            }
        ),
        encoding="utf-8",
    )

    manifest = await client.get("/api/v1/devices/firmware")
    assert manifest.status_code == 200, manifest.text
    assert manifest.json()["version"] == "0.1.0"
    assert manifest.json()["builds"][0]["file"] == "wingman-esp32.bin"

    image = await client.get("/api/v1/devices/firmware/wingman-esp32.bin")
    assert image.status_code == 200
    assert image.content == b"\xe9firmware"

    # The manifest is the allowlist: a file beside the image is not served, and neither is
    # anything trying to leave the directory.
    assert (await client.get("/api/v1/devices/firmware/secrets.txt")).status_code == 404
    assert (await client.get("/api/v1/devices/firmware/..%2Fmanifest.json")).status_code == 404

    # A half-written build directory — the manifest there, the image not yet — is a 404 as
    # well, on the page the host opened to find out what is wrong.
    (no_firmware / "wingman-esp32.bin").unlink()
    assert (await client.get("/api/v1/devices/firmware/wingman-esp32.bin")).status_code == 404


async def test_a_manifest_that_cannot_be_read_is_no_firmware(no_firmware: Path) -> None:
    (no_firmware / "manifest.json").write_text("{ this is not json", encoding="utf-8")

    assert firmware.read_manifest() is None


def test_a_manifest_that_names_a_path_serves_nothing(no_firmware: Path) -> None:
    """The route's own path segment cannot hold a separator, so this is the other half of
    the guard: a manifest somebody wrote by hand naming a file outside the directory."""
    (no_firmware / "manifest.json").write_text(
        json.dumps(
            {
                "version": "0.1.0",
                "protocol": 1,
                "builds": [{"chip": "ESP32", "file": name, "size": 1} for name in TAMPERED_NAMES],
            }
        ),
        encoding="utf-8",
    )

    for name in (*TAMPERED_NAMES, "nothing.bin"):
        assert firmware.image_path(name) is None, name


# --- the watchdog -----------------------------------------------------------------------


async def test_the_watchdog_marks_a_device_offline_and_says_so_once(
    client: AsyncClient, broadcast_events: list[dict[str, object]], monkeypatch: pytest.MonkeyPatch
) -> None:
    _, token = await mapped_device(client)
    broadcast_events.clear()
    monkeypatch.setattr(
        devices, "_now", lambda: datetime.now(UTC) + devices.OFFLINE_AFTER + timedelta(seconds=1)
    )

    await devices.watchdog_tick()
    await devices.watchdog_tick()

    assert len(device_events(broadcast_events)) == 1
    assert (await only_device(client))["online"] is False


async def test_the_watchdog_drops_a_selection_nobody_is_touching(
    client: AsyncClient, song: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The selection's own expiry is lazy, and with everybody at the bar there is no next
    call. This is what clears the TV then."""
    response = await client.post("/api/v1/karaoke/selection", json={"song_id": song})
    assert response.status_code == 201, response.text
    monkeypatch.setattr(
        selection, "_now", lambda: datetime.now(UTC) + selection.IDLE_TTL + timedelta(seconds=1)
    )

    await devices.watchdog_tick()

    assert await selection.current_selection() is None
