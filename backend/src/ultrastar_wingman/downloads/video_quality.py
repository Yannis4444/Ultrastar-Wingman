"""Which YouTube stream a download asks yt-dlp for.

The setting is the yt-dlp format string itself, not a preset name: the presets below
are what the settings UI writes into it, so "what is actually used" is always readable
(same idea as `karaoke.player_colors`, which stores the colors and not a count).

A leaf on purpose: `settings.py` imports the default and the validator from here, so
this module must never import the settings registry back.
"""

from dataclasses import dataclass

# yt-dlp is never run through a shell (`asyncio.create_subprocess_exec`), so nothing here
# can be a shell injection. These are refused anyway: a format string that needs one of
# them is a typo, and the value ends up in log lines and error messages.
FORBIDDEN_CHARACTERS = ";|&`$\"'\\"

# Long enough for the hairiest real selector, short enough to keep a paste accident out of
# the database.
MAX_FORMAT_LENGTH = 300


@dataclass(frozen=True)
class VideoQualityPreset:
    """One ready-made answer to "how good should the video be"."""

    key: str
    label: str
    description: str
    video_format: str


def _capped(height: int) -> str:
    """mp4 video plus m4a audio up to `height`, or the best single mp4 file that fits.

    mp4/m4a rather than "whatever is best": Ultrastar Deluxe plays the file we write, and
    a webm or an Opus track is not something every USDX build can open.
    """
    return (
        f"bestvideo[ext=mp4][height<={height}]+bestaudio[ext=m4a]/best[ext=mp4][height<={height}]"
    )


PRESETS: tuple[VideoQualityPreset, ...] = (
    VideoQualityPreset(
        key="best",
        label="Best available",
        description="Whatever YouTube has, at any size. Large files, and not always mp4.",
        video_format="bestvideo*+bestaudio/best",
    ),
    VideoQualityPreset(
        key="high",
        label="High (1080p)",
        description="Full HD. The default, and what looks right on a TV.",
        video_format=_capped(1080),
    ),
    VideoQualityPreset(
        key="medium",
        label="Medium (720p)",
        description="HD at roughly half the size of 1080p.",
        video_format=_capped(720),
    ),
    VideoQualityPreset(
        key="small",
        label="Small (480p)",
        description="The smallest download that still looks fine on a laptop screen.",
        video_format=_capped(480),
    ),
)

# 1080p: what Wingman downloaded before the setting existed.
DEFAULT_VIDEO_FORMAT = PRESETS[1].video_format


def validate_video_format(value: object) -> None:
    """Loosely: yt-dlp owns the grammar, we only refuse what cannot be meant.

    `<`, `>`, `[`, `]`, `+`, `/` and `*` are format-selector syntax (`height<=1080`) and
    stay allowed — see `FORBIDDEN_CHARACTERS` for what does not.
    """
    text = str(value).strip()
    if not text:
        raise ValueError("a format string is required (reset the setting for the default)")
    if len(text) > MAX_FORMAT_LENGTH:
        raise ValueError(f"a format string is at most {MAX_FORMAT_LENGTH} characters")
    refused = sorted({character for character in text if not _is_allowed(character)})
    if refused:
        raise ValueError(f"a format string must not contain {' '.join(refused)}")


def _is_allowed(character: str) -> bool:
    return character.isprintable() and character not in FORBIDDEN_CHARACTERS
