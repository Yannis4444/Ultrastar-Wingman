"""PlatformIO pre-script: compiles the firmware's version into the image.

`FIRMWARE_VERSION` comes from `firmware/VERSION`, `FIRMWARE_GIT` from `git describe`, and
both are read in exactly one translation unit (`main.cpp`), so bumping a version does not
invalidate the whole tree.
"""

import subprocess
from pathlib import Path

Import("env")  # noqa: F821  (injected by PlatformIO's SCons environment)

FIRMWARE_DIR = Path(env["PROJECT_DIR"])  # noqa: F821


def firmware_version() -> str:
    return (FIRMWARE_DIR / "VERSION").read_text(encoding="utf-8").strip()


def git_describe() -> str:
    """The commit the image was built from, or "unknown" outside a checkout."""
    try:
        result = subprocess.run(
            ["git", "describe", "--always", "--dirty"],
            cwd=FIRMWARE_DIR,
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
    return result.stdout.strip() or "unknown"


env.Append(  # noqa: F821
    CPPDEFINES=[
        # StringifyMacro quotes the value the way the host shell needs it.
        ("FIRMWARE_VERSION", env.StringifyMacro(firmware_version())),  # noqa: F821
        ("FIRMWARE_GIT", env.StringifyMacro(git_describe())),  # noqa: F821
    ]
)
