"""The catalogue, and recomputing achievements from the scores. Knows nothing about FastAPI.

Every rule lives in `evaluate.py`; this module reads the rows the engine needs, writes the
`player_achievements` its answer implies, and owns the handful of writes the catalogue itself
takes (a new achievement, an edited one, an uploaded icon). Each of those broadcasts
`achievements.changed` — a client holding the catalogue open would otherwise draw an edited
badge until it happened to refetch.

The global toggle is consulted **here**, inside the pass, and not at the four call sites: a
trigger that forgot to ask would keep writing rows nobody draws, and there are four of them.
Switched off, a pass returns without touching a row — the earned ones are kept, so switching
back on is the full pass that brings them up to date rather than an evening erased.
"""

import asyncio
import contextlib
import logging
import uuid
from collections.abc import Collection, Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..events import AchievementsChanged, event_bus
from ..images import remove_images, store_image, validate_image
from ..karaoke.model import Score, Sing
from ..players.model import Player
from ..players.schema import read_player
from ..songs.model import Song
from . import settings as achievement_settings
from .evaluate import NOT_EARNED, ScoreRow, evaluate
from .model import Achievement, PlayerAchievement
from .schema import Condition, EarnedByPlayer, parse_definition, read_achievement

logger = logging.getLogger(__name__)

MANAGE_CAPABILITY = "achievements.manage"

# One pass at a time, for the whole process. Two passes over the same player race on the
# first insert — a finishing sing and a `stats.moderate` correction can both find no row and
# both add the same composite primary key, and the second one raises. One process, one lock,
# and it stops two passes redoing each other's work as well.
_write_lock = asyncio.Lock()

# The full passes a catalogue write kicked off. Tracked rather than fired and forgotten
# (architecture.md): a failure is logged, and shutdown cancels what is still running before
# the engine goes.
_passes: set[asyncio.Task[dict[str, list[str]]]] = set()


# The sentinel for "the PATCH did not name this field", the same shape `tags.service` uses:
# `None` is a real value for `icon`, so leaving a field out and clearing it cannot be the
# same thing.
class _Unset:
    pass


UNSET = _Unset()


class BuiltInAchievementError(ValueError):
    """A built-in cannot be deleted. It may be edited and switched off like any other — but
    an instance always has the set the import format's stable slug ids name."""

    def __init__(self, achievement_id: str) -> None:
        super().__init__(f"'{achievement_id}' is one of the built-in achievements")
        self.achievement_id = achievement_id


async def load_rows(session: AsyncSession, player_id: str) -> list[ScoreRow]:
    """Every score of one player, with its sing and the song that sing was on.

    One query and not one per score: the engine needs the whole set at once, and a party's
    worth of scores is a few hundred rows. The join to `songs` is an outer one — a score
    outlives the song it was sung on, and a condition that filters by nothing still counts
    it.
    """
    rows = await session.execute(
        select(
            Score.score,
            Sing.id,
            Sing.session_id,
            Sing.song_id,
            Song.title,
            Song.artist,
            Song.genre,
            Song.language,
            Song.edition,
            Song.year,
            Song.is_duet,
            Song.video_file,
        )
        .join(Sing, Sing.id == Score.sing_id)
        .outerjoin(Song, Song.id == Sing.song_id)
        .where(Score.player_id == player_id)
        # Chronological, id breaking ties: which party earned a session-scoped achievement
        # is the first one in this order that satisfies it, so the order has to be stable.
        .order_by(Score.recorded_at, Score.id)
    )
    return [
        ScoreRow(
            score=score,
            sing_id=sing_id,
            session_id=session_id,
            song_id=song_id,
            title=title,
            artist=artist,
            genre=genre,
            language=language,
            edition=edition,
            year=year,
            is_duet=is_duet,
            # File paths stay server-side, exactly like `songs.schema.read_song`. A song that
            # is gone says nothing about video rather than "no video".
            has_video=None if title is None else video_file is not None,
        )
        for (
            score,
            sing_id,
            session_id,
            song_id,
            title,
            artist,
            genre,
            language,
            edition,
            year,
            is_duet,
            video_file,
        ) in rows
    ]


async def evaluate_player(
    session: AsyncSession, player_id: str, now: datetime | None = None
) -> list[str]:
    """Recompute every enabled achievement for one player, and answer with the ids this pass
    newly earned — the ones that had no `earned_at` before and have one now."""
    return (await evaluate_players(session, [player_id], now)).get(player_id, [])


async def evaluate_players(
    session: AsyncSession, player_ids: Collection[str], now: datetime | None = None
) -> dict[str, list[str]]:
    """The same for several players at once, newly earned ids per player.

    Per player rather than one big query: the engine works on one player's scores, and a
    handful of players is a handful of queries. The achievements themselves are read once.

    Nothing at all while `achievements.enabled` is off, the existing rows included: they are
    kept, and switching the feature back on runs the full pass that corrects them.
    """
    if not await achievement_settings.enabled(session):
        return {}
    async with _write_lock:
        achievements = await _enabled(session)
        moment = now or datetime.now(UTC)
        # `fromkeys` rather than a set: the same player named twice is one pass, and the
        # order callers pass them in is the order they get back.
        earned = {
            player_id: await _write(session, player_id, achievements, moment)
            for player_id in dict.fromkeys(player_ids)
        }
        await session.commit()
        return earned


async def evaluate_all(session: AsyncSession, now: datetime | None = None) -> dict[str, list[str]]:
    """Recompute for every player that has at least one score — the background pass behind
    an edited definition or a flipped toggle.

    A player with no scores is deliberately not in the list: they hold no rows, and the pass
    that took their last score away is the one that deleted them.
    """
    if not await achievement_settings.enabled(session):
        return {}
    player_ids = await session.scalars(
        select(Score.player_id).where(Score.player_id.is_not(None)).distinct()
    )
    return await evaluate_players(
        session, [player_id for player_id in player_ids if player_id is not None], now
    )


async def _enabled(session: AsyncSession) -> list[Achievement]:
    """The achievements a pass looks at. The id breaks ties so two achievements sorted the
    same keep a stable order between runs."""
    rows = await session.scalars(
        select(Achievement)
        .where(Achievement.enabled.is_(True))
        .order_by(Achievement.sort_order, Achievement.id)
    )
    return list(rows)


async def _write(
    session: AsyncSession,
    player_id: str,
    achievements: list[Achievement],
    now: datetime,
) -> list[str]:
    """One player's pass, without the commit. Returns what this pass newly earned."""
    existing = {
        row.achievement_id: row
        for row in await session.scalars(
            select(PlayerAchievement).where(PlayerAchievement.player_id == player_id)
        )
    }
    rows = await load_rows(session, player_id)
    if not rows:
        # A player who never sang — or whose last score was just deleted — carries no rows at
        # all, rather than one empty row per achievement.
        for stale in existing.values():
            await session.delete(stale)
        return []

    newly_earned: list[str] = []
    for achievement in achievements:
        conditions = parse_definition(achievement.id, achievement.definition)
        outcome = NOT_EARNED if conditions is None else evaluate(conditions, rows)
        row = existing.pop(achievement.id, None)
        if row is None:
            row = PlayerAchievement(achievement_id=achievement.id, player_id=player_id)
            session.add(row)
        if not outcome.earned:
            # Recomputation is the truth: one whose conditions stopped holding is revoked,
            # which is the only way a mis-attributed score can be fully corrected.
            row.earned_at = None
        elif row.earned_at is None:
            # Earned again after a revocation is stamped fresh, deliberately: the moment an
            # achievement was first earned is not derivable from the scores, so a date that
            # survived its own revocation would be a claim the data cannot back.
            row.earned_at = now
            newly_earned.append(achievement.id)
        # Held without interruption since: the stamp is left alone, so a badge does not
        # change its date on every pass.
        row.session_id = outcome.session_id
        row.progress_current = outcome.progress_current
        row.progress_target = outcome.progress_target

    # Whatever is left named an achievement that is disabled or gone. Dropping the row is
    # what makes switching one back on a recomputation rather than a stale badge.
    for stale in existing.values():
        await session.delete(stale)
    return newly_earned


async def list_achievements(session: AsyncSession) -> list[Achievement]:
    """Every achievement, disabled ones included — the catalogue is what a manager edits and
    what everybody else draws its locked slots from.

    `created_at` breaks a tie in `sort_order`, so two rows sorted the same keep the order
    they were made in instead of shuffling between requests.
    """
    rows = await session.scalars(
        select(Achievement).order_by(Achievement.sort_order, Achievement.created_at)
    )
    return list(rows)


async def by_ids(session: AsyncSession, achievement_ids: Iterable[str]) -> list[Achievement]:
    """The named achievements, in catalogue order — what an `achievements.earned` payload is
    built from."""
    wanted = list(achievement_ids)
    if not wanted:
        return []
    rows = await session.scalars(
        select(Achievement)
        .where(Achievement.id.in_(wanted))
        .order_by(Achievement.sort_order, Achievement.created_at)
    )
    return list(rows)


async def earned_ids(session: AsyncSession, player_id: str | None) -> frozenset[str]:
    """What one player has actually earned — the set the hidden masking is decided against.

    A caller with no player of their own has earned nothing, which is what `None` answers:
    the host screen is an administrator but nobody, and a guest phone has no identity at all.
    """
    if player_id is None:
        return frozenset()
    rows = await session.scalars(
        select(PlayerAchievement.achievement_id).where(
            PlayerAchievement.player_id == player_id,
            PlayerAchievement.earned_at.is_not(None),
        )
    )
    return frozenset(rows)


async def earned_by_anybody(session: AsyncSession, achievement_id: str) -> bool:
    """Whether one achievement has been earned at all, by anyone.

    What decides whether a hidden achievement's uploaded picture may be served. Not "has the
    caller earned it": the moment somebody earns one it is announced to every socket with its
    name and its glyph, and a phone drawing another player's badges is meant to see it too.
    Until then the picture is as much of the surprise as the name is.
    """
    found = await session.scalar(
        select(PlayerAchievement.player_id)
        .where(
            PlayerAchievement.achievement_id == achievement_id,
            PlayerAchievement.earned_at.is_not(None),
        )
        .limit(1)
    )
    return found is not None


async def rows_of_player(
    session: AsyncSession, player_id: str
) -> list[tuple[PlayerAchievement, Achievement]]:
    """One player's record: every row they hold, with the achievement it is about.

    An inner join, so a row left behind by an achievement that is gone is simply not in the
    answer — the same way every other listing in the app skips an orphan.
    """
    rows = await session.execute(
        select(PlayerAchievement, Achievement)
        .join(Achievement, Achievement.id == PlayerAchievement.achievement_id)
        .where(PlayerAchievement.player_id == player_id)
        .order_by(Achievement.sort_order, Achievement.created_at)
    )
    return [(row, achievement) for row, achievement in rows]


async def earned_by_players(
    session: AsyncSession, earned: dict[str, list[str]]
) -> list[EarnedByPlayer]:
    """What a pass just awarded, as the `achievements.earned` event carries it.

    Unmasked, `hidden` ones included: earning one is what reveals it. Without the
    `definition` all the same — the bus is open to anonymous clients, and what a hidden
    achievement *asks* for is the surprise itself.

    A player whose row has gone missing (deleted mid-party) is left out rather than announced
    as an id nothing can draw.
    """
    filled = {player_id: ids for player_id, ids in earned.items() if ids}
    if not filled:
        return []
    achievements = {
        achievement.id: achievement
        for achievement in await by_ids(session, {one for ids in filled.values() for one in ids})
    }
    payload: list[EarnedByPlayer] = []
    for player_id, ids in filled.items():
        player = await session.get(Player, player_id)
        if player is None:
            continue
        payload.append(
            EarnedByPlayer(
                player=read_player(player),
                achievements=[
                    read_achievement(achievements[one]) for one in ids if one in achievements
                ],
            )
        )
    return payload


def dump_definition(conditions: list[Condition]) -> list[dict[str, Any]]:
    """The conditions as the JSON column holds them.

    Written out of the parsed models rather than out of the request body, so what is stored
    is what the engine reads back: a field the models defaulted is stored spelled out, and
    one nobody set is left out rather than stored as null.
    """
    return [condition.model_dump(mode="json", exclude_none=True) for condition in conditions]


async def create_achievement(
    session: AsyncSession,
    *,
    name: str,
    description: str,
    icon: str | None,
    color: str,
    hidden: bool,
    enabled: bool,
    sort_order: int | None,
    definition: list[Condition],
) -> Achievement:
    """A new achievement, at the end of the list unless the caller placed it.

    A uuid4 hex id: the stable slugs belong to the set Wingman ships, and one an operator
    made here has no meaning another instance could recognise.
    """
    achievement = Achievement(
        id=uuid.uuid4().hex,
        name=name,
        description=description,
        icon=icon,
        color=color,
        hidden=hidden,
        enabled=enabled,
        sort_order=await _next_sort_order(session) if sort_order is None else sort_order,
        definition=dump_definition(definition),
    )
    session.add(achievement)
    await session.commit()
    logger.info("achievement '%s' created (%s)", achievement.name, achievement.id)
    await event_bus.broadcast(AchievementsChanged())
    return achievement


async def update_achievement(
    session: AsyncSession,
    achievement: Achievement,
    *,
    name: str | None = None,
    description: str | None = None,
    icon: str | None | _Unset = UNSET,
    color: str | None = None,
    hidden: bool | None = None,
    enabled: bool | None = None,
    sort_order: int | None = None,
    definition: list[Condition] | None = None,
) -> Achievement:
    """Change what an achievement is, or what it asks for. A built-in may be edited like any
    other — only deleting one is refused."""
    if name is not None:
        achievement.name = name
    if description is not None:
        achievement.description = description
    if not isinstance(icon, _Unset):
        # An explicit null clears the glyph; leaving the field out keeps it.
        achievement.icon = icon
    if color is not None:
        achievement.color = color
    if hidden is not None:
        achievement.hidden = hidden
    if enabled is not None:
        achievement.enabled = enabled
    if sort_order is not None:
        achievement.sort_order = sort_order
    if definition is not None:
        achievement.definition = dump_definition(definition)
    await session.commit()
    logger.info("achievement '%s' updated (%s)", achievement.name, achievement.id)
    await event_bus.broadcast(AchievementsChanged())
    return achievement


async def delete_achievement(
    session: AsyncSession, achievement: Achievement, icons_dir: Path
) -> None:
    """Delete one, everything anybody reached on it, and its uploaded picture.

    Raises `BuiltInAchievementError` for one of the built-ins: the set Wingman ships is what
    import/export recognises by id, so it may be switched off but never taken away.

    The `player_achievements` rows go with it rather than staying as orphans. Unlike a score,
    which is the record of something that happened, a progress row is a derived number and
    says nothing at all once the thing it was progress toward is gone.
    """
    if achievement.built_in:
        raise BuiltInAchievementError(achievement.id)
    await remove_images(icons_dir, achievement.id)
    for row in await session.scalars(
        select(PlayerAchievement).where(PlayerAchievement.achievement_id == achievement.id)
    ):
        await session.delete(row)
    await session.delete(achievement)
    await session.commit()
    logger.info("achievement '%s' deleted (%s)", achievement.name, achievement.id)
    await event_bus.broadcast(AchievementsChanged())


async def store_icon(
    session: AsyncSession,
    achievement: Achievement,
    icons_dir: Path,
    content_type: str | None,
    data: bytes,
) -> Achievement:
    """Replace the glyph with an uploaded picture.

    The same rules as a player's avatar, out of the same module (`images.py`): the same
    content-type allowlist, the same byte cap and the same pixel cap, one file per
    achievement, and the previous one dropped even when it had another extension.
    """
    extension = validate_image(content_type, data)
    path = await store_image(icons_dir, achievement.id, extension, data)
    achievement.icon_file = str(path)
    await session.commit()
    await event_bus.broadcast(AchievementsChanged())
    return achievement


async def remove_icon(
    session: AsyncSession, achievement: Achievement, icons_dir: Path
) -> Achievement:
    """Back to the glyph. A no-op when there was no picture — asking twice is not a mistake."""
    await remove_images(icons_dir, achievement.id)
    achievement.icon_file = None
    await session.commit()
    await event_bus.broadcast(AchievementsChanged())
    return achievement


async def _next_sort_order(session: AsyncSession) -> int:
    highest = await session.scalar(select(func.max(Achievement.sort_order)))
    return 0 if highest is None else int(highest) + 1


def start_full_pass(
    session_factory: async_sessionmaker[AsyncSession], reason: str
) -> "asyncio.Task[dict[str, list[str]]]":
    """Recompute every player, without making the request that caused it wait.

    A definition that changed can award or revoke a badge for everybody who ever sang, which
    is a query per player — the editor must not sit through that. A task per write rather
    than one shared task like the library scan: a second edit has to be recomputed too, and
    `_write_lock` already serialises them, so they queue instead of racing.

    Nothing is broadcast when one finishes. `achievements.earned` belongs to a sing and a
    pass over the whole record has no sing to name — and the write that started this pass has
    already sent `achievements.changed`, which is what a client refetches on.
    """
    task = asyncio.create_task(_full_pass(session_factory, reason))
    _passes.add(task)
    task.add_done_callback(_pass_finished)
    return task


async def wait_for_passes() -> None:
    """Let whatever is queued finish — what a test waits on instead of sleeping."""
    while _passes:
        await asyncio.gather(*list(_passes), return_exceptions=True)


async def stop_passes() -> None:
    """Cancel what is still running, so no pass outlives the database engine."""
    pending = list(_passes)
    _passes.clear()
    for task in pending:
        task.cancel()
    for task in pending:
        # Whatever it was doing, it is being shut down: the cancellation is expected and a
        # failure is already on the done callback's log.
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task


async def _full_pass(
    session_factory: async_sessionmaker[AsyncSession], reason: str
) -> dict[str, list[str]]:
    async with session_factory() as session:
        earned = await evaluate_all(session)
    logger.info("achievements recomputed for %d player(s) after %s", len(earned), reason)
    return earned


def _pass_finished(task: "asyncio.Task[dict[str, list[str]]]") -> None:
    _passes.discard(task)
    if task.cancelled():
        return
    error = task.exception()
    if error is not None:
        logger.error("recomputing the achievements failed", exc_info=error)
