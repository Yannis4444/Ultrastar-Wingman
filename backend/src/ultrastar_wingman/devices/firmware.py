"""The firmware image Wingman ships, and how the wizard gets at it.

`firmware/` beside this module holds the built image and a `manifest.json` naming it. The
image is a *generated artifact*: `firmware/build.py` in the repository root writes it there
and it is never committed, so a plain checkout has no firmware at all — which is a 404 and
not a broken installation. `installer/build.ps1` builds it before PyInstaller and the spec
lists the directory in `datas`, which is why `firmware_dir` looks in the unpacked bundle
first, exactly as `db.migrations_dir` and `achievements.pictures.images_dir` do.
"""

import json
import logging
import sys
from pathlib import Path

from pydantic import ValidationError

from .schema import FirmwareManifest

logger = logging.getLogger(__name__)

MANIFEST_NAME = "manifest.json"


def firmware_dir() -> Path:
    """Where the built image is — the unpacked bundle when frozen, the package directory
    otherwise."""
    bundle_dir = getattr(sys, "_MEIPASS", None)
    if bundle_dir is not None:
        return Path(bundle_dir) / "ultrastar_wingman" / "devices" / "firmware"
    return Path(__file__).parent / "firmware"


def read_manifest() -> FirmwareManifest | None:
    """What was built, or None when nothing was.

    An unreadable manifest is None as well, not an exception: a half-written build directory
    must leave the app answering "no firmware" rather than 500 on a page the host opened to
    find out what is wrong.
    """
    path = firmware_dir() / MANIFEST_NAME
    if not path.is_file():
        return None
    try:
        return FirmwareManifest.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError, ValidationError):
        logger.warning("the firmware manifest at %s could not be read", path, exc_info=True)
        return None


def ota_file() -> str | None:
    """The bare application image a device flashes over Wi-Fi, or None.

    None for a manifest built before the update existed: such a build can still be flashed
    over the cable, and asking for one over Wi-Fi is refused rather than answered with the
    merged image, which `HTTPUpdate` would reject at the first byte anyway.
    """
    manifest = read_manifest()
    if manifest is None:
        return None
    return next((build.ota_file for build in manifest.builds if build.ota_file), None)


def image_path(file: str) -> Path | None:
    """The image the manifest names, as either `file` or `ota_file`, or None.

    The manifest is the allowlist: a name it does not carry is not served, whatever it looks
    like. That alone settles traversal — "../../secrets" is not in the manifest — and the
    name check keeps a *manifest* that was tampered with from reaching outside the directory
    either. It is `Path(file).name` and not a hunt for separators because on Windows a name
    carrying a drive ("C:secrets.txt", no separator at all) replaces the directory it is
    joined to; a plain file name is the only thing that survives this comparison.
    """
    manifest = read_manifest()
    if manifest is None:
        return None
    named = {build.file for build in manifest.builds}
    named |= {build.ota_file for build in manifest.builds if build.ota_file is not None}
    if file not in named:
        return None
    if Path(file).name != file:
        logger.warning("the firmware manifest names a path and not a file: %r", file)
        return None
    path = firmware_dir() / file
    return path if path.is_file() else None
