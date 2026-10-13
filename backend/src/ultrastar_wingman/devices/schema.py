"""Read models for the player selector: a device with its live state, the cards, the
bundled firmware and what a report is answered with.

FastAPI-free, like every `schema.py`, so `service.py` can build these without importing the
web layer.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from ..players.schema import PlayerRead
from .protocol import ReaderState

LedMode = Literal["off", "dim", "on", "blink", "pulse"]
"""What one LED does until the next report is answered. `dim` is the slot saying it is
there, `on` a card lying on it, `blink` a card nobody has claimed, and `pulse` either a
countdown running or a reader asking to be scanned."""


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
    # When the host asked this device to fetch the bundled firmware over Wi-Fi. Set until
    # the device reports the new version, or until ten minutes have passed and the attempt
    # may be made again.
    update_requested_at: datetime | None = None
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
    # Whether the card is lying on a reader of a device that is online right now — the rule
    # `GET /devices/cards/unknown` offers a card by. What the singer's own list marks.
    on_reader: bool


class CardList(BaseModel):
    cards: list[CardRead]


class DeviceSettings(BaseModel):
    auto_start: bool
    auto_start_delay_s: int
    rescan_removes: bool
    selection_idle_s: int
    start_without_selection: str
    # What a `random` start press spins over (`settings.RANDOM_SCOPES`), and the playlist
    # for the `playlist` scope — the empty string while none is chosen.
    random_scope: str
    random_playlist: str


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
    # The bare application image, for the update over Wi-Fi: `HTTPUpdate` wants the `0xE9`
    # magic at byte 0, and the merged image `file` names starts with the bootloader. Both
    # are optional, because a manifest built before the update existed carries neither —
    # which reads as "this build cannot be updated over Wi-Fi" and never as an error.
    ota_file: str | None = None
    ota_size: int | None = None


class FirmwareManifest(BaseModel):
    """What `firmware/build.py` wrote beside the image. Absent in a checkout that never
    built one, which is a 404 and not an error."""

    version: str
    protocol: int
    builds: list[FirmwareBuild]


class LedState(BaseModel):
    """What one LED of the optional strip shows until the next report is answered. LED *i*
    is reader *i*, so `index` is a reader position and nothing else."""

    index: int
    # Six lowercase hex digits without a `#`: the firmware parses exactly that and leaves
    # the LED black for anything else.
    rgb: str
    mode: LedMode


class FirmwareUpdate(BaseModel):
    """Fetch this image and flash it. Only in the answer while the host has asked for an
    update and the device is not on that version yet."""

    file: str
    version: str


class ReportAck(BaseModel):
    """The answer to a report, and the only thing Wingman ever says to a device.

    `interval_s` is how often the server wants to hear from it: one second while the room
    is picking singers, so the lights follow the phone, and five otherwise. `leds` is what
    the optional strip shows until the next answer, one entry per reader position the
    report carried. `update` is there only while an update over Wi-Fi is waiting to be
    fetched; a device that has no strip and no updater ignores both.
    """

    ok: bool = True
    protocol: int
    interval_s: int
    leds: list[LedState] = []
    update: FirmwareUpdate | None = None
