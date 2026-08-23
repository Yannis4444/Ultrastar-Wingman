from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from ultrastar_wingman.app import create_app
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.db import run_migrations


@pytest.fixture
def bootstrap_settings(tmp_path: Path) -> BootstrapSettings:
    """Bootstrap config pointing at a throwaway data dir (so a fresh DB per test)."""
    return BootstrapSettings(data_dir=tmp_path)


@pytest.fixture
async def session_factory(
    bootstrap_settings: BootstrapSettings,
) -> AsyncIterator[async_sessionmaker[AsyncSession]]:
    await run_migrations(bootstrap_settings.database_url)
    engine = create_async_engine(bootstrap_settings.database_url)
    try:
        yield async_sessionmaker(engine, expire_on_commit=False)
    finally:
        await engine.dispose()


@pytest.fixture
async def session(
    session_factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    async with session_factory() as session:
        yield session


@pytest.fixture
async def client(bootstrap_settings: BootstrapSettings) -> AsyncIterator[AsyncClient]:
    """The real app, migrations included — ASGITransport does not run the lifespan itself."""
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://wingman.test") as client:
            yield client
