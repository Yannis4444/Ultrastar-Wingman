"""The media tools: a self-updating yt-dlp binary and ffmpeg.

yt-dlp is a standalone binary Wingman manages itself, not a pinned pip dependency:
YouTube breaks yt-dlp every few weeks, and a Wingman release per breakage is not a
plan. Both tools are driven as subprocesses — that is also what makes real download
progress observable (the python API hides it behind a hook).
"""

import asyncio
import json
import logging
import re
import sys
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from ..settings import SettingsService
from ..sources.base import DownloadError, ProgressReport

logger = logging.getLogger(__name__)

YTDLP_PATH_SETTING = "downloads.ytdlp_path"
FFMPEG_SETTING = "downloads.ffmpeg"

LATEST_RELEASE_URL = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest"
ASSET_NAME = "yt-dlp.exe" if sys.platform == "win32" else "yt-dlp"

# yt-dlp releases daily-ish; checking more often than this only burns GitHub's rate limit.
CHECK_INTERVAL = timedelta(hours=24)

VIDEO_FORMAT = "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4][height<=1080]"

# Marks our own progress lines so they cannot be confused with yt-dlp's normal output.
_PROGRESS_PREFIX = "[wingman]"
_PROGRESS_TEMPLATE = f"download:{_PROGRESS_PREFIX} %(progress._percent_str)s"
_PROGRESS_LINE = re.compile(rf"{re.escape(_PROGRESS_PREFIX)}\s*([\d.]+)\s*%")

_STDERR_TAIL_LINES = 10


class _ReleaseAsset(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    browser_download_url: str


class _Release(BaseModel):
    model_config = ConfigDict(extra="ignore")

    tag_name: str
    assets: list[_ReleaseAsset]


class _CheckState(BaseModel):
    model_config = ConfigDict(extra="ignore")

    checked_at: datetime


def managed_ytdlp_path(data_dir: Path) -> Path:
    return data_dir / "bin" / ASSET_NAME


async def ensure_ytdlp(
    session: AsyncSession, data_dir: Path, client: httpx.AsyncClient | None = None
) -> Path:
    """The yt-dlp to run. A configured path is used as it is (the user manages it);
    otherwise Wingman's own copy is downloaded or updated as needed."""
    configured = str(await SettingsService(session).get(YTDLP_PATH_SETTING)).strip()
    if configured:
        return Path(configured)
    binary = managed_ytdlp_path(data_dir)
    await ensure_updated(binary, client)
    return binary


async def ensure_updated(binary: Path, client: httpx.AsyncClient | None = None) -> None:
    """Install `binary` if it is missing, else update it when a newer release exists —
    at most one GitHub check per `CHECK_INTERVAL`. Raises `DownloadError` if a missing
    binary cannot be installed; a failed *update* only logs, the old binary still runs."""
    if client is not None:
        await _ensure_updated(binary, client)
        return
    async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as owned:
        await _ensure_updated(binary, owned)


async def _ensure_updated(binary: Path, client: httpx.AsyncClient) -> None:
    if not await asyncio.to_thread(binary.is_file):
        logger.info("yt-dlp is missing, downloading it to %s", binary)
        await _install(binary, client)
        return
    if not await asyncio.to_thread(_check_is_due, binary):
        return
    try:
        release = await _latest_release(client)
    except (httpx.HTTPError, ValidationError) as error:
        logger.warning("could not check for a yt-dlp update: %s", error)
        return
    # Recorded even when the update itself fails: a broken GitHub must not mean a
    # request per download.
    await asyncio.to_thread(_write_check_state, binary)
    current = await _installed_version(binary)
    if current == release.tag_name:
        logger.debug("yt-dlp %s is up to date", current)
        return
    logger.info("updating yt-dlp from %s to %s", current, release.tag_name)
    try:
        await _install(binary, client, release)
    except DownloadError as error:
        # The installed binary still works; only the update failed.
        logger.warning("yt-dlp update failed, keeping %s: %s", current, error)


async def _install(
    binary: Path, client: httpx.AsyncClient, release: _Release | None = None
) -> None:
    try:
        if release is None:
            release = await _latest_release(client)
        asset = next((one for one in release.assets if one.name == ASSET_NAME), None)
        if asset is None:
            raise DownloadError(f"the yt-dlp release {release.tag_name} has no {ASSET_NAME}")
        response = await client.get(asset.browser_download_url)
        response.raise_for_status()
        await asyncio.to_thread(_write_binary, binary, response.content)
    except (httpx.HTTPError, ValidationError, OSError) as error:
        raise DownloadError(f"could not download yt-dlp: {error}") from error
    await asyncio.to_thread(_write_check_state, binary)
    logger.info("installed yt-dlp %s at %s", release.tag_name, binary)


async def _latest_release(client: httpx.AsyncClient) -> _Release:
    response = await client.get(LATEST_RELEASE_URL)
    response.raise_for_status()
    return _Release.model_validate_json(response.content)


async def _installed_version(binary: Path) -> str | None:
    """`None` when the binary cannot be asked — it is then replaced rather than trusted."""
    try:
        process = await asyncio.create_subprocess_exec(
            str(binary),
            "--version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
    except OSError as error:
        logger.warning("cannot run %s: %s", binary, error)
        return None
    stdout, _ = await process.communicate()
    if process.returncode != 0:
        return None
    return stdout.decode(errors="replace").strip() or None


def _state_file(binary: Path) -> Path:
    # yt-dlp.exe and yt-dlp both give yt-dlp.json.
    return binary.with_suffix(".json")


def _check_is_due(binary: Path) -> bool:
    """Blocking."""
    path = _state_file(binary)
    if not path.is_file():
        return True
    try:
        state = _CheckState.model_validate_json(path.read_bytes())
    except (ValidationError, OSError) as error:
        logger.debug("ignoring %s: %s", path, error)
        return True
    return datetime.now(UTC) - state.checked_at >= CHECK_INTERVAL


def _write_check_state(binary: Path) -> None:
    """Blocking."""
    path = _state_file(binary)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"checked_at": datetime.now(UTC).isoformat()}), encoding="utf-8")


def _write_binary(binary: Path, content: bytes) -> None:
    """Blocking. Written next to the target first: a half-downloaded yt-dlp that is
    already in place would fail every download until the next update check."""
    binary.parent.mkdir(parents=True, exist_ok=True)
    partial = binary.with_suffix(".part")
    partial.write_bytes(content)
    if sys.platform != "win32":
        partial.chmod(0o755)
    partial.replace(binary)


async def download_video(
    executable: Path,
    url: str,
    destination: Path,
    report: ProgressReport,
    ffmpeg: str | None = None,
) -> Path:
    """Download `url` to exactly `destination`. `ffmpeg` is where yt-dlp finds the muxer
    it needs to join the separate best video and best audio streams."""
    args = ["--format", VIDEO_FORMAT, "--output", str(destination)]
    if ffmpeg:
        args += ["--ffmpeg-location", ffmpeg]
    await run_ytdlp(executable, [*args, "--", url], report)
    return destination


async def run_ytdlp(executable: Path, args: Sequence[str], report: ProgressReport) -> None:
    """Run yt-dlp, forwarding its download percentage to `report`. Raises `DownloadError`
    on a non-zero exit, with the tail of stderr as the message."""

    async def on_line(line: str) -> None:
        match = _PROGRESS_LINE.search(line)
        if match is None:
            logger.debug("yt-dlp: %s", line)
            return
        await report(float(match.group(1)), "downloading video")

    command = [
        str(executable),
        # Without --newline yt-dlp rewrites one line with \r and nothing is ever read.
        "--newline",
        "--progress-template",
        _PROGRESS_TEMPLATE,
        *args,
    ]
    await _run(command, on_line)


async def extract_audio(ffmpeg: str, video: Path, mp3_out: Path) -> Path:
    """Rip the audio track of `video` into an mp3 USDX can read."""
    await _run(
        [
            ffmpeg,
            # ffmpeg would otherwise stop and wait for a keypress if the file exists.
            "-y",
            "-i",
            str(video),
            "-vn",
            "-acodec",
            "libmp3lame",
            "-ac",
            "2",
            "-ab",
            "160k",
            "-ar",
            "48000",
            str(mp3_out),
        ]
    )
    return mp3_out


async def _run(
    command: Sequence[str], on_line: Callable[[str], Awaitable[None]] | None = None
) -> None:
    logger.debug("running %s", command)
    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except OSError as error:
        raise DownloadError(f"cannot run '{command[0]}': {error}") from error
    # Both pipes are read at the same time: a tool that fills the stderr buffer while we
    # only read stdout would block forever.
    errors = asyncio.create_task(_read_lines(process.stderr))
    await _forward(process.stdout, on_line)
    stderr = await errors
    code = await process.wait()
    if code != 0:
        tail = " ".join(stderr[-_STDERR_TAIL_LINES:]) or "no error output"
        raise DownloadError(f"{Path(command[0]).name} failed with exit code {code}: {tail}")


async def _forward(
    stream: asyncio.StreamReader | None, on_line: Callable[[str], Awaitable[None]] | None
) -> None:
    async for line in _lines(stream):
        if on_line is not None:
            await on_line(line)


async def _read_lines(stream: asyncio.StreamReader | None) -> list[str]:
    return [line async for line in _lines(stream)]


async def _lines(stream: asyncio.StreamReader | None) -> AsyncIterator[str]:
    if stream is None:
        return
    while True:
        raw = await stream.readline()
        if not raw:
            return
        line = raw.decode(errors="replace").strip()
        if line:
            yield line
