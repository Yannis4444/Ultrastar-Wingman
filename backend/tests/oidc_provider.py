"""A fake OIDC provider, served in-process.

Everything a login needs — the discovery document, a JWKS, and a token endpoint that
returns a properly signed ID token — with knobs for the failure cases. No test in this
suite may reach a real identity provider (testing.md), so `install()` points the OIDC
module's HTTP client at this Starlette app through an ASGI transport: no socket, no network.
"""

import time
from typing import Any
from urllib.parse import parse_qsl, urlparse

import httpx
import pytest
from httpx import ASGITransport, AsyncClient, Response
from joserfc import jwt
from joserfc.jwk import KeySet, RSAKey
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ultrastar_wingman.auth import oidc
from ultrastar_wingman.settings import SettingsService, SettingValue

ISSUER = "https://idp.test"
CLIENT_ID = "wingman"
CLIENT_SECRET = "shared-secret"
SUBJECT = "24a1f0e8-subject"

# The kid both keys claim, so signing with the wrong one is a failed signature rather than
# an unknown key id — the two failures take different paths through `_keys_for`.
KEY_ID = "sign-1"


def generate_key(key_id: str) -> RSAKey:
    return RSAKey.generate_key(
        2048, parameters={"kid": key_id, "use": "sig", "alg": "RS256"}, private=True
    )


# Generated once for the whole session: cheap, but not free enough to redo per test.
SIGNING_KEY = generate_key(KEY_ID)
# Never published in the JWKS, and claiming the published key's id: a token signed with it
# is a failed signature, not an unknown key.
IMPOSTOR_KEY = generate_key(KEY_ID)


class FakeProvider:
    """The provider a test drives. Every attribute is a knob for one failure mode."""

    def __init__(self) -> None:
        self.issuer = ISSUER
        self.subject = SUBJECT
        self.audience: str | list[str] = CLIENT_ID
        # Whatever else goes into the ID token: the claims the username is mapped from.
        self.claims: dict[str, Any] = {"preferred_username": "singer"}
        # Echoed into the ID token, exactly like a real provider echoes the nonce from the
        # authorization request. `start_login` fills it in.
        self.nonce = ""
        self.signing_key = SIGNING_KEY
        self.published_key = SIGNING_KEY
        self.token_status = 200
        self.lifetime_seconds = 300
        # What the token endpoint was sent, so a test can check PKCE and client auth.
        self.token_requests: list[dict[str, str]] = []
        self.app = Starlette(
            routes=[
                Route("/.well-known/openid-configuration", self._discovery),
                Route("/jwks", self._jwks),
                Route("/token", self._token, methods=["POST"]),
            ]
        )

    async def _discovery(self, request: Request) -> JSONResponse:
        return JSONResponse(
            {
                "issuer": self.issuer,
                "authorization_endpoint": f"{ISSUER}/authorize",
                "token_endpoint": f"{ISSUER}/token",
                "jwks_uri": f"{ISSUER}/jwks",
            }
        )

    async def _jwks(self, request: Request) -> JSONResponse:
        return JSONResponse(dict(KeySet([self.published_key]).as_dict(private=False)))

    async def _token(self, request: Request) -> JSONResponse:
        form = await request.form()
        self.token_requests.append({key: str(value) for key, value in form.items()})
        if self.token_status != 200:
            return JSONResponse({"error": "server_error"}, status_code=self.token_status)
        return JSONResponse(
            {"access_token": "not-used", "token_type": "Bearer", "id_token": self.id_token()}
        )

    def id_token(self) -> str:
        now = int(time.time())
        claims = {
            "iss": self.issuer,
            "sub": self.subject,
            "aud": self.audience,
            "iat": now,
            "exp": now + self.lifetime_seconds,
            "nonce": self.nonce,
            **self.claims,
        }
        return jwt.encode({"alg": "RS256", "kid": self.signing_key.kid}, claims, self.signing_key)


def install(provider: FakeProvider, monkeypatch: pytest.MonkeyPatch) -> None:
    """Route every request the OIDC module makes into the fake provider's ASGI app."""
    transport = ASGITransport(app=provider.app)
    monkeypatch.setattr(oidc, "http_client", lambda: httpx.AsyncClient(transport=transport))


async def configure(
    session_factory: async_sessionmaker[AsyncSession], **overrides: SettingValue
) -> None:
    """Switch OIDC on in the settings, pointed at the fake provider."""
    values: dict[str, SettingValue] = {
        "auth.oidc_enabled": True,
        "auth.oidc_issuer": ISSUER,
        "auth.oidc_client_id": CLIENT_ID,
        "auth.oidc_client_secret": CLIENT_SECRET,
        **overrides,
    }
    async with session_factory() as session:
        settings = SettingsService(session)
        for key, value in values.items():
            await settings.set(key, value)


async def start_login(client: AsyncClient, provider: FakeProvider) -> dict[str, str]:
    """Follow the login redirect by hand and return the query it sent to the provider.

    The nonce is handed to the fake provider here, which is what a real one does with the
    nonce it received in the authorization request.
    """
    response = await client.get("/api/v1/auth/oidc/login")
    assert response.status_code == 302, response.text
    parameters = dict(parse_qsl(urlparse(response.headers["location"]).query))
    provider.nonce = parameters["nonce"]
    return parameters


async def callback(client: AsyncClient, state: str, code: str = "the-code") -> Response:
    return await client.get("/api/v1/auth/oidc/callback", params={"code": code, "state": state})


async def login(client: AsyncClient, provider: FakeProvider) -> Response:
    """The whole flow: login redirect, then the callback the provider would send back."""
    parameters = await start_login(client, provider)
    return await callback(client, parameters["state"])


async def preset(client: AsyncClient) -> str:
    """The name the choose-a-name form opens on, for a browser that just came back."""
    response = await client.get("/api/v1/auth/oidc/pending")
    assert response.status_code == 200, response.text
    username: str = response.json()["username"]
    return username


async def complete(client: AsyncClient, username: str) -> Response:
    return await client.post("/api/v1/auth/oidc/complete", json={"username": username})


async def sign_up(client: AsyncClient, provider: FakeProvider, username: str | None = None) -> None:
    """A first login all the way to an account: the round trip, then the name.

    A subject Wingman has never seen stops at the form, so everything about how an SSO
    account *behaves* has to come through here. `username` defaults to the preset, which is
    the name the account would have had before the singer was asked.
    """
    parked = await login(client, provider)
    assert parked.headers["location"] == f"{oidc.RETURN_PATH}?login={oidc.CHOOSE_NAME}"
    response = await complete(client, username or await preset(client))
    assert response.status_code == 200, response.text
