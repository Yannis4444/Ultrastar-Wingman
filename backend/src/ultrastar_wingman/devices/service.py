"""What the devices do, and what Wingman makes of it.

Two halves. The rows are ordinary CRUD: a device, its token, the mapping of its readers and
buttons, and the card table. The live half is module state — the last report of every device
and when it arrived — because a card lying on a reader is a person standing in the room, not
a fact about the database, and nothing of it should outlive the process.

The report path is the whole point of the module: a snapshot arrives, it is diffed against
the one before it, and the difference is handed to `karaoke.selection` as the four things
that can happen in the room (a card put on a slot, a card taken off one, a card scanned in
turn, a button pressed). The card table reaches it too, and for the same reason: naming the
card lying on a slot, or forgetting it, changes who stands in the room without the device
having anything new to report. The selection is the one that knows what any of it means;
this module never reaches into it beyond those calls, and `karaoke.selection` never imports
this module back.

Knows nothing about FastAPI: the API layer maps these exceptions onto status codes.
"""

import asyncio
import contextlib
import itertools
import json
import logging
import re
import secrets
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..auth.service import token_hash
from ..events import DevicesChanged, event_bus
from ..karaoke import selection
from ..karaoke.colors import COLOR_NAMES
from ..players.model import Player
from ..players.schema import PlayerRead, read_player
from . import settings as device_settings
from .model import (
    BUTTON_ACTIONS,
    SEQUENTIAL,
    SLOT_PREFIX,
    TOKEN_BYTES,
    TOKEN_PREFIX,
    UNUSED,
    Device,
    PlayerCard,
)
from .protocol import (
    MAX_BUTTONS,
    MAX_READERS,
    SUPPORTED,
    ButtonReport,
    DeviceReport,
    ReaderReport,
    ReaderState,
)
from .schema import (
    ButtonRead,
    CardList,
    CardRead,
    DeviceList,
    DeviceRead,
    DeviceSettings,
    ReaderRead,
)

logger = logging.getLogger(__name__)

# A device that has said nothing for this long is offline. Three missed heartbeats: the
# firmware reports every five seconds, and one dropped packet on party Wi-Fi must not make
# the admin page flicker.
OFFLINE_AFTER = timedelta(seconds=15)

# How often the watchdog looks, and what a device is told to report at.
WATCHDOG_INTERVAL_S = 5.0
REPORT_INTERVAL_S = 5


class UnknownDeviceError(LookupError):
    def __init__(self, device_id: str) -> None:
        super().__init__(f"no device '{device_id}'")
        self.device_id = device_id


class UnknownPlayerError(LookupError):
    def __init__(self, player_id: str) -> None:
        super().__init__(f"no player '{player_id}'")
        self.player_id = player_id


class UnknownCardError(LookupError):
    def __init__(self, uid: str) -> None:
        super().__init__(f"no card '{uid}'")
        self.uid = uid


class InvalidUidError(ValueError):
    """Not a card id at all. The uid is the key of the card table and it comes off a reader
    as hex, so anything else is a typo (or a client inventing rows) and is refused rather
    than stored: a row nothing can ever read is worse than a complaint."""

    detail = "invalid_uid"

    def __init__(self, uid: str) -> None:
        super().__init__(f"'{uid}' is not a card id")
        self.uid = uid


class MappingError(ValueError):
    """The host asked for a mapping the device cannot have. `detail` is what the API
    answers with — one machine-readable word per way of being wrong, so the device page can
    put the complaint on the row it belongs to."""

    detail = "invalid_mapping"


class ReaderNotWiredError(MappingError):
    detail = "reader_not_wired"

    def __init__(self, index: int) -> None:
        super().__init__(f"reader {index} is not wired")
        self.index = index


class DuplicateSlotError(MappingError):
    detail = "duplicate_slot"

    def __init__(self, color: str) -> None:
        super().__init__(f"two readers are wired to the {color} slot")
        self.color = color


class UnknownRoleError(MappingError):
    detail = "unknown_role"

    def __init__(self, role: str) -> None:
        super().__init__(f"unknown reader role '{role}'")
        self.role = role


class UnknownActionError(MappingError):
    detail = "unknown_action"

    def __init__(self, action: str) -> None:
        super().__init__(f"unknown button action '{action}'")
        self.action = action


class UnknownPositionError(MappingError):
    detail = "unknown_position"

    def __init__(self, position: str) -> None:
        super().__init__(f"'{position}' is not a reader or button position")
        self.position = position


class UnknownColorMappingError(MappingError):
    """A slot color no Ultrastar Deluxe microphone is called. Wraps the colors module's own
    complaint so the API needs one `except` and not two."""

    detail = "unknown_color"

    def __init__(self, color: str) -> None:
        super().__init__(f"unknown color '{color}'")
        self.color = color


class ProtocolUnsupportedError(RuntimeError):
    """The device speaks another version of the report protocol. It is recorded all the
    same — that is how the admin page can say which device needs updating."""

    def __init__(self, protocol: int) -> None:
        super().__init__(f"protocol {protocol} is not supported")
        self.protocol = protocol


@dataclass
class _Live:
    """The last report of one device, and when it landed."""

    report: DeviceReport
    received_at: datetime
    # Which report this was, in the order they were *entered* — see `_sequence`.
    sequence: int
    # The protocol of that report is one Wingman speaks. An incompatible report counts as a
    # heartbeat and nothing more: it is never diffed, and the first compatible report after
    # it starts from nothing, so cards already lying on the readers are placed and not
    # missed.
    compatible: bool
    # The watchdog has already told the room this device went quiet. Reset by the next
    # report, so the coming-back is announced exactly once as well.
    offline_announced: bool = False


@dataclass(frozen=True)
class ReportOutcome:
    """What one report did. `changed` is what decides whether the room hears about it: a
    heartbeat that says nothing new is not worth a socket message every five seconds."""

    changed: bool
    interval_s: int = REPORT_INTERVAL_S


@dataclass(frozen=True)
class _Placed:
    color: str
    uid: str


@dataclass(frozen=True)
class _Removed:
    color: str
    uid: str


@dataclass(frozen=True)
class _Scanned:
    uid: str


@dataclass(frozen=True)
class _Pressed:
    action: str


_Change = _Placed | _Removed | _Scanned | _Pressed


@dataclass
class _Diff:
    """What one report changed, worked out under the lock and carried out without it."""

    changes: list[_Change] = field(default_factory=list)
    visible: bool = False


# A card id as the admin page may write one: the reader answers in uppercase, a host typing
# a uid off a card by hand may not, and both are the same card. The lengths are the protocol's
# (4, 7 and 10 byte tags), checked here as well because this half of the table is typed by a
# person and not read off a reader.
_UID = re.compile("[0-9A-F]{8,20}")

# One Wingman process, one room, one set of devices in it — the same reasoning as the
# running sing and the open selection.
_live: dict[str, _Live] = {}
_lock = asyncio.Lock()
_watchdog: asyncio.Task[None] | None = None

# The order reports were taken in. A device that times out on the client side retries, so two
# snapshots of the same readers can be in flight at once and the older one may reach the lock
# second; whichever was *entered* last is the one the room is in. A counter and not a clock:
# the coarse Windows timer would let two reports of the same millisecond tie, and a tie is
# exactly the case the guard exists for.
_sequence = itertools.count(1)


def _now() -> datetime:
    """The clock, read through the module so the tests can move it: fifteen seconds of
    silence is otherwise only testable by waiting fifteen seconds."""
    return datetime.now(UTC)


def new_token() -> str:
    """A device's bearer token: `wd_` and forty hex characters."""
    return TOKEN_PREFIX + secrets.token_hex(TOKEN_BYTES)


# --- rows -------------------------------------------------------------------------------


async def create_device(session: AsyncSession, name: str) -> tuple[DeviceRead, str]:
    """A new device and the one readable copy of its token."""
    token = new_token()
    device = Device(name=name.strip(), token_hash=token_hash(token))
    session.add(device)
    await session.commit()
    logger.info("player selector '%s' created (%s)", device.name, device.id)
    await event_bus.broadcast(DevicesChanged())
    return _read(device), token


async def get_device(session: AsyncSession, device_id: str) -> Device:
    device = await session.get(Device, device_id)
    if device is None:
        raise UnknownDeviceError(device_id)
    return device


async def update_device(
    session: AsyncSession,
    device_id: str,
    name: str | None = None,
    reader_roles: dict[str, str] | None = None,
    button_actions: dict[str, str] | None = None,
) -> DeviceRead:
    """Rename a device, map its readers, or say what its buttons do. Only what is named is
    touched; a mapping that is given replaces the whole one before it.

    Raises `UnknownDeviceError` and, for a mapping the device cannot have, a `MappingError`.
    """
    device = await get_device(session, device_id)
    if name is not None:
        device.name = name.strip()
    if reader_roles is not None:
        device.reader_roles = json.dumps(
            _checked_roles(reader_roles, _decode(device.reader_states))
        )
    if button_actions is not None:
        device.button_actions = json.dumps(_checked_actions(button_actions))
    await session.commit()
    await event_bus.broadcast(DevicesChanged())
    return await _read_one(session, device)


async def rotate_token(session: AsyncSession, device_id: str) -> tuple[DeviceRead, str]:
    """Mint a new token and forget the old one. What the wizard does for a device whose
    token nobody wrote down: the device is reconfigured over USB with the new one, and until
    it is, its reports are 401."""
    device = await get_device(session, device_id)
    token = new_token()
    device.token_hash = token_hash(token)
    await session.commit()
    logger.info("player selector '%s' got a new token (%s)", device.name, device.id)
    await event_bus.broadcast(DevicesChanged())
    return await _read_one(session, device), token


async def delete_device(session: AsyncSession, device_id: str) -> None:
    """Forget a device. The cards stay: they belong to the people, not to the box that read
    them, and the next device reads the same cards."""
    device = await get_device(session, device_id)
    await session.delete(device)
    await session.commit()
    async with _lock:
        _live.pop(device_id, None)
    logger.info("player selector '%s' deleted (%s)", device.name, device_id)
    await event_bus.broadcast(DevicesChanged())


async def list_devices(session: AsyncSession) -> DeviceList:
    """Every device with what it is saying right now."""
    rows = list(await session.scalars(select(Device).order_by(Device.created_at)))
    async with _lock:
        live = dict(_live)
    uids = {
        reader.uid
        for entry in live.values()
        if entry.compatible
        for reader in entry.report.readers
        if reader.uid is not None
    }
    players = await _players_by_uid(session, uids)
    return DeviceList(devices=[_read(row, live.get(row.id), players) for row in rows])


# --- cards ------------------------------------------------------------------------------


async def list_cards(session: AsyncSession) -> CardList:
    """Every card Wingman knows, newest first — the way the admin page lists them, because
    the one just assigned is the one being looked for."""
    cards = list(await session.scalars(select(PlayerCard).order_by(PlayerCard.created_at.desc())))
    players = {
        player.id: read_player(player)
        for player in await session.scalars(
            select(Player).where(Player.id.in_({card.player_id for card in cards}))
        )
    }
    # A card whose player is gone is not listed: there is nobody left to select with it. The
    # row survives, harmless, and the next assignment of that uid overwrites it.
    return CardList(
        cards=[
            CardRead(uid=card.uid, player=players[card.player_id], created_at=card.created_at)
            for card in cards
            if card.player_id in players
        ]
    )


async def assign_card(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    uid: str,
    player_id: str,
) -> CardRead:
    """Give a card to a player. Assigning one that already belongs to somebody moves it,
    which is what a card handed on to the next guest needs. Raises `UnknownPlayerError` and,
    for something that is not a card id, `InvalidUidError`.

    `session_factory` is for what the selection makes of the named card, which can outlive
    this request: an automatic start counts down in a task of its own and opens its own
    session when it fires."""
    normalised = uid.strip().upper()
    if not _UID.fullmatch(normalised):
        raise InvalidUidError(uid)
    player = await session.get(Player, player_id)
    if player is None:
        raise UnknownPlayerError(player_id)
    card = await session.get(PlayerCard, normalised)
    if card is None:
        card = PlayerCard(uid=normalised, player_id=player_id)
        session.add(card)
    else:
        card.player_id = player_id
    await session.commit()
    await event_bus.broadcast(DevicesChanged())
    # The card the host just named may be lying on a slot right now, as the unknown card the
    # naming was about. The device will not report it again — it has not moved — so this is
    # the only moment the room can be told.
    await selection.card_identified(
        session_factory, normalised, player_id, auto_start=await auto_start_for(session)
    )
    return CardRead(uid=card.uid, player=read_player(player), created_at=card.created_at)


async def forget_card(session: AsyncSession, uid: str) -> None:
    """Take a card off the table. Raises `UnknownCardError`."""
    normalised = uid.strip().upper()
    card = await session.get(PlayerCard, normalised)
    if card is None:
        raise UnknownCardError(uid)
    await session.delete(card)
    await session.commit()
    await event_bus.broadcast(DevicesChanged())
    # The other half of the same moment: a slot this card is holding somebody on becomes the
    # unknown card it now is. Nobody is scored for a card that belongs to nobody.
    await selection.card_forgotten(normalised)


async def forget_cards_of(session: AsyncSession, player_id: str) -> None:
    """Drop the cards of a player who is being deleted.

    Called from `players.service.delete_player` rather than left to the database: the schema
    declares the reference, but SQLite only enforces it with a pragma Wingman does not set
    (see `model.py`), and a card outliving its player is a card the next assignment silently
    overwrites. No broadcast: the delete that called this one sends its own.
    """
    for card in await session.scalars(select(PlayerCard).where(PlayerCard.player_id == player_id)):
        await session.delete(card)


# --- settings ---------------------------------------------------------------------------


async def read_settings(session: AsyncSession) -> DeviceSettings:
    values = await device_settings.read_all(session)
    return DeviceSettings(
        auto_start=bool(values[device_settings.AUTO_START]),
        auto_start_delay_s=int(values[device_settings.AUTO_START_DELAY]),
        rescan_removes=bool(values[device_settings.RESCAN_REMOVES]),
    )


async def auto_start_for(session: AsyncSession) -> selection.AutoStart | None:
    """The automatic start as the selection wants it: the delay, or None when the host has
    it switched off."""
    values = await device_settings.read_all(session)
    if not values[device_settings.AUTO_START]:
        return None
    return selection.AutoStart(delay_s=int(values[device_settings.AUTO_START_DELAY]))


async def rescan_removes(session: AsyncSession) -> bool:
    return bool(await device_settings.service(session).get(device_settings.RESCAN_REMOVES))


# --- reports ----------------------------------------------------------------------------


async def handle_report(
    session_factory: async_sessionmaker[AsyncSession],
    device: Device,
    report: DeviceReport,
) -> ReportOutcome:
    """One snapshot from one device.

    The row is written *before* the protocol is checked, so a device Wingman cannot talk to
    still appears in the list as one that needs updating rather than as one that never
    arrived. Then `ProtocolUnsupportedError`, or the difference from the last report handed
    to the selection.

    A report that was overtaken by a newer one from the same device is dropped whole — no
    row write, no diff, no dispatch — and still answered with an ack: the device is fine, and
    what it is saying is already in. That is what makes the firmware's retry after a
    client-side timeout harmless; without it the older snapshot could land second and put a
    card back on a slot the newer one had already emptied.
    """
    received_at = _now()
    sequence = next(_sequence)
    async with session_factory() as session:
        # Read the row — and with it check a connection out of the pool — *before* the lock:
        # everybody else takes the lock while already holding a session, so a lock held over
        # a checkout that has to wait for one of them would be a deadlock.
        row = await session.get(Device, device.id)
        if row is None:
            # Deleted between the token lookup and here. Nothing to record and nothing to do.
            raise UnknownDeviceError(device.id)
        compatible = report.protocol == SUPPORTED
        roles = _decode(row.reader_roles)
        actions = _decode(row.button_actions)

        # The row write is inside the lock as well, so it cannot go backwards either.
        async with _lock:
            previous = _live.get(device.id)
            if previous is not None and sequence < previous.sequence:
                logger.debug("player selector %s: dropping an overtaken report", device.id)
                return ReportOutcome(changed=False)
            row.last_seen_at = received_at
            row.firmware_version = report.firmware
            row.protocol = report.protocol
            row.reader_states = json.dumps(
                {str(reader.index): reader.state for reader in report.readers}
            )
            row.button_positions = json.dumps(sorted(button.index for button in report.buttons))
            await session.commit()

            # An incompatible report is a heartbeat and nothing else, so the first good one
            # after it diffs against nothing: the cards lying on the readers are placed
            # rather than mistaken for cards that were already accounted for.
            baseline = previous if previous is not None and previous.compatible else None
            diff = _diff(baseline, report, roles, actions) if compatible else _Diff()
            if previous is not None and previous.compatible != compatible:
                # "This device needs updating" — or does not any more.
                diff.visible = True
            if previous is None or not _is_online(previous):
                # It was quiet and is not any more: that is worth saying even when the report
                # itself carries nothing new. Measured against the clock and not against the
                # watchdog's flag, so a device that came back before the watchdog noticed it
                # was gone is still a device coming back.
                diff.visible = True
            if not compatible and (
                previous is None
                or previous.report.protocol != report.protocol
                or previous.report.firmware != report.firmware
            ):
                # It cannot be diffed, but "this device needs updating" is news all the same.
                diff.visible = True
            _live[device.id] = _Live(
                report=report,
                received_at=received_at,
                sequence=sequence,
                compatible=compatible,
            )

        if not compatible:
            if diff.visible:
                await event_bus.broadcast(DevicesChanged())
            raise ProtocolUnsupportedError(report.protocol)

        values = await device_settings.read_all(session)
        uids = {change.uid for change in diff.changes if not isinstance(change, _Pressed)}
        player_ids = await _player_ids_by_uid(session, uids)

    auto_start = (
        selection.AutoStart(delay_s=int(values[device_settings.AUTO_START_DELAY]))
        if values[device_settings.AUTO_START]
        else None
    )
    await _dispatch(
        session_factory,
        diff.changes,
        player_ids,
        auto_start=auto_start,
        rescan_removes=bool(values[device_settings.RESCAN_REMOVES]),
    )
    if diff.visible:
        await event_bus.broadcast(DevicesChanged())
    return ReportOutcome(changed=diff.visible)


async def cards_on_slots(session: AsyncSession) -> dict[str, selection.CardOnSlot]:
    """What lies on the slot readers of every device that is online, keyed by slot color.

    What a selection opens with: the people standing at the selector are already standing
    there, and the phone's remembered assignment must not put somebody else on their slot.
    Two devices wired to the same color is nobody's sensible setup; the one listed last
    wins, and the admin page shows both.
    """
    async with _lock:
        entries = [
            (device_id, entry)
            for device_id, entry in _live.items()
            if entry.compatible and _is_online(entry)
        ]
    if not entries:
        return {}
    rows = {
        device.id: _decode(device.reader_roles)
        for device in await session.scalars(
            select(Device).where(Device.id.in_({device_id for device_id, _ in entries}))
        )
    }
    on_slots: dict[str, str] = {}
    for device_id, entry in entries:
        roles = rows.get(device_id, {})
        for reader in entry.report.readers:
            color = _slot_color(roles.get(str(reader.index), UNUSED))
            if color is not None and reader.uid is not None:
                on_slots[color] = reader.uid
    player_ids = await _player_ids_by_uid(session, set(on_slots.values()))
    return {
        color: selection.CardOnSlot(uid=uid, player_id=player_ids.get(uid))
        for color, uid in on_slots.items()
    }


# --- the watchdog -----------------------------------------------------------------------


async def start_watchdog() -> None:
    """Start the task that notices devices going quiet. Started by the app lifespan, like
    the download workers."""
    global _watchdog
    if _watchdog is not None:
        return
    _watchdog = asyncio.create_task(_watchdog_loop(), name="devices-watchdog")


async def stop_watchdog() -> None:
    global _watchdog
    task, _watchdog = _watchdog, None
    _live.clear()
    if task is None:
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


async def watchdog_tick() -> None:
    """One pass: whoever stopped reporting is offline now, and a selection nobody has
    touched for two minutes is dropped.

    The selection's own expiry is lazy — it happens on the next call — and with everybody
    gone to the bar there is no next call. This is what clears the TV then.
    """
    gone = False
    async with _lock:
        for device_id, entry in _live.items():
            if not entry.offline_announced and not _is_online(entry):
                logger.info("player selector %s went quiet", device_id)
                entry.offline_announced = True
                gone = True
    if gone:
        await event_bus.broadcast(DevicesChanged())
    await selection.expire_stale()


async def _watchdog_loop() -> None:
    while True:
        await asyncio.sleep(WATCHDOG_INTERVAL_S)
        try:
            await watchdog_tick()
        except Exception:
            # Nobody is waiting on this task, and it must outlive one bad pass: a watchdog
            # that died at the first exception is a TV that never clears again.
            logger.exception("the player selector watchdog failed a pass")


# --- the diff ---------------------------------------------------------------------------


def _diff(
    previous: _Live | None,
    report: DeviceReport,
    roles: dict[str, str],
    actions: dict[str, str],
) -> _Diff:
    """What changed between two reports of one device, in the order the room means it.

    Slots first, then the readers everybody scans in turn, then the buttons: a card put down
    and a start pressed in the same report are one gesture, and the start has to see the
    card. A reader whose uid *changed* is a removal followed by a placement, so the slot the
    old card held is emptied before the new one takes it.

    With no previous report at all, every card that is lying there counts as just placed —
    the cards on the readers when Wingman starts are people standing in the room — while the
    buttons only establish their counters: a press counter is "since the device booted", and
    reacting to it on the first report would start a song because somebody pressed a button
    an hour ago. A counter that has gone *down* is baselined the same way: the device
    rebooted and lost its presses, which is not somebody pressing a button.
    """
    diff = _Diff()
    before = _readers_by_index(previous.report) if previous is not None else {}
    if previous is not None and set(before) != {reader.index for reader in report.readers}:
        # A position the device did not report last time (or does not report any more): the
        # boot probe found another build, and the listing has a row more or a row less.
        diff.visible = True
    # What moved, in reader order, worked out once and then read twice: the slots have to be
    # dealt with before the readers everybody scans in turn, whatever positions the host
    # wired them to. A scan takes the first *free* slot, so a card put down on a slot reader
    # in the same report must already be standing on its own.
    moved: list[tuple[ReaderReport, str | None, str]] = []
    for reader in sorted(report.readers, key=lambda entry: entry.index):
        was = before.get(reader.index)
        if was is not None and (was.state != reader.state or was.version != reader.version):
            diff.visible = True
        old_uid = None if was is None else was.uid
        if old_uid == reader.uid:
            continue
        diff.visible = True
        moved.append((reader, old_uid, roles.get(str(reader.index), UNUSED)))
    for reader, old_uid, role in moved:
        color = _slot_color(role)
        if color is None:
            continue
        if old_uid is not None:
            diff.changes.append(_Removed(color=color, uid=old_uid))
        if reader.uid is not None:
            diff.changes.append(_Placed(color=color, uid=reader.uid))
    for reader, _, role in moved:
        if role == SEQUENTIAL and reader.uid is not None:
            diff.changes.append(_Scanned(uid=reader.uid))
    if previous is not None and previous.report.firmware != report.firmware:
        diff.visible = True
    before_buttons = _buttons_by_index(previous.report) if previous is not None else {}
    if previous is not None and set(before_buttons) != {button.index for button in report.buttons}:
        diff.visible = True
    for button in sorted(report.buttons, key=lambda entry: entry.index):
        was_pressed = before_buttons.get(button.index)
        if was_pressed is None or was_pressed.presses == button.presses:
            continue
        diff.visible = True
        if button.presses < was_pressed.presses:
            # A counter that counts since boot and has gone *down* is a device that rebooted,
            # not a button somebody pressed: it lost the presses, it did not collect one. The
            # smaller number is the new baseline, and the press after it grows it again.
            continue
        action = actions.get(str(button.index), "none")
        if action in {"start", "clear", "cancel"}:
            diff.changes.append(_Pressed(action=action))
    return diff


async def _dispatch(
    session_factory: async_sessionmaker[AsyncSession],
    changes: list[_Change],
    player_ids: dict[str, str],
    auto_start: selection.AutoStart | None,
    rescan_removes: bool,
) -> None:
    """Hand the difference to the selection, outside this module's lock.

    Outside it on purpose: a `start` button runs the whole sing flow, which on a forced start
    spans a USDX exit and a score import. Holding the device lock across that would freeze
    every other device's report behind the one button somebody pressed.
    """
    for change in changes:
        if isinstance(change, _Removed):
            await selection.card_removed_from_slot(change.color, change.uid)
        elif isinstance(change, _Placed):
            await selection.card_placed_on_slot(
                session_factory,
                change.color,
                change.uid,
                player_ids.get(change.uid),
                auto_start,
            )
        elif isinstance(change, _Scanned):
            await selection.card_scanned(
                session_factory,
                change.uid,
                player_ids.get(change.uid),
                rescan_removes,
                auto_start,
            )
        else:
            async with session_factory() as session:
                await selection.button_pressed(
                    session, session_factory, _button_action(change.action)
                )


def _button_action(action: str) -> selection.ButtonAction:
    """Spelled out rather than cast: `_diff` only ever emits these three, and this is what
    says so to the type checker."""
    if action == "start":
        return "start"
    if action == "clear":
        return "clear"
    return "cancel"


# --- reading the rows -------------------------------------------------------------------


def _read(
    device: Device,
    live: _Live | None = None,
    players: dict[str, PlayerRead] | None = None,
) -> DeviceRead:
    """One device row plus whatever it is saying. Without live state — a device that has
    never reported, or one the process has not heard from since it started — the readers are
    what the last boot probe found, with nothing lying on them."""
    roles = _decode(device.reader_roles)
    actions = _decode(device.button_actions)
    states = _decode(device.reader_states)
    online = live is not None and _is_online(live)
    report = live.report if live is not None and live.compatible else None
    by_uid = players or {}
    readers: list[ReaderRead] = []
    if report is not None:
        for reader in sorted(report.readers, key=lambda entry: entry.index):
            uid = reader.uid if online else None
            readers.append(
                ReaderRead(
                    index=reader.index,
                    state=reader.state,
                    version=reader.version,
                    uid=uid,
                    player=None if uid is None else by_uid.get(uid),
                    role=roles.get(str(reader.index), UNUSED),
                )
            )
    else:
        for position in sorted(states, key=_position_order):
            readers.append(
                ReaderRead(
                    index=_position_order(position),
                    state=_reader_state(states[position]),
                    role=roles.get(position, UNUSED),
                )
            )
    buttons: list[ButtonRead] = []
    if report is not None:
        buttons = [
            ButtonRead(
                index=button.index,
                presses=button.presses,
                action=actions.get(str(button.index), "none"),
            )
            for button in sorted(report.buttons, key=lambda entry: entry.index)
        ]
    else:
        # Every button the last report carried, and every position an action was stored on
        # even if no report ever covered it — a button set to *nothing* is a row like any
        # other, and one that disappeared from the page while the device was quiet is a row
        # nobody could set back.
        positions = _decode_positions(device.button_positions) | {
            _position_order(position) for position in actions
        }
        buttons = [
            ButtonRead(index=index, presses=0, action=actions.get(str(index), "none"))
            for index in sorted(positions)
        ]
    return DeviceRead(
        id=device.id,
        name=device.name,
        created_at=device.created_at,
        last_seen_at=device.last_seen_at,
        online=online,
        firmware_version=device.firmware_version,
        protocol=device.protocol,
        compatible=None if device.protocol is None else device.protocol == SUPPORTED,
        rssi=None if report is None or not online else report.rssi,
        uptime_s=None if report is None or not online else report.uptime_s,
        readers=readers,
        buttons=buttons,
    )


async def _read_one(session: AsyncSession, device: Device) -> DeviceRead:
    """One device the way `GET /devices` draws it, live state and all.

    What every answer but the creating one gives back: a device that is standing there
    reporting must not read as offline with empty readers because the host renamed it.
    """
    async with _lock:
        live = _live.get(device.id)
    uids = (
        {reader.uid for reader in live.report.readers if reader.uid is not None}
        if live is not None and live.compatible
        else set()
    )
    return _read(device, live, await _players_by_uid(session, uids))


async def _players_by_uid(session: AsyncSession, uids: set[str]) -> dict[str, PlayerRead]:
    """Whoever the cards with these uids belong to. A card of a player who has been deleted
    is left out, which is what makes it an unknown card everywhere."""
    ids = await _player_ids_by_uid(session, uids)
    if not ids:
        return {}
    rows = {
        player.id: read_player(player)
        for player in await session.scalars(select(Player).where(Player.id.in_(set(ids.values()))))
    }
    return {uid: rows[player_id] for uid, player_id in ids.items() if player_id in rows}


async def _player_ids_by_uid(session: AsyncSession, uids: set[str]) -> dict[str, str]:
    if not uids:
        return {}
    cards = await session.scalars(select(PlayerCard).where(PlayerCard.uid.in_(uids)))
    return {card.uid: card.player_id for card in cards}


# --- the mapping ------------------------------------------------------------------------


def _checked_roles(roles: dict[str, str], states: dict[str, str]) -> dict[str, str]:
    """The reader mapping, refused rather than stored when it cannot work.

    A role on a reader that did not answer the boot probe is refused: the host would map a
    slot onto a position that never reports, and the card would simply never arrive. `unused`
    is allowed anywhere — it is the absence of a role, and taking one away must work on a
    reader that has since come loose.
    """
    checked: dict[str, str] = {}
    colors: set[str] = set()
    for position, role in roles.items():
        index = _reader_position(position)
        if role == UNUSED:
            continue
        if states.get(str(index)) != "wired":
            raise ReaderNotWiredError(index)
        color = _slot_color(role)
        if color is not None:
            if color not in COLOR_NAMES:
                raise UnknownColorMappingError(color)
            if color in colors:
                raise DuplicateSlotError(color)
            colors.add(color)
        elif role != SEQUENTIAL:
            raise UnknownRoleError(role)
        checked[str(index)] = role
    return checked


def _checked_actions(actions: dict[str, str]) -> dict[str, str]:
    checked: dict[str, str] = {}
    for position, action in actions.items():
        index = _button_position(position)
        if action not in BUTTON_ACTIONS:
            raise UnknownActionError(action)
        if action != "none":
            checked[str(index)] = action
    return checked


def _reader_position(position: str) -> int:
    index = _position(position)
    if index >= MAX_READERS:
        raise UnknownPositionError(position)
    return index


def _button_position(position: str) -> int:
    index = _position(position)
    if index >= MAX_BUTTONS:
        raise UnknownPositionError(position)
    return index


def _position(position: str) -> int:
    if not position.isdigit():
        raise UnknownPositionError(position)
    return int(position)


def _position_order(position: str) -> int:
    """A stored position as a number, for sorting. Anything unreadable sorts last rather
    than raising: the mapping is JSON in a text column, and a hand-edited database must not
    take the admin page down."""
    return int(position) if position.isdigit() else MAX_READERS


def _reader_state(stored: str) -> ReaderState:
    """A stored probe verdict. Anything else reads as a fault: the column is written by the
    report and by nothing else, so a value that is not one of the three is a database
    somebody edited, and "something is wrong with this reader" is the honest answer."""
    if stored == "wired":
        return "wired"
    if stored == "none":
        return "none"
    return "fault"


def _slot_color(role: str) -> str | None:
    return role[len(SLOT_PREFIX) :] if role.startswith(SLOT_PREFIX) else None


def _decode_positions(stored: str) -> set[int]:
    """`button_positions` as a set. Anything that is not an array of whole numbers reads as
    empty, for the same reason `_decode` does: the column is written by the report and by
    nothing else, and a hand-edited row must not take the admin page down."""
    try:
        loaded = json.loads(stored)
    except ValueError:
        return set()
    if not isinstance(loaded, list):
        return set()
    return {
        entry
        for entry in loaded
        if isinstance(entry, int) and not isinstance(entry, bool) and 0 <= entry < MAX_BUTTONS
    }


def _decode(stored: str) -> dict[str, str]:
    """One of the three JSON columns. A value that is not an object of strings reads as
    empty: nothing in the app writes one, and a hand-edited row must not be a 500."""
    try:
        loaded = json.loads(stored)
    except ValueError:
        return {}
    if not isinstance(loaded, dict):
        return {}
    return {str(key): value for key, value in loaded.items() if isinstance(value, str)}


def _is_online(live: _Live) -> bool:
    return _now() - live.received_at <= OFFLINE_AFTER


def _readers_by_index(report: DeviceReport) -> dict[int, ReaderReport]:
    return {reader.index: reader for reader in report.readers}


def _buttons_by_index(report: DeviceReport) -> dict[int, ButtonReport]:
    return {button.index: button for button in report.buttons}
