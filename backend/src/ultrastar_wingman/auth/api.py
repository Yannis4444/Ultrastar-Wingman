"""Auth, account administration and permission editing endpoints."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import SessionDep
from ..players.schema import avatar_version
from . import permissions, service
from .deps import (
    COOKIE_NAME,
    PrincipalDep,
    authenticated,
    claim_guest_wishes,
    clear_session_cookie,
    require,
    set_session_cookie,
)
from .model import User
from .oidc import router as oidc_router
from .permissions import (
    ImmutableRoleError,
    UnknownCapabilityError,
    UnknownRoleError,
)
from .providers import get_provider
from .schema import (
    MeRead,
    PermissionsRead,
    UserList,
    UserLookupList,
    UserLookupRead,
    UserRead,
    read_user,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["auth"])
# The OIDC redirect flow: its own module, same prefix, and importing it is what registers
# the provider in the registry.
router.include_router(oidc_router)

# Same rules as player names (trimmed, bounded, no charset restriction) so a guest who
# sang as "Jörg" can register under that exact name and keep their scores. It lives in
# `service.py` because the OIDC flow holds a chosen name to the very same rule.
Username = service.Username


# Trimmed first, then bounded: " a " is a one-letter query with padding, not a
# three-letter one.
LookupQuery = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=service.MIN_LOOKUP_LENGTH,
        max_length=service.MAX_USERNAME_LENGTH,
    ),
]


class RegisterRequest(BaseModel):
    username: Username
    password: Annotated[str, StringConstraints(min_length=service.MIN_PASSWORD_LENGTH)]


class LoginRequest(BaseModel):
    # Unconstrained on purpose: wrong credentials are a 401, never a validation error, so
    # a probe cannot tell "too short for us" from "wrong".
    username: str
    password: str


class HostTokenRequest(BaseModel):
    token: str


class UserUpdate(BaseModel):
    role: str


class RolePermissionsUpdate(BaseModel):
    capabilities: list[str]


@router.post(
    "/auth/register",
    response_model=UserRead,
    status_code=201,
    responses={409: {"description": "The username is taken."}},
)
async def register(
    body: RegisterRequest, request: Request, response: Response, session: SessionDep
) -> UserRead:
    """Create an account and log it in. The first account ever created is the administrator."""
    try:
        user = await service.register_user(session, body.username, body.password)
    except service.DuplicateUsernameError as error:
        raise HTTPException(status_code=409, detail="duplicate_username") from error
    set_session_cookie(response, await service.start_session(session, user.id))
    await claim_guest_wishes(request, session, user)
    return await service.read_user_with_player(session, user)


@router.post(
    "/auth/login",
    response_model=UserRead,
    responses={401: {"description": "Unknown username or wrong password."}},
)
async def login(
    body: LoginRequest, request: Request, response: Response, session: SessionDep
) -> UserRead:
    user = await get_provider(session).authenticate(body.username, body.password)
    if user is None:
        # One message for both cases: which usernames exist is not a client's business.
        raise HTTPException(status_code=401, detail="invalid_credentials")
    set_session_cookie(response, await service.start_session(session, user.id))
    await claim_guest_wishes(request, session, user)
    return await service.read_user_with_player(session, user)


@router.post(
    "/auth/logout",
    status_code=204,
    dependencies=[Depends(authenticated)],
    responses={401: {"description": "Not logged in."}},
)
async def logout(request: Request, response: Response, session: SessionDep) -> None:
    raw_token = request.cookies.get(COOKIE_NAME)
    if raw_token is not None:
        await service.end_session(session, raw_token)
    clear_session_cookie(response)


@router.get("/auth/me", response_model=MeRead)
async def get_me(principal: PrincipalDep, session: SessionDep) -> MeRead:
    """Who the caller is and what they may do. Anonymous callers get the `guest` role
    rather than a 401 — the UI hides what they cannot use instead of asking them to log in."""
    return MeRead(
        user=None
        if principal.user is None
        else await service.read_user_with_player(session, principal.user),
        role=principal.role,
        capabilities=sorted(principal.capabilities),
        is_host=principal.is_host,
    )


@router.post(
    "/auth/host",
    response_model=MeRead,
    responses={401: {"description": "The token is wrong or was already used."}},
)
async def exchange_host_token(
    body: HostTokenRequest, request: Request, response: Response, session: SessionDep
) -> MeRead:
    """Trade the one-time token from the host URL for a permanent trusted admin session.

    This is the only way to become the host: no header, no IP check — the old app trusted
    `X-Forwarded-For`, which any client can set.
    """
    host_token: service.HostToken = request.app.state.host_token
    if not host_token.consume(body.token):
        raise HTTPException(status_code=401, detail="invalid_host_token")
    set_session_cookie(response, await service.start_session(session, is_host=True))
    return MeRead(
        user=None,
        role=permissions.ADMIN,
        capabilities=sorted(permissions.ALL_CAPABILITIES),
        is_host=True,
    )


@router.get(
    "/users",
    response_model=UserList,
    # Reading who has an account is its own right: a helper who runs the players page has
    # no business promoting or deleting anybody, which is what `users.manage` is for.
    dependencies=[Depends(require("users.view"))],
)
async def list_users(session: SessionDep) -> UserList:
    players = await service.player_ids_by_user(session)
    return UserList(
        users=[read_user(user, players.get(user.id)) for user in await service.list_users(session)]
    )


@router.get(
    "/users/lookup",
    response_model=UserLookupList,
    # Identity, not a capability: anybody with an account (and the host session) has to be
    # able to find the person they want to share a playlist with. A guest gets a 401 —
    # there is nothing for them to share.
    dependencies=[Depends(authenticated)],
    responses={
        401: {"description": "Not logged in."},
        422: {"description": "The query is shorter than two characters."},
    },
)
async def lookup_users(q: LookupQuery, session: SessionDep) -> UserLookupList:
    """Accounts whose username starts with `q`. For picking somebody to share with, so it
    answers names and pictures and nothing about roles or rights."""
    return UserLookupList(
        users=[
            UserLookupRead(
                id=user.id,
                username=user.username,
                player_id=None if player is None else player.id,
                avatar_version=None if player is None else avatar_version(player.avatar_file),
            )
            for user, player in await service.find_users_by_prefix(session, q)
        ]
    )


@router.patch(
    "/users/{user_id}",
    response_model=UserRead,
    dependencies=[Depends(require("users.manage"))],
    responses={
        404: {"description": "Unknown user."},
        409: {"description": "This would leave the app without an administrator."},
    },
)
async def update_user(user_id: str, body: UserUpdate, session: SessionDep) -> UserRead:
    user = await _user(user_id, session)
    try:
        await service.set_user_role(session, user, body.role)
    except UnknownRoleError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except service.LastAdminError as error:
        raise HTTPException(status_code=409, detail="last_admin") from error
    return await service.read_user_with_player(session, user)


@router.delete(
    "/users/{user_id}",
    status_code=204,
    dependencies=[Depends(require("users.manage"))],
    responses={
        404: {"description": "Unknown user."},
        409: {"description": "This would leave the app without an administrator."},
    },
)
async def delete_user(user_id: str, session: SessionDep) -> None:
    """Delete an account. Its player stays as a temporary one, so the scores keep an owner."""
    try:
        await service.delete_user(session, await _user(user_id, session))
    except service.LastAdminError as error:
        raise HTTPException(status_code=409, detail="last_admin") from error


@router.get(
    "/permissions",
    response_model=PermissionsRead,
    dependencies=[Depends(require("permissions.manage"))],
)
async def get_permissions(session: SessionDep) -> PermissionsRead:
    return await _permissions(session)


@router.put(
    "/permissions/{role}",
    response_model=PermissionsRead,
    dependencies=[Depends(require("permissions.manage"))],
    responses={
        404: {"description": "Unknown role."},
        422: {"description": "Unknown capability, or the admin role (it is not editable)."},
    },
)
async def update_role_permissions(
    role: str, body: RolePermissionsUpdate, session: SessionDep
) -> PermissionsRead:
    """Replace what a role may do. Takes effect immediately, for every open session."""
    try:
        await permissions.set_role_capabilities(session, role, body.capabilities)
    except UnknownRoleError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (ImmutableRoleError, UnknownCapabilityError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return await _permissions(session)


async def _permissions(session: AsyncSession) -> PermissionsRead:
    mapping = await permissions.all_role_capabilities(session)
    return PermissionsRead(
        roles={role: sorted(mapping.get(role, frozenset())) for role in permissions.ROLES}
    )


async def _user(user_id: str, session: AsyncSession) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"unknown user '{user_id}'")
    return user
