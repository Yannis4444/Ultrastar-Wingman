"""The open player selection: who is about to sing what, and the lock around it.

Module state, exactly like the one running song next door in `service.py`: there is one
room, so there is at most one selection. It stands between "somebody picked a song" and
"the song starts". The phone that opened it moves people between the colored slots, the
player selector device puts cards on them, and the host screen draws it filling up.

Whoever opened it holds a token. Only that token moves the slots and presses Play; anybody
else who may sing can *take over*, which is a new selection with a new token. The device
carries no token at all: it stands in the room, and standing in the room is the right.

Knows nothing about FastAPI — the API layer maps these exceptions onto status codes, and
the devices module calls the `card_*` and `button_pressed` entry points directly.
"""

import asyncio
import contextlib
import logging
import secrets
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..events import SelectionChanged, event_bus
from ..players.model import Player
from ..players.schema import PlayerRead, read_player
from ..songs.model import Song
from ..songs.schema import SongRead, read_song
from . import service
from .schema import CurrentSing, SelectionRead, SelectionSlotRead

logger = logging.getLogger(__name__)

# A selection nobody has touched for this long is gone. Somebody picked a song, walked off
# and left the room locked otherwise — and the TV would keep showing a song nobody sings.
# The host can retune it (`devices.selection_idle_s`), so this is the value a Wingman that
# has not read its settings yet runs on.
DEFAULT_IDLE_TTL = timedelta(minutes=2)
_idle_ttl = DEFAULT_IDLE_TTL

# 24 bytes of `secrets`, which is a 32-character URL-safe string. The token never leaves
# the phone it was minted for, and it is compared with `compare_digest`.
TOKEN_BYTES = 24

ButtonAction = Literal["start", "clear", "cancel"]


class SelectionOpenError(RuntimeError):
    """Somebody else is already picking singers. The caller may take over with `force`."""

    def __init__(self) -> None:
        super().__init__("a player selection is already open")


class NoSelectionError(LookupError):
    def __init__(self) -> None:
        super().__init__("no player selection is open")


class NotTheOpenerError(RuntimeError):
    """The token does not own the open selection: another phone took it over in between."""

    def __init__(self) -> None:
        super().__init__("this player selection belongs to somebody else")


@dataclass(frozen=True)
class CardOnSlot:
    """A card lying on a reader that is wired to one slot color. `player_id` is None for a
    card no player owns."""

    uid: str
    player_id: str | None


@dataclass(frozen=True)
class AutoStart:
    """The host turned the selector's automatic start on: once every slot holds a known
    player, the song starts by itself after `delay_s` seconds."""

    delay_s: int


@dataclass
class _Slot:
    color: str
    player: PlayerRead | None
    # The card lying on this slot's reader, so a card being taken off it only empties the
    # slot it is still on. None for a slot the phone assigned.
    card_uid: str | None


@dataclass
class _Selection:
    song: SongRead
    slots: list[_Slot]
    # The opener's secret. Never in a read model, never on the event bus.
    token: str
    opened_at: datetime
    updated_at: datetime
    auto_start_at: datetime | None = None
    auto_start_task: "asyncio.Task[None] | None" = None


# One room, one selection — see `service._running` for the same reasoning.
_selection: _Selection | None = None
_lock = asyncio.Lock()
# The pending countdowns, tracked rather than fired and forgotten: shutdown cancels what is
# still running, and the tests wait for it instead of sleeping.
_auto_start_tasks: set[asyncio.Task[None]] = set()


def _now() -> datetime:
    """The clock, read through the module so the tests can move it: an expiry of two
    minutes is otherwise only testable by waiting two minutes."""
    return datetime.now(UTC)


async def current_selection() -> SelectionRead | None:
    """What is being picked right now, or None.

    Async where `service.current_sing()` is not: reading is also when a selection that has
    been standing too long is dropped, and dropping one tells the room about it.
    """
    async with _lock:
        await _expire_locked()
        return None if _selection is None else _read(_selection)


async def is_open() -> bool:
    """Whether the room is picking singers — what `POST /karaoke/sing` asks before it
    plays over somebody's selection."""
    return await current_selection() is not None


def set_idle_ttl(seconds: int) -> None:
    """How long a selection may stand untouched, in seconds.

    Held here rather than read where it is used: expiry runs inside this module's lock, on
    paths that have no database session to read a setting with. `devices.service` sets it
    when the watchdog starts and whenever the host changes it.
    """
    global _idle_ttl
    _idle_ttl = timedelta(seconds=seconds)


async def expire_stale() -> None:
    """Drop the selection if it has been idle for `set_idle_ttl`'s seconds. Every call in
    this module does this first; it is public for the watchdog, so the TV clears itself even
    when nobody asks anything."""
    async with _lock:
        await _expire_locked()


async def open_selection(
    session: AsyncSession,
    song_id: str,
    slots: list[service.SlotRequest],
    force: bool = False,
    device_slots: Mapping[str, CardOnSlot] | None = None,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    auto_start: AutoStart | None = None,
) -> tuple[SelectionRead, str]:
    """Open a selection for `song_id` and return it with the token that owns it.

    `slots` is what the phone remembered from the last song. `device_slots` is what lies on
    the player selector right now, keyed by slot color: a card on a reader beats the
    remembered assignment, because it is a person standing in the room.

    `auto_start` starts the countdown right here when those cards already fill the room —
    everybody is standing at the selector with their card down, and waiting for one of them
    to lift a card and put it back would be a joke. A room the *phone* filled from memory
    starts nothing: a phone has Play, and `set_slots` never starts a countdown either.

    Raises `SelectionOpenError` unless `force`, `UnknownSongError`, and everything
    `service.resolve_slots` raises. Opening one while a song plays is fine: the next singers
    line up while the current ones are still going.
    """
    global _selection
    async with _lock:
        await _expire_locked()
        # Before anything is looked up: while somebody else is picking, the answer is that
        # and nothing else. A phone whose remembered slots have gone stale has to be told
        # to take over, not that one of last night's singers is gone.
        if _selection is not None and not force:
            raise SelectionOpenError
        song = await session.get(Song, song_id)
        if song is None:
            raise service.UnknownSongError(song_id)
        # Before the lock is taken over: a request that is refused must leave whatever is
        # open exactly as it was.
        states = await _slot_states(session, slots)
        from_device = False
        for color, card in (device_slots or {}).items():
            slot = _slot_of_states(states, color)
            if slot is not None:
                _put_on_slot(states, slot, await _player_row(session, card.player_id), card.uid)
                from_device = True
        if _selection is not None:
            _cancel_auto_start(_selection)
        now = _now()
        _selection = _Selection(
            song=read_song(song),
            slots=states,
            token=secrets.token_urlsafe(TOKEN_BYTES),
            opened_at=now,
            updated_at=now,
        )
        if from_device:
            _refresh_auto_start(_selection, auto_start, session_factory)
        await _broadcast_locked()
        return _read(_selection), _selection.token


async def set_slots(
    session: AsyncSession, token: str, slots: list[service.SlotRequest]
) -> SelectionRead:
    """The opener moves people around. Raises `NoSelectionError`, `NotTheOpenerError` and
    everything `service.resolve_slots` raises.

    A tap is newer than whatever is lying on a reader, so a slot the phone points at
    somebody is that person's — an unknown card on it included.
    """
    async with _lock:
        await _expire_locked()
        selection = _opener_or_raise(token)
        selection.slots = _keep_cards(selection.slots, await _slot_states(session, slots))
        _touch(selection)
        # A phone never starts a countdown, but emptying a slot ends the one that is running:
        # the room's own change said the selection is not ready after all.
        _refresh_auto_start(selection, None, None)
        await _broadcast_locked()
        return _read(selection)


async def start_selection(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    token: str,
    force: bool = False,
) -> CurrentSing:
    """Sing what is on the slots. The selection is gone once USDX is up; every error the
    sing flow raises comes through unchanged and leaves it standing, so the phone can fix
    what the message names and press Play again.

    The lock is *not* held across the sing flow. A forced start kills the running song,
    which means waiting for USDX to exit and for its scores to be imported, and everything
    else in this module would be waiting behind it — a report from the player selector
    included, which is a card in somebody's hand that does not register. So the token is
    checked and the slots are read under the lock, the song starts without it, and the
    selection is dropped afterwards only if it is still the same one.
    """
    async with _lock:
        await _expire_locked()
        selection = _opener_or_raise(token)
        requests = _slot_requests(selection)
        song_id = selection.song.id
        # Before the lock is given up: a countdown that fired inside this window would start
        # the same song a second time, and the phone that pressed Play would be answered
        # "something is already playing" for the song it just asked for.
        _cancel_auto_start(selection)
    sing = await service.start_sing(session, session_factory, song_id, requests, force=force)
    async with _lock:
        if _selection is selection:
            await _drop_locked(selection)
    return sing


async def close_selection(token: str | None = None, any_opener: bool = False) -> None:
    """Give the selection up. Idempotent: with nothing open this does nothing at all, which
    is what an unmounting phone needs.

    `any_opener` is the room's own cancel (a `karaoke.stop` holder, or a button on the
    selector). Without it, a token that does not own the selection is `NotTheOpenerError`.
    """
    async with _lock:
        await _expire_locked()
        if _selection is None:
            return
        if not any_opener and not _is_opener(_selection, token):
            raise NotTheOpenerError
        await _drop_locked(_selection)


async def card_placed_on_slot(
    session_factory: async_sessionmaker[AsyncSession],
    color: str,
    uid: str,
    player_id: str | None = None,
    auto_start: AutoStart | None = None,
) -> None:
    """A card appeared on the reader wired to `color`: that slot is theirs.

    Nothing open means nothing happens — the card is simply lying there, and the next
    selection opens with it. A player standing on another slot leaves it: one person sings
    on one microphone.
    """
    async with _lock:
        await _expire_locked()
        if _selection is None:
            return
        slot = _slot_of(_selection, color)
        if slot is None:
            # A reader wired to a color the host has since taken out of the slot list.
            return
        player = await _player(session_factory, player_id)
        changed = slot.card_uid != uid or not _same_player(slot.player, player)
        if changed:
            _put_on_slot(_selection.slots, slot, player, uid)
        await _after_device_change(changed, auto_start, session_factory)


async def card_removed_from_slot(color: str, uid: str) -> None:
    """The card was taken off the reader wired to `color`.

    Only the slot that still holds *that* card is emptied. A slot the phone has since
    pointed at somebody else keeps its singer: the card left the reader, not the person.
    """
    async with _lock:
        await _expire_locked()
        if _selection is None:
            return
        slot = _slot_of(_selection, color)
        changed = slot is not None and slot.card_uid == uid
        if changed and slot is not None:
            slot.player = None
            slot.card_uid = None
        await _after_device_change(changed, None, None)


async def card_scanned(
    session_factory: async_sessionmaker[AsyncSession],
    uid: str,
    player_id: str | None = None,
    rescan_removes: bool = True,
    auto_start: AutoStart | None = None,
) -> None:
    """A card was held against the one reader everybody scans in turn.

    Whoever it belongs to takes the first free slot. Somebody who already stands on one
    leaves it when `rescan_removes` is on, and nothing happens when it is off. With every
    slot taken, nothing happens either: the room is full.
    """
    async with _lock:
        await _expire_locked()
        if _selection is None:
            return
        player = await _player(session_factory, player_id)
        standing = _standing_on(_selection, player, uid)
        changed = False
        if standing is not None:
            if rescan_removes:
                standing.player = None
                standing.card_uid = None
                changed = True
        else:
            free = _first_free(_selection)
            if free is not None:
                _put_on_slot(_selection.slots, free, player, uid)
                changed = True
        await _after_device_change(changed, auto_start, session_factory)


async def card_identified(
    session_factory: async_sessionmaker[AsyncSession],
    uid: str,
    player_id: str,
    auto_start: AutoStart | None = None,
) -> None:
    """The host just said on the admin page whose card this is.

    A card nobody owned stands on its slot as an unknown card, and the device says nothing
    new about it — it has not moved. So the naming itself is what puts the person there;
    without this the room would have to lift the card off the reader and put it back down.

    Every slot this very card is on is filled, whoever stands on it: naming a card is the
    host saying who is holding it, so handing Alice's card to Bob mid-selection puts Bob on
    her slot rather than leaving her there singing for him. A card the room does not hold
    changes nothing at all.
    """
    async with _lock:
        await _expire_locked()
        if _selection is None:
            return
        slots = [slot for slot in _selection.slots if slot.card_uid == uid]
        if not slots:
            # Nothing in this room: not even the idle clock is touched. A selection nobody
            # is standing at must not be kept alive by somebody tidying the card table.
            return
        player = await _player(session_factory, player_id)
        if player is None:
            return
        if all(_same_player(slot.player, player) for slot in slots):
            # The card was already theirs on every slot it lies on: nothing moved, and the
            # room hears nothing.
            return
        for slot in slots:
            # Two readers reporting the same uid is a cloned card, not two people:
            # `_put_on_slot` takes the player off the slot before, so the last one holds them.
            _put_on_slot(_selection.slots, slot, player, uid)
        await _after_device_change(True, auto_start, session_factory)


async def card_forgotten(uid: str) -> None:
    """The host took this card off the table: it belongs to nobody now.

    The card is still lying on the reader and the person is still standing at it, so the slot
    is not emptied — it becomes the unknown card it would be if the card were put down now.
    Naming it again fills it back in, lifting it empties the slot, and a countdown ends,
    because a room with an unknown card in it is not full.
    """
    async with _lock:
        await _expire_locked()
        if _selection is None:
            return
        changed = False
        for slot in _selection.slots:
            if slot.card_uid == uid and slot.player is not None:
                slot.player = None
                changed = True
        if not changed:
            return
        await _after_device_change(True, None, None)


async def button_pressed(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    action: ButtonAction,
) -> None:
    """A button on the player selector was pressed.

    Nobody is on the other end of a button, so a start that fails is logged and the
    selection stays: the host reads what went wrong on the TV or on their phone.
    """
    if action == "cancel":
        await close_selection(any_opener=True)
        return
    async with _lock:
        await _expire_locked()
        if _selection is None:
            return
        if action == "clear":
            for slot in _selection.slots:
                slot.player = None
                slot.card_uid = None
            await _after_device_change(True, None, None)
            return
        _touch(_selection)
        try:
            await _start_locked(session, session_factory, _selection, force=False)
        except Exception:
            logger.exception("the selector's start button could not start the song")
            await _broadcast_locked()


async def wait_for_auto_start() -> None:
    """Let a pending automatic start run to its end — what a test waits on instead of
    sleeping. Used by nothing else."""
    while _auto_start_tasks:
        await asyncio.gather(*list(_auto_start_tasks), return_exceptions=True)


async def shutdown() -> None:
    """Wingman is going down: no selection outlives the process, and no countdown outlives
    the database engine it would start a song with."""
    global _selection
    async with _lock:
        if _selection is not None:
            _cancel_auto_start(_selection)
        _selection = None
    pending = list(_auto_start_tasks)
    _auto_start_tasks.clear()
    for task in pending:
        task.cancel()
    for task in pending:
        # It is being shut down: the cancellation is expected, and anything else is already
        # on the log of the task itself.
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task


# --- everything below runs with `_lock` held -------------------------------------------


def _read(selection: _Selection) -> SelectionRead:
    return SelectionRead(
        song=selection.song,
        slots=[
            SelectionSlotRead(color=slot.color, player=slot.player, card_uid=slot.card_uid)
            for slot in selection.slots
        ],
        opened_at=selection.opened_at,
        updated_at=selection.updated_at,
        auto_start_at=selection.auto_start_at,
    )


async def _broadcast_locked() -> None:
    await event_bus.broadcast(
        SelectionChanged(selection=None if _selection is None else _read(_selection))
    )


async def _expire_locked() -> None:
    if _selection is not None and _now() - _selection.updated_at > _idle_ttl:
        logger.info("dropping the player selection for %s: idle", _selection.song.id)
        await _drop_locked(_selection)


async def _drop_locked(selection: _Selection) -> None:
    global _selection
    _cancel_auto_start(selection)
    if _selection is selection:
        _selection = None
    await _broadcast_locked()


async def _start_locked(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    selection: _Selection,
    force: bool,
) -> CurrentSing:
    """Hand the slots to the sing flow, with the lock held.

    What the two callers with nobody on the other end use — the selector's start button and
    the automatic start. A phone's Play goes through `start_selection`, which gives the lock
    up first: it has somebody waiting for an answer, while these two have a log line.
    """
    sing = await service.start_sing(
        session, session_factory, selection.song.id, _slot_requests(selection), force=force
    )
    await _drop_locked(selection)
    return sing


def _slot_requests(selection: _Selection) -> list[service.SlotRequest]:
    """The slots as the sing flow takes them. An unknown card is an empty slot: Wingman has
    no name to write into USDX for it."""
    return [
        service.SlotRequest(
            color=slot.color, player_id=None if slot.player is None else slot.player.id
        )
        for slot in selection.slots
    ]


async def _after_device_change(
    changed: bool,
    auto_start: AutoStart | None,
    session_factory: async_sessionmaker[AsyncSession] | None,
) -> None:
    """What every card and every button has in common: the selection stays alive because
    the room is busy with it, and the change goes out only when something really moved."""
    if _selection is None:
        return
    _touch(_selection)
    if not changed:
        return
    _refresh_auto_start(_selection, auto_start, session_factory)
    await _broadcast_locked()


def _touch(selection: _Selection) -> None:
    selection.updated_at = _now()


def _opener_or_raise(token: str) -> _Selection:
    if _selection is None:
        raise NoSelectionError
    if not _is_opener(_selection, token):
        raise NotTheOpenerError
    return _selection


def _is_opener(selection: _Selection, token: str | None) -> bool:
    # Encoded first, like `auth.service` does: `compare_digest` raises TypeError on a
    # non-ASCII str, and a phone can send any string at all as its token.
    return token is not None and secrets.compare_digest(selection.token.encode(), token.encode())


async def _slot_states(session: AsyncSession, slots: list[service.SlotRequest]) -> list[_Slot]:
    """The host's configured slots, in the host's order, with whoever the client asked for
    on them. Validated exactly like a sing is, so a selection can never collect an
    assignment that Play would refuse."""
    configured = await service.slot_colors(session)
    resolved = await service.resolve_slots(session, slots)
    players = {slot.color: player for slot, player in resolved}
    states: list[_Slot] = []
    for color in configured:
        player = players.get(color)
        states.append(
            _Slot(
                color=color, player=None if player is None else read_player(player), card_uid=None
            )
        )
    return states


def _keep_cards(previous: list[_Slot], states: list[_Slot]) -> list[_Slot]:
    """Carry the card uids over into what the phone just sent.

    The phone sends the whole assignment on every tap, and it knows nothing about cards. So a
    slot it left alone keeps the card lying on it — an unknown card included, which the phone
    draws and sends back as an empty slot — and taking that card away still empties the slot.
    A slot the phone pointed at somebody else loses the card: the person on it is the phone's
    choice now, and the card on the reader no longer speaks for it.
    """
    cards = {slot.color: slot for slot in previous}
    for state in states:
        before = cards.get(state.color)
        if before is None or before.card_uid is None:
            continue
        if state.player is None:
            # An unknown card the phone could only send back as empty. A slot whose singer
            # the phone took off keeps nothing: their card is on the reader, not on the slot.
            state.card_uid = None if before.player is not None else before.card_uid
        elif _same_player(before.player, state.player):
            state.card_uid = before.card_uid
    return states


async def _player(
    session_factory: async_sessionmaker[AsyncSession], player_id: str | None
) -> PlayerRead | None:
    async with session_factory() as session:
        return await _player_row(session, player_id)


async def _player_row(session: AsyncSession, player_id: str | None) -> PlayerRead | None:
    """Who a card belongs to, or None for a card Wingman does not know. A card whose player
    has since been deleted counts as unknown — there is nobody left to score."""
    if player_id is None:
        return None
    player = await session.get(Player, player_id)
    return None if player is None else read_player(player)


def _put_on_slot(
    slots: list[_Slot], slot: _Slot, player: PlayerRead | None, uid: str | None
) -> None:
    """Put a card (and whoever it belongs to) on one slot. A player already standing
    somewhere else leaves that slot: one person sings on one microphone, and two slots of
    the same name is exactly what the sing flow refuses."""
    if player is not None:
        for other in slots:
            if other is not slot and _same_player(other.player, player):
                other.player = None
                other.card_uid = None
    slot.player = player
    slot.card_uid = uid


def _same_player(one: PlayerRead | None, other: PlayerRead | None) -> bool:
    if one is None or other is None:
        return one is None and other is None
    return one.id == other.id


def _slot_of(selection: _Selection, color: str) -> _Slot | None:
    return _slot_of_states(selection.slots, color)


def _slot_of_states(slots: list[_Slot], color: str) -> _Slot | None:
    return next((slot for slot in slots if slot.color == color), None)


def _standing_on(selection: _Selection, player: PlayerRead | None, uid: str) -> _Slot | None:
    """The slot this card is already on: the player's slot for a known card, and the slot
    holding this very uid for an unknown one — so one card cannot fill two slots."""
    if player is None:
        return next((slot for slot in selection.slots if slot.card_uid == uid), None)
    return next((slot for slot in selection.slots if _same_player(slot.player, player)), None)


def _first_free(selection: _Selection) -> _Slot | None:
    return next(
        (slot for slot in selection.slots if slot.player is None and slot.card_uid is None), None
    )


def _is_full(selection: _Selection) -> bool:
    """Every slot held by somebody Wingman knows. An unknown card is not full: nobody would
    be scored for it."""
    return bool(selection.slots) and all(slot.player is not None for slot in selection.slots)


def _refresh_auto_start(
    selection: _Selection,
    auto_start: AutoStart | None,
    session_factory: async_sessionmaker[AsyncSession] | None,
) -> None:
    """Keep the countdown in step with the slots.

    It ends the moment the selection is not full any more, and it starts when a change at
    the device fills it and the host turned automatic starting on. A countdown that is
    already running is left alone: the delay is the room's chance to take a wrong card away,
    and restarting it with every report would make it never fire.
    """
    if not _is_full(selection):
        _cancel_auto_start(selection)
        return
    if auto_start is None or session_factory is None or selection.auto_start_task is not None:
        return
    selection.auto_start_at = _now() + timedelta(seconds=auto_start.delay_s)
    task = asyncio.create_task(_auto_start(selection, auto_start.delay_s, session_factory))
    selection.auto_start_task = task
    _auto_start_tasks.add(task)
    task.add_done_callback(_auto_start_finished)


def _cancel_auto_start(selection: _Selection) -> None:
    task = selection.auto_start_task
    selection.auto_start_task = None
    selection.auto_start_at = None
    if task is not None:
        task.cancel()


def _auto_start_finished(task: "asyncio.Task[None]") -> None:
    _auto_start_tasks.discard(task)


async def _auto_start(
    selection: _Selection, delay_s: int, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    """Start the song by itself, once the room has had `delay_s` seconds to take a wrong
    card off the selector."""
    await asyncio.sleep(delay_s)
    async with _lock:
        if _selection is not selection or not _is_full(selection):
            return
        selection.auto_start_task = None
        selection.auto_start_at = None
        _touch(selection)
        try:
            async with session_factory() as session:
                await _start_locked(session, session_factory, selection, force=False)
        except Exception:
            # Nobody is waiting on this call: a song that will not start is logged, and the
            # selection stands so the room can see it and press Play themselves.
            logger.exception("the automatic start of the player selection failed")
            await _broadcast_locked()
