"""The five knobs the background music has, and where they live.

Module-private definitions read through a `SettingsService` built on them, the
`devices/settings.py` pattern and for both of its reasons. `settings.manage` is the wrong
gate: switching the music on and choosing what it plays belongs to whoever runs the party,
and `music.manage` opens the player's own panel. And the values have to reach a reader who
holds no `settings.view` at all — a guest phone draws the player — so `scope` rides along on
`GET /music`, which `music.view` opens.

The volumes are deliberately *not* here. They are ordinary registered settings in
`sound.py`, because they are about every sound Wingman makes rather than about the music,
and the Settings page draws them with no code of its own.

Storage is the ordinary `settings` table, so a value survives a restart.
"""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from ..settings import SettingDefinition, SettingsService, SettingValue

logger = logging.getLogger(__name__)

ENABLED = "music.enabled"
SCOPE = "music.scope"
PLAYLIST = "music.playlist"
RESUME_DELAY = "music.resume_delay_s"
PREVIEW_ON_SPIN = "music.preview_on_spin"

# What the music may pick from: the reel's scopes (`karaoke.schema.Scope`) minus
# `favorites`, which needs an account and the room's soundtrack has none behind it.
#
# The same four as `devices.settings.RANDOM_SCOPES`, declared again rather than imported:
# the two are free to diverge — one is a button press, the other is an evening — and
# importing `devices` from here is a coupling neither module needs.
MUSIC_SCOPES: tuple[str, ...] = ("all", "wishlist", "weighted", "playlist")

# A playlist id is a uuid4 in hex. Bounded so a stray paste cannot park a novel in a
# settings row. Unlike the selector's, a playlist that has since been deleted does *not*
# fall back to every song: see `service._pick`.
MAX_PLAYLIST_ID_LENGTH = 64

# How long the room stays quiet after a song. Nothing at the bottom, because a host may
# want the music straight back; two minutes at the top, because a longer silence is the
# music switched off rather than a pause.
MAX_RESUME_DELAY = 120


def _validate_scope(value: SettingValue) -> None:
    if not isinstance(value, str) or value not in MUSIC_SCOPES:
        raise ValueError(f"one of {', '.join(MUSIC_SCOPES)}")


def _validate_playlist(value: SettingValue) -> None:
    if not isinstance(value, str):
        raise ValueError("a playlist id, or nothing")
    if len(value) > MAX_PLAYLIST_ID_LENGTH:
        raise ValueError(f"at most {MAX_PLAYLIST_ID_LENGTH} characters")


def _validate_resume_delay(value: SettingValue) -> None:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError("a whole number of seconds")
    if value < 0 or value > MAX_RESUME_DELAY:
        raise ValueError(f"between 0 and {MAX_RESUME_DELAY} seconds")


# Not `settings.register`-ed on purpose, see the module docstring. `group` and `description`
# are filled in all the same: they are part of a definition.
DEFINITIONS: dict[str, SettingDefinition] = {
    ENABLED: SettingDefinition(
        key=ENABLED,
        value_type=bool,
        default=False,
        group="Background music",
        description=(
            "Play songs from the library while nobody is singing. The sound comes out of "
            "the host screen, so that page has to be open."
        ),
    ),
    SCOPE: SettingDefinition(
        key=SCOPE,
        value_type=str,
        default="all",
        group="Background music",
        description=(
            "What the music picks from: every song, the wishlist (each song once, or as "
            "often as it was wished for), or one playlist."
        ),
        validate=_validate_scope,
    ),
    PLAYLIST: SettingDefinition(
        key=PLAYLIST,
        value_type=str,
        default="",
        group="Background music",
        description=(
            "The playlist the music plays, when it plays from one. A playlist that has "
            "since been deleted leaves the music with nothing to play."
        ),
        validate=_validate_playlist,
    ),
    RESUME_DELAY: SettingDefinition(
        key=RESUME_DELAY,
        value_type=int,
        default=10,
        group="Background music",
        description=(
            "How long the room stays quiet after a song before the music comes back. The "
            "scores and any new badges are read in that gap."
        ),
        validate=_validate_resume_delay,
    ),
    PREVIEW_ON_SPIN: SettingDefinition(
        key=PREVIEW_ON_SPIN,
        value_type=bool,
        default=True,
        group="Background music",
        description=(
            "Play the song the reel on the host screen lands on, from where its singing "
            "starts, until somebody presses Play or gives the pick up. The background music "
            "pauses for it. Works whether or not the background music is on."
        ),
    ),
}


def service(session: AsyncSession) -> SettingsService:
    return SettingsService(session, DEFINITIONS)


async def read_all(session: AsyncSession) -> dict[str, SettingValue]:
    """All five, one query — what the service caches and reads on every tick."""
    return await service(session).all()
