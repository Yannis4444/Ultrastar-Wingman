"""Tag endpoints, and the two routes that put a tag on a song.

Two different kinds of right meet here. `tags.manage` is a capability like any other and
sits in the decorator: it says who may create a tag and decide who it is for. What one
caller may do with one *particular* tag is data — a `tag_permissions` row — so it is
checked per request, the way `library.api` checks playlist membership.
"""

import logging
from typing import Annotated, Self

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StringConstraints, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import HiddenSongsDep, Principal, PrincipalDep, require, tag_viewer
from ..auth.permissions import UnknownRoleError
from ..db import SessionDep
from ..songs.api import song_or_404
from ..songs.model import Song
from . import service
from .model import MAX_NAME_LENGTH, Tag
from .schema import TagAction, TagAssignments, TagColor, TagList, TagRead

logger = logging.getLogger(__name__)

router = APIRouter(tags=["tags"])

TagName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_NAME_LENGTH)
]
# The name of an entry in the frontend's `ICON_PATHS`. Only the shape is checked: the
# backend ships no icon list, and an icon the UI does not know simply draws nothing.
TagIcon = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9-]{0,31}$")]

UNKNOWN_TAG: dict[int | str, dict[str, object]] = {404: {"description": "Unknown tag."}}


class TagPermissionInput(BaseModel):
    """One row: an action, and exactly one subject to grant it to."""

    action: TagAction
    role: str | None = None
    user_id: str | None = None

    @model_validator(mode="after")
    def _exactly_one_subject(self) -> Self:
        if (self.role is None) == (self.user_id is None):
            raise ValueError("give exactly one of 'role' and 'user_id'")
        return self


class TagCreate(BaseModel):
    name: TagName
    icon: TagIcon | None = None
    color: TagColor
    show_in_list: bool = False
    hide_by_default: bool = False
    # Empty means "administrators only" — which also hides every song the tag lands on
    # from everybody else, and is exactly what a "broken" tag is for.
    permissions: list[TagPermissionInput] = Field(default_factory=list)


class TagUpdate(BaseModel):
    """Every field optional: a PATCH only touches what it names. An explicit
    `"icon": null` clears the icon — leaving the field out keeps it."""

    name: TagName | None = None
    icon: TagIcon | None = None
    color: TagColor | None = None
    show_in_list: bool | None = None
    hide_by_default: bool | None = None


class TagPermissionsUpdate(BaseModel):
    permissions: list[TagPermissionInput]


@router.get("/tags", response_model=TagList, dependencies=[Depends(require("songs.view"))])
async def list_tags(session: SessionDep, principal: PrincipalDep) -> TagList:
    """The tags the caller may view, by name — plus, for a caller holding `tags.manage`,
    the ones they may not: managing a tag is not the same right as knowing it, and each
    row says which it is in `can_view`. A manager also gets each tag's permission rows;
    for everybody else `permissions` is null.

    `song_count` is the whole library's, not the caller's: see the field."""
    return TagList(
        tags=await service.visible_tags(session, tag_viewer(principal), _manages(principal))
    )


@router.get(
    "/tags/assignments",
    response_model=TagAssignments,
    dependencies=[Depends(require("songs.view"))],
)
async def list_tag_assignments(
    session: SessionDep, principal: PrincipalDep, hidden: HiddenSongsDep
) -> TagAssignments:
    """Which songs carry which tag, over the same tags `GET /tags` lists — one request for
    the whole song list. Songs the caller may not see are not in it, and neither are tags
    left on songs that have since left the library."""
    return TagAssignments(
        assignments=await service.assignments(
            session, tag_viewer(principal), hidden, _manages(principal)
        )
    )


@router.post(
    "/tags",
    response_model=TagRead,
    status_code=201,
    dependencies=[Depends(require("tags.manage"))],
    responses={
        409: {"description": "A tag of that name already exists."},
        422: {"description": "Unknown role or account, or a bad color or icon."},
    },
)
async def create_tag(body: TagCreate, session: SessionDep, principal: PrincipalDep) -> TagRead:
    try:
        tag = await service.create_tag(
            session,
            body.name,
            body.icon,
            body.color,
            body.show_in_list,
            body.hide_by_default,
            _specs(body.permissions),
        )
    except service.DuplicateTagNameError as error:
        raise HTTPException(status_code=409, detail="duplicate_tag_name") from error
    except (UnknownRoleError, service.UnknownUserError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return await service.read_tag(session, tag, tag_viewer(principal), _manages(principal))


@router.patch(
    "/tags/{tag_id}",
    response_model=TagRead,
    dependencies=[Depends(require("tags.manage"))],
    responses={**UNKNOWN_TAG, 409: {"description": "A tag of that name already exists."}},
)
async def update_tag(
    tag_id: str, body: TagUpdate, session: SessionDep, principal: PrincipalDep
) -> TagRead:
    tag = await _tag_or_404(tag_id, session)
    try:
        await service.update_tag(
            session,
            tag,
            name=body.name,
            icon=body.icon if "icon" in body.model_fields_set else service.UNSET,
            color=body.color,
            show_in_list=body.show_in_list,
            hide_by_default=body.hide_by_default,
        )
    except service.DuplicateTagNameError as error:
        raise HTTPException(status_code=409, detail="duplicate_tag_name") from error
    return await service.read_tag(session, tag, tag_viewer(principal), _manages(principal))


@router.put(
    "/tags/{tag_id}/permissions",
    response_model=TagRead,
    dependencies=[Depends(require("tags.manage"))],
    responses={**UNKNOWN_TAG, 422: {"description": "Unknown role or account."}},
)
async def replace_tag_permissions(
    tag_id: str, body: TagPermissionsUpdate, session: SessionDep, principal: PrincipalDep
) -> TagRead:
    """Replace who the tag is for, all of it at once — the rows not sent are the rows
    taken away."""
    tag = await _tag_or_404(tag_id, session)
    try:
        await service.replace_permissions(session, tag, _specs(body.permissions))
    except (UnknownRoleError, service.UnknownUserError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return await service.read_tag(session, tag, tag_viewer(principal), _manages(principal))


@router.delete(
    "/tags/{tag_id}",
    status_code=204,
    dependencies=[Depends(require("tags.manage"))],
    responses=UNKNOWN_TAG,
)
async def delete_tag(tag_id: str, session: SessionDep) -> None:
    """Deletes the tag, everywhere it was put, and everybody it was granted to."""
    await service.delete_tag(session, await _tag_or_404(tag_id, session))


@router.put(
    "/songs/{song_id}/tags/{tag_id}",
    status_code=204,
    # The route's own right is only "may this caller deal with songs at all"; whether they
    # may set *this* tag is the per-tag `assign` below.
    dependencies=[Depends(require("songs.view"))],
    responses={
        403: {"description": "The caller may see the tag but not set it."},
        404: {"description": "Unknown song or tag."},
    },
)
async def assign_tag(
    song_id: str,
    tag_id: str,
    session: SessionDep,
    principal: PrincipalDep,
    hidden: HiddenSongsDep,
) -> None:
    """Idempotent — the UI can send it on every click of a toggle."""
    song, tag = await _assignable(song_id, tag_id, session, principal, hidden)
    await service.assign(session, tag, song, _user_id(principal))


@router.delete(
    "/songs/{song_id}/tags/{tag_id}",
    status_code=204,
    dependencies=[Depends(require("songs.view"))],
    responses={
        403: {"description": "The caller may see the tag but not set it."},
        404: {"description": "Unknown song or tag."},
    },
)
async def unassign_tag(
    song_id: str,
    tag_id: str,
    session: SessionDep,
    principal: PrincipalDep,
    hidden: HiddenSongsDep,
) -> None:
    """Idempotent as well: a tag that was not there is already off."""
    song, tag = await _assignable(song_id, tag_id, session, principal, hidden)
    await service.unassign(session, tag, song)


def _manages(principal: Principal) -> bool:
    return service.MANAGE_CAPABILITY in principal.capabilities


def _user_id(principal: Principal) -> str | None:
    """Who tagged the song. None for the host screen: an administrator, but nobody."""
    return None if principal.user is None else principal.user.id


def _specs(rows: list[TagPermissionInput]) -> list[service.PermissionSpec]:
    return [
        service.PermissionSpec(action=row.action, role=row.role, user_id=row.user_id)
        for row in rows
    ]


async def _tag_or_404(tag_id: str, session: AsyncSession) -> Tag:
    tag = await session.get(Tag, tag_id)
    if tag is None:
        raise HTTPException(status_code=404, detail=f"unknown tag '{tag_id}'")
    return tag


async def _assignable(
    song_id: str,
    tag_id: str,
    session: AsyncSession,
    principal: Principal,
    hidden: frozenset[str],
) -> tuple[Song, Tag]:
    """The song and the tag, once this caller is allowed to put one on the other.

    A tag the caller may not view is a 404, exactly like a song they may not see: which
    tags exist is not a stranger's business either. Only a tag they can see but not set
    is a 403 — that one they already know about.
    """
    song = await song_or_404(song_id, session, hidden)
    tag = await _tag_or_404(tag_id, session)
    rows = (await service.permission_rows(session, [tag_id])).get(tag_id, [])
    rights = service.rights_for(rows, tag_viewer(principal))
    if not rights.can_view:
        raise HTTPException(status_code=404, detail=f"unknown tag '{tag_id}'")
    if not rights.can_assign:
        raise HTTPException(status_code=403, detail="missing_tag_permission:assign")
    return song, tag
