"""The open player selection: who is about to sing what, and the lock around it.

Module state, exactly like the one running song next door in `service.py`: there is one
room, so there is at most one selection. It stands between "somebody picked a song" and
"the song starts". The phone that opened it moves people between the colored slots, the
player selector device puts cards on them, and the host screen draws it filling up.

Whoever opened it holds a token. Only that token moves the slots and presses Play; anybody
else who may sing can *take over*, which is a new selection with a new token. The device
carries no token at all: it stands in the room, and standing in the room is the right.

A selection may also be *spun*: instead of a song, the opener names a scope and the server
picks the song out of it (`reel.py`), on the phone's behalf and on the start button's alike.
The host screen turns the pick into a reel landing on the song, a respin picks again in the
same scope and keeps the slots, and a press while the reel still runs lands it instead of
spinning again (`REVEAL_SECONDS`). The automatic start never runs on a *phone's* spin —
pressing until the song is right must not race a countdown; Play is the confirmation — and
on the selector's own spin it counts down as at any other selection, but never before the
reel has landed (`_refresh_auto_start`).

Knows nothing about FastAPI — the API layer maps these exceptions onto status codes, and
the devices module calls the `card_*` and `button_pressed` entry points directly.
"""

import asyncio
import contextlib
import logging
import secrets
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..events import SelectionChanged, event_bus
from ..music import service as music
from ..music.schema import MusicRead
from ..players.model import Player
from ..players.schema import PlayerRead, read_player
from ..songs.model import Song
from ..songs.schema import SongRead, read_song, song_label
from ..tags import service as tags
from . import reel, service
from .schema import CurrentSing, Scope, SelectionRead, SelectionSlotRead, SpinOrigin, SpinRead

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

# How long the reel on the host screen runs before it lands, in seconds. The same figure as
# the frontend's `REVEAL_MS` in `frontend/src/components/SongReel.tsx`, and the two have to
# agree: a press that arrives inside this window is the room not wanting to wait, and lands
# the reel (`revealed`) instead of spinning again or starting the song.
REVEAL_SECONDS = 5.5
_REVEAL = timedelta(seconds=REVEAL_SECONDS)

# The selector's button has no account behind it at all: what it may pick out of is what a
# party guest may see. Shared with the background music, which picks the same way.
_GUEST = tags.GUEST_VIEWER

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


class EmptyPoolError(LookupError):
    """The reel found nothing to land on: a wishlist nobody wished on, a playlist that is
    gone or empty, the favorites of a caller with no account."""

    def __init__(self, scope: str) -> None:
        super().__init__(f"nothing to pick from in '{scope}'")
        self.scope = scope


class NotASpinError(RuntimeError):
    """A respin on a selection that was opened with a song: there is no scope to pick from
    again."""

    def __init__(self) -> None:
        super().__init__("this player selection was not spun")


@dataclass(frozen=True)
class Spin:
    """What a spun selection is picked out of: the reel's scope, the playlist for the
    `playlist` scope, and whose hidden tags — and, for `favorites`, whose hearts — the pick
    is made with. Kept on the selection for as long as it stands, so a respin picks the
    way the opener did, whoever presses it."""

    scope: Scope
    viewer: tags.Viewer
    playlist_id: str | None = None


@dataclass(frozen=True)
class CardOnSlot:
    """A card lying on a reader that is wired to one slot color. `player_id` is None for a
    card no player owns."""

    uid: str
    player_id: str | None


@dataclass(frozen=True)
class StartWithoutSelection:
    """What the selector's start button does when it finds nobody picking anything.

    `mode` is `devices.start_without_selection`: `nothing`, `top_wish` for the song the room
    wished for most, or `random`. `cards` is what lies on the slot readers: who sings it —
    and, for `top_wish`, the reason the press counts at all, because a button pressed with
    no card on any reader is somebody leaning on the table, not a room asking for a song.
    `random` spins the reel on the host screen instead, cards or none, and starts nothing on
    the press itself — the next press does, or the automatic start once the reel has landed;
    `scope` and `playlist_id` are `devices.random_scope` and `devices.random_playlist`, what
    that reel picks out of.
    """

    mode: str
    cards: Mapping[str, CardOnSlot] = field(default_factory=dict)
    scope: str = "all"
    playlist_id: str | None = None


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
class _Spin:
    """The reel behind a spun selection. `id` is 1 on opening and one more on every respin —
    the host screen animates on a new id. The viewer is the opener's: never in a read model,
    because whose account picked is nobody else's business, and kept so a respin from the
    selector's button picks the way the phone did.

    `origin` is the path that opened it, a phone's or the selector's, and stays across every
    respin. `revealed` is a press that landed while the reel was still running: the room did
    not want to wait, so both screens settle the reel at once. False again on every spin;
    a reel nobody cut short lands on its own clock and leaves it false."""

    id: int
    spun_at: datetime
    scope: Scope
    playlist_id: str | None
    viewer: tags.Viewer
    origin: SpinOrigin
    revealed: bool = False
    # When the press landed the reel early, for the host's fade-in (`music.SelectionPreview`).
    revealed_at: datetime | None = None
    # What the host screen plays when the reel lands: where the file says a preview starts,
    # and whether there is a file at all. Read off the picked row here, so the music needs no
    # query of its own under two locks.
    preview_start: float | None = None
    has_audio: bool = False
    # The song's ReplayGain, off the same row, for the host to play it at (`music`).
    gain_db: float | None = None
    peak: float | None = None


@dataclass(frozen=True)
class _Preview:
    """What the host screen plays for a selection that is not (or no longer) spun: the song
    it was opened with, from the moment it opened, or what the reel landed on, kept once the
    spin comes off (`pick_singers`) — with the spin's own key and landing, so the song plays
    on where it is rather than from the top. Either way it plays while the singers are
    picked, until the selection is started or given up."""

    key: str
    reveal_at: datetime
    preview_start: float | None
    has_audio: bool
    gain_db: float | None = None
    peak: float | None = None


def _opened_with(song: Song, opened_at: datetime) -> _Preview:
    """The preview of a selection opened with a song: no reel to wait for, so it starts at
    once. The key is the selection's own — a new selection, even of the same song, is a new
    preview — and never one a spin's key could be."""
    return _Preview(
        key=f"{opened_at.isoformat()}:song",
        reveal_at=opened_at,
        preview_start=song.preview_start_seconds,
        has_audio=song.audio_file is not None,
        gain_db=song.replay_gain_db,
        peak=song.replay_gain_peak,
    )


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
    # The reel, for a selection the server picked the song of. None for one opened with a
    # song, and never set later: a selection is spun from the start or not at all — though
    # the opener may take the spin off it again (`pick_singers`), once the song is right.
    spin: _Spin | None = None
    # What the host plays while there is no spin: see `_Preview`.
    preview: _Preview | None = None


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
    song_id: str | None,
    slots: list[service.SlotRequest],
    force: bool = False,
    device_slots: Mapping[str, CardOnSlot] | None = None,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    auto_start: AutoStart | None = None,
    spin: Spin | None = None,
) -> tuple[SelectionRead, str]:
    """Open a selection for `song_id` — or, with `spin` instead of one, for a song the reel
    picks — and return it with the token that owns it.

    `slots` is what the phone remembered from the last song. `device_slots` is what lies on
    the player selector right now, keyed by slot color: a card on a reader beats the
    remembered assignment, because it is a person standing in the room.

    `auto_start` starts the countdown right here when those cards already fill the room —
    everybody is standing at the selector with their card down, and waiting for one of them
    to lift a card and put it back would be a joke. A room the *phone* filled from memory
    starts nothing: a phone has Play, and `set_slots` never starts a countdown either. A
    selection spun from here is the phone's spin, which starts nothing either, full room or
    not (see `_refresh_auto_start`).

    Raises `SelectionOpenError` unless `force`, `UnknownSongError`, `EmptyPoolError` for a
    spin with nothing to land on, and everything `service.resolve_slots` raises. Opening one
    while a song plays is fine: the next singers line up while the current ones are still
    going.
    """
    global _selection
    if song_id is not None and spin is not None:
        raise ValueError("open a selection with a song or with a spin, not both")
    async with _lock:
        await _expire_locked()
        # Before anything is looked up: while somebody else is picking, the answer is that
        # and nothing else. A phone whose remembered slots have gone stale has to be told
        # to take over, not that one of last night's singers is gone — and a phone whose
        # wishlist is empty that somebody else is picking, not that its pool is.
        if _selection is not None and not force:
            raise SelectionOpenError
        now = _now()
        spun: _Spin | None = None
        preview: _Preview | None = None
        if spin is not None:
            song = await reel.pick_song(
                session, spin.scope, spin.viewer, playlist_id=spin.playlist_id
            )
            if song is None:
                raise EmptyPoolError(spin.scope)
            spun = _Spin(
                id=1,
                spun_at=now,
                scope=spin.scope,
                playlist_id=spin.playlist_id,
                viewer=spin.viewer,
                origin="phone",
                preview_start=song.preview_start_seconds,
                has_audio=song.audio_file is not None,
                gain_db=song.replay_gain_db,
                peak=song.replay_gain_peak,
            )
        elif song_id is not None:
            song = await session.get(Song, song_id)
            if song is None:
                raise service.UnknownSongError(song_id)
            preview = _opened_with(song, now)
        else:
            raise ValueError("open a selection with a song or with a spin")
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
        _selection = _Selection(
            song=read_song(song),
            slots=states,
            token=secrets.token_urlsafe(TOKEN_BYTES),
            opened_at=now,
            updated_at=now,
            spin=spun,
            preview=preview,
        )
        if from_device:
            _refresh_auto_start(_selection, auto_start, session_factory)
        await _broadcast_locked()
        return _read(_selection), _selection.token


async def respin(session: AsyncSession, token: str | None) -> SelectionRead:
    """The opener spins again: a new song out of the same scope, for the same viewer, on the
    same slots. The reel on the host screen runs on the new `spin.id`.

    Unless the reel is still running: then the press is the room not wanting to wait, and it
    lands the reel on the song it has (`revealed`) rather than spinning a second one over
    the first — the same rule the selector's start button follows (`button_pressed`).

    Nothing rules the song it just landed on out — the phone's own reel repeats too, and a
    pool of one song has nothing else to offer. Raises `NoSelectionError`,
    `NotTheOpenerError`, `NotASpinError` for a selection opened with a song, and
    `EmptyPoolError` when the scope has run dry since (the last wish taken back, the
    playlist emptied) — the selection stands as it was in that case.
    """
    async with _lock:
        await _expire_locked()
        selection = _opener_or_raise(token)
        # A phone's spin never counts down, so there is nothing to reschedule here: the two
        # Nones are what a phone knows about the automatic start, which is nothing.
        if not _reveal_locked(selection, None, None):
            await _respin_locked(session, selection, None, None)
        await _broadcast_locked()
        return _read(selection)


async def pick_singers(
    token: str | None,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    auto_start: AutoStart | None = None,
) -> SelectionRead:
    """The opener moves on from the reel to picking singers: the spin comes off the
    selection, and it is an ordinary one from here — no respin, no reel on the TV, and the
    selector's press starts the song or refuses as it does at any selection opened with a
    song. The slots and the song stay as the reel left them.

    An ordinary one from here means the countdown rule of `open_selection` applies from
    here too: when the cards on the selector hold a slot and the room is full of known
    players, `auto_start` starts counting down right now — the people were standing at the
    selector with their cards down the whole time the reel ran, and the spin was the one
    thing holding the countdown back. A room the *phone* filled from memory starts nothing,
    exactly as when it opens a selection over what it remembered: a phone has Play. Raises
    `NoSelectionError`, `NotTheOpenerError` and `NotASpinError` for a selection that was
    never spun (or whose spin was already taken off).
    """
    async with _lock:
        await _expire_locked()
        selection = _opener_or_raise(token)
        if selection.spin is None:
            raise NotASpinError
        # The spin's own key and landing, so the host plays on where it is (`_Preview`). A
        # pick while the reel still runs (the phone's Play waits for the landing, the route
        # does not) lands it now: the TV shows the song from here on, and the speakers must
        # not keep it back until a landing nobody sees any more.
        landed = _preview_of(selection)
        if landed is not None and landed.reveal_at > _now():
            landed = replace(landed, reveal_at=_now())
        selection.preview = landed
        selection.spin = None
        _touch(selection)
        if any(slot.card_uid is not None for slot in selection.slots):
            _refresh_auto_start(selection, auto_start, session_factory)
        await _broadcast_locked()
        return _read(selection)


async def set_slots(
    session: AsyncSession, token: str, slots: list[service.SlotRequest]
) -> SelectionRead:
    """The opener moves people around. Raises `NoSelectionError`, `NotTheOpenerError` and
    everything `service.resolve_slots` raises.

    A slot a card is lying on is not the phone's to move. The card in somebody's hand is
    the room's own answer to who sings on that microphone, and the phone's body is a whole
    assignment written before the card landed: a `PUT` already on the wire when a card
    arrives would otherwise read as "the phone took them off". So the phone moves the slots
    no card holds, and the rest is answered with what the readers say — no refusal, because
    the body was not wrong when it was sent.
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
    without_selection: StartWithoutSelection | None = None,
    auto_start: AutoStart | None = None,
    skip_music: bool = False,
) -> None:
    """A button on the player selector was pressed.

    Nobody is on the other end of a button, so a start that fails is logged and the
    selection stays: the host reads what went wrong on the TV or on their phone.

    `without_selection` is what a `start` press does when nobody is picking anything. None
    (and `nothing`) leaves a quiet room quiet, which is the default: a button that starts a
    song out of nowhere is a thing the host asks for. `auto_start` is the host's automatic
    start, for the countdown a selector's spin runs once its reel has landed.

    `skip_music` is what a `cancel` press does when nobody is picking anything
    (`devices.cancel_without_selection`): the background music moves on to its next song,
    the very call `POST /music/skip` makes and under its rules (`_skip_music_locked`). With a
    selection open a cancel gives it up, as it always has, and skips nothing.

    A `start` at a *spun* selection whose reel is still running lands the reel — the room
    did not want to wait — and does nothing else, whoever stands on the slots. Otherwise,
    with nobody on any slot it spins again — the room is still looking for the right song,
    and there is nobody to sing the one it has — in the scope and for the viewer the
    selection was opened with, a phone's or the button's own. With somebody on a slot it
    starts the song, as at any other selection.
    """
    if action == "cancel":
        # Decided under the lock: a selection opened between "is anything open" and the
        # skip would otherwise be the one press both closing it and moving the music on.
        async with _lock:
            stood = _selection is not None
            await _expire_locked()
            if _selection is not None:
                await _drop_locked(_selection)
                return
            if stood or not skip_music:
                # One that ran out of time on this very press was still on the TV, so the
                # press was meant for it. It is gone, and that is all the press does.
                return
            payload = await _skip_music_locked(session)
        if payload is not None:
            await music.broadcast(payload)
        return
    async with _lock:
        await _expire_locked()
        if _selection is None:
            if action == "start" and without_selection is not None:
                await _start_without_selection_locked(
                    session, session_factory, without_selection, auto_start
                )
            return
        if action == "clear":
            for slot in _selection.slots:
                slot.player = None
                slot.card_uid = None
            await _after_device_change(True, None, None)
            return
        if _reveal_locked(_selection, auto_start, session_factory):
            await _broadcast_locked()
            return
        if _selection.spin is not None and not any(
            slot.player is not None for slot in _selection.slots
        ):
            try:
                await _respin_locked(session, _selection, auto_start, session_factory)
            except EmptyPoolError:
                # The scope ran dry under the selection. Nobody is on the other end of the
                # button, so the song it has stays on the screen — and the press still counts
                # as the room being busy with it, like every other press does.
                logger.info("The player selector's start button found no song to spin again to")
                _touch(_selection)
                return
            await _broadcast_locked()
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
        spin=None
        if selection.spin is None
        else SpinRead(
            id=selection.spin.id,
            spun_at=selection.spin.spun_at,
            scope=selection.spin.scope,
            playlist_id=selection.spin.playlist_id,
            origin=selection.spin.origin,
            revealed=selection.spin.revealed,
        ),
    )


async def _broadcast_locked() -> None:
    await event_bus.broadcast(
        SelectionChanged(selection=None if _selection is None else _read(_selection))
    )
    # The one place every change of the selection passes, so the music follows all of them:
    # a selection opened, a reel started, respun, landed early, its spin taken off, a slot
    # moved, the selection gone. The music answers the ones that keep the song with nothing.
    await music.selection_changed(None if _selection is None else _selection_preview(_selection))


def _preview_of(selection: _Selection) -> _Preview | None:
    """The song behind the selection as the host plays it: the spin while it is on, else
    the song it was opened with or what the reel landed on (`_Selection.preview`)."""
    spin = selection.spin
    if spin is None:
        return selection.preview
    return _Preview(
        key=f"{selection.opened_at.isoformat()}:{spin.id}",
        reveal_at=spin.revealed_at or spin.spun_at + _REVEAL,
        preview_start=spin.preview_start,
        has_audio=spin.has_audio,
        gain_db=spin.gain_db,
        peak=spin.peak,
    )


def _selection_preview(selection: _Selection) -> music.SelectionPreview | None:
    preview = _preview_of(selection)
    if preview is None:
        return None
    return music.SelectionPreview(
        key=preview.key,
        song=selection.song,
        start_s=preview.preview_start,
        reveal_at=preview.reveal_at,
        has_audio=preview.has_audio,
        gain_db=preview.gain_db,
        peak=preview.peak,
    )


async def _expire_locked() -> None:
    if _selection is not None and _now() - _selection.updated_at > _idle_ttl:
        logger.info(
            "Nobody touched the player selection for %s, so it was closed",
            song_label(_selection.song),
        )
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


async def _skip_music_locked(session: AsyncSession) -> MusicRead | None:
    """The cancel button, pressed at a room where nobody is picking anything: the background
    music's next song, by the phone's own Next (`music.skip`) and under its rules — a paused
    room stays paused, and nothing moves while the music is off or Ultrastar Deluxe has the
    speakers.

    Nobody is on the other end of a button, so every refusal is one log line and nothing
    else. Returns what the room is to be told, or None for a press that changed nothing.
    Never raises: the answer to the report carries the lights, and a device that got a 500
    would retry with the same counter, so the press would be lost all the same.
    """
    try:
        payload = await music.skip(session)
    except music.MusicDisabledError:
        logger.info("The player selector's cancel button skipped nothing: the music is off")
        return None
    except music.MusicBlockedError:
        logger.info(
            "The player selector's cancel button skipped nothing: Ultrastar Deluxe has the speakers"
        )
        return None
    except music.EmptyPoolError:
        state = await music.read()
        if state.status == "waiting":
            # The pause after a song: there was no track to take off, and the skip does not
            # end the pause (the phone has no Next there either). Nothing moved.
            logger.info(
                "The player selector's cancel button skipped nothing: the music is pausing "
                "after a song"
            )
            return None
        logger.info("The player selector's cancel button found no background song to skip to")
        # The track the skip took off is gone all the same, and the phones are still
        # drawing it. The route leaves that to the refusal it answers; a button has none.
        return state
    except Exception:
        logger.exception("the player selector's cancel button could not skip the music")
        return None
    if payload.track is not None:
        logger.info(
            "The player selector's cancel button skipped the background music to %s",
            song_label(payload.track.song),
        )
    return payload


async def _start_without_selection_locked(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    without: StartWithoutSelection,
    auto_start: AutoStart | None,
) -> None:
    """The start button, pressed at a room where nobody is picking anything.

    Wingman picks the song, out of the **guest's** library: a song a tag keeps from the party
    is kept from the button too, and the button is the one caller in the app with no account
    behind it at all. Nobody is waiting on any of this, so every way of coming up empty is a
    log line.

    `top_wish` is one press: the cards on the readers are the singers and the song the room
    wished for most starts right here. A press with no card on any slot reader does nothing,
    so a table somebody leant on cannot start a song with an empty stage. `random` spins the
    reel on the host screen instead (`_spin_without_selection_locked`) and starts nothing.
    """
    global _selection
    if without.mode == "random":
        await _spin_without_selection_locked(session, session_factory, without, auto_start)
        return
    if without.mode != "top_wish":
        return
    if not without.cards:
        logger.info("The player selector's start button was pressed with no card on any reader")
        return
    song = await reel.top_wish(session, _GUEST)
    if song is None:
        logger.info("The player selector's start button found no wish to sing")
        return
    states = await _slot_states(session, [])
    _put_cards_on(states, without.cards, await _card_players(session, without.cards))
    if not any(slot.card_uid is not None for slot in states):
        # Cards on readers wired to colors this host does not sing with. Nobody is on a
        # slot, so there is nobody to sing.
        logger.info(
            "The player selector's start button found no card on a reader mapped to a "
            "microphone color"
        )
        return
    now = _now()
    _selection = _Selection(
        song=read_song(song),
        slots=states,
        # Nobody holds this one. It is started in the same breath, so the token is never
        # handed out and never needed; a phone that wants the room takes it over with
        # `force`, exactly as it would take over anybody else's.
        token=secrets.token_urlsafe(TOKEN_BYTES),
        opened_at=now,
        updated_at=now,
        # Never heard: this selection is started before anybody is told it exists, and the
        # sing takes the speakers. Set like every selection opened with a song all the same.
        preview=_opened_with(song, now),
    )
    opened = _selection
    try:
        await _start_locked(session, session_factory, opened, force=False)
    except Exception:
        # A song already playing, a launcher that is not configured, a slot the sing flow
        # refuses. The room has no selection to look at either way, so it goes again.
        logger.exception("the selector's start button could not start the song it picked")
        await _drop_locked(opened)


async def _spin_without_selection_locked(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    without: StartWithoutSelection,
    auto_start: AutoStart | None,
) -> None:
    """The start button set to `random`, at a quiet room: spin the reel on the host screen.

    Opens a spun selection over the cards lying on the slot readers — none is fine, the room
    presses again once it likes the song and somebody has put a card down — and starts
    nothing on this press: the next one starts the song if anybody stands on a slot and
    respins otherwise (`button_pressed`), and a phone may take it over like any other. The
    token is nobody's, exactly as for `top_wish`. This is the selector's own spin, so a room
    the cards already fill counts down like any other — from the moment the reel lands, not
    from now (`_refresh_auto_start`).

    The scope is the host's (`devices.random_scope`). A playlist that has gone, or emptied,
    since the host chose it falls back to every song, with a log line and the selection
    saying `all` — a respin picks out of the same everything rather than failing twice.
    """
    global _selection
    try:
        scope = reel.parse_scope(without.scope)
    except ValueError:
        logger.warning(
            "The player selector's random scope '%s' is not one: picking from all songs",
            without.scope,
        )
        scope = "all"
    playlist_id = without.playlist_id or None
    if scope == "playlist" and playlist_id is None:
        logger.info(
            "The player selector picks from a playlist but none is set: picking from all songs"
        )
        scope = "all"
    song = await reel.pick_song(session, scope, _GUEST, playlist_id=playlist_id)
    if song is None and scope == "playlist":
        logger.info(
            "The player selector's playlist %s is gone or empty: picking from all songs",
            playlist_id,
        )
        scope, playlist_id = "all", None
        song = await reel.pick_song(session, scope, _GUEST)
    if song is None:
        logger.info("The player selector's start button found no song to spin to (%s)", scope)
        return
    states = await _slot_states(session, [])
    _put_cards_on(states, without.cards, await _card_players(session, without.cards))
    now = _now()
    _selection = _Selection(
        song=read_song(song),
        slots=states,
        token=secrets.token_urlsafe(TOKEN_BYTES),
        opened_at=now,
        updated_at=now,
        spin=_Spin(
            id=1,
            spun_at=now,
            scope=scope,
            playlist_id=playlist_id,
            viewer=_GUEST,
            origin="device",
            preview_start=song.preview_start_seconds,
            has_audio=song.audio_file is not None,
            gain_db=song.replay_gain_db,
            peak=song.replay_gain_peak,
        ),
    )
    _refresh_auto_start(_selection, auto_start, session_factory)
    await _broadcast_locked()


def _reveal_locked(
    selection: _Selection,
    auto_start: AutoStart | None,
    session_factory: async_sessionmaker[AsyncSession] | None,
) -> bool:
    """A press at a spun selection whose reel is still running lands the reel, and that is
    all it does. Whether it did: the caller broadcasts and stops there, or goes on to what
    the press means once the reel is down — a respin, or the start.

    The window is `REVEAL_SECONDS` from the spin, the reel's own running time; a reel that
    has landed on its own clock, or been landed once, lets the press through. A countdown
    that was waiting for the reel to land now has nothing to wait for, so it is put on the
    clock again from this very moment.
    """
    spin = selection.spin
    if spin is None or spin.revealed or _now() >= spin.spun_at + _REVEAL:
        return False
    spin.revealed = True
    spin.revealed_at = _now()
    _touch(selection)
    _reschedule_auto_start(selection, auto_start, session_factory)
    return True


async def _respin_locked(
    session: AsyncSession,
    selection: _Selection,
    auto_start: AutoStart | None,
    session_factory: async_sessionmaker[AsyncSession] | None,
) -> None:
    """Pick again in the selection's own scope and put the song on it. The slots stay: the
    people are the same, only the song was wrong. Raises `NotASpinError` and
    `EmptyPoolError` — before anything is written, so a refused respin leaves the selection
    exactly as it stood, its idle clock included: a phone told "nothing to pick from" has
    not touched the room, and an `updated_at` that moved without a broadcast would be a
    selection the TV's idea of it cannot follow.

    A new reel is a new landing, so a countdown is put on the clock again from it — which
    with the room still full is the new reveal, and otherwise nothing."""
    if selection.spin is None:
        raise NotASpinError
    spin = selection.spin
    song = await reel.pick_song(session, spin.scope, spin.viewer, playlist_id=spin.playlist_id)
    if song is None:
        raise EmptyPoolError(spin.scope)
    now = _now()
    selection.song = read_song(song)
    selection.updated_at = now
    spin.id += 1
    spin.spun_at = now
    spin.revealed = False
    spin.revealed_at = None
    spin.preview_start = song.preview_start_seconds
    spin.has_audio = song.audio_file is not None
    spin.gain_db = song.replay_gain_db
    spin.peak = song.replay_gain_peak
    _reschedule_auto_start(selection, auto_start, session_factory)


async def _card_players(
    session: AsyncSession, cards: Mapping[str, CardOnSlot]
) -> dict[str, PlayerRead | None]:
    """Who the cards on the slot readers belong to, by slot color. None for an unknown card
    and for one whose player has since been deleted."""
    return {color: await _player_row(session, card.player_id) for color, card in cards.items()}


def _put_cards_on(
    states: list[_Slot], cards: Mapping[str, CardOnSlot], players: Mapping[str, PlayerRead | None]
) -> None:
    """Seed the slots with the cards lying on the readers. A card on a reader wired to a
    color the host does not sing with lands nowhere."""
    for color, card in cards.items():
        slot = _slot_of_states(states, color)
        if slot is not None:
            _put_on_slot(states, slot, players.get(color), card.uid)


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


def _opener_or_raise(token: str | None) -> _Selection:
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
    """Give the slots a card is lying on back to the cards, whatever the phone just sent.

    The phone sends the whole assignment on every tap, and it knows nothing about cards — an
    unknown card comes back as an empty slot, and a `PUT` written a moment before a card
    landed comes back without the singer that card has since put there. Neither is the phone
    changing its mind, so neither may take a card's slot away: a slot holding a `card_uid`
    keeps its player and its card, and only the slots no card holds are the phone's.

    The one thing the phone's body may still do to a card's slot is name that person
    somewhere else. It cannot have them: one person sings on one microphone, and the card is
    what decides which — so the *other* slot is emptied rather than the room holding the same
    singer twice.
    """
    cards = {slot.color: slot for slot in previous}
    held: set[str] = set()
    for state in states:
        before = cards.get(state.color)
        if before is None or before.card_uid is None:
            continue
        state.player = before.player
        state.card_uid = before.card_uid
        held.add(state.color)
    for state in states:
        if state.color in held or state.player is None:
            continue
        if any(_same_player(cards[color].player, state.player) for color in held):
            state.player = None
            state.card_uid = None
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

    Never on a *phone's* spin, full room or not (the user's decision, 2026-09-06): the phone
    presses until the song is right, and that must not race a countdown — Play is the
    confirmation. The selector's own spin counts down like any other selection, but never
    before the reel has landed: the delay runs from the reveal (`spun_at` plus
    `REVEAL_SECONDS`, or right now once a press has landed the reel), so the room sees the
    song before it sees *Starting in…*.
    """
    if not _is_full(selection) or _phone_spun(selection):
        _cancel_auto_start(selection)
        return
    if auto_start is None or session_factory is None or selection.auto_start_task is not None:
        return
    now = _now()
    landed = now
    if selection.spin is not None and not selection.spin.revealed:
        landed = max(now, selection.spin.spun_at + _REVEAL)
    selection.auto_start_at = landed + timedelta(seconds=auto_start.delay_s)
    task = asyncio.create_task(
        _auto_start(selection, (selection.auto_start_at - now).total_seconds(), session_factory)
    )
    selection.auto_start_task = task
    _auto_start_tasks.add(task)
    task.add_done_callback(_auto_start_finished)


def _reschedule_auto_start(
    selection: _Selection,
    auto_start: AutoStart | None,
    session_factory: async_sessionmaker[AsyncSession] | None,
) -> None:
    """The moment the reel lands has moved — a respin, or a press that landed it early — so
    a countdown that was waiting for it is worked out again, rather than left alone the way
    `_refresh_auto_start` leaves a running one."""
    _cancel_auto_start(selection)
    _refresh_auto_start(selection, auto_start, session_factory)


def _phone_spun(selection: _Selection) -> bool:
    return selection.spin is not None and selection.spin.origin == "phone"


def _cancel_auto_start(selection: _Selection) -> None:
    task = selection.auto_start_task
    selection.auto_start_task = None
    selection.auto_start_at = None
    if task is not None:
        task.cancel()


def _auto_start_finished(task: "asyncio.Task[None]") -> None:
    _auto_start_tasks.discard(task)


async def _auto_start(
    selection: _Selection, delay_s: float, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    """Start the song by itself, once the room has had `delay_s` seconds to take a wrong
    card off the selector — the seconds until `auto_start_at`, the reel's remaining run
    included where there is one."""
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
