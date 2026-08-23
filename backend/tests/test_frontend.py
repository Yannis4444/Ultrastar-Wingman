"""Serving the built frontend from the backend, and finding it in a PyInstaller bundle."""

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from conftest import BASE_URL
from ultrastar_wingman.app import create_app
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.db import migrations_dir
from ultrastar_wingman.frontend import resolve_frontend_dir

INDEX_HTML = '<!doctype html><div id="root"></div><script type="module" src="/assets/app.js">'


@pytest.fixture
def dist(tmp_path: Path) -> Path:
    """A fake `frontend/dist`: an entry point and one hashed asset."""
    directory = tmp_path / "dist"
    (directory / "assets").mkdir(parents=True)
    (directory / "index.html").write_text(INDEX_HTML, encoding="utf-8")
    (directory / "assets" / "app.js").write_text("export const app = 1;", encoding="utf-8")
    return directory


@pytest.fixture
async def spa_client(tmp_path: Path, dist: Path) -> AsyncIterator[AsyncClient]:
    settings = BootstrapSettings(data_dir=tmp_path, open_browser=False, frontend_dir=dist)
    app = create_app(settings)
    async with (
        app.router.lifespan_context(app),
        AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL) as client,
    ):
        yield client


async def test_a_client_side_route_returns_the_spa_entry_point(spa_client: AsyncClient) -> None:
    response = await spa_client.get("/songs")

    assert response.status_code == 200
    assert response.text == INDEX_HTML
    assert response.headers["content-type"].startswith("text/html")
    # Asset names are content-hashed, index.html is not: a cached one would keep loading the
    # assets of the version it was built with.
    assert response.headers["cache-control"] == "no-cache"


async def test_an_asset_is_served_as_itself(spa_client: AsyncClient) -> None:
    response = await spa_client.get("/assets/app.js")

    assert response.status_code == 200
    assert response.text == "export const app = 1;"
    # Windows maps .js to text/plain in the registry, and browsers refuse a module script
    # that is not JavaScript — the packaged app would show a blank page.
    assert response.headers["content-type"].startswith("text/javascript")


async def test_the_api_still_answers_with_json(spa_client: AsyncClient) -> None:
    response = await spa_client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json()["version"]


async def test_an_unknown_api_path_stays_a_json_404(spa_client: AsyncClient) -> None:
    response = await spa_client.get("/api/v1/nope")

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


async def test_a_path_escaping_the_dist_directory_gets_the_spa(
    spa_client: AsyncClient, tmp_path: Path
) -> None:
    (tmp_path / "secret.txt").write_text("nope", encoding="utf-8")

    response = await spa_client.get("/..%2Fsecret.txt")

    assert response.status_code == 200
    assert response.text == INDEX_HTML


async def test_without_a_build_unknown_paths_are_404(anonymous_client: AsyncClient) -> None:
    """The `bootstrap_settings` fixture points at a directory with no build in it — which is
    also how `npm run dev` runs: vite serves the frontend, the backend serves the API only."""
    response = await anonymous_client.get("/songs")

    assert response.status_code == 404
    assert (await anonymous_client.get("/api/v1/health")).status_code == 200


def test_an_explicit_frontend_dir_without_a_build_does_not_fall_back(dist: Path) -> None:
    # Would otherwise silently serve the repo's frontend/dist instead of what was configured.
    assert resolve_frontend_dir(dist.parent) is None
    assert resolve_frontend_dir(dist) == dist


def test_frozen_the_frontend_and_migrations_come_from_the_bundle(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """What the PyInstaller build has to put where: the spec's `datas` destinations."""
    monkeypatch.setattr("sys._MEIPASS", str(tmp_path), raising=False)
    (tmp_path / "frontend").mkdir()
    (tmp_path / "frontend" / "index.html").write_text(INDEX_HTML, encoding="utf-8")

    assert resolve_frontend_dir() == tmp_path / "frontend"
    assert migrations_dir() == tmp_path / "ultrastar_wingman" / "migrations"
