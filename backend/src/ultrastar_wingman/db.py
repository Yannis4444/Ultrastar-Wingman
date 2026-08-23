"""Database plumbing: the declarative base, the migration runner and the session dependency."""

import asyncio
import logging
import sys
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Annotated

from alembic import command
from alembic.config import Config
from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

logger = logging.getLogger(__name__)


def migrations_dir() -> Path:
    """Alembic's script location.

    Alembic loads migration scripts from the filesystem, so they ship as data files.
    Frozen (PyInstaller) that is the unpacked bundle directory, not the package directory —
    which lives inside the archive.
    """
    bundle_dir = getattr(sys, "_MEIPASS", None)
    if bundle_dir is not None:
        return Path(bundle_dir) / "ultrastar_wingman" / "migrations"
    return Path(__file__).parent / "migrations"


class Base(DeclarativeBase):
    pass


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    session_factory: async_sessionmaker[AsyncSession] = request.app.state.session_factory
    async with session_factory() as session:
        yield session


SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def run_migrations(database_url: str) -> None:
    """Upgrade the database to head. Alembic is sync, so it runs in a worker thread."""
    logger.info("running database migrations")
    await asyncio.to_thread(_upgrade_to_head, database_url)


def _upgrade_to_head(database_url: str) -> None:
    config = Config()
    config.set_main_option("script_location", str(migrations_dir()))
    # Alembic reads options through ConfigParser: a literal % must be escaped.
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    command.upgrade(config, "head")
