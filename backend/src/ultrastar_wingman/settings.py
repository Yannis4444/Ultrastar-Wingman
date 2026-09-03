"""DB-backed settings registry.

Definitions are code, values are data: adding a setting means adding one
`SettingDefinition` below — no schema change and (from phase 7 on) no UI code.
"""

import json
import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass

from sqlalchemy import String, Text, delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base

# The definitions live here, so a rule that only a domain module can state has to be
# imported here. `karaoke.slots` and `downloads.video_quality` are leaves on purpose — they
# must never import this module back, or the services that do close the circle.
from .downloads.video_quality import DEFAULT_VIDEO_FORMAT, validate_video_format
from .join_url import validate_join_url
from .karaoke.slots import DEFAULT_SLOT_COLORS_SETTING, validate_slot_colors

logger = logging.getLogger(__name__)

SettingValue = str | int | bool | float

# Beyond the type: raises `ValueError` when the value is of the right type but still
# unusable (a color list USDX could not be pointed at). Kept as a plain callable so a
# domain module owns its own rules and the registry stays domain-agnostic.
Validator = Callable[[SettingValue], None]


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
    # A setting a host does not touch on a normal setup — an override of something that is
    # derived correctly on its own, or a knob only a broken environment needs. The UI folds
    # these away inside their group instead of putting them in a group of their own: what
    # they belong to does not change, only how loudly they are shown.
    advanced: bool = False
    validate: Validator | None = None


class UnknownSettingError(LookupError):
    def __init__(self, key: str) -> None:
        super().__init__(f"unknown setting '{key}'")
        self.key = key


class SettingTypeError(TypeError):
    def __init__(self, key: str, expected: type[SettingValue], got: type[object]) -> None:
        super().__init__(f"setting '{key}' expects {expected.__name__}, got {got.__name__}")
        self.key = key


class SettingValueError(ValueError):
    """Right type, unusable value — the definition's own validator said no."""

    def __init__(self, key: str, reason: str) -> None:
        super().__init__(f"setting '{key}': {reason}")
        self.key = key
        self.reason = reason


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
        description=(
            "The folder Wingman scans for songs. Usually that is the one Ultrastar Deluxe "
            "already uses, but any folder works. Ultrastar Deluxe's own songs folder is the "
            "separate USDX → Songs directory setting."
        ),
    )
)
register(
    SettingDefinition(
        key="songs.additional_directories",
        value_type=str,
        default="",
        group="Songs",
        description="Further directories to scan for songs, one path per line.",
        advanced=True,
    )
)
register(
    SettingDefinition(
        key="karaoke.player_colors",
        value_type=str,
        default=DEFAULT_SLOT_COLORS_SETTING,
        group="Karaoke",
        description=(
            "The singing slots, as Ultrastar Deluxe color names separated by commas. How "
            "many there are is how many players sing at once: 1, 2, 3, 4, or 6. Those are "
            "the counts Ultrastar Deluxe plays on one screen."
        ),
        validate=validate_slot_colors,
    )
)
register(
    SettingDefinition(
        key="host.join_url",
        value_type=str,
        default="",
        group="Host",
        description=(
            "The address guests open on their phones, e.g. http://192.168.0.5:1234. It is "
            "what the QR code on the host screen encodes. Empty picks the machine's LAN "
            "address automatically. That is right unless a VPN or a second network card "
            "makes Wingman guess wrong."
        ),
        validate=validate_join_url,
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
            "directory, songs directory, and Ultrastar.db are derived from it unless "
            "overridden below."
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
        advanced=True,
    )
)
register(
    SettingDefinition(
        key="usdx.config_file",
        value_type=str,
        default="",
        group="USDX",
        description="Overrides the derived <base path>/config.ini (players, colors, avatars).",
        advanced=True,
    )
)
register(
    SettingDefinition(
        key="usdx.avatars_dir",
        value_type=str,
        default="",
        group="USDX",
        description=(
            "Overrides the derived <base path>/avatars. Ultrastar Deluxe reads avatars from here."
        ),
        advanced=True,
    )
)
register(
    SettingDefinition(
        key="usdx.songs_dir",
        value_type=str,
        default="",
        group="USDX",
        description=(
            "Overrides the derived <base path>/songs, Ultrastar Deluxe's own songs "
            "directory. A song Wingman starts has to be launched from inside it. Otherwise "
            "Ultrastar Deluxe loads the whole library next to it. This is not "
            "'songs.directory': that one only says where Wingman looks for songs."
        ),
        advanced=True,
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
            "the scores Ultrastar Deluxe wrote after a song."
        ),
        advanced=True,
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
register(
    SettingDefinition(
        key="usdb.base_url",
        value_type=str,
        default="https://usdb.animux.de",
        group="USDB",
        description="Base URL of the USDB instance. Every USDB request is built from it.",
        advanced=True,
    )
)
register(
    SettingDefinition(
        key="auth.oidc_enabled",
        value_type=bool,
        default=False,
        group="Auth",
        description=(
            "Offer login through an OIDC provider (Keycloak and friends) next to the local "
            "accounts. Needs the issuer and client id below."
        ),
    )
)
register(
    SettingDefinition(
        key="auth.oidc_issuer",
        value_type=str,
        default="",
        group="Auth",
        description=(
            "Issuer URL of the OIDC provider, e.g. https://keycloak.example/realms/party. "
            "Everything else is read from <issuer>/.well-known/openid-configuration."
        ),
    )
)
register(
    SettingDefinition(
        key="auth.oidc_client_id",
        value_type=str,
        default="",
        group="Auth",
        description="Client id Wingman is registered as at the provider.",
    )
)
register(
    SettingDefinition(
        key="auth.oidc_client_secret",
        value_type=str,
        default="",
        group="Auth",
        description=(
            "Client secret. Leave empty for a public client: Wingman always sends PKCE, "
            "which is what protects the code exchange."
        ),
        secret=True,
    )
)
register(
    SettingDefinition(
        key="auth.oidc_display_name",
        value_type=str,
        default="SSO",
        group="Auth",
        description="What the login button is called, e.g. the name of your company login.",
    )
)
register(
    SettingDefinition(
        key="auth.oidc_scopes",
        value_type=str,
        default="openid profile",
        group="Auth",
        description=(
            "Space-separated scopes requested at login. `openid` is required. The username "
            "is taken from `profile` and `email`."
        ),
        advanced=True,
    )
)
register(
    SettingDefinition(
        key="downloads.parallel",
        value_type=int,
        default=2,
        group="Downloads",
        description="How many songs are downloaded at the same time. Applied on restart.",
    )
)
register(
    SettingDefinition(
        key="downloads.ffmpeg",
        value_type=str,
        default="ffmpeg",
        group="Downloads",
        description=(
            "ffmpeg executable, used to extract the audio track from the video. The default "
            "means: the system's ffmpeg, or a copy Wingman downloads itself (Windows only)."
        ),
        advanced=True,
    )
)
register(
    SettingDefinition(
        key="downloads.video_format",
        value_type=str,
        default=DEFAULT_VIDEO_FORMAT,
        group="Downloads",
        # The presets and the string each one stands for are what the settings UI puts on
        # the screen; repeating them here would only be the same list twice.
        description=(
            "Which YouTube stream yt-dlp downloads, as a yt-dlp format string. A video is "
            "always downloaded: Ultrastar Deluxe plays it, and the mp3 is extracted from it."
        ),
        validate=validate_video_format,
    )
)
register(
    SettingDefinition(
        key="downloads.ytdlp_path",
        value_type=str,
        default="",
        group="Downloads",
        description=(
            "yt-dlp executable. Empty means Wingman downloads and updates its own copy "
            "in the data directory."
        ),
        advanced=True,
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

    async def stored_keys(self) -> set[str]:
        """Keys that have a stored value — the rest answer with their default."""
        return set(await self._session.scalars(select(Setting.key)))

    async def set(self, key: str, value: SettingValue) -> SettingValue:
        definition = self.definition(key)
        checked = self._check(definition, value)
        await self._session.merge(Setting(key=key, value=json.dumps(checked)))
        await self._session.commit()
        logger.info("setting '%s' updated", key)
        return checked

    async def reset(self, key: str) -> SettingValue:
        """Drop the stored value so the definition's default applies again."""
        definition = self.definition(key)
        await self._session.execute(delete(Setting).where(Setting.key == key))
        await self._session.commit()
        logger.info("setting '%s' reset to its default", key)
        return definition.default

    @staticmethod
    def _check(definition: SettingDefinition, value: object) -> SettingValue:
        checked: SettingValue
        # `type() is` on purpose: isinstance(True, int) is True, and a bool is not an int here.
        if type(value) is definition.value_type:
            checked = value
        elif definition.value_type is float and type(value) is int:
            checked = float(value)
        else:
            raise SettingTypeError(definition.key, definition.value_type, type(value))
        if definition.validate is not None:
            try:
                definition.validate(checked)
            except ValueError as error:
                raise SettingValueError(definition.key, str(error)) from error
        return checked

    def _decode(self, definition: SettingDefinition, raw: str) -> SettingValue:
        try:
            return self._check(definition, json.loads(raw))
        except (json.JSONDecodeError, SettingTypeError, SettingValueError):
            logger.warning(
                "stored value of '%s' does not match its definition, falling back to the default",
                definition.key,
            )
            return definition.default
