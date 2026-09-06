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
from typing import Any, cast

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy.ext.asyncio import AsyncSession

import test_karaoke_api
from conftest import ADMIN_PASSWORD, BASE_URL, admin_client, authenticate_admin
from test_karaoke_api import FakeUsdx, add_player, make_song_dir, wait_for
from test_karaoke_selection import (
    TWO_SLOTS,
    current_slots,
    player_names,
    selection_events,
    two_slot_selection,
)
from ultrastar_wingman.app import create_app
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.devices import firmware
from ultrastar_wingman.devices import service as devices
from ultrastar_wingman.devices.protocol import DeviceReport
from ultrastar_wingman.karaoke import selection
from ultrastar_wingman.karaoke import service as karaoke
from ultrastar_wingman.karaoke.schema import SelectionRead
from ultrastar_wingman.settings import SettingsService
from ultrastar_wingman.songs.model import Song

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
    name: str = "Selector",
) -> tuple[str, str]:
    """A device that has reported once — so its readers are known to be wired — with the
    mapping the test needs. Returns its id and its token."""
    created = await create_device(client, name)
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
    # Nothing is mapped, so every reader is dark, and nobody is picking singers, so five
    # seconds is often enough to hear from it.
    assert response.json() == {
        "ok": True,
        "protocol": 1,
        "interval_s": 5,
        "leds": [{"index": index, "rgb": "000000", "mode": "off"} for index in range(3)],
        "update": None,
    }
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


async def test_another_protocol_is_recorded_even_when_the_rest_is_unreadable(
    client: AsyncClient, broadcast_events: list[dict[str, object]]
) -> None:
    """The protocol is read before the body is. A firmware whose report grew a field — or
    changed one — has to show up as a device that needs updating, not as a body Wingman
    refuses to look at."""
    created = await create_device(client)
    broadcast_events.clear()

    response = await client.post(
        "/api/v1/devices/report",
        json={
            "protocol": 2,
            "firmware": "0.4.0",
            "readers": [{"index": 0, "sensor": "pn532", "tag": {"uid": "A1B2C3D4"}}],
        },
        headers={"Authorization": f"Bearer {created['token']}"},
    )

    assert response.status_code == 426
    assert response.json() == {"detail": "protocol_unsupported", "supported": 1}
    device = await only_device(client)
    assert device["protocol"] == 2
    assert device["compatible"] is False
    assert device["firmware_version"] == "0.4.0"
    assert device["last_seen_at"] is not None
    assert device["online"] is True
    # Nothing of a report Wingman cannot read is believed: the readers are the ones the last
    # boot probe found, which is none.
    assert device["readers"] == []
    assert len(device_events(broadcast_events)) == 1


async def test_a_report_of_this_protocol_that_is_not_one_leaves_the_row_alone(
    client: AsyncClient,
) -> None:
    """A body claiming the protocol Wingman speaks is held to it: 422, and the device is
    still saying whatever it last said."""
    _, token = await mapped_device(client)
    before = await only_device(client)

    response = await client.post(
        "/api/v1/devices/report",
        json={"protocol": 1, "firmware": "0.9.9", "readers": [{"index": "left"}]},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 422
    after = await only_device(client)
    assert after["last_seen_at"] == before["last_seen_at"]
    assert after["firmware_version"] == before["firmware_version"]


async def test_a_body_that_is_not_json_at_all_is_refused(client: AsyncClient) -> None:
    _, token = await mapped_device(client)

    response = await client.post(
        "/api/v1/devices/report",
        content=b"not json",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )

    assert response.status_code == 422


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


async def test_one_color_is_read_by_one_device_and_a_deleted_device_frees_it(
    client: AsyncClient,
) -> None:
    """A color is a microphone, and two readers answering for it is two people on one slot.
    The second device cannot know what the first one reads, so the refusal names it."""
    first, _ = await mapped_device(client, reader_roles={"0": "slot:blue"}, name="Living room")
    second, _ = await mapped_device(client, name="By the TV")

    refused = await client.patch(
        f"/api/v1/devices/{second}", json={"reader_roles": {"0": "slot:blue"}}
    )

    assert refused.status_code == 422
    assert refused.json() == {
        "detail": {"error": "slot_taken_elsewhere", "color": "blue", "device": "Living room"}
    }
    # Its own color is not taken from it: saving the mapping it already has must work.
    keeps = await client.patch(
        f"/api/v1/devices/{first}", json={"reader_roles": {"0": "slot:blue", "1": "sequential"}}
    )
    assert keeps.status_code == 200, keeps.text

    # And the color comes back with the device that read it.
    assert (await client.delete(f"/api/v1/devices/{first}")).status_code == 204
    freed = await client.patch(
        f"/api/v1/devices/{second}", json={"reader_roles": {"0": "slot:blue"}}
    )
    assert freed.status_code == 200, freed.text
    assert [entry["role"] for entry in freed.json()["readers"]] == ["slot:blue", "unused"]


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


def read_back(stamp: str) -> datetime:
    """One timestamp out of an answer, as the browser reads it. A naive one is what SQLite
    hands back, and `new Date()` would take it for a local time — so the assertion is that
    it carries an offset at all, and that the offset is the right one."""
    parsed = datetime.fromisoformat(stamp)
    assert parsed.tzinfo is not None, stamp
    return parsed


async def test_every_timestamp_says_which_clock_it_is_on(client: AsyncClient) -> None:
    """`DateTime(timezone=True)` is a no-op on SQLite, so a row read back is naive: the
    device page would draw "last seen" hours out, on every machine that is not on UTC.

    The row has to be read back out of the database for this to be the answer at all — the
    one the writing request builds is still holding the aware value it wrote.
    """
    alice = await add_player(client, "Alice")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})
    _, token = await mapped_device(client)
    await post_report(client, token)
    before = datetime.now(UTC) - timedelta(minutes=1)

    listed = await only_device(client)
    cards = (await client.get("/api/v1/devices/cards")).json()["cards"]

    for stamp in (listed["created_at"], listed["last_seen_at"], cards[0]["created_at"]):
        assert before < read_back(stamp) < datetime.now(UTC), stamp


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


async def test_giving_the_card_on_a_slot_to_somebody_else_moves_the_slot(
    client: AsyncClient, session: AsyncSession, song: str
) -> None:
    """The other half of naming a card: it was Alice's, the host hands it to Bob, and Bob is
    the one standing on the blue slot. The card has not moved, so nothing else can say so."""
    alice = await add_player(client, "Alice")
    bob = await add_player(client, "Bob")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})
    _, token = await mapped_device(client, reader_roles={"0": "slot:blue"})
    await two_slot_selection(session, song)
    await post_report(client, token, readers=[reader(0, uid=KNOWN_UID), reader(1)])
    assert player_names(await current_slots()) == ["Alice", None]

    response = await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": bob["id"]})

    assert response.status_code == 200, response.text
    slots = await current_slots()
    assert player_names(slots) == ["Bob", None]
    assert slots[0]["card_uid"] == KNOWN_UID


async def test_giving_a_card_back_to_the_player_already_on_its_slot_says_nothing(
    client: AsyncClient,
    session: AsyncSession,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    """Nothing moved, so the room hears nothing: the same card, the same person."""
    alice = await add_player(client, "Alice")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})
    _, token = await mapped_device(client, reader_roles={"0": "slot:blue"})
    await two_slot_selection(session, song)
    await post_report(client, token, readers=[reader(0, uid=KNOWN_UID), reader(1)])
    broadcast_events.clear()

    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})

    assert player_names(await current_slots()) == ["Alice", None]
    assert selection_events(broadcast_events) == []


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


async def test_the_five_options(client: AsyncClient) -> None:
    defaults = await client.get("/api/v1/devices/settings")
    assert defaults.status_code == 200, defaults.text
    assert defaults.json() == {
        "auto_start": False,
        "auto_start_delay_s": 3,
        "rescan_removes": True,
        "selection_idle_s": 120,
        "start_without_selection": "nothing",
    }

    changed = await client.patch(
        "/api/v1/devices/settings",
        json={"auto_start": True, "auto_start_delay_s": 10, "start_without_selection": "top_wish"},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json() == {
        "auto_start": True,
        "auto_start_delay_s": 10,
        "rescan_removes": True,
        "selection_idle_s": 120,
        "start_without_selection": "top_wish",
    }

    unknown = await client.patch(
        "/api/v1/devices/settings", json={"start_without_selection": "whatever_it_feels_like"}
    )
    assert unknown.status_code == 422
    assert "top_wish" in unknown.json()["detail"]
    assert (await client.get("/api/v1/devices/settings")).json()[
        "start_without_selection"
    ] == "top_wish"

    refused = await client.patch("/api/v1/devices/settings", json={"auto_start_delay_s": 99})
    assert refused.status_code == 422
    assert "0 and 30" in refused.json()["detail"]
    assert (await client.get("/api/v1/devices/settings")).json()["auto_start_delay_s"] == 10

    too_short = await client.patch("/api/v1/devices/settings", json={"selection_idle_s": 10})
    assert too_short.status_code == 422
    assert "30 and 900" in too_short.json()["detail"]
    assert (await client.get("/api/v1/devices/settings")).json()["selection_idle_s"] == 120


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


# --- the lights -------------------------------------------------------------------------

# The two slot colors of `TWO_SLOTS`, as the strip wants them: six lowercase hex digits.
# Written out rather than read off `karaoke.colors`, so a color changing there is a failure
# here and not a test that agrees with whatever the code now says.
BLUE = "048bb9"
RED = "d00000"
WHITE = "ffffff"
DARK = "000000"

LIT_ROLES = {"0": "slot:blue", "1": "slot:red", "2": "sequential", "3": "unused"}


def parsed_report(readers: list[dict[str, Any]]) -> DeviceReport:
    """One report as a model, for the tests that call `led_states` and nothing else."""
    return DeviceReport.model_validate(report_body(readers=readers))


def lights(
    readers: list[dict[str, Any]],
    known: set[str] | None = None,
    current: SelectionRead | None = None,
    playing: bool = False,
) -> list[tuple[int, str, str]]:
    """`led_states` as `(index, rgb, mode)` triples, which is what the rules read as."""
    return [
        (led.index, led.rgb, led.mode)
        for led in devices.led_states(
            LIT_ROLES, parsed_report(readers), frozenset(known or set()), current, playing
        )
    ]


async def picking(session: AsyncSession, song_id: str) -> SelectionRead:
    """A real open selection, for the two rules that ask whether the room is picking."""
    await two_slot_selection(session, song_id)
    current = await selection.current_selection()
    assert current is not None
    return current


def test_a_slot_reader_shows_its_own_color_and_what_lies_on_it() -> None:
    """Dark while the slot is only saying it is there, bright under a card Wingman can
    name, blinking under one it cannot."""
    on_the_readers = [reader(0), reader(1, uid=KNOWN_UID)]

    assert lights(on_the_readers, known={KNOWN_UID}) == [(0, BLUE, "dim"), (1, RED, "on")]
    assert lights([reader(0, uid=OTHER_UID)]) == [(0, BLUE, "blink")]


def test_a_card_whose_player_is_gone_blinks_like_any_other_unknown_one() -> None:
    """`known` is who a card *resolves* to, so a card of a deleted player is the unknown
    card every other surface already draws it as."""
    assert lights([reader(0, uid=KNOWN_UID)], known=set()) == [(0, BLUE, "blink")]


def test_a_reader_with_no_slot_of_its_own_is_white_or_dark() -> None:
    """The reader everybody scans in turn belongs to no slot, so it borrows no slot's
    color: white, pulsing to say "scan now" while singers are being picked."""
    quiet = lights([reader(2)])
    assert quiet == [(2, WHITE, "dim")]


async def test_a_reader_everybody_scans_in_turn_pulses_while_singers_are_picked(
    session: AsyncSession, song: str
) -> None:
    current = await picking(session, song)

    assert lights([reader(2)], current=current) == [(2, WHITE, "pulse")]
    # And a slot reader is unmoved by the selection itself: what lies on it is the point.
    assert lights([reader(0)], current=current) == [(0, BLUE, "dim")]


def test_a_reader_with_no_role_and_one_that_never_answered_stay_dark() -> None:
    """An unused reader, one the host mapped nothing onto, and one the boot probe found
    nothing (or something unreadable) on. None of them has anything to say."""
    assert lights(
        [
            reader(3),
            reader(4),
            reader(0, state="none", version="00"),
            reader(1, state="fault", version="3a"),
        ]
    ) == [
        (0, DARK, "off"),
        (1, DARK, "off"),
        (3, DARK, "off"),
        (4, DARK, "off"),
    ]


async def test_every_slot_pulses_while_the_room_is_about_to_sing_by_itself(
    session: AsyncSession, song: str
) -> None:
    """The countdown belongs to the room, not to one reader: it is the last few seconds to
    take a wrong card away, and every slot says so."""
    counting_down = (await picking(session, song)).model_copy(
        update={"auto_start_at": datetime.now(UTC) + timedelta(seconds=3)}
    )

    assert lights(
        [reader(0, uid=KNOWN_UID), reader(1), reader(2)],
        known={KNOWN_UID},
        current=counting_down,
    ) == [(0, BLUE, "pulse"), (1, RED, "pulse"), (2, WHITE, "pulse")]


async def test_the_whole_strip_goes_out_while_a_song_plays(
    session: AsyncSession, song: str
) -> None:
    """The picking is over. A lit table beside the TV asks for cards nobody should put
    down."""
    current = await picking(session, song)

    assert lights(
        [reader(0, uid=KNOWN_UID), reader(2)], known={KNOWN_UID}, current=current, playing=True
    ) == [(0, BLUE, "off"), (2, WHITE, "off")]


def test_a_slot_color_no_microphone_has_is_dark() -> None:
    """The mapping refuses one, so only a hand-edited row can hold it. Dark, like every
    other role Wingman cannot read."""
    states = devices.led_states(
        {"0": "slot:beige"}, parsed_report([reader(0)]), frozenset(), None, False
    )

    assert [(led.rgb, led.mode) for led in states] == [(DARK, "off")]


async def test_the_answer_to_a_report_lights_the_strip_and_asks_for_a_second(
    client: AsyncClient, session: AsyncSession, song: str
) -> None:
    """Once through the route: the rules above, the interval that follows them, and the
    strip drawn from the report that has just arrived."""
    alice = await add_player(client, "Alice")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})
    _, token = await mapped_device(client, reader_roles=LIT_ROLES, readers=4)

    quiet = await post_report(client, token, readers=[reader(index) for index in range(4)])
    assert quiet.status_code == 200, quiet.text
    assert quiet.json()["interval_s"] == 5
    assert quiet.json()["leds"] == [
        {"index": 0, "rgb": BLUE, "mode": "dim"},
        {"index": 1, "rgb": RED, "mode": "dim"},
        {"index": 2, "rgb": WHITE, "mode": "dim"},
        {"index": 3, "rgb": DARK, "mode": "off"},
    ]

    await two_slot_selection(session, song)
    picked = await post_report(
        client,
        token,
        readers=[reader(0, uid=KNOWN_UID), reader(1, uid=OTHER_UID), reader(2), reader(3)],
    )

    assert picked.status_code == 200, picked.text
    # A second, so the strip follows the phone; and the cards of *this* report, which is
    # the same report the slots were just filled from.
    assert picked.json()["interval_s"] == 1
    assert picked.json()["leds"] == [
        {"index": 0, "rgb": BLUE, "mode": "on"},
        {"index": 1, "rgb": RED, "mode": "blink"},
        {"index": 2, "rgb": WHITE, "mode": "pulse"},
        {"index": 3, "rgb": DARK, "mode": "off"},
    ]


# --- the update over Wi-Fi ---------------------------------------------------------------

OTA_NAME = "wingman-esp32-ota.bin"


def write_manifest(directory: Path, version: str = "0.3.0", ota: bool = True) -> None:
    """A bundled build, with or without the bare application image the Wi-Fi update
    flashes. Without it, only the cable can update a device."""
    build: dict[str, Any] = {"chip": "ESP32", "file": "wingman-esp32.bin", "size": 9}
    (directory / "wingman-esp32.bin").write_bytes(b"\xe9merged")
    if ota:
        build |= {"ota_file": OTA_NAME, "ota_size": 6}
        (directory / OTA_NAME).write_bytes(b"\xe9app")
    (directory / "manifest.json").write_text(
        json.dumps({"version": version, "protocol": 1, "builds": [build]}), encoding="utf-8"
    )


async def request_update(client: AsyncClient, device_id: str, expect: int = 204) -> Response:
    response = await client.post(f"/api/v1/devices/{device_id}/update")
    assert response.status_code == expect, response.text
    return response


async def test_an_update_the_host_asked_for_rides_on_the_next_report(
    client: AsyncClient, no_firmware: Path, broadcast_events: list[dict[str, object]]
) -> None:
    write_manifest(no_firmware)
    device_id, token = await mapped_device(client)
    broadcast_events.clear()

    await request_update(client, device_id)

    assert len(device_events(broadcast_events)) == 1
    # Aware, so the page counting the ten minutes down counts the right ones.
    assert read_back((await only_device(client))["update_requested_at"]) < datetime.now(UTC)
    answer = await post_report(client, token, readers=[reader(0)])
    assert answer.status_code == 200, answer.text
    # The bare application image and not the merged one: `HTTPUpdate` checks for the 0xE9
    # magic at byte 0, and the merged image starts with the bootloader's padding.
    assert answer.json()["update"] == {"file": OTA_NAME, "version": "0.3.0"}


async def test_a_report_carrying_the_new_version_clears_the_request(
    client: AsyncClient, no_firmware: Path, broadcast_events: list[dict[str, object]]
) -> None:
    write_manifest(no_firmware)
    device_id, token = await mapped_device(client)
    await request_update(client, device_id)
    broadcast_events.clear()

    answer = await post_report(client, token, readers=[reader(0)], firmware_version="0.3.0")

    assert answer.status_code == 200, answer.text
    assert answer.json()["update"] is None
    assert (await only_device(client))["update_requested_at"] is None
    assert len(device_events(broadcast_events)) == 1


async def test_an_update_nobody_fetched_gives_up_after_ten_minutes(
    client: AsyncClient, no_firmware: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A device that failed to flash says nothing about it, so the request has to give up by
    itself. Then the host can ask again."""
    write_manifest(no_firmware)
    device_id, token = await mapped_device(client)
    await request_update(client, device_id)
    monkeypatch.setattr(
        devices, "_now", lambda: datetime.now(UTC) + devices.UPDATE_TTL + timedelta(seconds=1)
    )

    answer = await post_report(client, token, readers=[reader(0)])

    assert answer.status_code == 200, answer.text
    assert answer.json()["update"] is None
    assert (await only_device(client))["update_requested_at"] is None


async def test_an_offer_nobody_came_back_for_stops_being_pending(
    client: AsyncClient, no_firmware: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The flag only comes off the row on a report, and a device that never returns sends
    none — so the ten minutes are measured at the read as well, or the page would say
    "Update requested" for the rest of the party."""
    write_manifest(no_firmware)
    device_id, _ = await mapped_device(client)
    await request_update(client, device_id)
    assert (await only_device(client))["update_requested_at"] is not None

    monkeypatch.setattr(
        devices, "_now", lambda: datetime.now(UTC) + devices.UPDATE_TTL + timedelta(minutes=1)
    )

    assert (await only_device(client))["update_requested_at"] is None
    # And the host may ask again, which is what the ten minutes are for.
    await request_update(client, device_id)


async def test_an_update_there_is_none_of_is_refused(
    client: AsyncClient, no_firmware: Path
) -> None:
    device_id, token = await mapped_device(client)

    # Nothing built at all.
    refused = await request_update(client, device_id, expect=409)
    assert refused.json() == {"detail": "no_firmware"}

    # A build older than the update over Wi-Fi. The cable still works.
    write_manifest(no_firmware, ota=False)
    refused = await request_update(client, device_id, expect=409)
    assert refused.json() == {"detail": "no_ota_image"}

    # And a device already running what this Wingman ships.
    write_manifest(no_firmware, version="0.1.0")
    await post_report(client, token, readers=[reader(0)], firmware_version="0.1.0")
    refused = await request_update(client, device_id, expect=409)
    assert refused.json() == {"detail": "already_current"}

    assert (await only_device(client))["update_requested_at"] is None
    assert (await client.post("/api/v1/devices/nope/update")).status_code == 404


async def test_a_device_fetches_the_image_with_its_own_token(
    anonymous_client: AsyncClient, client: AsyncClient, no_firmware: Path
) -> None:
    """The one route two kinds of caller reach. A bearer token is a device, whatever the
    browser beside it may hold."""
    write_manifest(no_firmware)
    _, token = await mapped_device(client)

    fetched = await anonymous_client.get(
        f"/api/v1/devices/firmware/{OTA_NAME}", headers={"Authorization": f"Bearer {token}"}
    )
    assert fetched.status_code == 200, fetched.text
    assert fetched.content == b"\xe9app"

    # A token no device holds is 401 and never 403: a device holds no capability to be
    # missing one.
    wrong = await anonymous_client.get(
        f"/api/v1/devices/firmware/{OTA_NAME}",
        headers={"Authorization": f"Bearer wd_{'0' * 40}"},
    )
    assert wrong.status_code == 401
    assert wrong.json() == {"detail": "unknown_device"}

    # And a browser with nothing at all is still the capability's 403.
    guest = await anonymous_client.get(f"/api/v1/devices/firmware/{OTA_NAME}")
    assert guest.status_code == 403
    assert guest.json() == {"detail": "missing_permission:devices.manage"}

    # The bearer is tried *first*, so a wrong one is 401 even for an administrator's own
    # browser: a request carrying a token is a device, whatever cookie rode along with it.
    both = await client.get(
        f"/api/v1/devices/firmware/{OTA_NAME}",
        headers={"Authorization": f"Bearer wd_{'0' * 40}"},
    )
    assert both.status_code == 401
    # Without one, that same browser gets the image.
    assert (await client.get(f"/api/v1/devices/firmware/{OTA_NAME}")).status_code == 200


# --- the start button at a quiet room ----------------------------------------------------


async def add_second_song(session: AsyncSession, configured: FakeUsdx) -> str:
    """One more song in the library, so "the top wish" and "a random one" have something to
    choose between."""
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


async def quiet_room(
    client: AsyncClient, session: AsyncSession, mode: str, cards: bool = True
) -> str:
    """A device with a start button and Alice's card lying on the blue slot, and nobody
    picking anything. Returns the device's token."""
    await SettingsService(session).set("karaoke.player_colors", TWO_SLOTS)
    response = await client.patch(
        "/api/v1/devices/settings", json={"start_without_selection": mode}
    )
    assert response.status_code == 200, response.text
    alice = await add_player(client, "Alice")
    await client.put(f"/api/v1/devices/cards/{KNOWN_UID}", json={"player_id": alice["id"]})
    _, token = await mapped_device(
        client, reader_roles={"0": "slot:blue"}, button_actions={"0": "start"}
    )
    await post_report(
        client,
        token,
        readers=[reader(0, uid=KNOWN_UID if cards else None), reader(1)],
        buttons=[button(0)],
    )
    return token


async def press_start(client: AsyncClient, token: str, uid: str | None = KNOWN_UID) -> None:
    """The button, with whatever is lying on the blue slot reader in the same report."""
    await post_report(
        client, token, readers=[reader(0, uid=uid), reader(1)], buttons=[button(0, 1)]
    )


async def hide_from_the_party(client: AsyncClient, song_id: str) -> None:
    """Put a song under the shipped *broken* tag, which grants `view_songs` to `trusted`
    and to nobody else. A guest never sees the song again, and the start button is the one
    caller in the app with no account behind it at all."""
    listed = await client.get("/api/v1/tags")
    assert listed.status_code == 200, listed.text
    broken = next(tag for tag in listed.json()["tags"] if tag["name"] == "broken")
    tagged = await client.put(f"/api/v1/songs/{song_id}/tags/{broken['id']}")
    assert tagged.status_code == 204, tagged.text


def songs_started(events: list[dict[str, object]]) -> list[dict[str, Any]]:
    """The sings that really started, off the event bus. `current_sing()` cannot be asked:
    the fake USDX is gone by the time a test looks, and the sing with it."""
    return [
        cast(dict[str, Any], event["sing"])
        for event in events
        if event["event"] == "karaoke.started"
    ]


async def test_the_start_button_sings_the_top_wish_at_a_quiet_room(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    """Nobody is picking anything, so Wingman picks: the song the room wished for most, sung
    by whoever is standing at the readers."""
    other = await add_second_song(session, configured)
    assert (await client.post("/api/v1/wishlist", json={"song_id": other})).status_code == 201
    token = await quiet_room(client, session, "top_wish")

    await press_start(client, token)

    await wait_for(configured.argv_file)
    sings = songs_started(broadcast_events)
    # The fixture's own song was never wished for, so it was never in the running.
    assert [sing["song"]["id"] for sing in sings] == [other]
    assert other != song
    assert player_names(sings[0]["slots"]) == ["Alice", None]
    assert await selection.current_selection() is None
    await karaoke.wait_for_sing_end()


async def test_the_start_button_sings_a_random_song(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
    broadcast_events: list[dict[str, object]],
) -> None:
    """The ids are sorted before the choice, so a seeded generator picks the same song
    twice. Here the last of them, whatever SQLite hands back."""
    other = await add_second_song(session, configured)
    monkeypatch.setattr(selection.random, "choice", lambda ids: ids[-1])
    token = await quiet_room(client, session, "random")

    await press_start(client, token)

    await wait_for(configured.argv_file)
    assert [sing["song"]["id"] for sing in songs_started(broadcast_events)] == [max(song, other)]
    await karaoke.wait_for_sing_end()


async def test_a_random_song_is_never_one_the_party_may_not_see(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    monkeypatch: pytest.MonkeyPatch,
    broadcast_events: list[dict[str, object]],
) -> None:
    """The button has no account behind it at all, so it picks out of the guest's library.
    A tag nobody was granted `view_songs` on keeps its songs from it."""
    other = await add_second_song(session, configured)
    await hide_from_the_party(client, max(song, other))
    monkeypatch.setattr(selection.random, "choice", lambda ids: ids[-1])
    token = await quiet_room(client, session, "random")

    await press_start(client, token)

    await wait_for(configured.argv_file)
    # The last id is the tagged one, and the button never saw it.
    assert [sing["song"]["id"] for sing in songs_started(broadcast_events)] == [min(song, other)]
    await karaoke.wait_for_sing_end()


async def test_the_top_wish_is_never_one_the_party_may_not_see(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, song: str
) -> None:
    other = await add_second_song(session, configured)
    # The most wished for song of the two, and then a tag that keeps it from the party.
    assert (await client.post("/api/v1/wishlist", json={"song_id": other})).status_code == 201
    await hide_from_the_party(client, other)
    token = await quiet_room(client, session, "top_wish")

    await press_start(client, token)

    # Nothing else was wished for, so there is no second-best and nothing starts at all —
    # the fixture's own song included.
    assert await selection.current_selection() is None
    assert karaoke.current_sing() is None


async def test_the_start_button_at_a_quiet_room_does_nothing_by_default(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, song: str
) -> None:
    """`nothing` is the default: a button that starts a song out of nowhere is a thing the
    host asks for."""
    assert (await client.post("/api/v1/wishlist", json={"song_id": song})).status_code == 201
    token = await quiet_room(client, session, "nothing")

    await press_start(client, token)

    assert await selection.current_selection() is None
    assert karaoke.current_sing() is None


async def test_the_start_button_needs_a_card_on_a_reader(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, song: str
) -> None:
    """A stray press at an empty table cannot start a song nobody sings."""
    assert (await client.post("/api/v1/wishlist", json={"song_id": song})).status_code == 201
    token = await quiet_room(client, session, "top_wish", cards=False)

    await press_start(client, token, uid=None)

    assert await selection.current_selection() is None
    assert karaoke.current_sing() is None


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
        selection,
        "_now",
        lambda: datetime.now(UTC) + selection.DEFAULT_IDLE_TTL + timedelta(seconds=1),
    )

    await devices.watchdog_tick()

    assert await selection.current_selection() is None


# --- the idle time a selection is dropped after -------------------------------------------


async def test_a_shorter_idle_time_takes_effect_at_once(
    client: AsyncClient, song: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The host shortens it because they are looking at a selection they want gone, so it
    holds for the one that is already standing."""
    changed = await client.patch("/api/v1/devices/settings", json={"selection_idle_s": 30})
    assert changed.status_code == 200, changed.text
    assert changed.json()["selection_idle_s"] == 30
    assert (await client.post("/api/v1/karaoke/selection", json={"song_id": song})).status_code == (
        201
    )
    monkeypatch.setattr(selection, "_now", lambda: datetime.now(UTC) + timedelta(seconds=40))

    await devices.watchdog_tick()

    assert await selection.current_selection() is None


async def test_the_default_idle_time_is_two_minutes(
    client: AsyncClient, song: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """What the watchdog read at startup, nobody having changed it: a selection is still
    standing a second short of two minutes."""
    assert (await client.post("/api/v1/karaoke/selection", json={"song_id": song})).status_code == (
        201
    )
    monkeypatch.setattr(selection, "_now", lambda: datetime.now(UTC) + timedelta(seconds=119))

    await devices.watchdog_tick()

    assert await selection.current_selection() is not None


# --- is there a selector in the room? -----------------------------------------------------


async def test_the_status_says_whether_a_selector_is_online(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """What the singer picker asks: while it is true, the cards decide who sings, which is
    why the picker opened with empty slots."""
    quiet = await client.get("/api/v1/devices/status")
    assert quiet.status_code == 200, quiet.text
    assert quiet.json() == {"online": False}

    await mapped_device(client)
    assert (await client.get("/api/v1/devices/status")).json() == {"online": True}

    monkeypatch.setattr(
        devices, "_now", lambda: datetime.now(UTC) + devices.OFFLINE_AFTER + timedelta(seconds=1)
    )
    assert (await client.get("/api/v1/devices/status")).json() == {"online": False}


# --- claiming your own card ---------------------------------------------------------------


def visitor(app: FastAPI) -> AsyncClient:
    """A browser with no session at all, on the app the test built."""
    return AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL)


async def register(client: AsyncClient, username: str) -> str:
    """Sign this client in as a new account and answer the player it sings as.

    Registered through the API rather than inserted: the point of these routes is the caller
    being somebody who sings, and registering is what makes an account one.
    """
    response = await client.post(
        "/api/v1/auth/register", json={"username": username, "password": ADMIN_PASSWORD}
    )
    assert response.status_code == 201, response.text
    player_id: str | None = response.json()["player_id"]
    assert player_id is not None
    return player_id


async def test_a_singer_claims_a_card_off_the_readers(
    bootstrap_settings: BootstrapSettings, session: AsyncSession, song: str
) -> None:
    """The whole path, as the user page walks it: the card is lying on a reader and belongs
    to nobody, the singer says it is theirs, and the slot it is on becomes theirs with it —
    the card has not moved, so nothing else could say so."""
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await authenticate_admin(app)
        async with admin_client(app) as host, visitor(app) as alice:
            alice_player = await register(alice, "alice")
            _, token = await mapped_device(host, reader_roles={"0": "slot:blue"})
            await two_slot_selection(session, song)
            await post_report(host, token, readers=[reader(0, uid=OTHER_UID), reader(1)])
            assert player_names(await current_slots()) == [None, None]

            unknown = await alice.get("/api/v1/devices/cards/unknown")
            assert unknown.status_code == 200, unknown.text
            assert unknown.json() == {"uids": [OTHER_UID]}

            claimed = await alice.post(f"/api/v1/devices/cards/{OTHER_UID}/claim")

            assert claimed.status_code == 200, claimed.text
            assert claimed.json()["player"]["id"] == alice_player
            assert player_names(await current_slots()) == ["alice", None]
            # It is hers now, so it is not on offer any more, and it is on her own list.
            assert (await alice.get("/api/v1/devices/cards/unknown")).json() == {"uids": []}
            mine = await alice.get("/api/v1/devices/cards/mine")
            assert [card["uid"] for card in mine.json()["cards"]] == [OTHER_UID]


async def test_somebody_elses_card_is_not_yours_to_claim_or_to_give_back(
    bootstrap_settings: BootstrapSettings,
) -> None:
    """The card table is the host's, but the card in somebody's hand is their own: claiming
    twice is not an error, claiming somebody else's is, and giving one back reads exactly
    the same way."""
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await authenticate_admin(app)
        async with admin_client(app) as host, visitor(app) as alice, visitor(app) as bob:
            await register(alice, "alice")
            await register(bob, "bob")
            mine = await alice.post(f"/api/v1/devices/cards/{KNOWN_UID}/claim")
            assert mine.status_code == 200, mine.text
            # Their own card again: a phone tapped twice, not an error.
            again = await alice.post(f"/api/v1/devices/cards/{KNOWN_UID}/claim")
            assert again.status_code == 200, again.text

            taken = await bob.post(f"/api/v1/devices/cards/{KNOWN_UID}/claim")

            assert taken.status_code == 409
            assert taken.json() == {"detail": "card_taken"}
            # Nor can Bob give Alice's card back for her.
            refused = await bob.delete(f"/api/v1/devices/cards/{KNOWN_UID}")
            assert refused.status_code == 403
            assert refused.json() == {"detail": "missing_permission:devices.manage"}
            # A card nobody has is the same answer: which it is, is none of his business.
            nothing = await bob.delete(f"/api/v1/devices/cards/{OTHER_UID}")
            assert nothing.status_code == 403

            # Alice's own, on the other hand, is hers to give back.
            assert (await alice.delete(f"/api/v1/devices/cards/{KNOWN_UID}")).status_code == 204
            assert (await alice.get("/api/v1/devices/cards/mine")).json() == {"cards": []}
            # And the host may still forget anybody's: Bob claims one, the host drops it.
            claimed = await bob.post(f"/api/v1/devices/cards/{OTHER_UID}/claim")
            assert claimed.status_code == 200, claimed.text
            assert (await host.delete(f"/api/v1/devices/cards/{OTHER_UID}")).status_code == 204


async def test_something_that_is_not_a_card_id_cannot_be_claimed(
    bootstrap_settings: BootstrapSettings,
) -> None:
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await authenticate_admin(app)
        async with visitor(app) as alice:
            await register(alice, "alice")

            response = await alice.post("/api/v1/devices/cards/nope/claim")

            assert response.status_code == 422
            assert response.json() == {"detail": "invalid_uid"}


async def test_the_card_routes_of_a_person_need_a_person(
    anonymous_client: AsyncClient, client: AsyncClient
) -> None:
    """They take an identity and not a capability, so a guest is 401 and not 403 — which is
    why they are here and not in the permission matrix.

    The host session is 401 on the three that need a player as well: it is an administrator,
    and it is not somebody who sings.
    """
    for path in ("/api/v1/devices/cards/unknown", "/api/v1/devices/cards/mine"):
        response = await anonymous_client.get(path)
        assert response.status_code == 401, f"{path}: {response.text}"
        assert response.json() == {"detail": "not_authenticated"}
    claimed = await anonymous_client.post(f"/api/v1/devices/cards/{KNOWN_UID}/claim")
    assert claimed.status_code == 401

    # The administrator of this suite has an account and no player, which is the same
    # answer a host session gets: there is nobody for the card to belong to.
    assert (await client.post(f"/api/v1/devices/cards/{KNOWN_UID}/claim")).status_code == 404
    assert (await client.get("/api/v1/devices/cards/mine")).json() == {"cards": []}
