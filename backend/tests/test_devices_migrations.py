"""The player selector's revisions, run both ways.

Every other test reaches the schema through `run_migrations`, which only ever goes forward
from nothing — so a database that stopped at an *earlier* revision is the one case the suite
never sees, and it is exactly the case a column added to an already-merged revision breaks:
0032 created `devices`, so a database that has run it is at head and will never be offered
the column again, whatever 0032 says today.

Which is what these two assert. The column is 0033's and not 0032's, and stepping a database
back over 0033 and forward again leaves it with the column once.
"""

import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine

from ultrastar_wingman.db import migrations_dir

COLUMN = "update_requested_at"


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


async def _device_columns(database_url: str) -> set[str]:
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            names = await connection.run_sync(
                lambda sync: {column["name"] for column in inspect(sync).get_columns("devices")}
            )
    finally:
        await engine.dispose()
    return names


async def test_the_update_flag_is_its_own_revision(tmp_path: Path) -> None:
    """0032 is merged, so it is frozen: a database sitting on it has to be *given* the
    column by a later revision rather than told it was there all along."""
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'stepwise.db'}"

    await _alembic(database_url, "0032")
    assert COLUMN not in await _device_columns(database_url)

    await _alembic(database_url, "head")
    assert COLUMN in await _device_columns(database_url)


async def test_the_update_flag_survives_a_round_trip(tmp_path: Path) -> None:
    """Head, back over 0033, and up again — what an operator trying an older build does."""
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'round-trip.db'}"

    await _alembic(database_url, "head")
    assert COLUMN in await _device_columns(database_url)

    await _alembic(database_url, "0032", down=True)
    assert COLUMN not in await _device_columns(database_url)

    await _alembic(database_url, "head")
    assert COLUMN in await _device_columns(database_url)
