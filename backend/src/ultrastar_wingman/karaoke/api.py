"""Karaoke endpoints: the colors to pick from, starting a song, what is playing, stopping."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..auth.deps import PrincipalDep, require
from ..db import SessionDep
from . import service
from .colors import COLORS, Color, ColorList, UnknownColorError
from .schema import CurrentSing, CurrentSingRead
from .slots import PLAYER_COUNTS
from .usdx_paths import UsdxPathsError, resolve_usdx_paths

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


class UsdxStatusRead(BaseModel):
    configured: bool
    # Empty unless the caller may see the settings: these strings name paths on the host's
    # file system, which is nobody else's business.
    problems: list[str]


@router.get(
    "/karaoke/status",
    response_model=UsdxStatusRead,
    # Whoever may see songs may know whether singing one would work at all.
    dependencies=[Depends(require("songs.view"))],
)
async def usdx_status(session: SessionDep, principal: PrincipalDep) -> UsdxStatusRead:
    """Whether USDX could be launched right now — checks the settings without starting
    anything, so the UI can offer setup guidance before the first Play."""
    try:
        await resolve_usdx_paths(session)
    except UsdxPathsError as error:
        problems = error.problems if "settings.view" in principal.capabilities else []
        return UsdxStatusRead(configured=False, problems=problems)
    return UsdxStatusRead(configured=True, problems=[])


class UsdxLaunchRead(BaseModel):
    """Ultrastar Deluxe is up. `started` says whether this call is what started it."""

    started: bool


@router.post(
    "/karaoke/usdx/launch",
    response_model=UsdxLaunchRead,
    # Starting a program on the karaoke PC is the host's business, and the button lives in
    # the settings — so it is the settings' own manage right.
    dependencies=[Depends(require("settings.manage"))],
    responses={
        400: {"description": "USDX is not configured, or refused to start."},
        409: {"description": "A song is playing — that USDX is busy."},
    },
)
async def launch_usdx(session: SessionDep) -> UsdxLaunchRead:
    """Start Ultrastar Deluxe on its own, so the host can change the settings only USDX has
    (the microphones). Asking again while it is up is not an error: `started` is then false.
    """
    try:
        return UsdxLaunchRead(started=await service.open_usdx(session))
    except service.AlreadyPlayingError as error:
        raise HTTPException(status_code=409, detail="already_playing") from error
    except UsdxPathsError as error:
        raise HTTPException(
            status_code=400,
            detail={"error": "usdx_not_configured", "problems": error.problems},
        ) from error


@router.get(
    "/karaoke/colors",
    response_model=ColorList,
    # The color list is what the player selection UI offers, so it goes with players.view.
    dependencies=[Depends(require("players.view"))],
)
async def list_karaoke_colors() -> ColorList:
    """The player colors USDX knows, in its own order. The single source of truth —
    clients must not hardcode them."""
    return ColorList(colors=list(COLORS))


class SlotConfigRead(BaseModel):
    """What the player selection is built from, and what the settings UI offers."""

    # The configured singing positions, in order: slot 1 first.
    slots: list[Color]
    # The player counts Ultrastar Deluxe accepts on one screen — the choices for
    # "how many players", so no client has to know that 5 is not one of them.
    player_counts: list[int]


@router.get(
    "/karaoke/slots",
    response_model=SlotConfigRead,
    # Same audience as the color list: this is what the player selection renders.
    dependencies=[Depends(require("players.view"))],
)
async def list_karaoke_slots(session: SessionDep) -> SlotConfigRead:
    """The singing slots the host configured (`karaoke.player_colors`) with their hex
    values. How many there are is how many people sing at once."""
    by_name = {color.name: color for color in COLORS}
    return SlotConfigRead(
        slots=[by_name[name] for name in await service.slot_colors(session)],
        player_counts=list(PLAYER_COUNTS),
    )


@router.post(
    "/karaoke/sing",
    response_model=CurrentSing,
    status_code=202,
    dependencies=[Depends(require("karaoke.sing"))],
    responses={
        400: {"description": "USDX is not configured (or configured wrongly)."},
        403: {"description": "`force` was set without `karaoke.stop`."},
        404: {"description": "Unknown song or player."},
        409: {"description": "A song is already playing and `force` was not set."},
    },
)
async def sing_song(
    new_sing: SingCreate, request: Request, session: SessionDep, principal: PrincipalDep
) -> CurrentSing:
    """Start a song. Returns as soon as USDX was launched; the song's end arrives as the
    `karaoke.ended` / `scores.recorded` websocket events."""
    if new_sing.force:
        # A forced sing kills whatever is playing, so it needs the right to stop it too.
        principal.require("karaoke.stop")
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
    except (
        UnknownColorError,
        service.UnconfiguredColorError,
        service.DuplicateColorError,
        service.NoPlayersError,
    ) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except service.AlreadyPlayingError as error:
        raise HTTPException(status_code=409, detail="already_playing") from error
    except UsdxPathsError as error:
        raise HTTPException(
            status_code=400,
            detail={"error": "usdx_not_configured", "problems": error.problems},
        ) from error


@router.get(
    "/karaoke/current",
    response_model=CurrentSingRead,
    dependencies=[Depends(require("songs.view"))],
)
async def get_current_sing() -> CurrentSingRead:
    return CurrentSingRead(sing=service.current_sing())


@router.post("/karaoke/stop", status_code=204, dependencies=[Depends(require("karaoke.stop"))])
async def stop_singing() -> None:
    """Kill the running song. Idempotent: 204 even when nothing is playing."""
    await service.stop_sing()
