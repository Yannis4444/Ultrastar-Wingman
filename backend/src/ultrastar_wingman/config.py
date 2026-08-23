"""Bootstrap configuration.

Only what is needed *before* the database exists lives here (paths, bind
address). Every other setting belongs in the DB-backed settings registry
(`settings.py`) so it can be changed at runtime from the settings UI.
"""

from functools import lru_cache
from pathlib import Path

from platformdirs import user_data_path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from . import APP_NAME


def default_data_dir() -> Path:
    return user_data_path(APP_NAME, appauthor=False)


class BootstrapSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="WINGMAN_", env_file=".env", extra="ignore")

    data_dir: Path = Field(default_factory=default_data_dir)
    host: str = "0.0.0.0"
    port: int = 8080
    # Open the host UI (the TV browser next to USDX) on startup. That URL carries the
    # one-time token that makes the browser a trusted admin, so opening it ourselves is how
    # host trust is established — set WINGMAN_OPEN_BROWSER=false for a headless server.
    open_browser: bool = True

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
