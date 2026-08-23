"""DB-backed settings registry.

Definitions are code, values are data: adding a setting means adding one
`SettingDefinition` below — no schema change and (from phase 7 on) no UI code.
"""

import json
import logging
from collections.abc import Mapping
from dataclasses import dataclass

from sqlalchemy import String, Text, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base

logger = logging.getLogger(__name__)

SettingValue = str | int | bool | float


class Setting(Base):
    """Stored value of a registered setting, JSON-encoded to stay type-agnostic."""

    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


@dataclass(frozen=True)
class SettingDefinition:
    key: str
    value_type: type[SettingValue]
    default: SettingValue
    group: str
    description: str
    secret: bool = False


class UnknownSettingError(LookupError):
    def __init__(self, key: str) -> None:
        super().__init__(f"unknown setting '{key}'")
        self.key = key


class SettingTypeError(TypeError):
    def __init__(self, key: str, expected: type[SettingValue], got: type[object]) -> None:
        super().__init__(f"setting '{key}' expects {expected.__name__}, got {got.__name__}")
        self.key = key


DEFINITIONS: dict[str, SettingDefinition] = {}


def register(definition: SettingDefinition) -> SettingDefinition:
    if definition.key in DEFINITIONS:
        raise ValueError(f"setting '{definition.key}' is already registered")
    DEFINITIONS[definition.key] = definition
    return definition


register(
    SettingDefinition(
        key="usdb.username",
        value_type=str,
        default="",
        group="USDB",
        description="Account used to search and download songs from usdb.animux.de.",
    )
)
register(
    SettingDefinition(
        key="songs.directory",
        value_type=str,
        default="",
        group="Songs",
        description="The Ultrastar Deluxe songs directory Wingman scans for songs.",
    )
)
register(
    SettingDefinition(
        key="songs.additional_directories",
        value_type=str,
        default="",
        group="Songs",
        description="Further directories to scan for songs, one path per line.",
    )
)
register(
    SettingDefinition(
        key="usdx.base_path",
        value_type=str,
        default="",
        group="USDX",
        description=(
            "Ultrastar Deluxe installation directory. The executable, config.ini, avatars "
            "directory and Ultrastar.db are derived from it unless overridden below."
        ),
    )
)
register(
    SettingDefinition(
        key="usdx.executable",
        value_type=str,
        default="",
        group="USDX",
        description="Overrides the derived <base path>/ultrastardx.exe.",
    )
)
register(
    SettingDefinition(
        key="usdx.config_file",
        value_type=str,
        default="",
        group="USDX",
        description="Overrides the derived <base path>/config.ini (players, colors, avatars).",
    )
)
register(
    SettingDefinition(
        key="usdx.avatars_dir",
        value_type=str,
        default="",
        group="USDX",
        description="Overrides the derived <base path>/avatars (USDX reads avatars from here).",
    )
)
register(
    SettingDefinition(
        key="usdx.ultrastar_db",
        value_type=str,
        default="",
        group="USDX",
        description=(
            "Overrides the derived <base path>/Ultrastar.db. Wingman only reads it, to import "
            "the scores USDX wrote after a song."
        ),
    )
)
register(
    SettingDefinition(
        key="usdb.password",
        value_type=str,
        default="",
        group="USDB",
        description="Password of the usdb.animux.de account.",
        secret=True,
    )
)


class SettingsService:
    """Typed access to setting values. Unknown keys and wrong types raise."""

    def __init__(
        self,
        session: AsyncSession,
        definitions: Mapping[str, SettingDefinition] | None = None,
    ) -> None:
        self._session = session
        self._definitions = DEFINITIONS if definitions is None else definitions

    @property
    def definitions(self) -> Mapping[str, SettingDefinition]:
        return self._definitions

    def definition(self, key: str) -> SettingDefinition:
        definition = self._definitions.get(key)
        if definition is None:
            raise UnknownSettingError(key)
        return definition

    async def get(self, key: str) -> SettingValue:
        definition = self.definition(key)
        row = await self._session.get(Setting, key)
        return definition.default if row is None else self._decode(definition, row.value)

    async def all(self) -> dict[str, SettingValue]:
        stored = {row.key: row.value for row in (await self._session.scalars(select(Setting)))}
        return {
            key: self._decode(definition, stored[key]) if key in stored else definition.default
            for key, definition in self._definitions.items()
        }

    async def set(self, key: str, value: SettingValue) -> SettingValue:
        definition = self.definition(key)
        checked = self._check(definition, value)
        await self._session.merge(Setting(key=key, value=json.dumps(checked)))
        await self._session.commit()
        logger.info("setting '%s' updated", key)
        return checked

    @staticmethod
    def _check(definition: SettingDefinition, value: object) -> SettingValue:
        # `type() is` on purpose: isinstance(True, int) is True, and a bool is not an int here.
        if type(value) is definition.value_type:
            return value
        if definition.value_type is float and type(value) is int:
            return float(value)
        raise SettingTypeError(definition.key, definition.value_type, type(value))

    def _decode(self, definition: SettingDefinition, raw: str) -> SettingValue:
        try:
            return self._check(definition, json.loads(raw))
        except (json.JSONDecodeError, SettingTypeError):
            logger.warning(
                "stored value of '%s' does not match its definition, falling back to the default",
                definition.key,
            )
            return definition.default
