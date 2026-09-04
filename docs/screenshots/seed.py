"""Put a scratch Wingman into the state the documentation screenshots are taken from.

One command line brings the whole thing up::

    venv\\Scripts\\python.exe docs\\screenshots\\seed.py up

That creates a scratch data directory, writes the fake song library and the stand-in
launcher into it, starts the stand-in USDB server and a Wingman backend on their own
ports, and then fills the instance: accounts, players and their pictures, settings, a
library scan, two parties with their scores, wishes, favorites, playlists, tags, comments
and achievements. It leaves both processes running and prints everything the capture
harness needs — the port, the process ids, the cookies, the account passwords and the ids
of the seeded playlist, tag, achievement and songs.

The user's own Wingman (port 8080) and their real data directory are never touched. The
ports and the data directory here are this script's own; see ``docs/dev/verifying.md``.

Other subcommands, for putting one surface into one state without a full re-run::

    seed.py wishes --count 6      the wishlist page's state (four is the Home page's)
    seed.py downloads             write the running and the queued download row
    seed.py downloads --clear     take them away again
    seed.py host-seconds --base 4 --per-badge 2     back to the app's own timings
    seed.py release               let the stand-in launcher finish the song it is holding
    seed.py rewind                undo the songs a capture run sang, for another take
    seed.py info                  print the state file again
    seed.py teardown              kill what ``up`` started and delete the scratch directory

Everything the seed learns is written to ``<data dir>/screenshots.json``, so the
subcommands work from a different shell than the one that ran ``up``.

Two things are written straight into the database rather than through the API, because
there is no API for them: the two parties with their sings and scores (Wingman records
those by running Ultrastar Deluxe, which is exactly what a screenshot run must not do for
twenty-two songs), and the two download rows (a real download needs yt-dlp, ffmpeg and
the real USDB). Both use the app's own SQLAlchemy models, so the rows are the rows the
app would have written.
"""

from __future__ import annotations

import argparse
import contextlib
import gzip
import io
import json
import os
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))

import library  # noqa: E402
import scenario  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
VENV_PYTHON = REPO_ROOT / "venv" / "Scripts" / "python.exe"
DEFAULT_AVATARS = Path(__file__).resolve().parent / "avatars"
DEFAULT_DATA_DIR = Path(tempfile.gettempdir()) / "wingman-screenshots"

DEFAULT_PORT = 8091
DEFAULT_USDB_PORT = 8092

STATE_FILE = "screenshots.json"
BACKEND_LOG = "backend.log"
USDB_LOG = "fake-usdb.log"
# Written the moment the scratch directory is created, and the only thing that lets this
# script delete a directory. The state file cannot do that job: it is written last, so a
# run that died halfway through would leave a directory nothing may clean up. See
# `_scratch_only`.
MARKER_FILE = ".wingman-screenshots"

SESSION_COOKIE = "wingman_session"
GUEST_COOKIE = "wingman_guest"

# How long to wait for the backend to answer, and for a background achievement pass.
STARTUP_TIMEOUT = 90.0
PASS_TIMEOUT = 60.0


class SeedError(RuntimeError):
    """Something the person running the seed has to fix."""


# --- talking to the backend ---------------------------------------------------------------


@dataclass
class Api:
    """One caller's view of the backend: a base URL and their cookies."""

    base: str
    cookies: dict[str, str]

    def request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        response = httpx.request(
            method, f"{self.base}/api/v1{path}", cookies=self.cookies, timeout=60.0, **kwargs
        )
        if response.status_code >= 400:
            raise SeedError(f"{method} {path} answered {response.status_code}: {response.text}")
        return response

    def get(self, path: str, **kwargs: Any) -> Any:
        return self.request("GET", path, **kwargs).json()

    def post(self, path: str, **kwargs: Any) -> Any:
        return _body(self.request("POST", path, **kwargs))

    def put(self, path: str, **kwargs: Any) -> Any:
        return _body(self.request("PUT", path, **kwargs))

    def patch(self, path: str, **kwargs: Any) -> Any:
        return _body(self.request("PATCH", path, **kwargs))

    def delete(self, path: str, **kwargs: Any) -> Any:
        return _body(self.request("DELETE", path, **kwargs))

    def as_guest(self, guest_id: str) -> Api:
        return Api(base=self.base, cookies={GUEST_COOKIE: guest_id})


def _body(response: httpx.Response) -> Any:
    return None if response.status_code == 204 or not response.content else response.json()


def guest_id(name: str) -> str:
    """A stable browser id for a made-up guest. The cookie is 32 hex characters or the
    backend ignores it, and a stable one lets a later run take the same wish back."""
    return uuid.uuid5(uuid.NAMESPACE_URL, f"wingman-screenshots:{name}").hex


# --- the scratch instance -----------------------------------------------------------------


@dataclass
class State:
    """What ``up`` learned, and what every other subcommand reads back."""

    data: dict[str, Any]
    path: Path

    @classmethod
    def load(cls, data_dir: Path) -> State:
        path = data_dir / STATE_FILE
        if not path.is_file():
            raise SeedError(f"no state file at {path} — run 'seed.py up' first")
        return cls(data=json.loads(path.read_text(encoding="utf-8")), path=path)

    def save(self) -> None:
        self.path.write_text(json.dumps(self.data, indent=2) + "\n", encoding="utf-8")

    @property
    def api(self) -> Api:
        return Api(base=self.data["base_url"], cookies={SESSION_COOKIE: self.data["host_cookie"]})

    def user_api(self, username: str) -> Api:
        return Api(
            base=self.data["base_url"],
            cookies={SESSION_COOKIE: self.data["accounts"][username]["cookie"]},
        )


def start_backend(data_dir: Path, port: int) -> tuple[subprocess.Popen[bytes], Path]:
    """The backend against the scratch directory, with its log on disk so the host token
    can be read out of it."""
    log_path = data_dir / BACKEND_LOG
    environment = dict(os.environ)
    environment.update(
        {
            "WINGMAN_DATA_DIR": str(data_dir),
            "WINGMAN_PORT": str(port),
            "WINGMAN_OPEN_BROWSER": "false",
            "PYTHONUNBUFFERED": "1",
        }
    )
    handle = log_path.open("wb")
    process = subprocess.Popen(
        [str(VENV_PYTHON), "-m", "ultrastar_wingman"],
        cwd=str(REPO_ROOT),
        env=environment,
        stdout=handle,
        stderr=subprocess.STDOUT,
    )
    return process, log_path


def start_fake_usdb(data_dir: Path, port: int) -> subprocess.Popen[bytes]:
    handle = (data_dir / USDB_LOG).open("wb")
    return subprocess.Popen(
        [str(VENV_PYTHON), str(Path(__file__).with_name("fake_usdb.py")), "--port", str(port)],
        cwd=str(REPO_ROOT),
        stdout=handle,
        stderr=subprocess.STDOUT,
    )


def wait_for_backend(base: str, log_path: Path, process: subprocess.Popen[bytes]) -> str:
    """Wait until the API answers, and hand back the one-time host token from the log."""
    deadline = time.monotonic() + STARTUP_TIMEOUT
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise SeedError(f"the backend exited early — see {log_path}")
        try:
            if httpx.get(f"{base}/api/v1/health", timeout=5.0).status_code == 200:
                break
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    else:
        raise SeedError(f"the backend did not answer on {base} — see {log_path}")

    text = log_path.read_text(encoding="utf-8", errors="replace")
    marker = "hostToken="
    if marker not in text:
        raise SeedError(f"no host token in {log_path}")
    return text.split(marker, 1)[1].split()[0].strip()


def write_standin(usdx_dir: Path) -> Path:
    """The stand-in launcher, as Wingman's ``usdx.executable`` setting can point at it.

    A ``.cmd`` wrapper, because a Python file is not an executable on Windows and the
    launcher runs whatever that setting names. Same arrangement as the karaoke tests.
    """
    usdx_dir.mkdir(parents=True, exist_ok=True)
    script = usdx_dir / "standin_usdx.py"
    shutil.copyfile(Path(__file__).with_name("standin_usdx.py"), script)
    executable = usdx_dir / "ultrastardx.cmd"
    executable.write_text(f'@echo off\r\n"{VENV_PYTHON}" "{script}" %*\r\n', encoding="utf-8")
    return executable


# --- writing what has no API --------------------------------------------------------------


def _session_maker(data_dir: Path) -> Any:
    """A plain synchronous session on the scratch database.

    The app's own models, imported from the installed package, because SQLAlchemy stores
    a datetime in a format of its own and reads nothing else back: a hand-written
    ``INSERT`` with an ISO timestamp writes fine and then breaks every statistics page.
    The generous timeout is for the seconds the running backend may hold a write lock.

    ``NullPool`` so that closing the session really closes the file. A pooled connection
    would keep ``wingman.db`` open for the life of this process, and Windows refuses to
    delete an open file: ``capture.py`` seeds and tears down in one process, and the
    scratch directory would survive the teardown with the database still in it.
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import NullPool

    engine = create_engine(
        f"sqlite:///{(data_dir / 'wingman.db').as_posix()}",
        connect_args={"timeout": 30},
        poolclass=NullPool,
    )
    return sessionmaker(engine)


def write_history(
    data_dir: Path, players: dict[str, str], songs: dict[int, str]
) -> tuple[dict[str, str], str]:
    """The two parties, their sings and their scores.

    Answers each party's session id, and the moment the last seeded sing started —
    ``rewind`` needs it to tell the seeded history from what a capture run added.
    """
    from ultrastar_wingman.karaoke.model import KaraokeSession, Score, Sing, placements

    maker = _session_maker(data_dir)
    now = datetime.now(UTC)
    session_ids: dict[str, str] = {}
    last = now - timedelta(days=365)
    with maker() as db:
        for party in scenario.PARTIES:
            ends = now - timedelta(days=party.days_ago, minutes=party.ends_minutes_ago)
            moments = [ends - timedelta(minutes=sing.minute) for sing in party.sings]
            karaoke_session = KaraokeSession(
                name=party.name, started_at=min(moments), last_activity_at=max(moments)
            )
            db.add(karaoke_session)
            db.flush()
            session_ids[party.key] = karaoke_session.id
            last = max(last, max(moments))
            for sing_plan, moment in zip(party.sings, moments, strict=True):
                sing = Sing(
                    song_id=songs[sing_plan.usdb_id],
                    session_id=karaoke_session.id,
                    started_at=moment,
                    ended_at=moment + timedelta(minutes=4),
                )
                db.add(sing)
                db.flush()
                # The same ranking a sing recorded through USDX gets, so a seeded evening
                # carries the placements a real one does and an achievement counting wins
                # reads the same rows here. `placements` is the one rule both go through.
                ranks = placements([score for _, score in sing_plan.scores])
                for (name, score), placement in zip(sing_plan.scores, ranks, strict=True):
                    db.add(
                        Score(
                            sing_id=sing.id,
                            player_id=players[name],
                            player_name=name,
                            score=score,
                            difficulty=1,
                            placement=placement,
                            field_size=len(sing_plan.scores),
                            recorded_at=moment + timedelta(minutes=4),
                        )
                    )
        db.commit()
    return session_ids, last.isoformat()


def rewind_history(data_dir: Path, seeded_until: str) -> int:
    """Take away every sing recorded after the seed wrote its history.

    That is exactly the songs a capture run started through the stand-in launcher, so this
    is what puts the party back one song short of the achievement and lets the four
    launcher pictures be taken again without a full re-seed. Answers how many sings went.
    """
    from sqlalchemy import delete, select
    from ultrastar_wingman.karaoke.model import Score, Sing

    cutoff = datetime.fromisoformat(seeded_until)
    maker = _session_maker(data_dir)
    with maker() as db:
        sing_ids = list(db.scalars(select(Sing.id).where(Sing.started_at > cutoff)))
        if sing_ids:
            db.execute(delete(Score).where(Score.sing_id.in_(sing_ids)))
            db.execute(delete(Sing).where(Sing.id.in_(sing_ids)))
        db.commit()
    return len(sing_ids)


def write_downloads(data_dir: Path) -> list[int]:
    """The download panel's two rows, straight into the table.

    Written while the backend is up on purpose: the queue only reconciles at startup, so a
    ``running`` row written now is left exactly as it is instead of being failed as
    interrupted. Nothing ever moves them — no worker knows about them — which is what makes
    the picture hold still.
    """
    from ultrastar_wingman.downloads.model import Download

    maker = _session_maker(data_dir)
    now = datetime.now(UTC)
    written = []
    with maker() as db:
        for index, row in enumerate(scenario.DOWNLOADS):
            download = Download(
                source="usdb",
                source_song_id=str(row["source_song_id"]),
                title=str(row["title"]),
                artist=str(row["artist"]),
                status=str(row["status"]),
                progress=row["progress"],
                step=row["step"],
                created_at=now - timedelta(minutes=4 - index),
                updated_at=now - timedelta(seconds=20),
            )
            db.add(download)
            db.flush()
            written.append(download.id)
        db.commit()
    return written


def clear_downloads(data_dir: Path) -> int:
    from sqlalchemy import delete
    from ultrastar_wingman.downloads.model import Download

    maker = _session_maker(data_dir)
    with maker() as db:
        removed = db.execute(delete(Download)).rowcount
        db.commit()
    return int(removed)


def backdate_comments(data_dir: Path) -> None:
    """Age the comments the seed just wrote.

    The API stamps a comment with the moment it is said, so three of them written in one
    second all read "just now" — which is the one thing on the song modal that says a
    picture was staged. The ages come from ``scenario.COMMENTS`` and are days apart, so the
    three lines differ from each other as well.
    """
    from sqlalchemy import select
    from ultrastar_wingman.comments.model import SongComment

    maker = _session_maker(data_dir)
    now = datetime.now(UTC)
    with maker() as db:
        rows = list(db.scalars(select(SongComment).order_by(SongComment.id)))
        for comment, plan in zip(rows, scenario.COMMENTS, strict=False):
            comment.created_at = now - timedelta(hours=plan[3])
        db.commit()


def clear_wishes(data_dir: Path) -> None:
    from sqlalchemy import delete
    from ultrastar_wingman.library.model import Wish

    maker = _session_maker(data_dir)
    with maker() as db:
        db.execute(delete(Wish))
        db.commit()


# --- the seeding steps --------------------------------------------------------------------


def create_accounts(base: str) -> dict[str, dict[str, str]]:
    """The three accounts, in order. The first one ever created is the administrator."""
    accounts: dict[str, dict[str, str]] = {}
    for username, password in scenario.ACCOUNTS:
        response = httpx.post(
            f"{base}/api/v1/auth/register",
            json={"username": username, "password": password},
            timeout=30.0,
        )
        if response.status_code >= 400:
            raise SeedError(f"registering {username} failed: {response.text}")
        cookie = response.cookies.get(SESSION_COOKIE)
        if cookie is None:
            raise SeedError(f"registering {username} returned no session cookie")
        body = response.json()
        accounts[username] = {
            "user_id": body["id"],
            "player_id": body["player_id"],
            "role": body["role"],
            "password": password,
            "cookie": cookie,
        }
    return accounts


def create_guest_players(api: Api) -> dict[str, str]:
    players = {}
    for name in scenario.GUEST_PLAYERS:
        players[name] = api.post("/players", json={"name": name})["id"]
    return players


def upload_avatars(api: Api, players: dict[str, str], avatars_dir: Path) -> list[str]:
    """Every player's picture, as it lies on disk.

    Nothing is cropped or re-encoded: the repository has no image library and Wingman
    accepts a jpeg, png or webp of any shape. Names with no file are answered with, and
    keep the app's own initials avatar.
    """
    missing = []
    for name, player_id in players.items():
        stem = scenario.AVATAR_STEMS.get(name, name.casefold())
        found = sorted(avatars_dir.glob(f"{stem}.*")) if avatars_dir.is_dir() else []
        picture = next((path for path in found if path.suffix.lower() in AVATAR_TYPES), None)
        if picture is None:
            missing.append(name)
            continue
        content_type = AVATAR_TYPES[picture.suffix.lower()]
        api.put(
            f"/players/{player_id}/avatar",
            files={"file": (picture.name, picture.read_bytes(), content_type)},
        )
    return missing


AVATAR_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}


def apply_settings(api: Api, data_dir: Path, port: int, usdb_port: int) -> None:
    usdx_dir = data_dir / "usdx"
    values = {
        "usdx.base_path": str(usdx_dir),
        "usdx.executable": str(usdx_dir / "ultrastardx.cmd"),
        "songs.directory": str(usdx_dir / "songs"),
        "usdb.base_url": f"http://127.0.0.1:{usdb_port}",
        "usdb.username": scenario.USDB_USERNAME,
        "usdb.password": scenario.USDB_PASSWORD,
        "host.join_url": scenario.JOIN_URL,
        "downloads.parallel": 1,
    }
    for key, value in values.items():
        api.patch(f"/settings/{key}", json={"value": value})


def rescan(api: Api, expected: int) -> dict[int, str]:
    """Scan the library and wait for it. Answers the song id of every USDB id."""
    api.post("/songs/rescan")
    deadline = time.monotonic() + STARTUP_TIMEOUT
    songs: list[dict[str, Any]] = []
    while time.monotonic() < deadline:
        songs = api.get("/songs")["songs"]
        if len(songs) >= expected:
            break
        time.sleep(0.5)
    if len(songs) < expected:
        raise SeedError(f"the scan found {len(songs)} songs, expected {expected}")
    found = {}
    for song in songs:
        source, _, source_id = str(song["id"]).partition(":")
        if source != "usdb" or not source_id.isdigit():
            raise SeedError(f"song '{song['id']}' has no USDB id — is wingman.json missing?")
        found[int(source_id)] = song["id"]
    return found


def set_wishes(state: State, count: int) -> list[dict[str, Any]]:
    """Put exactly the first ``count`` wishes of the scenario on the wishlist.

    Every wish is taken back first, straight in the table: a wish belongs to whoever made
    it, so the API can only ever remove one caller's own.
    """
    clear_wishes(Path(state.data["data_dir"]))
    songs = state.data["songs"]
    for wish in scenario.WISHES[:count]:
        song_id = songs[str(wish.usdb_id)]
        for wisher in wish.wishers:
            api = (
                state.api.as_guest(guest_id(wisher.removeprefix("guest:")))
                if wisher.startswith("guest:")
                else state.user_api(wisher)
            )
            api.post("/wishlist", json={"song_id": song_id})
    return state.api.get("/wishlist")["wishes"]


def add_favorites(state: State) -> None:
    for username, usdb_ids in scenario.FAVORITES.items():
        api = state.user_api(username)
        for usdb_id in usdb_ids:
            api.put(f"/favorites/{state.data['songs'][str(usdb_id)]}")


def create_playlists(state: State) -> list[dict[str, str]]:
    created = []
    for plan in scenario.PLAYLISTS:
        api = state.user_api(plan.owner)
        playlist = api.post(
            "/playlists",
            json={
                "name": plan.name,
                "description": plan.description,
                "is_global": plan.is_global,
            },
        )
        for usdb_id in plan.usdb_ids:
            api.post(
                f"/playlists/{playlist['id']}/entries",
                json={"song_id": state.data["songs"][str(usdb_id)]},
            )
        for username, access in plan.members:
            api.put(
                f"/playlists/{playlist['id']}/members",
                json={"user_id": state.data["accounts"][username]["user_id"], "access": access},
            )
        created.append({"id": playlist["id"], "name": plan.name, "owner": plan.owner})
    return created


def create_tags(state: State) -> list[dict[str, str]]:
    api = state.api
    created = []
    for plan in scenario.TAGS:
        permissions: list[dict[str, str]] = []
        for role in plan.view_roles:
            permissions.append({"action": "view", "role": role})
            permissions.append({"action": "view_songs", "role": role})
        for role in plan.assign_roles:
            permissions.append({"action": "assign", "role": role})
        for username in plan.assign_users:
            # All three, not the assign alone: a person who may tag songs they cannot see
            # is a misconfiguration, and the editor says so in a warning box. The tag
            # editor's picture must not be of a tag set up wrongly.
            for action in ("view", "view_songs", "assign"):
                permissions.append(
                    {"action": action, "user_id": state.data["accounts"][username]["user_id"]}
                )
        tag = api.post(
            "/tags",
            json={
                "name": plan.name,
                "icon": plan.icon,
                "color": plan.color,
                "show_in_list": plan.show_in_list,
                "hide_by_default": plan.hide_by_default,
                "permissions": permissions,
            },
        )
        for usdb_id in plan.usdb_ids:
            api.put(f"/songs/{state.data['songs'][str(usdb_id)]}/tags/{tag['id']}")
        created.append({"id": tag["id"], "name": plan.name})
    return created


def add_comments(state: State) -> None:
    for usdb_id, username, body, _hours_ago in scenario.COMMENTS:
        state.user_api(username).post(
            f"/songs/{state.data['songs'][str(usdb_id)]}/comments", json={"body": body}
        )
    backdate_comments(Path(state.data["data_dir"]))


def achievement_archive() -> bytes:
    """The party's own achievements as an import archive.

    An archive rather than ``POST /achievements``: an import matches by id, so the two
    keep the ids ``scenario.py`` gives them and the documentation can name one.
    """
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w") as archive:
        for achievement in scenario.OWN_ACHIEVEMENTS:
            payload = json.dumps(achievement, indent=2).encode("utf-8")
            info = tarfile.TarInfo(f"{achievement['id']}/achievement.json")
            info.size = len(payload)
            info.mtime = 0
            archive.addfile(info, io.BytesIO(payload))
    return gzip.compress(raw.getvalue())


def import_achievements(api: Api) -> dict[str, Any]:
    return api.post(
        "/achievements/import",
        files={"file": ("achievements.tar.gz", achievement_archive(), "application/gzip")},
    )


def arrange_catalogue(api: Api) -> list[str]:
    """Put the party's own achievements at the head of the catalogue, with one of the built-ins
    that are hidden until they are earned just behind them.

    The catalogue is **one** order over all of it — a party's own achievement may sit above
    one Wingman ships — and the management page is photographed at the top of that list.
    Left the way the seed makes it, an imported achievement lands at the end and the hidden
    built-in *Brave Soul* sits near the end of a catalogue of thirty-five (`builtin.py` puts
    every hidden one there), so the two rows and the lock that picture is of would be several
    screens apart. Arranging them is what a host does with two achievements of their own, and
    this order is what every badge surface lists in, the host screen included.
    """
    rows = api.get("/achievements", params={"manage": "true"})["achievements"]
    was = [str(row["id"]) for row in rows]
    built_ins = [str(row["id"]) for row in rows if row["built_in"]]
    if scenario.LOCKED_BUILT_IN in built_ins:
        built_ins.remove(scenario.LOCKED_BUILT_IN)
        built_ins.insert(1, scenario.LOCKED_BUILT_IN)
    ids = [str(row["id"]) for row in rows if not row["built_in"]] + built_ins
    if ids == was:
        return ids
    api.put("/achievements/order", json={"ids": ids})
    return ids


def set_host_seconds(api: Api, base: int, per_badge: int) -> dict[str, Any]:
    return api.patch(
        "/achievements/settings",
        json={"host_seconds_base": base, "host_seconds_per_badge": per_badge},
    )


def wait_for_pending_achievement(api: Api, player_id: str, earned: bool = False) -> dict[str, Any]:
    """Wait until the background pass has counted the history and left the singer one song
    short of the achievement the documentation is about.

    Every catalogue write starts a full recomputation in the background, and until it has
    run nobody holds anything. A capture run that started the stand-in launcher before it
    finished would hand the singer a dozen badges at once instead of the two the
    ``host-achievements`` picture is of.
    """
    deadline = time.monotonic() + PASS_TIMEOUT
    standing: dict[str, Any] | None = None
    while time.monotonic() < deadline:
        rows = api.get(f"/players/{player_id}/achievements")["achievements"]
        standing = next(
            (row for row in rows if row["achievement_id"] == scenario.PENDING_ACHIEVEMENT), None
        )
        if (
            standing is not None
            and standing["progress_current"] is not None
            and (standing["earned_at"] is not None) == earned
        ):
            return standing
        time.sleep(0.5)
    raise SeedError(f"the achievement pass did not settle in time (last answer: {standing})")


# --- subcommands --------------------------------------------------------------------------


def _scratch_only(data_dir: Path) -> None:
    """Refuse to delete anything this script did not create.

    ``--data-dir`` is a path somebody types, and one of the paths they could type is their
    own ``WINGMAN_DATA_DIR`` — with their players, scores and songs in it. Every deletion
    goes through here first, and only a directory carrying the marker may go.
    """
    if not (data_dir / MARKER_FILE).is_file():
        raise SeedError(
            f"{data_dir} is not a screenshot scratch directory (no {MARKER_FILE} in it) — "
            "refusing to delete it"
        )


def command_up(arguments: argparse.Namespace) -> int:
    data_dir: Path = arguments.data_dir
    if data_dir.exists():
        if not arguments.reset:
            raise SeedError(
                f"{data_dir} already exists — run 'seed.py teardown' first, or pass --reset"
            )
        _scratch_only(data_dir)
        shutil.rmtree(data_dir)
    data_dir.mkdir(parents=True)
    (data_dir / MARKER_FILE).write_text(
        "This directory belongs to docs/screenshots/seed.py and is deleted by it.\n",
        encoding="utf-8",
    )

    base = f"http://127.0.0.1:{arguments.port}"
    usdx_dir = data_dir / "usdx"
    songs = library.load_songs()
    library.write_library(songs, usdx_dir / "songs")
    write_standin(usdx_dir)

    usdb_process = start_fake_usdb(data_dir, arguments.usdb_port)
    backend_process, log_path = start_backend(data_dir, arguments.port)
    try:
        token = wait_for_backend(base, log_path, backend_process)
        host_response = httpx.post(f"{base}/api/v1/auth/host", json={"token": token}, timeout=30.0)
        if host_response.status_code >= 400:
            raise SeedError(f"the host token was refused: {host_response.text}")
        host_cookie = host_response.cookies.get(SESSION_COOKIE)
        if host_cookie is None:
            raise SeedError("the host token exchange returned no session cookie")
        host = Api(base=base, cookies={SESSION_COOKIE: host_cookie})

        accounts = create_accounts(base)
        guests = create_guest_players(host)
        players = {name: entry["player_id"] for name, entry in accounts.items()} | guests
        missing = upload_avatars(host, players, arguments.avatars)
        host.patch(f"/players/{players[scenario.HIDDEN_PLAYER]}", json={"hidden": True})

        apply_settings(host, data_dir, arguments.port, arguments.usdb_port)
        song_ids = rescan(host, len(songs))

        session_ids, seeded_until = write_history(data_dir, players, song_ids)
        for party in scenario.PARTIES:
            if party.name is not None:
                host.patch(f"/stats/sessions/{session_ids[party.key]}", json={"name": party.name})

        state = State(
            data={
                "base_url": base,
                "port": arguments.port,
                "usdb_port": arguments.usdb_port,
                "data_dir": str(data_dir),
                "usdx_dir": str(usdx_dir),
                "songs_dir": str(usdx_dir / "songs"),
                "backend_pid": backend_process.pid,
                "usdb_pid": usdb_process.pid,
                "host_cookie": host_cookie,
                "session_cookie_name": SESSION_COOKIE,
                "guest_cookie_name": GUEST_COOKIE,
                "accounts": accounts,
                "players": players,
                "hidden_player": scenario.HIDDEN_PLAYER,
                "missing_avatars": missing,
                "songs": {str(usdb_id): song_id for usdb_id, song_id in song_ids.items()},
                "sessions": session_ids,
                "seeded_until": seeded_until,
                "guest_ids": {name: guest_id(name) for name in ("Amy", "Zoidberg", "Hermes")},
            },
            path=data_dir / STATE_FILE,
        )

        state.data["wishes"] = len(set_wishes(state, 4))
        add_favorites(state)
        state.data["playlists"] = create_playlists(state)
        state.data["tags"] = create_tags(state)
        add_comments(state)
        state.data["achievements_import"] = import_achievements(host)
        state.data["achievements_order"] = arrange_catalogue(host)
        set_host_seconds(host, scenario.HOST_SECONDS_BASE, scenario.HOST_SECONDS_PER_BADGE)
        state.data["download_ids"] = write_downloads(data_dir)
        state.data["pending_achievement"] = wait_for_pending_achievement(
            host, players[scenario.PENDING_SINGER]
        )
        state.save()
    except Exception:
        _kill(backend_process.pid)
        _kill(usdb_process.pid)
        raise

    _report(state, missing)
    return 0


def command_teardown(arguments: argparse.Namespace) -> int:
    data_dir: Path = arguments.data_dir
    path = data_dir / STATE_FILE
    if path.is_file():
        data = json.loads(path.read_text(encoding="utf-8"))
        for key in ("backend_pid", "usdb_pid"):
            pid = data.get(key)
            if pid:
                print(f"killing {key} {pid}")
                _kill(int(pid))
        _reap_standin(Path(data["usdx_dir"]))
    else:
        print(f"no state file in {data_dir} — nothing to kill")
    if data_dir.exists():
        _scratch_only(data_dir)
    # Windows keeps the database file open for a moment after the process holding it is
    # killed, so the first attempt right after a `taskkill` regularly leaves `wingman.db`
    # behind. Each attempt waits a little longer than the one before it.
    for attempt in range(6):
        if not data_dir.exists():
            break
        time.sleep(1.0 + attempt)
        shutil.rmtree(data_dir, ignore_errors=True)
    print(f"removed {data_dir}" if not data_dir.exists() else f"could not remove {data_dir}")
    return 0


def command_wishes(arguments: argparse.Namespace) -> int:
    state = State.load(arguments.data_dir)
    wishes = set_wishes(state, arguments.count)
    state.data["wishes"] = len(wishes)
    state.save()
    for wish in wishes:
        print(f"{wish['count']}x  {wish['song']['artist']} - {wish['song']['title']}")
    return 0


def command_downloads(arguments: argparse.Namespace) -> int:
    state = State.load(arguments.data_dir)
    data_dir = Path(state.data["data_dir"])
    if arguments.clear:
        print(f"removed {clear_downloads(data_dir)} download row(s)")
        state.data["download_ids"] = []
    else:
        clear_downloads(data_dir)
        state.data["download_ids"] = write_downloads(data_dir)
        print(f"wrote download rows {state.data['download_ids']}")
    state.save()
    return 0


def command_host_seconds(arguments: argparse.Namespace) -> int:
    state = State.load(arguments.data_dir)
    print(set_host_seconds(state.api, arguments.base, arguments.per_badge))
    return 0


def command_rewind(arguments: argparse.Namespace) -> int:
    """Undo the songs a capture run sang, so the launcher pictures can be taken again."""
    state = State.load(arguments.data_dir)
    # Before anything else: a stand-in that was killed instead of released is still waiting
    # for a sentinel, and would write its scores into whatever song runs next.
    _reap_standin(Path(state.data["usdx_dir"]))
    removed = rewind_history(Path(state.data["data_dir"]), state.data["seeded_until"])
    # Any edit to the catalogue starts a full recomputation, which is the only way to make
    # the engine notice that scores have gone. Writing the name it already has is the
    # smallest edit there is.
    api = state.api
    catalogue = api.get("/achievements", params={"manage": "true"})["achievements"]
    pending = next(row for row in catalogue if row["id"] == scenario.OWN_ACHIEVEMENTS[1]["id"])
    api.patch(f"/achievements/{pending['id']}", json={"name": pending["name"]})
    standing = wait_for_pending_achievement(
        api, state.data["players"][scenario.PENDING_SINGER], earned=False
    )
    print(f"removed {removed} sing(s)")
    print(
        f"{scenario.PENDING_ACHIEVEMENT} for {scenario.PENDING_SINGER}: "
        f"{standing['progress_current']} / {standing['progress_target']}"
    )
    return 0


def command_release(arguments: argparse.Namespace) -> int:
    """Let the held song finish. The stand-in takes the file away itself."""
    state = State.load(arguments.data_dir)
    work = Path(state.data["usdx_dir"]) / "standin"
    if not (work / "last-launch.json").is_file():
        raise SeedError("the stand-in launcher has not been started — nothing to release")
    payload: dict[str, Any] = {}
    if arguments.scores:
        payload["scores"] = json.loads(arguments.scores)
    work.mkdir(parents=True, exist_ok=True)
    (work / "release.json").write_text(json.dumps(payload), encoding="utf-8")
    print(f"released; wrote {work / 'release.json'}")
    return 0


def command_info(arguments: argparse.Namespace) -> int:
    state = State.load(arguments.data_dir)
    _report(state, state.data.get("missing_avatars", []))
    return 0


def _report(state: State, missing: list[str]) -> None:
    data = state.data
    print()
    print("=== Wingman screenshot instance ===")
    print(f"UI and API      {data['base_url']}")
    print(f"data directory  {data['data_dir']}")
    print(f"backend pid     {data['backend_pid']}")
    print(f"fake USDB pid   {data['usdb_pid']}  (port {data['usdb_port']})")
    print()
    print("cookies (set them on the browser before opening a page)")
    print(f"  {data['session_cookie_name']}={data['host_cookie']}   host, admin")
    for username, entry in data["accounts"].items():
        print(f"  {data['session_cookie_name']}={entry['cookie']}   {username} ({entry['role']})")
    print()
    print("accounts")
    for username, entry in data["accounts"].items():
        print(f"  {username:<10} password {entry['password']}  player {entry['player_id']}")
    print()
    print(f"players         {len(data['players'])}, hidden: {data['hidden_player']}")
    if missing:
        print(f"missing avatars {', '.join(sorted(missing))} (those players keep their initials)")
    else:
        print("missing avatars none")
    print(f"songs           {len(data['songs'])}")
    print(f"parties         {data['sessions']}")
    print(f"wishes on list  {data.get('wishes')}")
    for playlist in data.get("playlists", []):
        print(f"playlist        {playlist['id']}  {playlist['name']} ({playlist['owner']})")
    for tag in data.get("tags", []):
        print(f"tag             {tag['id']}  {tag['name']}")
    pending = data.get("pending_achievement") or {}
    print(
        f"achievement     {scenario.PENDING_ACHIEVEMENT} for {scenario.PENDING_SINGER}: "
        f"{pending.get('progress_current')} / {pending.get('progress_target')}"
    )
    print(f"finishing song  {data['songs'][str(scenario.FINISHING_SONG)]}")
    print(f"download rows   {data.get('download_ids')}")
    print()
    print("song ids the manifest names")
    for label, usdb_id in _NAMED_SONGS.items():
        print(f"  {label:<16} {data['songs'][str(usdb_id)]}")
    print()
    print("release the held song with:  seed.py release")
    print("tear everything down with:   seed.py teardown")


_NAMED_SONGS = {
    "I Got You Babe": 1104,
    "Sandstorm": 1101,
    "Tequila": 1102,
    "Rap God": 1103,
    "finishing song": scenario.FINISHING_SONG,
}


def _kill(pid: int) -> None:
    """Only ever a process this script started, and only by its id."""
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            check=False,
            capture_output=True,
        )
    else:
        with contextlib.suppress(OSError):
            os.kill(pid, signal.SIGTERM)


def _reap_standin(usdx_dir: Path) -> None:
    """Kill stand-in launchers that outlived their wrapper.

    The launcher starts a ``.cmd``; killing that does not take the Python process it
    started with it, exactly as in the karaoke tests. The stand-in writes its own id down
    for this.
    """
    pid_file = usdx_dir / "standin" / "pids.txt"
    if not pid_file.is_file():
        return
    for line in pid_file.read_text(encoding="utf-8").split():
        with contextlib.suppress(ValueError):
            _kill(int(line))
    # Emptied, not left lying: an id that has been killed once must never be killed again,
    # because by then it may belong to somebody else's process.
    pid_file.write_text("", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed a Wingman for documentation screenshots.")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=DEFAULT_DATA_DIR,
        help=f"the scratch data directory (default {DEFAULT_DATA_DIR})",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    up = subparsers.add_parser("up", help="create and fill the scratch instance")
    up.add_argument("--port", type=int, default=DEFAULT_PORT)
    up.add_argument("--usdb-port", type=int, default=DEFAULT_USDB_PORT)
    up.add_argument(
        "--avatars",
        type=Path,
        default=DEFAULT_AVATARS,
        help=f"the directory holding the player pictures (default {DEFAULT_AVATARS})",
    )
    up.add_argument("--reset", action="store_true", help="delete an existing scratch directory")
    up.set_defaults(handler=command_up)

    teardown = subparsers.add_parser("teardown", help="kill the processes and delete the directory")
    teardown.set_defaults(handler=command_teardown)

    wishes = subparsers.add_parser("wishes", help="put N wishes on the wishlist")
    wishes.add_argument("--count", type=int, default=4)
    wishes.set_defaults(handler=command_wishes)

    downloads = subparsers.add_parser("downloads", help="write or clear the download rows")
    downloads.add_argument("--clear", action="store_true")
    downloads.set_defaults(handler=command_downloads)

    host_seconds = subparsers.add_parser("host-seconds", help="retime the host screen badges")
    host_seconds.add_argument("--base", type=int, required=True)
    host_seconds.add_argument("--per-badge", type=int, required=True)
    host_seconds.set_defaults(handler=command_host_seconds)

    rewind = subparsers.add_parser(
        "rewind", help="undo the songs a capture run sang, for another launcher take"
    )
    rewind.set_defaults(handler=command_rewind)

    release = subparsers.add_parser("release", help="let the held song finish")
    release.add_argument("--scores", help="JSON, e.g. '{\"Bender\": 8421}'")
    release.set_defaults(handler=command_release)

    info = subparsers.add_parser("info", help="print the state file")
    info.set_defaults(handler=command_info)

    arguments = parser.parse_args()
    try:
        return int(arguments.handler(arguments))
    except SeedError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
