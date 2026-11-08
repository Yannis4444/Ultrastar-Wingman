"""Player read models. Separate from `api.py` so modules that must not import FastAPI
(the karaoke service, the event bus) can still speak in player payloads."""

from pydantic import BaseModel

from ..images import image_version
from .model import Player


class PlayerRead(BaseModel):
    id: str
    name: str
    registered: bool
    # Out of the singer picker for the evening — and the account's wishes out of the wishlist
    # (`library.service._counted`) — and out of nothing else: the flag rides on every
    # listing so the picker can drop the row while the scoreboard still draws it.
    hidden: bool
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
        hidden=player.hidden,
        # File paths stay server-side; the UI only needs to know whether to request the image.
        has_avatar=player.avatar_file is not None,
        avatar_version=avatar_version(player.avatar_file),
    )


def avatar_version(avatar_file: str | None) -> int | None:
    """`None` when there is no avatar — or when the file behind it is gone, which the
    avatar endpoint answers with a 404 anyway.

    Kept under this name because `auth` and `comments` speak of avatars; the rule itself is
    `images.image_version`, shared with an achievement's icon so the two cannot drift.
    """
    return image_version(avatar_file)
