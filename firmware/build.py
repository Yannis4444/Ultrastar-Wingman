"""Builds the firmware image and bundles it into the backend package.

    venv\\Scripts\\python.exe firmware/build.py

The image is a generated artifact and never committed: `installer/build.ps1` and CI run this
before packaging, and a dev checkout without a build answers `GET /devices/firmware` with
404 `no_firmware`.
"""

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

FIRMWARE_DIR = Path(__file__).resolve().parent
REPO_ROOT = FIRMWARE_DIR.parent
BUNDLE_DIR = REPO_ROOT / "backend" / "src" / "ultrastar_wingman" / "devices" / "firmware"
BUILD_DIR = FIRMWARE_DIR / ".pio" / "build" / "esp32dev"
IMAGE_NAME = "wingman-esp32.bin"
BUILT_IMAGE = BUILD_DIR / IMAGE_NAME
# The over-the-air image is the *application* alone. The merged image above is the whole
# flash layout starting with the bootloader's padding, which the ESP32's `HTTPUpdate`
# refuses (an OTA image has to start with the 0xE9 magic byte) and which would in any case
# be nonsense written into an app slot. Two files, two jobs: the wizard flashes the merged
# one at offset 0 over USB, the device downloads this one into the other OTA slot.
OTA_IMAGE_NAME = "wingman-esp32-ota.bin"
BUILT_OTA_IMAGE = BUILD_DIR / "firmware.bin"


def protocol_version() -> int:
    """The protocol the image speaks, read where the firmware declares it.

    The server's `devices.protocol.SUPPORTED` is the other half of the pair; taking the
    number out of the header is what keeps the manifest from drifting away from it.
    """
    header = (FIRMWARE_DIR / "src" / "pins.h").read_text(encoding="utf-8")
    match = re.search(r"^#define PROTOCOL_VERSION (\d+)", header, re.MULTILINE)
    if match is None:
        raise SystemExit("no PROTOCOL_VERSION in src/pins.h")
    return int(match.group(1))


def build() -> None:
    """Runs the esp32dev build through the interpreter that started this script."""
    subprocess.run(
        [sys.executable, "-m", "platformio", "run", "-e", "esp32dev"],
        cwd=FIRMWARE_DIR,
        check=True,
    )


def bundle() -> Path:
    """Copies the image and writes the manifest the wizard reads."""
    if not BUILT_IMAGE.is_file():
        raise SystemExit(f"no image at {BUILT_IMAGE} — did the build fail?")

    if not BUILT_OTA_IMAGE.is_file():
        raise SystemExit(f"no image at {BUILT_OTA_IMAGE} — did the build fail?")

    BUNDLE_DIR.mkdir(parents=True, exist_ok=True)
    target = BUNDLE_DIR / IMAGE_NAME
    shutil.copyfile(BUILT_IMAGE, target)
    ota_target = BUNDLE_DIR / OTA_IMAGE_NAME
    shutil.copyfile(BUILT_OTA_IMAGE, ota_target)

    manifest = {
        "version": (FIRMWARE_DIR / "VERSION").read_text(encoding="utf-8").strip(),
        "protocol": protocol_version(),
        # `ota_file` is what a Wi-Fi update downloads; `file` stays the wizard's. Both are
        # additive: a server that reads only `file` flashes over USB as before.
        "builds": [
            {
                "chip": "ESP32",
                "file": IMAGE_NAME,
                "size": target.stat().st_size,
                "ota_file": OTA_IMAGE_NAME,
                "ota_size": ota_target.stat().st_size,
            },
        ],
    }
    (BUNDLE_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    return target


def main() -> None:
    build()
    target = bundle()
    print(f"bundled {target} ({target.stat().st_size} bytes) and manifest.json")


if __name__ == "__main__":
    main()
