"""Auth, account administration and permission group endpoints."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import SessionDep
from ..players.schema import avatar_version
from . import groups, permissions, service
from .deps import (
    COOKIE_NAME,
    Principal,
    PrincipalDep,
    authenticated,
    claim_guest_wishes,
    clear_session_cookie,
    require,
    require_any,
    set_session_cookie,
)
from .model import Group, User
from .oidc import router as oidc_router
from .permissions import (
    AdminNotEditableError,
    BuiltInGroupError,
    NotAssignableError,
    UnknownCapabilityError,
    UnknownGroupError,
)
from .providers import get_provider
from .schema import (
    GroupList,
    GroupRead,
    MeRead,
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


# Trimmed first, then bounded — the tag name's rules (permission-groups.md §2.4).
GroupName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=permissions.MAX_GROUP_NAME_LENGTH
    ),
]


class GroupCreate(BaseModel):
    name: GroupName
    capabilities: list[str] = Field(default_factory=list)


class GroupUpdate(BaseModel):
    """A PATCH touches what it names: a name, the whole set of capabilities, or both."""

    name: GroupName | None = None
    capabilities: list[str] | None = None


class UserGroupsUpdate(BaseModel):
    # The account's explicit memberships, whole — never `user`, which every account is in.
    groups: list[str]


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
    """Who the caller is and what they may do. Anonymous callers are in Guest rather than
    getting a 401 — the UI hides what they cannot use instead of asking them to log in."""
    return MeRead(
        user=None
        if principal.user is None
        else await service.read_user_with_player(session, principal.user),
        groups=await groups.group_refs(session, principal.groups),
        is_admin=principal.is_admin,
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
        groups=await groups.group_refs(session, {permissions.ADMIN}),
        is_admin=True,
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
    member_of = await groups.memberships(session)
    return UserList(
        users=[
            read_user(user, players.get(user.id), member_of.get(user.id, []))
            for user in await service.list_users(session)
        ]
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


@router.put(
    "/users/{user_id}/groups",
    response_model=UserRead,
    dependencies=[Depends(require("users.manage"))],
    responses={
        403: {
            "description": "Only an administrator changes who is in Admin (`admin_required`), "
            "or the caller does not hold everything a group they add carries "
            "(`missing_permission:<capability>`)."
        },
        404: {"description": "Unknown user."},
        409: {"description": "This would leave the app without an administrator."},
        422: {"description": "A group that does not exist, or User or Guest."},
    },
)
async def set_user_groups(
    user_id: str, body: UserGroupsUpdate, session: SessionDep, principal: PrincipalDep
) -> UserRead:
    """Put the account in exactly these groups — its whole set; every account is in User
    without being named. Takes effect on the account's next request."""
    user = await _user(user_id, session)
    try:
        await groups.set_user_groups(session, user, body.groups, _caller(principal))
    except NotAssignableError as error:
        raise HTTPException(status_code=422, detail="not_assignable") from error
    except UnknownGroupError as error:
        raise HTTPException(status_code=422, detail="unknown_group") from error
    except groups.AdminRequiredError as error:
        raise HTTPException(status_code=403, detail="admin_required") from error
    except groups.MissingPermissionError as error:
        raise HTTPException(
            status_code=403, detail=f"missing_permission:{error.capability}"
        ) from error
    except groups.LastAdminError as error:
        raise HTTPException(status_code=409, detail="last_admin") from error
    return await service.read_user_with_player(session, user)


@router.delete(
    "/users/{user_id}",
    status_code=204,
    dependencies=[Depends(require("users.manage"))],
    responses={
        403: {"description": "Only an administrator deletes an account in Admin."},
        404: {"description": "Unknown user."},
        409: {"description": "This would leave the app without an administrator."},
    },
)
async def delete_user(user_id: str, session: SessionDep, principal: PrincipalDep) -> None:
    """Delete an account. Its player stays as a temporary one, so the scores keep an owner."""
    try:
        await service.delete_user(
            session, await _user(user_id, session), by_admin=principal.is_admin
        )
    except service.AdminRequiredError as error:
        raise HTTPException(status_code=403, detail="admin_required") from error
    except service.LastAdminError as error:
        raise HTTPException(status_code=409, detail="last_admin") from error


@router.get(
    "/groups",
    response_model=GroupList,
    # One read for every page that draws groups: the groups page (`permissions.manage`), the
    # accounts page's panel (`users.manage`), the tag editor (`tags.manage`), and whoever reads
    # the group ids `GET /users` answers (`users.view`).
    dependencies=[
        Depends(require_any("users.view", "users.manage", "permissions.manage", "tags.manage"))
    ],
)
async def list_groups(session: SessionDep, principal: PrincipalDep) -> GroupList:
    """Every group in the one order: Guest, User, the others by name, Admin. Only a
    `permissions.manage` caller is told each group's capabilities and the catalogue."""
    return await groups.list_groups(session, _caller(principal), _manages(principal))


@router.post(
    "/groups",
    response_model=GroupRead,
    status_code=201,
    dependencies=[Depends(require("permissions.manage"))],
    responses={
        403: {"description": "A capability the caller does not hold themselves."},
        409: {"description": "A group of that name already exists (`duplicate_group_name`)."},
        422: {"description": "A bad name, or an unknown capability (`unknown_capability`)."},
    },
)
async def create_group(
    body: GroupCreate, session: SessionDep, principal: PrincipalDep
) -> GroupRead:
    """A new group, its name and its capabilities in one call. It adds to User: its members
    hold User's rights and these."""
    caller = _caller(principal)
    try:
        group = await groups.create_group(session, body.name, body.capabilities, caller)
    except (
        UnknownCapabilityError,
        groups.MissingPermissionError,
        groups.DuplicateGroupNameError,
    ) as error:
        raise _group_refusal(error) from error
    return await groups.read_group(session, group, caller, manages=True)


@router.patch(
    "/groups/{group_id}",
    response_model=GroupRead,
    dependencies=[Depends(require("permissions.manage"))],
    responses={
        403: {"description": "A capability the caller does not hold themselves."},
        404: {"description": "Unknown group."},
        409: {
            "description": "A name for a built-in group (`built_in_group`), capabilities for "
            "Admin (`admin_not_editable`), or a name that is taken (`duplicate_group_name`)."
        },
        422: {"description": "A bad name, or an unknown capability (`unknown_capability`)."},
    },
)
async def update_group(
    group_id: str, body: GroupUpdate, session: SessionDep, principal: PrincipalDep
) -> GroupRead:
    """Rename a group, replace its capabilities, or both. Takes effect on every open
    session's next request."""
    group = await _group(group_id, session)
    caller = _caller(principal)
    try:
        await groups.update_group(
            session, group, caller, name=body.name, capabilities=body.capabilities
        )
    except (
        BuiltInGroupError,
        AdminNotEditableError,
        UnknownCapabilityError,
        groups.MissingPermissionError,
        groups.DuplicateGroupNameError,
    ) as error:
        raise _group_refusal(error) from error
    return await groups.read_group(session, group, caller, manages=True)


@router.delete(
    "/groups/{group_id}",
    status_code=204,
    dependencies=[Depends(require("permissions.manage"))],
    responses={
        404: {"description": "Unknown group."},
        409: {"description": "Guest, User and Admin cannot be deleted (`built_in_group`)."},
    },
)
async def delete_group(group_id: str, session: SessionDep) -> None:
    """Delete a group with its capabilities, its memberships and its tag rows. Its members
    lose what it gave them and keep everything else."""
    try:
        await groups.delete_group(session, await _group(group_id, session))
    except BuiltInGroupError as error:
        raise _group_refusal(error) from error


def _caller(principal: Principal) -> groups.Caller:
    return groups.Caller(held=principal.capabilities, is_admin=principal.is_admin)


def _manages(principal: Principal) -> bool:
    return "permissions.manage" in principal.capabilities


def _group_refusal(error: Exception) -> HTTPException:
    """The one mapping from a group write's refusal to its status and slug (§6)."""
    if isinstance(error, groups.MissingPermissionError):
        return HTTPException(status_code=403, detail=f"missing_permission:{error.capability}")
    if isinstance(error, groups.DuplicateGroupNameError):
        return HTTPException(status_code=409, detail="duplicate_group_name")
    if isinstance(error, BuiltInGroupError):
        return HTTPException(status_code=409, detail="built_in_group")
    if isinstance(error, AdminNotEditableError):
        return HTTPException(status_code=409, detail="admin_not_editable")
    if isinstance(error, UnknownCapabilityError):
        return HTTPException(status_code=422, detail="unknown_capability")
    raise error


async def _group(group_id: str, session: AsyncSession) -> Group:
    group = await session.get(Group, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail=f"unknown group '{group_id}'")
    return group


async def _user(user_id: str, session: AsyncSession) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"unknown user '{user_id}'")
    return user
