"""Alembic environment (async engine).

The URL comes from the alembic config only — never from app settings — so the
CLI and the app-startup upgrade behave identically and tests stay hermetic.
"""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import Connection, pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from ultrastar_wingman import settings as _settings  # noqa: F401  registers the settings table
from ultrastar_wingman.auth import model as _auth  # noqa: F401  users, sessions, permissions
from ultrastar_wingman.db import Base
from ultrastar_wingman.downloads import model as _downloads  # noqa: F401  downloads table
from ultrastar_wingman.karaoke import model as _karaoke  # noqa: F401  sings and scores tables
from ultrastar_wingman.library import model as _library  # noqa: F401  wishes, favorites, playlists
from ultrastar_wingman.players import model as _players  # noqa: F401  registers the players table
from ultrastar_wingman.songs import model as _songs  # noqa: F401  registers the songs table
from ultrastar_wingman.tags import model as _tags  # noqa: F401  tags, permissions, song tags

config = context.config

# Only the CLI passes an ini file with logging sections; the app builds the config in code.
if config.config_file_name is not None and config.get_section("loggers"):
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
