"""Reading the scores USDX wrote into its own `Ultrastar.db`.

Read-only, and only as an ingestion source: Wingman's own tables are the source
of truth for statistics (the old app queried USDX's database for every stats
view and had no way to tell two runs of the same song apart).

USDX gives us no song or player identity we could trust — it stores names and
titles as fixed-width strings padded with NUL characters. We do not need them:
Wingman started the song and wrote the player names into USDX's config, so
"every row newer than the snapshot taken before launch" is exactly this run.
"""

import logging
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import anyio

logger = logging.getLogger(__name__)

# USDX stores its strings fixed-width, padded with NUL characters.
NUL = chr(0)

_MAX_DATE = "SELECT COALESCE(MAX(Date), -1) FROM us_scores"

_NEW_SCORES = """
    SELECT us_scores.Player, us_scores.Score, us_scores.Difficulty, us_scores.Date
    FROM us_scores
    JOIN us_songs ON us_songs.ID = us_scores.SongID
    WHERE us_scores.Date > ?
    ORDER BY us_scores.Date, us_scores.rowid
"""


@dataclass(frozen=True)
class UsdxScore:
    """One row as USDX wrote it, cleaned up. `date` is a unix timestamp in seconds."""

    player_name: str
    score: int
    difficulty: int | None
    date: int


async def latest_date(database: Path) -> int:
    """The newest score timestamp, `-1` when there is none (or no database yet)."""
    rows = await _query(database, _MAX_DATE, ())
    return int(rows[0][0]) if rows else -1


async def scores_since(database: Path, after: int) -> list[UsdxScore]:
    return [
        UsdxScore(
            player_name=str(player).rstrip(NUL).strip(),
            score=int(score),
            difficulty=None if difficulty is None else int(difficulty),
            date=int(date),
        )
        for player, score, difficulty, date in await _query(database, _NEW_SCORES, (after,))
    ]


async def _query(database: Path, sql: str, parameters: tuple[Any, ...]) -> list[tuple[Any, ...]]:
    """Blocking sqlite in a worker thread. A missing or unreadable database is not fatal:
    USDX creates it on the first score, and a broken one must not break the song flow."""
    return await anyio.to_thread.run_sync(lambda: _query_blocking(database, sql, parameters))


def _query_blocking(database: Path, sql: str, parameters: tuple[Any, ...]) -> list[tuple[Any, ...]]:
    if not database.is_file():
        logger.info("no USDX score database at %s yet", database)
        return []
    try:
        # mode=ro: USDX owns this file, Wingman never writes to it.
        connection = sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)
    except sqlite3.Error:
        logger.warning("cannot open the USDX score database %s", database, exc_info=True)
        return []
    try:
        return list(connection.execute(sql, parameters).fetchall())
    except sqlite3.Error:
        logger.warning("cannot read scores from %s", database, exc_info=True)
        return []
    finally:
        connection.close()
