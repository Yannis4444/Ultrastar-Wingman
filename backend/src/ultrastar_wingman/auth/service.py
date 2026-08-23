"""Accounts, sessions and the host token. Knows nothing about FastAPI."""

import hashlib
import logging
import secrets
from collections.abc import Sequence
from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..players.model import Player
from .model import User, UserSession, as_utc, utcnow
from .permissions import ADMIN, ASSIGNABLE_ROLES, USER, UnknownRoleError
from .providers import find_by_username, hash_password

logger = logging.getLogger(__name__)

# A karaoke party host should not have to log in again next weekend.
SESSION_TTL = timedelta(days=90)

# The sliding expiry is refreshed at most this often: every request would otherwise write
# to the database just to read.
TOUCH_INTERVAL = timedelta(hours=1)

MIN_PASSWORD_LENGTH = 8


class DuplicateUsernameError(ValueError):
    def __init__(self, username: str) -> None:
        super().__init__(f"'{username}' is taken")
        self.username = username


class LastAdminError(ValueError):
    def __init__(self) -> None:
        super().__init__("the last administrator cannot be demoted or deleted")


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(raw_token: str) -> str:
    """Sessions are looked up by hash, so the raw cookie value is never stored. Plain
    sha256 is enough: the token is 256 bits of randomness, not a guessable password."""
    return hashlib.sha256(raw_token.encode()).hexdigest()


class HostToken:
    """The one-time token that turns the browser Wingman opened into a trusted admin.

    Lives in memory only (a restart mints a new one) and is consumed by the first
    successful exchange, so the URL in the log or the shell history is worthless afterwards.
    """

    def __init__(self) -> None:
        self._token: str | None = new_token()

    @property
    def unused(self) -> str | None:
        return self._token

    def consume(self, candidate: str) -> bool:
        if self._token is None:
            return False
        # compare_digest: the token is a secret, so no early-exit comparison. Encoded first
        # because compare_digest raises TypeError on a non-ASCII str — a client sending
        # {"token": "ö"} would get a 500 instead of a 401.
        if not secrets.compare_digest(self._token.encode(), candidate.encode()):
            return False
        self._token = None
        return True


def host_url(port: int, token: str) -> str:
    """Where the host UI has to be opened for the token to be exchanged. Always localhost:
    the point of the token is that it reaches the machine USDX runs on."""
    return f"http://localhost:{port}/host?hostToken={token}"


async def start_session(
    session: AsyncSession, user_id: str | None = None, is_host: bool = False
) -> str:
    """Create a session and return its raw token — the only time it exists in clear."""
    raw_token = new_token()
    now = utcnow()
    session.add(
        UserSession(
            token_hash=token_hash(raw_token),
            user_id=user_id,
            is_host=is_host,
            created_at=now,
            last_seen_at=now,
            expires_at=now + SESSION_TTL,
        )
    )
    await session.commit()
    return raw_token


async def lookup_session(session: AsyncSession, raw_token: str) -> UserSession | None:
    """The session behind a cookie value, or None when it is unknown or expired. An expired
    row is dropped on the way past, which is the only cleanup sessions need."""
    row = await session.get(UserSession, token_hash(raw_token))
    if row is None:
        return None
    if as_utc(row.expires_at) <= utcnow():
        await session.delete(row)
        await session.commit()
        return None
    return row


async def touch_session(session: AsyncSession, row: UserSession) -> None:
    """Slide the expiry forward, at most once per `TOUCH_INTERVAL`."""
    now = utcnow()
    if now - as_utc(row.last_seen_at) < TOUCH_INTERVAL:
        return
    row.last_seen_at = now
    row.expires_at = now + SESSION_TTL
    await session.commit()


async def end_session(session: AsyncSession, raw_token: str) -> bool:
    row = await session.get(UserSession, token_hash(raw_token))
    if row is None:
        return False
    await session.delete(row)
    await session.commit()
    return True


async def register_user(session: AsyncSession, username: str, password: str) -> User:
    """Create an account and the player it sings as.

    The very first account is the administrator — there is nobody who could grant it.
    Raises `DuplicateUsernameError`.
    """
    username = username.strip()
    if await find_by_username(session, username) is not None:
        raise DuplicateUsernameError(username)

    existing_users = await session.scalar(select(func.count()).select_from(User))
    user = User(
        username=username,
        password_hash=hash_password(password),
        role=ADMIN if not existing_users else USER,
    )
    session.add(user)
    await session.flush()
    await _attach_player(session, user)
    try:
        await session.commit()
    except IntegrityError as error:
        # The unique indexes on lower(username) / lower(name) are the authority, so two
        # simultaneous registrations cannot both win.
        await session.rollback()
        raise DuplicateUsernameError(username) from error
    logger.info("user '%s' registered as %s (%s)", user.username, user.role, user.id)
    return user


async def _attach_player(session: AsyncSession, user: User) -> Player:
    """Link the temporary player of that name if there is one, otherwise create the player.

    Somebody who sang all evening as a guest keeps their scores when they finally register.
    """
    existing = await player_by_name(session, user.username)
    if existing is not None:
        if existing.user_id is not None:
            raise DuplicateUsernameError(user.username)
        existing.user_id = user.id
        existing.registered = True
        return existing
    player = Player(name=user.username, user_id=user.id, registered=True)
    session.add(player)
    return player


async def player_by_name(session: AsyncSession, name: str) -> Player | None:
    result = await session.scalars(
        select(Player).where(func.lower(Player.name) == name.strip().lower())
    )
    return result.first()


async def player_for_user(session: AsyncSession, user_id: str) -> Player | None:
    result = await session.scalars(select(Player).where(Player.user_id == user_id))
    return result.first()


async def player_ids_by_user(session: AsyncSession) -> dict[str, str]:
    """user id -> player id, for listing users without a query per row."""
    rows = await session.execute(
        select(Player.user_id, Player.id).where(Player.user_id.is_not(None))
    )
    return {user_id: player_id for user_id, player_id in rows if user_id is not None}


async def list_users(session: AsyncSession) -> Sequence[User]:
    result = await session.scalars(select(User).order_by(func.lower(User.username), User.id))
    return result.all()


async def set_user_role(session: AsyncSession, user: User, role: str) -> User:
    """Raises `UnknownRoleError`, or `LastAdminError` when this would leave no admin."""
    if role not in ASSIGNABLE_ROLES:
        raise UnknownRoleError(role)
    if user.role == ADMIN and role != ADMIN and await _admin_count(session) <= 1:
        raise LastAdminError
    user.role = role
    await session.commit()
    logger.info("user '%s' is now %s", user.username, role)
    return user


async def delete_user(session: AsyncSession, user: User) -> None:
    """Delete the account. Its player survives as a temporary one so the statistics it
    already collected keep their owner. Raises `LastAdminError`."""
    if user.role == ADMIN and await _admin_count(session) <= 1:
        raise LastAdminError
    player = await player_for_user(session, user.id)
    if player is not None:
        player.user_id = None
        player.registered = False
    # In the same transaction as the delete: a live cookie must not outlive its account.
    await session.execute(delete(UserSession).where(UserSession.user_id == user.id))
    await session.delete(user)
    await session.commit()
    logger.info("user '%s' deleted (%s)", user.username, user.id)


async def _admin_count(session: AsyncSession) -> int:
    return (
        await session.scalar(select(func.count()).select_from(User).where(User.role == ADMIN)) or 0
    )
