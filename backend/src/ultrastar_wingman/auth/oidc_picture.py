"""The identity provider's picture of somebody, as the avatar of the player they sing as.

Every single sign-on login that carries a picture address (the standard `picture` claim)
downloads it and puts it on the account's player — unless somebody chose that player's
picture by hand, which always wins (`players.service.takes_provider_picture`). So a singer
who changes their picture at the provider sees it here at the next login, and one who
uploads a picture of their own here keeps it.

What keeps a login from paying for this:

- The download is bounded: `DOWNLOAD_SECONDS` for the whole of it, redirects included, and
  never more than `images.MAX_IMAGE_BYTES` read off the wire, whatever the server says.
- The picture is asked for with the `ETag` the last answer carried, so an unchanged picture
  is a `304` and nothing is written. Without one the picture is downloaded again, and an
  answer identical to the file already stored leaves that file — and its version, so every
  browser's cached copy — alone.
- Nothing here fails a login. Every refusal is one WARNING line naming the account and
  saying why, never the address (its query string may carry a token) and never a token.

Which addresses are fetched: `http` and `https` only, nothing else (no `file:`, no `data:`).
Hosts are not filtered: the address comes from the identity provider the host configured
and trusts with the logins themselves, and that provider may well sit on the same LAN.

FastAPI-free: `oidc.py` hands in the HTTP client, so the tests' fake provider serves the
picture too.
"""

import asyncio
import logging
from pathlib import Path
from urllib.parse import urlsplit

import anyio
import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from ..images import MAX_IMAGE_BYTES
from ..players import service as players
from ..players.model import AVATAR_OIDC, Player
from .model import User
from .service import player_for_user

logger = logging.getLogger(__name__)

# The whole download, redirects and all. Long enough for a picture from a slow CDN, short
# enough that a login waiting on a host that does not answer is still a login.
DOWNLOAD_SECONDS = 5.0

# Longer than any picture address a provider hands out, short enough not to store whatever
# a misbehaving one puts into the claim.
MAX_URL_LENGTH = 2048


class PictureRefusedError(ValueError):
    """The provider's answer is not a picture Wingman takes. The message is the reason the
    console line gives, and never carries the address."""


def picture_url(value: object) -> str | None:
    """`value` when it is an address a picture may be downloaded from, else `None`."""
    if not isinstance(value, str):
        return None
    url = value.strip()
    if not url or len(url) > MAX_URL_LENGTH:
        return None
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if parts.scheme.lower() not in {"http", "https"} or not parts.hostname:
        return None
    return url


async def take_provider_picture(
    session: AsyncSession,
    client: httpx.AsyncClient,
    user: User,
    url: str,
    avatars_dir: Path,
) -> None:
    """Put the picture at `url` on the player `user` sings as, where the rule allows it.

    Never raises for anything the download or the picture can do wrong: each of those is a
    WARNING and the login it is part of goes on.
    """
    player = await player_for_user(session, user.id)
    if player is None or not players.takes_provider_picture(player):
        return
    stored = await _stored_picture(player)
    headers: dict[str, str] = {}
    if (
        stored is not None
        and player.avatar_source_url == url
        and player.avatar_source_etag is not None
    ):
        headers["If-None-Match"] = player.avatar_source_etag
    try:
        async with asyncio.timeout(DOWNLOAD_SECONDS):
            answer = await _download(client, url, headers)
        if answer is None:
            # 304: the picture the player has is the provider's current one.
            return
        data, etag = answer
        # The download took a moment: somebody may have uploaded a picture meanwhile, and
        # that one is theirs — which `store_provider_avatar` asks again under the lock every
        # upload takes, so one landing while this writes cannot be overwritten either.
        if not await players.store_provider_avatar(
            session,
            player,
            avatars_dir,
            data,
            players.ProviderPicture(url=url, etag=etag),
            unchanged=stored is not None and data == stored,
        ):
            return
    except TimeoutError:
        _refused(user, f"the download took longer than {DOWNLOAD_SECONDS:g} seconds")
    except (httpx.HTTPError, httpx.InvalidURL) as error:
        # The class name only: httpx puts the address into its messages.
        _refused(user, f"the download failed ({type(error).__name__})")
    except players.AvatarTooLargeError:
        _refused(user, f"the picture is larger than {MAX_IMAGE_BYTES} bytes")
    except players.AvatarTooManyPixelsError as error:
        _refused(user, f"the picture is {error.width}x{error.height} pixels, far too many")
    except players.AvatarTypeError:
        _refused(user, "the answer is not a jpeg, png or webp picture")
    except PictureRefusedError as error:
        _refused(user, str(error))
    except OSError as error:
        _refused(user, f"the picture could not be stored ({error.strerror or error})")
    else:
        logger.info("'%s' has their single sign-on picture as their avatar now", user.username)


async def _stored_picture(player: Player) -> bytes | None:
    """The bytes of the provider's picture this player already has, or `None` — none at
    all, one uploaded by hand, or a file that went missing (which is downloaded again)."""
    if player.avatar_file is None or player.avatar_source != AVATAR_OIDC:
        return None
    path = Path(player.avatar_file)

    def read() -> bytes | None:
        try:
            return path.read_bytes()
        except OSError:
            return None

    return await anyio.to_thread.run_sync(read)


async def _download(
    client: httpx.AsyncClient, url: str, headers: dict[str, str]
) -> tuple[bytes, str | None] | None:
    """The picture's bytes and its `ETag`, or `None` for a `304`. Raises
    `PictureRefusedError`, `AvatarTooLargeError` or an `httpx.HTTPError`."""
    async with client.stream("GET", url, headers=headers, follow_redirects=True) as response:
        if response.status_code == 304 and headers:
            return None
        if response.status_code != 200:
            raise PictureRefusedError(f"the server answered {response.status_code}")
        declared = response.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > MAX_IMAGE_BYTES:
            raise players.AvatarTooLargeError
        # Read up to one byte past the cap and stop: a server that lies about the length,
        # or sends none, still never gets more than that into memory.
        data = bytearray()
        async for chunk in response.aiter_bytes():
            data.extend(chunk)
            if len(data) > MAX_IMAGE_BYTES:
                raise players.AvatarTooLargeError
        return bytes(data), response.headers.get("etag")


def _refused(user: User, reason: str) -> None:
    logger.warning(
        "Kept the avatar of '%s' as it was: their single sign-on picture could not be "
        "taken, because %s",
        user.username,
        reason,
    )
