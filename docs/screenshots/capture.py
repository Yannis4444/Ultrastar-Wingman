"""Take every screenshot the documentation manifest asks for.

One command line does the whole set, from an empty machine::

    venv\\Scripts\\python.exe docs\\screenshots\\capture.py --all

That seeds a scratch Wingman (``seed.py up``), starts a headless Chrome, walks the
manifest row by row, and writes one PNG per row under
``docs/user/assets/screenshots/<section>/<id>.png``. Then it kills everything it started
and deletes the scratch directory.

The manifest is section 6 of ``docs/dev/documentation.md`` and nothing else: the table is
parsed out of that file, and every id in it has to have a row in ``ROWS`` below. A row
without a manifest entry, or a manifest entry without a row, stops the run before Chrome
is started, because either one means a picture the site asks for is not being taken.

The frontend has to be built once (``npm run build`` in ``frontend/``); the backend serves
``frontend/dist``. See ``docs/dev/screenshots.md`` for the whole procedure.
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import json
import re
import struct
import subprocess
import sys
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
from websockets.sync.client import connect

sys.path.insert(0, str(Path(__file__).resolve().parent))

import scenario  # noqa: E402
import seed  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_FILE = REPO_ROOT / "docs" / "dev" / "documentation.md"
OUTPUT_ROOT = REPO_ROOT / "docs" / "user" / "assets" / "screenshots"
FRONTEND_INDEX = REPO_ROOT / "frontend" / "dist" / "index.html"

DEFAULT_CHROME = Path("C:/Program Files (x86)/Google/Chrome/Application/chrome.exe")
DEFAULT_CDP_PORT = 9346

# The two viewports section 6 fixes. A phone shot is 780x1688 pixels, a host shot 1280x720.
VIEWPORTS: dict[str, dict[str, Any]] = {
    "phone": {"width": 390, "height": 844, "deviceScaleFactor": 2, "mobile": True},
    "host": {"width": 1280, "height": 720, "deviceScaleFactor": 1, "mobile": False},
}

# Wingman calls a device offline fifteen seconds after its last report. A row that held the
# selector online waits this out before the next picture, so the host screen's
# "Player selector offline" line never lands in a picture that is not about it.
DEVICE_OFFLINE_S = 16.0

# How long one row may take from navigation to "the element is there".
READY_TIMEOUT = 30.0
# The launcher rows wait on Ultrastar Deluxe finishing and on Wingman importing its scores.
LAUNCHER_TIMEOUT = 180.0

# The launcher takes. Which song and which singers matters; see docs/dev/screenshots.md.
RESULTS_SONG = 1218  # Walking on Sunshine: Fry sings it, and earns nothing by it
RESULTS_SINGERS = ("Fry", "Leela")
BADGE_SONG = scenario.FINISHING_SONG
BADGE_SINGER = scenario.PENDING_SINGER
# Under 9,000 on purpose: a higher one moves another built-in's progress and changes a
# number the picture is not about.
BADGE_SCORE = 8421


class CaptureError(RuntimeError):
    """Something the person running the capture has to fix."""


# --- the manifest -------------------------------------------------------------------------

# | `home` | `party/index.md` | `/` | … — the id and the page it belongs to.
MANIFEST_ROW = re.compile(r"^\|\s*`([a-z0-9-]+)`\s*\|\s*`([^`]+)`\s*\|")


def read_manifest(path: Path = MANIFEST_FILE) -> dict[str, str]:
    """The manifest as ``id -> section``, straight out of the documentation guidelines.

    The section is the first path segment of the row's Page column, which is where section
    6 says the file goes: ``docs/user/assets/screenshots/<section>/<id>.png``.
    """
    lines = path.read_text(encoding="utf-8").splitlines()
    try:
        start = next(i for i, line in enumerate(lines) if line.startswith("### Screenshot"))
    except StopIteration:  # pragma: no cover - the guideline file would have to change
        raise CaptureError(f"no screenshot manifest in {path}") from None
    found: dict[str, str] = {}
    for line in lines[start:]:
        if line.startswith("## "):
            break
        match = MANIFEST_ROW.match(line)
        if match is not None:
            found[match.group(1)] = match.group(2).split("/")[0]
    if not found:
        raise CaptureError(f"the manifest table in {path} parsed to nothing")
    return found


def check_manifest(manifest: dict[str, str]) -> None:
    """The manifest and this file have to name the same pictures, one for one."""
    missing = sorted(set(manifest) - set(ROWS))
    extra = sorted(set(ROWS) - set(manifest))
    problems = []
    if missing:
        problems.append(f"the manifest asks for {', '.join(missing)}, which capture.py cannot take")
    if extra:
        problems.append(f"capture.py takes {', '.join(extra)}, which the manifest does not ask for")
    if problems:
        raise CaptureError(
            "; ".join(problems) + f" — {MANIFEST_FILE} section 6 and ROWS in this file disagree"
        )


# --- driving one page ---------------------------------------------------------------------

# Helpers every step and every readiness check is written against. React ignores a plain
# `element.value = …`, so `setValue` goes through the prototype's own setter and fires the
# events React listens for.
PRELUDE = """
const q = (selector) => document.querySelector(selector);
const qa = (selector) => Array.from(document.querySelectorAll(selector));
const text = (element) => (element ? (element.textContent || "").trim() : "");
const byText = (selector, needle) =>
  qa(selector).find((element) =>
    text(element).toLowerCase().includes(String(needle).toLowerCase()),
  );
const click = (element) => {
  if (!element) throw new Error("nothing to click");
  element.click();
  return true;
};
const setValue = (element, value) => {
  if (!element) throw new Error("no field to fill in");
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
};
const show = (element, block) => {
  if (!element) throw new Error("nothing to scroll to");
  element.scrollIntoView({ block: block || "start" });
  return true;
};
// Scroll just far enough that the element's foot clears the bottom tab bar. For a row that
// is one line below the fold, this moves far less of the page than `scrollIntoView` would.
const showAbove = (element, margin) => {
  if (!element) throw new Error("nothing to scroll to");
  const box = element.getBoundingClientRect();
  window.scrollBy(0, box.bottom - window.innerHeight + (margin || 110));
  return true;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Covers and avatars are `loading="lazy"`, and a headless Chrome that nobody scrolls by
// hand leaves them at `complete === false` for good — even the ones inside the viewport.
// Asking for them eagerly is what makes "every picture is in" an answerable question, and
// it is also what keeps a half-drawn cover out of the bottom of a shot.
const unlazy = () => {
  qa('img[loading="lazy"]').forEach((image) => {
    image.loading = "eager";
  });
};
// Only the pictures that are on screen, or just off it: one that is three screens down
// says nothing about the picture being taken, and neither does one in a folded-away block.
const onScreen = (element) => {
  const box = element.getBoundingClientRect();
  return (
    box.width > 0 && box.bottom > -200 && box.top < window.innerHeight + 200
  );
};
const loaded = () => {
  unlazy();
  return (
    document.readyState === "complete" &&
    Array.from(document.images)
      .filter(onScreen)
      .every((image) => image.complete) &&
    document.fonts.status === "loaded"
  );
};
"""


class Chrome:
    """A headless Chrome and one websocket to it.

    Every command is sent and answered before the next one goes out, so anything else that
    arrives on the socket in between is an event nobody asked for and is dropped.
    """

    def __init__(self, binary: Path, port: int, profile: Path) -> None:
        if not binary.is_file():
            raise CaptureError(f"no Chrome at {binary} — pass --chrome")
        profile.mkdir(parents=True, exist_ok=True)
        self.process = subprocess.Popen(
            [
                str(binary),
                "--headless=new",
                f"--remote-debugging-port={port}",
                f"--user-data-dir={profile}",
                "--no-first-run",
                "--no-default-browser-check",
                "--hide-scrollbars",
                "--disable-gpu",
                "--window-size=1280,900",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        # Said out loud, because a run that is killed rather than finished leaves this one
        # process behind and the state file knows nothing about it.
        print(f"chrome pid {self.process.pid}, debugging port {port}")
        # Everything from here on can fail — a port that never opens, a socket that is
        # refused — and a failing constructor hands the caller no object to close. The
        # process would outlive the run, so it is killed here rather than left.
        try:
            self.socket = connect(self._debugger_url(port), max_size=None, open_timeout=30)
        except BaseException:
            seed._kill(self.process.pid)
            raise
        self._next_id = 0

    def _debugger_url(self, port: int) -> str:
        deadline = time.monotonic() + 60.0
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise CaptureError("Chrome exited before it opened its debugging port")
            try:
                answer = httpx.get(f"http://127.0.0.1:{port}/json/version", timeout=2.0)
                return str(answer.json()["webSocketDebuggerUrl"])
            except (httpx.HTTPError, KeyError, ValueError):
                time.sleep(0.3)
        raise CaptureError(f"Chrome did not open its debugging port {port}")

    def call(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        session_id: str | None = None,
        timeout: float = 90.0,
    ) -> dict[str, Any]:
        self._next_id += 1
        message: dict[str, Any] = {"id": self._next_id, "method": method, "params": params or {}}
        if session_id is not None:
            message["sessionId"] = session_id
        self.socket.send(json.dumps(message))
        deadline = time.monotonic() + timeout
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                raise CaptureError(f"{method} did not answer in {timeout:.0f}s")
            answer = json.loads(self.socket.recv(timeout=left))
            if answer.get("id") != message["id"]:
                continue
            if "error" in answer:
                raise CaptureError(f"{method} failed: {answer['error']}")
            return dict(answer.get("result", {}))

    def close(self) -> None:
        with contextlib.suppress(OSError):
            self.socket.close()
        seed._kill(self.process.pid)


@dataclass
class Page:
    """One tab, in one identity's cookie jar, at one viewport."""

    chrome: Chrome
    target_id: str
    session_id: str

    def evaluate(self, code: str, timeout: float = 60.0) -> Any:
        """Run JavaScript with the prelude in scope and hand back what it answers."""
        expression = f"(async () => {{{PRELUDE}\nreturn ({code});\n}})()"
        result = self.chrome.call(
            "Runtime.evaluate",
            {"expression": expression, "awaitPromise": True, "returnByValue": True},
            session_id=self.session_id,
            timeout=timeout,
        )
        if "exceptionDetails" in result:
            details = result["exceptionDetails"]
            message = details.get("exception", {}).get("description") or details.get("text")
            raise CaptureError(f"page script failed: {message}")
        return result.get("result", {}).get("value")

    def truthy(self, code: str) -> bool:
        """The same, but a missing element is *false* rather than an exception — which is
        what a readiness check needs to be able to say while a page is still loading."""
        return bool(
            self.evaluate(
                f"await (async () => {{ try {{ return !!({code}); }}"
                " catch (error) { return false; } })()"
            )
        )

    def navigate(self, url: str) -> None:
        self.chrome.call("Page.navigate", {"url": url}, session_id=self.session_id)

    def await_ready(self, condition: str, label: str, timeout: float = READY_TIMEOUT) -> None:
        """Wait until the page has settled *and* the row's own element is there.

        Settled is asked of the page rather than of the network, because Wingman holds a
        websocket open for as long as a tab is on screen and it would never go quiet. The
        answer has to hold twice in a row: a list that re-renders when its second query
        lands would otherwise be photographed halfway through.
        """
        deadline = time.monotonic() + timeout
        held = 0
        while time.monotonic() < deadline:
            if self.truthy(f"loaded() && ({condition})"):
                held += 1
                if held == 2:
                    return
            else:
                held = 0
            time.sleep(0.3)
        raise CaptureError(f"waited {timeout:.0f}s for {label}")

    def screenshot(self) -> bytes:
        result = self.chrome.call(
            "Page.captureScreenshot",
            {"format": "png", "captureBeyondViewport": False},
            session_id=self.session_id,
        )
        return base64.b64decode(result["data"])

    def close(self) -> None:
        self.chrome.call("Target.closeTarget", {"targetId": self.target_id})


class Browser:
    """Chrome plus one cookie jar per identity.

    A jar of its own per identity is what lets Leela's phone and the host's TV be open at
    the same time, which the launcher rows need — and it takes cookie bleed between two
    rows out of the picture entirely.
    """

    def __init__(self, chrome: Chrome, base_url: str, cookies: dict[str, dict[str, str]]) -> None:
        self.chrome = chrome
        self.base_url = base_url
        self.cookies = cookies
        self._contexts: dict[str, str] = {}

    def _context(self, identity: str) -> str:
        if identity not in self._contexts:
            answer = self.chrome.call("Target.createBrowserContext", {})
            self._contexts[identity] = str(answer["browserContextId"])
        return self._contexts[identity]

    def open(self, identity: str, viewport: str) -> Page:
        target = self.chrome.call(
            "Target.createTarget",
            {"url": "about:blank", "browserContextId": self._context(identity)},
        )
        target_id = str(target["targetId"])
        attached = self.chrome.call(
            "Target.attachToTarget", {"targetId": target_id, "flatten": True}
        )
        page = Page(self.chrome, target_id, str(attached["sessionId"]))
        session = page.session_id
        self.chrome.call("Page.enable", session_id=session)
        self.chrome.call("Network.enable", session_id=session)
        self.chrome.call(
            "Emulation.setDeviceMetricsOverride", VIEWPORTS[viewport], session_id=session
        )
        # Before the first navigation, or `matchMedia` answers for the machine instead of
        # for the picture. Reduced motion is what keeps a shot off a half-played animation;
        # the app has one theme, and dark is said out loud so nothing can guess otherwise.
        self.chrome.call(
            "Emulation.setEmulatedMedia",
            {
                "features": [
                    {"name": "prefers-reduced-motion", "value": "reduce"},
                    {"name": "prefers-color-scheme", "value": "dark"},
                ]
            },
            session_id=session,
        )
        for name, value in self.cookies.get(identity, {}).items():
            self.chrome.call(
                "Network.setCookie",
                {"name": name, "value": value, "url": self.base_url},
                session_id=session,
            )
        return page


# --- the rows -----------------------------------------------------------------------------


@dataclass(frozen=True)
class Row:
    """One manifest id: who is looking, at what, and what has to be on the screen."""

    identity: str
    viewport: str
    # May carry ``{playlist}``, ``{tag}`` or ``{device}``, filled from what the seed minted.
    route: str
    # A JavaScript expression that is true once the picture can be taken. This is the
    # manifest's "must be visible" column, as something a machine can check.
    ready: str
    # ``(action, wait-for)`` pairs, run in order after the page is up.
    steps: tuple[tuple[str, str], ...] = field(default_factory=tuple)
    # The same, run after the shutter and before the tab is closed: what a row holds open
    # in the browser and has to give back itself. The room's selection lock is the one
    # such thing — a phone holds it in a modal, and closing a headless tab is not the
    # ``pagehide`` that would give it back.
    after: tuple[tuple[str, str], ...] = field(default_factory=tuple)
    # Run once everything is ready, to put the surface in the viewport.
    scroll: str | None = None
    # How many wishes are on the list for this picture.
    wishes: int = 4
    # Rows that need a song playing or a song just finished; see ``capture_launcher``.
    launcher: bool = False
    # Seconds between "ready" and the shutter, for the one row that is a choreography.
    settle: float = 0.4
    # Settings held at another value for this one picture and put back afterwards. The
    # settings page is the only surface that shows a path, and the scratch directory's real
    # one carries the name of whoever ran the capture.
    settings: tuple[tuple[str, Any], ...] = field(default_factory=tuple)
    # Rows the player selector has to be online for. A device is online for fifteen seconds
    # after its last report, so the row is captured over a heartbeat; see ``device_online``.
    device: bool = False
    # Rows taken while the room is picking singers. The selection is opened before the page
    # and given up afterwards, or every launcher row would meet a 409.
    selection: bool = False
    # A selection the server spun rather than one opened on a song: the reel on the TV.
    spin: bool = False


# The host screen fades its own chrome out three seconds after the last pointer event, and
# every host row waits for that.
HOST_IDLE = 'q(".host-page.host-idle")'

# Where Ultrastar Deluxe would be on an ordinary Windows machine. Only the settings page
# ever shows a path, and only for as long as its picture is being taken.
USDX_SHOWN_PATH = "C:\\Program Files\\UltraStar Deluxe"

# The prefix a ``Row.settings`` key wears when it belongs to the achievements module's own
# three private settings rather than to the settings registry.
ACHIEVEMENT_SETTINGS = "achievements."

ROWS: dict[str, Row] = {
    "home": Row(
        identity="Leela",
        viewport="phone",
        route="/",
        ready='q(".home-stage") && q(".home-random") && qa(".wishlist-song").length >= 4',
    ),
    "home-playing": Row(
        identity="Leela",
        viewport="phone",
        route="/",
        launcher=True,
        # The phone's stage carries the cover, the title, the artist and the song controls;
        # the singers' names are the TV's half of it.
        ready='q(".currently-playing-stage") && q(".currently-playing-title")'
        ' && q(".currently-playing-artist") && q(".currently-playing-controls")',
    ),
    "songs-list": Row(
        identity="Leela",
        viewport="phone",
        route="/songs",
        ready='q(".songs-search input") && q(".songs-chips")'
        ' && qa(".song-list-item").length >= 20 && q(".song-mark")',
    ),
    "songs-filter": Row(
        identity="Leela",
        viewport="phone",
        route="/songs",
        steps=(
            # The chip itself, not the group around it: the row of chips carries the same
            # accessible name, and clicking a `<div role="group">` does nothing at all.
            ("click(q('button[aria-label=\"Filter\"]'))", 'q(".filter-panel")'),
            (
                'setValue(q(\'.filter-panel select[aria-label="Decade"]\'), "1980s")',
                'q(\'.filter-panel select[aria-label="Decade"]\').value === "1980s"',
            ),
        ),
        ready='qa(".filter-panel .tri-state").length >= 2'
        ' && q(\'.filter-panel select[aria-label="Decade"]\').value === "1980s"',
    ),
    "song": Row(
        identity="Leela",
        viewport="phone",
        route="/songs",
        steps=(
            (
                'click(byText(".song-list-item", "I Got You Babe"))',
                'q(".song-hero-title")',
            ),
        ),
        ready='q(".song-hero-cover") && q(".song-details-controls") && q(".song-summary")'
        ' && text(q(".song-hero-title")) === "I Got You Babe"',
    ),
    "song-comments": Row(
        identity="Leela",
        viewport="phone",
        route="/songs",
        steps=(
            ('click(byText(".song-list-item", "I Got You Babe"))', 'q(".song-summary")'),
            ('click(byText(".song-summary-stat", "Comments"))', 'q(".song-comments")'),
        ),
        ready='qa(".song-comment").length >= 3 && q(".song-comment-composer")',
    ),
    "song-edit": Row(
        identity="Leela",
        viewport="phone",
        route="/songs",
        steps=(
            ('click(byText(".song-list-item", "I Got You Babe"))', 'q(".song-options")'),
            ('click(byText(".song-option", "Edit details"))', 'q(".song-edit")'),
        ),
        # The delete row too: the page this picture serves is *Fix or delete a song*,
        # and deleting one lives at the foot of this same form.
        ready='qa(".song-edit-field").length === 6 && q(".song-edit-save")'
        ' && q(".song-edit .delete-row")',
    ),
    "player-selection": Row(
        identity="host",
        viewport="phone",
        route="/songs",
        steps=(
            ('click(byText(".song-list-item", "I Got You Babe"))', 'q(".song-details-controls")'),
            ("click(q('[aria-label=\"Sing\"]'))", 'q(".player-selection-players")'),
            ('click(byText(".player-selection-player", "Fry"))', ""),
            ('click(byText(".player-selection-player", "Leela"))', ""),
        ),
        ready='qa(".player-selection-player-on").length === 2'
        ' && qa(".player-selection-slot-button").length >= 2',
    ),
    "wishlist": Row(
        identity="Leela",
        viewport="phone",
        route="/",
        wishes=6,
        ready='qa(".wishlist-song").length >= 6 && q(".wishlist-count") && q(".wishlist-remove")',
        scroll='show(q(".wishlist-tile"))',
    ),
    "playlists": Row(
        identity="Leela",
        viewport="phone",
        route="/songs/playlists",
        ready='qa(".playlists-row").length >= 3 && q(".playlists-mark") && q(".playlists-meta")',
    ),
    "playlist": Row(
        identity="Leela",
        viewport="phone",
        route="/songs/playlists/{playlist}",
        ready='q(".playlist-spin") && q(".playlist-actions") && qa(".song-list-item").length >= 8',
    ),
    "playlist-manage": Row(
        identity="Leela",
        viewport="phone",
        route="/songs/playlists/{playlist}/manage",
        ready='q(".playlist-manage-form") && q(".playlists-check")'
        " && qa('[aria-labelledby=\"playlist-members\"] .playlist-manage-row').length >= 3",
    ),
    "reel": Row(
        identity="Leela",
        viewport="phone",
        route="/spinner",
        steps=(
            (
                # Reduced motion makes the reel reveal at once, so a spin is one click and one
                # tick. Which song it lands on is `Math.random`'s, so it is spun until it is
                # the one the manifest names.
                "await (async () => { for (let i = 0; i < 300; i += 1) {"
                ' if (text(q(".spinner-winner-title")) === "Sandstorm") return true;'
                ' click(q(".spinner-spin")); await wait(40); }'
                ' return text(q(".spinner-winner-title")) === "Sandstorm"; })()',
                'text(q(".spinner-winner-title")) === "Sandstorm"',
            ),
        ),
        ready='q(".spinner-pick-select") && q(".spinner-spin") && q(".spinner-host")'
        ' && text(q(".spinner-winner-title")) === "Sandstorm"',
    ),
    "playlist-reel": Row(
        identity="Leela",
        viewport="phone",
        route="/songs/playlists/{playlist}/spinner",
        steps=(('click(q(".spinner-spin"))', 'q(".spinner-winner-title")'),),
        ready='q(".spinner-winner-title") && text(q(".page-header-title, h1"))!== ""'
        ' && q(".spinner-spin") && q(".spinner-host")',
    ),
    "reel-host-spin": Row(
        identity="Leela",
        viewport="phone",
        route="/spinner",
        steps=(
            # The phone reveals the song when the reel on the TV lands, a fixed few seconds
            # after the server's `spun_at`, reduced motion or not: this wait is the feature.
            ('click(q(".spinner-host"))', 'q(".host-spin")'),
            ("true", 'q(".host-spin-title")'),
        ),
        ready='q(".host-spin-title") && q(".host-spin-artist")'
        ' && byText(".host-spin-actions button", "Spin again")'
        ' && byText(".host-spin-actions button", "Play")',
        # Cancel gives the room's lock back. Left open, the selection would answer every
        # later `POST /karaoke/sing` with 409 until it idles out.
        after=(('click(byText(".host-spin-actions button", "Cancel"))', '!q(".host-spin")'),),
    ),
    "usdb-search": Row(
        identity="host",
        viewport="phone",
        route="/usdb",
        steps=(
            ('setValue(q(\'input[aria-label="Artist"]\'), "Queen")', ""),
            ('click(byText(".usdb-search button", "Search"))', 'q(".usdb-results")'),
        ),
        ready='qa(".usdb-item-title").length >= 5 && q(".usdb-state")',
    ),
    "usdb-downloads": Row(
        identity="host",
        viewport="phone",
        route="/usdb",
        steps=(
            # The same search as the row above, so the fields agree with the results behind
            # the panel. The page restores the last search inside one browser context, and
            # results under an empty Artist field read as a bug in the picture.
            ('setValue(q(\'input[aria-label="Artist"]\'), "Queen")', ""),
            ('click(byText(".usdb-search button", "Search"))', 'q(".usdb-results")'),
            ('click(q(".usdb-downloads-button"))', 'q(".downloads-list")'),
        ),
        ready='qa(".downloads-list > li").length >= 2 && q(".downloads-state-queued")',
    ),
    "tags-admin": Row(
        identity="host",
        viewport="phone",
        route="/user/tags",
        ready='qa(".tags-list").length >= 2 && qa(".tags-open").length >= 11',
    ),
    "tag-editor": Row(
        identity="host",
        viewport="phone",
        route="/user/tags/{tag}",
        ready='q(".tag-editor-form") && q(".perm-matrix") && q(".tag-people-row")'
        ' && q("#tag-permissions") && q("#tag-people")',
        scroll='show(q("#tag-permissions"))',
    ),
    "built-in-tags": Row(
        identity="host",
        viewport="phone",
        route="/user/tags/decade",
        ready='q(".tag-editor-form") && q(".tag-editor-hint") && q(".tag-flags")',
    ),
    "scores-party": Row(
        identity="host",
        viewport="phone",
        route="/scores",
        steps=(
            (
                # Ungrouped, which is the picture this row is of: the page opens grouped by
                # player, and the spread card that grouping brings with it fills the screen
                # between the strip chart and the score rows. Grouped by player is the next
                # row's own picture.
                'setValue(qa(".scores-control select")[0], "none")',
                'qa(".scores-control select")[0].value === "none"',
            ),
        ),
        ready='q(".scores-session-button") && q(".scores-chart")'
        ' && qa(".score-group-rank").length >= 3',
    ),
    "scores-spread": Row(
        identity="host",
        viewport="phone",
        route="/scores",
        ready='q(".spread-rows") && qa(".spread-row").length >= 2',
        scroll='show(byText(".scores-chart-title", "Score spread").closest(".scores-chart"))',
    ),
    "user": Row(
        identity="Bender",
        viewport="phone",
        route="/user",
        ready='text(q(".user-identity-name")) === "Bender" && q(".user-stats")'
        ' && q(".user-stats-chart")',
    ),
    "user-stats": Row(
        identity="Bender",
        viewport="phone",
        route="/user/stats",
        ready='q(".scores-page") && q(".scores-chart") && q(".scores-controls")',
    ),
    "user-achievements": Row(
        # Fry, not Bender. The list puts every earned badge first, so Bender's fill the
        # viewport before the first progress bar and the manifest asks for one. Fry has
        # fewer, which leaves both states and a bar on the same screen.
        identity="Fry",
        viewport="phone",
        route="/user",
        steps=(
            (
                'click(q(".user-achievements-summary"))',
                'q(".user-achievements[open]")',
            ),
        ),
        ready='q(".user-achievements[open]") && q(".user-achievements-strip")'
        ' && q(".user-achievements-count") && q(".achievement-progress-bar")',
        scroll='show(q(".user-achievements"))',
    ),
    "achievement-modal": Row(
        # Fry again: the strip is in the summary, so the picture is taken with the list
        # still folded away and the modal over it. The strip is in catalogue order, so its
        # first badge is the first thing in that order Fry has earned — the party's own
        # *Eighties Marathon* leads the list and he has not earned it, *Sandstorm Survivor*
        # is switched off and so is not drawn at all, which leaves *First Time on the Mic*:
        # a built-in, and one of the ones that ship a picture, which is what the
        # full-resolution wait below needs.
        identity="Fry",
        viewport="phone",
        route="/user",
        steps=(
            (
                'click(qa(".user-achievements-badge-button")[0])',
                'q(".achievement-modal")',
            ),
        ),
        # The full-resolution file, which is the whole point of the view.
        ready='q(".achievement-modal") && q(".achievement-modal-name")'
        " && q('.achievement-modal img[src*=\"size=full\"]')",
    ),
    "achievements-admin": Row(
        identity="host",
        viewport="phone",
        route="/user/achievements",
        ready='qa(".achievements-list").length === 1 && q(".achievements-included")'
        ' && q(".achievements-mark")',
        # The app's own timings for the length of the shot. The seed runs the host screen
        # at 30 and 15 so a badge row holds still for its own picture, and a reader of this
        # page would take those for the defaults.
        settings=(
            ("achievements.host_seconds_base", 4),
            ("achievements.host_seconds_per_badge", 2),
        ),
    ),
    "achievement-editor": Row(
        identity="host",
        viewport="phone",
        route="/user/achievements/eighties-marathon",
        ready='q(".tag-editor-form") && q(".condition-block") && q(".condition-sentence")'
        ' && q(".editor-actions")',
        # The form is several screens long and the conditions are its point, so the shot
        # starts at the *Conditions* heading rather than at the name field.
        scroll='show(byText(".tag-editor-form h2", "Conditions"))',
    ),
    "people-admin": Row(
        identity="host",
        viewport="phone",
        route="/user/accounts",
        ready='qa(".people-row").length >= 10 && q(".people-role")'
        ' && byText(".people-row", "Scruffy")',
        # The hidden player is the last row that fits, one line below the fold. Scrolling
        # exactly far enough for it keeps both groups and the role controls in the shot.
        scroll='showAbove(byText(".people-row", "Scruffy"), 85)',
    ),
    "permissions": Row(
        identity="host",
        viewport="phone",
        route="/user/permissions",
        ready='q(".perm-matrix") && qa(".perm-head-role").length === 3 && q(".perm-hint")',
    ),
    "login": Row(
        identity="guest",
        viewport="phone",
        route="/user",
        ready='q(".login-form") && q(\'input[aria-label="Name"]\')'
        ' && q(\'input[aria-label="Password"]\') && q(".login-tabs")',
    ),
    "settings": Row(
        identity="host",
        viewport="phone",
        route="/settings",
        steps=(
            (
                # Every group is open to begin with, which puts USDX several screens down. The
                # others are folded away rather than scrolled past, so the group the picture is
                # about starts at the top with its own header in the shot.
                '(() => { qa(".settings-group").forEach((group) => {'
                ' group.open = text(group.querySelector(".settings-group-name")) === "USDX"; });'
                ' q(".settings-group[open] .settings-advanced").open = true; return true; })()',
                'q(".settings-group[open] .settings-advanced[open]")',
            ),
        ),
        ready='q(".settings-group[open] .settings-advanced[open]")'
        ' && byText(".settings-group-name", "USDX")',
        # An ordinary Windows installation for the length of the shot. The stand-in
        # launcher lives in the scratch directory, whose path names the person who ran the
        # capture, and no picture may carry that.
        settings=(
            ("usdx.base_path", USDX_SHOWN_PATH),
            ("usdx.executable", USDX_SHOWN_PATH + "\\ultrastardx.exe"),
        ),
    ),
    "host-screen": Row(
        identity="host",
        viewport="host",
        route="/host",
        # `host-idle` is the TV three seconds after the last time anybody touched it: the
        # gear, the "this browser holds host rights" line and the leaderboard's order pills
        # have faded out. That is the screen a room looks at, so it is the one photographed.
        ready=HOST_IDLE + ' && q(".host-join-url") && q(".host-leaderboard") && q(".host-wishes")',
    ),
    "host-playing": Row(
        identity="host",
        viewport="host",
        route="/host",
        launcher=True,
        ready=HOST_IDLE + ' && q(".currently-playing-title") && q(".currently-playing-players")',
    ),
    "host-results": Row(
        identity="host",
        viewport="host",
        route="/host",
        launcher=True,
        # The summary beside the cover lands a round trip behind the bars, so it is
        # what the shutter waits for rather than the title.
        ready=HOST_IDLE + ' && q(".last-song") && q(".last-song-title") && q(".last-song-summary")',
    ),
    "host-achievements": Row(
        identity="host",
        viewport="host",
        route="/host",
        launcher=True,
        # The badges take the whole screen, so the rail being *gone* is half of what this
        # picture is of (ui-guidelines §7, *Host*).
        ready=HOST_IDLE + ' && q(".host-achievements") && !q(".host-rail")'
        ' && qa(".host-achievement-badge").length >= 2 && q(".host-achievement-player-name")',
        # The badges are thrown in one by one, and the row holds for the two `host_seconds`
        # settings the seed raised. Long enough that they have all landed, far short of the
        # row's own time.
        settle=3.0,
    ),
    "host-manage": Row(
        identity="host",
        viewport="host",
        route="/host/manage",
        ready='q(".host-manage-page") && qa(".manage-menu-row").length >= 3',
    ),
    # The five selector rows stand last, and in this order, for a reason the manifest cannot
    # say: they are the only ones that hold a device online, and a device stays online for
    # fifteen seconds after the heartbeat stops. Nothing that is not about the selector may
    # follow them, and the launcher rows wait the fifteen seconds out (`run`).
    "selector-admin": Row(
        identity="host",
        viewport="phone",
        route="/user/devices",
        device=True,
        # The two cards on the readers, one named and one nobody's, are what this picture
        # is of. `devices-list` is three lists on this page, so the cards are counted.
        ready='q(".devices-page") && qa(".devices-card").length === 2'
        ' && qa(".devices-unknown").length === 1',
        scroll='show(qa("h2")[0])',
    ),
    "selector-device": Row(
        identity="host",
        viewport="phone",
        route="/user/devices/{device}",
        device=True,
        # The status lines and both update controls. The device reports a firmware one
        # version behind the bundled image, which is what puts *Update over Wi-Fi* there.
        ready='q(".device-form") && q(".device-status") && q(".device-links")'
        ' && byText(".device-links .button", "Update over Wi-Fi")'
        ' && qa(".device-rows").length === 2 && qa(".device-select").length === 10',
        scroll='show(q(".device-status"))',
    ),
    "user-my-cards": Row(
        # Fry holds no card of his own: the block is on his page because one is lying on
        # the selector, which is the state the page describes.
        identity="Fry",
        viewport="phone",
        route="/user",
        device=True,
        ready='q(".my-cards-title") && qa(".my-cards-row").length === 1'
        ' && byText(".my-cards-row .button", "This is mine")',
        scroll='show(q(".my-cards-title"))',
    ),
    "host-picking": Row(
        identity="host",
        viewport="host",
        route="/host",
        device=True,
        selection=True,
        # `host-takeover`: the room picking singers owns the whole screen, so there is no
        # rail beside it. Two of the four slots are held by the two cards.
        ready='q(".host-page.host-takeover.host-idle") && q(".host-selection")'
        f' && byText(".host-selection-name", "{scenario.CARD_HOLDER}")'
        ' && byText(".host-selection-name", "Unknown card")',
    ),
    "host-reel": Row(
        identity="host",
        viewport="host",
        route="/host",
        device=True,
        selection=True,
        spin=True,
        # The reel where the cover stands, landed: the title and the artist are held back
        # while it runs, and the line under them reads *Spinning…* until then. Under the
        # reduced motion every capture asks for, it lands the moment it is drawn, so this
        # is a check and not a wait. No countdown, ever, on a spun selection.
        ready='q(".host-page.host-takeover.host-idle") && q(".host-selection-reel")'
        ' && !q(".host-selection-held") && !q(".host-selection-countdown")'
        ' && text(q(".host-selection-what")) === "Picking singers"'
        f' && byText(".host-selection-name", "{scenario.CARD_HOLDER}")'
        ' && byText(".host-selection-name", "Unknown card")',
    ),
}


# --- taking one picture -------------------------------------------------------------------


@dataclass
class Result:
    identity: str
    ok: bool
    size: str
    waited_for: str
    reason: str = ""


def png_size(data: bytes) -> tuple[int, int]:
    """Width and height out of the IHDR chunk. No image library needed for two integers."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise CaptureError("that is not a PNG")
    width, height = struct.unpack(">II", data[16:24])
    return int(width), int(height)


def expected_size(viewport: str) -> tuple[int, int]:
    metrics = VIEWPORTS[viewport]
    scale = int(metrics["deviceScaleFactor"])
    return int(metrics["width"]) * scale, int(metrics["height"]) * scale


def write_png(identifier: str, section: str, data: bytes, viewport: str) -> str:
    """Save the shot and answer its size, having checked it is the viewport's own."""
    width, height = png_size(data)
    wanted = expected_size(viewport)
    if (width, height) != wanted:
        raise CaptureError(f"captured {width}x{height}, expected {wanted[0]}x{wanted[1]}")
    target = OUTPUT_ROOT / section / f"{identifier}.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    return f"{width}x{height}"


def prepare(page: Page, row: Row) -> None:
    """The row's own steps, each waited for before the next one is taken."""
    for action, wait_for in row.steps:
        page.evaluate(action)
        if wait_for:
            page.await_ready(wait_for, f"'{wait_for}' after a step")


def shoot(page: Page, row: Row, identifier: str, section: str) -> str:
    page.await_ready(row.ready, row.ready)
    if row.scroll is not None:
        page.evaluate(row.scroll)
        # Scrolling brings lazy covers into view, and a half-drawn one is worse than a
        # slower run.
        page.await_ready(row.ready, f"{row.ready} after scrolling")
    time.sleep(row.settle)
    return write_png(identifier, section, page.screenshot(), row.viewport)


def capture_row(
    browser: Browser, state: seed.State, identifier: str, section: str, row: Row
) -> Result:
    held = hold_settings(state, row.settings)
    with contextlib.ExitStack() as stack:
        # The device first: a selection opened while the selector is online seeds its slots
        # from the cards lying on it, which is the whole point of the picture.
        if row.device:
            stack.enter_context(device_online(state))
        if row.selection:
            stack.enter_context(selection_open(state, spin=row.spin))
        page = browser.open(row.identity, row.viewport)
        try:
            page.navigate(browser.base_url + route_of(row, state))
            page.await_ready("document.body.children.length > 0", "the app to render")
            prepare(page, row)
            size = shoot(page, row, identifier, section)
            result = Result(row.identity, True, size, row.ready)
        except CaptureError as error:
            result = Result(row.identity, False, "-", row.ready, str(error))
        finally:
            # Whatever the page holds is given back even after a failed shot: a modal that
            # never opened has nothing to click, and that is not a second failure.
            with contextlib.suppress(CaptureError):
                for action, wait_for in row.after:
                    page.evaluate(action)
                    if wait_for:
                        page.await_ready(wait_for, f"'{wait_for}' after the shot")
            page.close()
            hold_settings(state, held)
    return result


# --- the player selector ------------------------------------------------------------------


@contextlib.contextmanager
def device_online(state: seed.State) -> Iterator[None]:
    """Hold the seeded player selector online for as long as the block runs.

    A report buys fifteen seconds of being online and nothing more, so a picture of a
    selector page is taken over a heartbeat, exactly as a real device keeps itself there.
    The body never changes, so the room does not shift between two reports.
    """
    seed.device_report(state)
    stop = threading.Event()

    def beat() -> None:
        while not stop.wait(seed.DEVICE_HEARTBEAT_S):
            try:
                seed.device_report(state)
            except seed.SeedError as error:
                print(f"  the device report failed: {error}")

    thread = threading.Thread(target=beat, name="device-heartbeat", daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=5.0)


@contextlib.contextmanager
def selection_open(state: seed.State, spin: bool = False) -> Iterator[None]:
    """Open a player selection for the scenario's song, and give it up afterwards.

    With ``spin`` the server picks the song out of the whole library instead, which is what
    puts the reel on the TV; which song it lands on is nobody's to choose.

    Given up in a ``finally`` because it has to be: a selection left open answers every
    later ``POST /karaoke/sing`` with 409, so the launcher rows would all fail behind it.
    """
    api = state.api
    body: dict[str, Any] = {"slots": [], "force": True}
    if spin:
        body["spin"] = {"scope": "all"}
    else:
        body["song_id"] = state.data["songs"][str(scenario.PICKING_SONG)]
    opened = api.post("/karaoke/selection", json=body)
    try:
        yield
    finally:
        api.request("DELETE", "/karaoke/selection", headers={"X-Selection-Token": opened["token"]})


def wait_for_device_offline() -> None:
    """Let the selector fall out of the room before anything else is photographed.

    The host screen says *Player selector offline* once a device that was there is gone,
    and a picture that is not about the selector must show neither line.
    """
    print(f"waiting {DEVICE_OFFLINE_S:.0f}s for the player selector to go offline")
    time.sleep(DEVICE_OFFLINE_S)


def hold_settings(
    state: seed.State, values: tuple[tuple[str, Any], ...]
) -> tuple[tuple[str, Any], ...]:
    """Write these settings, and answer what they were, so a caller can put them back.

    An ``achievements.`` key is one of that module's three private settings, which the
    settings API never sees; it has a route of its own.
    """
    if not values:
        return ()
    api = state.api
    private = {key for key, _ in values if key.startswith(ACHIEVEMENT_SETTINGS)}
    previous: list[tuple[str, Any]] = []
    plain = [(key, value) for key, value in values if key not in private]
    if plain:
        stored = {setting["key"]: setting["value"] for setting in api.get("/settings")}
        for key, value in plain:
            api.patch(f"/settings/{key}", json={"value": value})
            previous.append((key, stored.get(key)))
    if private:
        held = api.get("/achievements")["settings"]
        api.patch(
            "/achievements/settings",
            json={
                key.removeprefix(ACHIEVEMENT_SETTINGS): value
                for key, value in values
                if key in private
            },
        )
        previous.extend((key, held[key.removeprefix(ACHIEVEMENT_SETTINGS)]) for key in private)
    return tuple(previous)


def route_of(row: Row, state: seed.State) -> str:
    playlists = state.data.get("playlists") or []
    tags = state.data.get("tags") or []
    device = state.data.get("device") or {}
    return row.route.format(
        playlist=playlists[scenario.FEATURED_PLAYLIST]["id"] if playlists else "",
        tag=tags[0]["id"] if tags else "",
        device=device.get("id", ""),
    )


# --- the four pictures that need a song ---------------------------------------------------


def start_sing(state: seed.State, usdb_id: int, singers: tuple[str, ...]) -> None:
    """Hand the stand-in launcher a song, on the first colors the host configured."""
    api = state.api
    colors = [slot["name"] for slot in api.get("/karaoke/slots")["slots"]]
    if len(colors) < len(singers):
        raise CaptureError(f"only {len(colors)} singing slots are configured")
    api.post(
        "/karaoke/sing",
        json={
            "song_id": state.data["songs"][str(usdb_id)],
            "slots": [
                {"color": color, "player_id": state.data["players"][name]}
                for color, name in zip(colors, singers, strict=False)
            ],
        },
    )


def capture_launcher(
    browser: Browser, state: seed.State, manifest: dict[str, str], wanted: set[str]
) -> dict[str, Result]:
    """The rows a database cannot hold still for: a song playing, and a song just over.

    Two takes, because they need two different songs. The first is sung by somebody who
    earns nothing by it, so the results appear the moment the scores land. The second is
    the sing that completes the achievement the seed left Bender one short of, and the
    badges take the stage before the results do.
    """
    results: dict[str, Result] = {}
    take_one = wanted & {"home-playing", "host-playing", "host-results"}
    take_two = wanted & {"host-achievements"}

    if take_one:
        start_sing(state, RESULTS_SONG, RESULTS_SINGERS)
        phone = browser.open("Leela", "phone")
        tv = browser.open("host", "host")
        try:
            phone.navigate(browser.base_url + "/")
            tv.navigate(browser.base_url + "/host")
            for identifier, page in (("home-playing", phone), ("host-playing", tv)):
                if identifier not in wanted:
                    continue
                row = ROWS[identifier]
                try:
                    size = shoot(page, row, identifier, manifest[identifier])
                    results[identifier] = Result(row.identity, True, size, row.ready)
                except CaptureError as error:
                    results[identifier] = Result(row.identity, False, "-", row.ready, str(error))
            # The TV has to be listening before the song ends, or it misses the event that
            # puts the results on the stage.
            seed.command_release(
                argparse.Namespace(data_dir=Path(state.data["data_dir"]), scores=None)
            )
            if "host-results" in wanted:
                row = ROWS["host-results"]
                try:
                    tv.await_ready(row.ready, row.ready, timeout=LAUNCHER_TIMEOUT)
                    size = shoot(tv, row, "host-results", manifest["host-results"])
                    results["host-results"] = Result(row.identity, True, size, row.ready)
                except CaptureError as error:
                    results["host-results"] = Result(
                        row.identity, False, "-", row.ready, str(error)
                    )
        finally:
            phone.close()
            tv.close()
        seed.command_rewind(argparse.Namespace(data_dir=Path(state.data["data_dir"])))

    if take_two:
        start_sing(state, BADGE_SONG, (BADGE_SINGER,))
        tv = browser.open("host", "host")
        row = ROWS["host-achievements"]
        try:
            tv.navigate(browser.base_url + "/host")
            tv.await_ready('q(".currently-playing-title")', "the stand-in to take the stage")
            seed.command_release(
                argparse.Namespace(
                    data_dir=Path(state.data["data_dir"]),
                    scores=json.dumps({BADGE_SINGER: BADGE_SCORE}),
                )
            )
            tv.await_ready(row.ready, row.ready, timeout=LAUNCHER_TIMEOUT)
            size = shoot(tv, row, "host-achievements", manifest["host-achievements"])
            results["host-achievements"] = Result(row.identity, True, size, row.ready)
        except CaptureError as error:
            results["host-achievements"] = Result(row.identity, False, "-", row.ready, str(error))
        finally:
            tv.close()
        seed.command_rewind(argparse.Namespace(data_dir=Path(state.data["data_dir"])))

    return results


# --- the run ------------------------------------------------------------------------------


def sign_in(base: str, username: str, password: str) -> str:
    """An ordinary log-in, so a capture run needs no cookie the seed happened to keep.

    The host's cookie is the seed's own: its token is single-use per backend start and has
    already been spent by the time this script runs.
    """
    response = httpx.post(
        f"{base}/api/v1/auth/login",
        json={"username": username, "password": password},
        timeout=30.0,
    )
    if response.status_code >= 400:
        raise CaptureError(f"logging in as {username} failed: {response.text}")
    cookie = response.cookies.get(seed.SESSION_COOKIE)
    if cookie is None:
        raise CaptureError(f"logging in as {username} returned no session cookie")
    who = httpx.get(
        f"{base}/api/v1/auth/me", cookies={seed.SESSION_COOKIE: cookie}, timeout=30.0
    ).json()
    if (who.get("user") or {}).get("username") != username:
        raise CaptureError(f"the session for {username} answers as {who.get('user')}")
    return str(cookie)


def cookie_jars(state: seed.State, identities: set[str]) -> dict[str, dict[str, str]]:
    base = state.data["base_url"]
    jars: dict[str, dict[str, str]] = {"guest": {}}
    for identity in sorted(identities):
        if identity == "guest":
            continue
        if identity == "host":
            jars["host"] = {seed.SESSION_COOKIE: state.data["host_cookie"]}
            continue
        account = state.data["accounts"][identity]
        jars[identity] = {seed.SESSION_COOKIE: sign_in(base, identity, account["password"])}
    return jars


def set_wishes(state: seed.State, count: int) -> None:
    if state.data.get("wishes") == count:
        return
    state.data["wishes"] = len(seed.set_wishes(state, count))
    state.save()


def bring_up(arguments: argparse.Namespace) -> tuple[seed.State, bool]:
    """The scratch instance, started here or already standing. Answers whether it is ours."""
    if (arguments.data_dir / seed.STATE_FILE).is_file():
        print(f"using the instance already in {arguments.data_dir}")
        return seed.State.load(arguments.data_dir), False
    if not FRONTEND_INDEX.is_file():
        raise CaptureError(f"no {FRONTEND_INDEX} — run 'npm run build' in frontend/ first")
    seed.command_up(
        argparse.Namespace(
            data_dir=arguments.data_dir,
            port=arguments.port,
            usdb_port=arguments.usdb_port,
            avatars=arguments.avatars,
            reset=True,
        )
    )
    return seed.State.load(arguments.data_dir), True


def run(arguments: argparse.Namespace) -> int:
    manifest = read_manifest()
    check_manifest(manifest)
    wanted = set(manifest) if arguments.all else {arguments.id}
    if not wanted <= set(manifest):
        raise CaptureError(f"'{arguments.id}' is not a manifest id")

    state, ours = bring_up(arguments)
    base = state.data["base_url"]
    chrome: Chrome | None = None
    results: dict[str, Result] = {}
    try:
        chrome = Chrome(arguments.chrome, arguments.cdp_port, arguments.data_dir / "chrome-profile")
        identities = {ROWS[identifier].identity for identifier in wanted}
        browser = Browser(chrome, base, cookie_jars(state, identities))

        for identifier in manifest:
            row = ROWS[identifier]
            if identifier not in wanted or row.launcher:
                continue
            set_wishes(state, row.wishes)
            results[identifier] = capture_row(browser, state, identifier, manifest[identifier], row)
            mark = "ok" if results[identifier].ok else "FAILED"
            print(f"{identifier:<20} {mark}")

        launcher = wanted & {name for name, row in ROWS.items() if row.launcher}
        if launcher and any(ROWS[identifier].device for identifier in results):
            wait_for_device_offline()
        if launcher:
            # The wishes the four launcher pictures are taken over are the Home page's, and
            # starting a wished song would take its wish away. Neither song is wished for,
            # but the count is put back first so the instance is left as the rows found it.
            set_wishes(state, 4)
            results.update(capture_launcher(browser, state, manifest, launcher))
            for identifier in sorted(launcher):
                mark = "ok" if results.get(identifier, Result("", False, "", "")).ok else "FAILED"
                print(f"{identifier:<20} {mark}")
    finally:
        if chrome is not None:
            chrome.close()
        report(manifest, wanted, results)
        if ours and not arguments.keep:
            seed.command_teardown(argparse.Namespace(data_dir=arguments.data_dir))
        elif arguments.keep:
            print(f"\nleft standing: {base} — tear it down with 'seed.py teardown'")

    return 0 if all(result.ok for result in results.values()) and len(results) == len(wanted) else 1


def report(manifest: dict[str, str], wanted: set[str], results: dict[str, Result]) -> None:
    print()
    print(f"{'id':<20} {'who':<8} {'state':<7} {'size':<10} waited for")
    print("-" * 100)
    for identifier in manifest:
        if identifier not in wanted:
            continue
        result = results.get(identifier)
        if result is None:
            print(f"{identifier:<20} {'-':<8} {'MISSED':<7} {'-':<10} never ran")
            continue
        waited = result.reason if not result.ok else result.waited_for
        state = "ok" if result.ok else "FAILED"
        print(f"{identifier:<20} {result.identity:<8} {state:<7} {result.size:<10} {waited[:60]}")
    good = sum(1 for result in results.values() if result.ok)
    print(f"\n{good} of {len(wanted)} captured, under {OUTPUT_ROOT}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture the documentation screenshots.")
    parser.add_argument("--data-dir", type=Path, default=seed.DEFAULT_DATA_DIR)
    parser.add_argument("--port", type=int, default=seed.DEFAULT_PORT)
    parser.add_argument("--usdb-port", type=int, default=seed.DEFAULT_USDB_PORT)
    parser.add_argument("--cdp-port", type=int, default=DEFAULT_CDP_PORT)
    parser.add_argument("--chrome", type=Path, default=DEFAULT_CHROME)
    parser.add_argument("--avatars", type=Path, default=seed.DEFAULT_AVATARS)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true", help="every manifest id")
    group.add_argument("--id", help="one manifest id, starting whatever it needs")
    parser.add_argument(
        "--keep",
        action="store_true",
        help="leave the scratch instance running afterwards, for a look",
    )
    arguments = parser.parse_args()
    try:
        return run(arguments)
    except (CaptureError, seed.SeedError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
