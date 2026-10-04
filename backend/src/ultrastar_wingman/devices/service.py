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

The other direction is the answer to that same report, which is everything Wingman ever
says to a device: how often to report, what its lights show until the next answer, and the
firmware to fetch while the host has asked for an update. All three are worked out here,
and a device that has neither a strip nor an updater ignores two of them.

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

from ..auth.model import as_utc
from ..auth.service import token_hash
from ..events import DevicesChanged, event_bus
from ..karaoke import selection
from ..karaoke import service as karaoke
from ..karaoke.colors import COLOR_NAMES, COLORS
from ..karaoke.schema import SelectionRead
from ..players.model import Player
from ..players.schema import PlayerRead, read_player
from . import firmware
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
    FirmwareUpdate,
    LedMode,
    LedState,
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

# What a device is told to report at while the room is picking singers. The lights are the
# reason: while one is open the strip says what the room is doing — the reader everybody
# scans pulsing "scan now", every slot pulsing once the automatic start counts down — and
# a second is as long as that may lag the phone that changed it. A slot the *phone* filled
# is not one of those: a light says what lies on its own reader and never who stands on its
# microphone, so it goes on under the card and not under the tap.
PICKING_INTERVAL_S = 1

# A reader with no color of its own. The one everybody scans in turn is white — it belongs
# to no slot, so it may not borrow a slot's color — and everything dark is black.
WHITE = "ffffff"
BLACK = "000000"

# The slot colors as the strip wants them: six lowercase hex digits, no `#`. Read off the
# one list USDX and the frontend already share, so a color cannot drift between the
# microphone on the TV and the LED on the table.
_SLOT_RGB: dict[str, str] = {color.name: color.hex.lstrip("#").lower() for color in COLORS}

# How long an update the host asked for stays on offer. A device that failed to flash is
# quiet about it, so the flag has to give up by itself for the host to be able to ask again.
UPDATE_TTL = timedelta(minutes=10)


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


class SlotTakenElsewhereError(MappingError):
    """Another device already reads this slot color. One color is one microphone, and two
    readers answering for it — on one device or on two — is two people on one slot.

    Carries the other device's name because the page that refuses the mapping cannot know
    it: the collision is with a row this host may not even have open.
    """

    detail = "slot_taken_elsewhere"

    def __init__(self, color: str, device_name: str) -> None:
        super().__init__(f"the {color} slot is already read by '{device_name}'")
        self.color = color
        self.device_name = device_name


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


class UpdateRefusedError(RuntimeError):
    """There is no update to ask for. `detail` is what the API answers with: this Wingman
    ships no firmware at all, ships one that cannot be flashed over Wi-Fi, or ships exactly
    the version the device is already running."""

    def __init__(self, detail: str) -> None:
        super().__init__(f"no update to request: {detail}")
        self.detail = detail


class CardTakenError(RuntimeError):
    """Somebody else's card. What a singer claiming a card off the readers is answered when
    it turns out to be the person's next to them."""

    detail = "card_taken"

    def __init__(self, uid: str) -> None:
        super().__init__(f"card '{uid}' belongs to somebody else")
        self.uid = uid


@dataclass
class _Live:
    """What one device has said, and when it last said anything."""

    received_at: datetime
    # Which report this was, in the order they were *entered* — see `_sequence`.
    sequence: int
    # The protocol and firmware of the last report, whether or not Wingman could read the
    # rest of it: they are what makes "this device needs updating" news the room hears once.
    protocol: int
    firmware: str | None
    # The last report, when it was one this Wingman speaks. None for a device in another
    # protocol: such a report counts as a heartbeat and nothing more — it is never diffed,
    # and the first readable report after it starts from nothing, so cards already lying on
    # the readers are placed and not missed.
    report: DeviceReport | None = None
    # The watchdog has already told the room this device went quiet. Reset by the next
    # report, so the coming-back is announced exactly once as well.
    offline_announced: bool = False
    # The device's name as of its last report: what the watchdog's "went offline" line
    # says, without a query of its own.
    name: str = ""


@dataclass(frozen=True)
class ReportOutcome:
    """What one report did, and what the device is answered with. `changed` is what decides
    whether the room hears about it: a heartbeat that says nothing new is not worth a socket
    message every five seconds.

    The three fields after it are the answer itself. They default to "nothing at all", which
    is what a report that was dropped for being overtaken is answered: the device has long
    given up on that request, and the report that overtook it lit the strip already.
    """

    changed: bool
    interval_s: int = REPORT_INTERVAL_S
    leds: list[LedState] = field(default_factory=list)
    update: FirmwareUpdate | None = None


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
    logger.info("Player selector '%s' added", device.name)
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
        checked = _checked_roles(reader_roles, _decode(device.reader_states))
        _refuse_colors_read_elsewhere(checked, await _colors_of_other_devices(session, device_id))
        device.reader_roles = json.dumps(checked)
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
    logger.info("Player selector '%s' got a new token", device.name)
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
    logger.info("Player selector '%s' deleted", device.name)
    await event_bus.broadcast(DevicesChanged())


async def list_devices(session: AsyncSession) -> DeviceList:
    """Every device with what it is saying right now."""
    rows = list(await session.scalars(select(Device).order_by(Device.created_at)))
    async with _lock:
        live = dict(_live)
    uids = {uid for entry in live.values() for uid in _uids_on(entry)}
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
            CardRead(
                uid=card.uid,
                player=players[card.player_id],
                # Naive coming out of SQLite; everything we write is UTC (see `as_utc`).
                created_at=as_utc(card.created_at),
            )
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
    logger.info("Card %s now belongs to %s", normalised, player.name)
    await event_bus.broadcast(DevicesChanged())
    # The card the host just named may be lying on a slot right now, as the unknown card the
    # naming was about. The device will not report it again — it has not moved — so this is
    # the only moment the room can be told.
    await selection.card_identified(
        session_factory, normalised, player_id, auto_start=await auto_start_for(session)
    )
    return CardRead(uid=card.uid, player=read_player(player), created_at=as_utc(card.created_at))


async def forget_card(session: AsyncSession, uid: str) -> None:
    """Take a card off the table. Raises `UnknownCardError`."""
    normalised = uid.strip().upper()
    card = await session.get(PlayerCard, normalised)
    if card is None:
        raise UnknownCardError(uid)
    await session.delete(card)
    await session.commit()
    logger.info("Card %s forgotten", normalised)
    await event_bus.broadcast(DevicesChanged())
    # The other half of the same moment: a slot this card is holding somebody on becomes the
    # unknown card it now is. Nobody is scored for a card that belongs to nobody.
    await selection.card_forgotten(normalised)


async def claim_card(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    uid: str,
    player_id: str,
) -> CardRead:
    """A singer takes a card off the readers and says it is theirs.

    Identity and not a capability: the card table is the host's, but the card in somebody's
    hand is their own. A card nobody holds becomes theirs, their own card stays theirs
    (claiming twice is not an error, it is a phone that was tapped twice), and somebody
    else's is `CardTakenError` — the host moves that one, nobody else.

    Goes through `assign_card`, so a card claimed while it lies on a slot as an unknown card
    puts its owner on that slot at once. Raises `InvalidUidError` and `UnknownPlayerError`
    too.
    """
    normalised = uid.strip().upper()
    if not _UID.fullmatch(normalised):
        raise InvalidUidError(uid)
    card = await session.get(PlayerCard, normalised)
    # A card whose player has been deleted belongs to nobody, exactly as every listing
    # already draws it, so it is there to be claimed like any other.
    if (
        card is not None
        and card.player_id != player_id
        and await session.get(Player, card.player_id) is not None
    ):
        raise CardTakenError(normalised)
    return await assign_card(session, session_factory, normalised, player_id)


async def cards_of_player(session: AsyncSession, player_id: str) -> CardList:
    """One person's own cards, newest first. Raises `UnknownPlayerError`."""
    player = await session.get(Player, player_id)
    if player is None:
        raise UnknownPlayerError(player_id)
    read = read_player(player)
    cards = await session.scalars(
        select(PlayerCard)
        .where(PlayerCard.player_id == player_id)
        .order_by(PlayerCard.created_at.desc())
    )
    return CardList(
        cards=[
            CardRead(uid=card.uid, player=read, created_at=as_utc(card.created_at))
            for card in cards
        ]
    )


async def card_belongs_to(session: AsyncSession, uid: str, player_id: str) -> bool:
    """Whether this card is that player's own — what lets somebody give their own card back
    without `devices.manage`."""
    card = await session.get(PlayerCard, uid.strip().upper())
    return card is not None and card.player_id == player_id


async def unknown_cards(session: AsyncSession) -> list[str]:
    """The cards lying on the readers right now that belong to nobody.

    What the user page offers to claim: a card is only worth claiming while it is in the
    room, and a uid nobody can see the card of is a uid nobody should be handed. A card
    whose player has been deleted counts as unknown, exactly as every listing draws it.
    """
    async with _lock:
        entries = [entry for entry in _live.values() if _is_online(entry)]
    uids = {uid for entry in entries for uid in _uids_on(entry)}
    if not uids:
        return []
    known = await _players_by_uid(session, uids)
    return sorted(uids - set(known))


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
        selection_idle_s=int(values[device_settings.SELECTION_IDLE]),
        start_without_selection=str(values[device_settings.START_WITHOUT_SELECTION]),
        random_scope=str(values[device_settings.RANDOM_SCOPE]),
        random_playlist=str(values[device_settings.RANDOM_PLAYLIST]),
    )


async def apply_selection_idle_ttl(session: AsyncSession) -> None:
    """Tell the selection how long it may stand untouched.

    The setting lives here because the watchdog that enforces it does, and the selection
    holds the number rather than reading it: expiry runs inside its own lock, on a path that
    has no session to read a setting with.
    """
    seconds = int(await device_settings.service(session).get(device_settings.SELECTION_IDLE))
    selection.set_idle_ttl(seconds)


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
    """One snapshot from one device, in a protocol this Wingman speaks.

    A report in another protocol never reaches here: the API reads the version out of the
    raw body first and records that one through `record_foreign_report`, so a device whose
    report grew a field shows up as one that needs updating instead of being refused as
    malformed.

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

            # A report in another protocol was a heartbeat and nothing else, so this one
            # diffs against nothing: the cards lying on the readers are placed rather than
            # mistaken for cards that were already accounted for. "This device can be talked
            # to again" is news of its own.
            baseline = None if previous is None else previous.report
            diff = _diff(baseline, report, roles, actions)
            if previous is None or previous.report is None or not _is_online(previous):
                # It was quiet (or unreadable) and is not any more: that is worth saying even
                # when the report itself carries nothing new. Measured against the clock and
                # not against the watchdog's flag, so a device that came back before the
                # watchdog noticed it was gone is still a device coming back.
                diff.visible = True
            # A device back on the supported protocol (reflashed, rebooted inside the
            # watchdog's window) is the end of the warning below, so it is said as well.
            if previous is None or not _is_online(previous) or previous.protocol != report.protocol:
                logger.info(
                    "Player selector '%s' is online (firmware %s)", row.name, report.firmware
                )
            _live[device.id] = _Live(
                received_at=received_at,
                sequence=sequence,
                protocol=report.protocol,
                firmware=report.firmware,
                report=report,
                name=row.name,
            )

        values = await device_settings.read_all(session)
        uids = {change.uid for change in diff.changes if not isinstance(change, _Pressed)}
        player_ids = await _player_ids_by_uid(session, uids)
        # Who the cards lying there right now belong to — this report's cards and not the
        # last one's, because that is what the lights are about to say. `_players_by_uid`
        # and not the ids alone: a card whose player was deleted is an unknown card
        # everywhere else, and the strip must not be the one surface calling it known.
        known_uids = frozenset(await _players_by_uid(session, _uids_of(report)))
        # The two halves of the update over Wi-Fi, both under the row's own session: the
        # flag comes off once it has done its work, and what is left is what to offer.
        cleared = _update_is_over(row.update_requested_at, report.firmware)
        if cleared:
            logger.info(
                "Player selector '%s' is done with its update (firmware %s)",
                row.name,
                report.firmware,
            )
            row.update_requested_at = None
            await session.commit()
        update = _update_offer(row.update_requested_at, report.firmware)
        # What a start button is to do if it finds nobody picking anything. Only worked out
        # when one was really pressed and the host asked for more than nothing: reading the
        # cards off every device is two queries, and a heartbeat must not pay for them.
        start_mode = str(values[device_settings.START_WITHOUT_SELECTION])
        without_selection = (
            selection.StartWithoutSelection(
                mode=start_mode,
                cards=await cards_on_slots(session),
                # What a `random` press spins over. Read here and not in the selection: the
                # settings are this module's, and the selection is told what to do.
                scope=str(values[device_settings.RANDOM_SCOPE]),
                playlist_id=str(values[device_settings.RANDOM_PLAYLIST]) or None,
            )
            if start_mode != "nothing" and _starts_something(diff.changes)
            else None
        )

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
        without_selection=without_selection,
    )
    # After the dispatch, so a card put down and a start pressed in the same report light
    # what the room is *now*: the card on its slot, or the whole strip out because the song
    # that press started is playing.
    current = await selection.current_selection()
    if diff.visible or cleared:
        await event_bus.broadcast(DevicesChanged())
    return ReportOutcome(
        changed=diff.visible,
        interval_s=PICKING_INTERVAL_S if current is not None else REPORT_INTERVAL_S,
        leds=led_states(
            roles, report, known_uids, current, playing=karaoke.current_sing() is not None
        ),
        update=update,
    )


async def record_foreign_report(
    session_factory: async_sessionmaker[AsyncSession],
    device: Device,
    protocol: int,
    firmware: str | None,
) -> None:
    """A device reported in a protocol this Wingman does not speak.

    It is recorded all the same — that is the whole point: a device Wingman cannot talk to
    has to appear in the list as one that needs updating rather than as one that never
    arrived. Nothing but the heartbeat, the version and the firmware is kept, because
    nothing else in a report of another protocol means what this server would read it as.

    The API answers 426 after this; here it is a heartbeat like any other, overtaken reports
    and all.
    """
    received_at = _now()
    sequence = next(_sequence)
    async with session_factory() as session:
        row = await session.get(Device, device.id)
        if row is None:
            raise UnknownDeviceError(device.id)
        async with _lock:
            previous = _live.get(device.id)
            if previous is not None and sequence < previous.sequence:
                logger.debug("player selector %s: dropping an overtaken report", device.id)
                return
            row.last_seen_at = received_at
            row.protocol = protocol
            if firmware is not None:
                row.firmware_version = firmware
            await session.commit()
            # It cannot be diffed, but "this device needs updating" is news all the same —
            # once, and again whenever what it needs updating from changes.
            visible = (
                previous is None
                or previous.report is not None
                or not _is_online(previous)
                or previous.protocol != protocol
                or previous.firmware != firmware
            )
            # Also when it was online a moment ago in another protocol: a board reflashed to a
            # firmware this Wingman cannot read reboots well inside the watchdog's window.
            if previous is None or not _is_online(previous) or previous.protocol != protocol:
                logger.warning(
                    "Player selector '%s' is online but speaks protocol %d, not %d: "
                    "give it the firmware this Wingman brings",
                    row.name,
                    protocol,
                    SUPPORTED,
                )
            _live[device.id] = _Live(
                received_at=received_at,
                sequence=sequence,
                protocol=protocol,
                firmware=firmware,
                name=row.name,
            )
    if visible:
        await event_bus.broadcast(DevicesChanged())


async def device_online() -> bool:
    """Whether a player selector is standing in the room right now.

    What an opening selection asks before it seeds itself from the phone's memory: while a
    device is online, the cards are how this room picks its singers — on a slot reader the
    card lying there is the singer, on a singers-in-turn reader every scan fills the first
    *free* slot — and slots pre-filled with the last song's singers are in the way of both
    (the user's decision, 2026-09-06). The mapping does not matter, only that the device is
    online and speaks a protocol this server understands.
    """
    async with _lock:
        return any(entry.report is not None and _is_online(entry) for entry in _live.values())


async def cards_on_slots(session: AsyncSession) -> dict[str, selection.CardOnSlot]:
    """What lies on the slot readers of every device that is online, keyed by slot color.

    What a selection opens with: the people standing at the selector are already standing
    there, and the phone's remembered assignment must not put somebody else on their slot.
    Two devices wired to the same color is nobody's sensible setup; the one listed last
    wins, and the admin page shows both.
    """
    async with _lock:
        entries = [
            (device_id, entry.report)
            for device_id, entry in _live.items()
            if entry.report is not None and _is_online(entry)
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
    for device_id, report in entries:
        roles = rows.get(device_id, {})
        for reader in report.readers:
            color = _slot_color(roles.get(str(reader.index), UNUSED))
            if color is not None and reader.uid is not None:
                on_slots[color] = reader.uid
    player_ids = await _player_ids_by_uid(session, set(on_slots.values()))
    return {
        color: selection.CardOnSlot(uid=uid, player_id=player_ids.get(uid))
        for color, uid in on_slots.items()
    }


# --- the lights -------------------------------------------------------------------------


def led_states(
    roles: dict[str, str],
    report: DeviceReport,
    known_uids: frozenset[str],
    current: SelectionRead | None,
    playing: bool,
) -> list[LedState]:
    """What the optional strip shows until this device's next report is answered.

    One entry per reader position the report carried, because the strip has one LED per
    reader and a build with three readers has three LEDs. A slot reader is its slot's own
    color: dark while nothing lies on it, bright under a card Wingman can name, blinking
    under one it cannot, and pulsing while the automatic start counts down, which is the
    room's last few seconds to take a wrong card away. The reader everybody scans in turn
    has no slot and so no color of its own: it is white, pulsing to say "scan now" while
    singers are being picked. A song playing puts the whole strip out — the picking is over,
    and a lit table beside the TV is a table asking for cards nobody should be putting down.

    Pure, and told everything it needs: `known_uids` are the uids on *this* report that
    belong to somebody, `current` is the open selection (None for a quiet room) and
    `playing` is whether a song is running. Nothing here reads the clock or the database, so
    every rule is one call and one assertion.
    """
    states: list[LedState] = []
    for reader in sorted(report.readers, key=lambda entry: entry.index):
        role = roles.get(str(reader.index), UNUSED)
        color = _slot_color(role)
        if reader.state != "wired" or (role != SEQUENTIAL and color is None):
            # An unused reader, an unmapped one, and one the boot probe found nothing (or
            # something unreadable) on. Nothing about it is worth a light.
            states.append(LedState(index=reader.index, rgb=BLACK, mode="off"))
            continue
        if color is not None:
            rgb = _SLOT_RGB.get(color)
            if rgb is None:
                # A color no microphone has, which the mapping refuses and only a
                # hand-edited row can hold. Dark, like every other role Wingman cannot read.
                states.append(LedState(index=reader.index, rgb=BLACK, mode="off"))
                continue
            mode = _slot_mode(reader.uid, known_uids, current, playing)
        else:
            rgb = WHITE
            mode = _sequential_mode(current, playing)
        states.append(LedState(index=reader.index, rgb=rgb, mode=mode))
    return states


def _slot_mode(
    uid: str | None, known_uids: frozenset[str], current: SelectionRead | None, playing: bool
) -> LedMode:
    if playing:
        return "off"
    if current is not None and current.auto_start_at is not None:
        # Every slot of a room that is about to sing by itself, whatever lies on each one:
        # the countdown belongs to the room and not to one reader.
        return "pulse"
    if uid is None:
        return "dim"
    return "on" if uid in known_uids else "blink"


def _sequential_mode(current: SelectionRead | None, playing: bool) -> LedMode:
    if playing:
        return "off"
    return "pulse" if current is not None else "dim"


# --- the update over Wi-Fi ---------------------------------------------------------------


async def request_update(session: AsyncSession, device_id: str) -> None:
    """Ask a device to fetch the bundled firmware over Wi-Fi.

    Nothing is pushed: the flag is what the device's own next report is answered with, so a
    device that is unplugged picks the update up when it comes back — within the ten minutes
    the offer stands. After that the offer is over: the device is answered nothing, the
    listing stops saying one is pending, and the host asks again. Which is the point of the
    ten minutes, a device that failed to flash being quiet about it.

    Raises `UnknownDeviceError`, and `UpdateRefusedError` when there is no image to offer or
    the device is already on it.
    """
    device = await get_device(session, device_id)
    manifest = firmware.read_manifest()
    if manifest is None:
        raise UpdateRefusedError("no_firmware")
    if firmware.ota_file() is None:
        # An image built before the update over Wi-Fi existed. The cable still works, and
        # handing the device the merged image would fail at its first byte.
        raise UpdateRefusedError("no_ota_image")
    if device.firmware_version == manifest.version:
        raise UpdateRefusedError("already_current")
    device.update_requested_at = _now()
    await session.commit()
    logger.info(
        "Player selector '%s' asked to update to firmware %s over Wi-Fi",
        device.name,
        manifest.version,
    )
    await event_bus.broadcast(DevicesChanged())


def _update_offer(
    requested_at: datetime | None, firmware_version: str | None
) -> FirmwareUpdate | None:
    """The image a device is told to fetch, or nothing.

    Raises nothing and answers nothing at all in four cases: no update was asked for, the
    ask has expired, this Wingman has no image to give, or the device is already running it.
    """
    if requested_at is None or _expired(requested_at):
        return None
    manifest = firmware.read_manifest()
    file = firmware.ota_file()
    if manifest is None or file is None or manifest.version == firmware_version:
        return None
    return FirmwareUpdate(file=file, version=manifest.version)


def _update_is_over(requested_at: datetime | None, firmware_version: str | None) -> bool:
    """Whether the flag on the row has done its work and may go.

    Two ways: the device came back running the bundled version, which is the update having
    landed, and ten minutes, which is the update having failed silently. Both leave the row
    saying nothing is pending, so the host can ask again.
    """
    if requested_at is None:
        return False
    if _expired(requested_at):
        return True
    manifest = firmware.read_manifest()
    return manifest is not None and manifest.version == firmware_version


def _expired(requested_at: datetime) -> bool:
    """`as_utc` because SQLite drops the offset on the way in and hands the column back
    naive, and comparing naive with aware raises."""
    return _now() - as_utc(requested_at) > UPDATE_TTL


# --- the watchdog -----------------------------------------------------------------------


async def start_watchdog(session_factory: async_sessionmaker[AsyncSession]) -> None:
    """Start the task that notices devices going quiet. Started by the app lifespan, like
    the download workers.

    Takes the session factory to read how long a selection may stand untouched: the watchdog
    is what drops a stale one, so the number it enforces is read where it is started, and
    every later change to it comes through the settings route.
    """
    global _watchdog
    async with session_factory() as session:
        await apply_selection_idle_ttl(session)
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
                logger.info("Player selector '%s' went offline", entry.name or device_id)
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
    previous: DeviceReport | None,
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
    before = _readers_by_index(previous) if previous is not None else {}
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
    if previous is not None and previous.firmware != report.firmware:
        diff.visible = True
    before_buttons = _buttons_by_index(previous) if previous is not None else {}
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


def _starts_something(changes: list[_Change]) -> bool:
    """Whether this report carries a press of the start button."""
    return any(isinstance(change, _Pressed) and change.action == "start" for change in changes)


async def _dispatch(
    session_factory: async_sessionmaker[AsyncSession],
    changes: list[_Change],
    player_ids: dict[str, str],
    auto_start: selection.AutoStart | None,
    rescan_removes: bool,
    without_selection: selection.StartWithoutSelection | None = None,
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
                    session,
                    session_factory,
                    _button_action(change.action),
                    without_selection=without_selection,
                    auto_start=auto_start,
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


def _aware(value: datetime | None) -> datetime | None:
    """A nullable column as an aware UTC timestamp. `as_utc` for the two of them a device
    row may not have yet."""
    return None if value is None else as_utc(value)


def _standing_request(requested_at: datetime | None) -> datetime | None:
    """The update the host asked for, while it is still on offer.

    The same ten minutes `_update_offer` measures, applied at the read: the flag is only
    taken *off* the row by a report, so a device that never comes back would otherwise leave
    the page saying "Update requested" for the rest of the party. Read-time and not a write,
    because the column is the record of when the host asked and the listing is not the place
    to rewrite it.
    """
    if requested_at is None or _expired(requested_at):
        return None
    return as_utc(requested_at)


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
    report = None if live is None else live.report
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
        # Naive coming out of SQLite; everything we write is UTC (see `as_utc`). Without
        # this the browser reads "last seen" as a local time and draws it hours out.
        created_at=as_utc(device.created_at),
        last_seen_at=_aware(device.last_seen_at),
        online=online,
        firmware_version=device.firmware_version,
        protocol=device.protocol,
        compatible=None if device.protocol is None else device.protocol == SUPPORTED,
        rssi=None if report is None or not online else report.rssi,
        uptime_s=None if report is None or not online else report.uptime_s,
        update_requested_at=_standing_request(device.update_requested_at),
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
    uids = set() if live is None else _uids_on(live)
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


async def _colors_of_other_devices(session: AsyncSession, device_id: str) -> dict[str, str]:
    """Which slot color every *other* device reads, and the name of the device reading it.

    Read at the moment the mapping is saved rather than kept anywhere: a device that has
    been deleted since gives its colors back, and this is what makes that true without a
    single line about it.
    """
    taken: dict[str, str] = {}
    for row in await session.scalars(select(Device).where(Device.id != device_id)):
        for role in _decode(row.reader_roles).values():
            color = _slot_color(role)
            if color is not None:
                taken.setdefault(color, row.name)
    return taken


def _refuse_colors_read_elsewhere(roles: dict[str, str], taken: dict[str, str]) -> None:
    """One color, one reader, across every device in the room. Raises
    `SlotTakenElsewhereError` for the first collision, in reader order."""
    for position in sorted(roles, key=_position_order):
        color = _slot_color(roles[position])
        if color is not None and color in taken:
            raise SlotTakenElsewhereError(color, taken[color])


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


def _uids_on(live: _Live) -> set[str]:
    """Every card lying on this device's readers. Empty for a device whose last report was
    in another protocol: nothing in it says what is lying anywhere."""
    if live.report is None:
        return set()
    return _uids_of(live.report)


def _uids_of(report: DeviceReport) -> set[str]:
    """Every card one report says is lying on a reader."""
    return {reader.uid for reader in report.readers if reader.uid is not None}


def _readers_by_index(report: DeviceReport) -> dict[int, ReaderReport]:
    return {reader.index: reader for reader in report.readers}


def _buttons_by_index(report: DeviceReport) -> dict[int, ButtonReport]:
    return {button.index: button for button in report.buttons}
