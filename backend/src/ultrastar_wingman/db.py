"""Database plumbing: the declarative base and the migration runner."""

import asyncio
import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy.orm import DeclarativeBase

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


class Base(DeclarativeBase):
    pass


async def run_migrations(database_url: str) -> None:
    """Upgrade the database to head. Alembic is sync, so it runs in a worker thread."""
    logger.info("running database migrations")
    await asyncio.to_thread(_upgrade_to_head, database_url)


def _upgrade_to_head(database_url: str) -> None:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    # Alembic reads options through ConfigParser: a literal % must be escaped.
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    command.upgrade(config, "head")
