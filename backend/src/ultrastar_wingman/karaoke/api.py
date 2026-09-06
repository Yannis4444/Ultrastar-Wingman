"""Karaoke endpoints: the colors to pick from, starting a song, what is playing, stopping."""

import contextlib
import logging
from collections.abc import Iterator

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..auth.deps import HiddenSongsDep, PrincipalDep, require
from ..db import SessionDep
from ..devices import service as devices
from ..songs.api import song_or_404
from . import selection, service
from .colors import COLORS, Color, ColorList, UnknownColorError
from .schema import (
    CurrentSelectionRead,
    CurrentSing,
    CurrentSingRead,
    SelectionOpened,
    SelectionRead,
)
from .slots import PLAYER_COUNTS
from .usdx_paths import UsdxPathsError, resolve_usdx_paths

logger = logging.getLogger(__name__)

router = APIRouter(tags=["karaoke"])


@contextlib.contextmanager
def _sing_errors() -> Iterator[None]:
    """What the sing flow refuses, as status codes.

    A context manager rather than one `try` per handler: three routes hand slots to the same
    service (a sing, opening a selection and starting one), and the phone has to get the same
    answer whichever door it came through.
    """
    try:
        yield
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


@contextlib.contextmanager
def _selection_errors() -> Iterator[None]:
    """The two ways a token can be worthless: the selection is over, or somebody took it."""
    try:
        yield
    except selection.NoSelectionError as error:
        raise HTTPException(status_code=404, detail="no_selection") from error
    except selection.NotTheOpenerError as error:
        raise HTTPException(status_code=409, detail="not_the_opener") from error


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
    new_sing: SingCreate,
    request: Request,
    session: SessionDep,
    principal: PrincipalDep,
    hidden: HiddenSongsDep,
) -> CurrentSing:
    """Start a song. Returns as soon as USDX was launched; the song's end arrives as the
    `karaoke.ended` / `scores.recorded` websocket events."""
    if new_sing.force:
        # A forced sing kills whatever is playing, so it needs the right to stop it too.
        principal.require("karaoke.stop")
    # Here and not in the service: who the caller is decides which songs exist for them,
    # and the sing flow itself stays principal-free.
    await song_or_404(new_sing.song_id, session, hidden)
    # The room is picking singers for something: a phone (or a script) must not play over
    # it. `force` already means "take the machine", so it comes through here as well.
    if not new_sing.force and await selection.is_open():
        raise HTTPException(status_code=409, detail="selection_open")
    with _sing_errors():
        sing = await service.start_sing(
            session,
            request.app.state.session_factory,
            new_sing.song_id,
            [
                service.SlotRequest(color=slot.color, player_id=slot.player_id)
                for slot in new_sing.slots
            ],
            force=new_sing.force,
        )
    # A forced sing took the machine, so whatever the room was picking is over: the TV must
    # not keep showing a selection for a song nobody is going to sing. Only after the start
    # succeeded — a sing that was refused leaves the room exactly as it found it.
    await selection.close_selection(any_opener=True)
    return sing


class SelectionCreate(BaseModel):
    song_id: str
    # What the phone remembered from the last song. Empty is fine: at the device, the cards
    # fill the slots and nobody sends anything at all.
    slots: list[SlotCreate] = Field(default_factory=list, max_length=len(COLORS))
    force: bool = False


class SelectionSlotsUpdate(BaseModel):
    token: str
    slots: list[SlotCreate] = Field(default_factory=list, max_length=len(COLORS))


class SelectionStart(BaseModel):
    token: str
    force: bool = False


@router.post(
    "/karaoke/selection",
    response_model=SelectionOpened,
    status_code=201,
    dependencies=[Depends(require("karaoke.sing"))],
    responses={
        404: {"description": "Unknown song or player."},
        409: {"description": "Somebody else is picking singers and `force` was not set."},
    },
)
async def open_player_selection(
    new_selection: SelectionCreate,
    request: Request,
    session: SessionDep,
    hidden: HiddenSongsDep,
) -> SelectionOpened:
    """Start picking singers for a song, and lock the room while it lasts.

    Answers the selection and the token that owns it: only that token moves the slots and
    presses Play. `force` takes a selection somebody else opened over, which needs nothing
    beyond `karaoke.sing` — the UI asks first.

    Opens with whatever lies on the player selector: those people are already standing in
    the room with their card down, so their slots are theirs before the phone's remembered
    assignment gets a say. With the automatic start on, a room the cards already fill starts
    counting down from here.

    Where the room picks its singers by scanning in turn, the remembered assignment is
    dropped altogether — the cards on the slot readers still seed, but nobody else does.
    """
    # Same reasoning as the sing route: which songs exist depends on who is asking.
    await song_or_404(new_selection.song_id, session, hidden)
    remembered = [
        service.SlotRequest(color=slot.color, player_id=slot.player_id)
        for slot in new_selection.slots
    ]
    # A scan takes the first *free* slot, so last song's singers sitting in memory are in the
    # way of the queue forming at the device. Asked only when there is somebody to drop.
    remembered_singers = [slot for slot in remembered if slot.player_id is not None]
    drop_remembered = bool(remembered_singers) and await devices.sequential_reader_online(session)
    try:
        with _sing_errors():
            opened, token = await selection.open_selection(
                session,
                new_selection.song_id,
                [] if drop_remembered else remembered,
                force=new_selection.force,
                device_slots=await devices.cards_on_slots(session),
                session_factory=request.app.state.session_factory,
                auto_start=await devices.auto_start_for(session),
            )
    except selection.SelectionOpenError as error:
        raise HTTPException(status_code=409, detail="selection_open") from error
    if drop_remembered:
        # Only once the selection is really open: a refused takeover dropped nothing.
        logger.info(
            "A player selector with singers scanning in turn is online: opened the selection "
            "with empty slots instead of the %d the phone remembered.",
            len(remembered_singers),
        )
    return SelectionOpened(selection=opened, token=token)


@router.get(
    "/karaoke/selection",
    response_model=CurrentSelectionRead,
    # Whoever may see songs may see which one the room is setting up.
    dependencies=[Depends(require("songs.view"))],
)
async def get_player_selection() -> CurrentSelectionRead:
    """What the room is picking right now, without the opener's token. The host screen
    draws this, and a phone that reloaded catches up with it."""
    return CurrentSelectionRead(selection=await selection.current_selection())


@router.put(
    "/karaoke/selection/slots",
    response_model=SelectionRead,
    dependencies=[Depends(require("karaoke.sing"))],
    responses={
        404: {"description": "Nothing is being picked, or an unknown player."},
        409: {"description": "Somebody else has taken the selection over."},
    },
)
async def set_player_selection_slots(
    update: SelectionSlotsUpdate, session: SessionDep
) -> SelectionRead:
    """Move the singers around. Only the phone that opened the selection may."""
    with _selection_errors(), _sing_errors():
        return await selection.set_slots(
            session,
            update.token,
            [
                service.SlotRequest(color=slot.color, player_id=slot.player_id)
                for slot in update.slots
            ],
        )


@router.post(
    "/karaoke/selection/start",
    response_model=CurrentSing,
    status_code=202,
    dependencies=[Depends(require("karaoke.sing"))],
    responses={
        400: {"description": "USDX is not configured (or configured wrongly)."},
        403: {"description": "`force` was set without `karaoke.stop`."},
        404: {"description": "Nothing is being picked, or an unknown song or player."},
        409: {"description": "Somebody else has taken the selection over, or a song plays."},
    },
)
async def start_player_selection(
    start: SelectionStart,
    request: Request,
    session: SessionDep,
    principal: PrincipalDep,
) -> CurrentSing:
    """Sing what is on the slots. The selection is over once USDX is up; an error leaves it
    standing, so whoever opened it can fix what the message names."""
    if start.force:
        # Exactly like the sing route: a forced start kills the song that is playing.
        principal.require("karaoke.stop")
    with _selection_errors(), _sing_errors():
        return await selection.start_selection(
            session, request.app.state.session_factory, start.token, force=start.force
        )


@router.delete(
    "/karaoke/selection", status_code=204, dependencies=[Depends(require("karaoke.sing"))]
)
async def close_player_selection(principal: PrincipalDep, token: str | None = None) -> None:
    """Give the selection up. 204 even when there is nothing to give up, so an unmounting
    phone never has to look first.

    Somebody else's selection takes `karaoke.stop`: that is the host screen's cancel, and
    the phone that opened it sends its token instead. A token that does not own the
    selection any more is 409 `not_the_opener` for everybody, so a phone that was taken
    over cannot close the selection that took its place.
    """
    try:
        await selection.close_selection(token)
    except selection.NotTheOpenerError as error:
        if token is not None:
            raise HTTPException(status_code=409, detail="not_the_opener") from error
        # No token at all is the host screen's cancel: somebody else's selection, which
        # takes the right to stop the room.
        principal.require("karaoke.stop")
        await selection.close_selection(any_opener=True)


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
