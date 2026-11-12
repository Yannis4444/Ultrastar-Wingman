"""Reading the statistics back out, and the two corrections a moderator may make to it.
Knows nothing about FastAPI.

Every score listing goes through one query with the sing and the song joined in — a
per-score lookup would be one round trip per row on a party's worth of scores.
"""

import logging
from collections.abc import Collection
from datetime import UTC, datetime

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..achievements import service as achievements
from ..auth.model import as_utc
from ..events import ScoresChanged, SessionsChanged, event_bus
from ..karaoke.model import SESSION_GAP, KaraokeSession, Score, Sing
from ..karaoke.schema import ScoreRead, read_score
from ..players.model import Player
from ..songs.model import Song
from ..songs.schema import read_song
from .schema import ScoreWithContext, SessionRead, SingDetail, SingRead

logger = logging.getLogger(__name__)


async def sessions(session: AsyncSession) -> list[SessionRead]:
    """Every recorded session, newest first, with how much happened in it.

    `hidden` is the stored flag and `current` says whether it is in force: the party being
    sung is never kept out of the picker, so a hidden one that is sung into again is back
    while the evening lasts. Nothing here filters — which rows a caller sees is
    `api.list_sessions`'s decision, over the parties they may open.
    """
    running = await current_session(session)
    rows = await session.execute(
        select(
            KaraokeSession,
            # Distinct: the second join multiplies the sing rows by their scores.
            func.count(func.distinct(Sing.id)),
            func.count(Score.id),
            # A score carries a player id only when the name USDX scored under matched a
            # launched slot, so the name is what a walk-in is counted by.
            func.count(func.distinct(func.coalesce(Score.player_id, Score.player_name))),
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
            singer_count=singer_count,
            hidden=row.hidden,
            current=running is not None and running.id == row.id,
        )
        for row, sing_count, score_count, singer_count in rows
    ]


async def sessions_of_player(session: AsyncSession, player_id: str) -> set[str]:
    """The sessions this player was scored in — the parties they were part of.

    A score is the only durable link between a person and a party: the microphone slots a
    sing was launched with live in memory only, so a player who was on stage but never
    scored (the song was stopped early) left no trace to find them by. Matched on the
    player id, exactly like `player_scores`, so a walk-in who typed the same name into USDX
    is not let into somebody else's party.
    """
    rows = await session.scalars(
        select(Sing.session_id)
        .join(Score, Score.sing_id == Sing.id)
        .where(Score.player_id == player_id, Sing.session_id.is_not(None))
        .distinct()
    )
    return {session_id for session_id in rows if session_id is not None}


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
    if name:
        logger.info("A party was renamed to '%s'", name)
    else:
        logger.info("A party's name was taken off")
    read = await read_session(session, karaoke_session)
    # The party picker in the room is now naming that evening something else. Same event as
    # hiding one, and for the same reason: it is the listing that changed, and what the
    # listing holds is worked out per caller.
    await event_bus.broadcast(SessionsChanged())
    return read


class SessionRunningError(RuntimeError):
    """Raised by `set_session_hidden` when asked to hide the party being sung."""

    def __init__(self, session_id: str) -> None:
        super().__init__(f"session '{session_id}' is the party being sung")
        self.session_id = session_id


async def set_session_hidden(
    session: AsyncSession, karaoke_session: KaraokeSession, hidden: bool
) -> SessionRead:
    """Keep a party out of the Scores page's party picker, or put it back.

    **This changes what one list holds and nothing else.** The party keeps every score it
    has: in the singer's own record, in a song's best scores, in the all-parties total
    (`all_scores`), in what a reader may open (`api.visible_session_ids`) and in what an
    achievement is worked out from. Hiding is a tidy-up of a long list, not a deletion, and
    nobody's badge or best score may move because somebody tidied.

    The party being sung cannot be hidden — the evening in progress is what the Scores page
    is for, and a phone at that party would be left with an empty page. Unhiding it is
    always allowed: it is the way back out of a flag that was set before the room started
    singing into that party again.
    """
    running = await current_session(session) if hidden else None
    if running is not None and running.id == karaoke_session.id:
        raise SessionRunningError(karaoke_session.id)
    karaoke_session.hidden = hidden
    await session.commit()
    logger.info(
        "The party %s %s the party picker",
        f"'{karaoke_session.name}'"
        if karaoke_session.name
        else f"of {as_utc(karaoke_session.started_at).date().isoformat()}",
        "is hidden from" if hidden else "is back in",
    )
    read = await read_session(session, karaoke_session)
    # Ids say nothing here: which parties a listener sees depends on whether they hold
    # `stats.hide`, so every screen refetches the listing for itself.
    await event_bus.broadcast(SessionsChanged())
    return read


async def read_session(session: AsyncSession, karaoke_session: KaraokeSession) -> SessionRead:
    """One session's row. Goes through the listing so the counts cannot drift apart."""
    found = next(row for row in await sessions(session) if row.id == karaoke_session.id)
    return found


def _scores_query() -> Select:
    """Scores with their sing and song. An outer join on the song, so `Song` is really
    `Song | None`: a score whose song left the library still counts, it just has nothing to
    show for it.

    A bare `Select` rather than the row's types: SQLAlchemy 2.0 spells them
    `Select[tuple[Score, Song, Sing]]` and 2.1 `Select[Score, Song, Sing]`, and the bare
    form is the one annotation both versions type-check."""
    return (
        select(Score, Song, Sing)
        .join(Sing, Sing.id == Score.sing_id)
        .outerjoin(Song, Song.id == Sing.song_id)
        # Newest first everywhere; the id breaks ties (USDX stamps a whole run one second).
        .order_by(Score.recorded_at.desc(), Score.id.desc())
    )


async def _read_scores(session: AsyncSession, query: Select) -> list[ScoreWithContext]:
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


async def all_scores(
    session: AsyncSession, session_ids: Collection[str] | None
) -> list[ScoreWithContext]:
    """Every score of every party at once — the session picker's head row.

    `session_ids` is `None` for a reader who may see the whole archive, and otherwise the
    parties they may open. An empty collection therefore means "no party of yours", which
    is an empty list and not the archive.

    A sing that belongs to no party at all is left out of both branches. Migration 0008
    added `sings.session_id`, so every run recorded before it has none, and those scores
    appear in no session listing either — counting them here alone would make the head row
    disagree with the parties it claims to add up. The restricted branch drops them anyway
    (`IN` never matches NULL); spelling it out keeps the two branches the same rule.
    """
    query = _scores_query().where(Sing.session_id.is_not(None))
    if session_ids is not None:
        query = query.where(Sing.session_id.in_(session_ids))
    return await _read_scores(session, query)


async def find_sing(session: AsyncSession, sing_id: str) -> Sing | None:
    return await session.get(Sing, sing_id)


async def scored_on(session: AsyncSession, sing_id: str, player_id: str) -> bool:
    """Whether this player holds a score of this sing — matched on the player id, so a
    walk-in who typed the same name into USDX is not them (`player_scores`' rule)."""
    found = await session.scalar(
        select(Score.id).where(Score.sing_id == sing_id, Score.player_id == player_id).limit(1)
    )
    return found is not None


async def sing_detail(
    session: AsyncSession, sing: Sing, hidden_song_ids: Collection[str]
) -> SingDetail:
    """One sing with its song, its party and every score it got.

    Nothing here decides who may read it — that is `api.read_sing`'s business, settled over
    the bare row (`find_sing`, `scored_on`) before this is called, so a refused caller never
    costs the sessions aggregation behind `read_session`. `hidden_song_ids` only says whether
    the reader may open the song itself (`song_listed`); the song is in the answer either way.

    The song is looked up on its own rather than off the score rows, because a sing that
    lost its last score still has a song. The scores go through the one query every listing
    uses, ordered by rank instead of by time.
    """
    song = await session.get(Song, sing.song_id)
    # `sings.session_id` is not a foreign key either, so a party is read only once it is
    # known to exist.
    karaoke_session = (
        None if sing.session_id is None else await session.get(KaraokeSession, sing.session_id)
    )
    scores = await _read_scores(
        session,
        _scores_query()
        .where(Score.sing_id == sing.id)
        .order_by(None)
        # Best first; the id breaks a tie, so two equal scores keep the order they came in.
        .order_by(Score.score.desc(), Score.id),
    )
    return SingDetail(
        sing_id=sing.id,
        song_id=sing.song_id,
        song=None if song is None else read_song(song),
        song_listed=song is not None and sing.song_id not in hidden_song_ids,
        session=None if karaoke_session is None else await read_session(session, karaoke_session),
        # Naive coming out of SQLite; everything we write is UTC (see `as_utc`).
        started_at=as_utc(sing.started_at),
        ended_at=None if sing.ended_at is None else as_utc(sing.ended_at),
        scores=scores,
    )


async def reassign_score(session: AsyncSession, score: Score, player: Player) -> ScoreRead:
    """Put a score on the singer it belongs to.

    The sing and its session are untouched: the song was sung, at that moment, in that
    party — only *who* USDX filed it under was wrong. `player_name` is rewritten along with
    the id because it is the durable label (a score outlives the player row), and leaving
    the old name on it would make the same score say two different things.

    `placement` and `field_size` are untouched too, on this row and on every other row of the
    sing, **by design**: they say where the numbers came in when the song was scored, and the
    numbers have not moved. The score that came first still came first; it is now on somebody
    else's name, and so is the win.
    """
    previous_player_id = score.player_id
    score.player_id = player.id
    score.player_name = player.name
    await session.commit()
    logger.info("A score of %s moved to %s", f"{score.score:,}", player.name)
    # Both ends of the move: the one who lost the score may lose a badge with it, and the one
    # who gained it may have just earned one. Recomputation is what makes that correct — a
    # counter would only ever have grown.
    await achievements.evaluate_players(
        session,
        [player_id for player_id in (previous_player_id, player.id) if player_id is not None],
    )
    await event_bus.broadcast(ScoresChanged(sing_id=score.sing_id))
    return read_score(score)


async def delete_score(session: AsyncSession, score: Score) -> None:
    """Take one wrong score off the record.

    The score row and nothing else: the sing stays even when it was the last score on it,
    because a sing is the statement "this song was played" — it is what the Recent tab and
    a party's `sing_count` are built from, and USDX scores nothing for a song that was
    stopped early either.

    The `placement` and `field_size` of the scores that remain are **not** recomputed, by
    design and as the whole reason those columns exist: two people sang that song, and the
    one who won it won it against somebody. Renumbering the survivors would turn last month's
    duel into a solo the moment a wrong row was tidied away, and would do it silently.
    """
    sing_id = score.sing_id
    player_id = score.player_id
    await session.delete(score)
    await session.commit()
    logger.info("A score of %s by %s deleted", f"{score.score:,}", score.player_name)
    # A badge earned on a score that is no longer on the record is revoked here. Nothing is
    # announced beyond `scores.changed`: `achievements.earned` is what a *sing* earned, and
    # a correction hours later is not one.
    if player_id is not None:
        await achievements.evaluate_players(session, [player_id])
    await event_bus.broadcast(ScoresChanged(sing_id=sing_id))
