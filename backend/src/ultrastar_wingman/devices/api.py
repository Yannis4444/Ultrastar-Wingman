"""Player selector endpoints: the devices, the cards, the options and the firmware.

Everything here is `devices.manage` except the one route the devices themselves call. That
one carries a bearer token instead (`deps.py`) and no capability at all: a device is not a
person, and it holds exactly one right, which is to say what lies on its readers.

`devices.manage` is an administrator's by default. The token minted here is a standing key
to the report endpoint, and the reader mapping decides which card puts which person on the
TV, so handing this capability out is handing out the room's singer selection.
"""

import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..auth.deps import require
from ..db import SessionDep
from ..events import DevicesChanged, event_bus
from ..settings import SettingTypeError, SettingValueError
from . import firmware, service
from . import settings as device_settings
from .deps import DeviceDep
from .model import MAX_NAME_LENGTH
from .protocol import SUPPORTED, DeviceReport
from .schema import (
    CardList,
    CardRead,
    DeviceCreated,
    DeviceList,
    DeviceRead,
    DeviceSettings,
    FirmwareManifest,
    ReportAck,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["devices"])

UNKNOWN_DEVICE: dict[int | str, dict[str, object]] = {404: {"description": "Unknown device."}}

# Stripped before the length is counted, so a name of nothing but spaces is refused rather
# than stored as the empty string the list would then draw a nameless row for.
DeviceName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_NAME_LENGTH)
]


class DeviceCreate(BaseModel):
    name: DeviceName


class DeviceUpdate(BaseModel):
    """Every field optional: a PATCH only touches what it names. A mapping that is named
    replaces the whole one before it, keyed by the position as a string."""

    name: DeviceName | None = None
    reader_roles: dict[str, str] | None = None
    button_actions: dict[str, str] | None = None


class CardAssign(BaseModel):
    player_id: str


class DeviceSettingsUpdate(BaseModel):
    auto_start: bool | None = None
    auto_start_delay_s: int | None = None
    rescan_removes: bool | None = None


def get_session_factory(request: Request) -> async_sessionmaker[AsyncSession]:
    factory: async_sessionmaker[AsyncSession] = request.app.state.session_factory
    return factory


SessionFactoryDep = Annotated[async_sessionmaker[AsyncSession], Depends(get_session_factory)]


@router.get(
    "/devices", response_model=DeviceList, dependencies=[Depends(require("devices.manage"))]
)
async def list_devices(session: SessionDep) -> DeviceList:
    """Every player selector with what it is saying right now: online, its versions, what
    lies on each reader and who that card belongs to."""
    return await service.list_devices(session)


@router.post(
    "/devices",
    response_model=DeviceCreated,
    status_code=201,
    dependencies=[Depends(require("devices.manage"))],
)
async def create_device(body: DeviceCreate, session: SessionDep) -> DeviceCreated:
    """Add a device and mint its token. This is the only answer the token is ever in: the
    setup wizard writes it to the device over USB, and Wingman keeps its hash."""
    device, token = await service.create_device(session, body.name)
    return DeviceCreated(device=device, token=token)


# Before `/devices/{device_id}`: FastAPI matches in registration order, and the other way
# round "cards", "settings" and "firmware" would all be read as a device id.
@router.get(
    "/devices/cards", response_model=CardList, dependencies=[Depends(require("devices.manage"))]
)
async def list_cards(session: SessionDep) -> CardList:
    """Every card Wingman knows and who it belongs to, newest first."""
    return await service.list_cards(session)


@router.put(
    "/devices/cards/{uid}",
    response_model=CardRead,
    dependencies=[Depends(require("devices.manage"))],
    responses={404: {"description": "Unknown player."}},
)
async def assign_card(
    uid: str, body: CardAssign, session: SessionDep, factory: SessionFactoryDep
) -> CardRead:
    """Give a card to a player. A card that already belonged to somebody moves, which is
    what a card handed on to the next guest does.

    The uid is hex as a reader reads it, in either case; anything else is 422 `invalid_uid`
    rather than a row nothing will ever look up.
    """
    try:
        return await service.assign_card(session, factory, uid, body.player_id)
    except service.InvalidUidError as error:
        raise HTTPException(status_code=422, detail=error.detail) from error
    except service.UnknownPlayerError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.delete(
    "/devices/cards/{uid}",
    status_code=204,
    dependencies=[Depends(require("devices.manage"))],
    responses={404: {"description": "Unknown card."}},
)
async def forget_card(uid: str, session: SessionDep) -> None:
    """Take a card off the table. The card itself still works: it is simply nobody's."""
    try:
        await service.forget_card(session, uid)
    except service.UnknownCardError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get(
    "/devices/settings",
    response_model=DeviceSettings,
    dependencies=[Depends(require("devices.manage"))],
)
async def get_device_settings(session: SessionDep) -> DeviceSettings:
    return await service.read_settings(session)


@router.patch(
    "/devices/settings",
    response_model=DeviceSettings,
    dependencies=[Depends(require("devices.manage"))],
    responses={422: {"description": "A delay outside 0 to 30 seconds."}},
)
async def update_device_settings(body: DeviceSettingsUpdate, session: SessionDep) -> DeviceSettings:
    """Switch the automatic start on, retime it, or decide what a second scan does.

    Registered before `PATCH /devices/{device_id}` for the same reason as the settings
    listing above.
    """
    settings = device_settings.service(session)
    named = {
        field: value
        for field, value in body.model_dump().items()
        if field in body.model_fields_set and value is not None
    }
    try:
        for field, value in named.items():
            await settings.set(f"devices.{field}", value)
    except (SettingTypeError, SettingValueError) as error:
        # The registry's own complaint, verbatim: the page shows it under the field.
        raise HTTPException(status_code=422, detail=str(error)) from error
    if named:
        await event_bus.broadcast(DevicesChanged())
    return await service.read_settings(session)


@router.get(
    "/devices/firmware",
    response_model=FirmwareManifest,
    dependencies=[Depends(require("devices.manage"))],
    responses={404: {"description": "This Wingman ships no firmware build."}},
)
async def get_firmware_manifest() -> FirmwareManifest:
    """What the bundled firmware is. A checkout that never built one answers 404
    `no_firmware`, and the wizard says how to build it."""
    manifest = firmware.read_manifest()
    if manifest is None:
        raise HTTPException(status_code=404, detail="no_firmware")
    return manifest


@router.get(
    "/devices/firmware/{file}",
    response_class=FileResponse,
    dependencies=[Depends(require("devices.manage"))],
    responses={404: {"description": "The manifest names no such file."}},
)
async def get_firmware_image(file: str) -> FileResponse:
    """The image itself, for the flasher in the browser. Only a file the manifest names is
    served, whatever the path looks like."""
    path: Path | None = firmware.image_path(file)
    if path is None:
        raise HTTPException(status_code=404, detail="no_firmware")
    return FileResponse(path, media_type="application/octet-stream", filename=path.name)


@router.post(
    "/devices/report",
    response_model=ReportAck,
    responses={
        401: {"description": "No device token, or one no device holds."},
        426: {"description": "The device speaks another version of the report protocol."},
    },
)
async def report(
    body: DeviceReport, device: DeviceDep, factory: SessionFactoryDep
) -> ReportAck | JSONResponse:
    """A device says what lies on its readers and how often its buttons were pressed.

    No capability: the bearer token is the right. The answer is the same for every device
    and carries `interval_s`, which is how often Wingman wants to hear from it even when
    nothing changes.
    """
    try:
        outcome = await service.handle_report(factory, device, body)
    except service.ProtocolUnsupportedError:
        # A `JSONResponse` and not an `HTTPException`: the device reads `supported` to know
        # which firmware it needs, and a detail string cannot carry a second field.
        return JSONResponse(
            status_code=426, content={"detail": "protocol_unsupported", "supported": SUPPORTED}
        )
    except service.UnknownDeviceError as error:
        # Deleted between the token lookup and the report. From the device's side that is
        # exactly what an unknown token is.
        raise HTTPException(status_code=401, detail="unknown_device") from error
    return ReportAck(protocol=SUPPORTED, interval_s=outcome.interval_s)


@router.patch(
    "/devices/{device_id}",
    response_model=DeviceRead,
    dependencies=[Depends(require("devices.manage"))],
    responses={
        **UNKNOWN_DEVICE,
        422: {"description": "A mapping the device cannot have."},
    },
)
async def update_device(device_id: str, body: DeviceUpdate, session: SessionDep) -> DeviceRead:
    """Rename a device, wire its readers to slots, or say what its buttons do.

    A role on a reader that did not answer the boot probe is 422 `reader_not_wired`, two
    readers on one slot color 422 `duplicate_slot`, and a color Ultrastar Deluxe has no
    microphone for 422 `unknown_color`.
    """
    try:
        return await service.update_device(
            session,
            device_id,
            name=body.name,
            reader_roles=body.reader_roles,
            button_actions=body.button_actions,
        )
    except service.UnknownDeviceError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except service.MappingError as error:
        raise HTTPException(status_code=422, detail=error.detail) from error


@router.post(
    "/devices/{device_id}/token",
    response_model=DeviceCreated,
    dependencies=[Depends(require("devices.manage"))],
    responses=UNKNOWN_DEVICE,
)
async def rotate_device_token(device_id: str, session: SessionDep) -> DeviceCreated:
    """Mint a new token for a device whose old one nobody wrote down. The old one stops
    working at once, so the device is silent until the wizard has written the new one."""
    try:
        device, token = await service.rotate_token(session, device_id)
    except service.UnknownDeviceError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    return DeviceCreated(device=device, token=token)


@router.delete(
    "/devices/{device_id}",
    status_code=204,
    dependencies=[Depends(require("devices.manage"))],
    responses=UNKNOWN_DEVICE,
)
async def delete_device(device_id: str, session: SessionDep) -> None:
    """Forget a device. The cards stay: they belong to the people, and the next device reads
    the same ones."""
    try:
        await service.delete_device(session, device_id)
    except service.UnknownDeviceError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
