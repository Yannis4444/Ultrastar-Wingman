"""Karaoke endpoints: the colors to pick from, starting a song, what is playing, stopping."""

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..db import SessionDep
from . import service
from .colors import COLORS, ColorList, UnknownColorError
from .schema import CurrentSing, CurrentSingRead
from .usdx_paths import UsdxPathsError

logger = logging.getLogger(__name__)

router = APIRouter(tags=["karaoke"])


class SlotCreate(BaseModel):
    color: str
    player_id: str | None = None


class SingCreate(BaseModel):
    song_id: str
    # One slot per color at most — the color list is what the UI offers.
    slots: list[SlotCreate] = Field(min_length=1, max_length=len(COLORS))
    force: bool = False


# No auth yet: capability checks (`karaoke:sing`) arrive in phase 4 as a FastAPI dependency.
@router.get("/karaoke/colors", response_model=ColorList)
async def list_karaoke_colors() -> ColorList:
    """The player colors USDX knows, in its own order. The single source of truth —
    clients must not hardcode them."""
    return ColorList(colors=list(COLORS))


@router.post(
    "/karaoke/sing",
    response_model=CurrentSing,
    status_code=202,
    responses={
        400: {"description": "USDX is not configured (or configured wrongly)."},
        404: {"description": "Unknown song or player."},
        409: {"description": "A song is already playing and `force` was not set."},
    },
)
async def sing_song(new_sing: SingCreate, request: Request, session: SessionDep) -> CurrentSing:
    """Start a song. Returns as soon as USDX was launched; the song's end arrives as the
    `karaoke.ended` / `scores.recorded` websocket events."""
    try:
        return await service.start_sing(
            session,
            request.app.state.session_factory,
            new_sing.song_id,
            [
                service.SlotRequest(color=slot.color, player_id=slot.player_id)
                for slot in new_sing.slots
            ],
            force=new_sing.force,
        )
    except (service.UnknownSongError, service.UnknownPlayerError) as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (UnknownColorError, service.NoPlayersError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except service.AlreadyPlayingError as error:
        raise HTTPException(status_code=409, detail="already_playing") from error
    except UsdxPathsError as error:
        raise HTTPException(
            status_code=400,
            detail={"error": "usdx_not_configured", "problems": error.problems},
        ) from error


@router.get("/karaoke/current", response_model=CurrentSingRead)
async def get_current_sing() -> CurrentSingRead:
    return CurrentSingRead(sing=service.current_sing())


@router.post("/karaoke/stop", status_code=204)
async def stop_singing() -> None:
    """Kill the running song. Idempotent: 204 even when nothing is playing."""
    await service.stop_sing()
