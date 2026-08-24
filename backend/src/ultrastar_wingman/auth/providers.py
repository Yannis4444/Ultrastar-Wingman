"""The auth provider seam, plus password hashing for the local one.

One of the extension points from architecture.md: local accounts and OIDC (Keycloak). A
provider turns credentials into a Wingman user; everything after that — sessions, cookies,
capabilities — is provider-agnostic. The OIDC one (`oidc.py`) does not use `authenticate()`
at all: it is a redirect dance, not a password, so it brings its own routes and reuses
`service.start_session()`. It registers itself here so that a provider can be enumerated
and named without knowing how it authenticates.
"""

import logging
from collections.abc import Callable
from typing import Protocol

from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .model import User

logger = logging.getLogger(__name__)

# Provider names, as stored in `users.auth_provider`.
LOCAL = "local"
OIDC = "oidc"

# argon2id with the library's defaults, which track the current OWASP recommendation.
_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """Constant-time inside argon2. No rehash-on-verify: `PasswordHasher` parameters only
    change with a library upgrade, and a rehash here would need a writable session on a
    path that must also work for a failed login."""
    try:
        return _hasher.verify(password_hash, password)
    except Argon2Error:
        # Wrong password, or a stored hash argon2 cannot read — both mean "no".
        return False


class AuthProvider(Protocol):
    @property
    def name(self) -> str: ...

    async def authenticate(self, username: str, password: str) -> User | None:
        """The user these credentials belong to, or None. Must not distinguish "no such
        user" from "wrong password" to the caller — the API returns one message for both."""
        ...


class LocalAuthProvider:
    """Accounts stored in Wingman's own database."""

    name = LOCAL

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def authenticate(self, username: str, password: str) -> User | None:
        user = await find_by_username(self._session, username)
        if user is None or user.password_hash is None:
            # Hash anyway: an early return would make a missing username measurably faster
            # than a wrong password and leak which accounts exist — or, for the account
            # without a password (OIDC, which logs in through its own redirect flow), that
            # it is one.
            verify_password(_DUMMY_HASH, password)
            return None
        if not verify_password(user.password_hash, password):
            return None
        return user


# Hashed once at import, so the timing of a failed lookup matches a real verify.
_DUMMY_HASH = hash_password("wingman-timing-equalizer")


async def find_by_username(session: AsyncSession, username: str) -> User | None:
    result = await session.scalars(
        select(User).where(func.lower(User.username) == username.strip().lower())
    )
    return result.first()


# A provider is built per request because the local one needs the request's DB session.
ProviderFactory = Callable[[AsyncSession], AuthProvider]

PROVIDERS: dict[str, ProviderFactory] = {LocalAuthProvider.name: LocalAuthProvider}

DEFAULT_PROVIDER = LocalAuthProvider.name


def register(name: str, factory: ProviderFactory) -> None:
    if name in PROVIDERS:
        raise ValueError(f"auth provider '{name}' is already registered")
    PROVIDERS[name] = factory


def get_provider(session: AsyncSession, name: str = DEFAULT_PROVIDER) -> AuthProvider:
    factory = PROVIDERS.get(name)
    if factory is None:
        raise LookupError(f"unknown auth provider '{name}'")
    return factory(session)
