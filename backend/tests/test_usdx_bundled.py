"""A Wingman that brings its own Ultrastar Deluxe (the bundled mode).

Where the directory comes from (`--usdx-dir`, `WINGMAN_USDX_DIR`, a frozen build's own
`usdx` folder), what it does to the path resolution, the settings and the status, and the
songs folder a fresh install is given.
"""

import socket
import sys
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from conftest import BASE_URL, admin_client, authenticate_admin
from ultrastar_wingman import __main__ as entry_point
from ultrastar_wingman.app import create_app
from ultrastar_wingman.config import BootstrapSettings, get_bootstrap_settings
from ultrastar_wingman.karaoke import service as karaoke_service
from ultrastar_wingman.karaoke import usdx_paths
from ultrastar_wingman.settings import SettingsService

USDX_KEYS = (
    "usdx.base_path",
    "usdx.executable",
    "usdx.config_file",
    "usdx.avatars_dir",
    "usdx.ultrastar_db",
    "usdx.songs_dir",
)


def make_usdx(directory: Path) -> Path:
    """A bundled Ultrastar Deluxe as far as Wingman can tell: the program is there. Nothing
    is ever started from it, so an empty file does."""
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "ultrastardx.exe").touch()
    return directory


def settings_for(tmp_path: Path, usdx_dir: Path | None) -> BootstrapSettings:
    return BootstrapSettings(
        data_dir=tmp_path / "data",
        open_browser=False,
        frontend_dir=tmp_path / "no-frontend",
        usdx_dir=usdx_dir,
    )


@dataclass
class Bundled:
    app: FastAPI
    client: AsyncClient
    usdx: Path


async def _start(settings: BootstrapSettings) -> AsyncIterator[tuple[FastAPI, AsyncClient]]:
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        await authenticate_admin(app)
        async with admin_client(app) as client:
            yield app, client


@pytest.fixture
async def bundled(tmp_path: Path) -> AsyncIterator[Bundled]:
    usdx = make_usdx(tmp_path / "usdx")
    async for app, client in _start(settings_for(tmp_path, usdx)):
        yield Bundled(app=app, client=client, usdx=usdx)


# --- where the directory comes from --------------------------------------------------------


@pytest.fixture
def clean_bootstrap(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """No variable from the shell, and no cached settings either side of the test: the
    entry point writes the variable and fills the cache."""
    monkeypatch.delenv("WINGMAN_USDX_DIR", raising=False)
    get_bootstrap_settings.cache_clear()
    yield
    get_bootstrap_settings.cache_clear()


def _frozen(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Pretend to be the PyInstaller build in `tmp_path`, and return its `usdx` folder."""
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(tmp_path / "UltrastarWingman.exe"))
    return tmp_path / "usdx"


@pytest.mark.usefixtures("clean_bootstrap")
def test_nothing_is_bundled_when_running_from_source(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Not frozen: a `usdx` folder next to the interpreter is a coincidence, not a bundle."""
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.setattr(sys, "executable", str(tmp_path / "python.exe"))
    make_usdx(tmp_path / "usdx")

    assert BootstrapSettings(_env_file=None).usdx_dir is None  # type: ignore[call-arg]


@pytest.mark.usefixtures("clean_bootstrap")
def test_a_frozen_build_finds_the_usdx_beside_it(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    usdx = make_usdx(_frozen(monkeypatch, tmp_path))

    assert BootstrapSettings(_env_file=None).usdx_dir == usdx  # type: ignore[call-arg]


@pytest.mark.usefixtures("clean_bootstrap")
def test_a_usdx_folder_without_the_program_is_not_a_bundle(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _frozen(monkeypatch, tmp_path).mkdir()

    assert BootstrapSettings(_env_file=None).usdx_dir is None  # type: ignore[call-arg]


@pytest.mark.usefixtures("clean_bootstrap")
def test_the_variable_beats_the_frozen_build(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    make_usdx(_frozen(monkeypatch, tmp_path))
    elsewhere = tmp_path / "elsewhere"
    monkeypatch.setenv("WINGMAN_USDX_DIR", str(elsewhere))

    assert BootstrapSettings(_env_file=None).usdx_dir == elsewhere  # type: ignore[call-arg]


@pytest.mark.usefixtures("clean_bootstrap")
def test_an_empty_variable_switches_the_frozen_build_off(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Not `Path("")`, which is the working directory, and not the copy beside the exe: an
    explicitly empty value says "point me at my own"."""
    make_usdx(_frozen(monkeypatch, tmp_path))
    monkeypatch.setenv("WINGMAN_USDX_DIR", "")

    assert BootstrapSettings(_env_file=None).usdx_dir is None  # type: ignore[call-arg]


class _Served:
    """`main` with no server behind it: the app it would have served. The configured port
    may well be held by the Wingman this machine runs for real, so nothing is bound either:
    `listen` hands out a socket that never was, and the stub checks it is what the server
    got."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.apps: list[object] = []
        self.taken = [socket.socket()]
        monkeypatch.setattr(entry_point.startup, "listen", lambda *_: self.taken)
        monkeypatch.setattr(entry_point.startup, "WingmanServer", self._server)
        # The console's handler would outlive the test on a stream pytest closes afterwards.
        # True: uvicorn's access log on, which leaves its loggers as they are.
        monkeypatch.setattr(entry_point.console, "configure", lambda *_: True)

    def _server(self, config: Any) -> Any:
        served = self

        class Server:
            started = True

            def run(self, sockets: list[socket.socket] | None = None) -> None:
                assert sockets is served.taken
                served.apps.append(config.app)

        return Server()


@pytest.mark.usefixtures("clean_bootstrap")
def test_the_argument_beats_the_variable(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    make_usdx(_frozen(monkeypatch, tmp_path))
    monkeypatch.setenv("WINGMAN_USDX_DIR", str(tmp_path / "from-the-variable"))
    served = _Served(monkeypatch)

    entry_point.main(["--usdx-dir", str(tmp_path / "from-the-argument")])

    assert served.apps == ["ultrastar_wingman.app:create_app"]
    # What `create_app()` reads when uvicorn calls it without arguments.
    assert get_bootstrap_settings().usdx_dir == tmp_path / "from-the-argument"


@pytest.mark.usefixtures("clean_bootstrap")
def test_without_the_argument_the_entry_point_leaves_the_variable_alone(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("WINGMAN_USDX_DIR", str(tmp_path / "from-the-variable"))
    served = _Served(monkeypatch)

    entry_point.main([])

    assert served.apps == ["ultrastar_wingman.app:create_app"]
    assert get_bootstrap_settings().usdx_dir == tmp_path / "from-the-variable"


def test_a_relative_directory_is_made_absolute(tmp_path: Path) -> None:
    settings = BootstrapSettings(_env_file=None, usdx_dir=Path("usdx"))  # type: ignore[call-arg]

    assert settings.usdx_dir is not None
    assert settings.usdx_dir.is_absolute()


# --- path resolution -----------------------------------------------------------------------


async def test_every_path_is_derived_from_the_bundled_directory(
    session: AsyncSession, tmp_path: Path
) -> None:
    """Overrides from an earlier life of this database are ignored, every one of them: they
    are not offered any more, so nobody could see why a song went somewhere else."""
    usdx = make_usdx(tmp_path / "usdx")
    library = tmp_path / "library"
    library.mkdir()
    settings = SettingsService(session)
    for key in USDX_KEYS:
        await settings.set(key, str(tmp_path / "stale" / key))
    await settings.set("songs.directory", str(library))
    usdx_paths.configure(usdx)

    paths = await usdx_paths.resolve_usdx_paths(session)

    assert paths == usdx_paths.UsdxPaths(
        executable=usdx / "ultrastardx.exe",
        config_file=usdx / "config.ini",
        avatars_dir=usdx / "avatars",
        ultrastar_db=usdx / "Ultrastar.db",
        songs_dir=usdx / "songs",
    )


async def test_the_songs_directory_is_still_checked_in_the_bundled_mode(
    session: AsyncSession, tmp_path: Path
) -> None:
    usdx_paths.configure(make_usdx(tmp_path / "usdx"))

    with pytest.raises(usdx_paths.UsdxPathsError) as raised:
        await usdx_paths.resolve_usdx_paths(session)

    assert raised.value.problems == ["'songs.directory' is not set"]


async def test_a_missing_bundled_program_names_no_setting(
    session: AsyncSession, tmp_path: Path
) -> None:
    """There is no setting to fix, so the problem must not read like one."""
    usdx = tmp_path / "usdx"
    usdx.mkdir()
    await SettingsService(session).set("songs.directory", str(usdx))
    usdx_paths.configure(usdx)

    with pytest.raises(usdx_paths.UsdxPathsError) as raised:
        await usdx_paths.resolve_usdx_paths(session)

    assert raised.value.problems == [
        f"the bundled Ultrastar Deluxe is missing: {usdx / 'ultrastardx.exe'}"
    ]


# --- settings ------------------------------------------------------------------------------


async def test_the_usdx_settings_are_not_listed(bundled: Bundled) -> None:
    response = await bundled.client.get("/api/v1/settings")

    assert response.status_code == 200
    keys = {row["key"] for row in response.json()}
    assert keys.isdisjoint(USDX_KEYS)
    # The library is still the host's to choose.
    assert "songs.directory" in keys


async def test_the_usdx_settings_are_listed_without_a_bundle(client: AsyncClient) -> None:
    keys = {row["key"] for row in (await client.get("/api/v1/settings")).json()}

    assert set(USDX_KEYS) <= keys


@pytest.mark.parametrize("key", USDX_KEYS)
async def test_a_usdx_setting_cannot_be_written(bundled: Bundled, key: str) -> None:
    for value in ("C:\\somewhere", None):
        response = await bundled.client.patch(f"/api/v1/settings/{key}", json={"value": value})

        assert response.status_code == 409
        assert response.json() == {"detail": "usdx_bundled"}


async def test_an_unknown_usdx_key_is_still_unknown(bundled: Bundled) -> None:
    response = await bundled.client.patch("/api/v1/settings/usdx.nope", json={"value": "x"})

    assert response.status_code == 404


# --- status --------------------------------------------------------------------------------


async def test_the_status_says_bundled_and_names_the_directory_for_a_host(
    bundled: Bundled,
) -> None:
    response = await bundled.client.get("/api/v1/karaoke/status")

    assert response.status_code == 200
    assert response.json() == {
        "configured": True,
        "problems": [],
        "bundled": True,
        "usdx_dir": str(bundled.usdx),
    }


async def test_the_status_keeps_the_directory_from_a_guest(bundled: Bundled) -> None:
    """A guest learns that singing works and that nothing needs setting up — not where on
    the host's disk anything is."""
    async with AsyncClient(
        transport=ASGITransport(app=bundled.app), base_url=BASE_URL
    ) as anonymous:
        response = await anonymous.get("/api/v1/karaoke/status")

    assert response.status_code == 200
    assert response.json() == {
        "configured": True,
        "problems": [],
        "bundled": True,
        "usdx_dir": None,
    }


# --- the songs folder of a fresh install --------------------------------------------------


async def test_a_fresh_install_sings_out_of_the_bundled_songs_folder(bundled: Bundled) -> None:
    session_factory: async_sessionmaker[AsyncSession] = bundled.app.state.session_factory
    async with session_factory() as session:
        directory = await SettingsService(session).get("songs.directory")

    assert directory == str(bundled.usdx / "songs")
    assert (bundled.usdx / "songs").is_dir()


async def test_the_seed_never_overwrites_a_folder_the_host_chose(tmp_path: Path) -> None:
    usdx = make_usdx(tmp_path / "usdx")
    settings = settings_for(tmp_path, usdx)
    chosen = tmp_path / "my-songs"
    chosen.mkdir()

    async for _, client in _start(settings):
        response = await client.patch(
            "/api/v1/settings/songs.directory", json={"value": str(chosen)}
        )
        assert response.status_code == 200
    # A restart: the seed looks again, and finds the host's folder.
    async for app, _ in _start(settings):
        session_factory: async_sessionmaker[AsyncSession] = app.state.session_factory
        async with session_factory() as session:
            assert await SettingsService(session).get("songs.directory") == str(chosen)


async def test_the_seed_leaves_a_folder_from_before_the_bundle_alone(
    session: AsyncSession, tmp_path: Path, bootstrap_settings: BootstrapSettings
) -> None:
    """A database that already had a library, started by a build that brings USDX."""
    chosen = tmp_path / "my-songs"
    chosen.mkdir()
    await SettingsService(session).set("songs.directory", str(chosen))
    usdx = make_usdx(tmp_path / "usdx")

    async for _, _client in _start(bootstrap_settings.model_copy(update={"usdx_dir": usdx})):
        pass

    session.expire_all()  # a fresh read, not the identity map's
    assert await SettingsService(session).get("songs.directory") == str(chosen)
    assert not (usdx / "songs").exists()


async def test_nothing_is_seeded_without_a_bundle(session: AsyncSession) -> None:
    assert await usdx_paths.seed_songs_directory(session) is None
    assert await SettingsService(session).get("songs.directory") == ""


async def test_the_seed_conjures_no_missing_usdx_folder(
    session: AsyncSession, tmp_path: Path
) -> None:
    """A mistyped `--usdx-dir` (or a drive that is not plugged in): Wingman still starts, but
    it creates no empty tree where the host never meant one, and stores no folder that is
    not there."""
    usdx = tmp_path / "typo" / "usdx"
    usdx_paths.configure(usdx)

    seeded = await usdx_paths.seed_songs_directory(session)

    assert seeded is None
    assert await SettingsService(session).get("songs.directory") == ""
    assert not (tmp_path / "typo").exists()


async def test_the_seed_tries_again_on_the_next_start(
    session: AsyncSession, tmp_path: Path
) -> None:
    """The drive was not plugged in at the first start; at the next one it is."""
    usdx = tmp_path / "drive" / "usdx"
    usdx_paths.configure(usdx)
    assert await usdx_paths.seed_songs_directory(session) is None

    make_usdx(usdx)
    seeded = await usdx_paths.seed_songs_directory(session)

    assert seeded == usdx / "songs"
    assert (usdx / "songs").is_dir()
    assert await SettingsService(session).get("songs.directory") == str(usdx / "songs")


async def test_without_a_bundle_the_usdx_group_is_one_path_and_five_overrides(
    client: AsyncClient,
) -> None:
    rows = {
        row["key"]: row
        for row in (await client.get("/api/v1/settings")).json()
        if row["key"] in USDX_KEYS
    }

    assert [key for key in USDX_KEYS if not rows[key]["advanced"]] == ["usdx.base_path"]
    assert len([key for key in USDX_KEYS if rows[key]["advanced"]]) == 5


# --- the Launch row ------------------------------------------------------------------------


class RecordingLauncher:
    """Stands in for `UsdxLauncher`: the bundled program is an empty file, and nothing may
    start the real one anyway."""

    launched: list[usdx_paths.UsdxPaths] = []

    def __init__(self, paths: usdx_paths.UsdxPaths, on_exit: Any = None) -> None:
        self.paths = paths
        self.on_exit = on_exit
        self._running = False

    @property
    def is_running(self) -> bool:
        return self._running

    async def start_standalone(self) -> None:
        self._running = True
        RecordingLauncher.launched.append(self.paths)

    async def stop(self) -> None:
        self._running = False
        if self.on_exit is not None:
            await self.on_exit()


async def test_launch_starts_the_bundled_usdx(
    bundled: Bundled, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The microphones still live in USDX alone, so the Launch row has to work without a
    single USDX setting."""
    monkeypatch.setattr(RecordingLauncher, "launched", [])
    monkeypatch.setattr(karaoke_service, "UsdxLauncher", RecordingLauncher)

    response = await bundled.client.post("/api/v1/karaoke/usdx/launch")

    assert response.status_code == 200
    assert response.json() == {"started": True}
    [paths] = RecordingLauncher.launched
    assert paths.executable == bundled.usdx / "ultrastardx.exe"
    assert paths.config_file == bundled.usdx / "config.ini"
    assert paths.songs_dir == bundled.usdx / "songs"
