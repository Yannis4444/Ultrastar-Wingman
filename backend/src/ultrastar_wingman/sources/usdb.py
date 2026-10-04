"""USDB (usdb.animux.de) as a song source.

USDB has no API: there is a login form, an HTML result table and a download page with the
song text in a hidden form field. So this module is deliberately defensive — every request
may come back as the logged-out page instead of the expected one, and a row in the result
table may be missing any cell but artist and title.

Every URL is built from the `usdb.base_url` setting; nothing here hardcodes a host, so the
tests (and a future USDB.eu) can point it somewhere else.
"""

import asyncio
import logging
import re
import shutil
from collections import OrderedDict
from pathlib import Path
from typing import Literal

import httpx
from bs4 import BeautifulSoup, Tag
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..downloads import media
from ..downloads.model import QUEUED, RUNNING, Download
from ..settings import SettingsService
from ..songs.model import Song
from ..songs.scanner import SONGS_DIRECTORY
from ..songs.txt import SongTxt, SongTxtError, parse_song_txt
from .base import DownloadError, ProgressReport, register
from .progress import Phase, PhasedProgress

logger = logging.getLogger(__name__)

SOURCE_ID = "usdb"

# The steps of a download, as the UI shows them. Named because the progress plan below
# matches them by string.
TXT_STEP = "fetching the song text"
IMAGES_STEP = "fetching the images"
AUDIO_STEP = "extracting the audio"
LIBRARY_STEP = "moving the song into the library"

BASE_URL_SETTING = "usdb.base_url"
USERNAME_SETTING = "usdb.username"
PASSWORD_SETTING = "usdb.password"

LOGIN_PATH = "/?link=home"
BROWSE_PATH = "/?link=browse"
LIST_PATH = "/?link=list"
TXT_PATH = "/index.php?link=gettxt&id={usdb_id}"
COVER_PATH = "/data/cover/{usdb_id}.jpg"

# USDB answers a request without a valid session cookie with a normal 200 page — this
# sentence in it is the only way to tell that we are logged out.
LOGGED_OUT_MARKER = "You are not logged in"

UsdbOrder = Literal["id", "artist", "title", "edition", "rating", "language", "views", "golden"]
UsdbDirection = Literal["asc", "desc"]

DEFAULT_LIMIT = 30
MAX_LIMIT = 100

# How many cover answers (misses included) stay in memory. A page of results is 30 of them,
# so this holds the last handful of pages — enough that paging back and forth costs USDB
# nothing — while a jpeg thumbnail's worth of bytes each keeps the whole cache small.
COVER_CACHE_SIZE = 256
# What the old app used, and what makes sense for a karaoke night: best rated first.
DEFAULT_ORDER: UsdbOrder = "rating"
DEFAULT_DIRECTION: UsdbDirection = "desc"

# Column layout of the result table. Derived from the cells the old app's *working* indices
# addressed (its genre, year and creator reads were pasted from the wrong cell and are not
# part of this API): 0 artist — and the row's onclick with the song id —, 1 title, 2 genre,
# 3 year, 4 edition, 5 golden notes, 6 language, 7 creator, 8 rating, 9 views.
_ARTIST_CELL = 0
_TITLE_CELL = 1
_EDITION_CELL = 4
_GOLDEN_CELL = 5
_LANGUAGE_CELL = 6
_RATING_CELL = 8

# onclick="show_detail(1234)"
_ROW_ID = re.compile(r"\((\d+)\)")
# Page links are rendered as "[3]". Anything else is not a page number (a song title can be
# a bare number), so an unrecognized paginator means "page count unknown".
_PAGE_LINK = re.compile(r"\[(\d+)\]")
# USDB's #VIDEO tag is a comma separated meta string: "v=<youtube id>,co=...,bg=...".
# `a=` appears when only the audio comes from that video.
_YOUTUBE_ID = re.compile(r"\b[va]=([A-Za-z0-9_-]{6,})")
_BACKGROUND_META = re.compile(r"\bbg=([^,]+)")
_GOLDEN_YES = frozenset({"ja", "yes"})

# Tags whose USDB values name YouTube ids and remote images that USDX cannot read; the
# rewritten txt names the files we actually wrote instead.
_REPLACED_TAGS = frozenset({"VIDEO", "MP3", "AUDIO", "COVER", "BACKGROUND"})

_INVALID_NAME_CHARS = re.compile(r'[<>:"/\\|?*]')
_WINDOWS_RESERVED = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{number}" for number in range(1, 10)}
    | {f"LPT{number}" for number in range(1, 10)}
)
_MAX_NAME_LENGTH = 255

_UNFINISHED = (QUEUED, RUNNING)


class UsdbError(DownloadError):
    """USDB could not be used. A `DownloadError` on purpose: in the download path this
    message is exactly what the user has to read in the download row, and the API layer
    turns `code` into the response detail."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code} — {detail}" if detail else code)
        self.code = code


class UsdbLoginError(UsdbError):
    """No usable session: credentials missing, wrong, or rejected mid-operation."""


class UsdbStatus(BaseModel):
    """Whether Wingman has a usable USDB session. `error` is a machine-readable code."""

    logged_in: bool
    error: str | None = None


class UsdbSong(BaseModel):
    """One row of the USDB result table. Everything but artist and title may be missing —
    that table is rendered for humans, not for us."""

    usdb_id: int
    artist: str
    title: str
    edition: str | None = None
    language: str | None = None
    golden: bool = False
    rating: float | None = None
    # Already in the library, or on its way there.
    downloaded: bool = False


class UsdbSearchResult(BaseModel):
    results: list[UsdbSong]
    page: int
    pages: int | None = None


# Module state: one process, one USDB session — the login cookie lives in the client.
_client: httpx.AsyncClient | None = None
_lock = asyncio.Lock()
# Set as soon as the login state was established or refuted; None means "never checked".
_status: UsdbStatus | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None
_data_dir: Path | None = None
# usdb id -> (bytes, content type), or None for "USDB serves no cover for that id". An
# `OrderedDict` used as an LRU: the oldest entry goes once the cache is full.
_cover_cache: OrderedDict[int, tuple[bytes, str] | None] = OrderedDict()


def configure(session_factory: async_sessionmaker[AsyncSession], data_dir: Path) -> None:
    """Hand the source what the `SongSource` seam cannot: `download()` gets no session, but
    it needs the settings and the directory the managed yt-dlp lives in."""
    global _session_factory, _data_dir
    _session_factory = session_factory
    _data_dir = data_dir


async def aclose() -> None:
    """Drop the shared client, and with it the session cookie (shutdown)."""
    global _client, _status
    client, _client = _client, None
    _status = None
    _cover_cache.clear()
    if client is not None:
        await client.aclose()


async def status(session: AsyncSession, refresh: bool = False) -> UsdbStatus:
    """Whether USDB can be used. Cached — logging in for a search or a download refreshes it
    as a side effect; `refresh` throws the cache away and asks the site again."""
    global _status
    if refresh:
        _status = None
    if _status is None:
        try:
            await _ensure_login(session)
        except UsdbError as error:
            logger.debug("no USDB session: %s", error)
    verdict = _status
    # `_ensure_login` records a verdict either way; only a bug could leave none behind.
    return verdict if verdict is not None else UsdbStatus(logged_in=False, error="unknown")


async def search(
    session: AsyncSession,
    artist: str | None = None,
    title: str | None = None,
    order: UsdbOrder | None = None,
    direction: UsdbDirection | None = None,
    page: int = 1,
    limit: int = DEFAULT_LIMIT,
) -> UsdbSearchResult:
    """Search USDB. Raises `UsdbError` when the site cannot be reached or used."""
    page = max(1, page)
    limit = max(1, min(limit, MAX_LIMIT))
    form = {
        "interpret": artist or "",
        "title": title or "",
        "order": order or DEFAULT_ORDER,
        "ud": direction or DEFAULT_DIRECTION,
        "limit": str(limit),
        "start": str((page - 1) * limit),
    }
    response = await _post(session, LIST_PATH, form)
    results, pages = _parse_list(response.content)
    await _mark_downloaded(session, results)
    logger.debug("USDB search returned %d song(s) on page %d", len(results), page)
    return UsdbSearchResult(results=results, page=page, pages=pages)


async def cover(session: AsyncSession, usdb_id: int) -> tuple[bytes, str] | None:
    """The cover image USDB serves for a song id, with its content type — or `None` when
    there is none.

    USDB keeps every cover at a fixed path per song id, so this is one request for one static
    image, not a detail page that would have to be scraped. Answers are cached, misses
    included: a song without a cover must not be asked for again on every page flip, and
    paging back to results that were already on screen must cost USDB nothing.
    """
    if usdb_id in _cover_cache:
        _cover_cache.move_to_end(usdb_id)
        return _cover_cache[usdb_id]
    image = await _fetch_image(session, COVER_PATH.format(usdb_id=usdb_id))
    _cover_cache[usdb_id] = image
    while len(_cover_cache) > COVER_CACHE_SIZE:
        _cover_cache.popitem(last=False)
    return image


class UsdbSource:
    """USDB behind the `SongSource` seam. Searching and logging in are USDB-specific and
    stay in this module; the download queue only ever calls `download()`."""

    source = SOURCE_ID
    display_name = "USDB (usdb.animux.de)"

    async def download(self, source_song_id: str, work_dir: Path, report: ProgressReport) -> Path:
        if _session_factory is None or _data_dir is None:
            raise DownloadError("the USDB source is not configured")
        # The seam passes no session, so the download opens one of its own.
        async with _session_factory() as session:
            return await _download(session, source_song_id, work_dir, report, _data_dir)


# --- the download pipeline ---------------------------------------------------------------


# What the download consists of, and how much of the bar each part is worth — see
# `progress.PhasedProgress`. In the order the steps run: the tool downloads only happen on a
# fresh install and are skipped over on every later download, the video is the long one.
_PHASES = (
    Phase(TXT_STEP, 2),
    Phase(media.FFMPEG_STEP, 10),
    Phase(IMAGES_STEP, 4),
    Phase(media.VIDEO_STEP, 70, repeats=True),
    Phase(AUDIO_STEP, 12),
    Phase(LIBRARY_STEP, 2),
)


async def _download(
    session: AsyncSession,
    usdb_id: str,
    work_dir: Path,
    report: ProgressReport,
    data_dir: Path,
) -> Path:
    report = PhasedProgress(report, _PHASES)
    settings = SettingsService(session)
    library = str(await settings.get(SONGS_DIRECTORY)).strip()
    if not library:
        raise UsdbError("no_songs_directory", "set 'songs.directory' in the settings first")

    await report(None, TXT_STEP)
    txt = await _get_txt(session, usdb_id)
    header = _parse_header(txt)
    video_url = _youtube_url(header.video)
    target = Path(library) / _directory_name(header.artist, header.title, usdb_id)
    if await asyncio.to_thread(target.exists):
        raise UsdbError("directory_exists", str(target))
    ytdlp = await media.ensure_ytdlp(session, data_dir)
    # Resolved here, not at the top: fetching a missing ffmpeg is a download of its own, and
    # it must not happen before the cheap failures (no video, directory exists) had a say.
    ffmpeg = await media.ensure_ffmpeg(session, data_dir, report=report)

    await report(None, IMAGES_STEP)
    await _save_image(session, COVER_PATH.format(usdb_id=usdb_id), work_dir / "cover.jpg")
    background = await _save_background(session, header.video, work_dir / "background.jpg")
    await asyncio.to_thread(
        _write_txt, work_dir / f"{target.name}.txt", _rewrite(txt, background is not None)
    )

    await media.download_video(
        ytdlp,
        video_url,
        work_dir / "video.mp4",
        report,
        ffmpeg,
        format_string=await media.video_format(session),
    )
    await report(None, AUDIO_STEP)
    await media.extract_audio(ffmpeg, work_dir / "video.mp4", work_dir / "song.mp3")
    await report(None, LIBRARY_STEP)
    await asyncio.to_thread(_move_into_library, work_dir, target)
    logger.debug("downloaded USDB song %s to %s", usdb_id, target)
    return target


async def _get_txt(session: AsyncSession, usdb_id: str) -> str:
    """The song text out of the hidden form field on USDB's download page."""
    response = await _post(session, TXT_PATH.format(usdb_id=usdb_id), {"wd": "1"})
    field = BeautifulSoup(response.content, "html.parser").find("input", {"name": "txt"})
    value = field.get("value") if isinstance(field, Tag) else None
    if not isinstance(value, str) or not value.strip():
        raise UsdbError("txt_not_found", "check the USDB login")
    # USDB serves CRLF; USDX and our own parser are newline based.
    return value.replace("\r\n", "\n")


def _parse_header(txt: str) -> SongTxt:
    try:
        return parse_song_txt(txt)
    except SongTxtError as error:
        raise UsdbError("incomplete_txt", str(error)) from error


def _youtube_url(video: str | None) -> str:
    """The video is not optional: without it there is nothing to sing along to."""
    match = None if video is None else _YOUTUBE_ID.search(video)
    if match is None:
        raise UsdbError("no_video", "the USDB entry names no YouTube video")
    return f"https://www.youtube.com/watch?v={match.group(1)}"


def _rewrite(txt: str, background: bool) -> str:
    """Point the file tags at the files we wrote and keep every other line as it came."""
    header = ["#VIDEO:video.mp4", "#MP3:song.mp3", "#AUDIO:song.mp3", "#COVER:cover.jpg"]
    if background:
        header.append("#BACKGROUND:background.jpg")
    kept = [line for line in txt.split("\n") if not _is_replaced_tag(line)]
    text = "\n".join(header + kept)
    return text if text.endswith("\n") else f"{text}\n"


def _write_txt(path: Path, text: str) -> None:
    r"""Blocking. `newline="\n"`: on Windows python would otherwise translate every newline
    back to CRLF, undoing the normalization the rest of the pipeline relies on."""
    path.write_text(text, encoding="utf-8", newline="\n")


def _is_replaced_tag(line: str) -> bool:
    name, separator, _ = line.strip().lstrip("\ufeff").partition(":")
    # Compared on the tag name, not as a prefix: #VIDEOGAP is not a #VIDEO tag.
    return bool(separator) and name.strip().lstrip("#").upper() in _REPLACED_TAGS


async def _save_background(
    session: AsyncSession, video: str | None, destination: Path
) -> Path | None:
    """The background image, if the meta string names one. Best effort: a song without a
    background is normal, so nothing here is fatal."""
    url = _background_url(video)
    if url is None:
        return None
    return await _save_image(session, url, destination)


def _background_url(video: str | None) -> str | None:
    match = None if video is None else _BACKGROUND_META.search(video)
    url = "" if match is None else match.group(1).strip()
    if not url:
        return None
    # The meta string carries the URL with the scheme stripped.
    return url if url.startswith(("http://", "https://")) else f"https://{url}"


async def _save_image(session: AsyncSession, url: str, destination: Path) -> Path | None:
    """Write a fetched image to disk, or do nothing at all."""
    image = await _fetch_image(session, url)
    if image is None:
        return None
    await asyncio.to_thread(destination.write_bytes, image[0])
    return destination


async def _fetch_image(session: AsyncSession, url: str) -> tuple[bytes, str] | None:
    """Fetch an image and its content type, or nothing. A missing cover is answered with an
    HTML error page — the logged-out page is one too — and the old app saved that as
    cover.jpg, so the content type decides, not the status code alone."""
    client = await _http(session)
    try:
        response = await client.get(url)
    except httpx.HTTPError as error:
        logger.debug("could not fetch %s: %s", url, error)
        return None
    content_type = response.headers.get("content-type", "")
    if response.status_code != 200 or not content_type.startswith("image/"):
        logger.debug(
            "no image at %s (status %d, %s)",
            url,
            response.status_code,
            content_type or "no content type",
        )
        return None
    return response.content, content_type


def _directory_name(artist: str, title: str, usdb_id: str) -> str:
    """`<Artist> - <Title> (<usdb id>)`, minus everything Windows refuses in a name. The id
    keeps two versions of the same song apart."""
    name = _INVALID_NAME_CHARS.sub("", f"{artist} - {title} ({usdb_id})").strip()
    name = name[:_MAX_NAME_LENGTH].strip()
    if name.upper() in _WINDOWS_RESERVED:
        return f"_{name}"
    return name or f"usdb-{usdb_id}"


def _move_into_library(work_dir: Path, target: Path) -> None:
    """Blocking. File by file: the scratch directory is on the system drive and the library
    often is not, so a rename across devices would fail. `mkdir` without `exist_ok` is the
    last guard against two downloads of the same song racing here."""
    target.mkdir(parents=True)
    for entry in sorted(work_dir.iterdir()):
        shutil.move(str(entry), str(target / entry.name))


# --- the result table --------------------------------------------------------------------


def _parse_list(html: bytes) -> tuple[list[UsdbSong], int | None]:
    soup = BeautifulSoup(html, "html.parser")
    songs = [song for row in soup.find_all("tr") if (song := _parse_row(row)) is not None]
    return songs, _parse_pages(soup)


def _parse_row(row: Tag) -> UsdbSong | None:
    """A row is a song when it carries a song id; header and layout rows do not."""
    cells = row.find_all("td")
    if len(cells) <= _TITLE_CELL:
        return None
    usdb_id = _row_id(row, cells[_ARTIST_CELL])
    if usdb_id is None:
        return None
    return UsdbSong(
        usdb_id=usdb_id,
        artist=cells[_ARTIST_CELL].get_text(strip=True),
        title=cells[_TITLE_CELL].get_text(strip=True),
        edition=_cell_text(cells, _EDITION_CELL),
        language=_cell_text(cells, _LANGUAGE_CELL),
        golden=(_cell_text(cells, _GOLDEN_CELL) or "").casefold() in _GOLDEN_YES,
        rating=_rating(cells),
    )


def _row_id(row: Tag, first_cell: Tag) -> int | None:
    """The song id exists only in an onclick handler (`show_detail(1234)`) — USDB puts it on
    the cells, but a row-level handler is just as plausible a layout."""
    for handler in (first_cell.get("onclick"), row.get("onclick")):
        match = _ROW_ID.search(handler) if isinstance(handler, str) else None
        if match is not None:
            return int(match.group(1))
    return None


def _cell_text(cells: list[Tag], index: int) -> str | None:
    """`None`, not an empty string: a cell USDB did not render carries no information."""
    if index >= len(cells):
        return None
    return cells[index].get_text(strip=True) or None


def _rating(cells: list[Tag]) -> float | None:
    """Stars as images. A cell without any star image has no rating — which is not the same
    as a rating of zero."""
    if len(cells) <= _RATING_CELL:
        return None
    images = [
        str(image.get("src") or "").rsplit("/", 1)[-1]
        for image in cells[_RATING_CELL].find_all("img")
    ]
    stars = [name for name in images if "star" in name]
    if not stars:
        return None
    # `no_star` images pad the row to five stars; only full and half ones count.
    return sum(
        0.5 if name.startswith("half") else 1.0 for name in stars if not name.startswith("no")
    )


def _parse_pages(soup: BeautifulSoup) -> int | None:
    """The highest page number the paginator links to. `None` when there is no paginator to
    read — a single page of results has none."""
    numbers = [
        int(match.group(1))
        for link in soup.find_all("a")
        if (match := _PAGE_LINK.fullmatch(link.get_text(strip=True))) is not None
    ]
    return max(numbers) if numbers else None


async def _mark_downloaded(session: AsyncSession, songs: list[UsdbSong]) -> None:
    """A song counts as downloaded once it is in the library or a download for it is on its
    way — the UI must not offer the same song twice."""
    if not songs:
        return
    source_ids = [str(song.usdb_id) for song in songs]
    song_ids = [f"{SOURCE_ID}:{source_id}" for source_id in source_ids]
    in_library = set(await session.scalars(select(Song.id).where(Song.id.in_(song_ids))))
    queued = set(
        await session.scalars(
            select(Download.source_song_id).where(
                Download.source == SOURCE_ID,
                Download.status.in_(_UNFINISHED),
                Download.source_song_id.in_(source_ids),
            )
        )
    )
    for song in songs:
        song.downloaded = f"{SOURCE_ID}:{song.usdb_id}" in in_library or str(song.usdb_id) in queued


# --- session handling --------------------------------------------------------------------


async def _http(session: AsyncSession) -> httpx.AsyncClient:
    """The process-wide client. Its base URL is read once — like every other connection
    setting, changing `usdb.base_url` takes effect on the next restart."""
    global _client
    if _client is None:
        base_url = str(await SettingsService(session).get(BASE_URL_SETTING)).strip().rstrip("/")
        _client = httpx.AsyncClient(base_url=base_url, follow_redirects=True, timeout=60.0)
    return _client


async def _post(session: AsyncSession, path: str, data: dict[str, str]) -> httpx.Response:
    """POST with a logged-in session, logging in again once when the answer turns out to be
    the logged-out page — USDB expires the cookie server side whenever it feels like it."""
    global _status
    await _ensure_login(session)
    client = await _http(session)
    response = await _request(client, "POST", path, data)
    if LOGGED_OUT_MARKER not in response.text:
        return response
    logger.debug("the USDB session expired, logging in again")
    _status = None
    await _ensure_login(session)
    response = await _request(client, "POST", path, data)
    if LOGGED_OUT_MARKER in response.text:
        raise UsdbLoginError("login_failed", "USDB keeps answering as logged out")
    return response


async def _ensure_login(session: AsyncSession) -> None:
    """Log in unless this process already has a session, serialized so two parallel
    downloads do not both log in. Records the verdict for the status endpoint: a download
    that fails on the login is exactly what it should report."""
    global _status
    async with _lock:
        if _status is not None and _status.logged_in:
            return
        try:
            await _login(session)
        except UsdbError as error:
            _status = UsdbStatus(logged_in=False, error=error.code)
            raise
        _status = UsdbStatus(logged_in=True)


async def _login(session: AsyncSession) -> None:
    """Post the credentials and verify that they worked. Never prompts: bad credentials are
    reported through the status endpoint, not on a console nobody is watching."""
    settings = SettingsService(session)
    username = str(await settings.get(USERNAME_SETTING)).strip()
    password = str(await settings.get(PASSWORD_SETTING))
    if not username or not password:
        raise UsdbLoginError("no_credentials", "set the USDB username and password first")
    client = await _http(session)
    form = {"user": username, "pass": password, "login": "Login"}
    await _request(client, "POST", LOGIN_PATH, form)
    # The login answer looks the same either way, so the session is verified on a page that
    # says whether we are logged in.
    if LOGGED_OUT_MARKER in (await _request(client, "GET", BROWSE_PATH)).text:
        # The username stays in the log and out of the message: this message is stored on the
        # download row, and `download.updated` is broadcast to every websocket — including
        # the anonymous ones. Reading `usdb.username` otherwise needs `settings.view`.
        logger.warning("USDB rejected the login as '%s'", username)
        raise UsdbLoginError("invalid_credentials", "USDB rejected the configured account")
    logger.info("Logged in to USDB as '%s'", username)


async def _request(
    client: httpx.AsyncClient, method: str, path: str, data: dict[str, str] | None = None
) -> httpx.Response:
    try:
        response = await client.request(method, path, data=data)
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise UsdbError("unreachable", f"{client.base_url}: {error}") from error
    return response


register(UsdbSource())
