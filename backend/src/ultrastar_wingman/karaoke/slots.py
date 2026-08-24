"""The singing positions Wingman offers: how many, and in which colors.

The host configures one ordered list of colors (`karaoke.player_colors`); its
length *is* the number of players, exactly like the old app's `SETUP/colors`.
Keeping it as one setting means the count and the colors can never disagree.

Two USDX facts this module exists to respect:
- `[Game] Players` is looked up in USDX's own `IPlayers` list
  (`'1','2','3','4','6','8','12'`). A value that is not in it silently falls back
  to *one* player, so a count of, say, 5 would quietly ruin the evening.
  8 and 12 need `Screens=2`, which Wingman does not configure — hence 1-6.
- The color of a slot is the 1-based index into `colors.COLORS`, so a name that
  is not in there has no meaning to USDX at all.
"""

from .colors import COLOR_NAMES

# The player counts USDX accepts on a single screen, from its `IPlayers`.
PLAYER_COUNTS: tuple[int, ...] = (1, 2, 3, 4, 6)

# USDX's own defaults: player n starts out on color n (`UIni.pas` reads
# `[PlayerColor] P<n>` with `n` as the fallback), four players like the old app.
DEFAULT_SLOT_COLORS: tuple[str, ...] = COLOR_NAMES[:4]

SEPARATOR = ","


class InvalidSlotColorsError(ValueError):
    """The configured color list is not something USDX could be pointed at."""


def parse_slot_colors(raw: str) -> list[str]:
    """The color names in `raw` (a comma-separated list), validated.

    Raises `InvalidSlotColorsError` for an unusable list: a count USDX does not
    know, an unknown color, or the same color twice (two slots of one color
    cannot be told apart — neither on the TV nor in the player selection).
    """
    names = [part.strip() for part in raw.split(SEPARATOR) if part.strip()]
    if len(names) not in PLAYER_COUNTS:
        allowed = ", ".join(str(count) for count in PLAYER_COUNTS[:-1])
        raise InvalidSlotColorsError(
            f"{len(names)} slot(s): Ultrastar Deluxe plays {allowed} or "
            f"{PLAYER_COUNTS[-1]} players on one screen"
        )
    unknown = [name for name in names if name not in COLOR_NAMES]
    if unknown:
        raise InvalidSlotColorsError(f"unknown color(s): {', '.join(unknown)}")
    if len(set(names)) != len(names):
        raise InvalidSlotColorsError("every player needs a color of their own")
    return names


def validate_slot_colors(value: object) -> None:
    """Settings-registry validator: keeps an unusable list out of the database.

    Takes `object` rather than the registry's `SettingValue` so this module stays
    free of the settings import — the registry imports *this* one.
    """
    parse_slot_colors(str(value))


def format_slot_colors(names: list[str] | tuple[str, ...]) -> str:
    """The stored form of a color list — the inverse of `parse_slot_colors`."""
    return SEPARATOR.join(names)


DEFAULT_SLOT_COLORS_SETTING = format_slot_colors(DEFAULT_SLOT_COLORS)
