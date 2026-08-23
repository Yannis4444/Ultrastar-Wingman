"""The player colors, in USDX's own order.

Single source of truth: the 1-based position in this tuple *is* the value USDX
expects in `[PlayerColor]`, and the frontend fetches the hex values from
`GET /karaoke/colors` instead of duplicating them (the old app hardcoded the
names in the backend and the hex codes in the frontend, and they drifted).
"""

from pydantic import BaseModel


class Color(BaseModel):
    name: str
    hex: str


class ColorList(BaseModel):
    colors: list[Color]


COLORS: tuple[Color, ...] = (
    Color(name="blue", hex="#048BB9"),
    Color(name="red", hex="#D00000"),
    Color(name="green", hex="#00AC00"),
    Color(name="yellow", hex="#E7E700"),
    Color(name="orange", hex="#E77300"),
    Color(name="pink", hex="#E764A3"),
    Color(name="violet", hex="#9F00BE"),
    Color(name="brown", hex="#C5951D"),
    Color(name="gray", hex="#888888"),
    Color(name="dark_blue", hex="#0000C7"),
    Color(name="sky", hex="#0064BE"),
    Color(name="cyan", hex="#00C3C3"),
    Color(name="flame", hex="#BE3F00"),
    Color(name="orchid", hex="#BE00BE"),
    Color(name="harlequin", hex="#64BE00"),
    Color(name="green_yellow", hex="#91BE00"),
)

COLOR_NAMES: tuple[str, ...] = tuple(color.name for color in COLORS)


class UnknownColorError(ValueError):
    def __init__(self, name: str) -> None:
        super().__init__(f"unknown color '{name}'")
        self.name = name


def color_index(name: str) -> int:
    """The 1-based index USDX stores in `[PlayerColor]`. Raises `UnknownColorError`."""
    try:
        return COLOR_NAMES.index(name) + 1
    except ValueError as error:
        raise UnknownColorError(name) from error
