"""A stand-in for usdb.animux.de, for the two download screenshots.

The real site is never contacted while documentation pictures are taken: no account, no
scraping, no queued download. This server answers the four requests
``sources/usdb.py`` makes, in the shape the captured fixtures under
``backend/tests/fixtures/usdb/`` have, and serves a made-up catalogue.

What it answers:

======================  ====================================================
``POST /?link=home``    the login form's target. The content does not matter:
                        Wingman verifies a login on the browse page below
``GET /?link=browse``   a page **without** the "You are not logged in"
                        sentence, which is the only thing that tells Wingman
                        it has a session
``POST /?link=list``    the result table, filtered by the ``interpret`` and
                        ``title`` form fields and paged by ``start``/``limit``
``GET /data/cover/N``   the cover for one song id, drawn by ``library.py``
======================  ====================================================

``index.php?link=gettxt`` answers a page **without** the hidden ``txt`` field on purpose.
That is the first request a real download makes, so a download started by accident fails
at once with ``txt_not_found`` and never reaches the step that would fetch yt-dlp and
ffmpeg off the internet. The screenshot of the download queue is seeded straight into the
database instead (see ``seed.py``).

From the repository root::

    venv\\Scripts\\python.exe docs\\screenshots\\fake_usdb.py --port 8092
"""

from __future__ import annotations

import argparse
import html
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))

from library import FixtureSong, cover_png  # noqa: E402

CATALOGUE_FILE = Path(__file__).with_name("usdb_catalogue.json")

# How many rows a page holds when the client asks for no limit of its own.
DEFAULT_LIMIT = 30

_PAGE_HEAD = "<html><head><title>USDB</title></head><body>"
_PAGE_FOOT = "</body></html>"

# The sentence Wingman looks for to decide it has no session. Never sent by this server:
# the fake site is always logged in.
LOGGED_OUT = "You are not logged in"


def load_catalogue(path: Path = CATALOGUE_FILE) -> list[dict[str, object]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return list(data["songs"])


class UsdbHandler(BaseHTTPRequestHandler):
    """One handler for the whole fake site. The catalogue is set on the server object."""

    protocol_version = "HTTP/1.1"

    @property
    def catalogue(self) -> list[dict[str, object]]:
        return self.server.catalogue  # type: ignore[attr-defined]

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        """Quiet by default: this runs behind a seeding script, not in a terminal."""
        if self.server.verbose:  # type: ignore[attr-defined]
            super().log_message(format, *args)

    def do_GET(self) -> None:  # noqa: N802
        parts = urlsplit(self.path)
        query = parse_qs(parts.query)
        link = (query.get("link") or [""])[0]
        if parts.path.startswith("/data/cover/"):
            self._cover(parts.path)
        elif link == "browse":
            self._html(
                f"{_PAGE_HEAD}<p>Welcome wingman! <a href='?link=logout'>logout</a></p>{_PAGE_FOOT}"
            )
        elif link == "gettxt":
            self._refuse_txt()
        else:
            self._html(f"{_PAGE_HEAD}<p>USDB stand-in</p>{_PAGE_FOOT}")

    def do_POST(self) -> None:  # noqa: N802
        parts = urlsplit(self.path)
        query = parse_qs(parts.query)
        link = (query.get("link") or [""])[0]
        length = int(self.headers.get("content-length") or 0)
        form = parse_qs(self.rfile.read(length).decode("utf-8", "replace")) if length else {}
        if link == "list":
            self._list(form)
        elif link == "gettxt":
            self._refuse_txt()
        else:
            # The login form and anything else: a plain page. Wingman checks the session
            # on the browse page, never on this answer.
            self._html(f"{_PAGE_HEAD}<p>USDB stand-in</p>{_PAGE_FOOT}")

    # --- the answers ---------------------------------------------------------------------

    def _list(self, form: dict[str, list[str]]) -> None:
        artist = _field(form, "interpret").casefold()
        title = _field(form, "title").casefold()
        limit = _number(_field(form, "limit"), DEFAULT_LIMIT)
        start = _number(_field(form, "start"), 0)
        matching = [
            song
            for song in self.catalogue
            if artist in str(song["artist"]).casefold() and title in str(song["title"]).casefold()
        ]
        page = matching[start : start + limit]
        pages = max(1, -(-len(matching) // limit))
        self._html(_list_page(page, pages, limit))

    def _cover(self, path: str) -> None:
        try:
            usdb_id = int(Path(path).stem)
        except ValueError:
            self._not_found()
            return
        song = next((one for one in self.catalogue if int(one["usdb_id"]) == usdb_id), None)
        if song is None:
            # A song USDB has no cover for is answered with a page, not an image — which is
            # exactly why Wingman decides on the content type rather than the status code.
            self._html(f"{_PAGE_HEAD}<p>no cover</p>{_PAGE_FOOT}", status=404)
            return
        self._bytes(cover_png(_as_fixture(song)), "image/png")

    def _refuse_txt(self) -> None:
        """The download page, without the field a download needs. See the module docstring."""
        self._html(f"{_PAGE_HEAD}<p>Downloads are disabled on the stand-in.</p>{_PAGE_FOOT}")

    def _not_found(self) -> None:
        self._html(f"{_PAGE_HEAD}<p>not found</p>{_PAGE_FOOT}", status=404)

    def _html(self, body: str, status: int = 200) -> None:
        self._bytes(body.encode("utf-8"), "text/html; charset=utf-8", status)

    def _bytes(self, payload: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("content-type", content_type)
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def _as_fixture(song: dict[str, object]) -> FixtureSong:
    """A catalogue row as ``library.cover_png`` wants it: it only reads artist and title."""
    return FixtureSong(
        usdb_id=int(song["usdb_id"]),
        artist=str(song["artist"]),
        title=str(song["title"]),
        year=None,
        genre=None,
        language=None,
        edition=None,
        duration=0,
        video=False,
        duet=False,
    )


def _field(form: dict[str, list[str]], name: str) -> str:
    return (form.get(name) or [""])[0].strip()


def _number(value: str, fallback: int) -> int:
    try:
        return int(value)
    except ValueError:
        return fallback


def _list_page(songs: list[dict[str, object]], pages: int, limit: int) -> str:
    """The result table, cell for cell as ``usdb._parse_row`` reads it: artist, title,
    genre, year, edition, golden notes, language, creator, rating, views — and the song id
    in every cell's ``onclick``, which is the only place USDB puts it."""
    rows = []
    for index, song in enumerate(songs):
        usdb_id = int(song["usdb_id"])
        cells = [
            str(song["artist"]),
            str(song["title"]),
            str(song.get("genre") or ""),
            str(song.get("year") or ""),
            str(song.get("edition") or ""),
            "Ja" if song.get("golden") else "Nein",
            str(song.get("language") or ""),
            str(song.get("creator") or ""),
            _stars(int(song.get("rating") or 0)),
            str(song.get("views") or 0),
        ]
        drawn = "".join(
            f'<td onclick="show_detail({usdb_id})">{cell}</td>'
            if cell.startswith("<img")
            else f'<td onclick="show_detail({usdb_id})">{html.escape(cell)}</td>'
            for cell in cells
        )
        rows.append(f'<tr class="list_tr{index % 2 + 1}">{drawn}</tr>')
    paging = "".join(
        f'<a href="?link=list&amp;start={(number - 1) * limit}">[{number}]</a>'
        for number in range(1, pages + 1)
    )
    return (
        f"{_PAGE_HEAD}"
        '<div class="row1"><table>'
        '<tr class="list_head"><td>Interpret</td><td>Titel</td><td>Genre</td><td>Jahr</td>'
        "<td>Edition</td><td>Goldene Noten</td><td>Sprache</td><td>Erstellt von</td>"
        "<td>Bewertung</td><td>Aufrufe</td></tr>"
        f"{''.join(rows)}"
        f'</table></div><div class="paging">{paging}</div>'
        f"{_PAGE_FOOT}"
    )


def _stars(rating: int) -> str:
    """USDB renders a rating as star images, and Wingman counts them."""
    full = '<img src="images/star.png" alt="star">'
    empty = '<img src="images/no_star.png" alt="no star">'
    return full * rating + empty * (5 - rating)


def serve(port: int, verbose: bool = False) -> None:
    server = ThreadingHTTPServer(("127.0.0.1", port), UsdbHandler)
    server.catalogue = load_catalogue()  # type: ignore[attr-defined]
    server.verbose = verbose  # type: ignore[attr-defined]
    print(f"fake USDB listening on http://127.0.0.1:{port}", flush=True)
    server.serve_forever()


def main() -> int:
    parser = argparse.ArgumentParser(description="A stand-in USDB for the documentation shots.")
    parser.add_argument("--port", type=int, default=8092)
    parser.add_argument("--verbose", action="store_true", help="log every request")
    arguments = parser.parse_args()
    serve(arguments.port, arguments.verbose)
    return 0


if __name__ == "__main__":
    sys.exit(main())
