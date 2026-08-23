import asyncio
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path
from typing import cast

import pytest
from fastapi import FastAPI, WebSocket
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from ultrastar_wingman.app import create_app
from ultrastar_wingman.auth import permissions
from ultrastar_wingman.auth.deps import COOKIE_NAME
from ultrastar_wingman.auth.model import User, UserSession, utcnow
from ultrastar_wingman.auth.service import SESSION_TTL, token_hash
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.db import run_migrations
from ultrastar_wingman.events import event_bus
from ultrastar_wingman.songs import scanner

FIXTURES = Path(__file__).parent / "fixtures"

BASE_URL = "http://wingman.test"

# Every capability-gated route needs an authenticated caller now, so the default `client`
# is an admin. The account is inserted directly instead of registered through the API:
# registering would also create a player and change what player tests see.
ADMIN_USERNAME = "test-admin"
ADMIN_TOKEN = "test-admin-session-token"

ADMIN_PASSWORD = "wingman-test-password"
# Precomputed: argon2 is deliberately slow, and hashing it once per test would dominate
# the suite runtime. `test_auth_api` covers hashing a real password.
ADMIN_PASSWORD_HASH = (
    "$argon2id$v=19$m=65536,t=3,p=4$w2/hFLWg0+k5kXBvJdpegg$"
    "2xvJfB4ELTSQ3DgSOt890U3Rj5xJ1px0KENnE382Az8"
)


@pytest.fixture
def bootstrap_settings(tmp_path: Path) -> BootstrapSettings:
    """Bootstrap config pointing at a throwaway data dir (so a fresh DB per test).

    `open_browser=False`: the default is on, and the suite must not spawn a browser per test.
    """
    return BootstrapSettings(data_dir=tmp_path, open_browser=False)


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
async def broadcast_events() -> AsyncIterator[list[dict[str, object]]]:
    """Records everything the event bus broadcasts while the test runs."""
    events: list[dict[str, object]] = []

    class Recorder:
        async def accept(self) -> None:
            return None

        async def send_json(self, message: dict[str, object]) -> None:
            events.append(message)

    socket = cast(WebSocket, Recorder())
    await event_bus.connect(socket)
    try:
        yield events
    finally:
        event_bus.disconnect(socket)


async def add_user(
    session_factory: async_sessionmaker[AsyncSession],
    username: str,
    role: str,
    password_hash: str = ADMIN_PASSWORD_HASH,
) -> str:
    """Insert an account straight into the database and return its id."""
    async with session_factory() as session:
        user = User(username=username, password_hash=password_hash, role=role)
        session.add(user)
        await session.commit()
        return user.id


async def add_session(
    session_factory: async_sessionmaker[AsyncSession],
    raw_token: str,
    user_id: str | None = None,
    is_host: bool = False,
    last_seen_at: datetime | None = None,
    expires_at: datetime | None = None,
) -> None:
    now = utcnow()
    async with session_factory() as session:
        session.add(
            UserSession(
                token_hash=token_hash(raw_token),
                user_id=user_id,
                is_host=is_host,
                created_at=now,
                last_seen_at=last_seen_at or now,
                expires_at=expires_at or now + SESSION_TTL,
            )
        )
        await session.commit()


async def authenticate_admin(app: FastAPI) -> str:
    """Give `ADMIN_TOKEN` an admin session on this app's database, and return the token.

    Idempotent: a restart test runs a second lifespan over the same data dir.
    """
    session_factory: async_sessionmaker[AsyncSession] = app.state.session_factory
    async with session_factory() as session:
        existing = await session.scalar(
            select(func.count())
            .select_from(UserSession)
            .where(UserSession.token_hash == token_hash(ADMIN_TOKEN))
        )
    if existing:
        return ADMIN_TOKEN
    user_id = await add_user(session_factory, ADMIN_USERNAME, permissions.ADMIN)
    await add_session(session_factory, ADMIN_TOKEN, user_id)
    return ADMIN_TOKEN


def admin_client(app: FastAPI) -> AsyncClient:
    return AsyncClient(
        transport=ASGITransport(app=app), base_url=BASE_URL, cookies={COOKIE_NAME: ADMIN_TOKEN}
    )


@pytest.fixture
async def client(bootstrap_settings: BootstrapSettings) -> AsyncIterator[AsyncClient]:
    """The real app, migrations included — ASGITransport does not run the lifespan itself.

    Authenticated as an administrator: use `anonymous_client` to test what a guest may do.
    """
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await authenticate_admin(app)
        async with admin_client(app) as client:
            yield client


@pytest.fixture
async def anonymous_client(bootstrap_settings: BootstrapSettings) -> AsyncIterator[AsyncClient]:
    """The app with no session cookie and no accounts at all — a first-run Wingman."""
    app = create_app(bootstrap_settings)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL) as client,
    ):
        yield client


@pytest.fixture(autouse=True)
def fresh_scan_lock() -> None:
    """An asyncio lock binds to the first event loop that has to *wait* for it, and
    pytest-asyncio gives every test its own loop — one shared lock would poison every
    later test that contends for it."""
    scanner._scan_lock = asyncio.Lock()


@pytest.fixture(autouse=True)
def fresh_permission_cache() -> None:
    """The role/capability cache is module-global while every test has its own database."""
    permissions.invalidate_cache()
