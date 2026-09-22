"""The permission matrix — this file is the authorization spec.

Every capability-gated route appears in `ROUTES` with the capability it demands. The test
then hits each of them as an anonymous caller (role `guest`), a `user`, a `trusted` user and
an `admin`, and asserts a 403 exactly where the role does not hold that capability. A route
that loses its `require(...)` fails here; so does a role that silently gains a capability.
"""

from collections.abc import AsyncIterator, Mapping

import pytest
from httpx import ASGITransport, AsyncClient, MockTransport, Response
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
    # Fixing wrong metadata rewrites the song's txt headers, nothing else.
    (
        "songs.edit",
        "PATCH",
        "/api/v1/songs/usdb:1",
        {
            "values": {"title": "Uptown Funk", "artist": "Mark Ronson"},
            "expected": {"title": "Uptown Funk", "artist": "Mark Ronson"},
        },
    ),
    # Admin-only by default: the folder goes off the disk with the row.
    ("songs.delete", "DELETE", "/api/v1/songs/usdb:1", None),
    ("players.view", "GET", "/api/v1/players", None),
    ("players.view", "GET", "/api/v1/players/nope/avatar", None),
    ("players.view", "GET", "/api/v1/karaoke/colors", None),
    ("players.manage", "POST", "/api/v1/players", {"name": "Someone"}),
    ("players.manage", "PATCH", "/api/v1/players/nope", {"hidden": True}),
    ("players.manage", "DELETE", "/api/v1/players/nope", None),
    # Somebody else's picture. Your own needs no capability, which is why the id here is
    # one no caller in this matrix owns — see test_players_api for the identity half.
    ("players.avatar", "PUT", "/api/v1/players/nope/avatar", None),
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
    # Picking singers for a song. Taking a selection over is `force` and needs nothing more:
    # the phone asks the person holding it first.
    ("karaoke.sing", "POST", "/api/v1/karaoke/selection", {"song_id": "usdb:1"}),
    ("songs.view", "GET", "/api/v1/karaoke/selection", None),
    ("karaoke.sing", "PUT", "/api/v1/karaoke/selection/slots", {"token": "nope", "slots": []}),
    ("karaoke.sing", "POST", "/api/v1/karaoke/selection/start", {"token": "nope"}),
    # Spinning the reel again. The token rides in `X-Selection-Token` and this matrix sends
    # none, so a permitted caller gets the 404 for a room where nothing is being picked.
    ("karaoke.sing", "POST", "/api/v1/karaoke/selection/spin", None),
    # Moving on from the reel to the singers: the same token rule, the same 404 for a room
    # where nothing is being picked.
    ("karaoke.sing", "POST", "/api/v1/karaoke/selection/pick", None),
    # Giving a selection up. The token rides in `X-Selection-Token` and this matrix sends
    # none, so a `karaoke.sing` holder gets the 204 for a room where nothing is being picked
    # and the row stays about the capability. Closing somebody else's takes `karaoke.stop`,
    # which `test_karaoke_selection` covers.
    ("karaoke.sing", "DELETE", "/api/v1/karaoke/selection", None),
    ("wishlist.view", "GET", "/api/v1/wishlist", None),
    ("wishlist.add", "POST", "/api/v1/wishlist", {"song_id": "usdb:1"}),
    ("wishlist.add", "DELETE", "/api/v1/wishlist/usdb:1", None),
    ("wishlist.manage", "DELETE", "/api/v1/wishlist/usdb:1/wishes", None),
    ("playlists.view", "GET", "/api/v1/playlists", None),
    ("playlists.view", "GET", "/api/v1/playlists/nope", None),
    # POST /playlists is deliberately not here: it checks for an account first, so an
    # anonymous caller gets a 401 instead of the 403 this matrix asserts.
    ("playlists.manage", "PATCH", "/api/v1/playlists/nope", {"name": "Party"}),
    ("playlists.manage", "DELETE", "/api/v1/playlists/nope", None),
    ("playlists.manage", "POST", "/api/v1/playlists/nope/entries", {"song_id": "usdb:1"}),
    ("playlists.manage", "DELETE", "/api/v1/playlists/nope/entries/usdb:1", None),
    ("playlists.manage", "PUT", "/api/v1/playlists/nope/entries", {"song_ids": []}),
    ("playlists.manage", "GET", "/api/v1/playlists/nope/members", None),
    (
        "playlists.manage",
        "PUT",
        "/api/v1/playlists/nope/members",
        {"user_id": "nobody", "access": "read"},
    ),
    ("playlists.manage", "DELETE", "/api/v1/playlists/nope/members/nobody", None),
    ("playlists.manage", "PUT", "/api/v1/playlists/nope/follow", None),
    ("playlists.manage", "DELETE", "/api/v1/playlists/nope/follow", None),
    # Copying checks the capability before the account, the other way round from
    # POST /playlists, so an anonymous caller reaches the 403 this matrix asserts.
    ("playlists.manage", "POST", "/api/v1/playlists/nope/copy", {}),
    # `playlists.moderate` is not here: it is not a route's own right but an extension of
    # `playlists.manage` to somebody else's visible list, so it needs a real playlist to
    # mean anything — test_playlists_api owns that half.
    # `GET /users/lookup` is not here either: it takes an identity (`authenticated`), not a
    # capability, so a guest gets 401 rather than the 403 this matrix asserts —
    # test_playlists_api pins it down beside the sharing it exists for.
    # Tags: the two listings are `songs.view`, and so are the assign routes — whether the
    # caller may set *that* tag is a `tag_permissions` row, which is data and not a
    # capability, so it lives in test_tags_api.py.
    ("songs.view", "GET", "/api/v1/tags", None),
    ("songs.view", "GET", "/api/v1/tags/assignments", None),
    ("songs.view", "PUT", "/api/v1/songs/usdb:1/tags/nope", None),
    ("songs.view", "DELETE", "/api/v1/songs/usdb:1/tags/nope", None),
    ("tags.manage", "POST", "/api/v1/tags", {"name": "Duets", "color": "blue"}),
    ("tags.manage", "PATCH", "/api/v1/tags/nope", {"name": "Duets"}),
    ("tags.manage", "PUT", "/api/v1/tags/nope/permissions", {"permissions": []}),
    ("tags.manage", "DELETE", "/api/v1/tags/nope", None),
    # Reading the conversation under a song is part of looking at the song; joining it
    # needs an account, which is why the POST checks the capability before `account_id`.
    ("songs.view", "GET", "/api/v1/songs/usdb:1/comments", None),
    ("comments.write", "POST", "/api/v1/songs/usdb:1/comments", {"body": "Great one"}),
    # Somebody else's comment. Your own needs no capability — see test_comments_api for the
    # identity half. The id has to be numeric or FastAPI answers 422 before the dependency
    # that decides between 403 and 404 ever runs.
    ("comments.moderate", "DELETE", "/api/v1/songs/usdb:1/comments/999", None),
    ("downloads.view", "GET", "/api/v1/downloads", None),
    ("downloads.manage", "POST", "/api/v1/downloads", {"source": "nope", "source_song_id": "1"}),
    # Taking a download off the panel changes what everybody else sees, so it is `manage`.
    ("downloads.manage", "POST", "/api/v1/downloads/1/dismiss", None),
    ("downloads.manage", "POST", "/api/v1/downloads/dismiss-finished", None),
    # The list itself answers everybody: without `stats.history` it simply holds nothing
    # but the party that is still going.
    ("stats.view", "GET", "/api/v1/stats/sessions", None),
    ("stats.view", "GET", "/api/v1/stats/sessions/current/sings", None),
    ("stats.view", "GET", "/api/v1/stats/latest", None),
    # Every party at once — the same "holds what you may see" list as `/stats/sessions`,
    # so it answers everybody and its content is `test_stats_api`'s business.
    ("stats.view", "GET", "/api/v1/stats/scores", None),
    # No party is running in this fixture, so every session id here is an older one.
    ("stats.history", "GET", "/api/v1/stats/sessions/nope/scores", None),
    ("stats.history", "GET", "/api/v1/stats/songs/usdb:1/scores", None),
    # Somebody else's player; your own scores are identity — see test_stats_api.
    ("stats.history", "GET", "/api/v1/stats/players/nope/scores", None),
    ("stats.manage", "PATCH", "/api/v1/stats/sessions/nope", {"name": "Party"}),
    # Keeping a party out of the picker is not the naming right: `stats.manage` names one.
    ("stats.hide", "PUT", "/api/v1/stats/sessions/nope/hidden", {"hidden": True}),
    # Admin-only by default: both rewrite what the party's record says happened.
    ("stats.moderate", "PATCH", "/api/v1/stats/scores/1", {"player_id": "nope"}),
    ("stats.moderate", "DELETE", "/api/v1/stats/scores/1", None),
    # Achievements: the three reading routes take no capability at all and so cannot be
    # expressed here — `GET /achievements`, `GET /achievements/{id}/icon` and
    # `GET /players/{id}/achievements` answer a guest phone, which test_achievements_api
    # pins down. The rest are the writes. Admin-only by default: an achievement is written
    # once and earned by the whole room, so editing one rewrites what everybody has.
    #
    # Every body here is deliberately one a permitted caller still refuses (an unknown id, a
    # definition the models reject), so an administrator running the matrix creates no row
    # and starts no background pass halfway through it.
    (
        "achievements.manage",
        "POST",
        "/api/v1/achievements",
        {"name": "Nope", "color": "gold", "definition": [{"metric": "nonsense"}]},
    ),
    ("achievements.manage", "PATCH", "/api/v1/achievements/nope", {"name": "Nope"}),
    ("achievements.manage", "DELETE", "/api/v1/achievements/nope", None),
    ("achievements.manage", "PUT", "/api/v1/achievements/nope/icon", None),
    ("achievements.manage", "DELETE", "/api/v1/achievements/nope/icon", None),
    # Putting one of the shipped built-ins back the way Wingman ships it: an unknown id, so a
    # permitted caller gets a 404 and the matrix resets nothing.
    ("achievements.manage", "POST", "/api/v1/achievements/nope/reset", None),
    # The catalogue's order. Not a permutation of it, so a permitted caller gets the 422 for
    # a mismatch and the matrix renumbers nothing.
    ("achievements.manage", "PUT", "/api/v1/achievements/order", {"ids": ["nope"]}),
    # Export is a write's capability on a read, deliberately: an archive carries every
    # `definition` and the unmasked name of a `hidden` achievement, which is exactly what
    # `GET /achievements` keeps back. The id is an unknown one, so a permitted caller gets a
    # 404 and the matrix exports nothing.
    ("achievements.manage", "POST", "/api/v1/achievements/export", {"ids": ["nope"]}),
    # No multipart body from this matrix, so a permitted caller gets the 422 for a missing
    # file — which is not a 403, and nothing is imported.
    ("achievements.manage", "POST", "/api/v1/achievements/import", None),
    # The literal segment is matched before `{achievement_id}`, so this is the settings route
    # and not an achievement called "settings". A count outside 0 to 60 keeps it a 422.
    ("achievements.manage", "PATCH", "/api/v1/achievements/settings", {"host_seconds_base": 999}),
    # The player selector. Admin-only by default: the token a device is created with is a
    # standing key to the report endpoint, and the reader mapping decides which card puts
    # which person on the TV. `POST /devices/report` is deliberately not here — it takes a
    # device's bearer token and no capability at all, which test_devices_api pins down.
    #
    # Every body is one a permitted caller still refuses (an unknown id, a delay outside the
    # range), so an administrator running the matrix creates nothing and maps nothing. The
    # one exception is the creating route, which has to carry a real name to get past
    # validation; it makes a device the matrix then leaves behind, which nothing else reads.
    ("devices.manage", "GET", "/api/v1/devices", None),
    ("devices.manage", "POST", "/api/v1/devices", {"name": "Matrix"}),
    ("devices.manage", "PATCH", "/api/v1/devices/nope", {"name": "Nope"}),
    ("devices.manage", "POST", "/api/v1/devices/nope/token", None),
    ("devices.manage", "POST", "/api/v1/devices/nope/update", None),
    ("devices.manage", "DELETE", "/api/v1/devices/nope", None),
    ("devices.manage", "GET", "/api/v1/devices/cards", None),
    ("devices.manage", "PUT", "/api/v1/devices/cards/A1B2C3D4", {"player_id": "nope"}),
    # Forgetting a card reads two ways: `devices.manage` for anybody's, and identity for
    # your own. The uid here belongs to nobody in this fixture, which is what keeps the row
    # about the capability — and what a caller who is neither gets is the same 403 whether
    # the card is somebody else's or no card at all. The identity half is in
    # test_devices_api.py, which is also where the three routes that take *only* an identity
    # live: a guest gets 401 there, not the 403 this matrix asserts.
    ("devices.manage", "DELETE", "/api/v1/devices/cards/A1B2C3D4", None),
    # Whether a selector is in the room is the singer picker's question, not the host's.
    ("players.view", "GET", "/api/v1/devices/status", None),
    ("devices.manage", "GET", "/api/v1/devices/settings", None),
    # The literal segment is matched before `{device_id}`, so this is the settings route and
    # not a device called "settings". A delay outside 0 to 30 keeps it a 422.
    ("devices.manage", "PATCH", "/api/v1/devices/settings", {"auto_start_delay_s": 999}),
    ("devices.manage", "GET", "/api/v1/devices/firmware", None),
    # The image is the one route a device reaches as well, so its door tries a bearer token
    # before the caller's capability. This matrix sends no `Authorization` header at all,
    # which is what keeps the row about `devices.manage`; the device half is in
    # test_devices_api.py.
    ("devices.manage", "GET", "/api/v1/devices/firmware/nothing.bin", None),
    # The background music. The controls are all 409s for a caller who holds the right —
    # the music is off by default — which is exactly what this matrix wants: a permitted
    # call that changes nothing.
    ("music.view", "GET", "/api/v1/music", None),
    ("music.control", "POST", "/api/v1/music/play", None),
    ("music.control", "POST", "/api/v1/music/pause", None),
    ("music.control", "POST", "/api/v1/music/skip", None),
    # Out of range, so a permitted caller gets a 422 and writes nothing.
    ("music.control", "PUT", "/api/v1/music/volume", {"master": 999}),
    ("music.manage", "GET", "/api/v1/music/settings", None),
    ("music.manage", "PATCH", "/api/v1/music/settings", {"resume_delay_s": 9999}),
    # Taking the sound over is `music.manage`, not `music.control`: a phone that may pause
    # the music must not be able to pull the audio off the TV.
    ("music.manage", "POST", "/api/v1/music/sink", None),
    (
        "music.manage",
        "POST",
        "/api/v1/music/sink/report",
        {"sink_id": "nobody", "track_id": "nothing", "event": "progress", "position_s": 0},
    ),
    ("music.manage", "POST", "/api/v1/music/sink/release", {"sink_id": "nobody"}),
    ("usdb.search", "GET", "/api/v1/sources/usdb/status", None),
    ("usdb.search", "GET", "/api/v1/sources/usdb/search", None),
    ("usdb.search", "GET", "/api/v1/sources/usdb/songs/1/cover", None),
    ("settings.view", "GET", "/api/v1/settings", None),
    ("settings.view", "GET", "/api/v1/downloads/video-quality", None),
    ("settings.manage", "PATCH", "/api/v1/settings/usdb.username", {"value": "singer"}),
    # Starting a program on the karaoke PC is the host's business. Nothing is launched
    # here: USDX is not configured in this fixture, so a permitted caller gets a 400.
    ("settings.manage", "POST", "/api/v1/karaoke/usdx/launch", None),
    ("users.view", "GET", "/api/v1/users", None),
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

# Unauthenticated by design: routes an anonymous caller must be able to reach, because they
# are what an anonymous caller uses to stop being one. They hold no capability check on
# purpose, so they belong in this file — a `require(...)` appearing on one of them would
# lock the login out of the login page.
PUBLIC_ROUTES: list[tuple[str, str]] = [
    # The frontend asks this before anybody is logged in, to decide whether to show the SSO
    # button. It answers with a flag and a label, nothing else.
    ("GET", "/api/v1/auth/oidc/config"),
    # The start of the OIDC redirect flow, and where the provider sends the browser back.
    # Both are opened by the browser itself, so neither can carry a session yet. The
    # callback's protection is the single-use state and the ID token it verifies, not a
    # permission — see test_auth_oidc.py.
    ("GET", "/api/v1/auth/oidc/login"),
    ("GET", "/api/v1/auth/oidc/callback"),
    # The three the choose-a-name form is driven through. Nobody is logged in while it is
    # on screen — that is the whole point of it — so a capability check here would lock the
    # last step of a login out of the login page. What guards them is the pending cookie,
    # which only a verified round trip sets; see test_auth_oidc.py.
    ("GET", "/api/v1/auth/oidc/pending"),
    ("POST", "/api/v1/auth/oidc/complete"),
    ("DELETE", "/api/v1/auth/oidc/pending"),
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
    # The cover route reaches out to USDB for a permitted caller; this transport keeps the
    # matrix off the network, and a 404 is not a 403 so the assertions still hold.
    usdb_client = AsyncClient(
        transport=MockTransport(lambda request: Response(404)), base_url="http://usdb.test"
    )
    monkeypatch.setattr(usdb, "_client", usdb_client)
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app), usdb_client:
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


@pytest.mark.parametrize(
    ("method", "path"), PUBLIC_ROUTES, ids=[f"{method} {path}" for method, path in PUBLIC_ROUTES]
)
async def test_the_public_routes_stay_public(
    clients: dict[str, AsyncClient], method: str, path: str
) -> None:
    """Whatever they answer — 404 while OIDC is off, a redirect once it is on — it is never
    "who are you". These are how a caller logs in in the first place."""
    response = await clients["anonymous"].request(method, path)

    assert response.status_code not in (401, 403), response.text


# The two rights that guard a *row* rather than a route: they only bite once the target
# exists and belongs to somebody else, so they cannot be asserted with a made-up id. Their
# spec lives with the module they moderate.
ROW_LEVEL_CAPABILITIES = {"playlists.moderate"}


def test_every_capability_is_enforced_somewhere() -> None:
    """A capability nobody requires is either dead or a route that forgot its check."""
    # users.manage and permissions.manage are in ROUTES; nothing may be missing.
    assert (
        set(CAPABILITIES) == {capability for capability, _, _, _ in ROUTES} | ROW_LEVEL_CAPABILITIES
    )


async def test_the_migration_seeds_the_module_defaults(session: AsyncSession) -> None:
    """Migrations 0006 to 0014 spell the defaults out literally, each seeding the
    capabilities it introduces; this is what keeps them and the module in step."""
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
