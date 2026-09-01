"""REST and WebSocket routes. Mounted under /api/v1 by `create_app()`."""

import contextlib
import logging
import socket

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from . import APP_NAME, __version__
from .achievements.api import router as achievements_router
from .auth.api import router as auth_router
from .auth.deps import require
from .comments.api import router as comments_router
from .config import BootstrapSettings
from .db import SessionDep
from .downloads.api import router as downloads_router
from .events import ServerReady, SettingChanged, event_bus
from .join_url import normalize_join_url
from .karaoke.api import router as karaoke_router
from .library.api import router as library_router
from .players.api import router as players_router
from .settings import (
    SettingDefinition,
    SettingsService,
    SettingTypeError,
    SettingValue,
    SettingValueError,
    UnknownSettingError,
)
from .songs.api import router as songs_router
from .sources.api import router as sources_router
from .stats.api import router as stats_router
from .tags.api import router as tags_router

logger = logging.getLogger(__name__)

router = APIRouter()
router.include_router(auth_router)
router.include_router(songs_router)
router.include_router(players_router)
router.include_router(karaoke_router)
router.include_router(downloads_router)
router.include_router(sources_router)
router.include_router(library_router)
router.include_router(stats_router)
router.include_router(tags_router)
router.include_router(comments_router)
router.include_router(achievements_router)


class Health(BaseModel):
    name: str
    version: str


@router.get("/health", response_model=Health)
async def health() -> Health:
    return Health(name=APP_NAME, version=__version__)


class JoinInfo(BaseModel):
    """Where a phone on the same network reaches Wingman."""

    url: str


def lan_ip() -> str:
    """The machine's address on the local network — where the phones can reach us.

    Connecting a UDP socket sends no packet; it only makes the OS pick the outgoing
    interface, whose address is the one guests can reach.
    """
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("203.0.113.1", 1))
            return str(probe.getsockname()[0])
    except OSError:
        return "localhost"


@router.get("/join", response_model=JoinInfo)
async def get_join_info(request: Request, session: SessionDep) -> JoinInfo:
    """The URL guests open on their phones — `host.join_url` when it is set, otherwise
    the machine's LAN address. The host screen encodes it in the QR code:
    `window.location.origin` would be `localhost` on the karaoke PC itself."""
    settings: BootstrapSettings = request.app.state.bootstrap_settings
    # Normalised, never rejected here: the PATCH that stored the override already
    # refused what cannot be opened, and a host left without a QR code has no way back
    # in. The port goes on a bare address ("192.168.1.5"), which is what a host types
    # when all they mean to correct is which of their machine's addresses to advertise.
    override = normalize_join_url(
        str(await SettingsService(session).get("host.join_url")), port=settings.port
    )
    if override:
        return JoinInfo(url=override)
    return JoinInfo(url=f"http://{lan_ip()}:{settings.port}")


class SettingRead(BaseModel):
    key: str
    value: SettingValue | None
    value_type: str
    default: SettingValue | None
    group: str
    description: str
    secret: bool
    # Shown folded away inside its group: a normal setup never touches it.
    advanced: bool
    # The only thing a client learns about a secret's value: that there is one.
    is_set: bool


class SettingUpdate(BaseModel):
    """`value: null` resets the setting to the default from its definition."""

    value: SettingValue | None


def _read(definition: SettingDefinition, value: SettingValue, is_set: bool) -> SettingRead:
    return SettingRead(
        key=definition.key,
        value=None if definition.secret else value,
        value_type=definition.value_type.__name__,
        default=None if definition.secret else definition.default,
        group=definition.group,
        description=definition.description,
        secret=definition.secret,
        advanced=definition.advanced,
        is_set=is_set,
    )


@router.get(
    "/settings",
    response_model=list[SettingRead],
    dependencies=[Depends(require("settings.view"))],
)
async def list_settings(session: SessionDep) -> list[SettingRead]:
    service = SettingsService(session)
    values = await service.all()
    stored = await service.stored_keys()
    return [
        _read(definition, values[key], key in stored)
        for key, definition in service.definitions.items()
    ]


@router.patch(
    "/settings/{key}",
    response_model=SettingRead,
    dependencies=[Depends(require("settings.manage"))],
)
async def update_setting(key: str, update: SettingUpdate, session: SessionDep) -> SettingRead:
    service = SettingsService(session)
    try:
        if update.value is None:
            value = await service.reset(key)
        else:
            value = await service.set(key, update.value)
    except UnknownSettingError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (SettingTypeError, SettingValueError) as error:
        # The registry's own complaint, verbatim: the settings UI shows it under the field.
        raise HTTPException(status_code=422, detail=str(error)) from error
    result = _read(service.definition(key), value, is_set=update.value is not None)
    # `result.value`, never `value`: the websocket is open to anonymous clients, so a secret
    # setting (usdb.password) must reach it masked exactly like the GET response masks it.
    await event_bus.broadcast(SettingChanged(key=key, value=result.value))
    return result


# Deliberately open to anonymous clients: a guest's song list has to stay live too. Nothing
# secret goes over the bus — see the masking above.
@router.websocket("/ws")
async def websocket_events(websocket: WebSocket) -> None:
    await event_bus.connect(websocket)
    try:
        await websocket.send_json(ServerReady(version=__version__).model_dump(mode="json"))
        with contextlib.suppress(WebSocketDisconnect):
            while True:
                # The bus is server to client only; whatever a client sends is logged and dropped.
                logger.debug("ignoring websocket message: %s", await websocket.receive_text())
    finally:
        event_bus.disconnect(websocket)
