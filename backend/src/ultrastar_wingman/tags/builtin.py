"""The eight built-ins — the two marks and the six facets — and what a host may set.

They look like tags in the admin list and on a song row, but they are not tags. A tag is
one global row somebody wrote to say something about a song; these are what the app
already knows:

* the two **marks**, *Favorites* and *Sung*, which say something about the *reader* (the
  songs I like, the songs I have sung);
* the two **boolean facets**, *Duet* and *Video*, and the four **valued** ones, *Genre*,
  *Language*, *Edition* and *Decade*, which say something the song file already carries.

So there is no `tags` row, no name, no icon choice, no permissions and no delete — only
the handful of options its kind allows, which are exactly a tag's `color` and
`show_in_list` plus "does the Filter panel offer it".

There is no SQL here and no values endpoint. A facet filters *client-side*, over the song
list the reader already has: `SongRead` carries `is_duet`, `has_video`, `genre`,
`language`, `edition` and `year`, so the panel can build a facet's value list out of the
songs the reader may see — which is also the only correct list, a value nothing visible
carries being a value nothing would match.

Where the options live: the `settings` table, through a `SettingsService` built on the
private `DEFINITIONS` below rather than on the registry's global one. That keeps them out
of `GET /settings` and out of `PATCH /settings/{key}` — the settings API only ever sees
the registered definitions — so the built-ins have exactly one door, the tags API, and
`tags.manage` is the only right that opens it. `settings.view` would be the wrong gate
anyway: it is an administrator's right, and the marks are drawn for every guest.

Reading is deliberately unguarded beyond `songs.view`: a phone that may see the song list
has to know what colour to paint the hearts and which facets to offer.
"""

import logging
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from ..events import TagsChanged, event_bus
from ..settings import SettingDefinition, SettingsService, SettingValue
from .model import TAG_COLORS
from .schema import BuiltInTagId, BuiltInTagKind, BuiltInTagRead

logger = logging.getLogger(__name__)

# The three options a built-in can have. Spelled out as constants because they are three
# things at once: a field of `BuiltInTagRead`, a key in the `settings` table, and the name
# a `PATCH` body uses.
COLOR = "color"
SHOW_IN_LIST = "show_in_list"
SHOW_IN_FILTER = "show_in_filter"

# Which options each kind has, per ui-guidelines §7. This is the one place that knows:
# `DEFINITIONS` grows a settings key per (built-in, option) pair from it, the read builds
# its nulls from it, and a `PATCH` naming an option the kind lacks is refused by it.
KIND_OPTIONS: dict[BuiltInTagKind, tuple[str, ...]] = {
    "mark": (COLOR, SHOW_IN_LIST),
    "boolean": (COLOR, SHOW_IN_LIST, SHOW_IN_FILTER),
    "valued": (SHOW_IN_FILTER,),
}


@dataclass(frozen=True)
class BuiltIn:
    """One built-in: what kind it is, and what it looks like until somebody says
    otherwise. `defaults` holds exactly the options `KIND_OPTIONS[kind]` names — a test
    pins that, so a default for an option the kind has not got cannot go unnoticed."""

    id: BuiltInTagId
    kind: BuiltInTagKind
    # A human name for the settings rows, so a reader of the `settings` table can tell
    # what a stored key was for. The UI has its own copy — the name is the app's word.
    name: str
    defaults: dict[str, SettingValue]

    @property
    def options(self) -> tuple[str, ...]:
        return KIND_OPTIONS[self.kind]


# In the order §7's *Built-in* section draws them: the two marks, then the boolean facets,
# then the valued ones. The marks keep the pink heart and the blue microphone they had
# when they were hard-coded, both on the song rows. The two boolean facets are neutral and
# **off** the rows — a duet or a video is not rare enough to mark every second song with
# (§1.3) — but on in the filter, which is what they are for; a valued facet has the filter
# alone, and is on there too.
BUILT_INS: tuple[BuiltIn, ...] = (
    BuiltIn(
        id="favorites",
        kind="mark",
        name="Favorites",
        defaults={COLOR: "pink", SHOW_IN_LIST: True},
    ),
    BuiltIn(id="sung", kind="mark", name="Sung", defaults={COLOR: "blue", SHOW_IN_LIST: True}),
    BuiltIn(
        id="duet",
        kind="boolean",
        name="Duet",
        defaults={COLOR: "neutral", SHOW_IN_LIST: False, SHOW_IN_FILTER: True},
    ),
    BuiltIn(
        id="video",
        kind="boolean",
        name="Video",
        defaults={COLOR: "neutral", SHOW_IN_LIST: False, SHOW_IN_FILTER: True},
    ),
    BuiltIn(id="genre", kind="valued", name="Genre", defaults={SHOW_IN_FILTER: True}),
    BuiltIn(id="language", kind="valued", name="Language", defaults={SHOW_IN_FILTER: True}),
    BuiltIn(id="edition", kind="valued", name="Edition", defaults={SHOW_IN_FILTER: True}),
    BuiltIn(id="decade", kind="valued", name="Decade", defaults={SHOW_IN_FILTER: True}),
)

BY_ID: dict[str, BuiltIn] = {built_in.id: built_in for built_in in BUILT_INS}


class UnknownOptionError(ValueError):
    """The `PATCH` named an option this built-in's kind has not got — a colour on a valued
    facet, `show_in_filter` on a mark."""

    def __init__(self, built_in_id: str, option: str) -> None:
        super().__init__(f"'{built_in_id}' has no option '{option}'")
        self.built_in_id = built_in_id
        self.option = option


def _key(built_in_id: str, option: str) -> str:
    return f"tags.built_in.{built_in_id}.{option}"


def _validate_color(value: SettingValue) -> None:
    """A hand-edited database is the only way past the API's own `TagColor`, and a colour
    the frontend has no class for would leave the mark in whatever it inherited."""
    if value not in TAG_COLORS:
        raise ValueError(f"unknown tag color '{value}'")


# What each option is, once, for every built-in that has it.
_DESCRIPTIONS: dict[str, str] = {
    COLOR: "The color {name} is drawn in.",
    SHOW_IN_LIST: "Whether the {name} mark goes on the song rows it applies to.",
    SHOW_IN_FILTER: "Whether the Filter panel offers {name} as a row.",
}


def _definitions() -> dict[str, SettingDefinition]:
    definitions: dict[str, SettingDefinition] = {}
    for built_in in BUILT_INS:
        for option in built_in.options:
            default = built_in.defaults[option]
            definitions[_key(built_in.id, option)] = SettingDefinition(
                key=_key(built_in.id, option),
                value_type=str if option == COLOR else bool,
                default=default,
                group="Tags",
                description=_DESCRIPTIONS[option].format(name=built_in.name),
                validate=_validate_color if option == COLOR else None,
            )
    return definitions


# Not `settings.register`-ed on purpose — see the module docstring. `group` and
# `description` are filled in all the same: they are part of a definition, and a reader of
# the settings table should be able to tell what a stored key was for.
DEFINITIONS: dict[str, SettingDefinition] = _definitions()


def _service(session: AsyncSession) -> SettingsService:
    return SettingsService(session, DEFINITIONS)


def _read(built_in: BuiltIn, values: dict[str, SettingValue]) -> BuiltInTagRead:
    """One row out of the stored values. An option the kind has not got is null — the
    client tells "off" from "not a thing here" without a second table."""

    def color() -> str | None:
        return None if COLOR not in built_in.options else str(values[_key(built_in.id, COLOR)])

    def flag(option: str) -> bool | None:
        if option not in built_in.options:
            return None
        return bool(values[_key(built_in.id, option)])

    return BuiltInTagRead(
        id=built_in.id,
        kind=built_in.kind,
        color=color(),
        show_in_list=flag(SHOW_IN_LIST),
        show_in_filter=flag(SHOW_IN_FILTER),
    )


async def read_all(session: AsyncSession) -> list[BuiltInTagRead]:
    """All eight, in `BUILT_INS` order. One query for every value."""
    values = await _service(session).all()
    return [_read(built_in, values) for built_in in BUILT_INS]


async def read(session: AsyncSession, built_in_id: BuiltInTagId) -> BuiltInTagRead:
    return _read(BY_ID[built_in_id], await _service(session).all())


async def update(
    session: AsyncSession, built_in_id: BuiltInTagId, options: dict[str, SettingValue]
) -> BuiltInTagRead:
    """Change what a built-in looks like, or where it is offered. `options` holds only the
    fields the request actually named, so a PATCH that names none changes nothing and
    still answers with the current state — the same shape as an update that did.

    Raises `UnknownOptionError` for an option this kind has not got: a colour on *Genre*
    is a request the backend cannot honour, and storing it silently would look like it had.

    Broadcasts `tags.changed`, the event every client already listens to for a recoloured
    tag: a mark that just went off has to leave the open song lists too."""
    built_in = BY_ID[built_in_id]
    for option in options:
        if option not in built_in.options:
            raise UnknownOptionError(built_in_id, option)
    if options:
        service = _service(session)
        for option, value in options.items():
            await service.set(_key(built_in_id, option), value)
        logger.info("built-in tag '%s' updated", built_in_id)
        await event_bus.broadcast(TagsChanged())
    return await read(session, built_in_id)
