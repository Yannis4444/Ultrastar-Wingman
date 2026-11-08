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
from ..library import service as library
from ..tags import service as tags
from . import groups, permissions, service
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
    """The caller. Anonymous callers are not rejected — they are in Guest.

    `groups` is every group the caller is in (permission-groups.md §3.2): `{guest}` without
    an account, `{user}` and every group an account has a row in, `{admin}` for the host
    screen. `capabilities` is the union of their bundles.
    """

    user: User | None
    is_host: bool
    groups: frozenset[str]
    # The host screen, or an account in Admin: every capability, and the two rules of §5
    # never bind.
    is_admin: bool
    capabilities: frozenset[str]

    def require(self, capability: str) -> None:
        """For the rare conditional check a route decorator cannot express (a forced sing
        also stops the running song)."""
        if capability not in self.capabilities:
            raise missing_permission(capability)


def missing_permission(capability: str) -> HTTPException:
    return HTTPException(status_code=403, detail=f"missing_permission:{capability}")


async def _principal(
    session: AsyncSession, user: User | None, is_host: bool, groups: frozenset[str]
) -> Principal:
    return Principal(
        user=user,
        is_host=is_host,
        groups=groups,
        is_admin=permissions.ADMIN in groups,
        capabilities=await permissions.capabilities_for_groups(session, groups),
    )


async def _guest(session: AsyncSession) -> Principal:
    return await _principal(session, None, False, frozenset({permissions.GUEST}))


async def current_principal(request: Request, session: SessionDep) -> Principal:
    raw_token = request.cookies.get(COOKIE_NAME)
    row = None if raw_token is None else await service.lookup_session(session, raw_token)
    if row is None:
        return await _guest(session)
    await service.touch_session(session, row)
    user = None if row.user_id is None else await session.get(User, row.user_id)
    if row.is_host:
        # The host UI is the TV next to the USDX machine: trusted by device, an
        # administrator without a row in Admin.
        return await _principal(session, user, True, frozenset({permissions.ADMIN}))
    if user is None:
        # The account behind the cookie is gone; the session is worthless.
        return await _guest(session)
    # Read on every request, never cached: a membership change reaches this account's next
    # request with nothing to invalidate (permission-groups.md §4).
    member_of = await groups.member_group_ids(session, user.id)
    return await _principal(session, user, False, frozenset({permissions.USER}) | member_of)


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


def require_any(*capabilities: str) -> Callable[[Principal], Principal]:
    """Dependency that refuses the request unless the caller holds at least one of
    `capabilities` — for a read several pages gated by different rights all draw from. The
    refusal names the first of them, so it reads like every other 403."""
    if not capabilities:
        raise ValueError("require_any needs at least one capability")
    unknown = next(
        (name for name in capabilities if name not in permissions.ALL_CAPABILITIES), None
    )
    if unknown is not None:
        raise ValueError(f"unknown capability '{unknown}'")

    def dependency(principal: PrincipalDep) -> Principal:
        if principal.capabilities.isdisjoint(capabilities):
            raise missing_permission(capabilities[0])
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


def tag_viewer(principal: Principal) -> tags.Viewer:
    """The caller as `tags.service` sees them. That module must not import FastAPI, so the
    `Principal` is taken apart here — the same split as the wishlist identity below."""
    return tags.Viewer(
        groups=principal.groups,
        user_id=None if principal.user is None else principal.user.id,
        is_admin=principal.is_admin,
    )


async def hidden_song_ids(principal: PrincipalDep, session: SessionDep) -> frozenset[str]:
    """The songs this caller may not see, because of a tag they hold no `view_songs` on.

    A dependency and not a check inside `songs.api`, because it reaches much further than
    the song list: every route that takes a song id has to answer 404 for one of these, or
    the id itself would tell the caller the song is there.
    """
    return await tags.hidden_song_ids(session, tag_viewer(principal))


HiddenSongsDep = Annotated[frozenset[str], Depends(hidden_song_ids)]


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


async def claim_guest_wishes(request: Request, session: AsyncSession, user: User) -> None:
    """Whoever wished as a guest in this browser keeps those wishes as this account.

    Every way into an account goes through here — registration, local login and the OIDC
    callback: a guest who spent the evening filling the wishlist and only then made an
    account must not lose it. The cookie itself stays — it costs nothing and the browser may
    well be handed to the next guest.
    """
    guest = guest_id(request)
    if guest is not None:
        await library.merge_guest_wishes(session, guest, user.id)


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
