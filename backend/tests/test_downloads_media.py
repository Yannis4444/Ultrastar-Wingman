import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from ultrastar_wingman.downloads import media
from ultrastar_wingman.settings import SettingsService
from ultrastar_wingman.sources import DownloadError

ASSET_URL = "https://example.invalid/download/yt-dlp"
NEW_BINARY = b"a newer yt-dlp"


def fake_executable(directory: Path, name: str, body: str) -> Path:
    """A runnable stand-in for an external tool. The logic is a python script, wrapped in
    whatever the platform can hand to `create_subprocess_exec` — a `.py` file is not it.

    Windows only: the wrapper is a batch file, and cmd re-parses the arguments it forwards,
    so an unquoted `<` or `>` in one of them becomes a redirection. Real tools are called
    without a shell and are unaffected; arguments containing those characters (yt-dlp's
    `height<=1080` format) are checked without a subprocess instead.
    """
    script = directory / f"{name}.py"
    script.write_text(body, encoding="utf-8")
    if sys.platform == "win32":
        wrapper = directory / f"{name}.cmd"
        wrapper.write_text(f'@"{sys.executable}" "{script}" %*\n', encoding="utf-8")
    else:
        wrapper = directory / name
        wrapper.write_text(
            f'#!/bin/sh\nexec "{sys.executable}" "{script}" "$@"\n', encoding="utf-8"
        )
        wrapper.chmod(0o755)
    return wrapper


def release_response(tag: str) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "tag_name": tag,
            "assets": [
                {"name": "not-for-us", "browser_download_url": "https://example.invalid/other"},
                {"name": media.ASSET_NAME, "browser_download_url": ASSET_URL},
            ],
        },
    )


def github(tag: str, requests: list[str]) -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(str(request.url))
        if str(request.url) == media.LATEST_RELEASE_URL:
            return release_response(tag)
        if str(request.url) == ASSET_URL:
            return httpx.Response(200, content=NEW_BINARY)
        raise AssertionError(f"unexpected request to {request.url}")

    return httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=True)


@pytest.fixture
def requests() -> list[str]:
    """Every URL the MockTransport saw, in order."""
    return []


def write_state(binary: Path, age: timedelta) -> None:
    checked_at = datetime.now(UTC) - age
    binary.with_suffix(".json").write_text(
        json.dumps({"checked_at": checked_at.isoformat()}), encoding="utf-8"
    )


async def test_missing_binary_is_downloaded(tmp_path: Path, requests: list[str]) -> None:
    binary = media.managed_ytdlp_path(tmp_path)

    async with github("2030.01.01", requests) as client:
        await media.ensure_updated(binary, client)

    assert binary.read_bytes() == NEW_BINARY
    assert requests == [media.LATEST_RELEASE_URL, ASSET_URL]
    assert binary.with_suffix(".json").is_file()
    # No leftover partial file next to the binary.
    assert sorted(path.name for path in binary.parent.iterdir()) == [
        media.ASSET_NAME,
        "yt-dlp.json",
    ]


async def test_no_check_within_24h(tmp_path: Path, requests: list[str]) -> None:
    binary = tmp_path / media.ASSET_NAME
    binary.write_bytes(b"current")
    write_state(binary, timedelta(hours=3))

    async with github("2030.01.01", requests) as client:
        await media.ensure_updated(binary, client)

    assert requests == []
    assert binary.read_bytes() == b"current"


async def test_outdated_binary_is_replaced(tmp_path: Path, requests: list[str]) -> None:
    binary = fake_executable(tmp_path, "yt-dlp", "print('2020.01.01')")
    write_state(binary, timedelta(days=3))

    async with github("2030.01.01", requests) as client:
        await media.ensure_updated(binary, client)

    assert requests == [media.LATEST_RELEASE_URL, ASSET_URL]
    assert binary.read_bytes() == NEW_BINARY


async def test_current_binary_is_kept(tmp_path: Path, requests: list[str]) -> None:
    binary = fake_executable(tmp_path, "yt-dlp", "print('2030.01.01')")
    before = binary.read_bytes()
    write_state(binary, timedelta(days=3))

    async with github("2030.01.01", requests) as client:
        await media.ensure_updated(binary, client)

    assert requests == [media.LATEST_RELEASE_URL]
    assert binary.read_bytes() == before
    # The check happened, so the next call within 24h stays silent.
    assert not media._check_is_due(binary)


async def test_configured_ytdlp_path_wins(
    session: AsyncSession, tmp_path: Path, requests: list[str]
) -> None:
    await SettingsService(session).set("downloads.ytdlp_path", str(tmp_path / "mine.exe"))

    async with github("2030.01.01", requests) as client:
        resolved = await media.ensure_ytdlp(session, tmp_path, client)

    assert resolved == tmp_path / "mine.exe"
    assert requests == []


async def test_unmanaged_ytdlp_is_downloaded_into_the_data_dir(
    session: AsyncSession, tmp_path: Path, requests: list[str]
) -> None:
    async with github("2030.01.01", requests) as client:
        resolved = await media.ensure_ytdlp(session, tmp_path, client)

    assert resolved == tmp_path / "bin" / media.ASSET_NAME
    assert resolved.read_bytes() == NEW_BINARY


async def test_run_ytdlp_reports_progress(tmp_path: Path) -> None:
    # Mimics yt-dlp with --newline --progress-template: percentages on their own lines,
    # plus ordinary output that must not be mistaken for progress.
    ytdlp = fake_executable(
        tmp_path,
        "yt-dlp",
        "import sys\n"
        "print('[youtube] extracting the url')\n"
        "print('[wingman]   0.0%')\n"
        "print('[wingman]  50.5%')\n"
        "print('[wingman] 100.0%')\n"
        "open(sys.argv[-1], 'w').write(chr(10).join(sys.argv[1:-1]))\n",
    )
    reported: list[tuple[float | None, str]] = []

    async def report(percent: float | None, step: str) -> None:
        reported.append((percent, step))

    await media.run_ytdlp(ytdlp, [str(tmp_path / "argv.txt")], report)

    assert reported == [
        (0.0, "downloading video"),
        (50.5, "downloading video"),
        (100.0, "downloading video"),
    ]
    # The machine-readable progress output is not optional: without both flags nothing
    # above could have been parsed.
    assert (tmp_path / "argv.txt").read_text(encoding="utf-8").splitlines() == [
        "--newline",
        "--progress-template",
        media._PROGRESS_TEMPLATE,
    ]


async def test_download_video_builds_the_standard_arguments(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    recorded: list[str] = []

    async def fake_run(executable: Path, args: list[str], report: media.ProgressReport) -> None:
        recorded.extend(args)

    monkeypatch.setattr(media, "run_ytdlp", fake_run)

    async def report(percent: float | None, step: str) -> None:
        return None

    destination = await media.download_video(
        tmp_path / "yt-dlp", "https://youtu.be/abc", tmp_path / "video.mp4", report, "ffmpeg"
    )

    assert destination == tmp_path / "video.mp4"
    assert recorded == [
        "--format",
        media.VIDEO_FORMAT,
        "--output",
        str(tmp_path / "video.mp4"),
        "--ffmpeg-location",
        "ffmpeg",
        # Everything after it is a URL, so a title starting with a dash cannot become a flag.
        "--",
        "https://youtu.be/abc",
    ]


async def test_run_ytdlp_raises_with_the_stderr_tail(tmp_path: Path) -> None:
    ytdlp = fake_executable(
        tmp_path,
        "yt-dlp",
        "import sys\nprint('ERROR: video unavailable', file=sys.stderr)\nsys.exit(1)\n",
    )

    async def report(percent: float | None, step: str) -> None:
        raise AssertionError("no progress expected")

    with pytest.raises(DownloadError, match="video unavailable"):
        await media.run_ytdlp(ytdlp, [], report)


async def test_run_ytdlp_reports_a_missing_executable(tmp_path: Path) -> None:
    async def report(percent: float | None, step: str) -> None:
        return None

    with pytest.raises(DownloadError, match="cannot run"):
        await media.run_ytdlp(tmp_path / "not-there", [], report)


async def test_extract_audio_calls_ffmpeg(tmp_path: Path) -> None:
    ffmpeg = fake_executable(
        tmp_path,
        "ffmpeg",
        # One argument per line: a path with a space must not split into two.
        "import sys\nopen(sys.argv[-1], 'w').write(chr(10).join(sys.argv[1:-1]))\n",
    )
    video = tmp_path / "video.mp4"
    video.write_bytes(b"video")

    mp3 = await media.extract_audio(str(ffmpeg), video, tmp_path / "song.mp3")

    arguments = mp3.read_text(encoding="utf-8").splitlines()
    assert arguments[:2] == ["-y", "-i"]
    assert arguments[3:] == [
        "-vn",
        "-acodec",
        "libmp3lame",
        "-ac",
        "2",
        "-ab",
        "160k",
        "-ar",
        "48000",
    ]


async def test_extract_audio_raises_on_failure(tmp_path: Path) -> None:
    ffmpeg = fake_executable(
        tmp_path,
        "ffmpeg",
        "import sys\nprint('Invalid data found', file=sys.stderr)\nsys.exit(1)\n",
    )

    with pytest.raises(DownloadError, match="Invalid data found"):
        await media.extract_audio(str(ffmpeg), tmp_path / "video.mp4", tmp_path / "song.mp3")
