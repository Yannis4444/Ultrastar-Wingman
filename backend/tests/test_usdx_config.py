"""USDX config rewriting. No USDX involved — just the ini file it reads."""

import configparser
import hashlib
from pathlib import Path

import pytest

from ultrastar_wingman.karaoke.usdx_config import (
    BACKUP_SUFFIX,
    ConfiguredPlayer,
    write_player_config,
)

# chr(0xFEFF): a byte order mark, which is what USDX writes at the start of its config.
BOM = chr(0xFEFF)

# What USDX leaves behind: a BOM, CamelCase keys, no spaces around the delimiter.
EXISTING_CONFIG = (
    BOM + "[Game]\n"
    "Players=2\n"
    "Difficulty=1\n"
    "Tabs=Off\n"
    "\n"
    "[Graphics]\n"
    "Resolution=1920x1080\n"
    "FullScreen=Off\n"
)


def read_config(path: Path) -> configparser.RawConfigParser:
    parser = configparser.RawConfigParser()
    parser.optionxform = str  # type: ignore[method-assign,assignment]
    parser.read(path, encoding="utf-8-sig")
    return parser


@pytest.fixture
def config_file(tmp_path: Path) -> Path:
    path = tmp_path / "config.ini"
    path.write_text(EXISTING_CONFIG, encoding="utf-8")
    return path


@pytest.fixture
def avatars_dir(tmp_path: Path) -> Path:
    return tmp_path / "avatars"


def test_missing_sections_and_keys_are_added(config_file: Path, avatars_dir: Path) -> None:
    write_player_config(
        config_file,
        avatars_dir,
        [
            ConfiguredPlayer(name="Yannis", color_index=1, avatar_file=None),
            ConfiguredPlayer(name="Alex", color_index=3, avatar_file=None),
        ],
    )

    config = read_config(config_file)
    # The old app only replaced what was already there, so a fresh config got no players.
    assert config["Name"]["P1"] == "Yannis"
    assert config["Name"]["P2"] == "Alex"
    assert config["PlayerColor"]["P1"] == "1"
    assert config["PlayerColor"]["P2"] == "3"
    assert config["Game"]["Players"] == "2"
    assert config["Graphics"]["FullScreen"] == "On"


def test_unrelated_keys_survive_with_their_casing(config_file: Path, avatars_dir: Path) -> None:
    write_player_config(
        config_file, avatars_dir, [ConfiguredPlayer(name="Yannis", color_index=1, avatar_file=None)]
    )

    written = config_file.read_text(encoding="utf-8")
    assert "Difficulty=1" in written
    assert "Tabs=Off" in written
    assert "Resolution=1920x1080" in written
    # USDX writes and expects no spaces around the delimiter.
    assert "Players=1" in written
    # Read as plain utf-8 the BOM would end up inside the first section name, and we would
    # add a second [Game] section that USDX then ignores.
    assert written.count("[Game]") == 1
    # And it goes back out the way USDX writes it, with the BOM in front.
    assert written.startswith(BOM)


@pytest.mark.parametrize("before", [None, "Off", "On"])
def test_loudness_normalization_is_switched_on(
    config_file: Path, avatars_dir: Path, before: str | None
) -> None:
    if before is not None:
        # The section as USDX writes it, the option between two others.
        config_file.write_text(
            f"{EXISTING_CONFIG}\n[Sound]\nClickAssist=Off\nReplayGain={before}\nBeatClick=On\n",
            "utf-8",
        )

    write_player_config(
        config_file, avatars_dir, [ConfiguredPlayer("Yannis", 1, None)], replay_gain=True
    )

    # `On`, spelled the way USDX's own ini reader matches it.
    sound = read_config(config_file)["Sound"]
    assert sound["ReplayGain"] == "On"
    written = config_file.read_text(encoding="utf-8")
    assert written.startswith(BOM)
    assert written.count("[Sound]") == 1
    assert written.count("ReplayGain=") == 1
    if before is not None:
        assert (sound["ClickAssist"], sound["BeatClick"]) == ("Off", "On")


@pytest.mark.parametrize("before", [None, "Off", "On"])
def test_loudness_normalization_is_never_switched_off(
    config_file: Path, avatars_dir: Path, before: str | None
) -> None:
    """Not tagging is no reason to undo a choice the host made by hand."""
    if before is not None:
        config_file.write_text(f"{EXISTING_CONFIG}\n[Sound]\nReplayGain={before}\n", "utf-8")

    write_player_config(config_file, avatars_dir, [ConfiguredPlayer("Yannis", 1, None)])

    config = read_config(config_file)
    if before is None:
        assert not config.has_section("Sound")
    else:
        assert config["Sound"]["ReplayGain"] == before


def test_a_config_without_the_sections_is_created(tmp_path: Path, avatars_dir: Path) -> None:
    config_file = tmp_path / "brand-new.ini"

    write_player_config(
        config_file, avatars_dir, [ConfiguredPlayer(name="Yannis", color_index=2, avatar_file=None)]
    )

    assert read_config(config_file)["Name"]["P1"] == "Yannis"
    # Nothing to preserve, so nothing to back up either.
    assert not (tmp_path / f"brand-new.ini{BACKUP_SUFFIX}").exists()


def test_the_original_config_is_backed_up_once(config_file: Path, avatars_dir: Path) -> None:
    backup = config_file.with_name(config_file.name + BACKUP_SUFFIX)

    write_player_config(
        config_file, avatars_dir, [ConfiguredPlayer(name="Yannis", color_index=1, avatar_file=None)]
    )
    assert backup.read_text(encoding="utf-8") == EXISTING_CONFIG

    write_player_config(
        config_file, avatars_dir, [ConfiguredPlayer(name="Alex", color_index=1, avatar_file=None)]
    )

    # Still the user's untouched original, not the version we wrote a second ago.
    assert backup.read_text(encoding="utf-8") == EXISTING_CONFIG


def test_an_avatar_is_copied_and_referenced_by_md5(
    tmp_path: Path, config_file: Path, avatars_dir: Path
) -> None:
    avatar = tmp_path / "player.png"
    avatar.write_bytes(b"not really a png, but a stable md5")

    write_player_config(
        config_file,
        avatars_dir,
        [
            ConfiguredPlayer(name="Yannis", color_index=1, avatar_file=avatar),
            ConfiguredPlayer(name="Alex", color_index=2, avatar_file=None),
        ],
    )

    config = read_config(config_file)
    # USDX only finds avatars inside its own directory, and matches them by content hash.
    assert (avatars_dir / "player.png").read_bytes() == avatar.read_bytes()
    expected = hashlib.md5(avatar.read_bytes(), usedforsecurity=False).hexdigest().upper()
    assert config["PlayerAvatar"]["P1"] == expected
    # A player without an avatar gets no entry at all, rather than a stale one.
    assert "P2" not in config["PlayerAvatar"]


def test_a_slot_loses_the_avatar_of_the_previous_player(
    tmp_path: Path, config_file: Path, avatars_dir: Path
) -> None:
    """The same config file is rewritten before every song."""
    avatar = tmp_path / "player.png"
    avatar.write_bytes(b"an avatar")
    write_player_config(config_file, avatars_dir, [ConfiguredPlayer("Yannis", 1, avatar)])
    assert "P1" in read_config(config_file)["PlayerAvatar"]

    write_player_config(config_file, avatars_dir, [ConfiguredPlayer("Alex", 1, None)])

    assert "P1" not in read_config(config_file)["PlayerAvatar"]


def test_a_vanished_avatar_file_is_ignored(
    tmp_path: Path, config_file: Path, avatars_dir: Path
) -> None:
    write_player_config(
        config_file,
        avatars_dir,
        [ConfiguredPlayer(name="Yannis", color_index=1, avatar_file=tmp_path / "gone.png")],
    )

    assert not read_config(config_file).has_section("PlayerAvatar")
