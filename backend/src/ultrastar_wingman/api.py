"""REST and WebSocket routes. Mounted under /api/v1 by `create_app()`."""

import contextlib
import logging

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from . import APP_NAME, __version__
from .db import SessionDep
from .events import ServerReady, SettingChanged, event_bus
from .karaoke.api import router as karaoke_router
from .players.api import router as players_router
from .settings import (
    SettingDefinition,
    SettingsService,
    SettingTypeError,
    SettingValue,
    UnknownSettingError,
)
from .songs.api import router as songs_router

logger = logging.getLogger(__name__)

router = APIRouter()
router.include_router(songs_router)
router.include_router(players_router)
router.include_router(karaoke_router)


class Health(BaseModel):
    name: str
    version: str


@router.get("/health", response_model=Health)
async def health() -> Health:
    return Health(name=APP_NAME, version=__version__)


class SettingRead(BaseModel):
    key: str
    value: SettingValue | None
    value_type: str
    default: SettingValue | None
    group: str
    description: str
    secret: bool


class SettingUpdate(BaseModel):
    value: SettingValue


def _read(definition: SettingDefinition, value: SettingValue) -> SettingRead:
    return SettingRead(
        key=definition.key,
        value=None if definition.secret else value,
        value_type=definition.value_type.__name__,
        default=None if definition.secret else definition.default,
        group=definition.group,
        description=definition.description,
        secret=definition.secret,
    )


# No auth yet: capability checks (`settings:manage`) arrive in phase 4 as a FastAPI dependency.
@router.get("/settings", response_model=list[SettingRead])
async def list_settings(session: SessionDep) -> list[SettingRead]:
    service = SettingsService(session)
    values = await service.all()
    return [_read(definition, values[key]) for key, definition in service.definitions.items()]


@router.patch("/settings/{key}", response_model=SettingRead)
async def update_setting(key: str, update: SettingUpdate, session: SessionDep) -> SettingRead:
    service = SettingsService(session)
    try:
        value = await service.set(key, update.value)
    except UnknownSettingError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except SettingTypeError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    result = _read(service.definition(key), value)
    await event_bus.broadcast(SettingChanged(key=key, value=result.value))
    return result


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
