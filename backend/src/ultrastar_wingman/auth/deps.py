"""Who is asking, and may they. The only place a permission is checked.

`require("songs.rescan")` is a FastAPI dependency, never an `if` inside a handler
(code-style.md), so the permission a route needs is visible in its decorator.
"""

import logging
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import SessionDep
from . import permissions, service
from .model import User

logger = logging.getLogger(__name__)

COOKIE_NAME = "wingman_session"

# The anonymous wishlist identity: one id per browser, so a guest keeps their wishes
# without an account. The old app keyed them by IP address instead — everybody behind the
# same NAT shared a wishlist, and a phone switching to mobile data lost its own.
GUEST_COOKIE_NAME = "wingman_guest"
GUEST_COOKIE_MAX_AGE = 365 * 24 * 60 * 60

_GUEST_ID = re.compile(r"[0-9a-f]{32}")


def set_session_cookie(response: Response, raw_token: str) -> None:
    """The session token only ever travels as this cookie — never in a response body, never
    in localStorage, so a cross-site script cannot read it.

    No Secure flag: Wingman is a LAN app served over plain http (the phones at the party
    reach it by IP), and a Secure cookie would simply never be sent back.
    """
    response.set_cookie(
        COOKIE_NAME,
        raw_token,
        max_age=int(service.SESSION_TTL.total_seconds()),
        httponly=True,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path="/")


@dataclass(frozen=True)
class Principal:
    """The caller. Anonymous callers are not rejected — they are the `guest` role."""

    user: User | None
    is_host: bool
    role: str
    capabilities: frozenset[str]

    def require(self, capability: str) -> None:
        """For the rare conditional check a route decorator cannot express (a forced sing
        also stops the running song)."""
        if capability not in self.capabilities:
            raise missing_permission(capability)


def missing_permission(capability: str) -> HTTPException:
    return HTTPException(status_code=403, detail=f"missing_permission:{capability}")


async def _guest(session: AsyncSession) -> Principal:
    return Principal(
        user=None,
        is_host=False,
        role=permissions.DEFAULT_ROLE,
        capabilities=await permissions.capabilities_for(session, permissions.DEFAULT_ROLE),
    )


async def current_principal(request: Request, session: SessionDep) -> Principal:
    raw_token = request.cookies.get(COOKIE_NAME)
    row = None if raw_token is None else await service.lookup_session(session, raw_token)
    if row is None:
        return await _guest(session)
    await service.touch_session(session, row)
    user = None if row.user_id is None else await session.get(User, row.user_id)
    if user is None and not row.is_host:
        # The account behind the cookie is gone; the session is worthless.
        return await _guest(session)
    # The host UI is the TV next to the USDX machine: trusted by device, always admin.
    role = permissions.ADMIN if row.is_host else (user.role if user else permissions.DEFAULT_ROLE)
    return Principal(
        user=user,
        is_host=row.is_host,
        role=role,
        capabilities=await permissions.capabilities_for(session, role),
    )


PrincipalDep = Annotated[Principal, Depends(current_principal)]


def require(capability: str) -> Callable[[Principal], Principal]:
    """Dependency that refuses the request unless the caller holds `capability`."""
    if capability not in permissions.ALL_CAPABILITIES:
        raise ValueError(f"unknown capability '{capability}'")

    def dependency(principal: PrincipalDep) -> Principal:
        if capability not in principal.capabilities:
            raise missing_permission(capability)
        return principal

    return dependency


async def authenticated(principal: PrincipalDep) -> Principal:
    """For the few routes where identity itself is the point, not a capability."""
    if principal.user is None and not principal.is_host:
        raise HTTPException(status_code=401, detail="not_authenticated")
    return principal


async def account_id(principal: PrincipalDep) -> str:
    """The account a row will belong to. Stricter than `authenticated`: the host session is
    an administrator but not a person, so it cannot own favorites or playlists."""
    if principal.user is None:
        raise HTTPException(status_code=401, detail="not_authenticated")
    return principal.user.id


AccountIdDep = Annotated[str, Depends(account_id)]


@dataclass(frozen=True)
class WishlistIdentity:
    """Who a wish belongs to: the account while logged in, else the browser's guest id.

    Both being None is an anonymous browser that has never wished for anything — it gets
    an id on its first wish, never on a read.
    """

    user_id: str | None
    guest_id: str | None


def guest_id(request: Request) -> str | None:
    """The request's guest id, or None. The cookie is client-supplied, so a value that is
    not shaped like one we issued is treated as absent rather than written to the database."""
    value = request.cookies.get(GUEST_COOKIE_NAME)
    return value if value is not None and _GUEST_ID.fullmatch(value) else None


async def wishlist_identity(request: Request, principal: PrincipalDep) -> WishlistIdentity:
    """A logged-in caller wishes as their account; everybody else as their browser."""
    if principal.user is not None:
        return WishlistIdentity(user_id=principal.user.id, guest_id=None)
    return WishlistIdentity(user_id=None, guest_id=guest_id(request))


WishlistIdentityDep = Annotated[WishlistIdentity, Depends(wishlist_identity)]


def issue_guest_id(identity: WishlistIdentity, response: Response) -> WishlistIdentity:
    """Give an anonymous browser a persistent id, once.

    Called from the wishlist mutation only: browsing the wishlist must not hand out a
    cookie, or every visitor would collect one for nothing.
    """
    if identity.user_id is not None or identity.guest_id is not None:
        return identity
    new_id = uuid.uuid4().hex
    # Same reasoning as the session cookie: HttpOnly and no Secure flag (plain http on the
    # LAN). A year, because the wishlist is the one thing a guest is expected to come back to.
    response.set_cookie(
        GUEST_COOKIE_NAME,
        new_id,
        max_age=GUEST_COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        path="/",
    )
    return WishlistIdentity(user_id=None, guest_id=new_id)
