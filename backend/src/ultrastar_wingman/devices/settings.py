"""The four knobs the player selector has, and where they live.

Module-private definitions read through a `SettingsService` built on them, the
`achievements/settings.py` pattern and for the first of its two reasons: `settings.manage`
is the wrong gate. These belong to whoever looks after the devices, and one capability,
`devices.manage`, opens the device list and its options together.

The second reason does not apply here (nothing but the device pages reads them), which is
why they are answered by `GET /devices/settings` alone and ride on no open listing.

Storage is the ordinary `settings` table, so a value survives a restart.
"""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from ..settings import SettingDefinition, SettingsService, SettingValue

logger = logging.getLogger(__name__)

AUTO_START = "devices.auto_start"
AUTO_START_DELAY = "devices.auto_start_delay_s"
RESCAN_REMOVES = "devices.rescan_removes"
SELECTION_IDLE = "devices.selection_idle_s"

# The delay is the room's chance to take a wrong card off the reader before the song starts.
# Half a minute is already long enough that nobody would wait for it.
MAX_AUTO_START_DELAY = 30

# How long a selection nobody touches may stand. Half a minute at the bottom, because the
# room needs time to find the singers; a quarter of an hour at the top, because a selection
# that outlives the song it was opened for is a TV showing something nobody is doing.
MIN_SELECTION_IDLE = 30
MAX_SELECTION_IDLE = 900


def _validate_delay(value: SettingValue) -> None:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError("a whole number of seconds")
    if value < 0 or value > MAX_AUTO_START_DELAY:
        raise ValueError(f"between 0 and {MAX_AUTO_START_DELAY} seconds")


def _validate_idle(value: SettingValue) -> None:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError("a whole number of seconds")
    if value < MIN_SELECTION_IDLE or value > MAX_SELECTION_IDLE:
        raise ValueError(f"between {MIN_SELECTION_IDLE} and {MAX_SELECTION_IDLE} seconds")


# Not `settings.register`-ed on purpose, see the module docstring. `group` and `description`
# are filled in all the same: they are part of a definition.
DEFINITIONS: dict[str, SettingDefinition] = {
    AUTO_START: SettingDefinition(
        key=AUTO_START,
        value_type=bool,
        default=False,
        group="Player selector",
        description=(
            "Start the song by itself once every slot holds a singer Wingman knows. "
            "Off: somebody presses Play, on a phone or on the selector."
        ),
    ),
    AUTO_START_DELAY: SettingDefinition(
        key=AUTO_START_DELAY,
        value_type=int,
        default=3,
        group="Player selector",
        description=(
            "How long the room has to take a wrong card off the selector before the song starts."
        ),
        validate=_validate_delay,
    ),
    RESCAN_REMOVES: SettingDefinition(
        key=RESCAN_REMOVES,
        value_type=bool,
        default=True,
        group="Player selector",
        description=(
            "On a reader everybody scans in turn, holding a card against it again takes "
            "that singer off their slot. Off: a second scan does nothing."
        ),
    ),
    SELECTION_IDLE: SettingDefinition(
        key=SELECTION_IDLE,
        value_type=int,
        default=120,
        group="Player selector",
        description=(
            "How long a song may stand with its singers half picked before Wingman drops "
            "it and clears the screen."
        ),
        validate=_validate_idle,
    ),
}


def service(session: AsyncSession) -> SettingsService:
    return SettingsService(session, DEFINITIONS)


async def read_all(session: AsyncSession) -> dict[str, SettingValue]:
    """All four, one query — what a report reads before it diffs anything."""
    return await service(session).all()
