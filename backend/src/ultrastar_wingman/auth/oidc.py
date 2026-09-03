"""Login through an OIDC provider (Keycloak and friends).

The second implementation of the `AuthProvider` seam, and the one that does not fit
`authenticate()`: there are no credentials to hand over, the browser walks a redirect flow
and comes back with a code. What that code is traded for — an ID token — is the only thing
Wingman trusts, and only after its signature has been checked against the provider's JWKS.

Deliberate choices, because getting this wrong is a login bypass:

- The ID token is verified (signature, `iss`, `aud`, `exp`, `nonce`), never decoded
  unverified. Only asymmetric algorithms are accepted, so the public JWKS material can
  never be replayed as an HMAC secret.
- `state` is single-use, short-lived *and* tied to the browser that started the flow by a
  cookie: it is popped before anything else can fail, so a replayed callback finds nothing,
  and a callback delivered to somebody else's browser has no matching cookie.
- PKCE (S256) on every attempt, so an intercepted code is worthless without the verifier.
- Every failure sends the browser back to the UI with a slug and logs the reason here. The
  slugs are coarse on purpose — a caller learns "this login did not work", not which of our
  checks caught it.
"""

import logging
import secrets
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, cast
from urllib.parse import urlencode

import httpx
from authlib.oauth2.rfc7636 import create_s256_code_challenge
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from joserfc import jws, jwt
from joserfc.errors import JoseError
from joserfc.jwk import KeySet, KeySetSerialization
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import SessionDep
from ..settings import SettingsService, SettingValue
from . import providers, service
from .deps import claim_guest_wishes, set_session_cookie
from .model import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auth"])

# Where the browser ends up, whatever happened. `login=ok` or `login=error:<slug>` — the UI
# renders the outcome; nobody should ever see raw JSON after clicking a login button.
RETURN_PATH = "/user"

# Holds the `state` of the login this browser started, so a callback URL captured elsewhere
# cannot be handed to a different browser (which would log that browser into the attacker's
# account — and merge its guest wishlist into it).
STATE_COOKIE_NAME = "wingman_oidc_state"

# An attempt has this long to come back from the provider. Long enough to type a password
# and answer an MFA prompt, short enough that abandoned attempts do not pile up.
STATE_TTL_SECONDS = 600.0

# ponytail: a plain dict is enough, but "expires eventually" is not — anyone who can reach
# the login button can fill it without logging in, so it is capped as well. Per-client rate
# limiting is the upgrade path if a LAN app ever needs one.
MAX_ATTEMPTS = 1000

# Asymmetric only. An `alg` allowlist is what stops a token signed with the *public* JWKS
# key as an HMAC secret from verifying.
ALGORITHMS = ["RS256", "ES256"]

_HTTP_TIMEOUT = 10.0


class LoginError(Exception):
    """A login that did not happen, plus the slug the browser is sent home with."""

    def __init__(self, slug: str, detail: str) -> None:
        super().__init__(detail)
        self.slug = slug


class OidcConfigRead(BaseModel):
    """What the login page needs to decide whether to offer the button."""

    enabled: bool
    display_name: str


class ProviderMetadata(BaseModel):
    """The part of the discovery document Wingman uses. Extra fields are ignored."""

    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    jwks_uri: str


class TokenResponse(BaseModel):
    """The token endpoint's answer. The access token is not needed: Wingman does not call
    the provider's userinfo endpoint, the ID token carries everything it maps."""

    id_token: str


@dataclass(frozen=True)
class OidcConfig:
    issuer: str
    client_id: str
    client_secret: str
    display_name: str
    scopes: str
    # "Switched on" is not enough: without an issuer and a client id there is nothing to
    # redirect to, and a login button that cannot work must not be shown.
    enabled: bool


@dataclass(frozen=True)
class Attempt:
    """One login in flight. Kept server-side so a client cannot choose its own nonce."""

    nonce: str
    code_verifier: str
    # Sent to the provider at login and repeated at the exchange; the two must be identical.
    redirect_uri: str
    started_at: float


# ponytail: in-memory, so a second worker process would not see an attempt started by the
# first. Wingman is deliberately one process (see app.py); a shared store is the upgrade
# path if that ever changes. Discovery and JWKS are cached per issuer/URL, so changing the
# issuer setting simply misses the cache instead of needing an invalidation hook.
_attempts: dict[str, Attempt] = {}
_metadata_cache: dict[str, ProviderMetadata] = {}
# Keyed by (issuer, JWKS url), so keys cached for one provider can never verify a token
# after the issuer setting was pointed at another one.
_key_cache: dict[tuple[str, str], KeySet] = {}


def reset_state() -> None:
    """Drop everything cached in this module. For tests, and for nothing else."""
    _attempts.clear()
    _metadata_cache.clear()
    _key_cache.clear()


def http_client() -> httpx.AsyncClient:
    """Every request to the provider is made with this. Tests replace it with a client
    wired to a fake provider in-process — the suite never reaches a real IdP."""
    return httpx.AsyncClient(timeout=_HTTP_TIMEOUT)


async def load_config(session: AsyncSession) -> OidcConfig:
    values = await SettingsService(session).all()
    issuer = _text(values, "auth.oidc_issuer").rstrip("/")
    client_id = _text(values, "auth.oidc_client_id")
    return OidcConfig(
        issuer=issuer,
        client_id=client_id,
        client_secret=_text(values, "auth.oidc_client_secret"),
        display_name=_text(values, "auth.oidc_display_name"),
        scopes=_text(values, "auth.oidc_scopes"),
        enabled=bool(values["auth.oidc_enabled"]) and bool(issuer) and bool(client_id),
    )


def _text(values: Mapping[str, SettingValue], key: str) -> str:
    value = values[key]
    return value.strip() if isinstance(value, str) else ""


@router.get("/auth/oidc/config", response_model=OidcConfigRead)
async def oidc_config(session: SessionDep) -> OidcConfigRead:
    """Deliberately public: the login page has to know whether to offer the button, and
    nobody is logged in yet when it asks. Neither field is a secret."""
    config = await load_config(session)
    return OidcConfigRead(enabled=config.enabled, display_name=config.display_name)


@router.get(
    "/auth/oidc/login",
    response_class=RedirectResponse,
    status_code=302,
    responses={404: {"description": "OIDC login is switched off or not configured."}},
)
async def oidc_login(request: Request, session: SessionDep) -> RedirectResponse:
    """Start the flow: redirect to the provider's authorization endpoint."""
    config = await load_config(session)
    if not config.enabled:
        raise HTTPException(status_code=404, detail="oidc_disabled")
    try:
        metadata = await _metadata_for(config)
    except LoginError as failure:
        # A top-level navigation, so the browser must land in the UI here too.
        return _failed(failure)

    state = secrets.token_urlsafe(32)
    attempt = Attempt(
        nonce=secrets.token_urlsafe(16),
        code_verifier=secrets.token_urlsafe(64),
        # From the request, so Wingman works under whatever address the phones reach it by
        # (LAN IP, hostname, tunnel) without a setting nobody would keep in sync. That makes
        # it Host-header derived: somebody who can make a browser send a Host of their
        # choosing can make Wingman advertise a redirect_uri pointing at their own server.
        # What stops the code from going there is the provider: the redirect URI has to be
        # registered exactly (see docs/user/people/single-sign-on.md —
        # one exact URI, never a wildcard), and PKCE keeps the verifier here in any case.
        redirect_uri=str(request.url_for("oidc_callback")),
        started_at=time.monotonic(),
    )
    _remember(state, attempt)
    query = urlencode(
        {
            "response_type": "code",
            "client_id": config.client_id,
            "redirect_uri": attempt.redirect_uri,
            "scope": config.scopes,
            "state": state,
            "nonce": attempt.nonce,
            "code_challenge": create_s256_code_challenge(attempt.code_verifier),
            "code_challenge_method": "S256",
        }
    )
    # The endpoint may already carry a query string of its own.
    separator = "&" if "?" in metadata.authorization_endpoint else "?"
    response = RedirectResponse(
        f"{metadata.authorization_endpoint}{separator}{query}", status_code=302
    )
    # SameSite=Lax still travels on the top-level navigation the provider sends back, which
    # is exactly the one request that needs it. Two logins started in the same browser mean
    # the second wins and the first can no longer come back — as with any OIDC client.
    response.set_cookie(
        STATE_COOKIE_NAME,
        state,
        max_age=int(STATE_TTL_SECONDS),
        httponly=True,
        samesite="lax",
        path="/",
    )
    return response


@router.get("/auth/oidc/callback", response_class=RedirectResponse, status_code=302)
async def oidc_callback(
    request: Request,
    session: SessionDep,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> RedirectResponse:
    """Where the provider sends the browser back. Always a redirect, never an error body."""
    try:
        user = await _complete(
            session,
            code=code,
            state=state,
            error=error,
            state_cookie=request.cookies.get(STATE_COOKIE_NAME),
        )
    except LoginError as failure:
        response = _failed(failure)
    except Exception:
        # A login must not answer with a stack trace page; the reason is in the log.
        logger.exception("OIDC login failed unexpectedly")
        response = _redirect("error:login_failed")
    else:
        response = _redirect("ok")
        set_session_cookie(response, await service.start_session(session, user.id))
        # Same as a local login: whoever wished as a guest in this browser keeps those wishes.
        await claim_guest_wishes(request, session, user)
        logger.info("OIDC login for '%s' (%s)", user.username, user.id)
    # One attempt, one cookie: it is spent whatever the outcome was.
    response.delete_cookie(STATE_COOKIE_NAME, path="/")
    return response


def _redirect(outcome: str) -> RedirectResponse:
    return RedirectResponse(f"{RETURN_PATH}?login={outcome}", status_code=302)


def _failed(failure: LoginError) -> RedirectResponse:
    # WARNING with the reason, never with token or code contents.
    logger.warning("OIDC login failed (%s): %s", failure.slug, failure)
    return _redirect(f"error:{failure.slug}")


async def _complete(
    session: AsyncSession,
    *,
    code: str | None,
    state: str | None,
    error: str | None,
    state_cookie: str | None,
) -> User:
    config = await load_config(session)
    if not config.enabled:
        raise LoginError("oidc_disabled", "a callback arrived while OIDC login is off")
    if error is not None:
        # The provider refused (consent denied, unknown client). Its wording is not ours.
        raise LoginError("provider_error", f"provider answered with error '{error}'")
    if not code or not state:
        raise LoginError("invalid_request", "callback without a code or a state")

    # Consumed first, so a state is spent even when the check below refuses this callback.
    attempt = _consume(state)
    if state_cookie is None or not secrets.compare_digest(state_cookie.encode(), state.encode()):
        # Login CSRF: without this, somebody could start a login as themselves, keep the
        # callback URL and get a victim's browser to open it — logging that browser into the
        # attacker's account and merging its guest wishlist into it.
        raise LoginError("invalid_state", "the callback came from a different browser")
    metadata = await _metadata_for(config)
    id_token = await _exchange(config, metadata, code=code, attempt=attempt)
    claims = await _verified_claims(config, metadata, id_token, nonce=attempt.nonce)

    subject = str(claims["sub"]).strip()
    if not subject:
        # The subject *is* the account: an empty one would make every login that carries it
        # the same person.
        raise LoginError("invalid_token", "the token has no subject")
    return await service.upsert_oidc_user(session, subject, _username_from(claims, subject))


def _remember(state: str, attempt: Attempt) -> None:
    now = attempt.started_at
    for expired in [
        key for key, pending in _attempts.items() if now - pending.started_at >= STATE_TTL_SECONDS
    ]:
        del _attempts[expired]
    while len(_attempts) >= MAX_ATTEMPTS:
        # A flood of login clicks inside one TTL window would otherwise grow this without
        # bound. Oldest first: a dict keeps its insertion order, and inserts happen in time
        # order, so the entry dropped is the one closest to expiring anyway.
        del _attempts[next(iter(_attempts))]
    _attempts[state] = attempt


def _consume(state: str) -> Attempt:
    """The attempt this state belongs to, once.

    Popped before anything else can fail, so a replayed callback — successful or not —
    finds nothing. An unknown, replayed and expired state are one slug on purpose: they are
    the same thing to a caller, and telling them apart would confirm which states existed.
    """
    attempt = _attempts.pop(state, None)
    if attempt is None:
        raise LoginError("invalid_state", "unknown or already used state")
    if time.monotonic() - attempt.started_at >= STATE_TTL_SECONDS:
        raise LoginError("invalid_state", "the login attempt expired")
    return attempt


async def _metadata_for(config: OidcConfig) -> ProviderMetadata:
    cached = _metadata_cache.get(config.issuer)
    if cached is not None:
        return cached
    document = await _get_json(f"{config.issuer}/.well-known/openid-configuration")
    try:
        metadata = ProviderMetadata.model_validate(document)
    except ValueError as error:
        raise LoginError("discovery_failed", f"unusable discovery document: {error}") from error
    if metadata.issuer.rstrip("/") != config.issuer:
        # Mix-up defence: the document has to be the one this issuer setting names.
        raise LoginError(
            "discovery_failed",
            f"discovery document is issued by '{metadata.issuer}', not '{config.issuer}'",
        )
    _metadata_cache[config.issuer] = metadata
    return metadata


async def _exchange(
    config: OidcConfig, metadata: ProviderMetadata, *, code: str, attempt: Attempt
) -> str:
    """Trade the code for tokens. Returns the raw, still unverified ID token."""
    form = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": attempt.redirect_uri,
        "code_verifier": attempt.code_verifier,
        "client_id": config.client_id,
    }
    if config.client_secret:
        form["client_secret"] = config.client_secret
    try:
        async with http_client() as client:
            response = await client.post(metadata.token_endpoint, data=form)
    except httpx.HTTPError as error:
        raise LoginError("token_failed", f"token endpoint unreachable: {error}") from error
    if response.status_code != 200:
        # The body is not logged: an error response may still quote the code we sent.
        raise LoginError("token_failed", f"token endpoint answered {response.status_code}")
    try:
        return TokenResponse.model_validate(response.json()).id_token
    except ValueError as error:
        raise LoginError("token_failed", f"no usable id_token in the response: {error}") from error


async def _verified_claims(
    config: OidcConfig, metadata: ProviderMetadata, id_token: str, *, nonce: str
) -> dict[str, Any]:
    """The ID token's claims, or `LoginError`. Nothing here trusts the token before this."""
    registry = jwt.JWTClaimsRegistry(
        # The discovery document's own issuer, which `_metadata_for` already checked against
        # the configured one: a provider whose issuer ends in a slash still logs people in.
        iss={"essential": True, "value": metadata.issuer},
        aud={"essential": True, "value": config.client_id},
        sub={"essential": True},
        exp={"essential": True},
        # The nonce ties the token to the attempt this browser started, so a token obtained
        # elsewhere cannot be injected into someone else's callback.
        nonce={"essential": True, "value": nonce},
    )
    try:
        key_set = await _keys_for(metadata, _key_id(id_token))
        token = jwt.decode(id_token, key_set, algorithms=ALGORITHMS)
        registry.validate(token.claims)
    except (JoseError, ValueError) as error:
        # The message, never the token: `type(error)` says which check refused it.
        raise LoginError("invalid_token", f"{type(error).__name__}: {error}") from error

    # More than one audience: OIDC then requires `azp` to name the client the token was
    # issued for, or a token minted for another client would be accepted here.
    audience = token.claims.get("aud")
    if (
        isinstance(audience, list)
        and len(audience) > 1
        and token.claims.get("azp") != config.client_id
    ):
        raise LoginError("invalid_token", "several audiences and no matching azp")
    return token.claims


def _key_id(id_token: str) -> str | None:
    """The `kid` of the still unverified header. Used only to pick which key to verify
    against — a wrong one cannot make a bad signature pass."""
    try:
        kid = jws.extract_compact(id_token.encode()).headers().get("kid")
    except (JoseError, ValueError):
        return None
    return str(kid) if kid else None


async def _keys_for(metadata: ProviderMetadata, key_id: str | None) -> KeySet:
    cache_key = (metadata.issuer, metadata.jwks_uri)
    cached = _key_cache.get(cache_key)
    if cached is not None and (key_id is None or _has_key(cached, key_id)):
        return cached
    # A cached set without that kid means the provider rotated its signing key: fetch once
    # more instead of failing every login until Wingman restarts.
    document = cast(KeySetSerialization, await _get_json(metadata.jwks_uri))
    # Malformed input raises, and the caller turns that into a refused token.
    key_set = KeySet.import_key_set(document)
    _key_cache[cache_key] = key_set
    return key_set


def _has_key(key_set: KeySet, key_id: str) -> bool:
    return any(key.kid == key_id for key in key_set.keys)


async def _get_json(url: str) -> dict[str, Any]:
    """Read one of the provider's public documents. Both of them (discovery and JWKS) are
    metadata, so a failure is the same slug."""
    try:
        async with http_client() as client:
            response = await client.get(url)
            response.raise_for_status()
            document: dict[str, Any] = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise LoginError("discovery_failed", f"GET {url} failed: {error}") from error
    return document


def _username_from(claims: Mapping[str, Any], subject: str) -> str:
    """What the new account is called. Decided once, at creation, and never updated:
    the username is what players, scores and playlists hang off, while a display name at
    the provider is free to change.

    Bounded like a username chosen through the API, so an SSO account is not something the
    rest of Wingman cannot render.
    """
    email_localpart = str(claims.get("email") or "").split("@")[0]
    for value in (claims.get("preferred_username"), claims.get("name"), email_localpart):
        candidate = str(value or "").strip()[: service.MAX_USERNAME_LENGTH].strip()
        if len(candidate) >= service.MIN_USERNAME_LENGTH:
            return candidate
    # Nothing usable in the token: the subject at least identifies the account.
    return f"sso-{subject[:8]}"


class OidcAuthProvider:
    """The registry entry for accounts that live at an OIDC provider.

    `authenticate()` always says no: there is no password to check here, the flow above is
    how these accounts log in. The entry exists so the provider stored in
    `users.auth_provider` can be named and enumerated like any other.
    """

    name = providers.OIDC

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def authenticate(self, username: str, password: str) -> User | None:
        return None


providers.register(OidcAuthProvider.name, OidcAuthProvider)
