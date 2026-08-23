"""Who is asking, and may they. The only place a permission is checked.

`require("songs.rescan")` is a FastAPI dependency, never an `if` inside a handler
(code-style.md), so the permission a route needs is visible in its decorator.
"""

import logging
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
