"""Player business logic: creation, deletion and avatar files. Knows nothing about FastAPI."""

import logging
from collections.abc import Sequence
from pathlib import Path

import anyio
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .model import Player

logger = logging.getLogger(__name__)

MAX_AVATAR_BYTES = 5 * 1024 * 1024

# Declared content type -> file extension. Anything else is refused.
AVATAR_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}

# Serving side: `mimetypes` guesses from the registry on Windows and does not always know
# .webp, so the stored extension decides the content type instead of a guess.
AVATAR_MEDIA_TYPES = {extension: content_type for content_type, extension in AVATAR_TYPES.items()}


class DuplicatePlayerNameError(ValueError):
    def __init__(self, name: str) -> None:
        super().__init__(f"a player named '{name}' already exists")
        self.name = name


class AvatarTypeError(ValueError):
    def __init__(self, content_type: str | None) -> None:
        super().__init__(f"'{content_type}' is not a supported avatar image")
        self.content_type = content_type


class AvatarTooLargeError(ValueError):
    def __init__(self) -> None:
        super().__init__(f"avatars are limited to {MAX_AVATAR_BYTES} bytes")


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
    logger.info("player '%s' created (%s)", player.name, player.id)
    return player


async def delete_player(session: AsyncSession, player: Player, avatars_dir: Path) -> None:
    await _remove_avatar_files(player.id, avatars_dir)
    await session.delete(player)
    await session.commit()
    logger.info("player '%s' deleted (%s)", player.name, player.id)


async def store_avatar(
    session: AsyncSession,
    player: Player,
    avatars_dir: Path,
    content_type: str | None,
    data: bytes,
) -> Player:
    """Replace the player's avatar. Raises `AvatarTypeError` / `AvatarTooLargeError`."""
    if len(data) > MAX_AVATAR_BYTES:
        raise AvatarTooLargeError
    if content_type not in AVATAR_TYPES or _sniff(data) != content_type:
        # The declared type has to match what the bytes actually are: a .txt renamed to .png
        # arrives as image/png and would otherwise be stored and served as an image.
        raise AvatarTypeError(content_type)

    path = avatars_dir / f"{player.id}{AVATAR_TYPES[content_type]}"
    # Drops a previous avatar with a different extension, so only one file per player survives.
    await _remove_avatar_files(player.id, avatars_dir)
    await anyio.to_thread.run_sync(lambda: avatars_dir.mkdir(parents=True, exist_ok=True))
    await anyio.to_thread.run_sync(path.write_bytes, data)
    player.avatar_file = str(path)
    await session.commit()
    return player


def _sniff(data: bytes) -> str | None:
    """The content type the bytes claim to be by their magic number, if we support it."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    # RIFF container: bytes 4-8 are the length, the form type follows.
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


async def _remove_avatar_files(player_id: str, avatars_dir: Path) -> None:
    def remove() -> None:
        # A uuid4 hex id has no glob metacharacters; the extension is the only variable part.
        for existing in avatars_dir.glob(f"{player_id}.*"):
            existing.unlink(missing_ok=True)

    await anyio.to_thread.run_sync(remove)
