"""FastAPI application factory."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.routing import APIRoute
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from . import APP_NAME, __version__
from .api import router
from .config import BootstrapSettings, get_bootstrap_settings
from .db import run_migrations
from .downloads import service as downloads
from .karaoke import service as karaoke
from .songs import scanner
from .sources import usdb

API_PREFIX = "/api/v1"

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: BootstrapSettings = app.state.bootstrap_settings
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    logger.info("data directory: %s", settings.data_dir)
    await run_migrations(settings.database_url)
    engine = create_async_engine(settings.database_url)
    app.state.session_factory = async_sessionmaker(engine, expire_on_commit=False)
    # Pick up library changes made while Wingman was down, without delaying startup.
    scanner.start_scan(app.state.session_factory)
    # Before the queue: a re-queued USDB download starts running the moment it is enqueued.
    usdb.configure(app.state.session_factory, settings.data_dir)
    # Picks up downloads the last run left pending, and fails the one it interrupted.
    await downloads.start(app.state.session_factory)
    try:
        yield
    finally:
        await downloads.stop()
        await usdb.aclose()
        # Before the engine goes: a scan or a score import outliving it would fail on a
        # dead connection pool. Ending the karaoke session kills a running song — the
        # alternative is losing its scores, which is worse.
        await scanner.stop_scan()
        await karaoke.shutdown()
        await engine.dispose()


def operation_id(route: APIRoute) -> str:
    """Name generated client methods after the handler (`listSettings`), not FastAPI's
    default name+path mangling (`listSettingsApiV1SettingsGet`). Handler names must stay
    unique across routers — FastAPI warns about duplicate operation ids."""
    return route.name


def create_app(settings: BootstrapSettings | None = None) -> FastAPI:
    app = FastAPI(
        title=APP_NAME,
        version=__version__,
        lifespan=lifespan,
        # The schema is part of the versioned API: the frontend's client generator reads it there.
        openapi_url=f"{API_PREFIX}/openapi.json",
        generate_unique_id_function=operation_id,
    )
    app.state.bootstrap_settings = settings or get_bootstrap_settings()
    app.include_router(router, prefix=API_PREFIX)
    return app
