"""Player business logic: creation, deletion and avatar files. Knows nothing about FastAPI."""

import asyncio
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..events import PlayersChanged, event_bus
from ..images import (
    IMAGE_MEDIA_TYPES,
    IMAGE_TYPES,
    MAX_IMAGE_BYTES,
    MAX_IMAGE_PIXELS,
    ImageTooLargeError,
    ImageTooManyPixelsError,
    ImageTypeError,
    remove_images,
    sniff_image_type,
    store_image,
    validate_image,
)
from .model import AVATAR_MANUAL, AVATAR_OIDC, Player

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
    await announce_players()
    return player


async def announce_players() -> None:
    """Tell every client the players list is different, after the commit that made it so.

    Called by every write that changes what `GET /players` answers — here, and where an
    account is created or deleted (`auth.service`), which adds or unlinks its player.
    """
    await event_bus.broadcast(PlayersChanged())


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
    await announce_players()
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
    await announce_players()


async def delete_player(session: AsyncSession, player: Player, avatars_dir: Path) -> None:
    # The cards go with them. `player_cards` names the player with a foreign key, but SQLite
    # only enforces one with a pragma Wingman does not set, so the cascade is carried out
    # here — a card outliving its player is a card the next assignment silently overwrites,
    # and until then a card that selects nobody. Imported inside the function because the
    # module-level import closes a circle: `devices.service` hashes its tokens with
    # `auth.service`, which imports this module.
    from ..devices import service as devices

    await devices.forget_cards_of(session, player.id)
    async with _avatar_lock:
        await remove_images(avatars_dir, player.id)
        await session.delete(player)
        await session.commit()
    logger.info("Player '%s' deleted", player.name)
    await announce_players()


# One avatar write at a time, file and row together. A single sign-on login decides whether
# it may put the provider's picture on a player and then writes it, with awaits in between;
# an upload landing in that gap would be overwritten — the hand-picked picture the rule
# exists to protect — and, under another extension, left beside it on the disk. One process
# serves Wingman, so an in-process lock is all it takes.
_avatar_lock = asyncio.Lock()


@dataclass(frozen=True)
class ProviderPicture:
    """Where a picture taken from the identity provider was downloaded from, and the `ETag`
    that answer carried — what the next login asks "has it changed?" with."""

    url: str
    etag: str | None


async def store_avatar(
    session: AsyncSession,
    player: Player,
    avatars_dir: Path,
    content_type: str | None,
    data: bytes,
) -> Player:
    """Replace the player's avatar with one somebody uploaded.

    An upload is `manual` whoever made it — the singer or somebody with `players.avatar` —
    and no single sign-on login replaces it after that (`takes_provider_picture`).

    Raises `AvatarTypeError` / `AvatarTooLargeError` / `AvatarTooManyPixelsError`.
    """
    extension = validate_image(content_type, data)
    async with _avatar_lock:
        await _write(session, player, avatars_dir, extension, data, None)
    await announce_players()
    return player


def takes_provider_picture(player: Player) -> bool:
    """Whether a single sign-on login may put the provider's picture on this player: while
    it has none, or while the one it has is the provider's. A picture somebody chose by
    hand is never overwritten."""
    return player.avatar_file is None or player.avatar_source == AVATAR_OIDC


async def store_provider_avatar(
    session: AsyncSession,
    player: Player,
    avatars_dir: Path,
    data: bytes,
    provider_picture: ProviderPicture,
    *,
    unchanged: bool,
) -> bool:
    """Put the identity provider's picture on the player, where `takes_provider_picture`
    still allows it — read again under the lock every upload takes, so an upload that came
    in while the picture was downloading wins. Whether the picture is the player's now.

    `unchanged` is the caller's word that `data` is the very file the player already has:
    then the file stays as it is — so its version, and every browser's cached copy, stay
    too — and only where it came from is brought up to date.

    The picture is declared as what its bytes say (`sniff_image_type`), a web server's own
    `Content-Type` being unreliable for one. Raises what `store_avatar` raises.
    """
    extension = validate_image(sniff_image_type(data), data)
    async with _avatar_lock:
        await session.refresh(player)
        if not takes_provider_picture(player):
            return False
        if unchanged and player.avatar_file is not None:
            # The file and its version stay, so nothing a client draws is different.
            _set_source(player, provider_picture)
            await session.commit()
            return True
        await _write(session, player, avatars_dir, extension, data, provider_picture)
    await announce_players()
    return True


async def _write(
    session: AsyncSession,
    player: Player,
    avatars_dir: Path,
    extension: str,
    data: bytes,
    provider_picture: ProviderPicture | None,
) -> None:
    path = await store_image(avatars_dir, player.id, extension, data)
    player.avatar_file = str(path)
    _set_source(player, provider_picture)
    await session.commit()


def _set_source(player: Player, provider_picture: ProviderPicture | None) -> None:
    if provider_picture is None:
        player.avatar_source = AVATAR_MANUAL
        player.avatar_source_url = None
        player.avatar_source_etag = None
    else:
        player.avatar_source = AVATAR_OIDC
        player.avatar_source_url = provider_picture.url
        player.avatar_source_etag = provider_picture.etag
