"""Player read models. Separate from `api.py` so modules that must not import FastAPI
(the karaoke service, the event bus) can still speak in player payloads."""

from pydantic import BaseModel

from .model import Player


class PlayerRead(BaseModel):
    id: str
    name: str
    registered: bool
    has_avatar: bool


class PlayerList(BaseModel):
    players: list[PlayerRead]


def read_player(player: Player) -> PlayerRead:
    return PlayerRead(
        id=player.id,
        name=player.name,
        registered=player.registered,
        # File paths stay server-side; the UI only needs to know whether to request the image.
        has_avatar=player.avatar_file is not None,
    )
