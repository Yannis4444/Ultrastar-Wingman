"""Rewriting USDX's `config.ini` — the only way to tell USDX who is singing.

Blocking file I/O throughout: the launcher calls this from a worker thread.

Constraints this code exists for:
- USDX writes the file with a BOM and with `Key=Value` (no spaces around `=`),
  and it is case-sensitive about its keys — so `RawConfigParser` with
  `optionxform = str`, read as utf-8-sig, written without spaces.
- `[PlayerAvatar]` holds the *MD5 of the image file's content*, not a path, and
  USDX only finds the image if it sits in its own avatars directory.
- The old app replaced values with a regex, which silently did nothing when a
  key or section was missing. This one adds them.
"""

import configparser
import hashlib
import logging
import shutil
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

BACKUP_SUFFIX = ".wingman-backup"

# Only ever backed up once — after the first rewrite the file is no longer the user's own.
_backed_up: set[Path] = set()


@dataclass(frozen=True)
class ConfiguredPlayer:
    """One `P<n>` entry in USDX's config: the name it shows and scores under."""

    name: str
    color_index: int
    avatar_file: Path | None


def write_player_config(
    config_file: Path, avatars_dir: Path, players: list[ConfiguredPlayer]
) -> None:
    """Point USDX at `players` (in order, P1..Pn) and force full screen."""
    _back_up_once(config_file)
    parser = configparser.RawConfigParser()
    # USDX keys are CamelCase and it does not recognise the lowercased defaults.
    parser.optionxform = str  # type: ignore[method-assign,assignment]
    if config_file.is_file():
        # utf-8-sig: a BOM would otherwise end up inside the first section name.
        parser.read(config_file, encoding="utf-8-sig")

    _set(parser, "Game", "Players", str(len(players)))
    _set(parser, "Graphics", "FullScreen", "On")
    for number, player in enumerate(players, start=1):
        _set(parser, "Name", f"P{number}", player.name)
        _set(parser, "PlayerColor", f"P{number}", str(player.color_index))
        avatar = _place_avatar(player.avatar_file, avatars_dir)
        if avatar is not None:
            _set(parser, "PlayerAvatar", f"P{number}", _md5(avatar))
        elif parser.has_section("PlayerAvatar"):
            # We rewrite the same file every song: left in place, this slot would keep
            # showing the avatar of whoever sang on it last.
            parser.remove_option("PlayerAvatar", f"P{number}")

    config_file.parent.mkdir(parents=True, exist_ok=True)
    # utf-8-sig on the way out too: USDX writes the BOM itself, so keeping it is the state
    # its own ini reader is known to cope with.
    with config_file.open("w", encoding="utf-8-sig") as file:
        parser.write(file, space_around_delimiters=False)
    logger.debug("wrote %d player(s) to %s", len(players), config_file)


def _set(parser: configparser.RawConfigParser, section: str, key: str, value: str) -> None:
    if not parser.has_section(section):
        parser.add_section(section)
    parser.set(section, key, value)


def _back_up_once(config_file: Path) -> None:
    """Keep the untouched original around: we rewrite the user's USDX config."""
    backup = config_file.with_name(config_file.name + BACKUP_SUFFIX)
    if config_file in _backed_up or not config_file.is_file():
        return
    _backed_up.add(config_file)
    if backup.exists():
        return
    shutil.copy2(config_file, backup)
    logger.info("Kept a copy of the Ultrastar Deluxe settings as they were: %s", backup)


def _place_avatar(avatar_file: Path | None, avatars_dir: Path) -> Path | None:
    """Copy the avatar into USDX's avatars dir (it only looks there). None when the
    player has no avatar or the file vanished."""
    if avatar_file is None or not avatar_file.is_file():
        return None
    avatars_dir.mkdir(parents=True, exist_ok=True)
    destination = avatars_dir / avatar_file.name
    if destination != avatar_file:
        shutil.copy2(avatar_file, destination)
    return destination


def _md5(path: Path) -> str:
    """USDX matches avatars by the uppercase hex MD5 of the file's content."""
    return hashlib.md5(path.read_bytes(), usedforsecurity=False).hexdigest().upper()
