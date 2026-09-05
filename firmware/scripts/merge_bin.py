"""PlatformIO post-script: one flashable image.

The browser flashes a single file at offset 0, so bootloader, partition table, boot_app0 and
the application are merged into `wingman-esp32.bin` with the esptool PlatformIO ships. The
parts and their offsets are the platform's own `FLASH_EXTRA_IMAGES` — bootloader and
partition table are generated into the build directory, not shipped in a package, so nothing
here may hard-code a path.
"""

import subprocess
from pathlib import Path

Import("env")  # noqa: F821  (injected by PlatformIO's SCons environment)

MERGED_NAME = "wingman-esp32.bin"


def merge_image(source, target, env) -> None:
    build_dir = Path(env.subst("$BUILD_DIR"))
    application = build_dir / (env.subst("$PROGNAME") + ".bin")
    if not application.is_file():
        return

    # $OBJCOPY is the esptool binary the platform resolved; it is quoted when its path holds
    # a space, which subprocess does not want.
    esptool = env.subst("$OBJCOPY").strip('"')
    merged = build_dir / MERGED_NAME

    parts: list[str] = []
    for offset, image in env.get("FLASH_EXTRA_IMAGES", []):
        parts += [str(offset), env.subst(image)]
    parts += [env.subst("$ESP32_APP_OFFSET") or "0x10000", str(application)]

    command = [
        esptool,
        "--chip",
        env.subst("$BOARD_MCU"),
        "merge-bin",
        "--output",
        str(merged),
        # Target offset 0: the gaps between the parts are padded, so the result is the whole
        # flash layout and the wizard writes it in one go.
        "--target-offset",
        "0",
        *parts,
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0 or not merged.is_file():
        print(result.stdout)
        print(result.stderr)
        raise RuntimeError(f"esptool merge-bin failed with exit code {result.returncode}")
    print(f"merged image: {merged} ({merged.stat().st_size} bytes)")


env.AddPostAction(  # noqa: F821
    "$BUILD_DIR/${PROGNAME}.bin",
    env.VerboseAction(merge_image, "Merging " + MERGED_NAME),  # noqa: F821
)
