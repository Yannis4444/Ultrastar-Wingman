"""Player business logic: creation, deletion and avatar files. Knows nothing about FastAPI."""

import logging
from collections.abc import Sequence
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..images import (
    IMAGE_MEDIA_TYPES,
    IMAGE_TYPES,
    MAX_IMAGE_BYTES,
    MAX_IMAGE_PIXELS,
    ImageTooLargeError,
    ImageTooManyPixelsError,
    ImageTypeError,
    remove_images,
    store_image,
    validate_image,
)
from .model import Player

logger = logging.getLogger(__name__)

# A player's picture follows the app's picture rules (`images.py`), which the achievement
# icons follow too. The avatar names stay because that is what this module is about, and an
# `except service.AvatarTypeError` in `api.py` says which upload it is refusing.
MAX_AVATAR_BYTES = MAX_IMAGE_BYTES
MAX_AVATAR_PIXELS = MAX_IMAGE_PIXELS
AVATAR_TYPES = IMAGE_TYPES
AVATAR_MEDIA_TYPES = IMAGE_MEDIA_TYPES
AvatarTypeError = ImageTypeError
AvatarTooLargeError = ImageTooLargeError
AvatarTooManyPixelsError = ImageTooManyPixelsError


class DuplicatePlayerNameError(ValueError):
    def __init__(self, name: str) -> None:
        super().__init__(f"a player named '{name}' already exists")
        self.name = name


async def list_players(session: AsyncSession) -> Sequence[Player]:
    # Case-insensitive, id as tie breaker so the order is stable across requests.
    result = await session.scalars(select(Player).order_by(func.lower(Player.name), Player.id))
    return result.all()


async def create_player(session: AsyncSession, name: str) -> Player:
    """Raises `DuplicatePlayerNameError` when the name is taken (case-insensitively)."""
    player = Player(name=name)
    session.add(player)
    try:
        await session.commit()
    except IntegrityError as error:
        # The unique index on lower(name) is the authority, so concurrent creates cannot race.
        await session.rollback()
        raise DuplicatePlayerNameError(name) from error
    logger.info("Player '%s' added", player.name)
    return player


async def player_id_of_user(session: AsyncSession, user_id: str) -> str | None:
    """The player an account sings as, or None while it has none — what tells "my own
    picture" and "my own scores" apart from everybody else's.
    """
    return await session.scalar(select(Player.id).where(Player.user_id == user_id))


async def set_hidden(session: AsyncSession, player: Player, hidden: bool) -> Player:
    """Take a player out of the singer picker, or put them back.

    Nothing else reads the flag: the scores, the sessions and the statistics are the record
    of what happened and keep naming them.
    """
    player.hidden = hidden
    await session.commit()
    logger.info(
        "Player '%s' %s the singer picker", player.name, "taken out of" if hidden else "back in"
    )
    return player


async def unhide_player_of_user(session: AsyncSession, user_id: str) -> None:
    """Whoever just logged in is here, so they belong in the picker again.

    A no-op — and no commit — while the account has no player of its own, or while its
    player was never hidden: logging in must not write a row for nothing.
    """
    player = await session.scalar(select(Player).where(Player.user_id == user_id))
    if player is None or not player.hidden:
        return
    player.hidden = False
    await session.commit()
    logger.info("Player '%s' back in the singer picker after logging in", player.name)


async def delete_player(session: AsyncSession, player: Player, avatars_dir: Path) -> None:
    # The cards go with them. `player_cards` names the player with a foreign key, but SQLite
    # only enforces one with a pragma Wingman does not set, so the cascade is carried out
    # here — a card outliving its player is a card the next assignment silently overwrites,
    # and until then a card that selects nobody. Imported inside the function because the
    # module-level import closes a circle: `devices.service` hashes its tokens with
    # `auth.service`, which imports this module.
    from ..devices import service as devices

    await devices.forget_cards_of(session, player.id)
    await remove_images(avatars_dir, player.id)
    await session.delete(player)
    await session.commit()
    logger.info("Player '%s' deleted", player.name)


async def store_avatar(
    session: AsyncSession,
    player: Player,
    avatars_dir: Path,
    content_type: str | None,
    data: bytes,
) -> Player:
    """Replace the player's avatar.

    Raises `AvatarTypeError` / `AvatarTooLargeError` / `AvatarTooManyPixelsError`.
    """
    extension = validate_image(content_type, data)
    path = await store_image(avatars_dir, player.id, extension, data)
    player.avatar_file = str(path)
    await session.commit()
    return player
