"""OIDC login: the redirect flow, the checks on the way back, and the accounts it creates.

The provider is fake and lives in-process (`oidc_provider.py`); nothing here talks to a
real IdP. What the failure tests are really asserting is that a login only happens when
every check passed — state, PKCE, signature, issuer, audience, nonce and expiry.
"""

import asyncio
import base64
import hashlib
import logging
import sqlite3
from collections.abc import Awaitable, Callable
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
    ACCESS_TOKEN,
    CLIENT_ID,
    CLIENT_SECRET,
    ISSUER,
    PICTURE_URL,
    PNG,
    SUBJECT,
    FakeProvider,
    callback,
    complete,
    configure,
    login,
    png_header,
    preset,
    sign_up,
    start_login,
)
from ultrastar_wingman.auth import oidc, oidc_picture, providers, service
from ultrastar_wingman.auth.deps import COOKIE_NAME, GUEST_COOKIE_NAME
from ultrastar_wingman.auth.model import User, UserSession
from ultrastar_wingman.auth.service import token_hash
from ultrastar_wingman.db import migrations_dir
from ultrastar_wingman.images import MAX_IMAGE_BYTES
from ultrastar_wingman.library.model import Wish
from ultrastar_wingman.players import service as players_service
from ultrastar_wingman.players.model import Player

OK = "/user?login=ok"
# Where a subject Wingman has no account for lands: the form that asks what to call it.
CHOOSE_NAME = "/user?login=choose_name"


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


# The three stand-ins below are how a one-request test reaches the unique indexes: a
# lookup that saw nothing is exactly what the losing side of a race saw, and what happens
# between it and the write is the only thing those tests are about.


async def _free_name(session: AsyncSession, username: str) -> User | None:
    """`find_by_username`, seeing a name nobody holds."""
    return None


async def _no_player(session: AsyncSession, name: str) -> Player | None:
    """`player_by_name`, seeing no player of that name."""
    return None


def _blind_once(
    real: Callable[[AsyncSession, str], Awaitable[User | None]],
) -> Callable[[AsyncSession, str], Awaitable[User | None]]:
    """`real`, seeing nothing the first time it is asked and answering for real after —
    the window between the lookup before a write and the write itself."""
    asked = False

    async def lookup(session: AsyncSession, value: str) -> User | None:
        nonlocal asked
        if not asked:
            asked = True
            return None
        return await real(session, value)

    return lookup


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

    assert (await login(anonymous_client, provider)).headers["location"] == CHOOSE_NAME
    assert "client_secret" not in provider.token_requests[0]


# --- the happy path ----------------------------------------------------------------


async def test_a_new_subject_stops_at_the_form_and_is_logged_in_by_it(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """The first login of a subject creates nothing until the singer has named the account."""
    await configure(session_factory)

    parked = await login(anonymous_client, provider)

    assert parked.status_code == 302
    assert parked.headers["location"] == CHOOSE_NAME
    # Nothing was created, and nobody was logged in: a name is still missing.
    assert await users(session_factory) == []
    assert COOKIE_NAME not in anonymous_client.cookies
    assert "HttpOnly" in parked.headers["set-cookie"]
    assert await preset(anonymous_client) == "singer"

    response = await complete(anonymous_client, "singer")

    assert response.status_code == 200
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
    account, and keeps the name Wingman knows them by. Nobody is asked for a name twice."""
    await configure(session_factory)
    await sign_up(anonymous_client, provider)
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

    await sign_up(anonymous_client, provider)

    created = next(user for user in await users(session_factory) if user.auth_provider == "oidc")
    assert created.role == "user"


async def test_a_username_taken_by_a_local_account_is_suffixed_in_the_preset(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """A provider knows nothing about the names already in Wingman, and a collision must not
    turn into a failed login — or, worse, into somebody else's account. The form opens on a
    name that would go through, which the singer is free to replace."""
    local_id = await add_user(session_factory, "singer", "user")
    await configure(session_factory)

    assert (await login(anonymous_client, provider)).headers["location"] == CHOOSE_NAME
    assert await preset(anonymous_client) == "singer-2"
    assert (await complete(anonymous_client, "singer-2")).status_code == 200

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
async def test_the_preset_username_comes_from_the_first_usable_claim(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
    claims: dict[str, Any],
    expected: str,
) -> None:
    """What the token says is what the form opens on — and, when nobody types over it, what
    the account ends up called."""
    await configure(session_factory)
    provider.claims = claims

    await sign_up(anonymous_client, provider)

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

    await sign_up(anonymous_client, provider)

    user = await only_user(session_factory)
    async with session_factory() as session:
        wish = (await session.scalars(select(Wish))).one()
        assert (wish.user_id, wish.guest_id) == (user.id, None)


# --- choosing the name ---------------------------------------------------------------


async def test_the_singer_may_name_the_account_something_else(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """The point of the form: the provider's idea of somebody's name is a proposal."""
    await configure(session_factory)
    await login(anonymous_client, provider)

    response = await complete(anonymous_client, "  Yannis  ")

    assert response.status_code == 200
    assert response.json()["username"] == "Yannis"
    user = await only_user(session_factory)
    # Trimmed like any other name somebody types, and the player is named after it.
    assert user.username == "Yannis"
    async with session_factory() as session:
        player = (await session.scalars(select(Player))).one()
        assert (player.name, player.user_id) == ("Yannis", user.id)


async def test_a_guest_player_of_the_chosen_name_becomes_the_account(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """The same takeover registering does: somebody who sang all evening as a guest keeps
    those scores by naming their new account after that player."""
    await configure(session_factory)
    async with session_factory() as session:
        session.add(Player(name="Yannis"))
        await session.commit()
    await login(anonymous_client, provider)

    assert (await complete(anonymous_client, "Yannis")).status_code == 200

    user = await only_user(session_factory)
    async with session_factory() as session:
        player = (await session.scalars(select(Player))).one()
        assert (player.name, player.user_id, player.registered) == ("Yannis", user.id, True)


async def test_a_taken_name_is_refused_and_the_login_survives_it(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """A chosen name is never silently suffixed — it is refused, and the form asks again.
    The verified subject stands until something came of it, so the round trip is not lost."""
    await add_user(session_factory, "yannis", "admin")
    await configure(session_factory)
    await login(anonymous_client, provider)

    refused = await complete(anonymous_client, "Yannis")

    # Case-insensitively taken: the unique index is on lower(username).
    assert refused.status_code == 409
    assert refused.json() == {"detail": "duplicate_username"}
    assert COOKIE_NAME not in anonymous_client.cookies
    assert len(await users(session_factory)) == 1

    assert (await complete(anonymous_client, "singer")).status_code == 200
    assert {user.username for user in await users(session_factory)} == {"yannis", "singer"}


async def test_a_name_taken_after_the_check_is_refused_by_the_index(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Somebody registering that very name while the form was open: the refusal is the same.

    The name is looked up before the account is written, and the unique index is what
    decides in between. Blinding that lookup is what stands in for the race here — it is
    the only way to reach the index from one request — and what it proves is that the
    login survives it exactly as it survives the ordinary 409: the same browser names the
    account a moment later.
    """
    await add_user(session_factory, "yannis", "admin")
    await configure(session_factory)
    await login(anonymous_client, provider)
    monkeypatch.setattr(service, "find_by_username", _free_name)

    refused = await complete(anonymous_client, "Yannis")

    assert refused.status_code == 409
    assert refused.json() == {"detail": "duplicate_username"}
    assert COOKIE_NAME not in anonymous_client.cookies
    assert len(await users(session_factory)) == 1
    # Still blinded, and a free name still goes through: nothing about the account was
    # half written by the refusal.
    assert (await complete(anonymous_client, "singer")).status_code == 200


async def test_a_player_of_that_name_appearing_meanwhile_refuses_the_name(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The other index in the way: the player the account would sing as.

    A guest of that name is normally taken over, so the only way to collide with one is for
    it to appear after the takeover looked — the singer picker on somebody's phone, one
    moment later. Blinded here for the same reason, and the account is refused whole: the
    guest keeps their scores and nobody is logged in.
    """
    await configure(session_factory)
    async with session_factory() as session:
        session.add(Player(name="Yannis"))
        await session.commit()
    await login(anonymous_client, provider)
    monkeypatch.setattr(service, "player_by_name", _no_player)

    refused = await complete(anonymous_client, "Yannis")

    assert refused.status_code == 409
    assert refused.json() == {"detail": "duplicate_username"}
    assert await users(session_factory) == []
    async with session_factory() as session:
        guest = (await session.scalars(select(Player))).one()
        assert (guest.name, guest.user_id) == ("Yannis", None)
    assert (await complete(anonymous_client, "singer")).status_code == 200


async def test_a_subject_that_won_the_race_is_logged_into_its_account(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two tabs confirming a name for the same first sign-on, to the last instant.

    The subject is the identity, so the account the other tab created is this singer's own:
    the index refuses the second row and the login lands in that account rather than
    reading as a failure. The lookup that normally catches this is blinded on its first
    call — the one before the write — and answers for real afterwards, which is where the
    account is found.
    """
    await configure(session_factory)
    await login(anonymous_client, provider)
    async with session_factory() as session:
        await service.upsert_oidc_user(session, SUBJECT, "the-first-name")
    monkeypatch.setattr(service, "find_by_oidc_subject", _blind_once(service.find_by_oidc_subject))

    response = await complete(anonymous_client, "the-second-name")

    assert response.status_code == 200
    assert response.json()["username"] == "the-first-name"
    assert COOKIE_NAME in anonymous_client.cookies
    assert len(await users(session_factory)) == 1
    # And the pending login was spent by the account it ended in, like any other.
    assert (await complete(anonymous_client, "a-third-name")).status_code == 404


@pytest.mark.parametrize(
    "username",
    [pytest.param("ab", id="too short"), pytest.param("x" * 33, id="too long")],
)
async def test_a_name_outside_the_bounds_is_refused(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
    username: str,
) -> None:
    """The same rule a name typed at registration is held to."""
    await configure(session_factory)
    await login(anonymous_client, provider)

    assert (await complete(anonymous_client, username)).status_code == 422
    assert await users(session_factory) == []


async def test_a_pending_login_is_spent_by_the_name_it_got(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """One round trip, one account: a repeated completion has nothing left to name."""
    await configure(session_factory)
    await sign_up(anonymous_client, provider)

    again = await complete(anonymous_client, "somebody-else")

    assert again.status_code == 404
    assert again.json() == {"detail": "no_pending_login"}
    assert (await anonymous_client.get("/api/v1/auth/oidc/pending")).status_code == 404
    assert len(await users(session_factory)) == 1


async def test_a_browser_with_no_pending_login_is_told_so(
    anonymous_client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    """What the User page asks on every load: the parameter it was sent back with is gone
    after a reload, the cookie is not."""
    await configure(session_factory)

    response = await anonymous_client.get("/api/v1/auth/oidc/pending")

    assert response.status_code == 404
    assert response.json() == {"detail": "no_pending_login"}


async def test_an_expired_pending_login_is_gone(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """A verified subject nobody named does not wait all evening."""
    await configure(session_factory)
    await login(anonymous_client, provider)
    token = anonymous_client.cookies[oidc.PENDING_COOKIE_NAME]
    parked = oidc._pendings[token]
    oidc._pendings[token] = replace(
        parked, started_at=parked.started_at - oidc.PENDING_TTL_SECONDS - 1
    )

    assert (await anonymous_client.get("/api/v1/auth/oidc/pending")).status_code == 404
    assert (await complete(anonymous_client, "singer")).status_code == 404
    assert await users(session_factory) == []


async def test_giving_up_forgets_the_pending_login(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """The way out of the form. Idempotent, so a browser that never had one is fine too."""
    await configure(session_factory)
    await login(anonymous_client, provider)

    assert (await anonymous_client.delete("/api/v1/auth/oidc/pending")).status_code == 204

    assert (await anonymous_client.get("/api/v1/auth/oidc/pending")).status_code == 404
    assert (await complete(anonymous_client, "singer")).status_code == 404
    assert await users(session_factory) == []
    assert (await anonymous_client.delete("/api/v1/auth/oidc/pending")).status_code == 204


async def test_a_name_chosen_after_sso_was_switched_off_is_refused(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """An admin turning the switch off mid-flow reads as it does everywhere else.

    The form goes with it: were `GET /pending` still to answer, the page would keep drawing
    a form whose only possible answer is that refusal.
    """
    await configure(session_factory)
    await login(anonymous_client, provider)
    await configure(session_factory, **{"auth.oidc_enabled": False})

    response = await complete(anonymous_client, "singer")

    assert response.status_code == 404
    assert response.json() == {"detail": "oidc_disabled"}
    assert await users(session_factory) == []
    parked = await anonymous_client.get("/api/v1/auth/oidc/pending")
    assert parked.status_code == 404
    assert parked.json() == {"detail": "oidc_disabled"}


async def test_only_the_browser_that_came_back_may_name_the_account(
    anonymous_client: AsyncClient,
    client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """The pending cookie is the whole right, the way the state cookie is: another browser
    sees nothing to finish, whatever else it holds — here an administrator's own session."""
    await configure(session_factory)
    await login(anonymous_client, provider)

    assert (await client.get("/api/v1/auth/oidc/pending")).status_code == 404
    stolen = await complete(client, "singer")

    assert stolen.status_code == 404
    assert stolen.json() == {"detail": "no_pending_login"}
    assert [user for user in await users(session_factory) if user.auth_provider == "oidc"] == []
    # And the browser that did come back still has its login.
    assert (await complete(anonymous_client, "singer")).status_code == 200


async def test_a_subject_that_got_an_account_meanwhile_is_logged_into_it(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """Two callbacks, two forms, one account: the subject is the identity, so the second
    name names nothing. Better than refusing somebody their own login over a stale tab."""
    await configure(session_factory)
    await login(anonymous_client, provider)
    # The tab that is left standing, while a second round trip finishes in front of it.
    stale = anonymous_client.cookies[oidc.PENDING_COOKIE_NAME]
    await sign_up(anonymous_client, provider, "the-first-name")
    anonymous_client.cookies.set(oidc.PENDING_COOKIE_NAME, stale)

    response = await complete(anonymous_client, "the-second-name")

    assert response.status_code == 200
    assert response.json()["username"] == "the-first-name"
    assert (await only_user(session_factory)).username == "the-first-name"
    # And it is a real login: the second browser holds a session of that account.
    assert COOKIE_NAME in anonymous_client.cookies


# --- everything that must not log anybody in ---------------------------------------


async def test_a_replayed_state_is_refused(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    await configure(session_factory)
    parameters = await start_login(anonymous_client, provider)
    first = await callback(anonymous_client, parameters["state"])
    assert first.headers["location"] == CHOOSE_NAME
    assert (await complete(anonymous_client, await preset(anonymous_client))).status_code == 200

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


async def test_the_state_cookie_is_spent_whatever_the_callback_answers(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """One attempt, one cookie. A callback that parked a subject, one that logged an account
    in and one that refused the state all leave the browser with nothing left to replay."""
    await configure(session_factory)

    # Parked: a verified subject Wingman has no account for.
    await login(anonymous_client, provider)
    assert oidc.STATE_COOKIE_NAME not in anonymous_client.cookies
    assert (await complete(anonymous_client, "singer")).status_code == 200

    # Logged in: the same subject coming back to the account it now has.
    assert (await login(anonymous_client, provider)).headers["location"] == OK
    assert oidc.STATE_COOKIE_NAME not in anonymous_client.cookies

    # Refused: an attempt is standing, and the callback names a state nobody issued.
    parameters = await start_login(anonymous_client, provider)
    assert anonymous_client.cookies[oidc.STATE_COOKIE_NAME] == parameters["state"]
    refused = await callback(anonymous_client, "a-state-nobody-issued")

    assert refused.headers["location"] == error("invalid_state")
    assert oidc.STATE_COOKIE_NAME not in anonymous_client.cookies


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
    assert (await login(anonymous_client, provider)).headers["location"] == CHOOSE_NAME


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
    await sign_up(anonymous_client, provider)
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
    await sign_up(anonymous_client, provider)

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
    await sign_up(anonymous_client, provider)
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


# --- the provider's picture as the avatar -------------------------------------------


async def own_player(session_factory: async_sessionmaker[AsyncSession]) -> Player:
    """The player of the one single sign-on account in the database."""
    async with session_factory() as session:
        user = (await session.scalars(select(User).where(User.auth_provider == "oidc"))).one()
        return (await session.scalars(select(Player).where(Player.user_id == user.id))).one()


def stored(player: Player) -> bytes | None:
    """The avatar file's bytes. Sync: ruff's ASYNC rules keep pathlib out of coroutines."""
    if player.avatar_file is None:
        return None
    path = Path(player.avatar_file)
    return path.read_bytes() if path.is_file() else None


def mtime(player: Player) -> int:
    assert player.avatar_file is not None
    return Path(player.avatar_file).stat().st_mtime_ns


def with_picture(provider: FakeProvider, url: str = PICTURE_URL) -> FakeProvider:
    provider.claims = {**provider.claims, "picture": url}
    return provider


async def test_the_first_login_brings_the_provider_s_picture(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """The account only exists once the singer named it, so that is when the picture lands:
    at the completion, and already on the player the answer names."""
    await configure(session_factory)
    with_picture(provider)

    await sign_up(anonymous_client, provider)

    player = await own_player(session_factory)
    assert stored(player) == PNG
    assert (player.avatar_source, player.avatar_source_url) == ("oidc", PICTURE_URL)
    assert len(provider.picture_requests) == 1
    listed = await anonymous_client.get("/api/v1/players")
    assert listed.json()["players"][0]["has_avatar"] is True


async def test_every_login_takes_a_changed_picture(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    await configure(session_factory)
    await sign_up(anonymous_client, with_picture(provider))

    provider.picture = png_header(2, 2)
    assert (await login(anonymous_client, provider)).headers["location"] == OK

    assert stored(await own_player(session_factory)) == png_header(2, 2)


async def test_a_picture_at_a_new_address_replaces_the_old_one(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    await configure(session_factory)
    await sign_up(anonymous_client, with_picture(provider))

    provider.picture = png_header(3, 3)
    with_picture(provider, f"{ISSUER}/picture.png?v=2")
    await login(anonymous_client, provider)

    player = await own_player(session_factory)
    assert stored(player) == png_header(3, 3)
    assert player.avatar_source_url == f"{ISSUER}/picture.png?v=2"


async def test_an_unchanged_picture_is_asked_for_with_its_etag_and_not_rewritten(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """A 304 is all an unchanged picture costs, and the file — so its version and every
    browser's cached copy — stays exactly as it was."""
    await configure(session_factory)
    provider.picture_etag = '"v1"'
    await sign_up(anonymous_client, with_picture(provider))
    before = await own_player(session_factory)
    assert before.avatar_source_etag == '"v1"'

    await login(anonymous_client, provider)

    assert provider.picture_requests[-1]["if-none-match"] == '"v1"'
    after = await own_player(session_factory)
    assert mtime(after) == mtime(before)


async def test_the_same_picture_without_an_etag_is_not_rewritten(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    await configure(session_factory)
    await sign_up(anonymous_client, with_picture(provider))
    before = await own_player(session_factory)

    await login(anonymous_client, provider)

    assert len(provider.picture_requests) == 2
    assert "if-none-match" not in provider.picture_requests[-1]
    assert mtime(await own_player(session_factory)) == mtime(before)


async def test_a_picture_the_singer_uploaded_is_never_replaced(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """Once somebody chose the picture by hand, a login does not even ask for the
    provider's."""
    await configure(session_factory)
    await sign_up(anonymous_client, with_picture(provider))
    player = await own_player(session_factory)
    chosen = png_header(4, 4)
    uploaded = await anonymous_client.put(
        f"/api/v1/players/{player.id}/avatar", files={"file": ("me.png", chosen, "image/png")}
    )
    assert uploaded.status_code == 200, uploaded.text
    player = await own_player(session_factory)
    assert (player.avatar_source, player.avatar_source_url) == ("manual", None)

    provider.picture = png_header(5, 5)
    assert (await login(anonymous_client, provider)).headers["location"] == OK

    assert stored(await own_player(session_factory)) == chosen
    assert len(provider.picture_requests) == 1


async def test_a_guest_picture_taken_over_by_a_first_login_is_kept(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
    tmp_path: Path,
) -> None:
    """A guest player whose picture somebody uploaded, taken over by the account a first
    login creates under that name, keeps the picture: it was chosen by hand."""
    chosen = png_header(6, 6)
    async with session_factory() as session:
        guest = Player(name="singer")
        session.add(guest)
        await session.flush()
        await players_service.store_avatar(
            session, guest, tmp_path / "avatars", "image/png", chosen
        )
        guest_id = guest.id
    await configure(session_factory)

    await sign_up(anonymous_client, with_picture(provider), "singer")

    player = await own_player(session_factory)
    assert (player.id, stored(player)) == (guest_id, chosen)
    assert provider.picture_requests == []


@pytest.mark.parametrize(
    ("status", "body", "content_type", "length", "reason"),
    [
        (404, b"gone", "text/plain", None, "the server answered 404"),
        (200, b"<html>not a picture</html>", "image/png", None, "not a jpeg, png or webp"),
        (200, PNG, "image/png", str(6 * 1024 * 1024), "larger than"),
        # A server that announces a small picture and sends a huge one: the body is cut
        # one byte past the cap, whatever the header said.
        (200, PNG + bytes(MAX_IMAGE_BYTES), "image/png", "100", "larger than"),
        (200, png_header(10_000, 10_000), "image/png", None, "far too many"),
    ],
    ids=["missing", "not-an-image", "too-large", "too-large-unannounced", "too-many-pixels"],
)
async def test_a_picture_that_cannot_be_taken_leaves_the_avatar_and_the_login_alone(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
    caplog: pytest.LogCaptureFixture,
    status: int,
    body: bytes,
    content_type: str,
    length: str | None,
    reason: str,
) -> None:
    await configure(session_factory)
    await sign_up(anonymous_client, with_picture(provider, f"{PICTURE_URL}?token=secret"))
    before = await own_player(session_factory)
    provider.picture_status = status
    provider.picture = body
    provider.picture_content_type = content_type
    provider.picture_length = length

    with caplog.at_level(logging.WARNING, logger="ultrastar_wingman.auth"):
        response = await login(anonymous_client, provider)

    assert response.headers["location"] == OK
    assert COOKIE_NAME in anonymous_client.cookies
    after = await own_player(session_factory)
    assert (stored(after), after.avatar_source_url) == (PNG, before.avatar_source_url)
    [warning] = [record for record in caplog.records if record.levelno == logging.WARNING]
    assert "'singer'" in warning.getMessage()
    assert reason in warning.getMessage()
    # Never the address: its query string may carry a token.
    assert "secret" not in caplog.text and "picture.png" not in caplog.text


async def test_a_provider_that_does_not_answer_holds_the_login_up_only_briefly(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(oidc_picture, "DOWNLOAD_SECONDS", 0.05)
    await configure(session_factory)
    provider.picture_hangs = True

    with caplog.at_level(logging.WARNING, logger="ultrastar_wingman.auth"):
        await sign_up(anonymous_client, with_picture(provider))

    assert stored(await own_player(session_factory)) is None
    assert COOKIE_NAME in anonymous_client.cookies
    assert "took longer than" in caplog.text


async def test_a_fault_of_ours_while_storing_the_picture_still_logs_the_singer_in(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Not a bad picture but a bug or a database hiccup: the completion still answers with
    the account it created, logged in."""

    async def broken(*args: object, **kwargs: object) -> None:
        raise RuntimeError("the disk is on fire")

    monkeypatch.setattr(players_service, "store_provider_avatar", broken)
    await configure(session_factory)

    with caplog.at_level(logging.WARNING, logger="ultrastar_wingman.auth"):
        await sign_up(anonymous_client, with_picture(provider))

    me = await anonymous_client.get("/api/v1/auth/me")
    assert me.json()["user"]["username"] == "singer"
    assert "(RuntimeError)" in caplog.text
    assert "disk is on fire" not in caplog.text


@pytest.mark.parametrize(
    "url", ["data:image/png;base64,iVBORw0KGgo=", "file:///C:/Windows/win.ini", "picture.png"]
)
async def test_only_a_web_address_is_downloaded(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
    url: str,
) -> None:
    await configure(session_factory)

    await sign_up(anonymous_client, with_picture(provider, url))

    assert stored(await own_player(session_factory)) is None
    assert provider.picture_requests == []


async def test_a_picture_only_userinfo_knows_is_asked_for_there(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """Many providers keep `picture` out of the ID token. Then the userinfo endpoint is
    asked, with the access token the token endpoint handed out."""
    await configure(session_factory)
    provider.userinfo = {"sub": SUBJECT, "picture": PICTURE_URL}

    await sign_up(anonymous_client, provider)

    assert stored(await own_player(session_factory)) == PNG
    assert provider.userinfo_requests[0]["authorization"] == f"Bearer {ACCESS_TOKEN}"


async def test_a_picture_in_the_id_token_needs_no_userinfo(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    await configure(session_factory)
    provider.userinfo = {"sub": SUBJECT, "picture": f"{PICTURE_URL}?from=userinfo"}

    await sign_up(anonymous_client, with_picture(provider))

    assert provider.userinfo_requests == []
    assert (await own_player(session_factory)).avatar_source_url == PICTURE_URL


async def test_a_userinfo_answer_about_somebody_else_is_ignored(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """OIDC Core 5.3.2: a userinfo `sub` that is not the ID token's must not be used."""
    await configure(session_factory)
    provider.userinfo = {"sub": "somebody-else", "picture": PICTURE_URL}

    with caplog.at_level(logging.WARNING, logger="ultrastar_wingman.auth"):
        await sign_up(anonymous_client, provider)

    assert stored(await own_player(session_factory)) is None
    assert provider.picture_requests == []
    assert "about somebody else" in caplog.text


async def test_a_userinfo_request_that_breaks_in_any_way_still_logs_the_singer_in(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Not an HTTP error but anything at all: the userinfo request runs inside the callback,
    where an exception left to rise would be a failed login — and its message, a traceback
    in the console that may quote the access token."""
    await configure(session_factory)
    provider.userinfo = {"sub": SUBJECT, "picture": PICTURE_URL}
    provider.userinfo_fault = f"broke while holding {ACCESS_TOKEN}"

    with caplog.at_level(logging.WARNING, logger="ultrastar_wingman.auth"):
        await sign_up(anonymous_client, provider)

    me = await anonymous_client.get("/api/v1/auth/me")
    assert me.json()["user"]["username"] == "singer"
    assert stored(await own_player(session_factory)) is None
    assert "(RuntimeError)" in caplog.text
    assert ACCESS_TOKEN not in caplog.text


async def test_an_upload_while_a_login_writes_the_provider_s_picture_wins(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The login has decided it may write and is writing when an upload arrives: the upload
    waits for it and lands on top, `manual` — never the provider's picture over the one
    somebody just chose."""
    await configure(session_factory)
    await sign_up(anonymous_client, with_picture(provider))
    player = await own_player(session_factory)
    provider.picture = png_header(7, 7)
    writing = asyncio.Event()
    release = asyncio.Event()
    real_store_image = players_service.store_image

    async def paused_store_image(directory: Path, stem: str, extension: str, data: bytes) -> Path:
        if not writing.is_set():
            # The login's write, the first one after the sign-up: hold it right there.
            writing.set()
            await release.wait()
        return await real_store_image(directory, stem, extension, data)

    monkeypatch.setattr(players_service, "store_image", paused_store_image)
    logging_in = asyncio.create_task(login(anonymous_client, provider))
    await asyncio.wait_for(writing.wait(), 5)
    chosen = png_header(8, 8)
    uploading = asyncio.create_task(
        anonymous_client.put(
            f"/api/v1/players/{player.id}/avatar",
            files={"file": ("me.png", chosen, "image/png")},
        )
    )
    # Unguarded, the upload would be done long before this runs out and the login's write
    # would then land on top of it.
    await asyncio.wait({uploading}, timeout=0.5)
    release.set()

    assert (await logging_in).headers["location"] == OK
    assert (await uploading).status_code == 200
    after = await own_player(session_factory)
    assert (stored(after), after.avatar_source, after.avatar_source_url) == (
        chosen,
        "manual",
        None,
    )


async def test_an_account_tells_how_it_logs_in(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    provider: FakeProvider,
) -> None:
    """`auth_provider` rides on every account, so the people admin can mark the single
    sign-on ones. The first account is the administrator, so it may read the list."""
    await configure(session_factory)
    await sign_up(anonymous_client, provider)
    await add_user(session_factory, "yannis", "user")

    me = await anonymous_client.get("/api/v1/auth/me")
    assert me.json()["user"]["auth_provider"] == "oidc"
    listed = await anonymous_client.get("/api/v1/users")
    assert {user["username"]: user["auth_provider"] for user in listed.json()["users"]} == {
        "singer": "oidc",
        "yannis": "local",
    }


# --- the migration -----------------------------------------------------------------


def test_migration_0036_marks_every_existing_picture_as_uploaded(tmp_path: Path) -> None:
    """Before 0036 the only way to a picture was an upload, so every row reads `manual`."""
    database = tmp_path / "wingman.db"
    url = f"sqlite+aiosqlite:///{database}"
    _upgrade(url, "0035")
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO players (id, name, registered, hidden, avatar_file, created_at) VALUES "
            "('p1', 'Alice', 0, 0, 'C:/avatars/p1.png', '2026-10-01'), "
            "('p2', 'Bob', 0, 0, NULL, '2026-10-01')"
        )

    _upgrade(url, "0036")

    with sqlite3.connect(database) as connection:
        assert connection.execute(
            "SELECT id, avatar_source, avatar_source_url, avatar_source_etag FROM players "
            "ORDER BY id"
        ).fetchall() == [("p1", "manual", None, None), ("p2", "manual", None, None)]

    _downgrade(url, "0035")

    with sqlite3.connect(database) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info('players')")}
        assert not columns & {"avatar_source", "avatar_source_url", "avatar_source_etag"}
        assert connection.execute("SELECT avatar_file FROM players WHERE id = 'p1'").fetchone()


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
