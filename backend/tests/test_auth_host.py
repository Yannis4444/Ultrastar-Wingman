"""Host-UI trust: the one-time token Wingman puts into the URL it opens itself.

The old app trusted `X-Forwarded-For` to decide who the host was, which any client can set.
"""

import logging
import threading
import webbrowser
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from conftest import BASE_URL
from ultrastar_wingman.app import create_app
from ultrastar_wingman.auth.deps import COOKIE_NAME
from ultrastar_wingman.auth.permissions import ALL_CAPABILITIES
from ultrastar_wingman.auth.service import HostToken
from ultrastar_wingman.config import BootstrapSettings


async def _client(app: object) -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL) as client:  # type: ignore[arg-type]
        yield client


def test_the_host_token_is_consumed_by_the_first_correct_guess() -> None:
    token = HostToken()
    raw = token.unused
    assert raw is not None

    assert token.consume("wrong") is False
    # A non-ASCII guess is just wrong, not a crash: secrets.compare_digest raises TypeError
    # on such a str, which used to turn into a 500 from POST /auth/host.
    assert token.consume("törökén") is False
    assert token.consume(raw) is True
    # Single use: the URL in a log file or a shell history is worthless afterwards.
    assert token.consume(raw) is False
    assert token.unused is None


def test_using_the_host_link_is_logged_without_the_token(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO, logger="ultrastar_wingman.auth.service")
    token = HostToken()
    raw = token.unused
    assert raw is not None

    token.consume("wrong")
    token.consume(raw)
    token.consume(raw)

    lines = [record.getMessage() for record in caplog.records]
    assert lines == [
        "A host link with a wrong token was refused",
        "The host link was used: that browser is the host screen now",
        "The host link was opened again: it works only once",
    ]
    assert not any(raw in line for line in lines)


async def test_the_host_url_is_always_logged(
    bootstrap_settings: BootstrapSettings, caplog: pytest.LogCaptureFixture
) -> None:
    """Whoever sits at the machine must be able to paste the URL when no browser opened."""
    caplog.set_level(logging.INFO, logger="ultrastar_wingman.app")
    app = create_app(bootstrap_settings)

    async with app.router.lifespan_context(app):
        token = app.state.host_token.unused

    logged = [record.getMessage() for record in caplog.records if "Host UI" in record.getMessage()]
    assert logged == [f"Host UI: http://localhost:{bootstrap_settings.port}/host?hostToken={token}"]


async def test_the_browser_is_only_opened_when_it_is_switched_on(
    tmp_path_factory: pytest.TempPathFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    opened = threading.Event()
    urls: list[str] = []

    def fake_open(url: str, *args: object, **kwargs: object) -> bool:
        urls.append(url)
        opened.set()
        return True

    monkeypatch.setattr(webbrowser, "open", fake_open)

    quiet = BootstrapSettings(data_dir=tmp_path_factory.mktemp("quiet"), open_browser=False)
    app = create_app(quiet)
    async with app.router.lifespan_context(app):
        pass
    assert urls == []

    loud = BootstrapSettings(data_dir=tmp_path_factory.mktemp("loud"), open_browser=True)
    app = create_app(loud)
    async with app.router.lifespan_context(app):
        token = app.state.host_token.unused
        # The browser is opened from a thread so startup does not wait for a GUI process.
        assert opened.wait(timeout=5.0)
    assert urls == [f"http://localhost:{loud.port}/host?hostToken={token}"]


async def test_the_token_makes_the_browser_an_admin_and_survives_a_restart(
    bootstrap_settings: BootstrapSettings,
) -> None:
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        token = app.state.host_token.unused
        async for client in _client(app):
            response = await client.post("/api/v1/auth/host", json={"token": token})

            assert response.status_code == 200
            assert response.json() == {
                "user": None,
                "role": "admin",
                "capabilities": sorted(ALL_CAPABILITIES),
                "is_host": True,
            }
            host_cookie = client.cookies.get(COOKIE_NAME)
            assert host_cookie is not None
            # Being admin is not just a claim in the payload — the routes agree.
            assert (await client.get("/api/v1/permissions")).status_code == 200

            # Single use, and a wrong guess never worked in the first place.
            assert (
                await client.post("/api/v1/auth/host", json={"token": token})
            ).status_code == 401
            assert (
                await client.post("/api/v1/auth/host", json={"token": "nope"})
            ).status_code == 401
            # Not a 500: see the non-ASCII case in the unit test above.
            assert (
                await client.post("/api/v1/auth/host", json={"token": "törökén"})
            ).status_code == 401

    restarted = create_app(bootstrap_settings)
    async with restarted.router.lifespan_context(restarted):
        # A restart mints a new token; the session row it already handed out stays valid.
        assert restarted.state.host_token.unused != token
        async for client in _client(restarted):
            me = await client.get(
                "/api/v1/auth/me", headers={"Cookie": f"{COOKIE_NAME}={host_cookie}"}
            )
            assert me.status_code == 200
            assert me.json()["is_host"] is True
            assert me.json()["role"] == "admin"


async def test_a_stale_token_from_a_previous_run_is_refused(
    bootstrap_settings: BootstrapSettings,
) -> None:
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        stale = app.state.host_token.unused

    restarted = create_app(bootstrap_settings)
    async with restarted.router.lifespan_context(restarted):
        async for client in _client(restarted):
            assert (
                await client.post("/api/v1/auth/host", json={"token": stale})
            ).status_code == 401
