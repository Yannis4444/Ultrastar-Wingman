"""What the background music is doing, and the one screen that makes the sound.

Two things live here. A **track** is a song and where in it we are; a **sink lease** is
which host tab is playing it. Both are module state, like `karaoke.service._running` and for
the same reason: there is one pair of speakers in the room, and none of it should outlive
the process. The options are settings rows, so there is no table either.

**Nothing advances a track on a timer.** `Song.duration_seconds` is `played_seconds`,
narrowed by the song's `#START` and `#END`, so it is not how long the audio file plays and
cannot be a clock. Only the sink's own `ended` report moves the music on. Everything else in
here is a deadline plus a one-second tick, the `devices` watchdog shape, so a test moves
`_now()` and calls `tick()` rather than sleeping.

Knows nothing about FastAPI: the API layer maps these exceptions onto status codes.

**Import direction**, and it is the only one that works: `karaoke.service` imports this
module, the way it already imports `achievements.service`, and calls the four hooks at the
bottom. This module imports only the *leaves* `karaoke.reel` and `karaoke.schema` — never
`karaoke.service`, and never `karaoke.selection`, which imports `service` itself and would
close the circle. (That is also why `selection._GUEST` could not simply be reused: the
viewer moved to `tags.service.GUEST_VIEWER` instead, where both modules can read it.)
"""

import asyncio
import contextlib
import logging
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..events import MusicChanged, event_bus
from ..karaoke import reel
from ..karaoke.schema import Scope
from ..settings import SettingsService, SettingValue
from ..songs.model import Song
from ..songs.schema import SongRead, read_song
from ..sound import EFFECTS_VOLUME, MASTER_VOLUME, MUSIC_VOLUME
from ..tags import service as tags
from . import settings as music_settings
from .schema import (
    MusicBlocker,
    MusicPreviewRead,
    MusicRead,
    MusicSettings,
    MusicStatus,
    MusicTrackRead,
    MusicVolumeRead,
)

logger = logging.getLogger(__name__)

# How often the host reports, and how long its lease survives without one. Three missed
# reports rather than one: a phone's network hiccup must not take the music off the TV.
HEARTBEAT_INTERVAL_S = 5
SINK_TIMEOUT = timedelta(seconds=15)

# The tick. One second is fine because a pass with no deadline due is a few comparisons.
TICK_S = 1.0

# An empty pool is a state, not an error: the room may wish for something at any moment, so
# it is worth asking again — just not every second.
EMPTY_RETRY = timedelta(seconds=30)

# A library where nothing plays must not spin at request speed. After this many songs in a
# row the sink could not play, the music gives up for a while and says the pool is empty.
MAX_ERRORS = 5
ERROR_BACKOFF = timedelta(seconds=60)

# How many times a pick may be re-rolled to avoid the song that just played. A pool of one
# song plays it again rather than looping.
PICK_ATTEMPTS = 3


@dataclass(frozen=True)
class _Options:
    enabled: bool
    scope: str
    playlist: str
    resume_delay_s: int
    preview_on_spin: bool


@dataclass(frozen=True)
class _Volumes:
    master: int
    music: int
    effects: int


DEFAULT_OPTIONS = _Options(
    enabled=False, scope="all", playlist="", resume_delay_s=10, preview_on_spin=True
)
DEFAULT_VOLUMES = _Volumes(master=100, music=100, effects=100)


@dataclass
class _Track:
    """A song and where in it we are.

    `position_s` is true as of `position_at`; the current position is worked out from the
    two, and only while the music actually plays. When the sink goes away the worked-out
    value is written back and the track freezes.
    """

    id: str
    song: SongRead
    song_id: str
    started_at: datetime
    position_s: float
    position_at: datetime
    duration_s: float | None


@dataclass(frozen=True)
class SpinPreview:
    """What `karaoke.selection` hands over on every change of the room's selection: the
    song the reel picked and when it lands, or None for a selection that was never spun (or
    for none at all). `key` tells one spin from the next — a respin is a new song and a new
    landing — and `reveal_at` is the landing on the server's clock, moved forward by a press
    that lands the reel early. `start_s` is `Song.preview_start_seconds`, or None for a
    file that says nothing; `has_audio` is whether there is a file to play at all."""

    key: str
    song: SongRead
    start_s: float | None
    reveal_at: datetime
    has_audio: bool


@dataclass
class _Preview:
    """The reel's song, while the host plays it. See `MusicPreviewRead`."""

    key: str
    song: SongRead
    start_s: float
    reveal_at: datetime


@dataclass
class _Sink:
    """The host tab making the sound, and when it last said so."""

    id: str
    generation: int
    last_seen_at: datetime


# Module state on purpose: there is one pair of speakers on this machine.
_track: _Track | None = None
# The song that was on last, kept across the gap where there is no track at all: every
# path to the next song clears the track first, so the picker would otherwise have
# nothing to avoid repeating.
_last_song_id: str | None = None
# The reel's song, while a spun selection stands and the host plays it. Set and cleared by
# `selection_changed`, and dropped by whatever takes the speakers.
_preview: _Preview | None = None
_sink: _Sink | None = None
_sink_generation: int = 0
_paused: bool = False
_sing_running: bool = False
_usdx_open: bool = False
_resume_at: datetime | None = None
_retry_at: datetime | None = None
_errors: int = 0
_options: _Options = DEFAULT_OPTIONS
_volumes: _Volumes = DEFAULT_VOLUMES
_lock = asyncio.Lock()
_watchdog: asyncio.Task[None] | None = None


def _now() -> datetime:
    """The clock, read through the module so the tests can move it."""
    return datetime.now(UTC)


class MusicDisabledError(RuntimeError):
    """The background music is switched off. Turning it on takes `music.manage`."""

    detail = "music_disabled"


class MusicBlockedError(RuntimeError):
    """Ultrastar Deluxe has the speakers — a song is being sung, or it stands open."""

    detail = "music_blocked"


class EmptyPoolError(RuntimeError):
    """Nothing to play: an empty library, an empty wishlist, a deleted playlist."""

    detail = "empty_pool"


class NotTheSinkError(RuntimeError):
    """This tab is not the one making the sound any more; another one took over."""

    detail = "not_the_sink"


# --- reading -----------------------------------------------------------------------------


def _sink_online(at: datetime) -> bool:
    return _sink is not None and at - _sink.last_seen_at <= SINK_TIMEOUT


def _status(at: datetime) -> tuple[MusicStatus, MusicBlocker | None]:
    """What the music is doing, in the order the reasons outrank each other."""
    if not _options.enabled:
        return "off", None
    if _sing_running:
        return "blocked", "sing"
    if _usdx_open:
        return "blocked", "usdx"
    if _resume_at is not None and at < _resume_at:
        return "waiting", None
    if _track is None:
        return "empty", None
    return ("paused", None) if _paused else ("playing", None)


def _position(track: _Track, at: datetime, status: MusicStatus) -> float:
    """Where the track is now.

    It only advances while the music plays *and* somebody is listening: a track nobody
    hears must not march past its own end on the server's clock, because the host would
    then join a song that is already over. Nor while the reel's song has the speakers: the
    background froze for it and comes back where it stopped.
    """
    if status != "playing" or not _sink_online(at) or _preview is not None:
        return track.position_s
    elapsed = (at - track.position_at).total_seconds()
    return max(0.0, track.position_s + elapsed)


def _read(at: datetime | None = None) -> MusicRead:
    """The public payload. Must be built under `_lock`."""
    at = _now() if at is None else at
    status, blocked_by = _status(at)
    track = None
    if _track is not None:
        track = MusicTrackRead(
            id=_track.id,
            song=_track.song,
            started_at=_track.started_at,
            position_s=_position(_track, at, status),
            position_at=at,
            duration_s=_track.duration_s,
        )
    return MusicRead(
        status=status,
        track=track,
        preview=None
        if _preview is None
        else MusicPreviewRead(
            id=_preview.key,
            song=_preview.song,
            start_s=_preview.start_s,
            reveal_at=_preview.reveal_at,
        ),
        blocked_by=blocked_by,
        resume_at=_resume_at if status == "waiting" else None,
        retry_at=_retry_at if status == "empty" else None,
        sink_online=_sink_online(at),
        sink_generation=_sink_generation,
        volume=MusicVolumeRead(
            master=_volumes.master, music=_volumes.music, effects=_volumes.effects
        ),
        scope=_scope(),
    )


def _scope() -> Scope:
    try:
        return reel.parse_scope(_options.scope)
    except ValueError:
        # A hand-edited settings row. The pick falls back the same way, with its own line.
        return "all"


async def read() -> MusicRead:
    """What the music is doing, and nothing else.

    Deliberately does **not** pick a song, although it easily could: a pick nobody
    broadcasts is a song the host screen never hears about, and a reader's GET is not a
    thing to announce to the room. Picking out of nowhere is the tick's job alone, a second
    away at most; every other pick is somebody pressing something, and the route that
    served the press broadcasts it.
    """
    async with _lock:
        return _read()


async def read_settings(session: AsyncSession) -> MusicSettings:
    values = await music_settings.read_all(session)
    return MusicSettings(
        enabled=bool(values[music_settings.ENABLED]),
        scope=str(values[music_settings.SCOPE]),
        playlist=str(values[music_settings.PLAYLIST]),
        resume_delay_s=int(values[music_settings.RESUME_DELAY]),
        preview_on_spin=bool(values[music_settings.PREVIEW_ON_SPIN]),
    )


# --- the state machine -------------------------------------------------------------------


async def _evaluate(session: AsyncSession | None) -> None:
    """Settle the state. Called under `_lock` after every mutation and on every tick.

    Only picking needs the database, which is why the karaoke hooks can call in without
    one: they drop the track, and the next tick (a second later, at most) picks the next.
    """
    at = _now()
    # The reel's song is not the soundtrack: it stays across the music being switched off,
    # and goes only with the option, or with the speakers.
    if _preview is not None and (not _options.preview_on_spin or _sing_running or _usdx_open):
        _end_preview(at)
    if not _options.enabled:
        _clear_track()
        _set_resume(None)
        _set_retry(None)
        return
    if _sing_running or _usdx_open:
        # The speakers are somebody else's. The track goes rather than freezing: when the
        # music comes back it comes back on a *new* song from the beginning, never on the
        # one the singing interrupted.
        _clear_track()
        return
    if _resume_at is not None:
        if at < _resume_at:
            return
        _set_resume(None)
    if _track is not None:
        return
    if _preview is not None:
        # The reel's song has the speakers. A track picked now would stand at 0:00 on every
        # phone with nobody hearing it; the tick after the preview ends picks as usual.
        return
    if _retry_at is not None:
        if at < _retry_at:
            return
        _set_retry(None)
    if session is None:
        return
    await _start_next(session, at)


def _clear_track() -> None:
    global _track, _last_song_id
    if _track is not None:
        _last_song_id = _track.song_id
    _track = None


def _freeze(at: datetime) -> None:
    """Write the live position into the track and stop it advancing.

    Call this **before** whatever is about to stop the music — pausing, losing the sink —
    never after: `_position` reads the current status, so a freeze taken afterwards would
    work the position out under the new state and store a standstill.
    """
    if _track is None:
        return
    status, _ = _status(at)
    _track.position_s = _position(_track, at, status)
    _track.position_at = at


def _end_preview(at: datetime) -> None:
    """The reel's song is over — picked and started, given up, switched off. The background
    track, frozen since the reel started, moves again from *now*: the `play()` rule."""
    global _preview
    _preview = None
    if _track is not None:
        _track.position_at = at


def _set_resume(value: datetime | None) -> None:
    global _resume_at
    _resume_at = value


def _set_retry(value: datetime | None) -> None:
    global _retry_at
    _retry_at = value


async def _start_next(session: AsyncSession, at: datetime) -> None:
    """Pick a song and put the music on it, at position 0."""
    global _track
    previous = _track.song_id if _track is not None else _last_song_id
    song = await _pick(session, previous)
    if song is None:
        _track = None
        _set_retry(at + EMPTY_RETRY)
        return
    # `_errors` is deliberately not cleared here: every failure advances to the next song,
    # so forgiving the run on each advance would keep the counter at one forever and a
    # library where nothing plays would spin at request speed. Playing is what forgives it.
    _track = _Track(
        id=secrets.token_urlsafe(8),
        song=read_song(song),
        song_id=song.id,
        started_at=at,
        position_s=0.0,
        position_at=at,
        duration_s=None,
    )


async def _pick(session: AsyncSession, previous: str | None) -> Song | None:
    """One song out of the configured pool, or None when there is nothing to play.

    Picked as a **guest**: `music.changed` goes out on the anonymous WebSocket, so a song a
    tag hides from guests must never end up in it.

    A pool that has gone empty — a playlist deleted, every wish granted — is answered with
    None and not with the whole library. Falling back is right for the selector's one-off
    button press and wrong for an evening: an hour of music out of the pool the host
    excluded is not a kindness.
    """
    try:
        scope = reel.parse_scope(_options.scope)
    except ValueError:
        logger.warning(
            "background music scope %r is not one Wingman knows; playing every song",
            _options.scope,
        )
        scope = "all"
    playlist_id = _options.playlist or None
    if scope == "playlist" and playlist_id is None:
        logger.info("background music is set to a playlist but none is chosen")
        return None
    exclude = frozenset() if previous is None else frozenset({previous})
    for attempt in range(PICK_ATTEMPTS):
        song = await reel.pick_song(
            session,
            scope,
            tags.GUEST_VIEWER,
            playlist_id=playlist_id,
            # A song with no audio file is one the host screen could only 404 on. Leaving
            # it out of the pool beats picking it and skipping it a moment later.
            require_audio=True,
            # The last attempt takes whatever comes: a pool of one song plays it again
            # rather than reporting itself empty.
            exclude=exclude if attempt < PICK_ATTEMPTS - 1 else frozenset(),
        )
        if song is not None:
            return song
        if not exclude:
            break
        # Nothing but the song that just played: stop excluding it and take it.
        exclude = frozenset()
    return None


# --- what people do ----------------------------------------------------------------------


async def play(session: AsyncSession) -> MusicRead:
    """Unpause, and cancel the wait after a song — play means now."""
    global _paused
    async with _lock:
        _require_playable()
        at = _now()
        if _paused and _track is not None:
            # The track froze at `pause`; it starts moving again from *now*, not from the
            # moment it froze. Without this the first read after unpausing would add the
            # whole silence to the position and the host would seek forward by it.
            _track.position_at = at
        _paused = False
        _set_resume(None)
        _set_retry(None)
        await _evaluate(session)
        if _track is None:
            raise EmptyPoolError
        return _read()


async def pause(session: AsyncSession) -> MusicRead:
    """Silence the room until somebody says otherwise.

    Works in every state, including during the wait after a song ("do not come back on"),
    and survives a sing: somebody who silenced the room on purpose should not find the
    music started itself again because a song finished. Idempotent, and never a refusal —
    there is no state in which "be quiet" is a thing to argue with.
    """
    global _paused
    async with _lock:
        # Freeze where it stands, so resuming does not jump — before the flag, not after.
        _freeze(_now())
        _paused = True
        await _evaluate(session)
        return _read()


async def skip(session: AsyncSession) -> MusicRead:
    """The next song, from the beginning. Keeps the paused state: a room that was silenced
    must not start playing again because somebody pressed Next."""
    async with _lock:
        _require_playable()
        _set_retry(None)
        _clear_track()
        await _evaluate(session)
        if _track is None:
            raise EmptyPoolError
        return _read()


def _require_playable() -> None:
    """The two reasons a control cannot do anything, said out loud rather than silently
    doing nothing: the phone has to be able to explain the press that went nowhere."""
    if not _options.enabled:
        raise MusicDisabledError
    if _sing_running or _usdx_open:
        raise MusicBlockedError


# --- the sink ----------------------------------------------------------------------------


async def register_sink(session: AsyncSession) -> tuple[str, int, MusicRead]:
    """Take the lease. The newest claim always wins.

    Unconditionally, because the alternative is worse: a host page that reloaded would
    otherwise have to wait out the whole timeout in silence. The tab that lost learns from
    the `sink_generation` in the next broadcast, and from a 409 on its next report.
    """
    global _sink, _sink_generation
    async with _lock:
        at = _now()
        _sink_generation += 1
        _sink = _Sink(id=secrets.token_urlsafe(16), generation=_sink_generation, last_seen_at=at)
        if _track is not None:
            # The track froze while nobody was listening; it starts moving again from where
            # it stopped, which is where the host is about to seek to.
            _track.position_at = at
        await _evaluate(session)
        return _sink.id, HEARTBEAT_INTERVAL_S, _read()


async def report_sink(
    session: AsyncSession,
    *,
    sink_id: str,
    track_id: str,
    event: str,
    position_s: float,
    duration_s: float | None = None,
    detail: str | None = None,
) -> tuple[MusicRead, bool]:
    """One report from the screen making the sound. Answers the state, and whether anything
    changed enough to be worth telling everybody about.

    A plain progress report is deliberately *not* a broadcast: phones work the position out
    themselves, and a WebSocket message per sink every five seconds is the busy-for-nothing
    that `devices.changed` already refuses. The one exception is the report that first
    carries the real duration, because that is what lets a progress bar exist at all.
    """
    global _errors
    async with _lock:
        if _sink is None or _sink.id != sink_id:
            raise NotTheSinkError
        at = _now()
        _sink.last_seen_at = at
        if _track is None or _track.id != track_id:
            # A report for a track that is no longer current: a retried `ended`, a report
            # that crossed a skip on the wire, a tab that woke up on a stale song. Ignored
            # on purpose — answering an error would only make the host retry it.
            return _read(at), False
        if event == "progress":
            _track.position_s = max(0.0, position_s)
            _track.position_at = at
            # Before the payload is built, and not inside the same tuple: the one report
            # worth broadcasting is the one that first carries a length, and evaluated the
            # other way round it would announce the null it has just replaced.
            learned = _learn_duration(duration_s)
            # It is really playing, so whatever would not play before is forgiven.
            _errors = 0
            return _read(at), learned
        if event == "error":
            logger.warning(
                "the host screen could not play %s (%s)", _track.song_id, detail or "no detail"
            )
            _errors += 1
            if _errors >= MAX_ERRORS:
                logger.warning(
                    "%d songs in a row would not play; the background music is standing down",
                    _errors,
                )
                _clear_track()
                _set_retry(at + ERROR_BACKOFF)
                _errors = 0
                return _read(at), True
        elif event == "ended":
            # It played all the way through, so the run of failures is over.
            _errors = 0
        # `ended`, or an error under the limit: on to the next song either way.
        _clear_track()
        await _evaluate(session)
        return _read(at), True


def _learn_duration(duration_s: float | None) -> bool:
    """Take the file's real length from the host. True when this is the first time, which
    is the one progress report worth broadcasting."""
    if _track is None or duration_s is None or duration_s <= 0:
        return False
    first = _track.duration_s is None
    _track.duration_s = duration_s
    return first


async def release_sink(sink_id: str) -> bool:
    """Give the lease back — the host page is closing. True when it was actually held.

    A stale id is not an error: the tab is going away, and telling it off helps nobody.
    """
    global _sink
    async with _lock:
        if _sink is None or _sink.id != sink_id:
            return False
        _freeze(_now())
        _sink = None
        return True


# --- settings ----------------------------------------------------------------------------


async def apply_settings(session: AsyncSession) -> MusicRead:
    """Read both caches again and settle the state. Called by every route that writes one
    of the settings, so a change reaches the room now rather than at the next restart."""
    async with _lock:
        await _load_caches(session)
        await _evaluate(session)
        return _read()


async def _load_caches(session: AsyncSession) -> None:
    global _options, _volumes
    values = await music_settings.read_all(session)
    _options = _Options(
        enabled=bool(values[music_settings.ENABLED]),
        scope=str(values[music_settings.SCOPE]),
        playlist=str(values[music_settings.PLAYLIST]),
        resume_delay_s=int(values[music_settings.RESUME_DELAY]),
        preview_on_spin=bool(values[music_settings.PREVIEW_ON_SPIN]),
    )
    volumes = await SettingsService(session).all()
    _volumes = _Volumes(
        master=_percent(volumes.get(MASTER_VOLUME), DEFAULT_VOLUMES.master),
        music=_percent(volumes.get(MUSIC_VOLUME), DEFAULT_VOLUMES.music),
        effects=_percent(volumes.get(EFFECTS_VOLUME), DEFAULT_VOLUMES.effects),
    )


def _percent(value: SettingValue | None, fallback: int) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else fallback


# --- the hook `karaoke.selection` calls ---------------------------------------------------


async def selection_changed(spin: SpinPreview | None) -> None:
    """The room's selection changed. Called on every broadcast of it, with the reel's song
    while the selection was spun and None otherwise; never raises, the karaoke hooks' rule.

    Sets the preview when a reel is running or has landed — and the host wants it, and the
    speakers are free, and there is a file to play — freezing the background music first,
    so it comes back where it stopped. Ends it when the selection is gone or was never spun.
    A respin, or a press landing the reel early, is a new key or a new landing, and the
    payload follows; the same spin reported again (a slot moved) changes nothing.
    """
    global _preview
    try:
        async with _lock:
            before = _read()
            at = _now()
            wanted = (
                spin is not None
                and spin.has_audio
                and _options.preview_on_spin
                and not (_sing_running or _usdx_open)
            )
            if not wanted:
                if _preview is not None:
                    _end_preview(at)
            else:
                assert spin is not None
                if _preview is None:
                    # Before the flag, not after: the freeze reads the live position.
                    _freeze(at)
                _preview = _Preview(
                    key=spin.key,
                    song=spin.song,
                    start_s=spin.start_s or 0.0,
                    reveal_at=spin.reveal_at,
                )
            after = _read()
            changed = _changed(before, after)
        if changed:
            await event_bus.broadcast(MusicChanged(music=after))
    except Exception:
        logger.exception("the background music could not follow the player selection")


# --- the hooks `karaoke.service` calls ----------------------------------------------------
#
# No arguments, no database, and none of them may raise: two of the four run on the
# launcher's exit path, where an exception would swallow the end of a song — the reason
# `_award_achievements` gives for its own guard. One guard here beats four in `karaoke`.


async def sing_started() -> None:
    """Ultrastar Deluxe is about to sing. The room goes quiet at once."""
    await _set_usdx(sing=True)


async def sing_ended() -> None:
    """The song is over. The music comes back after the configured pause, on a *new* song
    from the beginning — never the one the singing interrupted."""
    await _set_usdx(sing=False)


async def usdx_opened() -> None:
    """Ultrastar Deluxe was opened for its own menus, which make their own noise."""
    await _set_usdx(standalone=True)


async def usdx_closed() -> None:
    await _set_usdx(standalone=False)


async def _set_usdx(*, sing: bool | None = None, standalone: bool | None = None) -> None:
    global _sing_running, _usdx_open
    try:
        async with _lock:
            was_busy = _sing_running or _usdx_open
            if sing is not None:
                _sing_running = sing
            if standalone is not None:
                _usdx_open = standalone
            busy = _sing_running or _usdx_open
            if busy == was_busy:
                return
            before = _read()
            if busy:
                _set_resume(None)
                # Ultrastar Deluxe has the speakers: the reel's song goes with the track.
                if _preview is not None:
                    _end_preview(_now())
            else:
                _set_resume(_now() + timedelta(seconds=_options.resume_delay_s))
            # No session here: the hooks run on paths that hold none. `_evaluate` drops the
            # track and the next tick picks the new one, at most a second later.
            await _evaluate(None)
            after = _read()
            changed = _changed(before, after)
        # Only when something a client would draw actually moved. With the music switched
        # off — which is the default — a sing changes nothing here, and every phone in the
        # room being told twice per song that nothing happened is the busy TV `devices`
        # refuses to be.
        if changed:
            await event_bus.broadcast(MusicChanged(music=after))
    except Exception:
        logger.exception("the background music could not follow Ultrastar Deluxe")


# --- the tick ----------------------------------------------------------------------------


async def tick(session_factory: async_sessionmaker[AsyncSession]) -> None:
    """One pass: a sink that went quiet, a wait that came due, an empty pool worth asking
    about again, and a song to pick when there is none.

    The whole pass is under the lock, the pick included. It is two cheap queries, and a
    control call that waits for it is a whole class of double-pick race that cannot happen.
    """
    global _sink
    async with session_factory() as session:
        async with _lock:
            before = _read()
            at = _now()
            if _sink is not None and not _sink_online(at):
                logger.info("the host screen stopped reporting; the music has no speakers")
                # At the moment it was last heard from, not now: the seconds since are
                # seconds nobody was listening to.
                _freeze(_sink.last_seen_at)
                _sink = None
            await _evaluate(session)
            after = _read()
        if _changed(before, after):
            await event_bus.broadcast(MusicChanged(music=after))


def _changed(before: MusicRead, after: MusicRead) -> bool:
    """Whether a pass changed something worth a broadcast.

    The positions are left out on purpose: they move on their own between two reads, and a
    message per second saying so is exactly what `devices.changed` refuses to send.
    """
    bare = {"track": None, "resume_at": None, "retry_at": None}
    if before.model_copy(update=bare) != after.model_copy(update=bare):
        return True
    if (before.track is None) != (after.track is None):
        return True
    if (
        before.track is not None
        and after.track is not None
        and (before.track.id, before.track.duration_s) != (after.track.id, after.track.duration_s)
    ):
        return True
    return (before.resume_at, before.retry_at) != (after.resume_at, after.retry_at)


async def start_watchdog(session_factory: async_sessionmaker[AsyncSession]) -> None:
    """Start the tick. Started by the app lifespan, like the devices watchdog.

    It loads the settings and stops there: picking a song is the first tick's job a second
    later, so startup is not held up for a query nobody is waiting on.
    """
    global _watchdog
    async with session_factory() as session, _lock:
        await _load_caches(session)
    if _watchdog is not None:
        return
    _watchdog = asyncio.create_task(_watchdog_loop(session_factory), name="music-watchdog")


async def stop_watchdog() -> None:
    """Stop the tick and forget everything. Called before `karaoke.shutdown()`, which kills
    the running song and would otherwise fire `sing_ended` into closing sockets."""
    global _watchdog, _track, _last_song_id, _sink, _paused, _sing_running, _usdx_open, _options
    global _preview
    task, _watchdog = _watchdog, None
    _track = None
    _last_song_id = None
    _preview = None
    _sink = None
    # The options go too, which is what makes the four hooks inert afterwards: they read
    # this cache, and one that still said "enabled" would have a song finishing during
    # shutdown broadcast into sockets that are closing.
    _options = DEFAULT_OPTIONS
    _paused = False
    _sing_running = False
    _usdx_open = False
    _set_resume(None)
    _set_retry(None)
    if task is None:
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


async def _watchdog_loop(session_factory: async_sessionmaker[AsyncSession]) -> None:
    while True:
        await asyncio.sleep(TICK_S)
        try:
            await tick(session_factory)
        except Exception:
            # Nobody is waiting on this task and it must outlive one bad pass: a tick that
            # died at the first exception is a room that never gets its music back.
            logger.exception("the background music failed a pass")


async def broadcast(payload: MusicRead) -> None:
    """Tell every client. Called by the routes, outside the lock."""
    await event_bus.broadcast(MusicChanged(music=payload))


__all__ = [
    "EmptyPoolError",
    "MusicBlockedError",
    "MusicDisabledError",
    "NotTheSinkError",
    "SpinPreview",
    "apply_settings",
    "broadcast",
    "pause",
    "play",
    "read",
    "read_settings",
    "register_sink",
    "release_sink",
    "report_sink",
    "selection_changed",
    "sing_ended",
    "sing_started",
    "skip",
    "start_watchdog",
    "stop_watchdog",
    "tick",
    "usdx_closed",
    "usdx_opened",
]
