"""Migrations 0027 and 0028 — the party picker's `hidden` flag — run over a database that
already holds parties.

Every other test reaches the schema through `run_migrations`, which walks a fresh database
from nothing: the case nothing else covers is the one the host actually meets, a `0026`
database with an evening or two already in it. `NOT NULL` with a `0` default is exactly the
promise that has to hold there — an existing party comes out visible, and stepping back off
again leaves it alone.
"""

import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from ultrastar_wingman.db import migrations_dir

# Two evenings, the shape 0008 gave the table.
PARTIES: dict[str, str] = {
    "party-old": "2026-08-01 20:00:00",
    "party-new": "2026-08-22 20:00:00",
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


async def _write_parties(database_url: str) -> None:
    engine = create_async_engine(database_url)
    try:
        async with engine.begin() as connection:
            for session_id, started_at in PARTIES.items():
                await connection.execute(
                    text(
                        "INSERT INTO karaoke_sessions "
                        "(id, name, started_at, last_activity_at) "
                        "VALUES (:id, NULL, :at, :at)"
                    ),
                    {"id": session_id, "at": started_at},
                )
    finally:
        await engine.dispose()


async def test_the_parties_already_recorded_come_out_on_the_list(tmp_path: Path) -> None:
    """Nothing was hidden before the column existed, so every party that was already there
    starts visible — and the capability that hides one is seeded for the administrator and
    for nobody else."""
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'hidden.db'}"
    await _alembic(database_url, "0026")
    await _write_parties(database_url)

    await _alembic(database_url, "head")

    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            rows = await connection.execute(
                text("SELECT id, hidden FROM karaoke_sessions ORDER BY id")
            )
            assert [(row[0], row[1]) for row in rows] == [("party-new", 0), ("party-old", 0)]
            # Seeded for `admin` by 0028; since 0039 Admin holds every capability by rule, so
            # no group row names it.
            granted = await connection.execute(
                text("SELECT group_id FROM group_capabilities WHERE capability = 'stats.hide'")
            )
            assert [row[0] for row in granted] == []
    finally:
        await engine.dispose()


async def test_the_flag_can_be_stepped_back_off_again(tmp_path: Path) -> None:
    """An operator trying an older build. The parties survive it — only the column and the
    seeded grant go — and stepping forward again puts them back on the list."""
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'round-trip.db'}"
    await _alembic(database_url, "0026")
    await _write_parties(database_url)
    await _alembic(database_url, "head")

    # A party taken off the list, so the downgrade has something to drop.
    engine = create_async_engine(database_url)
    try:
        async with engine.begin() as connection:
            await connection.execute(
                text("UPDATE karaoke_sessions SET hidden = 1 WHERE id = 'party-old'")
            )
    finally:
        await engine.dispose()

    await _alembic(database_url, "0026", down=True)

    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            assert await connection.scalar(text("SELECT COUNT(*) FROM karaoke_sessions")) == 2
            columns = await connection.execute(text("PRAGMA table_info(karaoke_sessions)"))
            assert "hidden" not in {row[1] for row in columns}
            assert (
                await connection.scalar(
                    text("SELECT COUNT(*) FROM role_permissions WHERE capability = 'stats.hide'")
                )
                == 0
            )
    finally:
        await engine.dispose()

    await _alembic(database_url, "head")
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            rows = await connection.execute(text("SELECT hidden FROM karaoke_sessions"))
            assert [row[0] for row in rows] == [0, 0]
    finally:
        await engine.dispose()
