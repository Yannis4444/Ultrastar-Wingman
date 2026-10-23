"""Player selector endpoints: the devices, the cards, the options and the firmware.

Everything here is `devices.manage` but for two kinds of route. The one the devices
themselves call carries a bearer token instead (`deps.py`) and no capability at all: a
device is not a person, and it holds exactly one right, which is to say what lies on its
readers. And four routes take an *identity* rather than a capability, because the card in
somebody's hand is their own: whether a selector is online (`players.view`, the picker says
so out loud), the cards lying on the readers that belong to nobody, the caller's own cards,
and claiming one. Giving a card back is the one route that reads both ways — the host may
forget any card, and everybody may forget their own.

`devices.manage` is an administrator's by default. The token minted here is a standing key
to the report endpoint, and the reader mapping decides which card puts which person on the
TV, so handing this capability out is handing out the room's singer selection.
"""

import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, StringConstraints, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..auth import service as auth
from ..auth.deps import (
    AccountIdDep,
    Principal,
    PrincipalDep,
    authenticated,
    missing_permission,
    require,
)
from ..db import SessionDep
from ..events import DevicesChanged, event_bus
from ..settings import SettingTypeError, SettingValueError
from . import firmware, service
from . import settings as device_settings
from .deps import DeviceDep, device_or_manager
from .model import MAX_NAME_LENGTH
from .protocol import SUPPORTED, DeviceReport, ReportEnvelope, readable_firmware
from .schema import (
    CardList,
    CardRead,
    DeviceCreated,
    DeviceList,
    DeviceRead,
    DeviceSettings,
    DeviceStatus,
    FirmwareManifest,
    ReportAck,
    UnknownCardList,
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
    """Every field optional: a PATCH only touches what it names. The field names are the
    settings keys without their `devices.` prefix — the handler builds the key from them."""

    auto_start: bool | None = None
    auto_start_delay_s: int | None = None
    rescan_removes: bool | None = None
    selection_idle_s: int | None = None
    start_without_selection: str | None = None
    random_scope: str | None = None
    random_playlist: str | None = None
    cancel_without_selection: str | None = None


def get_session_factory(request: Request) -> async_sessionmaker[AsyncSession]:
    factory: async_sessionmaker[AsyncSession] = request.app.state.session_factory
    return factory


SessionFactoryDep = Annotated[async_sessionmaker[AsyncSession], Depends(get_session_factory)]


async def caller_player_id(session: SessionDep, account_id: AccountIdDep) -> str:
    """The player the signed-in caller sings as, for the routes where the card is theirs
    because they are holding it.

    `AccountIdDep` and not `authenticated`: the host session is an administrator but not a
    person, and a card belongs to a player. An account that has no player yet — nothing in
    the app makes one, but a database can be older than the rule — is 404 `no_player`
    rather than a claim filed under nobody.
    """
    player = await auth.player_for_user(session, account_id)
    if player is None:
        raise HTTPException(status_code=404, detail="no_player")
    return player.id


CallerPlayerDep = Annotated[str, Depends(caller_player_id)]


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


@router.get(
    "/devices/cards/unknown",
    response_model=UnknownCardList,
    dependencies=[Depends(authenticated)],
)
async def list_unknown_cards(session: SessionDep) -> UnknownCardList:
    """The cards lying on the readers right now that belong to nobody.

    An identity and not a capability: this is the list somebody signed in picks their own
    card out of, and a uid is only worth offering while the card is in the room.
    """
    return UnknownCardList(uids=await service.unknown_cards(session))


@router.get(
    "/devices/cards/mine",
    response_model=CardList,
    dependencies=[Depends(authenticated)],
)
async def list_my_cards(session: SessionDep, account_id: AccountIdDep) -> CardList:
    """The caller's own cards. An account with no player has none, which is a list of
    nothing and not an error."""
    player = await auth.player_for_user(session, account_id)
    if player is None:
        return CardList(cards=[])
    return await service.cards_of_player(session, player.id)


@router.post(
    "/devices/cards/{uid}/claim",
    response_model=CardRead,
    responses={
        401: {"description": "Nobody is signed in, or the host session, which is not a person."},
        404: {"description": "The account sings as no player."},
        409: {"description": "The card belongs to somebody else."},
        422: {"description": "Not a card id."},
    },
)
async def claim_card(
    uid: str, session: SessionDep, factory: SessionFactoryDep, player_id: CallerPlayerDep
) -> CardRead:
    """Take a card off the readers and say it is yours.

    No capability: whoever is holding the card is who it belongs to, and the alternative is
    every guest queueing at the host's phone. A card nobody holds becomes theirs, their own
    stays theirs, and somebody else's is 409 `card_taken` — that one only the host moves.
    """
    try:
        return await service.claim_card(session, factory, uid, player_id)
    except service.InvalidUidError as error:
        raise HTTPException(status_code=422, detail=error.detail) from error
    except service.CardTakenError as error:
        raise HTTPException(status_code=409, detail=error.detail) from error
    except service.UnknownPlayerError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


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
    responses={
        403: {"description": "Somebody else's card, without `devices.manage`."},
        404: {"description": "Unknown card."},
    },
)
async def forget_card(uid: str, session: SessionDep, principal: PrincipalDep) -> None:
    """Take a card off the table. The card itself still works: it is simply nobody's.

    Two callers, one route: the host forgets any card (`devices.manage`), and everybody
    forgets their own — a card handed on is given back by whoever was holding it, and the
    claim it undoes needed nobody's permission either. So the capability is checked here
    and not in a decorator: anything that is neither is 403 for the capability, whether the
    card is somebody else's or no card at all, because the answer must not say which.
    """
    if "devices.manage" not in principal.capabilities and not await _holds_card(
        session, principal, uid
    ):
        raise missing_permission("devices.manage")
    try:
        await service.forget_card(session, uid)
    except service.UnknownCardError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


async def _holds_card(session: AsyncSession, principal: Principal, uid: str) -> bool:
    """Whether this caller is the person the card belongs to. False for a guest and for the
    host session: neither is a player."""
    if principal.user is None:
        return False
    player = await auth.player_for_user(session, principal.user.id)
    return player is not None and await service.card_belongs_to(session, uid, player.id)


@router.get(
    "/devices/status",
    response_model=DeviceStatus,
    dependencies=[Depends(require("players.view"))],
)
async def get_device_status() -> DeviceStatus:
    """Whether a player selector is standing in the room right now.

    `players.view`, because this is what the singer picker asks: while it is true the cards
    decide who sings, which is why the picker opened with empty slots and says so. It says
    nothing about the devices themselves, so it needs none of the rights over them.
    """
    return DeviceStatus(online=await service.device_online())


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
    responses={
        422: {
            "description": (
                "A delay or an idle time outside its range, an unknown mode or scope, or a "
                "playlist id too long to be one."
            )
        }
    },
)
async def update_device_settings(body: DeviceSettingsUpdate, session: SessionDep) -> DeviceSettings:
    """Switch the automatic start on, retime it, decide what a second scan does, say how
    long a half-picked song may stand, or say what the start button does at a quiet room —
    and, for a random song, what it spins the reel over — and what the cancel button does
    there.

    The playlist is not checked against the table: it may be deleted after it was chosen,
    and the press falls back to every song then rather than the setting refusing to save.

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
        # At once, and not at the next restart: a host shortening the idle time is a host
        # looking at a selection they want gone.
        await service.apply_selection_idle_ttl(session)
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
    dependencies=[Depends(device_or_manager)],
    responses={
        401: {"description": "A device token no device holds."},
        403: {"description": "A browser without `devices.manage`."},
        404: {"description": "The manifest names no such file."},
    },
)
async def get_firmware_image(file: str) -> FileResponse:
    """The image itself: the merged one for the flasher in the browser, the bare application
    for a device updating itself over Wi-Fi. Only a file the manifest names is served,
    whatever the path looks like.

    The one route in Wingman two kinds of caller reach. A request carrying a bearer token is
    a device and is answered 401 if the token is wrong; everything else is a browser and
    needs `devices.manage`, exactly like the manifest beside it.
    """
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
    request: Request, envelope: ReportEnvelope, device: DeviceDep, factory: SessionFactoryDep
) -> ReportAck | JSONResponse:
    """A device says what lies on its readers and how often its buttons were pressed.

    No capability: the bearer token is the right. The answer is this device's own: how often
    Wingman wants to hear from it, what its lights show until the next one, and the firmware
    to fetch while the host has asked for an update. A device that has none of that hardware
    reads `interval_s` and ignores the rest.

    The **protocol is read before the rest of the body**: `ReportEnvelope` is all a report
    has to be to be answered at all. A device speaking another version is recorded as one
    that needs updating and told so with a 426, whatever its readers look like — a firmware
    whose report grew a field would otherwise be refused as malformed and never appear in
    the list at all. Only then is the body read as a report of *this* protocol, and a body
    that is not one is the 422 it always was.
    """
    # Cached bytes: FastAPI has already read them for `envelope`.
    body = await request.json()
    try:
        if envelope.protocol != SUPPORTED:
            await service.record_foreign_report(
                factory, device, envelope.protocol, readable_firmware(body)
            )
            # A `JSONResponse` and not an `HTTPException`: the device reads `supported` to
            # know which firmware it needs, and a detail string cannot carry a second field.
            return JSONResponse(
                status_code=426, content={"detail": "protocol_unsupported", "supported": SUPPORTED}
            )
        try:
            parsed = DeviceReport.model_validate(body)
        except ValidationError as error:
            # FastAPI's own answer to a body that is not one, down to the shape of it: every
            # `loc` under "body" and no `url`, which is what its own body validation writes.
            # The model is validated here rather than in the signature, and a device must
            # not be able to tell the difference.
            raise RequestValidationError(
                [
                    {**detail, "loc": ("body", *detail["loc"])}
                    for detail in error.errors(include_url=False)
                ]
            ) from error
        outcome = await service.handle_report(factory, device, parsed)
    except service.UnknownDeviceError as error:
        # Deleted between the token lookup and the report. From the device's side that is
        # exactly what an unknown token is.
        raise HTTPException(status_code=401, detail="unknown_device") from error
    return ReportAck(
        protocol=SUPPORTED,
        interval_s=outcome.interval_s,
        leds=outcome.leds,
        update=outcome.update,
    )


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

    A color another device already reads is 422 `slot_taken_elsewhere`, and that one answers
    an object rather than a word: the page cannot name the device it collided with, the row
    being one this host may not even have open.
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
    except service.SlotTakenElsewhereError as error:
        raise HTTPException(
            status_code=422,
            detail={
                "error": error.detail,
                "color": error.color,
                "device": error.device_name,
            },
        ) from error
    except service.MappingError as error:
        raise HTTPException(status_code=422, detail=error.detail) from error


@router.post(
    "/devices/{device_id}/update",
    status_code=204,
    dependencies=[Depends(require("devices.manage"))],
    responses={
        **UNKNOWN_DEVICE,
        409: {"description": "There is no update to ask this device for."},
    },
)
async def request_device_update(device_id: str, session: SessionDep) -> None:
    """Ask a device to fetch the bundled firmware over Wi-Fi and flash itself.

    Nothing is pushed and nothing waits: the offer rides on the answer to the device's own
    next report, so a device that is unplugged picks it up when it comes back. It stands for
    ten minutes, which is what makes a failed attempt repeatable.

    409 `no_firmware` when this Wingman ships no build, `no_ota_image` when the build is
    older than the update over Wi-Fi (the cable still works), and `already_current` when the
    device is running the bundled version already.
    """
    try:
        await service.request_update(session, device_id)
    except service.UnknownDeviceError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except service.UpdateRefusedError as error:
        raise HTTPException(status_code=409, detail=error.detail) from error


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
