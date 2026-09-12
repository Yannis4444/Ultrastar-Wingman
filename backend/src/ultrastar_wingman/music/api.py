"""Background music endpoints: what is playing, the controls, the options, and the sink.

Three capabilities, and the split is the point. `music.view` is a guest's, because what the
room is hearing is the room's own business. `music.control` is an account's, because pausing
or skipping changes what everybody hears. `music.manage` switches the music on and chooses
what it plays from.

The three **sink** routes take `music.manage` rather than `music.control`, which is stricter
than it looks like it should be: registering as the sink takes the audio *off* whatever
screen currently has it, so a phone holding only `music.control` must not be able to do it.
The host session is an administrator, so the screen that actually plays loses nothing.
"""

import logging
from collections.abc import Coroutine
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from ..auth.deps import require
from ..db import SessionDep
from ..events import SettingChanged, event_bus
from ..settings import SettingsService, SettingTypeError, SettingValueError
from ..sound import EFFECTS_VOLUME, MASTER_VOLUME, MUSIC_VOLUME
from . import service
from . import settings as music_settings
from .schema import MusicRead, MusicSettings, MusicSinkRegistered, MusicSinkReport

logger = logging.getLogger(__name__)

router = APIRouter(tags=["music"])

# What a refusal means, once, so the two control routes that can refuse say the same thing.
_CONTROL_RESPONSES: dict[int | str, dict[str, Any]] = {
    409: {
        "description": (
            "`music_disabled` when the background music is switched off, `music_blocked` "
            "while Ultrastar Deluxe has the speakers, `empty_pool` when there is nothing "
            "to play."
        )
    }
}


class MusicVolumeUpdate(BaseModel):
    """Only the volumes named are written, the settings PATCH convention."""

    master: int | None = Field(default=None, ge=0, le=100)
    music: int | None = Field(default=None, ge=0, le=100)
    effects: int | None = Field(default=None, ge=0, le=100)


class MusicSettingsUpdate(BaseModel):
    enabled: bool | None = None
    scope: str | None = None
    playlist: str | None = None
    resume_delay_s: int | None = None
    preview_on_spin: bool | None = None


class MusicSinkRelease(BaseModel):
    sink_id: str


@router.get(
    "/music",
    response_model=MusicRead,
    dependencies=[Depends(require("music.view"))],
)
async def get_music() -> MusicRead:
    """What the background music is doing, for every phone in the room.

    A read and nothing more: it never picks a song, because a pick nobody broadcasts is one
    the host screen would never hear about. The tick does that, a second away at most.
    """
    return await service.read()


@router.post(
    "/music/play",
    response_model=MusicRead,
    dependencies=[Depends(require("music.control"))],
    responses=_CONTROL_RESPONSES,
)
async def play_music(session: SessionDep) -> MusicRead:
    """Play. Also cancels the pause after a song, because play means now."""
    return await _controlled(service.play(session))


@router.post(
    "/music/pause",
    response_model=MusicRead,
    dependencies=[Depends(require("music.control"))],
)
async def pause_music(session: SessionDep) -> MusicRead:
    """Silence the room until somebody presses play.

    Never a refusal: there is no state in which "be quiet" is a thing to argue with, and it
    survives a sing — somebody who silenced the room on purpose should not find the music
    started itself again because a song finished.
    """
    payload = await service.pause(session)
    await service.broadcast(payload)
    return payload


@router.post(
    "/music/skip",
    response_model=MusicRead,
    dependencies=[Depends(require("music.control"))],
    responses=_CONTROL_RESPONSES,
)
async def skip_music(session: SessionDep) -> MusicRead:
    """The next song, from its beginning. Keeps a paused room paused."""
    return await _controlled(service.skip(session))


@router.put(
    "/music/volume",
    response_model=MusicRead,
    dependencies=[Depends(require("music.control"))],
    responses={422: {"description": "A volume outside 0 to 100."}},
)
async def set_music_volume(body: MusicVolumeUpdate, session: SessionDep) -> MusicRead:
    """Move one or more of the three volumes.

    They are ordinary registered settings, so this route is how a reader who may control the
    music moves one without holding `settings.manage` — turning the music down is not
    administering the server. Each key that is written also emits its own `setting.changed`,
    so a Settings page somebody has open stays in step.
    """
    keys = {"master": MASTER_VOLUME, "music": MUSIC_VOLUME, "effects": EFFECTS_VOLUME}
    named = {
        keys[field]: value
        for field, value in body.model_dump().items()
        if field in body.model_fields_set and value is not None
    }
    settings = SettingsService(session)
    try:
        for key, value in named.items():
            await settings.set(key, value)
    except (SettingTypeError, SettingValueError) as error:
        # The registry's own complaint, verbatim: the page shows it under the field.
        raise HTTPException(status_code=422, detail=str(error)) from error
    payload = await service.apply_settings(session)
    if named:
        for key, value in named.items():
            await event_bus.broadcast(SettingChanged(key=key, value=value))
        await service.broadcast(payload)
    return payload


@router.get(
    "/music/settings",
    response_model=MusicSettings,
    dependencies=[Depends(require("music.manage"))],
)
async def get_music_settings(session: SessionDep) -> MusicSettings:
    """The options behind the player's gear. `playlist` is here and not on `GET /music`:
    an id on the open event bus could name a list its owner keeps to themselves."""
    return await service.read_settings(session)


@router.patch(
    "/music/settings",
    response_model=MusicSettings,
    dependencies=[Depends(require("music.manage"))],
    responses={
        422: {"description": "An unknown scope, a playlist id too long to be one, or a bad delay."}
    },
)
async def update_music_settings(body: MusicSettingsUpdate, session: SessionDep) -> MusicSettings:
    """Switch the music on, choose what it plays from, and say how long the room stays quiet
    after a song.

    The playlist is not checked against the table — it may be deleted after it was chosen —
    but unlike the player selector's, a playlist that is gone leaves the music with nothing
    to play rather than falling back to every song. An hour of music out of the pool the
    host excluded is not a kindness.
    """
    settings = music_settings.service(session)
    named = {
        field: value
        for field, value in body.model_dump().items()
        if field in body.model_fields_set and value is not None
    }
    try:
        for field, value in named.items():
            await settings.set(f"music.{field}", value)
    except (SettingTypeError, SettingValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    if named:
        # At once, and not at the next restart: a host switching the music on is a host
        # standing in a quiet room.
        payload = await service.apply_settings(session)
        await service.broadcast(payload)
    return await service.read_settings(session)


@router.post(
    "/music/sink",
    response_model=MusicSinkRegistered,
    dependencies=[Depends(require("music.manage"))],
)
async def register_music_sink(session: SessionDep) -> MusicSinkRegistered:
    """Take over as the screen that makes the sound.

    The newest claim always wins, unconditionally, because the alternative is worse: a host
    page that reloaded would otherwise wait out the whole timeout in silence. Whoever held
    the lease before learns from the `sink_generation` in the broadcast that follows, and
    from a 409 on its next report.

    Register only once the audio element can actually play — after the browser's autoplay
    gesture. `sink_online` is the app's promise to every phone that sound is coming out, and
    a lease held by a muted tab makes that promise a lie.
    """
    sink_id, interval, payload = await service.register_sink(session)
    await service.broadcast(payload)
    return MusicSinkRegistered(sink_id=sink_id, heartbeat_interval_s=interval, music=payload)


@router.post(
    "/music/sink/report",
    response_model=MusicRead,
    dependencies=[Depends(require("music.manage"))],
    responses={409: {"description": "`not_the_sink`: another screen took the sound over."}},
)
async def report_music_sink(body: MusicSinkReport, session: SessionDep) -> MusicRead:
    """Where the song is, that it ended, or that it would not play.

    A report naming a track that is no longer the current one is answered with the state and
    nothing else — not an error. That covers a retried `ended`, a report that crossed a skip
    on the wire, and a tab that woke up on a song the room has moved past.
    """
    try:
        payload, changed = await service.report_sink(
            session,
            sink_id=body.sink_id,
            track_id=body.track_id,
            event=body.event,
            position_s=body.position_s,
            duration_s=body.duration_s,
            detail=body.detail,
        )
    except service.NotTheSinkError as error:
        raise HTTPException(status_code=409, detail=error.detail) from error
    if changed:
        await service.broadcast(payload)
    return payload


@router.post(
    "/music/sink/release",
    status_code=204,
    dependencies=[Depends(require("music.manage"))],
)
async def release_music_sink(body: MusicSinkRelease, session: SessionDep) -> Response:
    """Give the sound back — the host page is closing.

    A stale id is a 204 too. The tab is going away, and telling it off helps nobody.
    """
    if await service.release_sink(body.sink_id):
        await service.broadcast(await service.read())
    return Response(status_code=204)


async def _controlled(call: Coroutine[Any, Any, MusicRead]) -> MusicRead:
    """The three 409s the controls share, and the broadcast that follows a change.

    Every one of them is said out loud rather than silently doing nothing: a press that
    went nowhere needs a reason the phone can show.
    """
    try:
        payload = await call
    except (
        service.MusicDisabledError,
        service.MusicBlockedError,
        service.EmptyPoolError,
    ) as error:
        raise HTTPException(status_code=409, detail=error.detail) from error
    await service.broadcast(payload)
    return payload
