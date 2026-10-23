"""The eight knobs the player selector has, and where they live.

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
START_WITHOUT_SELECTION = "devices.start_without_selection"
RANDOM_SCOPE = "devices.random_scope"
RANDOM_PLAYLIST = "devices.random_playlist"
CANCEL_WITHOUT_SELECTION = "devices.cancel_without_selection"

# What the start button does when nobody is picking anything. `nothing` is the default: a
# button that starts a song out of a quiet room is a surprise, and the host asks for it.
START_MODES: tuple[str, ...] = ("nothing", "top_wish", "random")

# What the cancel button does when nobody is picking anything. `skip_music` is the default,
# unlike the start button's: moving the background music on to its next song is what the
# room asked the button for, and it neither starts a song nor takes a microphone.
CANCEL_MODES: tuple[str, ...] = ("skip_music", "nothing")

# What `random` spins the reel over: the phone's scopes (`karaoke.schema.Scope`) minus
# `favorites`, which need an account and the button has none behind it.
RANDOM_SCOPES: tuple[str, ...] = ("all", "wishlist", "weighted", "playlist")

# A playlist id is a uuid4 in hex. Not checked against the table — a playlist may be
# deleted after it was chosen, and the press falls back to every song then — but bounded, so
# a stray paste cannot park a novel in a settings row.
MAX_PLAYLIST_ID_LENGTH = 64

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


def _validate_start_mode(value: SettingValue) -> None:
    if not isinstance(value, str) or value not in START_MODES:
        raise ValueError(f"one of {', '.join(START_MODES)}")


def _validate_cancel_mode(value: SettingValue) -> None:
    if not isinstance(value, str) or value not in CANCEL_MODES:
        raise ValueError(f"one of {', '.join(CANCEL_MODES)}")


def _validate_idle(value: SettingValue) -> None:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError("a whole number of seconds")
    if value < MIN_SELECTION_IDLE or value > MAX_SELECTION_IDLE:
        raise ValueError(f"between {MIN_SELECTION_IDLE} and {MAX_SELECTION_IDLE} seconds")


def _validate_random_scope(value: SettingValue) -> None:
    if not isinstance(value, str) or value not in RANDOM_SCOPES:
        raise ValueError(f"one of {', '.join(RANDOM_SCOPES)}")


def _validate_playlist(value: SettingValue) -> None:
    if not isinstance(value, str):
        raise ValueError("a playlist id, or nothing")
    if len(value) > MAX_PLAYLIST_ID_LENGTH:
        raise ValueError(f"at most {MAX_PLAYLIST_ID_LENGTH} characters")


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
    START_WITHOUT_SELECTION: SettingDefinition(
        key=START_WITHOUT_SELECTION,
        value_type=str,
        default="nothing",
        group="Player selector",
        description=(
            "What the start button does while nobody is picking singers. Off: nothing at "
            "all. It can also sing the most wished for song, or a song at random, with "
            "the cards lying on the readers on the slots."
        ),
        validate=_validate_start_mode,
    ),
    RANDOM_SCOPE: SettingDefinition(
        key=RANDOM_SCOPE,
        value_type=str,
        default="all",
        group="Player selector",
        description=(
            "What the start button spins the reel over when it starts a random song: every "
            "song, the wishlist (each song once, or as often as it was wished for), or one "
            "playlist."
        ),
        validate=_validate_random_scope,
    ),
    RANDOM_PLAYLIST: SettingDefinition(
        key=RANDOM_PLAYLIST,
        value_type=str,
        default="",
        group="Player selector",
        description=(
            "The playlist the start button picks from, when it picks from one. A playlist "
            "that has since been deleted falls back to every song."
        ),
        validate=_validate_playlist,
    ),
    CANCEL_WITHOUT_SELECTION: SettingDefinition(
        key=CANCEL_WITHOUT_SELECTION,
        value_type=str,
        default="skip_music",
        group="Player selector",
        description=(
            "What the cancel button does while nobody is picking singers: skip the "
            "background music to its next song, or nothing at all."
        ),
        validate=_validate_cancel_mode,
    ),
}


def service(session: AsyncSession) -> SettingsService:
    return SettingsService(session, DEFINITIONS)


async def read_all(session: AsyncSession) -> dict[str, SettingValue]:
    """All eight, one query — what a report reads before it diffs anything."""
    return await service(session).all()
