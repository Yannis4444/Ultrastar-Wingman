"""Reading the statistics back out. Knows nothing about FastAPI.

Every score listing goes through one query with the sing and the song joined in — a
per-score lookup would be one round trip per row on a party's worth of scores.
"""

import logging
from datetime import UTC, datetime

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.model import as_utc
from ..karaoke.model import SESSION_GAP, KaraokeSession, Score, Sing
from ..karaoke.schema import read_score
from ..songs.model import Song
from ..songs.schema import read_song
from .schema import ScoreWithContext, SessionRead, SingRead

logger = logging.getLogger(__name__)


async def sessions(session: AsyncSession) -> list[SessionRead]:
    """Every recorded session, newest first, with how much happened in it."""
    rows = await session.execute(
        select(
            KaraokeSession,
            # Distinct: the second join multiplies the sing rows by their scores.
            func.count(func.distinct(Sing.id)),
            func.count(Score.id),
        )
        .outerjoin(Sing, Sing.session_id == KaraokeSession.id)
        .outerjoin(Score, Score.sing_id == Sing.id)
        .group_by(KaraokeSession.id)
        # The id only breaks ties, so the order is stable across requests.
        .order_by(KaraokeSession.started_at.desc(), KaraokeSession.id)
    )
    return [
        SessionRead(
            id=row.id,
            name=row.name,
            # Naive coming out of SQLite; everything we write is UTC (see `as_utc`).
            started_at=as_utc(row.started_at),
            last_activity_at=as_utc(row.last_activity_at),
            sing_count=sing_count,
            score_count=score_count,
        )
        for row, sing_count, score_count in rows
    ]


async def current_session(
    session: AsyncSession, now: datetime | None = None
) -> KaraokeSession | None:
    """The party that is still going, or `None` when the last one is over.

    Deliberately the same rule `karaoke.service.attach_to_session` applies when a sing
    looks for a session to join: the newest one, while it has been idle for less than
    `SESSION_GAP`. The two must change together, or "this session" would mean one thing to
    the song that starts next and another to the page showing what was played.
    """
    now = now or datetime.now(UTC)
    newest = await session.scalar(
        select(KaraokeSession).order_by(KaraokeSession.last_activity_at.desc()).limit(1)
    )
    if newest is None or now - as_utc(newest.last_activity_at) >= SESSION_GAP:
        return None
    return newest


async def current_session_sings(
    session: AsyncSession, now: datetime | None = None
) -> list[SingRead]:
    """What the running party has sung, newest first, one entry per song.

    Sings, not scores: a song USDX never scored (stopped early, no microphone) was still
    played, and the list is about what was on screen. Sung twice means one entry at the
    newer start — "recently played" is a list of songs, not of performances.
    """
    karaoke_session = await current_session(session, now)
    if karaoke_session is None:
        return []
    rows = await session.execute(
        select(Sing, Song)
        # Outer: a sing whose song left the library still counts, it just has nothing to
        # show for it.
        .outerjoin(Song, Song.id == Sing.song_id)
        .where(Sing.session_id == karaoke_session.id)
        # The id breaks ties, so two sings stamped the same second keep a stable order.
        .order_by(Sing.started_at.desc(), Sing.id.desc())
    )
    sings: list[SingRead] = []
    seen: set[str] = set()
    for sing, song in rows:
        # Newest first, so the first row of a song is the one to keep.
        if sing.song_id in seen:
            continue
        seen.add(sing.song_id)
        sings.append(
            SingRead(
                sing_id=sing.id,
                song_id=sing.song_id,
                song=None if song is None else read_song(song),
                # Naive coming out of SQLite; everything we write is UTC (see `as_utc`).
                started_at=as_utc(sing.started_at),
            )
        )
    return sings


async def rename_session(
    session: AsyncSession, karaoke_session: KaraokeSession, name: str | None
) -> SessionRead:
    karaoke_session.name = name
    await session.commit()
    logger.info("karaoke session %s renamed to %r", karaoke_session.id, name)
    return await read_session(session, karaoke_session)


async def read_session(session: AsyncSession, karaoke_session: KaraokeSession) -> SessionRead:
    """One session's row. Goes through the listing so the counts cannot drift apart."""
    found = next(row for row in await sessions(session) if row.id == karaoke_session.id)
    return found


def _scores_query() -> Select[tuple[Score, Song, Sing]]:
    """Scores with their sing and song. An outer join on the song, so `Song` is really
    `Song | None`: a score whose song left the library still counts, it just has nothing to
    show for it."""
    return (
        select(Score, Song, Sing)
        .join(Sing, Sing.id == Score.sing_id)
        .outerjoin(Song, Song.id == Sing.song_id)
        # Newest first everywhere; the id breaks ties (USDX stamps a whole run one second).
        .order_by(Score.recorded_at.desc(), Score.id.desc())
    )


async def _read_scores(
    session: AsyncSession, query: Select[tuple[Score, Song, Sing]]
) -> list[ScoreWithContext]:
    return [
        ScoreWithContext(
            **read_score(score).model_dump(),
            song=None if song is None else read_song(song),
            sing_started_at=as_utc(sing.started_at),
        )
        for score, song, sing in await session.execute(query)
    ]


async def session_scores(session: AsyncSession, session_id: str) -> list[ScoreWithContext]:
    return await _read_scores(session, _scores_query().where(Sing.session_id == session_id))


async def song_scores(session: AsyncSession, song_id: str) -> list[ScoreWithContext]:
    """Every score this song ever got, across all sessions."""
    return await _read_scores(session, _scores_query().where(Sing.song_id == song_id))


async def player_scores(session: AsyncSession, player_id: str) -> list[ScoreWithContext]:
    """Every score one player ever got, across all sessions.

    Matched on the player id, so a walk-in singer who happened to type the same name into
    USDX is not counted as this player — those scores carry no id at all.
    """
    return await _read_scores(session, _scores_query().where(Score.player_id == player_id))


async def latest_scores(session: AsyncSession, limit: int) -> list[ScoreWithContext]:
    return await _read_scores(session, _scores_query().limit(limit))
