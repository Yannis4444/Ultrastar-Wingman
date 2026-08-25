"""Player read models. Separate from `api.py` so modules that must not import FastAPI
(the karaoke service, the event bus) can still speak in player payloads."""

from pathlib import Path

from pydantic import BaseModel

from .model import Player


class PlayerRead(BaseModel):
    id: str
    name: str
    registered: bool
    has_avatar: bool
    # Replacing a picture changes neither the id, the avatar URL nor `has_avatar`, so this
    # is the only thing a client can hang a cache buster on. Milliseconds of the file's
    # modification time: it moves exactly when the image does and never otherwise.
    avatar_version: int | None = None


class PlayerList(BaseModel):
    players: list[PlayerRead]


def read_player(player: Player) -> PlayerRead:
    return PlayerRead(
        id=player.id,
        name=player.name,
        registered=player.registered,
        # File paths stay server-side; the UI only needs to know whether to request the image.
        has_avatar=player.avatar_file is not None,
        avatar_version=_avatar_version(player.avatar_file),
    )


def _avatar_version(avatar_file: str | None) -> int | None:
    """`None` when there is no avatar — or when the file behind it is gone, which the
    avatar endpoint answers with a 404 anyway."""
    if avatar_file is None:
        return None
    try:
        return Path(avatar_file).stat().st_mtime_ns // 1_000_000
    except OSError:
        return None
