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

# A byte limit alone does not bound what the picture costs to *display*: a few kilobytes of
# png can declare 30000x30000 pixels and cost gigabytes of memory in the phone browser, in
# the nav bar and in Ultrastar Deluxe, which all decode the file we hand them. Nothing here
# re-encodes images (that would mean an image library), so the header is read and an
# implausible canvas refused. 50 megapixels is well past any phone camera.
MAX_AVATAR_PIXELS = 50_000_000

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


class AvatarTooManyPixelsError(ValueError):
    def __init__(self, width: int, height: int) -> None:
        super().__init__(
            f"{width}x{height} is more than the {MAX_AVATAR_PIXELS} pixels an avatar may have"
        )
        self.width = width
        self.height = height


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
    logger.info("player '%s' is now %s", player.name, "hidden" if hidden else "shown")
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
    logger.info("player '%s' is shown again after a login", player.name)


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
    """Replace the player's avatar.

    Raises `AvatarTypeError` / `AvatarTooLargeError` / `AvatarTooManyPixelsError`.
    """
    if len(data) > MAX_AVATAR_BYTES:
        raise AvatarTooLargeError
    if content_type not in AVATAR_TYPES or _sniff(data) != content_type:
        # The declared type has to match what the bytes actually are: a .txt renamed to .png
        # arrives as image/png and would otherwise be stored and served as an image.
        raise AvatarTypeError(content_type)
    size = _dimensions(content_type, data)
    if size is None:
        # Magic bytes alone are four characters anyone can prepend; a file whose own header
        # does not say how big the picture is, is not a picture we should hand to USDX.
        raise AvatarTypeError(content_type)
    if size[0] * size[1] > MAX_AVATAR_PIXELS:
        raise AvatarTooManyPixelsError(*size)

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


def _dimensions(content_type: str, data: bytes) -> tuple[int, int] | None:
    """The picture's size in pixels straight out of its header, or `None` when the header
    does not hold one. Header only: nothing here decodes pixel data."""
    if content_type == "image/png":
        return _png_dimensions(data)
    if content_type == "image/jpeg":
        return _jpeg_dimensions(data)
    return _webp_dimensions(data)


def _png_dimensions(data: bytes) -> tuple[int, int] | None:
    # IHDR is mandatory and always the first chunk: length, "IHDR", width, height.
    if len(data) < 24 or data[12:16] != b"IHDR":
        return None
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


# Every frame header that carries a size. The other 0xFFCx markers are tables, not frames.
_JPEG_FRAME_MARKERS = frozenset(
    {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
)


def _jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    """Walk the segments to the first frame header. Height comes before width in it."""
    position = 2  # Past the SOI the sniff already matched.
    while position + 3 < len(data):
        if data[position] != 0xFF:
            return None
        marker = data[position + 1]
        if marker == 0xFF:
            # Fill bytes are allowed before a marker; step over them one at a time.
            position += 1
            continue
        if marker in _JPEG_FRAME_MARKERS:
            if position + 9 > len(data):
                return None
            height = int.from_bytes(data[position + 5 : position + 7], "big")
            width = int.from_bytes(data[position + 7 : position + 9], "big")
            return width, height
        if marker in {0xD8, 0x01} or 0xD0 <= marker <= 0xD7:
            # Markers that stand alone, without a length after them.
            position += 2
            continue
        if marker in {0xD9, 0xDA}:
            # End of image, or the entropy-coded scan: no frame header is coming.
            return None
        position += 2 + int.from_bytes(data[position + 2 : position + 4], "big")
    return None


def _webp_dimensions(data: bytes) -> tuple[int, int] | None:
    """The three flavours of webp keep their canvas in three different places."""
    chunk = data[12:16]
    if chunk == b"VP8 ":
        if len(data) < 30 or data[23:26] != b"\x9d\x01\x2a":
            return None
        # 14 bits each; the top two bits are the scaling hint, not part of the size.
        width = int.from_bytes(data[26:28], "little") & 0x3FFF
        height = int.from_bytes(data[28:30], "little") & 0x3FFF
        return width, height
    if chunk == b"VP8L":
        if len(data) < 25 or data[20] != 0x2F:
            return None
        bits = int.from_bytes(data[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if chunk == b"VP8X":
        if len(data) < 30:
            return None
        # Canvas width and height minus one, 24 bits each, after the flags and reserved bytes.
        return (
            int.from_bytes(data[24:27], "little") + 1,
            int.from_bytes(data[27:30], "little") + 1,
        )
    return None


async def _remove_avatar_files(player_id: str, avatars_dir: Path) -> None:
    def remove() -> None:
        # A uuid4 hex id has no glob metacharacters; the extension is the only variable part.
        for existing in avatars_dir.glob(f"{player_id}.*"):
            existing.unlink(missing_ok=True)

    await anyio.to_thread.run_sync(remove)
