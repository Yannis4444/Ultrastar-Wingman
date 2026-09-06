"""Read models for the player selector: a device with its live state, the cards, the
bundled firmware and what a report is answered with.

FastAPI-free, like every `schema.py`, so `service.py` can build these without importing the
web layer.
"""

from datetime import datetime

from pydantic import BaseModel

from ..players.schema import PlayerRead
from .protocol import ReaderState


class ReaderRead(BaseModel):
    """One reader position of one device, as the admin page draws it."""

    index: int
    state: ReaderState
    # The raw version byte of the boot probe, or None for a position no report has covered
    # yet. Shown beside a fault: `docs/user/` explains which bytes are the good clones.
    version: str | None = None
    # The card lying on it right now, or None. Always None while the device is offline: it
    # is not saying anything, so nothing is lying there as far as Wingman knows.
    uid: str | None = None
    # Who that card belongs to. None with a uid set is a card nobody claimed yet, which is
    # exactly what the card table's "Unknown card" row is for.
    player: PlayerRead | None = None
    # What the host mapped it to: `slot:<color>`, `sequential` or `unused`.
    role: str


class ButtonRead(BaseModel):
    index: int
    # Presses since the device booted. Decoration on the admin page, and how the wizard's
    # discovery step sees a button being pressed.
    presses: int
    action: str


class DeviceRead(BaseModel):
    id: str
    name: str
    created_at: datetime
    last_seen_at: datetime | None = None
    # A report arrived within the last few seconds. Everything live below is only worth
    # reading while this is true.
    online: bool
    firmware_version: str | None = None
    protocol: int | None = None
    # The device speaks the protocol this Wingman does. False for a device that needs its
    # firmware updated, and None for one that has never reported.
    compatible: bool | None = None
    rssi: int | None = None
    uptime_s: int | None = None
    readers: list[ReaderRead]
    buttons: list[ButtonRead]


class DeviceList(BaseModel):
    devices: list[DeviceRead]


class DeviceCreated(BaseModel):
    """The one time a token is readable: the wizard writes it to the device over USB and
    Wingman keeps only its hash."""

    device: DeviceRead
    token: str


class CardRead(BaseModel):
    uid: str
    player: PlayerRead
    created_at: datetime


class CardList(BaseModel):
    cards: list[CardRead]


class DeviceSettings(BaseModel):
    auto_start: bool
    auto_start_delay_s: int
    rescan_removes: bool
    selection_idle_s: int


class DeviceStatus(BaseModel):
    """Whether the room has a player selector in it. What the phone's picker asks before it
    says the cards are deciding, and the host rail before it says one has gone."""

    online: bool


class UnknownCardList(BaseModel):
    """The uids lying on the readers that belong to nobody. Uids and nothing else: a card
    nobody owns has nothing else to say about itself."""

    uids: list[str]


class FirmwareBuild(BaseModel):
    chip: str
    file: str
    size: int


class FirmwareManifest(BaseModel):
    """What `firmware/build.py` wrote beside the image. Absent in a checkout that never
    built one, which is a 404 and not an error."""

    version: str
    protocol: int
    builds: list[FirmwareBuild]


class ReportAck(BaseModel):
    """The answer to a report. The body is deliberately more than `{"ok": true}`: it is
    where feedback for the device (lights, a buzzer) goes when that ships, and `interval_s`
    already tells a device how often the server wants to hear from it."""

    ok: bool = True
    protocol: int
    interval_s: int
