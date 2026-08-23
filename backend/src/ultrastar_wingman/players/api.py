"""Player endpoints. Handlers stay thin: parse, call the service, return."""

import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import BootstrapSettings
from ..db import SessionDep
from . import service
from .model import Player
from .schema import PlayerList, PlayerRead, read_player

logger = logging.getLogger(__name__)

router = APIRouter(tags=["players"])


def get_avatars_dir(request: Request) -> Path:
    settings: BootstrapSettings = request.app.state.bootstrap_settings
    return settings.data_dir / "avatars"


AvatarsDirDep = Annotated[Path, Depends(get_avatars_dir)]


class PlayerCreate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


# No auth yet: capability checks (`players:manage`) arrive in phase 4 as a FastAPI dependency.
@router.get("/players", response_model=PlayerList)
async def list_players(session: SessionDep) -> PlayerList:
    return PlayerList(
        players=[read_player(player) for player in await service.list_players(session)]
    )


@router.post(
    "/players",
    response_model=PlayerRead,
    status_code=201,
    responses={409: {"description": "A player with that name already exists."}},
)
async def create_player(new_player: PlayerCreate, session: SessionDep) -> PlayerRead:
    try:
        return read_player(await service.create_player(session, new_player.name))
    except service.DuplicatePlayerNameError as error:
        raise HTTPException(status_code=409, detail="duplicate_name") from error


@router.delete("/players/{player_id}", status_code=204)
async def delete_player(player_id: str, session: SessionDep, avatars_dir: AvatarsDirDep) -> None:
    await service.delete_player(session, await _player(player_id, session), avatars_dir)


@router.put(
    "/players/{player_id}/avatar",
    response_model=PlayerRead,
    responses={
        413: {"description": "The image is larger than 5 MB."},
        415: {"description": "Not a jpeg, png or webp image."},
    },
)
async def set_player_avatar(
    player_id: str,
    session: SessionDep,
    avatars_dir: AvatarsDirDep,
    file: Annotated[UploadFile, File()],
) -> PlayerRead:
    """Upload or replace a player's avatar (multipart form field `file`)."""
    player = await _player(player_id, session)
    # One byte over the limit is enough to reject, so an oversized upload is never buffered whole.
    data = await file.read(service.MAX_AVATAR_BYTES + 1)
    try:
        return read_player(
            await service.store_avatar(session, player, avatars_dir, file.content_type, data)
        )
    except service.AvatarTooLargeError as error:
        raise HTTPException(status_code=413, detail="avatar_too_large") from error
    except service.AvatarTypeError as error:
        raise HTTPException(status_code=415, detail="unsupported_avatar_type") from error


@router.get(
    "/players/{player_id}/avatar",
    response_class=FileResponse,
    responses={200: {"content": {"image/*": {}}, "description": "The avatar image file."}},
)
async def get_player_avatar(player_id: str, session: SessionDep) -> FileResponse:
    player = await _player(player_id, session)
    avatar = None if player.avatar_file is None else Path(player.avatar_file)
    if avatar is None or not avatar.is_file():
        raise HTTPException(status_code=404, detail=f"player '{player_id}' has no avatar")
    return FileResponse(avatar, media_type=service.AVATAR_MEDIA_TYPES.get(avatar.suffix))


async def _player(player_id: str, session: AsyncSession) -> Player:
    player = await session.get(Player, player_id)
    if player is None:
        raise HTTPException(status_code=404, detail=f"unknown player '{player_id}'")
    return player
