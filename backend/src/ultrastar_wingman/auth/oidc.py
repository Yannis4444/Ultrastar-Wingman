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
- A subject with no account yet does not get one here. The callback parks the verified
  subject as a *pending login* and asks the browser for a name, which is the singer's to
  pick (`POST /auth/oidc/complete`). The pending token is a second cookie under the state
  one's rules: server-side, short-lived, HttpOnly, never logged and never in a URL — it is
  what stands between a stranger and an account for somebody else's identity. It is spent
  by the account it creates rather than by being read, so a name that turns out to be taken
  costs a refusal and not the whole round trip.
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
from fastapi import APIRouter, HTTPException, Request, Response
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
from .schema import UserRead

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auth"])

# Where the browser ends up, whatever happened. `login=ok`, `login=choose_name` or
# `login=error:<slug>` — the UI renders the outcome; nobody should ever see raw JSON after
# clicking a login button.
RETURN_PATH = "/user"

# The outcome of a login by somebody Wingman has no account for: the browser is asked for a
# name. The page draws that form off `GET /auth/oidc/pending` and not off this parameter,
# which a reload loses while the cookie still stands — this only says what just happened.
CHOOSE_NAME = "choose_name"

# Holds the `state` of the login this browser started, so a callback URL captured elsewhere
# cannot be handed to a different browser (which would log that browser into the attacker's
# account — and merge its guest wishlist into it).
STATE_COOKIE_NAME = "wingman_oidc_state"

# Holds the pending login a callback parked: the browser that answered the provider is the
# one that gets to name the account. Its own cookie, not the state one, because the state is
# spent by the very callback that creates this.
PENDING_COOKIE_NAME = "wingman_oidc_pending"

# An attempt has this long to come back from the provider. Long enough to type a password
# and answer an MFA prompt, short enough that abandoned attempts do not pile up.
STATE_TTL_SECONDS = 600.0

# And this long to think of a name. Same order for the same reason: a verified subject
# nobody finished with must not sit in memory all evening.
PENDING_TTL_SECONDS = 600.0

# ponytail: a plain dict is enough, but "expires eventually" is not — anyone who can reach
# the login button can fill it without logging in, so it is capped as well. Per-client rate
# limiting is the upgrade path if a LAN app ever needs one. The same cap applies to the
# pending logins: filling that one takes a real login at the provider per entry, which is a
# much harder flood, but the bound costs nothing.
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


class PendingLoginRead(BaseModel):
    """The login waiting for a name, as the form that asks for it reads it. The subject
    stays here: the browser has no business learning what the provider calls somebody."""

    # What the account would have been called without asking — free at the moment the
    # provider answered, so the form opens on a name that would go through.
    username: str


class CompleteLoginRequest(BaseModel):
    """The name the singer picked. Held to the same rule as a name typed at registration:
    a chosen one is never silently suffixed, it is refused and asked for again."""

    username: service.Username


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
class Parked:
    """A login held in memory between two requests. Everything parked here ages out."""

    started_at: float


@dataclass(frozen=True)
class Attempt(Parked):
    """One login in flight. Kept server-side so a client cannot choose its own nonce."""

    nonce: str
    code_verifier: str
    # Sent to the provider at login and repeated at the exchange; the two must be identical.
    redirect_uri: str


@dataclass(frozen=True)
class Pending(Parked):
    """A verified subject with no account yet, waiting for the name it will carry.

    Server-side like an attempt, and for the same reason: the subject is the identity, so a
    client that could name its own would be naming somebody else's account into existence.
    The `username` is only the form's preset — what the account would have been called
    before anybody was asked.
    """

    subject: str
    username: str


# ponytail: in-memory, so a second worker process would not see an attempt started by the
# first. Wingman is deliberately one process (see app.py); a shared store is the upgrade
# path if that ever changes. Discovery and JWKS are cached per issuer/URL, so changing the
# issuer setting simply misses the cache instead of needing an invalidation hook.
_attempts: dict[str, Attempt] = {}
_pendings: dict[str, Pending] = {}
_metadata_cache: dict[str, ProviderMetadata] = {}
# Keyed by (issuer, JWKS url), so keys cached for one provider can never verify a token
# after the issuer setting was pointed at another one.
_key_cache: dict[tuple[str, str], KeySet] = {}


def reset_state() -> None:
    """Drop everything cached in this module. For tests, and for nothing else."""
    _attempts.clear()
    _pendings.clear()
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
    _remember(_attempts, state, attempt, STATE_TTL_SECONDS)
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
    """Where the provider sends the browser back. Always a redirect, never an error body.

    Two things can come back from a verified token: an account this subject already has —
    logged in here and now — or a subject Wingman has never seen, which is parked and sent
    on to the form that asks what to call it. Nothing is created here either way.
    """
    try:
        outcome = await _complete(
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
        if isinstance(outcome, User):
            response = _redirect("ok")
            await _log_in(request, session, response, outcome)
            # A name somebody started choosing and walked away from must not outlive the
            # login that overtook it in the same browser.
            response.delete_cookie(PENDING_COOKIE_NAME, path="/")
        else:
            response = _redirect(CHOOSE_NAME)
            token = secrets.token_urlsafe(32)
            _remember(_pendings, token, outcome, PENDING_TTL_SECONDS)
            # Never logged and never in a URL: this token is the right to create an account
            # for a verified subject.
            response.set_cookie(
                PENDING_COOKIE_NAME,
                token,
                max_age=int(PENDING_TTL_SECONDS),
                httponly=True,
                samesite="lax",
                path="/",
            )
            logger.info("OIDC login by a new subject, waiting for a name")
    # One attempt, one cookie: it is spent whatever the outcome was.
    response.delete_cookie(STATE_COOKIE_NAME, path="/")
    return response


@router.get(
    "/auth/oidc/pending",
    response_model=PendingLoginRead,
    responses={
        404: {"description": "OIDC is off, or this browser has no login waiting for a name."}
    },
)
async def oidc_pending(request: Request, session: SessionDep) -> PendingLoginRead:
    """Whether this browser came back from the provider as somebody with no account yet.

    Deliberately public, like the config endpoint: whoever asks is not logged in yet, and
    the cookie is the whole answer. The page asks this on every load rather than trusting
    the `?login=` parameter, which a reload drops while the pending login still stands.

    Held to the same switch as the completion it leads to: an admin who turns SSO off while
    somebody is thinking of a name takes the form away with the same slug, rather than
    leaving it on screen in front of a completion that can only ever refuse it.

    The cookie is looked at first, unlike in the completion: every anonymous visitor of the
    User page asks this, and almost none of them have one — reading the settings for those
    would be a query per page load to answer a question the cookie already settles.
    """
    pending = _pending(request.cookies.get(PENDING_COOKIE_NAME))
    if pending is None:
        raise HTTPException(status_code=404, detail="no_pending_login")
    if not (await load_config(session)).enabled:
        raise HTTPException(status_code=404, detail="oidc_disabled")
    return PendingLoginRead(username=pending.username)


@router.post(
    "/auth/oidc/complete",
    response_model=UserRead,
    responses={
        404: {"description": "OIDC is off, or no login is waiting for a name."},
        409: {"description": "The name is taken."},
    },
)
async def complete_oidc_login(
    body: CompleteLoginRequest, request: Request, response: Response, session: SessionDep
) -> UserRead:
    """Create the account under the name its singer chose, and log it in.

    A subject that got an account in the meantime — a second callback, another tab — is
    logged into that account and nothing is created, which is why the name can be refused
    without the login being lost: the pending is only spent once something came of it.
    """
    config = await load_config(session)
    if not config.enabled:
        # An admin switched SSO off while somebody was typing. Same slug as everywhere else.
        raise HTTPException(status_code=404, detail="oidc_disabled")
    token = request.cookies.get(PENDING_COOKIE_NAME)
    pending = _pending(token)
    if pending is None:
        raise HTTPException(status_code=404, detail="no_pending_login")
    try:
        user = await service.upsert_oidc_user(session, pending.subject, body.username)
    except service.DuplicateUsernameError as error:
        # The name was refused, not the login: the pending stands and the form asks again.
        raise HTTPException(status_code=409, detail="duplicate_username") from error
    if token is not None:
        # `pop`, not `del`: two completions of the same pending can both get this far — a
        # double tap, or a second tab — and the one that comes second finds the account
        # its twin created rather than a key to delete.
        _pendings.pop(token, None)
    await _log_in(request, session, response, user)
    response.delete_cookie(PENDING_COOKIE_NAME, path="/")
    return await service.read_user_with_player(session, user)


@router.delete("/auth/oidc/pending", status_code=204)
async def forget_oidc_login(request: Request, response: Response) -> None:
    """The way out of the form: the parked subject is dropped and the browser is back at the
    login form. Idempotent — a browser with nothing pending gets the same 204."""
    token = request.cookies.get(PENDING_COOKIE_NAME)
    if token is not None:
        _pendings.pop(token, None)
    response.delete_cookie(PENDING_COOKIE_NAME, path="/")


async def _log_in(request: Request, session: AsyncSession, response: Response, user: User) -> None:
    """The one way an OIDC login ends: a session cookie, the browser's guest wishes, a line
    in the log. Both the returning subject and a freshly named account come through here."""
    set_session_cookie(response, await service.start_session(session, user.id))
    # Same as a local login: whoever wished as a guest in this browser keeps those wishes.
    await claim_guest_wishes(request, session, user)
    logger.info("OIDC login for '%s' (%s)", user.username, user.id)


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
) -> User | Pending:
    """The account this callback belongs to, or the pending login it opens."""
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

    existing = await service.find_by_oidc_subject(session, subject)
    if existing is not None:
        return existing
    return Pending(
        started_at=time.monotonic(),
        subject=subject,
        username=await _preset_username(session, claims, subject),
    )


async def _preset_username(session: AsyncSession, claims: Mapping[str, Any], subject: str) -> str:
    """The name the form opens on: the one this login would have been given before anybody
    was asked, freed of collisions — so the singer is offered a name that works and has to
    type only when they want another."""
    derived = _username_from(claims, subject)
    try:
        return await service.free_username(session, derived)
    except service.DuplicateUsernameError:
        # Ninety-eight accounts want that name. Offering the raw one is better than a failed
        # login: the form answers 409 until they pick something of their own.
        return derived


def _remember[P: Parked](store: dict[str, P], key: str, entry: P, ttl: float) -> None:
    """Park one login under a secret key, and take the chance to sweep the store."""
    now = entry.started_at
    for expired in [k for k, parked in store.items() if now - parked.started_at >= ttl]:
        del store[expired]
    while len(store) >= MAX_ATTEMPTS:
        # A flood of login clicks inside one TTL window would otherwise grow this without
        # bound. Oldest first: a dict keeps its insertion order, and inserts happen in time
        # order, so the entry dropped is the one closest to expiring anyway.
        del store[next(iter(store))]
    store[key] = entry


def _pending(token: str | None) -> Pending | None:
    """The login this browser's pending cookie stands for, or `None` — missing, unknown,
    expired or already spent, which are one thing to the form that asks.

    It is not spent by reading: the form may ask for a name several times over before one
    of them is free, and losing the verified subject on the first 409 would mean starting
    the whole round trip again.
    """
    if token is None:
        return None
    pending = _pendings.get(token)
    if pending is None:
        return None
    if time.monotonic() - pending.started_at >= PENDING_TTL_SECONDS:
        del _pendings[token]
        return None
    return pending


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
