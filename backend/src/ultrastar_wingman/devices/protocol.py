"""What a device sends, and which version of it Wingman understands.

The report is a *snapshot*: the device never says "placed" or "removed", it says what lies
on its readers and how often each button has been pressed since it booted. The server does
the diffing (`service.handle_report`), so a lost report costs nothing — the next one carries
the current state — and a device needs no memory of what it already told us.

`SUPPORTED` is the one protocol this Wingman speaks. A device reporting another one is
recorded all the same (so the admin page can say "needs update") and answered 426; the
version lives in the firmware's `pins.h`, next to the pin map it describes.
"""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

SUPPORTED = 1

# A protocol number is the only thing out of a report that is written to a column, so it is
# the only one whose size matters: SQLite stores a 64-bit integer and aiosqlite raises
# `OverflowError` on anything larger, which would be a 500 on a body the schema accepted.
# Bounded well below that, because a version counts from one and nothing is ever going to
# reach two billion of them.
MAX_PROTOCOL = 2**31 - 1

# The pin map ships six readers and four buttons. The cap is higher than both because a
# later map may grow, and a device that grew is a device to be told to update rather than a
# body to refuse: bounded so a broken (or hostile) client cannot post a million entries.
MAX_READERS = 16
MAX_BUTTONS = 16

# What the boot probe made of a reader position (§3.1 of the design):
#
# * `wired` — a known MFRC522 version byte answered twice. Only these are polled, and only
#   these may be given a role.
# * `none` — nothing answered (`version` is "00"): no reader on that chip select.
# * `fault` — an unknown byte, or two different readings. Almost always the clone-MISO
#   problem, where readers that work alone answer garbage together. Never polled.
ReaderState = Literal["wired", "none", "fault"]

READER_STATES: tuple[ReaderState, ...] = ("wired", "none", "fault")


class ReaderReport(BaseModel):
    """One reader position, as the device sees it right now."""

    index: int = Field(ge=0, lt=MAX_READERS)
    state: ReaderState
    # The raw `VersionReg` byte, two lowercase hex digits. Kept as the device wrote it: it
    # is what the build page's troubleshooting is read against (0x91/0x92 are the modules
    # that behave), and a fault's byte is the evidence.
    version: str = Field(pattern="^[0-9a-f]{2}$")
    # The card lying on it, or None. Uppercase hex: 4-byte MIFARE Classic ids are 8
    # characters, 7-byte ISO 14443A ids 14, and 10-byte ones 20.
    uid: str | None = Field(default=None, pattern="^[0-9A-F]{8,20}$")


class ButtonReport(BaseModel):
    """One button, with the number of presses since the device booted.

    A counter and not an edge, for the same reason the readers send state: a report that
    never arrived must not lose a press. The server reacts to the counter *growing*; a
    smaller number than last time is a device that rebooted, which is a new baseline and not
    somebody pressing the button (`service._diff`).
    """

    index: int = Field(ge=0, lt=MAX_BUTTONS)
    presses: int = Field(ge=0)


class DeviceReport(BaseModel):
    """One `POST /devices/report` body."""

    protocol: int = Field(ge=0, le=MAX_PROTOCOL)
    firmware: str = Field(max_length=32)
    uptime_s: int = Field(ge=0)
    # dBm, always negative in practice. Not bounded: a signal reading is decoration on the
    # admin page, and a device with a strange radio must still be able to report at all.
    rssi: int
    readers: list[ReaderReport] = Field(default_factory=list, max_length=MAX_READERS)
    buttons: list[ButtonReport] = Field(default_factory=list, max_length=MAX_BUTTONS)

    @model_validator(mode="after")
    def _one_entry_per_position(self) -> "DeviceReport":
        """A snapshot has one entry per position. Two of them are two answers to the same
        question, and the diff would keep whichever came last — so the body is refused
        instead, before anything in the room moves on it."""
        if len({reader.index for reader in self.readers}) != len(self.readers):
            raise ValueError("two entries for one reader position")
        if len({button.index for button in self.buttons}) != len(self.buttons):
            raise ValueError("two entries for one button position")
        return self
