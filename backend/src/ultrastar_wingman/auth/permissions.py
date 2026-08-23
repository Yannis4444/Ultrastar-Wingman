"""Capabilities, roles and the runtime-editable mapping between them.

Permission checks are named by capability, never by role (architecture.md): a role is a
bundle of capabilities, stored in `role_permissions` and editable through the API. The
mapping is cached in this module because every single request reads it.
"""

import logging

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .model import RolePermission

logger = logging.getLogger(__name__)

# Every capability Wingman knows. Adding one means adding a `require(...)` somewhere and
# granting it to a role — no migration needed.
CAPABILITIES: tuple[str, ...] = (
    "songs.view",
    "songs.rescan",
    "karaoke.sing",
    "karaoke.stop",
    "players.view",
    "players.manage",
    "wishlist.view",
    "wishlist.add",
    "playlists.view",
    "playlists.manage",
    "downloads.view",
    "downloads.manage",
    "usdb.search",
    "stats.view",
    "stats.manage",
    "settings.view",
    "settings.manage",
    "users.manage",
    "permissions.manage",
)

ALL_CAPABILITIES = frozenset(CAPABILITIES)

GUEST = "guest"
USER = "user"
TRUSTED = "trusted"
ADMIN = "admin"

# Anonymous requests act as this role — a party guest can browse and start a song.
DEFAULT_ROLE = GUEST

ROLES: tuple[str, ...] = (GUEST, USER, TRUSTED, ADMIN)

# Roles a user account can hold. `guest` is deliberately not among them: it is the role
# anonymous callers act as, so demoting an account to it would say "logged in, but treated
# exactly like a stranger" — take the account away instead.
ASSIGNABLE_ROLES: tuple[str, ...] = (USER, TRUSTED, ADMIN)

# A party guest browses, wishes, sings and looks at the scoreboard — wishing is the whole
# point of the guest cookie.
_GUEST_CAPABILITIES = frozenset(
    {
        "songs.view",
        "players.view",
        "karaoke.sing",
        "wishlist.view",
        "wishlist.add",
        "playlists.view",
        "stats.view",
    }
)
# Only an account can own a playlist, so only an account may manage one.
_USER_CAPABILITIES = _GUEST_CAPABILITIES | {"karaoke.stop", "players.manage", "playlists.manage"}
# Naming a session is a host's job, so it starts at `trusted`.
_TRUSTED_CAPABILITIES = _USER_CAPABILITIES | {
    "downloads.view",
    "downloads.manage",
    "usdb.search",
    "songs.rescan",
    "stats.manage",
}

# What migration 0006 seeds. Kept here as well so a test can prove the two never drift.
DEFAULT_ROLE_CAPABILITIES: dict[str, frozenset[str]] = {
    GUEST: _GUEST_CAPABILITIES,
    USER: _USER_CAPABILITIES,
    TRUSTED: _TRUSTED_CAPABILITIES,
    ADMIN: ALL_CAPABILITIES,
}


class UnknownRoleError(LookupError):
    def __init__(self, role: str) -> None:
        super().__init__(f"unknown role '{role}'")
        self.role = role


class UnknownCapabilityError(LookupError):
    def __init__(self, capability: str) -> None:
        super().__init__(f"unknown capability '{capability}'")
        self.capability = capability


class ImmutableRoleError(ValueError):
    def __init__(self, role: str) -> None:
        super().__init__(f"role '{role}' always holds every capability and cannot be changed")
        self.role = role


# Read on every request, written only by `set_role_capabilities`. `None` means "not loaded".
_cache: dict[str, frozenset[str]] | None = None


def invalidate_cache() -> None:
    global _cache
    _cache = None


async def all_role_capabilities(session: AsyncSession) -> dict[str, frozenset[str]]:
    """The full mapping, one query per process until it is invalidated."""
    global _cache
    if _cache is None:
        rows = await session.scalars(select(RolePermission))
        loaded: dict[str, set[str]] = {role: set() for role in ROLES}
        for row in rows:
            # A capability that was dropped from the code stays in the table until the row
            # is rewritten; ignoring it keeps an old database usable.
            if row.capability in ALL_CAPABILITIES:
                loaded.setdefault(row.role, set()).add(row.capability)
        # Admin is not data: a wrong row (or a hand-edited database) must never be able to
        # lock every administrator out of the app.
        loaded[ADMIN] = set(ALL_CAPABILITIES)
        _cache = {role: frozenset(capabilities) for role, capabilities in loaded.items()}
    return _cache


async def capabilities_for(session: AsyncSession, role: str) -> frozenset[str]:
    """The capabilities of `role`. An unknown role gets nothing rather than raising —
    a stale role string in the database must not turn into a 500."""
    return (await all_role_capabilities(session)).get(role, frozenset())


async def set_role_capabilities(
    session: AsyncSession, role: str, capabilities: list[str]
) -> frozenset[str]:
    """Replace a role's capabilities. Raises `UnknownRoleError`, `UnknownCapabilityError`
    or `ImmutableRoleError`."""
    if role not in ROLES:
        raise UnknownRoleError(role)
    if role == ADMIN:
        raise ImmutableRoleError(role)
    unknown = next((name for name in capabilities if name not in ALL_CAPABILITIES), None)
    if unknown is not None:
        raise UnknownCapabilityError(unknown)

    await session.execute(delete(RolePermission).where(RolePermission.role == role))
    session.add_all(
        RolePermission(role=role, capability=capability) for capability in set(capabilities)
    )
    await session.commit()
    invalidate_cache()
    logger.info("role '%s' now holds %d capabilities", role, len(set(capabilities)))
    return frozenset(capabilities)
