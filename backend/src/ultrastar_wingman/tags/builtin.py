"""The two built-in marks — Favorites and Sung — and the little about them a host may set.

They look like tags on a song row, but they are not tags: a tag is one global row saying
something about the *song*, while these two say something about the *reader* (the songs I
like, the songs I have sung). So there is no `tags` row, no name, no icon choice, no
permissions and no delete — only the colour the mark is drawn in and whether it belongs on
a song row at all, which is exactly what a tag's `color` and `show_in_list` are.

Where the two settings live: the `settings` table, through a `SettingsService` built on
the private `DEFINITIONS` below rather than on the registry's global one. That keeps them
out of `GET /settings` and out of `PATCH /settings/{key}` — the settings API only ever
sees the registered definitions — so the built-ins have exactly one door, the tags API,
and `tags.manage` is the only right that opens it. `settings.view` would be the wrong
gate anyway: it is an administrator's right, and the marks are drawn for every guest.

Reading is deliberately unguarded beyond `songs.view`: a phone that may see the song list
has to know what colour to paint the hearts.
"""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from ..events import TagsChanged, event_bus
from ..settings import SettingDefinition, SettingsService, SettingValue
from .model import TAG_COLORS
from .schema import BuiltInTagId, BuiltInTagRead

logger = logging.getLogger(__name__)

# In the order the admin list draws them, mirroring the marks' DOM order on a song row.
BUILT_IN_IDS: tuple[BuiltInTagId, ...] = ("favorites", "sung")

# What each one looks like until somebody says otherwise: the heart pink and the
# microphone blue, both on the song rows — the colours they had when they were hard-coded.
_DEFAULT_COLORS: dict[BuiltInTagId, str] = {"favorites": "pink", "sung": "blue"}


def _color_key(built_in_id: BuiltInTagId) -> str:
    return f"tags.built_in.{built_in_id}.color"


def _show_key(built_in_id: BuiltInTagId) -> str:
    return f"tags.built_in.{built_in_id}.show_in_list"


def _validate_color(value: SettingValue) -> None:
    """A hand-edited database is the only way past the API's own `TagColor`, and a colour
    the frontend has no class for would leave the mark in whatever it inherited."""
    if value not in TAG_COLORS:
        raise ValueError(f"unknown tag color '{value}'")


def _definitions() -> dict[str, SettingDefinition]:
    definitions: dict[str, SettingDefinition] = {}
    for built_in_id in BUILT_IN_IDS:
        name = built_in_id.capitalize()
        definitions[_color_key(built_in_id)] = SettingDefinition(
            key=_color_key(built_in_id),
            value_type=str,
            default=_DEFAULT_COLORS[built_in_id],
            group="Tags",
            description=f"The colour the {name} mark is drawn in.",
            validate=_validate_color,
        )
        definitions[_show_key(built_in_id)] = SettingDefinition(
            key=_show_key(built_in_id),
            value_type=bool,
            default=True,
            group="Tags",
            description=f"Whether the {name} mark goes on the song rows it applies to.",
        )
    return definitions


# Not `settings.register`-ed on purpose — see the module docstring. `group` and
# `description` are filled in all the same: they are part of a definition, and a reader of
# the settings table should be able to tell what a stored key was for.
DEFINITIONS: dict[str, SettingDefinition] = _definitions()


def _service(session: AsyncSession) -> SettingsService:
    return SettingsService(session, DEFINITIONS)


async def read_all(session: AsyncSession) -> list[BuiltInTagRead]:
    """Both built-ins, in `BUILT_IN_IDS` order. One query for the four values."""
    values = await _service(session).all()
    return [
        BuiltInTagRead(
            id=built_in_id,
            color=str(values[_color_key(built_in_id)]),
            show_in_list=bool(values[_show_key(built_in_id)]),
        )
        for built_in_id in BUILT_IN_IDS
    ]


async def read(session: AsyncSession, built_in_id: BuiltInTagId) -> BuiltInTagRead:
    service = _service(session)
    return BuiltInTagRead(
        id=built_in_id,
        color=str(await service.get(_color_key(built_in_id))),
        show_in_list=bool(await service.get(_show_key(built_in_id))),
    )


async def update(
    session: AsyncSession,
    built_in_id: BuiltInTagId,
    color: str | None = None,
    show_in_list: bool | None = None,
) -> BuiltInTagRead:
    """Change what the mark looks like. A PATCH that names neither field changes nothing
    and still answers with the current state — the same shape as an update that did.

    Broadcasts `tags.changed`, the event every client already listens to for a recoloured
    tag: a mark that just went off has to leave the open song lists too."""
    service = _service(session)
    if color is not None:
        await service.set(_color_key(built_in_id), color)
    if show_in_list is not None:
        await service.set(_show_key(built_in_id), show_in_list)
    if color is not None or show_in_list is not None:
        logger.info("built-in tag '%s' updated", built_in_id)
        await event_bus.broadcast(TagsChanged())
    return await read(session, built_in_id)
