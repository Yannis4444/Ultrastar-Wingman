import asyncio
import shutil
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import cast

import pytest
from fastapi import FastAPI, WebSocket
from httpx import ASGITransport, AsyncClient
from sqlalchemy import Engine, event, func, select
from sqlalchemy.engine.interfaces import DBAPIConnection
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import ConnectionPoolEntry

from ultrastar_wingman.achievements import service as achievements
from ultrastar_wingman.app import create_app
from ultrastar_wingman.auth import oidc, permissions
from ultrastar_wingman.auth.deps import COOKIE_NAME
from ultrastar_wingman.auth.model import User, UserSession, utcnow
from ultrastar_wingman.auth.service import SESSION_TTL, token_hash
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.db import run_migrations
from ultrastar_wingman.devices import service as devices
from ultrastar_wingman.events import event_bus
from ultrastar_wingman.karaoke import selection, usdx_paths, usdx_window
from ultrastar_wingman.music import service as music
from ultrastar_wingman.players import service as players
from ultrastar_wingman.songs import scanner
from ultrastar_wingman.sources import usdb

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


@event.listens_for(Engine, "connect")
def _no_durability(dbapi_connection: DBAPIConnection, _record: ConnectionPoolEntry) -> None:
    """Test databases need no protection from a power cut: without these, every commit is a
    journal file created, synced and deleted, and that was most of what migrating and writing
    cost. Neither pragma changes what a statement does, and neither is stored in the file.

    Every engine in the process, the app's and the migration tests' alike — all of them SQLite.
    A plain `sqlite3.connect` (USDX's database, the migration tests' peeks) is not an engine.
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA synchronous = OFF")
    cursor.execute("PRAGMA journal_mode = MEMORY")
    cursor.close()


@pytest.fixture(scope="session")
def migrated_database(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A database file alembic took to head, once per test session.

    Walking every revision on an empty file is most of what a test's setup used to cost, and
    its result depends on nothing but the revision chain, so `bootstrap_settings` copies this
    file instead. The app still runs `run_migrations` over the copy, which finds it at head.
    In a thread of its own: `migrations/env.py` calls `asyncio.run`, and a pytest-asyncio
    loop may be the current one in this thread.
    """
    directory = tmp_path_factory.mktemp("migrated")
    database_url = BootstrapSettings(
        data_dir=directory,
        open_browser=False,
        frontend_dir=directory / "no-frontend",
        usdx_dir=None,
    ).database_url
    with ThreadPoolExecutor(max_workers=1) as pool:
        pool.submit(asyncio.run, run_migrations(database_url)).result()
    # A journal left beside it would be a half-written database, and only the file is copied.
    assert [path.name for path in directory.iterdir()] == ["wingman.db"]
    return directory / "wingman.db"


@pytest.fixture
def bootstrap_settings(tmp_path: Path, migrated_database: Path) -> BootstrapSettings:
    """Bootstrap config pointing at a throwaway data dir, holding a fresh database of its own
    that is already at head (a copy of `migrated_database`).

    `open_browser=False`: the default is on, and the suite must not spawn a browser per test.
    `frontend_dir`: a path with no build in it, so whether somebody ran `npm run build` does
    not decide whether the SPA fallback is mounted. `test_frontend` points it at a build.
    `usdx_dir=None`: a `WINGMAN_USDX_DIR` in the shell must not run the whole suite in the
    bundled mode. `test_usdx_bundled` builds its own.
    """
    settings = BootstrapSettings(
        data_dir=tmp_path,
        open_browser=False,
        frontend_dir=tmp_path / "no-frontend",
        usdx_dir=None,
    )
    shutil.copyfile(migrated_database, settings.database_path)
    return settings


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
def no_bundled_usdx() -> None:
    """The bundled Ultrastar Deluxe is module state the lifespan sets, and a test that calls
    the sing flow on a bare `session` runs no lifespan — it must not inherit the mode a
    previous test's app left behind."""
    usdx_paths.configure(None)


@pytest.fixture(autouse=True)
def no_desktop(monkeypatch: pytest.MonkeyPatch) -> None:
    """A launch puts the started program's window in front. The fake USDX shows none, but
    a test run must never reach for the developer's real desktop all the same — the window
    logic is tested against a fake one in `test_usdx_window.py`."""
    monkeypatch.setattr(usdx_window, "system_desktop", lambda: None)


@pytest.fixture(autouse=True)
def fresh_achievement_pass_state() -> None:
    """Same reasoning as the scan lock above — the write lock that serialises the achievement
    passes is module-global, and so is the set of passes still running. A task left over from
    a previous test belongs to a loop that is gone.
    """
    achievements._write_lock = asyncio.Lock()
    achievements._passes.clear()


@pytest.fixture(autouse=True)
def fresh_selection_state() -> None:
    """Same reasoning as the scan lock above — the open player selection, its lock and the
    countdown it may have started are module-global, while every test brings its own event
    loop and its own database. A selection left behind would lock the next test's room.
    """
    for task in selection._auto_start_tasks:
        task.cancel()
    selection._auto_start_tasks.clear()
    selection._selection = None
    selection._lock = asyncio.Lock()
    # And the idle time, which the devices watchdog writes from a setting at startup: a test
    # that shortened it must not shorten the next test's room.
    selection._idle_ttl = selection.DEFAULT_IDLE_TTL


@pytest.fixture(autouse=True)
def fresh_devices_state() -> None:
    """Same reasoning as the selection above — the last report of every player selector and
    the lock around it are module-global, while every test brings its own event loop and its
    own database. A device left behind would still be online for the next test."""
    devices._live.clear()
    devices._lock = asyncio.Lock()


@pytest.fixture(autouse=True)
def fresh_music_state() -> None:
    """Same reasoning again: the track, the sink lease and the cached options are module
    state, while every test brings its own event loop and its own database. Music left
    playing would still be playing in the next test."""
    music._track = None
    music._last_song_id = None
    music._sink = None
    music._sink_generation = 0
    music._preview = None
    music._paused = False
    music._sing_running = False
    music._usdx_open = False
    music._resume_at = None
    music._retry_at = None
    music._errors = 0
    music._options = music.DEFAULT_OPTIONS
    music._volumes = music.DEFAULT_VOLUMES
    music._lock = asyncio.Lock()
    music._watchdog = None


@pytest.fixture(autouse=True)
def fresh_avatar_lock() -> None:
    """Same reasoning as the scan lock above: the lock every avatar write takes is
    module-global, and a login racing an upload contends for it."""
    players._avatar_lock = asyncio.Lock()


@pytest.fixture(autouse=True)
def fresh_permission_cache() -> None:
    """The role/capability cache is module-global while every test has its own database."""
    permissions.invalidate_cache()


@pytest.fixture(autouse=True)
def fresh_usdb_covers() -> None:
    """The proxied USDB covers are cached module-globally, while every test brings its own
    fake USDB — a leftover entry would answer for the next one's."""
    usdb._cover_cache.clear()


@pytest.fixture(autouse=True)
def fresh_oidc_state() -> None:
    """Pending login attempts and the discovery/JWKS caches are module-global too, while
    every test brings its own database and its own fake provider."""
    oidc.reset_state()
