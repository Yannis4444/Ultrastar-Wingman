"""Wishlist, favorites and playlist endpoints. Handlers stay thin: parse, authorize,
call the service, return."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.deps import (
    AccountIdDep,
    HiddenSongsDep,
    Principal,
    PrincipalDep,
    WishlistIdentityDep,
    account_id,
    issue_guest_id,
    require,
)
from ..auth.model import User
from ..db import SessionDep
from ..songs.api import song_or_404
from . import service
from .model import Playlist, PlaylistMember
from .schema import (
    FavoritesRead,
    MemberAccess,
    PlaylistDetail,
    PlaylistList,
    PlaylistMemberList,
    PlaylistRead,
    WishlistRead,
    WishRead,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["library"])

PlaylistName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=service.MAX_NAME_LENGTH)
]
# A sentence under the name, not a second list. Trimmed to nothing means "no description".
PlaylistDescription = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


class WishCreate(BaseModel):
    song_id: str


class PlaylistCreate(BaseModel):
    name: PlaylistName
    description: PlaylistDescription | None = None
    is_global: bool = False


class PlaylistUpdate(BaseModel):
    """Every field optional: a PATCH only touches what it names. An explicit
    `"description": null` clears the description — leaving the field out keeps it."""

    name: PlaylistName | None = None
    description: PlaylistDescription | None = None
    is_global: bool | None = None


class PlaylistCopy(BaseModel):
    """Every field optional, and so is the whole body: "copy this" needs to say nothing
    beyond the id already in the path."""

    # Frozen because one instance of it is the handler's default, shared by every request
    # that sends no body.
    model_config = ConfigDict(frozen=True)

    name: PlaylistName | None = None


# Spelled out rather than called in the default argument, which is what ruff's B008 is
# about — and it keeps the empty body one object instead of one per request.
EMPTY_COPY = PlaylistCopy()


class PlaylistEntryCreate(BaseModel):
    song_id: str


class PlaylistOrder(BaseModel):
    song_ids: list[str]


class PlaylistMemberUpdate(BaseModel):
    user_id: str
    access: MemberAccess


@router.get(
    "/wishlist", response_model=WishlistRead, dependencies=[Depends(require("wishlist.view"))]
)
async def list_wishlist(
    session: SessionDep, identity: WishlistIdentityDep, hidden: HiddenSongsDep
) -> WishlistRead:
    """What the party wants to sing, most-wished-for first. One row per song with how many
    people want it, and whether the caller is one of them."""
    return WishlistRead(
        wishes=await service.wishlist(session, identity.user_id, identity.guest_id, hidden)
    )


@router.post(
    "/wishlist",
    response_model=WishRead,
    status_code=201,
    dependencies=[Depends(require("wishlist.add"))],
    responses={
        404: {"description": "Unknown song."},
        409: {"description": "The caller already wished for this song."},
    },
)
async def add_wish(
    body: WishCreate,
    response: Response,
    session: SessionDep,
    identity: WishlistIdentityDep,
    hidden: HiddenSongsDep,
) -> WishRead:
    """Wish for a song. An anonymous browser gets its guest cookie here — after the song is
    resolved, so a 404 does not hand one out."""
    song = await song_or_404(body.song_id, session, hidden)
    identity = issue_guest_id(identity, response)
    try:
        return await service.add_wish(session, song, identity.user_id, identity.guest_id)
    except service.AlreadyWishedError as error:
        raise HTTPException(status_code=409, detail="already_wished") from error


@router.delete(
    "/wishlist/{song_id}",
    status_code=204,
    dependencies=[Depends(require("wishlist.add"))],
    responses={404: {"description": "The caller has no wish for this song."}},
)
async def remove_wish(song_id: str, session: SessionDep, identity: WishlistIdentityDep) -> None:
    """Take back the caller's own wish. Everybody else's wish for the same song stays."""
    try:
        await service.remove_wish(session, song_id, identity.user_id, identity.guest_id)
    except service.NotWishedError as error:
        raise HTTPException(status_code=404, detail="not_wished") from error


@router.delete(
    "/wishlist/{song_id}/wishes",
    status_code=204,
    dependencies=[Depends(require("wishlist.manage"))],
    responses={404: {"description": "Nobody wished for this song."}},
)
async def clear_wishes(song_id: str, session: SessionDep) -> None:
    """Take a song off the wishlist for everybody — the host's answer to the wish the party
    is not going to sing. `DELETE /wishlist/{song_id}` is the one that only takes back the
    caller's own wish; this one drops the lot, whoever made them."""
    if await service.clear_wishes(session, song_id) == 0:
        raise HTTPException(status_code=404, detail="not_wished")


@router.get("/favorites", response_model=FavoritesRead)
async def list_favorites(session: SessionDep, user_id: AccountIdDep) -> FavoritesRead:
    """The caller's favorites. Identity, not a capability: favorites are nobody else's
    business, so there is nothing for an administrator to grant."""
    return FavoritesRead(song_ids=await service.favorite_song_ids(session, user_id))


@router.put(
    "/favorites/{song_id}",
    status_code=204,
    responses={404: {"description": "Unknown song."}},
)
async def add_favorite(
    song_id: str, session: SessionDep, user_id: AccountIdDep, hidden: HiddenSongsDep
) -> None:
    """Idempotent — the UI can send it on every click of a toggle."""
    await song_or_404(song_id, session, hidden)
    await service.add_favorite(session, user_id, song_id)


@router.delete("/favorites/{song_id}", status_code=204)
async def remove_favorite(song_id: str, session: SessionDep, user_id: AccountIdDep) -> None:
    await service.remove_favorite(session, user_id, song_id)


@router.get(
    "/playlists", response_model=PlaylistList, dependencies=[Depends(require("playlists.view"))]
)
async def list_playlists(
    session: SessionDep, principal: PrincipalDep, song_id: str | None = None
) -> PlaylistList:
    """Every playlist the caller may see: their own, the ones shared with them (followed
    or not) and every global one. `song_id` fills each row's `contains`."""
    return PlaylistList(
        playlists=await service.visible_playlists(
            session, _user_id(principal), principal.capabilities, song_id
        )
    )


@router.get(
    "/playlists/{playlist_id}",
    response_model=PlaylistDetail,
    dependencies=[Depends(require("playlists.view"))],
    responses={404: {"description": "Unknown playlist, or one the caller was not named on."}},
)
async def get_playlist(
    playlist_id: str, session: SessionDep, principal: PrincipalDep, hidden: HiddenSongsDep
) -> PlaylistDetail:
    playlist, rights = await playlist_or_404(playlist_id, principal, session)
    return await service.read_playlist_detail(session, playlist, rights, hidden)


@router.post(
    "/playlists",
    response_model=PlaylistRead,
    status_code=201,
    # Account check first, deliberately: an anonymous caller is told to log in (401) rather
    # than that the `guest` role lacks a capability it could never usefully hold.
    dependencies=[Depends(account_id), Depends(require("playlists.manage"))],
    responses={401: {"description": "A playlist needs an account to belong to."}},
)
async def create_playlist(
    body: PlaylistCreate, session: SessionDep, user_id: AccountIdDep, principal: PrincipalDep
) -> PlaylistRead:
    playlist = await service.create_playlist(
        session, body.name, body.description or None, body.is_global, user_id
    )
    return await service.read_playlist(session, playlist, _rights(playlist, principal, None))


@router.patch(
    "/playlists/{playlist_id}",
    response_model=PlaylistRead,
    dependencies=[Depends(require("playlists.manage"))],
    responses={
        403: {"description": "The caller may look at the playlist but not manage it."},
        404: {"description": "Unknown playlist, or one the caller was not named on."},
    },
)
async def update_playlist(
    playlist_id: str, body: PlaylistUpdate, session: SessionDep, principal: PrincipalDep
) -> PlaylistRead:
    playlist, rights = await _managed(playlist_id, principal, session)
    await service.update_playlist(
        session,
        playlist,
        name=body.name,
        is_global=body.is_global,
        description=(
            body.description or None if "description" in body.model_fields_set else service.UNSET
        ),
    )
    return await service.read_playlist(session, playlist, rights)


@router.delete(
    "/playlists/{playlist_id}",
    status_code=204,
    dependencies=[Depends(require("playlists.manage"))],
    responses={
        403: {"description": "The caller may look at the playlist but not manage it."},
        404: {"description": "Unknown playlist, or one the caller was not named on."},
    },
)
async def delete_playlist(playlist_id: str, session: SessionDep, principal: PrincipalDep) -> None:
    playlist, _ = await _managed(playlist_id, principal, session)
    await service.delete_playlist(session, playlist)


@router.post(
    "/playlists/{playlist_id}/copy",
    response_model=PlaylistDetail,
    status_code=201,
    # Capability first here, the mirror image of `create_playlist`: copying somebody
    # else's list is a right a role can be given, so the matrix has to see the 403.
    dependencies=[Depends(require("playlists.manage")), Depends(account_id)],
    responses={
        401: {"description": "A playlist needs an account to belong to."},
        404: {"description": "Unknown playlist, or one the caller was not named on."},
    },
)
async def copy_playlist(
    playlist_id: str,
    session: SessionDep,
    principal: PrincipalDep,
    user_id: AccountIdDep,
    hidden: HiddenSongsDep,
    body: PlaylistCopy = EMPTY_COPY,
) -> PlaylistDetail:
    """Take a private copy of a playlist the caller may see. The copy is theirs: same
    songs and description, no members and not global.

    The body may be left off altogether — the "Save a copy" row sends nothing.
    """
    playlist, _ = await playlist_or_404(playlist_id, principal, session)
    copy = await service.copy_playlist(session, playlist, user_id, body.name)
    return await service.read_playlist_detail(session, copy, _rights(copy, principal, None), hidden)


@router.get(
    "/playlists/{playlist_id}/members",
    response_model=PlaylistMemberList,
    dependencies=[Depends(require("playlists.manage"))],
    responses={
        403: {"description": "The caller may look at the playlist but not manage it."},
        404: {"description": "Unknown playlist, or one the caller was not named on."},
    },
)
async def list_playlist_members(
    playlist_id: str, session: SessionDep, principal: PrincipalDep
) -> PlaylistMemberList:
    """Who the playlist was shared with. Needs manage, not view: a global list must not
    show every guest who its collaborators are."""
    playlist, _ = await _managed(playlist_id, principal, session)
    return PlaylistMemberList(members=await service.list_members(session, playlist))


@router.put(
    "/playlists/{playlist_id}/members",
    response_model=PlaylistMemberList,
    dependencies=[Depends(require("playlists.manage"))],
    responses={
        201: {"description": "The playlist was shared with somebody new."},
        403: {"description": "The caller may look at the playlist but not manage it."},
        404: {"description": "Unknown playlist or user."},
        409: {"description": "That account already owns the playlist."},
    },
)
async def set_playlist_member(
    playlist_id: str,
    body: PlaylistMemberUpdate,
    response: Response,
    session: SessionDep,
    principal: PrincipalDep,
) -> PlaylistMemberList:
    """Share the playlist with an account, or change what that account may do."""
    playlist, _ = await _managed(playlist_id, principal, session)
    user = await session.get(User, body.user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"unknown user '{body.user_id}'")
    try:
        created = await service.set_member(session, playlist, user, body.access)
    except service.AlreadyOwnerError as error:
        raise HTTPException(status_code=409, detail="already_owner") from error
    if created:
        response.status_code = 201
    return PlaylistMemberList(members=await service.list_members(session, playlist))


@router.delete(
    "/playlists/{playlist_id}/members/{user_id}",
    status_code=204,
    dependencies=[Depends(require("playlists.manage"))],
    responses={
        403: {"description": "The caller may look at the playlist but not manage it."},
        404: {"description": "Unknown playlist, or that account is not a member."},
    },
)
async def remove_playlist_member(
    playlist_id: str, user_id: str, session: SessionDep, principal: PrincipalDep
) -> None:
    playlist, _ = await _managed(playlist_id, principal, session)
    try:
        await service.remove_member(session, playlist, user_id)
    except service.NotAMemberError as error:
        raise HTTPException(status_code=404, detail="not_a_member") from error


@router.put(
    "/playlists/{playlist_id}/follow",
    status_code=204,
    dependencies=[Depends(require("playlists.manage"))],
    responses={404: {"description": "Unknown playlist, or the caller is not a member."}},
)
async def follow_playlist(playlist_id: str, session: SessionDep, principal: PrincipalDep) -> None:
    """Put a list shared with the caller back into their own listing. Idempotent."""
    await _follow(playlist_id, principal, session, followed=True)


@router.delete(
    "/playlists/{playlist_id}/follow",
    status_code=204,
    dependencies=[Depends(require("playlists.manage"))],
    responses={404: {"description": "Unknown playlist, or the caller is not a member."}},
)
async def unfollow_playlist(playlist_id: str, session: SessionDep, principal: PrincipalDep) -> None:
    """Take a shared list out of the caller's own listing. The access stays, so the owner
    does not have to grant it again."""
    await _follow(playlist_id, principal, session, followed=False)


@router.post(
    "/playlists/{playlist_id}/entries",
    response_model=PlaylistDetail,
    status_code=201,
    dependencies=[Depends(require("playlists.manage"))],
    responses={
        403: {"description": "The caller may look at the playlist but not change it."},
        404: {"description": "Unknown playlist or song."},
        409: {"description": "The song is already in the playlist."},
    },
)
async def add_playlist_entry(
    playlist_id: str,
    body: PlaylistEntryCreate,
    session: SessionDep,
    principal: PrincipalDep,
    hidden: HiddenSongsDep,
) -> PlaylistDetail:
    """Append a song to the end of the playlist."""
    playlist, rights = await _edited(playlist_id, principal, session)
    await song_or_404(body.song_id, session, hidden)
    try:
        await service.add_entry(session, playlist, body.song_id)
    except service.DuplicateEntryError as error:
        raise HTTPException(status_code=409, detail="duplicate_entry") from error
    return await service.read_playlist_detail(session, playlist, rights, hidden)


@router.delete(
    "/playlists/{playlist_id}/entries/{song_id}",
    status_code=204,
    dependencies=[Depends(require("playlists.manage"))],
    responses={
        403: {"description": "The caller may look at the playlist but not change it."},
        404: {"description": "Unknown playlist, or the song is not in it."},
    },
)
async def remove_playlist_entry(
    playlist_id: str, song_id: str, session: SessionDep, principal: PrincipalDep
) -> None:
    playlist, _ = await _edited(playlist_id, principal, session)
    try:
        await service.remove_entry(session, playlist, song_id)
    except service.UnknownEntryError as error:
        raise HTTPException(status_code=404, detail="unknown_entry") from error


@router.put(
    "/playlists/{playlist_id}/entries",
    response_model=PlaylistDetail,
    dependencies=[Depends(require("playlists.manage"))],
    responses={
        403: {"description": "The caller may look at the playlist but not change it."},
        404: {"description": "Unknown playlist, or one the caller was not named on."},
        422: {"description": "The order is not a permutation of the songs the caller sees."},
    },
)
async def reorder_playlist_entries(
    playlist_id: str,
    body: PlaylistOrder,
    session: SessionDep,
    principal: PrincipalDep,
    hidden: HiddenSongsDep,
) -> PlaylistDetail:
    """Replace the order. The body must list exactly the songs the playlist shows this
    caller — adding or dropping songs is what the entry endpoints are for. An entry a tag
    hides from them keeps the slot it is in."""
    playlist, rights = await _edited(playlist_id, principal, session)
    try:
        await service.reorder_entries(session, playlist, body.song_ids, hidden)
    except service.OrderMismatchError as error:
        raise HTTPException(status_code=422, detail="order_mismatch") from error
    return await service.read_playlist_detail(session, playlist, rights, hidden)


def _user_id(principal: Principal) -> str | None:
    """None for the host session: an administrator, but nobody who could own a playlist."""
    return None if principal.user is None else principal.user.id


def _rights(
    playlist: Playlist, principal: Principal, member: PlaylistMember | None
) -> service.Rights:
    return service.rights_for(playlist, _user_id(principal), principal.capabilities, member)


async def playlist_or_404(
    playlist_id: str, principal: Principal, session: AsyncSession
) -> tuple[Playlist, service.Rights]:
    """The playlist and what this caller may do with it.

    Membership is a property of the row, so none of this can be a route dependency. A
    playlist the caller may not see is a 404, never a 403: whose lists exist is not a
    stranger's business either.
    """
    playlist = await session.get(Playlist, playlist_id)
    if playlist is None:
        raise HTTPException(status_code=404, detail=f"unknown playlist '{playlist_id}'")
    member = await service.member_row(session, playlist_id, _user_id(principal))
    rights = _rights(playlist, principal, member)
    if not rights.visible:
        raise HTTPException(status_code=404, detail=f"unknown playlist '{playlist_id}'")
    return playlist, rights


async def _edited(
    playlist_id: str, principal: Principal, session: AsyncSession
) -> tuple[Playlist, service.Rights]:
    """For the song list: the owner, a `write` or `admin` member, or a moderator."""
    playlist, rights = await playlist_or_404(playlist_id, principal, session)
    if not rights.can_edit:
        raise HTTPException(status_code=403, detail="not_playlist_editor")
    return playlist, rights


async def _managed(
    playlist_id: str, principal: Principal, session: AsyncSession
) -> tuple[Playlist, service.Rights]:
    """For the playlist itself — name, description, sharing, deletion: the owner, an
    `admin` member, or a moderator. A `write` member edits songs and nothing else."""
    playlist, rights = await playlist_or_404(playlist_id, principal, session)
    if not rights.can_manage:
        raise HTTPException(status_code=403, detail="not_playlist_manager")
    return playlist, rights


async def _follow(
    playlist_id: str, principal: Principal, session: AsyncSession, followed: bool
) -> None:
    playlist, _ = await playlist_or_404(playlist_id, principal, session)
    user_id = _user_id(principal)
    if user_id is None:
        raise HTTPException(status_code=404, detail="not_a_member")
    try:
        await service.set_followed(session, playlist, user_id, followed)
    except service.NotAMemberError as error:
        raise HTTPException(status_code=404, detail="not_a_member") from error
