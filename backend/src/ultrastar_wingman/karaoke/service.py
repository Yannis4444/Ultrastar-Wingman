"""The sing flow: start a song, remember what is running, import what it scored.

The whole point of doing it here instead of reading USDX's database later: Wingman
picked the song and wrote the player names into USDX's config, so a score row that
appears after launch can be attributed without guessing. Knows nothing about
FastAPI — the API layer translates these exceptions into status codes.
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..auth.model import as_utc
from ..events import KaraokeEnded, KaraokeStarted, ScoresRecorded, event_bus
from ..library import service as library
from ..players.model import Player
from ..players.schema import read_player
from ..settings import SettingsService
from ..songs.model import Song
from ..songs.schema import read_song
from . import usdx_scores
from .colors import color_index
from .launcher import KaraokeLauncher, LaunchSlot
from .model import SESSION_GAP, KaraokeSession, Score, Sing
from .schema import CurrentSing, ScoreRead, SlotRead, read_score
from .slots import parse_slot_colors
from .usdx import EMPTY_SLOT_NAME, UsdxLauncher
from .usdx_paths import UsdxPathsError, resolve_usdx_paths

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SlotRequest:
    """A requested singing position: a color from `colors.COLORS` and who sings on it."""

    color: str
    player_id: str | None


class UnknownSongError(LookupError):
    def __init__(self, song_id: str) -> None:
        super().__init__(f"unknown song '{song_id}'")
        self.song_id = song_id


class UnknownPlayerError(LookupError):
    def __init__(self, player_id: str) -> None:
        super().__init__(f"unknown player '{player_id}'")
        self.player_id = player_id


class NoPlayersError(ValueError):
    def __init__(self) -> None:
        super().__init__("at least one slot needs a player")


class UnconfiguredColorError(ValueError):
    """A singer was put on a color that is not one of the configured slots — a client
    working from a color list the host has since changed."""

    def __init__(self, color: str) -> None:
        super().__init__(
            f"'{color}' is not one of the configured player slots — reopen the player selection"
        )
        self.color = color


class DuplicateColorError(ValueError):
    """The same slot twice, with somebody on it: which singer is which cannot be told
    apart, on the TV no more than in the scores."""

    def __init__(self, color: str) -> None:
        super().__init__(f"'{color}' was picked twice — every singer needs a color of their own")
        self.color = color


class AlreadyPlayingError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("a song is already playing")


@dataclass
class _Standalone:
    """USDX started from the settings, with no song: the host is in its menus."""

    launcher: KaraokeLauncher
    exited: asyncio.Event


@dataclass
class _Running:
    """Everything the exit handler needs, captured at launch time."""

    sing: CurrentSing
    launcher: KaraokeLauncher
    ultrastar_db: Path
    # Newest score timestamp in USDX's database before launch: anything newer is this run.
    score_snapshot: int
    # Casefolded player name (as written into USDX's config) -> Wingman player id.
    player_ids_by_name: dict[str, str]
    finished: asyncio.Event


# Module state on purpose: there is exactly one USDX and one song playing on this machine.
_running: _Running | None = None
# USDX opened for its own settings, if any. Never at the same time as `_running`.
_standalone: _Standalone | None = None
# The `finished` event of the most recent sing, kept after it ended so waiting for the end
# of a song that is already over does not hang.
_last_finished: asyncio.Event | None = None
_lock = asyncio.Lock()


def current_sing() -> CurrentSing | None:
    return None if _running is None else _running.sing


async def slot_colors(session: AsyncSession) -> list[str]:
    """The configured singing slots, in order — the source of truth for how many people
    sing at once and in which colors. Stored as one setting, validated on the way in, so
    this can only ever be a list USDX understands."""
    return parse_slot_colors(str(await SettingsService(session).get("karaoke.player_colors")))


async def start_sing(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    song_id: str,
    slots: list[SlotRequest],
    force: bool = False,
) -> CurrentSing:
    """Launch `song_id` for `slots`. Raises `AlreadyPlayingError` unless `force`,
    `UnknownSongError` / `UnknownPlayerError`, `UnknownColorError`,
    `UnconfiguredColorError`, `DuplicateColorError`, `NoPlayersError` or
    `UsdxPathsError`."""
    global _running, _last_finished
    async with _lock:
        song = await session.get(Song, song_id)
        if song is None:
            raise UnknownSongError(song_id)
        resolved = await _resolve_players(session, slots)
        if all(player is None for _, player in resolved):
            raise NoPlayersError
        # Fails before anything is started or killed if a color name is bogus.
        for slot in slots:
            color_index(slot.color)
        # The host's slot configuration is what USDX gets, whatever the client sent.
        resolved = _for_configured_slots(resolved, await slot_colors(session))

        if _running is not None:
            if not force:
                raise AlreadyPlayingError
            # Finish the old run completely (scores imported, `karaoke.ended` sent) before
            # the new one exists, so its exit handler cannot clobber the new state.
            await _stop_and_wait(_running)
        if _standalone is not None and _standalone.launcher.is_running:
            # USDX in its own menus is in the way exactly like a running song: one process
            # at a time, and this sing is about to rewrite the config file it has open. Same
            # error, so the phone that asked gets the same "replace it?" it knows.
            if not force:
                raise AlreadyPlayingError
            await _close_standalone(_standalone)

        paths = await resolve_usdx_paths(session)
        snapshot = await usdx_scores.latest_date(paths.ultrastar_db)

        started_at = datetime.now(UTC)
        karaoke_session = await attach_to_session(session, started_at)
        sing = Sing(song_id=song.id, session_id=karaoke_session.id, started_at=started_at)
        session.add(sing)
        await session.commit()

        launcher = UsdxLauncher(paths)
        running = _Running(
            sing=CurrentSing(
                sing_id=sing.id,
                song=read_song(song),
                started_at=sing.started_at,
                slots=[
                    SlotRead(
                        color=slot.color, player=None if player is None else read_player(player)
                    )
                    for slot, player in resolved
                ],
            ),
            launcher=launcher,
            ultrastar_db=paths.ultrastar_db,
            score_snapshot=snapshot,
            player_ids_by_name={
                player.name.casefold(): player.id for _, player in resolved if player is not None
            },
            finished=asyncio.Event(),
        )
        launcher.on_exit = lambda: _finish(running, session_factory)

        try:
            await launcher.start(
                Path(song.directory),
                [
                    LaunchSlot(
                        color=slot.color,
                        player_name=None if player is None else player.name,
                        avatar_file=None if player is None else _avatar(player),
                    )
                    for slot, player in resolved
                ],
            )
        except OSError as error:
            await session.delete(sing)
            # A session opened for a song that never started would show up empty in the
            # statistics. One that was reused still has its earlier sings, so it stays.
            if not await _session_has_sings(session, karaoke_session.id):
                await session.delete(karaoke_session)
            await session.commit()
            # Same shape as a misconfigured path: the user has to fix a setting.
            raise UsdxPathsError([f"cannot start '{paths.executable}': {error}"]) from error

        _running = running
        _last_finished = running.finished
        await event_bus.broadcast(KaraokeStarted(sing=running.sing))
        await _clear_wishes(session, song.id, resolved)
        return running.sing


async def open_usdx(session: AsyncSession) -> bool:
    """Start USDX on its own so the host can change what only USDX itself can change — the
    microphones above all.

    `True` when this call started it, `False` when it was already up (asking twice is not a
    mistake). Raises `AlreadyPlayingError` while a song is playing — that USDX is busy — and
    `UsdxPathsError` when USDX is not configured or refuses to start.
    """
    global _standalone
    async with _lock:
        if _running is not None:
            raise AlreadyPlayingError
        if _standalone is not None and _standalone.launcher.is_running:
            return False
        paths = await resolve_usdx_paths(session)
        launcher = UsdxLauncher(paths)
        standalone = _Standalone(launcher=launcher, exited=asyncio.Event())
        launcher.on_exit = lambda: _standalone_exited(standalone)
        try:
            await launcher.start_standalone()
        except OSError as error:
            # Same shape as a misconfigured path: the user has to fix a setting.
            raise UsdxPathsError([f"cannot start '{paths.executable}': {error}"]) from error
        _standalone = standalone
        return True


def usdx_is_open() -> bool:
    """Whether USDX is standing in its own menus, started by `open_usdx`."""
    return _standalone is not None and _standalone.launcher.is_running


async def _standalone_exited(standalone: _Standalone) -> None:
    """The launcher's monitor task, once the host closed USDX again. Takes no lock on
    purpose: a forced sing waits for this event while holding `_lock`."""
    global _standalone
    if _standalone is standalone:
        _standalone = None
    standalone.exited.set()


async def _close_standalone(standalone: _Standalone) -> None:
    """Kill the settings USDX and wait for it to be gone — starting the next one while the
    old process is still on screen is how two USDX windows happen."""
    await standalone.launcher.stop()
    await standalone.exited.wait()


async def stop_sing() -> None:
    """Kill the running song and wait for its scores to be imported. Idempotent."""
    async with _lock:
        if _running is not None:
            await _stop_and_wait(_running)


async def wait_for_sing_end() -> None:
    """Wait until the last started song ended and its scores were imported (returns at
    once when it already did). Used by the tests, and by nothing else — the API reports
    the end through the `karaoke.ended` event."""
    if _last_finished is not None:
        await _last_finished.wait()


async def shutdown() -> None:
    """Wingman is going down: kill the song and let the import finish while the database
    is still there. The alternative — leaving USDX running — loses the scores. A settings
    USDX goes too: an orphan of a process we started would still hold the config file, and
    the next start would know nothing about it."""
    global _last_finished, _standalone
    await stop_sing()
    async with _lock:
        if _standalone is not None:
            await _close_standalone(_standalone)
        _standalone = None
    _last_finished = None


async def _stop_and_wait(running: _Running) -> None:
    await running.launcher.stop()
    # The launcher's monitor task fires `_finish`, which sets the event.
    await running.finished.wait()


async def attach_to_session(session: AsyncSession, started_at: datetime) -> KaraokeSession:
    """The session a sing starting at `started_at` belongs to, created if there is none.

    The newest session is reused while it has been idle for less than `SESSION_GAP` —
    "the party is still going". Public so the statistics tests can drive it without USDX.
    Does not commit: the caller writes the sing in the same transaction.
    """
    newest = await session.scalar(
        select(KaraokeSession).order_by(KaraokeSession.last_activity_at.desc()).limit(1)
    )
    if newest is not None and started_at - as_utc(newest.last_activity_at) < SESSION_GAP:
        newest.last_activity_at = started_at
        return newest
    opened = KaraokeSession(started_at=started_at, last_activity_at=started_at)
    session.add(opened)
    # Flushed, not committed: the caller needs the generated id for the sing it is about
    # to write in the same transaction.
    await session.flush()
    logger.info("opened karaoke session %s", opened.id)
    return opened


async def _session_has_sings(session: AsyncSession, session_id: str) -> bool:
    count = await session.scalar(
        select(func.count()).select_from(Sing).where(Sing.session_id == session_id)
    )
    return bool(count)


async def _resolve_players(
    session: AsyncSession, slots: list[SlotRequest]
) -> list[tuple[SlotRequest, Player | None]]:
    """Slots paired with their player, in order. A list, not a dict: two slots may well
    be identical (same color, nobody on them)."""
    resolved: list[tuple[SlotRequest, Player | None]] = []
    for slot in slots:
        player = None
        if slot.player_id is not None:
            player = await session.get(Player, slot.player_id)
            if player is None:
                raise UnknownPlayerError(slot.player_id)
        resolved.append((slot, player))
    return resolved


def _for_configured_slots(
    resolved: list[tuple[SlotRequest, Player | None]], configured: list[str]
) -> list[tuple[SlotRequest, Player | None]]:
    """The requested slots reduced to the ones the host configured, in the order they
    were requested.

    A singer on a color that is not a slot means a client working from an old list, and
    is refused. An empty one is dropped instead: nobody is on it, and passing it on would
    make USDX play with more players than the host has microphones for.
    """
    kept: list[tuple[SlotRequest, Player | None]] = []
    seen: set[str] = set()
    for slot, player in resolved:
        if slot.color not in configured:
            if player is not None:
                raise UnconfiguredColorError(slot.color)
            continue
        if slot.color in seen:
            if player is not None:
                raise DuplicateColorError(slot.color)
            continue
        seen.add(slot.color)
        kept.append((slot, player))
    return kept


async def _clear_wishes(
    session: AsyncSession, song_id: str, resolved: list[tuple[SlotRequest, Player | None]]
) -> None:
    """The song is on, so nobody has to wish for it any more — see
    `library.service.clear_fulfilled_wishes` for whose wishes that is.

    Called after the launch succeeded, and swallowing everything: USDX is already playing,
    and a failure in here must not turn a started song into an error for the caller.
    """
    user_ids = {
        player.user_id
        for _, player in resolved
        if player is not None and player.user_id is not None
    }
    try:
        await library.clear_fulfilled_wishes(session, song_id, user_ids)
    except Exception:
        logger.exception("clearing the wishes for song %s failed", song_id)


def _avatar(player: Player) -> Path | None:
    return None if player.avatar_file is None else Path(player.avatar_file)


async def _finish(running: _Running, session_factory: async_sessionmaker[AsyncSession]) -> None:
    """Called by the launcher once USDX exited."""
    global _running
    scores: list[ScoreRead] = []
    try:
        scores = await _import_scores(running, session_factory)
    except Exception:
        # A failed import must not swallow the end of the song: the UI would hang forever.
        logger.exception("importing the scores of sing %s failed", running.sing.sing_id)
    finally:
        if _running is running:
            _running = None
        await event_bus.broadcast(
            KaraokeEnded(sing_id=running.sing.sing_id, song_id=running.sing.song.id)
        )
        if scores:
            await event_bus.broadcast(ScoresRecorded(sing_id=running.sing.sing_id, scores=scores))
        running.finished.set()


async def _import_scores(
    running: _Running, session_factory: async_sessionmaker[AsyncSession]
) -> list[ScoreRead]:
    new_scores = [
        score
        for score in await usdx_scores.scores_since(running.ultrastar_db, running.score_snapshot)
        # An empty slot is a player called "-" to USDX, and it scores like everybody else.
        # Kept only when somebody of that name really sang, which nobody ever is.
        if score.player_name != EMPTY_SLOT_NAME
        or EMPTY_SLOT_NAME.casefold() in running.player_ids_by_name
    ]
    async with session_factory() as session:
        sing = await session.get(Sing, running.sing.sing_id)
        if sing is not None:
            sing.ended_at = datetime.now(UTC)
        rows = [
            Score(
                sing_id=running.sing.sing_id,
                # Wingman wrote these names into USDX's config, so a match is the player
                # who sang; anything else (a name typed inside USDX) keeps the name only.
                player_id=running.player_ids_by_name.get(score.player_name.casefold()),
                player_name=score.player_name,
                score=score.score,
                difficulty=score.difficulty,
                recorded_at=datetime.fromtimestamp(score.date, UTC),
            )
            for score in new_scores
        ]
        session.add_all(rows)
        await session.commit()
        logger.info("imported %d score(s) for sing %s", len(rows), running.sing.sing_id)
        return [read_score(row) for row in rows]
