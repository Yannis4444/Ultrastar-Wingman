import io
import json
import shutil
import sys
import zipfile
from collections.abc import AsyncIterator
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

FFMPEG_ASSET_URL = "https://example.invalid/download/ffmpeg.zip"
FFMPEG_BINARY = b"a real ffmpeg is a hundred megabytes bigger than this"
FFMPEG_MEMBER = "ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe"


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


def ffmpeg_zip(member: str = FFMPEG_MEMBER) -> bytes:
    """A BtbN-shaped archive: the binary somewhere under `<build>/bin`, plus the rest of the
    build we never unpack."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("ffmpeg-master-latest-win64-gpl/README.txt", "not a binary")
        archive.writestr("ffmpeg-master-latest-win64-gpl/bin/ffplay.exe", b"not ours either")
        archive.writestr(member, FFMPEG_BINARY)
    return buffer.getvalue()


def ffmpeg_github(requests: list[str], asset: bytes | httpx.Response = b"") -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(str(request.url))
        if str(request.url) == media.FFMPEG_RELEASE_URL:
            return httpx.Response(
                200,
                json={
                    "tag_name": "latest",
                    "assets": [
                        {
                            "name": "ffmpeg-master-latest-linux64-gpl.tar.xz",
                            "browser_download_url": "https://example.invalid/other",
                        },
                        {
                            "name": media.FFMPEG_ASSET_NAME,
                            "browser_download_url": FFMPEG_ASSET_URL,
                        },
                    ],
                },
            )
        if str(request.url) == FFMPEG_ASSET_URL:
            return (
                asset if isinstance(asset, httpx.Response) else httpx.Response(200, content=asset)
            )
        raise AssertionError(f"unexpected request to {request.url}")

    return httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=True)


@pytest.fixture
def requests() -> list[str]:
    """Every URL the MockTransport saw, in order."""
    return []


@pytest.fixture
def windows_without_ffmpeg(monkeypatch: pytest.MonkeyPatch) -> None:
    """A Windows box with no ffmpeg anywhere on `PATH` — regardless of the host running the
    suite, so the managed download is exercised everywhere."""
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr(shutil, "which", lambda name: None)


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
        tmp_path / "yt-dlp",
        "https://youtu.be/abc",
        tmp_path / "video.mp4",
        report,
        "ffmpeg",
        format_string="best[height<=720]",
    )

    assert destination == tmp_path / "video.mp4"
    assert recorded == [
        "--format",
        "best[height<=720]",
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


async def test_configured_ffmpeg_is_used_as_it_is(
    session: AsyncSession, tmp_path: Path, requests: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    # An explicit override never falls back, so nothing may even look at PATH.
    monkeypatch.setattr(shutil, "which", lambda name: pytest.fail("PATH was searched"))
    await SettingsService(session).set(media.FFMPEG_SETTING, "C:/tools/ffmpeg.exe")

    async with ffmpeg_github(requests) as client:
        resolved = await media.ensure_ffmpeg(session, tmp_path, client)

    assert resolved == "C:/tools/ffmpeg.exe"
    assert requests == []


async def test_ffmpeg_on_the_path_is_used(
    session: AsyncSession, tmp_path: Path, requests: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(shutil, "which", lambda name: f"/usr/bin/{name}")

    async with ffmpeg_github(requests) as client:
        resolved = await media.ensure_ffmpeg(session, tmp_path, client)

    assert resolved == "/usr/bin/ffmpeg"
    assert requests == []
    assert not media.managed_ffmpeg_path(tmp_path).exists()


async def test_the_managed_ffmpeg_is_never_re_checked(
    session: AsyncSession,
    tmp_path: Path,
    requests: list[str],
    windows_without_ffmpeg: None,
) -> None:
    binary = media.managed_ffmpeg_path(tmp_path)
    binary.parent.mkdir(parents=True)
    binary.write_bytes(b"an ffmpeg from a year ago")

    async with ffmpeg_github(requests) as client:
        resolved = await media.ensure_ffmpeg(session, tmp_path, client)

    assert resolved == str(binary)
    assert requests == []
    assert binary.read_bytes() == b"an ffmpeg from a year ago"


async def test_missing_ffmpeg_is_downloaded_and_unpacked(
    session: AsyncSession,
    tmp_path: Path,
    requests: list[str],
    windows_without_ffmpeg: None,
) -> None:
    reported: list[tuple[float | None, str]] = []

    async def report(percent: float | None, step: str) -> None:
        reported.append((percent, step))

    async with ffmpeg_github(requests, ffmpeg_zip()) as client:
        resolved = await media.ensure_ffmpeg(session, tmp_path, client, report)

    binary = media.managed_ffmpeg_path(tmp_path)
    assert resolved == str(binary)
    assert binary.read_bytes() == FFMPEG_BINARY
    assert requests == [media.FFMPEG_RELEASE_URL, FFMPEG_ASSET_URL]
    # Only the binary is unpacked, and neither the archive nor a partial file is left behind.
    assert [path.name for path in binary.parent.iterdir()] == ["ffmpeg.exe"]
    assert [step for _, step in reported] == [media.FFMPEG_STEP] * len(reported)
    percents = [percent for percent, _ in reported if percent is not None]
    assert len(percents) == len(reported)
    assert percents == sorted(percents)
    assert percents[0] == 0.0
    assert percents[-1] == 100.0


async def test_a_build_without_ffmpeg_fails_without_leaving_anything(
    session: AsyncSession,
    tmp_path: Path,
    requests: list[str],
    windows_without_ffmpeg: None,
) -> None:
    archive = ffmpeg_zip("ffmpeg-master-latest-win64-gpl/bin/ffprobe.exe")

    async with ffmpeg_github(requests, archive) as client:
        with pytest.raises(DownloadError, match="contains no"):
            await media.ensure_ffmpeg(session, tmp_path, client)

    assert list(media.managed_ffmpeg_path(tmp_path).parent.iterdir()) == []


async def test_ffmpeg_is_not_downloaded_off_windows(
    session: AsyncSession, tmp_path: Path, requests: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(shutil, "which", lambda name: None)

    async with ffmpeg_github(requests) as client:
        with pytest.raises(DownloadError, match="install it"):
            await media.ensure_ffmpeg(session, tmp_path, client)

    assert requests == []


async def test_a_download_without_a_length_still_arrives_whole(
    session: AsyncSession,
    tmp_path: Path,
    requests: list[str],
    windows_without_ffmpeg: None,
) -> None:
    archive = ffmpeg_zip()

    async def body() -> AsyncIterator[bytes]:
        yield archive[:64]
        yield archive[64:]

    reported: list[tuple[float | None, str]] = []

    async def report(percent: float | None, step: str) -> None:
        reported.append((percent, step))

    # No content-length: httpx sends the body chunked, and there is no percentage to compute.
    async with ffmpeg_github(requests, httpx.Response(200, content=body())) as client:
        resolved = await media.ensure_ffmpeg(session, tmp_path, client, report)

    binary = media.managed_ffmpeg_path(tmp_path)
    assert resolved == str(binary)
    assert binary.read_bytes() == FFMPEG_BINARY
    assert reported == [(None, media.FFMPEG_STEP)]


async def test_a_mangled_content_length_only_costs_the_progress(
    session: AsyncSession,
    tmp_path: Path,
    requests: list[str],
    windows_without_ffmpeg: None,
) -> None:
    asset = httpx.Response(200, content=ffmpeg_zip(), headers={"content-length": "unknown"})
    reported: list[tuple[float | None, str]] = []

    async def report(percent: float | None, step: str) -> None:
        reported.append((percent, step))

    async with ffmpeg_github(requests, asset) as client:
        resolved = await media.ensure_ffmpeg(session, tmp_path, client, report)

    binary = media.managed_ffmpeg_path(tmp_path)
    assert resolved == str(binary)
    assert binary.read_bytes() == FFMPEG_BINARY
    assert reported == [(None, media.FFMPEG_STEP)]


async def test_the_member_name_cannot_choose_where_ffmpeg_lands(
    session: AsyncSession,
    tmp_path: Path,
    requests: list[str],
    windows_without_ffmpeg: None,
) -> None:
    # Member names come out of a GitHub release, so one is never used as an output path.
    root = tmp_path / "root"
    archive = ffmpeg_zip("../../../../escaped/bin/ffmpeg.exe")

    async with ffmpeg_github(requests, archive) as client:
        resolved = await media.ensure_ffmpeg(session, root / "data", client)

    binary = media.managed_ffmpeg_path(root / "data")
    assert resolved == str(binary)
    assert binary.read_bytes() == FFMPEG_BINARY
    # Nothing escaped the data dir.
    assert [path.name for path in root.iterdir()] == ["data"]


async def test_an_interrupted_download_leaves_nothing_to_trust(
    session: AsyncSession,
    tmp_path: Path,
    requests: list[str],
    windows_without_ffmpeg: None,
) -> None:
    archive = ffmpeg_zip()

    async def body() -> AsyncIterator[bytes]:
        yield archive[:64]
        raise httpx.ReadError("the connection died halfway")

    async with ffmpeg_github(requests, httpx.Response(200, content=body())) as client:
        with pytest.raises(DownloadError, match="could not download ffmpeg"):
            await media.ensure_ffmpeg(session, tmp_path, client)

    # Not even the half-written archive: the next attempt must not resume from a stale one.
    assert list(media.managed_ffmpeg_path(tmp_path).parent.iterdir()) == []
