"""Recomputing achievements from the scores. Knows nothing about FastAPI.

Every rule lives in `evaluate.py`; this module reads the rows the engine needs and writes
the `player_achievements` its answer implies. Nothing here consults the global toggle — a
pass that is not wanted is a pass that is not started, and the call sites decide that.
"""

from collections.abc import Collection
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..karaoke.model import Score, Sing
from ..songs.model import Song
from .evaluate import NOT_EARNED, ScoreRow, evaluate
from .model import Achievement, PlayerAchievement
from .schema import parse_definition


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
    """
    achievements = await _enabled(session)
    moment = now or datetime.now(UTC)
    # `fromkeys` rather than a set: the same player named twice is one pass, and the order
    # callers pass them in is the order they get back.
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
