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

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..events import KaraokeEnded, KaraokeStarted, ScoresRecorded, event_bus
from ..players.model import Player
from ..players.schema import read_player
from ..songs.model import Song
from ..songs.schema import read_song
from . import usdx_scores
from .colors import color_index
from .launcher import KaraokeLauncher, LaunchSlot
from .model import Score, Sing
from .schema import CurrentSing, ScoreRead, SlotRead, read_score
from .usdx import UsdxLauncher
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


class AlreadyPlayingError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("a song is already playing")


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
# The `finished` event of the most recent sing, kept after it ended so waiting for the end
# of a song that is already over does not hang.
_last_finished: asyncio.Event | None = None
_lock = asyncio.Lock()


def current_sing() -> CurrentSing | None:
    return None if _running is None else _running.sing


async def start_sing(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    song_id: str,
    slots: list[SlotRequest],
    force: bool = False,
) -> CurrentSing:
    """Launch `song_id` for `slots`. Raises `AlreadyPlayingError` unless `force`,
    `UnknownSongError` / `UnknownPlayerError`, `UnknownColorError`, `NoPlayersError`
    or `UsdxPathsError`."""
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

        if _running is not None:
            if not force:
                raise AlreadyPlayingError
            # Finish the old run completely (scores imported, `karaoke.ended` sent) before
            # the new one exists, so its exit handler cannot clobber the new state.
            await _stop_and_wait(_running)

        paths = await resolve_usdx_paths(session)
        snapshot = await usdx_scores.latest_date(paths.ultrastar_db)

        sing = Sing(song_id=song.id)
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
            await session.commit()
            # Same shape as a misconfigured path: the user has to fix a setting.
            raise UsdxPathsError([f"cannot start '{paths.executable}': {error}"]) from error

        _running = running
        _last_finished = running.finished
        await event_bus.broadcast(KaraokeStarted(sing=running.sing))
        return running.sing


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
    is still there. The alternative — leaving USDX running — loses the scores."""
    global _last_finished
    await stop_sing()
    _last_finished = None


async def _stop_and_wait(running: _Running) -> None:
    await running.launcher.stop()
    # The launcher's monitor task fires `_finish`, which sets the event.
    await running.finished.wait()


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
    new_scores = await usdx_scores.scores_since(running.ultrastar_db, running.score_snapshot)
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
