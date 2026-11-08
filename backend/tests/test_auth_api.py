"""Registration, login, sessions and account administration."""

import logging
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from conftest import ADMIN_PASSWORD, ADMIN_TOKEN, ADMIN_USERNAME, add_session, add_user
from ultrastar_wingman.auth import service
from ultrastar_wingman.auth.deps import COOKIE_NAME
from ultrastar_wingman.auth.model import User, UserSession, as_utc, utcnow
from ultrastar_wingman.auth.permissions import (
    ALL_CAPABILITIES,
    DEFAULT_GROUP_CAPABILITIES,
    TRUSTED_GROUP_ID,
)
from ultrastar_wingman.auth.providers import verify_password
from ultrastar_wingman.auth.service import SESSION_TTL, token_hash
from ultrastar_wingman.players.model import Player

# What `/auth/me` says a caller without an account is in.
GUEST_GROUPS = [{"id": "guest", "name": "Guest"}]

PASSWORD = "correct horse"


def cookie(raw_token: str) -> dict[str, str]:
    """Send a session cookie explicitly instead of relying on the client's jar."""
    return {"Cookie": f"{COOKIE_NAME}={raw_token}"}


async def register(
    client: AsyncClient, username: str, password: str = PASSWORD
) -> dict[str, object]:
    """Register an account. Registering logs it in, so a client that already had a session
    keeps its own — otherwise the admin fixture would turn into whoever it just created."""
    before = client.cookies.get(COOKIE_NAME)
    response = await client.post(
        "/api/v1/auth/register", json={"username": username, "password": password}
    )
    assert response.status_code == 201, response.text
    if before is not None:
        client.cookies.clear()
        client.cookies.set(COOKIE_NAME, before)
    result: dict[str, object] = response.json()
    return result


async def session_row(
    session_factory: async_sessionmaker[AsyncSession], raw_token: str
) -> UserSession | None:
    async with session_factory() as session:
        return await session.get(UserSession, token_hash(raw_token))


async def test_the_first_account_is_admin_and_the_second_is_a_user(
    anonymous_client: AsyncClient,
) -> None:
    """Nobody could grant the first admin, so registering it does."""
    first = await register(anonymous_client, "yannis")
    assert first["groups"] == ["admin"]

    # A separate client: the first registration left a session cookie in the jar.
    second = await anonymous_client.post(
        "/api/v1/auth/register", json={"username": "alex", "password": PASSWORD}
    )
    assert second.status_code == 201
    # In User alone, which takes no row.
    assert second.json()["groups"] == []


async def test_register_sets_a_httponly_lax_session_cookie(
    anonymous_client: AsyncClient,
) -> None:
    response = await anonymous_client.post(
        "/api/v1/auth/register", json={"username": "yannis", "password": PASSWORD}
    )

    assert response.status_code == 201
    header = response.headers["set-cookie"]
    assert header.startswith(f"{COOKIE_NAME}=")
    assert "HttpOnly" in header
    assert "SameSite=lax" in header
    assert "Path=/" in header
    assert f"Max-Age={int(SESSION_TTL.total_seconds())}" in header
    # No Secure flag: Wingman is served over plain http on the LAN, so a Secure cookie
    # would never come back.
    assert "Secure" not in header


async def test_register_creates_a_registered_player(
    anonymous_client: AsyncClient, session: AsyncSession
) -> None:
    user = await register(anonymous_client, "Yannis")

    player = await session.get(Player, user["player_id"])
    assert player is not None
    assert player.name == "Yannis"
    assert player.registered is True
    assert player.user_id == user["id"]


async def test_register_links_an_existing_temporary_player(
    anonymous_client: AsyncClient, session: AsyncSession
) -> None:
    """Somebody who sang all evening as a guest keeps their scores when they register."""
    guest = Player(name="Yannis")
    session.add(guest)
    await session.commit()

    # Different case on purpose: player names are unique case-insensitively.
    user = await register(anonymous_client, "yannis")

    assert user["player_id"] == guest.id
    await session.refresh(guest)
    assert guest.registered is True
    assert guest.user_id == user["id"]
    assert len(list(await session.scalars(select(Player)))) == 1


async def test_registering_over_a_hidden_guest_shows_them_again(
    anonymous_client: AsyncClient, session: AsyncSession
) -> None:
    """The guest was put out of the picker when they left; registering says they are back."""
    guest = Player(name="Yannis", hidden=True)
    session.add(guest)
    await session.commit()

    user = await register(anonymous_client, "yannis")

    assert user["player_id"] == guest.id
    await session.refresh(guest)
    assert guest.hidden is False


async def test_logging_in_shows_a_hidden_player_again(
    anonymous_client: AsyncClient, session: AsyncSession
) -> None:
    """ "If a player logs in, unhide them": hiding is for the evening, not for the account."""
    user = await register(anonymous_client, "yannis")
    player = await session.get(Player, user["player_id"])
    assert player is not None
    player.hidden = True
    await session.commit()

    response = await anonymous_client.post(
        "/api/v1/auth/login", json={"username": "yannis", "password": PASSWORD}
    )

    assert response.status_code == 200
    await session.refresh(player)
    assert player.hidden is False


async def test_showing_a_player_again_on_login_announces_it_and_a_plain_login_does_not(
    anonymous_client: AsyncClient,
    session: AsyncSession,
    broadcast_events: list[dict[str, object]],
) -> None:
    """Coming back into the picker changes what `GET /players` answers; a login that
    changes nothing about the player is no reason for every screen to refetch it."""
    user = await register(anonymous_client, "yannis")
    login = {"username": "yannis", "password": PASSWORD}
    broadcast_events.clear()

    assert (await anonymous_client.post("/api/v1/auth/login", json=login)).status_code == 200
    assert {"event": "players.changed"} not in broadcast_events

    player = await session.get(Player, user["player_id"])
    assert player is not None
    player.hidden = True
    await session.commit()

    assert (await anonymous_client.post("/api/v1/auth/login", json=login)).status_code == 200
    assert broadcast_events.count({"event": "players.changed"}) == 1


async def test_logging_in_without_a_player_is_fine(
    anonymous_client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    """The fixture admin has no player row, and unhiding must not go looking for one."""
    user_id = await add_user(session_factory, "playerless")
    async with session_factory() as session:
        assert await session.scalar(select(Player).where(Player.user_id == user_id)) is None

    response = await anonymous_client.post(
        "/api/v1/auth/login", json={"username": "playerless", "password": ADMIN_PASSWORD}
    )

    assert response.status_code == 200


@pytest.mark.parametrize(
    ("username", "expected"),
    [
        ("  Spacey  ", 201),
        ("ab", 422),
        ("abc", 201),
        ("x" * 32, 201),
        ("x" * 33, 422),
        ("   ", 422),
        # No charset rule, exactly like player names — otherwise "Jörg" could sing as a
        # guest but never register under that name.
        ("Jörg Ünïcode!", 201),
    ],
)
async def test_the_username_is_trimmed_and_bounded(
    anonymous_client: AsyncClient, username: str, expected: int
) -> None:
    response = await anonymous_client.post(
        "/api/v1/auth/register", json={"username": username, "password": PASSWORD}
    )

    assert response.status_code == expected, response.text
    if expected == 201:
        assert response.json()["username"] == username.strip()


@pytest.mark.parametrize(("password", "expected"), [("short12", 422), ("exactly8", 201)])
async def test_the_password_has_a_minimum_length(
    anonymous_client: AsyncClient, password: str, expected: int
) -> None:
    response = await anonymous_client.post(
        "/api/v1/auth/register", json={"username": "yannis", "password": password}
    )
    assert response.status_code == expected, response.text


async def test_a_duplicate_username_is_409_regardless_of_case(
    anonymous_client: AsyncClient, session: AsyncSession
) -> None:
    await register(anonymous_client, "Yannis")

    conflict = await anonymous_client.post(
        "/api/v1/auth/register", json={"username": "yAnNiS", "password": PASSWORD}
    )

    assert conflict.status_code == 409
    assert conflict.json() == {"detail": "duplicate_username"}
    assert len(list(await session.scalars(select(User)))) == 1


async def test_a_name_taken_after_the_check_is_still_409(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two people registering the same name at once: the unique index has the last word.

    Blinding the check that runs before the write is what stands in for that race here —
    it is the only way to reach the index from one request — and the refusal has to read
    exactly like the check's own, because to the person typing it is the same thing.
    """
    await add_user(session_factory, "yannis", groups=["admin"])

    async def free(session: AsyncSession, username: str) -> User | None:
        return None

    monkeypatch.setattr(service, "find_by_username", free)

    conflict = await anonymous_client.post(
        "/api/v1/auth/register", json={"username": "Yannis", "password": PASSWORD}
    )

    assert conflict.status_code == 409
    assert conflict.json() == {"detail": "duplicate_username"}
    assert COOKIE_NAME not in anonymous_client.cookies
    async with session_factory() as session:
        assert len(list(await session.scalars(select(User)))) == 1


async def test_login_returns_the_account_and_a_fresh_session(
    anonymous_client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    registered = await register(anonymous_client, "yannis")

    response = await anonymous_client.post(
        "/api/v1/auth/login", json={"username": "YANNIS", "password": PASSWORD}
    )

    assert response.status_code == 200
    assert response.json() == registered
    assert "HttpOnly" in response.headers["set-cookie"]
    # Registration and login each opened one, and neither is the other's.
    async with session_factory() as session:
        assert len(list(await session.scalars(select(UserSession)))) == 2


async def test_wrong_credentials_are_always_the_same_401(anonymous_client: AsyncClient) -> None:
    """A probe must not be able to tell an unknown username from a wrong password."""
    await register(anonymous_client, "yannis")

    wrong_password = await anonymous_client.post(
        "/api/v1/auth/login", json={"username": "yannis", "password": "not the password"}
    )
    unknown_user = await anonymous_client.post(
        "/api/v1/auth/login", json={"username": "nobody", "password": PASSWORD}
    )

    assert wrong_password.status_code == unknown_user.status_code == 401
    assert wrong_password.json() == unknown_user.json() == {"detail": "invalid_credentials"}


async def test_logout_deletes_the_session_and_clears_the_cookie(
    client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    response = await client.post("/api/v1/auth/logout")

    assert response.status_code == 204
    assert f'{COOKIE_NAME}=""' in response.headers["set-cookie"]
    assert await session_row(session_factory, ADMIN_TOKEN) is None
    # The cookie value is worthless from now on, whoever still holds it.
    me = await client.get("/api/v1/auth/me", headers=cookie(ADMIN_TOKEN))
    assert me.json()["groups"] == GUEST_GROUPS


async def test_the_console_names_who_logs_in_and_out_and_never_a_secret(
    anonymous_client: AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="ultrastar_wingman.auth")
    await register(anonymous_client, "yannis")
    anonymous_client.cookies.clear()

    await anonymous_client.post(
        "/api/v1/auth/login", json={"username": "yannis", "password": "typed-by-mistake"}
    )
    await anonymous_client.post(
        "/api/v1/auth/login", json={"username": "yannis", "password": PASSWORD}
    )
    await anonymous_client.post("/api/v1/auth/logout")

    lines = [record.getMessage() for record in caplog.records]
    assert lines == [
        "'yannis' registered an account (administrator)",
        # Without the name: somebody types their password into the name field sooner or later.
        "A login was refused: unknown name or wrong password",
        "'yannis' logged in",
        "'yannis' logged out",
    ]
    assert not any(PASSWORD in line or "typed-by-mistake" in line for line in lines)


async def test_logout_without_a_session_is_401(anonymous_client: AsyncClient) -> None:
    response = await anonymous_client.post("/api/v1/auth/logout")
    assert response.status_code == 401
    assert response.json() == {"detail": "not_authenticated"}


async def test_me_describes_an_anonymous_caller_as_a_guest(
    anonymous_client: AsyncClient,
) -> None:
    response = await anonymous_client.get("/api/v1/auth/me")

    assert response.status_code == 200
    assert response.json() == {
        "user": None,
        "groups": GUEST_GROUPS,
        "is_admin": False,
        "capabilities": sorted(DEFAULT_GROUP_CAPABILITIES["guest"]),
        "is_host": False,
    }


async def test_me_describes_the_logged_in_admin(client: AsyncClient) -> None:
    response = await client.get("/api/v1/auth/me")

    assert response.status_code == 200
    body = response.json()
    # Every account is in User; the administrator is in Admin as well, and Admin goes last.
    assert body["groups"] == [{"id": "user", "name": "User"}, {"id": "admin", "name": "Admin"}]
    assert body["is_admin"] is True
    assert body["user"]["groups"] == ["admin"]
    assert body["is_host"] is False
    assert body["capabilities"] == sorted(ALL_CAPABILITIES)
    assert body["user"]["username"] == ADMIN_USERNAME


async def test_the_password_is_stored_as_an_argon2_hash(
    anonymous_client: AsyncClient, session: AsyncSession
) -> None:
    await register(anonymous_client, "yannis", "hunter2 hunter2")

    user = (await session.scalars(select(User))).one()
    # Only an OIDC account is allowed to have no hash at all.
    assert user.password_hash is not None
    assert user.auth_provider == "local"
    assert user.password_hash.startswith("$argon2id$")
    assert PASSWORD not in user.password_hash
    assert "hunter2" not in user.password_hash
    assert verify_password(user.password_hash, "hunter2 hunter2")
    assert not verify_password(user.password_hash, "hunter2 hunter3")


async def test_an_unknown_session_cookie_acts_as_a_guest(anonymous_client: AsyncClient) -> None:
    response = await anonymous_client.get("/api/v1/auth/me", headers=cookie("not-a-real-token"))

    assert response.status_code == 200
    assert response.json()["groups"] == GUEST_GROUPS


async def test_an_expired_session_acts_as_a_guest_and_is_dropped(
    anonymous_client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    token = "expired-token"
    user_id = await add_user(session_factory, "yannis", groups=["admin"])
    await add_session(session_factory, token, user_id, expires_at=utcnow() - timedelta(seconds=1))

    response = await anonymous_client.get("/api/v1/auth/me", headers=cookie(token))

    assert response.json()["groups"] == GUEST_GROUPS
    assert await session_row(session_factory, token) is None


async def test_the_sliding_expiry_is_bumped_at_most_once_an_hour(
    anonymous_client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    token = "sliding-token"
    user_id = await add_user(session_factory, "yannis")
    # Seen five minutes ago, so the expiry is still the one from an hour ago.
    original_expiry = utcnow() - timedelta(hours=1) + SESSION_TTL
    await add_session(
        session_factory,
        token,
        user_id,
        last_seen_at=utcnow() - timedelta(minutes=5),
        expires_at=original_expiry,
    )

    assert (await anonymous_client.get("/api/v1/auth/me", headers=cookie(token))).status_code == 200

    row = await session_row(session_factory, token)
    assert row is not None
    # Untouched: a request per second must not mean a write per second.
    assert abs(as_utc(row.expires_at) - original_expiry) < timedelta(seconds=5)

    async with session_factory() as session:
        stale = await session.get(UserSession, token_hash(token))
        assert stale is not None
        stale.last_seen_at = utcnow() - timedelta(hours=2)
        await session.commit()

    assert (await anonymous_client.get("/api/v1/auth/me", headers=cookie(token))).status_code == 200

    row = await session_row(session_factory, token)
    assert row is not None
    assert as_utc(row.expires_at) - original_expiry > timedelta(minutes=30)


async def test_list_users_shows_the_linked_player(client: AsyncClient) -> None:
    created = await register(client, "alex")

    response = await client.get("/api/v1/users")

    assert response.status_code == 200
    by_name = {user["username"]: user for user in response.json()["users"]}
    assert by_name["alex"] == created
    # The fixture admin was inserted without a player, which must not break the listing.
    assert by_name[ADMIN_USERNAME]["player_id"] is None


async def test_a_users_groups_can_be_changed(client: AsyncClient) -> None:
    user = await register(client, "alex")

    response = await client.put(
        f"/api/v1/users/{user['id']}/groups", json={"groups": [TRUSTED_GROUP_ID]}
    )

    assert response.status_code == 200
    assert response.json()["groups"] == [TRUSTED_GROUP_ID]
    listed = {row["username"]: row for row in (await client.get("/api/v1/users")).json()["users"]}
    assert listed["alex"]["groups"] == [TRUSTED_GROUP_ID]


async def test_an_unknown_group_or_user_is_refused(client: AsyncClient) -> None:
    user = await register(client, "alex")

    wizard = await client.put(f"/api/v1/users/{user['id']}/groups", json={"groups": ["wizard"]})
    assert (wizard.status_code, wizard.json()) == (422, {"detail": "unknown_group"})
    # Guest is the anonymous fallback and User is every account: neither is assigned.
    for built_in in ("guest", "user"):
        refused = await client.put(
            f"/api/v1/users/{user['id']}/groups", json={"groups": [built_in]}
        )
        assert (refused.status_code, refused.json()) == (422, {"detail": "not_assignable"})
    assert (await client.put("/api/v1/users/nope/groups", json={"groups": []})).status_code == 404
    assert (await client.delete("/api/v1/users/nope")).status_code == 404


async def test_deleting_a_user_unlinks_their_player(
    client: AsyncClient, session: AsyncSession
) -> None:
    """The player survives as a temporary one, so the scores it collected keep their owner."""
    user = await register(client, "alex")

    response = await client.delete(f"/api/v1/users/{user['id']}")

    assert response.status_code == 204
    player = await session.get(Player, user["player_id"])
    assert player is not None
    assert player.registered is False
    assert player.user_id is None
    assert list(await session.scalars(select(User).where(User.id == user["id"]))) == []


async def test_registering_and_deleting_an_account_announce_the_players_list(
    client: AsyncClient, broadcast_events: list[dict[str, object]]
) -> None:
    """Registering adds a player (or makes a guest's one the account's) and deleting the
    account turns it back into a temporary one: both change what `GET /players` answers."""
    user = await register(client, "alex")
    assert {"event": "players.changed"} in broadcast_events
    broadcast_events.clear()

    assert (await client.delete(f"/api/v1/users/{user['id']}")).status_code == 204

    assert {"event": "players.changed"} in broadcast_events


async def test_deleting_a_user_kills_their_sessions(
    client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    user = await register(client, "alex")
    token = "alex-token"
    await add_session(session_factory, token, str(user["id"]))

    assert (await client.delete(f"/api/v1/users/{user['id']}")).status_code == 204

    assert await session_row(session_factory, token) is None
    me = await client.get("/api/v1/auth/me", headers=cookie(token))
    assert me.json()["groups"] == GUEST_GROUPS


async def test_the_last_admin_cannot_be_demoted_or_deleted(
    client: AsyncClient, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    admin = (await client.get("/api/v1/auth/me")).json()["user"]

    demoted = await client.put(f"/api/v1/users/{admin['id']}/groups", json={"groups": []})
    deleted = await client.delete(f"/api/v1/users/{admin['id']}")

    assert demoted.status_code == deleted.status_code == 409
    assert demoted.json() == deleted.json() == {"detail": "last_admin"}

    # With a second admin around, both are allowed again.
    await add_user(session_factory, "other-admin", groups=["admin"])
    assert (
        await client.put(f"/api/v1/users/{admin['id']}/groups", json={"groups": []})
    ).status_code == 200
