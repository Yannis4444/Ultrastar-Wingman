"""The one place a picture somebody uploaded is checked, and the one place one is stored.

Two features take an image off a phone — a player's avatar and an achievement's icon — and
both hand it straight back out again, to browsers, to the nav bar and (for an avatar) to
Ultrastar Deluxe. So there is one set of rules rather than two that drift: a content-type
allowlist the bytes themselves have to agree with, a byte cap, and a pixel cap read out of
the file's own header.

Nothing here decodes pixel data and nothing here re-encodes: that would mean an image
library, and the header alone answers the only question a cap needs (`code-style.md` — a new
dependency needs a reason a few lines of code cannot cover).

A leaf module on purpose. It imports nothing of Wingman's, so any domain may use it.
"""

import logging
from pathlib import Path

import anyio

logger = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 5 * 1024 * 1024

# A byte limit alone does not bound what the picture costs to *display*: a few kilobytes of
# png can declare 30000x30000 pixels and cost gigabytes of memory in the phone browser, in
# the nav bar and in Ultrastar Deluxe, which all decode the file we hand them. Nothing here
# re-encodes images, so the header is read and an implausible canvas refused. 50 megapixels
# is well past any phone camera.
MAX_IMAGE_PIXELS = 50_000_000

# Declared content type -> file extension. Anything else is refused.
IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}

# Serving side: `mimetypes` guesses from the registry on Windows and does not always know
# .webp, so the stored extension decides the content type instead of a guess.
IMAGE_MEDIA_TYPES = {extension: content_type for content_type, extension in IMAGE_TYPES.items()}


class ImageTypeError(ValueError):
    def __init__(self, content_type: str | None) -> None:
        super().__init__(f"'{content_type}' is not a supported image")
        self.content_type = content_type


class ImageTooLargeError(ValueError):
    def __init__(self) -> None:
        super().__init__(f"uploads are limited to {MAX_IMAGE_BYTES} bytes")


class ImageTooManyPixelsError(ValueError):
    def __init__(self, width: int, height: int) -> None:
        super().__init__(
            f"{width}x{height} is more than the {MAX_IMAGE_PIXELS} pixels a picture may have"
        )
        self.width = width
        self.height = height


def validate_image(content_type: str | None, data: bytes) -> str:
    """The file extension these bytes may be stored under.

    Raises `ImageTooLargeError` / `ImageTypeError` / `ImageTooManyPixelsError`.
    """
    if len(data) > MAX_IMAGE_BYTES:
        raise ImageTooLargeError
    if content_type not in IMAGE_TYPES or _sniff(data) != content_type:
        # The declared type has to match what the bytes actually are: a .txt renamed to .png
        # arrives as image/png and would otherwise be stored and served as an image.
        raise ImageTypeError(content_type)
    size = _dimensions(content_type, data)
    if size is None:
        # Magic bytes alone are four characters anyone can prepend; a file whose own header
        # does not say how big the picture is, is not a picture we should hand on.
        raise ImageTypeError(content_type)
    if size[0] * size[1] > MAX_IMAGE_PIXELS:
        raise ImageTooManyPixelsError(*size)
    return IMAGE_TYPES[content_type]


async def store_image(directory: Path, stem: str, extension: str, data: bytes) -> Path:
    """Write the picture as `<stem><extension>`, dropping whatever was there before.

    Every earlier file of that stem goes, extension included, so exactly one picture per
    subject survives a replacement that changed the format.
    """
    await remove_images(directory, stem)
    await anyio.to_thread.run_sync(lambda: directory.mkdir(parents=True, exist_ok=True))
    path = directory / f"{stem}{extension}"
    await anyio.to_thread.run_sync(path.write_bytes, data)
    return path


def image_version(path: str | None) -> int | None:
    """A number for a client to hang a cache buster on, or `None` when there is no picture.

    Replacing a picture changes neither its URL nor the flag that says one exists, so a
    browser would go on drawing the copy it already has until that copy went stale. The
    file's modification time in milliseconds moves exactly when the image does and never
    otherwise, which is what keeps an *unchanged* picture on one stable, cacheable URL.

    Derived rather than stored: a column would have to be moved by hand at every write, and
    an import or a restore that put a file in place without going through that write would
    leave it lying. `None` when the file is gone, which the serving endpoints answer with a
    404 anyway.
    """
    if path is None:
        return None
    try:
        return Path(path).stat().st_mtime_ns // 1_000_000
    except OSError:
        return None


async def remove_images(directory: Path, stem: str) -> None:
    def remove() -> None:
        # The stems are ids we minted (a uuid4 hex, or a slug): no glob metacharacters, and
        # the extension is the only variable part.
        for existing in directory.glob(f"{stem}.*"):
            existing.unlink(missing_ok=True)

    await anyio.to_thread.run_sync(remove)


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
