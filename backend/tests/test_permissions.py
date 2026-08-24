"""The permission matrix — this file is the authorization spec.

Every capability-gated route appears in `ROUTES` with the capability it demands. The test
then hits each of them as an anonymous caller (role `guest`), a `user`, a `trusted` user and
an `admin`, and asserts a 403 exactly where the role does not hold that capability. A route
that loses its `require(...)` fails here; so does a role that silently gains a capability.
"""

from collections.abc import AsyncIterator, Mapping

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from conftest import BASE_URL, add_session, add_user, admin_client, authenticate_admin
from ultrastar_wingman.app import create_app
from ultrastar_wingman.auth.deps import COOKIE_NAME
from ultrastar_wingman.auth.model import RolePermission
from ultrastar_wingman.auth.permissions import (
    ALL_CAPABILITIES,
    CAPABILITIES,
    DEFAULT_ROLE_CAPABILITIES,
    ROLES,
)
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.sources import usdb
from ultrastar_wingman.sources.usdb import UsdbStatus

# (capability, method, path, body). The bodies only have to get past routing — a permitted
# caller may well answer 404 or 422, which is not a 403 and that is all this asserts.
ROUTES: list[tuple[str, str, str, dict[str, object] | None]] = [
    ("songs.view", "GET", "/api/v1/songs", None),
    ("songs.view", "GET", "/api/v1/songs/usdb:1", None),
    ("songs.view", "GET", "/api/v1/songs/usdb:1/cover", None),
    ("songs.rescan", "POST", "/api/v1/songs/rescan", None),
    ("players.view", "GET", "/api/v1/players", None),
    ("players.view", "GET", "/api/v1/players/nope/avatar", None),
    ("players.view", "GET", "/api/v1/karaoke/colors", None),
    ("players.manage", "POST", "/api/v1/players", {"name": "Someone"}),
    ("players.manage", "DELETE", "/api/v1/players/nope", None),
    ("players.manage", "PUT", "/api/v1/players/nope/avatar", None),
    ("songs.view", "GET", "/api/v1/karaoke/current", None),
    ("songs.view", "GET", "/api/v1/karaoke/status", None),
    (
        "karaoke.sing",
        "POST",
        "/api/v1/karaoke/sing",
        {"song_id": "usdb:1", "slots": [{"color": "blue"}]},
    ),
    # A forced sing kills the running song, so it needs the right to stop one as well.
    (
        "karaoke.stop",
        "POST",
        "/api/v1/karaoke/sing",
        {"song_id": "usdb:1", "slots": [{"color": "blue"}], "force": True},
    ),
    ("karaoke.stop", "POST", "/api/v1/karaoke/stop", None),
    ("wishlist.view", "GET", "/api/v1/wishlist", None),
    ("wishlist.add", "POST", "/api/v1/wishlist", {"song_id": "usdb:1"}),
    ("wishlist.add", "DELETE", "/api/v1/wishlist/usdb:1", None),
    ("playlists.view", "GET", "/api/v1/playlists", None),
    ("playlists.view", "GET", "/api/v1/playlists/nope", None),
    # POST /playlists is deliberately not here: it checks for an account first, so an
    # anonymous caller gets a 401 instead of the 403 this matrix asserts.
    ("playlists.manage", "PATCH", "/api/v1/playlists/nope", {"name": "Party"}),
    ("playlists.manage", "DELETE", "/api/v1/playlists/nope", None),
    ("playlists.manage", "POST", "/api/v1/playlists/nope/entries", {"song_id": "usdb:1"}),
    ("playlists.manage", "DELETE", "/api/v1/playlists/nope/entries/usdb:1", None),
    ("playlists.manage", "PUT", "/api/v1/playlists/nope/entries", {"song_ids": []}),
    ("downloads.view", "GET", "/api/v1/downloads", None),
    ("downloads.manage", "POST", "/api/v1/downloads", {"source": "nope", "source_song_id": "1"}),
    ("stats.view", "GET", "/api/v1/stats/sessions", None),
    ("stats.view", "GET", "/api/v1/stats/sessions/nope/scores", None),
    ("stats.view", "GET", "/api/v1/stats/songs/usdb:1/scores", None),
    ("stats.view", "GET", "/api/v1/stats/latest", None),
    ("stats.manage", "PATCH", "/api/v1/stats/sessions/nope", {"name": "Party"}),
    ("usdb.search", "GET", "/api/v1/sources/usdb/status", None),
    ("usdb.search", "GET", "/api/v1/sources/usdb/search", None),
    ("settings.view", "GET", "/api/v1/settings", None),
    ("settings.manage", "PATCH", "/api/v1/settings/usdb.username", {"value": "singer"}),
    ("users.manage", "GET", "/api/v1/users", None),
    ("users.manage", "PATCH", "/api/v1/users/nope", {"role": "user"}),
    ("users.manage", "DELETE", "/api/v1/users/nope", None),
    ("permissions.manage", "GET", "/api/v1/permissions", None),
    # The body is the role's own defaults, so a permitted caller changes nothing and the
    # remaining rows of the matrix stay meaningful.
    (
        "permissions.manage",
        "PUT",
        "/api/v1/permissions/guest",
        {"capabilities": sorted(DEFAULT_ROLE_CAPABILITIES["guest"])},
    ),
]

# What each caller in the matrix may do. Anonymous callers are the `guest` role.
IDENTITY_CAPABILITIES: Mapping[str, frozenset[str]] = {
    "anonymous": DEFAULT_ROLE_CAPABILITIES["guest"],
    "user": DEFAULT_ROLE_CAPABILITIES["user"],
    "trusted": DEFAULT_ROLE_CAPABILITIES["trusted"],
    "admin": ALL_CAPABILITIES,
}


@pytest.fixture
async def clients(
    bootstrap_settings: BootstrapSettings, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[dict[str, AsyncClient]]:
    """One app, one client per identity — never two lifespans, they fight over the scanner."""
    # A configured-looking USDB verdict, so the status route answers from cache instead of
    # trying to log in.
    monkeypatch.setattr(usdb, "_status", UsdbStatus(logged_in=False, error="no_credentials"))
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        clients = {"anonymous": AsyncClient(transport=transport, base_url=BASE_URL)}
        for role in ("user", "trusted", "admin"):
            user_id = await add_user(app.state.session_factory, f"{role}-account", role)
            token = f"{role}-session-token"
            await add_session(app.state.session_factory, token, user_id)
            clients[role] = AsyncClient(
                transport=transport, base_url=BASE_URL, cookies={COOKIE_NAME: token}
            )
        try:
            yield clients
        finally:
            for client in clients.values():
                await client.aclose()


@pytest.mark.parametrize(
    ("capability", "method", "path", "body"),
    ROUTES,
    ids=[f"{method} {path} needs {capability}" for capability, method, path, _ in ROUTES],
)
async def test_the_permission_matrix(
    clients: dict[str, AsyncClient],
    capability: str,
    method: str,
    path: str,
    body: dict[str, object] | None,
) -> None:
    for identity, held in IDENTITY_CAPABILITIES.items():
        response = await clients[identity].request(method, path, json=body)
        where = f"{identity} {method} {path}"
        if capability in held:
            assert response.status_code != 403, f"{where} was refused: {response.text}"
        else:
            assert response.status_code == 403, f"{where} was allowed: {response.text}"
            assert response.json() == {"detail": f"missing_permission:{capability}"}, where


def test_every_capability_is_enforced_somewhere() -> None:
    """A capability nobody requires is either dead or a route that forgot its check."""
    # users.manage and permissions.manage are in ROUTES; nothing may be missing.
    assert set(CAPABILITIES) == {capability for capability, _, _, _ in ROUTES}


async def test_the_migration_seeds_the_module_defaults(session: AsyncSession) -> None:
    """Migration 0006 spells the defaults out literally; this is what keeps the two in step."""
    seeded: dict[str, set[str]] = {}
    for row in await session.scalars(select(RolePermission)):
        seeded.setdefault(row.role, set()).add(row.capability)

    assert seeded == {
        role: set(capabilities) for role, capabilities in DEFAULT_ROLE_CAPABILITIES.items()
    }


async def test_get_permissions_lists_every_role(client: AsyncClient) -> None:
    response = await client.get("/api/v1/permissions")

    assert response.status_code == 200
    roles = response.json()["roles"]
    assert set(roles) == set(ROLES)
    assert roles["admin"] == sorted(ALL_CAPABILITIES)
    assert roles["guest"] == sorted(DEFAULT_ROLE_CAPABILITIES["guest"])


async def test_a_permission_change_takes_effect_without_a_restart(
    clients: dict[str, AsyncClient],
) -> None:
    assert (await clients["user"].post("/api/v1/karaoke/stop")).status_code == 204

    response = await clients["admin"].put(
        "/api/v1/permissions/user", json={"capabilities": ["songs.view"]}
    )

    assert response.status_code == 200
    assert response.json()["roles"]["user"] == ["songs.view"]
    stopped = await clients["user"].post("/api/v1/karaoke/stop")
    assert stopped.status_code == 403
    assert stopped.json() == {"detail": "missing_permission:karaoke.stop"}
    # Taking a capability away does not touch the others.
    assert (await clients["trusted"].post("/api/v1/karaoke/stop")).status_code == 204


async def test_the_guest_role_is_editable(clients: dict[str, AsyncClient]) -> None:
    assert (await clients["anonymous"].get("/api/v1/downloads")).status_code == 403

    granted = await clients["admin"].put(
        "/api/v1/permissions/guest", json={"capabilities": ["songs.view", "downloads.view"]}
    )

    assert granted.status_code == 200
    assert (await clients["anonymous"].get("/api/v1/downloads")).status_code == 200


async def test_the_admin_role_is_not_editable(client: AsyncClient) -> None:
    """An admin locking every administrator out of the app is not a supported move."""
    response = await client.put("/api/v1/permissions/admin", json={"capabilities": ["songs.view"]})

    assert response.status_code == 422
    assert (await client.get("/api/v1/permissions")).json()["roles"]["admin"] == sorted(
        ALL_CAPABILITIES
    )


async def test_an_unknown_role_or_capability_is_refused(client: AsyncClient) -> None:
    assert (
        await client.put("/api/v1/permissions/wizard", json={"capabilities": []})
    ).status_code == 404
    assert (
        await client.put("/api/v1/permissions/user", json={"capabilities": ["songs.destroy"]})
    ).status_code == 422
    # Nothing was written on the way to the error.
    assert (await client.get("/api/v1/permissions")).json()["roles"]["user"] == sorted(
        DEFAULT_ROLE_CAPABILITIES["user"]
    )


async def test_a_permission_change_survives_a_restart(
    bootstrap_settings: BootstrapSettings,
) -> None:
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await authenticate_admin(app)
        async with admin_client(app) as client:
            changed = await client.put(
                "/api/v1/permissions/trusted", json={"capabilities": ["songs.view", "usdb.search"]}
            )
            assert changed.status_code == 200

    restarted = create_app(bootstrap_settings)
    async with restarted.router.lifespan_context(restarted):
        await authenticate_admin(restarted)
        async with admin_client(restarted) as client:
            roles = (await client.get("/api/v1/permissions")).json()["roles"]
            assert roles["trusted"] == ["songs.view", "usdb.search"]
