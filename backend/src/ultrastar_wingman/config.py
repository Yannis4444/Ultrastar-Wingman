"""Bootstrap configuration.

Only what is needed *before* the database exists lives here (paths, bind
address). Every other setting belongs in the DB-backed settings registry
(`settings.py`) so it can be changed at runtime from the settings UI.
"""

import sys
from functools import lru_cache
from pathlib import Path

from platformdirs import user_data_path
from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from . import APP_NAME
from .console import LogLevel

# The folder beside the frozen executable that a build bringing its own Ultrastar Deluxe
# puts it in, and the file that has to be in there for the folder to count.
BUNDLED_USDX_FOLDER = "usdx"
USDX_EXECUTABLE = "ultrastardx.exe"


def default_data_dir() -> Path:
    return user_data_path(APP_NAME, appauthor=False)


def bundled_usdx_dir() -> Path | None:
    """The Ultrastar Deluxe a frozen build carries next to itself, or `None`.

    Only when frozen (PyInstaller sets `sys.frozen`): a checkout that happens to hold a
    `usdx` folder next to the interpreter is not a build that brings one. And only when the
    program is actually in there, so a stray empty folder does not switch the settings off.
    """
    if not getattr(sys, "frozen", False):
        return None
    candidate = Path(sys.executable).parent / BUNDLED_USDX_FOLDER
    return candidate if (candidate / USDX_EXECUTABLE).is_file() else None


class BootstrapSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WINGMAN_", env_file=".env", extra="ignore")

    data_dir: Path = Field(default_factory=default_data_dir)
    host: str = "0.0.0.0"
    port: int = 8080
    # Open the host UI (the TV browser next to USDX) on startup. That URL carries the
    # one-time token that makes the browser a trusted admin, so opening it ourselves is how
    # host trust is established — set WINGMAN_OPEN_BROWSER=false for a headless server.
    open_browser: bool = True
    # Where the built frontend lives. Unset: the PyInstaller bundle when frozen, else the
    # repo's frontend/dist — see `frontend.resolve_frontend_dir`.
    frontend_dir: Path | None = None
    # The Ultrastar Deluxe this Wingman brings along. Set — by `--usdx-dir`, this variable,
    # or a frozen build finding one next to itself — every USDX path is derived from it and
    # the `usdx.*` settings are out of the picture (`karaoke.usdx_paths`).
    usdx_dir: Path | None = None
    # How much the console window says (`console.py`). `debug` is the developer's view: the
    # logger of every line, and uvicorn's line per request.
    log_level: LogLevel = "info"

    @model_validator(mode="before")
    @classmethod
    def _find_bundled_usdx(cls, data: object) -> object:
        # Only when nobody said anything: an explicit value wins, and an explicitly empty
        # one (`WINGMAN_USDX_DIR=`) is how a frozen build is told to ignore its own copy.
        if isinstance(data, dict) and "usdx_dir" not in data:
            return {**data, "usdx_dir": bundled_usdx_dir()}
        return data

    @field_validator("log_level", mode="before")
    @classmethod
    def _any_case(cls, value: object) -> object:
        # `WINGMAN_LOG_LEVEL=DEBUG` is how most people spell it.
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("usdx_dir", mode="before")
    @classmethod
    def _blank_is_none(cls, value: object) -> object:
        # Pydantic turns "" into Path("."), the working directory, which nobody meant.
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("usdx_dir")
    @classmethod
    def _absolute(cls, value: Path | None) -> Path | None:
        # Every derived path is absolute (`UsdxPaths`), and a relative one would follow
        # whatever the working directory happens to be when USDX is started.
        return None if value is None else value.expanduser().absolute()

    @property
    def database_path(self) -> Path:
        return self.data_dir / "wingman.db"

    @property
    def database_url(self) -> str:
        # as_posix(): a Windows path with backslashes is not a valid URL.
        return f"sqlite+aiosqlite:///{self.database_path.as_posix()}"


@lru_cache
def get_bootstrap_settings() -> BootstrapSettings:
    return BootstrapSettings()
