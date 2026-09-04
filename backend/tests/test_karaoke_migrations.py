"""Migration 0026, the one that gave a score a placement, run over a history it did not
write itself.

Everything else in the suite reaches the schema through `run_migrations`, which walks a fresh
database from nothing — so a revision that *backfills* is the one whose interesting case no
other test ever reaches: rows that were already there. These tests put a party into a 0025
database and step it forward.
"""

import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from ultrastar_wingman.db import migrations_dir

# One sing per row: the sing id, then the scores it was given.
HISTORY: dict[str, list[int]] = {
    # A duel, and a tie for the top of a field of three.
    "sing-duet": [7000, 8500],
    "sing-tie": [8500, 8500, 4000],
    # Nobody to beat.
    "sing-solo": [9000],
}


def _config(database_url: str) -> Config:
    config = Config()
    config.set_main_option("script_location", str(migrations_dir()))
    # Alembic reads options through ConfigParser: a literal % must be escaped.
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    return config


async def _alembic(database_url: str, revision: str, *, down: bool = False) -> None:
    """Alembic is sync and opens its own event loop, so it runs in a worker thread."""
    run = command.downgrade if down else command.upgrade
    await asyncio.to_thread(run, _config(database_url), revision)


async def _write_history(database_url: str) -> None:
    engine = create_async_engine(database_url)
    try:
        async with engine.begin() as connection:
            for sing_id, scores in HISTORY.items():
                await connection.execute(
                    text(
                        "INSERT INTO sings (id, song_id, session_id, started_at) "
                        "VALUES (:id, 'usdb:1', 'party', '2026-08-01 20:00:00')"
                    ),
                    {"id": sing_id},
                )
                for index, score in enumerate(scores):
                    await connection.execute(
                        text(
                            "INSERT INTO scores "
                            "(sing_id, player_id, player_name, score, recorded_at) "
                            "VALUES (:sing_id, :player, :player, :score, "
                            "'2026-08-01 20:04:00')"
                        ),
                        {"sing_id": sing_id, "player": f"p{index}", "score": score},
                    )
    finally:
        await engine.dispose()


async def _placements(database_url: str) -> list[tuple[str, int, int | None, int | None]]:
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            rows = await connection.execute(
                text(
                    "SELECT sing_id, score, placement, field_size FROM scores ORDER BY sing_id, id"
                )
            )
            return [(row[0], row[1], row[2], row[3]) for row in rows]
    finally:
        await engine.dispose()


async def test_the_history_is_backfilled_with_the_ranking_a_new_sing_gets(tmp_path: Path) -> None:
    """Standard competition ranking, the rule `karaoke.model.placements` applies to an
    evening recorded from now on — so a party from before the column ranks the same way as
    the party that follows it. Exact for a sing that still holds every score it was given,
    which is every sing here.
    """
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'backfill.db'}"
    await _alembic(database_url, "0025")
    await _write_history(database_url)

    await _alembic(database_url, "0026")

    assert await _placements(database_url) == [
        ("sing-duet", 7000, 2, 2),
        ("sing-duet", 8500, 1, 2),
        # A field of one, which is what tells this from a win.
        ("sing-solo", 9000, 1, 1),
        # Both eights came first and the four came third: nobody came second to a tie.
        ("sing-tie", 8500, 1, 3),
        ("sing-tie", 8500, 1, 3),
        ("sing-tie", 4000, 3, 3),
    ]


async def test_the_columns_can_be_stepped_back_off_again(tmp_path: Path) -> None:
    """An operator trying an older build. The scores themselves survive it — only what 0026
    added goes — and stepping forward again backfills them a second time."""
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'round-trip.db'}"
    await _alembic(database_url, "0025")
    await _write_history(database_url)
    await _alembic(database_url, "head")

    await _alembic(database_url, "0025", down=True)
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            assert await connection.scalar(text("SELECT COUNT(*) FROM scores")) == 6
            columns = await connection.execute(text("PRAGMA table_info(scores)"))
            assert "placement" not in {row[1] for row in columns}
    finally:
        await engine.dispose()

    await _alembic(database_url, "head")
    assert [row[2:] for row in await _placements(database_url)] == [
        (2, 2),
        (1, 2),
        (1, 1),
        (1, 3),
        (1, 3),
        (3, 3),
    ]
