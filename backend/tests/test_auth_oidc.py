"""OIDC login: the redirect flow, the checks on the way back, and the accounts it creates.

The provider is fake and lives in-process (`oidc_provider.py`); nothing here talks to a
real IdP. What the failure tests are really asserting is that a login only happens when
every check passed — state, PKCE, signature, issuer, audience, nonce and expiry.
"""

import base64
import hashlib
import sqlite3
from dataclasses import replace
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlparse

import pytest
from alembic import command
from alembic.config import Config
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import oidc_provider
from conftest import ADMIN_PASSWORD, add_user
from oidc_provider import (
    CLIENT_ID,
    CLIENT_SECRET,
    ISSUER,
    SUBJECT,
    FakeProvider,
    callback,
    configure,
    login,
    start_login,
)
from ultrastar_wingman.auth import oidc, providers
from ultrastar_wingman.auth.deps import COOKIE_NAME, GUEST_COOKIE_NAME
from ultrastar_wingman.auth.model import User, UserSession
from ultrastar_wingman.auth.service import token_hash
from ultrastar_wingman.db import migrations_dir
from ultrastar_wingman.library.model import Wish
from ultrastar_wingman.players.model import Player

OK = "/user?login=ok"


def error(slug: str) -> str:
    return f"/user?login=error:{slug}"


@pytest.fixture
def provider(monkeypatch: pytest.MonkeyPatch) -> FakeProvider:
    fake = FakeProvider()
    oidc_provider.install(fake, monkeypatch)
    return fake


async def only_user(session_factory: async_sessionmaker[AsyncSession]) -> User:
    async with session_factory() as session:
        return (await session.scalars(select(User))).one()


async def users(session_factory: async_sessionmaker[AsyncSession]) -> list[User]:
    async with session_factory() as session:
        return list(await session.scalars(select(User)))


# --- the config endpoint ------------------------------------------------------------


async def test_the_config_endpoint_reports_a_disabled_provider(
    anonymous_client: AsyncClient,
) -> None:
    response = await anonymous_client.get("/api/v1/auth/oidc/config")

    assert response.status_code == 200
    assert response.json() == {"enabled": False, "display_name": "SSO"}


async def test_the_config_endpoint_reports_an_enabled_provider(
    anonymous_client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    await configure(session_factory, **{"auth.oidc_display_name": "Company Login"})

    response = await anonymous_client.get("/api/v1/auth/oidc/config")

    assert response.json() == {"enabled": True, "display_name": "Company Login"}


async def test_switched_on_but_unconfigured_is_not_enabled(
    anonymous_client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    """A button that cannot work must not be offered — `enabled` means usable."""
    await configure(session_factory, **{"auth.oidc_client_id": ""})

    assert (await anonymous_client.get("/api/v1/auth/oidc/config")).json()["enabled"] is False
    assert (await anonymous_client.get("/api/v1/auth/oidc/login")).status_code == 404


# --- starting the flow -------------------------------------------------------------


async def test_login_redirects_to_the_provider_with_state_nonce_and_pkce(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    await configure(session_factory, **{"auth.oidc_scopes": "openid profile email"})

    response = await anonymous_client.get("/api/v1/auth/oidc/login")

    assert response.status_code == 302
    location = response.headers["location"]
    assert location.startswith(f"{ISSUER}/authorize?")
    parameters = await start_login(anonymous_client, provider)
    assert parameters["response_type"] == "code"
    assert parameters["client_id"] == CLIENT_ID
    assert parameters["scope"] == "openid profile email"
    # Derived from the request, so Wingman works under whatever host the phones reach it by.
    assert parameters["redirect_uri"] == "http://wingman.test/api/v1/auth/oidc/callback"
    assert parameters["code_challenge_method"] == "S256"
    assert len(parameters["state"]) > 20
    assert len(parameters["nonce"]) > 10
    assert len(parameters["code_challenge"]) > 20


async def test_login_is_404_while_oidc_is_off(anonymous_client: AsyncClient) -> None:
    response = await anonymous_client.get("/api/v1/auth/oidc/login")

    assert response.status_code == 404
    assert response.json() == {"detail": "oidc_disabled"}


async def test_the_code_verifier_matches_the_challenge_that_was_advertised(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """PKCE end to end: what the exchange proves has to be what the provider was promised."""
    await configure(session_factory)

    parameters = await start_login(anonymous_client, provider)
    assert (await callback(anonymous_client, parameters["state"])).status_code == 302

    verifier = provider.token_requests[0]["code_verifier"]
    digest = hashlib.sha256(verifier.encode()).digest()
    assert base64.urlsafe_b64encode(digest).rstrip(b"=").decode() == parameters["code_challenge"]
    assert provider.token_requests[0]["client_secret"] == CLIENT_SECRET
    assert provider.token_requests[0]["redirect_uri"] == parameters["redirect_uri"]


async def test_a_public_client_sends_no_secret(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """Keycloak's public client: PKCE alone protects the exchange."""
    await configure(session_factory, **{"auth.oidc_client_secret": ""})

    assert (await login(anonymous_client, provider)).headers["location"] == OK
    assert "client_secret" not in provider.token_requests[0]


# --- the happy path ----------------------------------------------------------------


async def test_the_callback_creates_the_account_and_logs_it_in(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    await configure(session_factory)

    response = await login(anonymous_client, provider)

    assert response.status_code == 302
    assert response.headers["location"] == OK
    raw_token = anonymous_client.cookies[COOKIE_NAME]
    assert "HttpOnly" in response.headers["set-cookie"]

    user = await only_user(session_factory)
    assert user.username == "singer"
    assert user.auth_provider == "oidc"
    assert user.oidc_subject == SUBJECT
    # No password to check locally, ever.
    assert user.password_hash is None
    # The first account is the administrator, whichever provider created it.
    assert user.role == "admin"

    async with session_factory() as session:
        player = (await session.scalars(select(Player))).one()
        assert (player.name, player.user_id, player.registered) == ("singer", user.id, True)
        stored_session = await session.get(UserSession, token_hash(raw_token))
        assert stored_session is not None
        assert stored_session.user_id == user.id


async def test_a_second_login_reuses_the_account(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """The subject is the identity: the same person renamed at the provider stays the same
    account, and keeps the name Wingman knows them by."""
    await configure(session_factory)
    await login(anonymous_client, provider)
    first = await only_user(session_factory)

    provider.claims = {"preferred_username": "renamed-at-the-provider"}
    second = await login(anonymous_client, provider)

    assert second.headers["location"] == OK
    again = await only_user(session_factory)
    assert (again.id, again.username) == (first.id, "singer")


async def test_a_later_account_is_a_plain_user(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    await add_user(session_factory, "yannis", "admin")
    await configure(session_factory)

    await login(anonymous_client, provider)

    created = next(user for user in await users(session_factory) if user.auth_provider == "oidc")
    assert created.role == "user"


async def test_a_username_taken_by_a_local_account_is_suffixed(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """A provider knows nothing about the names already in Wingman, and a collision must not
    turn into a failed login — or, worse, into somebody else's account."""
    local_id = await add_user(session_factory, "singer", "user")
    await configure(session_factory)

    assert (await login(anonymous_client, provider)).headers["location"] == OK

    by_name = {user.username: user for user in await users(session_factory)}
    assert sorted(by_name) == ["singer", "singer-2"]
    assert by_name["singer"].id == local_id
    assert by_name["singer"].auth_provider == "local"
    assert by_name["singer-2"].oidc_subject == SUBJECT


@pytest.mark.parametrize(
    ("claims", "expected"),
    [
        ({"preferred_username": "  Spacey  ", "name": "Ignored"}, "Spacey"),
        ({"name": "Full Name"}, "Full Name"),
        ({"email": "jane.doe@example.com"}, "jane.doe"),
        ({"preferred_username": "x" * 40}, "x" * 32),
        # Too short to be a username here, so the next candidate wins.
        ({"preferred_username": "ab", "name": "Fallback"}, "Fallback"),
        ({}, f"sso-{SUBJECT[:8]}"),
    ],
)
async def test_the_username_comes_from_the_first_usable_claim(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
    claims: dict[str, Any],
    expected: str,
) -> None:
    await configure(session_factory)
    provider.claims = claims

    assert (await login(anonymous_client, provider)).headers["location"] == OK

    assert (await only_user(session_factory)).username == expected


async def test_the_guest_wishes_are_claimed_by_the_account(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """Same as a local login: an evening of wishing as a guest is not lost by logging in."""
    await configure(session_factory)
    guest = "0" * 32
    async with session_factory() as session:
        session.add(Wish(song_id="usdb:1", guest_id=guest))
        await session.commit()
    anonymous_client.cookies.set(GUEST_COOKIE_NAME, guest)

    assert (await login(anonymous_client, provider)).headers["location"] == OK

    user = await only_user(session_factory)
    async with session_factory() as session:
        wish = (await session.scalars(select(Wish))).one()
        assert (wish.user_id, wish.guest_id) == (user.id, None)


# --- everything that must not log anybody in ---------------------------------------


async def test_a_replayed_state_is_refused(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    await configure(session_factory)
    parameters = await start_login(anonymous_client, provider)
    assert (await callback(anonymous_client, parameters["state"])).headers["location"] == OK

    replayed = await callback(anonymous_client, parameters["state"])

    assert replayed.headers["location"] == error("invalid_state")
    # And it did not quietly open a second session on the way.
    async with session_factory() as session:
        assert len(list(await session.scalars(select(UserSession)))) == 1


async def test_a_callback_is_refused_in_a_browser_that_did_not_start_the_login(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """Login CSRF: an attacker who starts a login as themselves and gets somebody else's
    browser to open the callback URL must not log that browser into their account — which
    would also hand them the victim's guest wishlist."""
    await configure(session_factory)
    parameters = await start_login(anonymous_client, provider)
    # What the victim's browser has: no cookie from a login it never started.
    anonymous_client.cookies.delete(oidc.STATE_COOKIE_NAME)

    response = await callback(anonymous_client, parameters["state"])

    assert response.headers["location"] == error("invalid_state")
    assert COOKIE_NAME not in anonymous_client.cookies
    assert await users(session_factory) == []
    async with session_factory() as session:
        assert list(await session.scalars(select(UserSession))) == []


async def test_the_login_ties_the_state_to_the_browser(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    await configure(session_factory)

    response = await anonymous_client.get("/api/v1/auth/oidc/login")

    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{oidc.STATE_COOKIE_NAME}=")
    assert "HttpOnly" in cookie
    state = dict(parse_qsl(urlparse(response.headers["location"]).query))["state"]
    assert anonymous_client.cookies[oidc.STATE_COOKIE_NAME] == state


async def test_pending_attempts_cannot_pile_up_without_bound(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Anybody can click the login button, so expiry alone is not enough."""
    await configure(session_factory)
    monkeypatch.setattr(oidc, "MAX_ATTEMPTS", 3)

    for _ in range(10):
        assert (await anonymous_client.get("/api/v1/auth/oidc/login")).status_code == 302

    assert len(oidc._attempts) == 3


async def test_an_unknown_state_is_refused(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    await configure(session_factory)

    response = await callback(anonymous_client, "a-state-nobody-issued")

    assert response.headers["location"] == error("invalid_state")
    assert await users(session_factory) == []


async def test_an_expired_state_is_refused(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """Backdated instead of slept through: tests never wait on the clock (testing.md)."""
    await configure(session_factory)
    parameters = await start_login(anonymous_client, provider)
    state = parameters["state"]
    attempt = oidc._attempts[state]
    oidc._attempts[state] = replace(
        attempt, started_at=attempt.started_at - oidc.STATE_TTL_SECONDS - 1
    )

    response = await callback(anonymous_client, state)

    assert response.headers["location"] == error("invalid_state")
    assert await users(session_factory) == []


async def test_a_callback_without_a_code_is_refused(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    await configure(session_factory)
    parameters = await start_login(anonymous_client, provider)

    response = await anonymous_client.get(
        "/api/v1/auth/oidc/callback", params={"state": parameters["state"]}
    )

    assert response.headers["location"] == error("invalid_request")


async def test_a_provider_error_is_reported_not_followed(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    await configure(session_factory)
    parameters = await start_login(anonymous_client, provider)

    response = await anonymous_client.get(
        "/api/v1/auth/oidc/callback",
        params={"state": parameters["state"], "error": "access_denied"},
    )

    assert response.headers["location"] == error("provider_error")
    assert await users(session_factory) == []


async def test_a_callback_while_oidc_is_off_is_refused(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    await configure(session_factory)
    parameters = await start_login(anonymous_client, provider)
    await configure(session_factory, **{"auth.oidc_enabled": False})

    response = await callback(anonymous_client, parameters["state"])

    assert response.headers["location"] == error("oidc_disabled")


async def test_a_nonce_that_does_not_match_the_attempt_is_refused(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """A token obtained in some other login cannot be injected into this callback."""
    await configure(session_factory)
    parameters = await start_login(anonymous_client, provider)
    provider.nonce = "a-nonce-from-somewhere-else"

    response = await callback(anonymous_client, parameters["state"])

    assert response.headers["location"] == error("invalid_token")
    assert await users(session_factory) == []


async def test_a_token_signed_with_another_key_is_refused(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    await configure(session_factory)
    provider.signing_key = oidc_provider.IMPOSTOR_KEY

    response = await login(anonymous_client, provider)

    assert response.headers["location"] == error("invalid_token")
    assert await users(session_factory) == []


async def test_a_token_for_another_audience_is_refused(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    await configure(session_factory)
    provider.audience = "some-other-client"

    response = await login(anonymous_client, provider)

    assert response.headers["location"] == error("invalid_token")
    assert await users(session_factory) == []


async def test_a_token_from_another_issuer_is_refused(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    await configure(session_factory)
    parameters = await start_login(anonymous_client, provider)
    provider.issuer = "https://evil.test"

    response = await callback(anonymous_client, parameters["state"])

    assert response.headers["location"] == error("invalid_token")


async def test_an_expired_token_is_refused(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    await configure(session_factory)
    provider.lifetime_seconds = -30

    response = await login(anonymous_client, provider)

    assert response.headers["location"] == error("invalid_token")


async def test_several_audiences_without_a_matching_azp_are_refused(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """`aud` containing us is not enough when the token was issued for somebody else."""
    await configure(session_factory)
    provider.audience = [CLIENT_ID, "another-client"]
    provider.claims = {"preferred_username": "singer", "azp": "another-client"}

    refused = await login(anonymous_client, provider)
    assert refused.headers["location"] == error("invalid_token")

    provider.claims = {"preferred_username": "singer", "azp": CLIENT_ID}
    assert (await login(anonymous_client, provider)).headers["location"] == OK


async def test_a_token_without_a_subject_is_refused(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """The subject is the account: an empty one would collapse into a shared account."""
    await configure(session_factory)
    provider.subject = " "

    response = await login(anonymous_client, provider)

    assert response.headers["location"] == error("invalid_token")
    assert await users(session_factory) == []


async def test_a_broken_token_endpoint_is_reported(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    await configure(session_factory)
    provider.token_status = 500

    response = await login(anonymous_client, provider)

    assert response.headers["location"] == error("token_failed")
    assert await users(session_factory) == []


async def test_an_unreachable_provider_is_reported(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """Wrong issuer in the settings: discovery fails, and even the login button says so
    instead of dumping JSON in the address bar."""
    await configure(session_factory, **{"auth.oidc_issuer": "https://idp.test/nowhere"})

    response = await anonymous_client.get("/api/v1/auth/oidc/login")

    assert response.status_code == 302
    assert response.headers["location"] == error("discovery_failed")


async def test_a_discovery_document_from_another_issuer_is_refused(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """Mix-up defence: the document has to belong to the issuer that was configured."""
    await configure(session_factory)
    provider.issuer = "https://somebody-else.test"

    response = await anonymous_client.get("/api/v1/auth/oidc/login")

    assert response.headers["location"] == error("discovery_failed")


async def test_a_rotated_signing_key_is_picked_up_without_a_restart(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """The JWKS is cached; a token with an unknown kid refetches it once."""
    await configure(session_factory)
    assert (await login(anonymous_client, provider)).headers["location"] == OK
    rotated = oidc_provider.generate_key("sign-2")
    provider.signing_key = rotated
    provider.published_key = rotated

    # Nothing but the cache changed between these two logins.
    assert (await login(anonymous_client, provider)).headers["location"] == OK


# --- how an OIDC account behaves everywhere else ------------------------------------


async def test_a_local_login_with_an_oidc_username_is_refused(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """An account with no password hash must answer like any wrong password — and above
    all not blow up inside argon2."""
    await configure(session_factory)
    await login(anonymous_client, provider)

    for password in (ADMIN_PASSWORD, ""):
        response = await anonymous_client.post(
            "/api/v1/auth/login", json={"username": "singer", "password": password}
        )
        assert response.status_code == 401, response.text
        assert response.json() == {"detail": "invalid_credentials"}


async def test_an_oidc_account_can_be_deleted_like_any_other(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """It is the only admin here, so the last-admin rule applies to it unchanged."""
    await configure(session_factory)
    await login(anonymous_client, provider)
    user = await only_user(session_factory)

    refused = await anonymous_client.delete(f"/api/v1/users/{user.id}")
    assert refused.status_code == 409
    assert refused.json() == {"detail": "last_admin"}

    await add_user(session_factory, "second-admin", "admin")
    assert (await anonymous_client.delete(f"/api/v1/users/{user.id}")).status_code == 204
    async with session_factory() as session:
        player = (await session.scalars(select(Player))).one()
        # The player survives as a temporary one, exactly like a deleted local account's.
        assert (player.user_id, player.registered) == (None, False)


async def test_the_provider_is_registered_and_never_takes_a_password(
    session: AsyncSession,
) -> None:
    """The seam's contract for a provider that does not authenticate with credentials: it
    is enumerable like any other and answers `None`, always."""
    assert set(providers.PROVIDERS) == {providers.LOCAL, providers.OIDC}

    registered = providers.get_provider(session, providers.OIDC)

    assert registered.name == providers.OIDC
    assert await registered.authenticate("singer", "anything") is None


# --- the migration -----------------------------------------------------------------


def test_migration_0009_leaves_existing_accounts_local(tmp_path: Path) -> None:
    """Upgrading a database recorded before OIDC existed, and rolling it back again."""
    database = tmp_path / "wingman.db"
    url = f"sqlite+aiosqlite:///{database}"
    _upgrade(url, "0008")
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO users (id, username, password_hash, role, created_at) "
            "VALUES ('u1', 'Yannis', '$argon2id$fake', 'admin', '2026-08-01 20:00:00')"
        )

    _upgrade(url, "0009")

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT password_hash, auth_provider, oidc_subject FROM users"
        ).fetchall() == [("$argon2id$fake", "local", None)]
        # An OIDC account has no password at all, and its subject is unique.
        connection.execute(
            "INSERT INTO users (id, username, password_hash, role, created_at, auth_provider, "
            "oidc_subject) VALUES ('u2', 'singer', NULL, 'user', '2026-08-01', 'oidc', 'sub-1')"
        )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO users (id, username, password_hash, role, created_at, auth_provider,"
                " oidc_subject) VALUES ('u3', 'other', NULL, 'user', '2026-08-01', 'oidc', 'sub-1')"
            )
        # The rebuilt table kept the case-insensitive username index.
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "INSERT INTO users (id, username, password_hash, role, created_at) "
                "VALUES ('u4', 'yannis', 'x', 'user', '2026-08-01')"
            )

    _downgrade(url, "0008")

    with sqlite3.connect(database) as connection:
        # The OIDC account survives as a local one nobody can log into: an empty string is
        # not a valid argon2 hash, so every password fails against it.
        assert dict(connection.execute("SELECT id, password_hash FROM users").fetchall()) == {
            "u1": "$argon2id$fake",
            "u2": "",
        }
        columns = {row[1] for row in connection.execute("PRAGMA table_info('users')").fetchall()}
        assert "auth_provider" not in columns and "oidc_subject" not in columns


def _config(database_url: str) -> Config:
    """Alembic runs sync: `migrations/env.py` calls `asyncio.run`, which cannot happen
    inside a running event loop — hence a sync test."""
    config = Config()
    config.set_main_option("script_location", str(migrations_dir()))
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    return config


def _upgrade(database_url: str, revision: str) -> None:
    command.upgrade(_config(database_url), revision)


def _downgrade(database_url: str, revision: str) -> None:
    command.downgrade(_config(database_url), revision)
