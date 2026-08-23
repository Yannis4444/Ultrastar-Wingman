"""Wishlist, favorites and playlist endpoints. Handlers stay thin: parse, authorize,
call the service, return."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import permissions
from ..auth.deps import (
    AccountIdDep,
    Principal,
    PrincipalDep,
    WishlistIdentityDep,
    account_id,
    issue_guest_id,
    require,
)
from ..db import SessionDep
from ..songs.api import song_or_404
from . import service
from .model import Playlist
from .schema import (
    FavoritesRead,
    PlaylistDetail,
    PlaylistList,
    PlaylistRead,
    WishlistRead,
    WishRead,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["library"])

PlaylistName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


class WishCreate(BaseModel):
    song_id: str


class PlaylistCreate(BaseModel):
    name: PlaylistName
    shared: bool = False


class PlaylistUpdate(BaseModel):
    """Both fields optional: a PATCH only touches what it names."""

    name: PlaylistName | None = None
    shared: bool | None = None


class PlaylistEntryCreate(BaseModel):
    song_id: str


class PlaylistOrder(BaseModel):
    song_ids: list[str]


@router.get(
    "/wishlist", response_model=WishlistRead, dependencies=[Depends(require("wishlist.view"))]
)
async def list_wishlist(session: SessionDep, identity: WishlistIdentityDep) -> WishlistRead:
    """What the party wants to sing, most-wished-for first. One row per song with how many
    people want it, and whether the caller is one of them."""
    return WishlistRead(wishes=await service.wishlist(session, identity.user_id, identity.guest_id))


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
) -> WishRead:
    """Wish for a song. An anonymous browser gets its guest cookie here — after the song is
    resolved, so a 404 does not hand one out."""
    song = await song_or_404(body.song_id, session)
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
async def add_favorite(song_id: str, session: SessionDep, user_id: AccountIdDep) -> None:
    """Idempotent — the UI can send it on every click of a toggle."""
    await song_or_404(song_id, session)
    await service.add_favorite(session, user_id, song_id)


@router.delete("/favorites/{song_id}", status_code=204)
async def remove_favorite(song_id: str, session: SessionDep, user_id: AccountIdDep) -> None:
    await service.remove_favorite(session, user_id, song_id)


@router.get(
    "/playlists", response_model=PlaylistList, dependencies=[Depends(require("playlists.view"))]
)
async def list_playlists(session: SessionDep, principal: PrincipalDep) -> PlaylistList:
    """The caller's own playlists plus every shared one."""
    return PlaylistList(playlists=await service.visible_playlists(session, _user_id(principal)))


@router.get(
    "/playlists/{playlist_id}",
    response_model=PlaylistDetail,
    dependencies=[Depends(require("playlists.view"))],
    responses={404: {"description": "Unknown playlist, or somebody else's private one."}},
)
async def get_playlist(
    playlist_id: str, session: SessionDep, principal: PrincipalDep
) -> PlaylistDetail:
    playlist = await _visible(playlist_id, principal, session)
    return await service.read_playlist_detail(session, playlist, _user_id(principal))


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
    body: PlaylistCreate, session: SessionDep, user_id: AccountIdDep
) -> PlaylistRead:
    playlist = await service.create_playlist(session, body.name, body.shared, user_id)
    return await service.read_playlist(session, playlist, user_id)


@router.patch(
    "/playlists/{playlist_id}",
    response_model=PlaylistRead,
    dependencies=[Depends(require("playlists.manage"))],
    responses={
        403: {"description": "Not the owner."},
        404: {"description": "Unknown playlist, or somebody else's private one."},
    },
)
async def update_playlist(
    playlist_id: str, body: PlaylistUpdate, session: SessionDep, principal: PrincipalDep
) -> PlaylistRead:
    playlist = await _mutable(playlist_id, principal, session)
    await service.update_playlist(session, playlist, body.name, body.shared)
    return await service.read_playlist(session, playlist, _user_id(principal))


@router.delete(
    "/playlists/{playlist_id}",
    status_code=204,
    dependencies=[Depends(require("playlists.manage"))],
    responses={
        403: {"description": "Not the owner."},
        404: {"description": "Unknown playlist, or somebody else's private one."},
    },
)
async def delete_playlist(playlist_id: str, session: SessionDep, principal: PrincipalDep) -> None:
    await service.delete_playlist(session, await _mutable(playlist_id, principal, session))


@router.post(
    "/playlists/{playlist_id}/entries",
    response_model=PlaylistDetail,
    status_code=201,
    dependencies=[Depends(require("playlists.manage"))],
    responses={
        403: {"description": "Not the owner."},
        404: {"description": "Unknown playlist or song."},
        409: {"description": "The song is already in the playlist."},
    },
)
async def add_playlist_entry(
    playlist_id: str, body: PlaylistEntryCreate, session: SessionDep, principal: PrincipalDep
) -> PlaylistDetail:
    """Append a song to the end of the playlist."""
    playlist = await _mutable(playlist_id, principal, session)
    await song_or_404(body.song_id, session)
    try:
        await service.add_entry(session, playlist, body.song_id)
    except service.DuplicateEntryError as error:
        raise HTTPException(status_code=409, detail="duplicate_entry") from error
    return await service.read_playlist_detail(session, playlist, _user_id(principal))


@router.delete(
    "/playlists/{playlist_id}/entries/{song_id}",
    status_code=204,
    dependencies=[Depends(require("playlists.manage"))],
    responses={
        403: {"description": "Not the owner."},
        404: {"description": "Unknown playlist, or the song is not in it."},
    },
)
async def remove_playlist_entry(
    playlist_id: str, song_id: str, session: SessionDep, principal: PrincipalDep
) -> None:
    playlist = await _mutable(playlist_id, principal, session)
    try:
        await service.remove_entry(session, playlist, song_id)
    except service.UnknownEntryError as error:
        raise HTTPException(status_code=404, detail="unknown_entry") from error


@router.put(
    "/playlists/{playlist_id}/entries",
    response_model=PlaylistDetail,
    dependencies=[Depends(require("playlists.manage"))],
    responses={
        403: {"description": "Not the owner."},
        404: {"description": "Unknown playlist, or somebody else's private one."},
        422: {"description": "The order is not a permutation of the playlist's songs."},
    },
)
async def reorder_playlist_entries(
    playlist_id: str, body: PlaylistOrder, session: SessionDep, principal: PrincipalDep
) -> PlaylistDetail:
    """Replace the order. The body must list exactly the songs the playlist holds — adding
    or dropping songs is what the entry endpoints are for."""
    playlist = await _mutable(playlist_id, principal, session)
    try:
        await service.reorder_entries(session, playlist, body.song_ids)
    except service.OrderMismatchError as error:
        raise HTTPException(status_code=422, detail="order_mismatch") from error
    return await service.read_playlist_detail(session, playlist, _user_id(principal))


def _user_id(principal: Principal) -> str | None:
    """None for the host session: an administrator, but nobody who could own a playlist."""
    return None if principal.user is None else principal.user.id


def _owns(principal: Principal, playlist: Playlist) -> bool:
    return principal.user is not None and playlist.owner_user_id == principal.user.id


async def _visible(playlist_id: str, principal: Principal, session: AsyncSession) -> Playlist:
    playlist = await session.get(Playlist, playlist_id)
    # 404 rather than 403 for a private playlist: whose playlists exist is not a
    # stranger's business either.
    if playlist is None or not (playlist.shared or _owns(principal, playlist)):
        raise HTTPException(status_code=404, detail=f"unknown playlist '{playlist_id}'")
    return playlist


async def _mutable(playlist_id: str, principal: Principal, session: AsyncSession) -> Playlist:
    """Ownership is a property of the row, so this cannot be a route dependency."""
    playlist = await session.get(Playlist, playlist_id)
    if playlist is None:
        raise HTTPException(status_code=404, detail=f"unknown playlist '{playlist_id}'")
    if _owns(principal, playlist) or principal.role == permissions.ADMIN:
        return playlist
    if not playlist.shared:
        raise HTTPException(status_code=404, detail=f"unknown playlist '{playlist_id}'")
    raise HTTPException(status_code=403, detail="not_playlist_owner")
