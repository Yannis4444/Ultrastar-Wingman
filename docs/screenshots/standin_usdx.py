"""A stand-in for Ultrastar Deluxe that can be held in the middle of a song.

Wingman never launches the real program for a screenshot. Four manifest rows need a song
to look like it is playing (the stage on a phone, the stage on the TV, the results, and a
badge landing on the TV), so this script takes USDX's place: Wingman starts it, it holds,
the capture harness takes the "playing" pictures, the harness releases it, it writes
scores into ``Ultrastar.db`` and exits, and Wingman imports them exactly as it would from
the real program.

Modelled on ``FAKE_USDX`` in ``backend/tests/test_karaoke_api.py``, with one difference:
that one writes its scores and returns at once, this one waits for a sentinel file first.

What it does, in order:

1. records its own process id in ``standin/pids.txt``. The launcher only ever sees the
   ``.cmd`` wrapper, so killing the launch does not take this process with it and the
   seed script reaps the file on teardown;
2. writes ``standin/last-launch.json``: the command line it got and the players it read
   out of ``config.ini``. The harness can prove the right singers were handed over;
3. waits for ``standin/release.json``. That file is the whole point: while it is missing
   the song is "playing" and Wingman's stage stays up;
4. **deletes the sentinel before writing anything**, so one release can never let two
   runs through, and writes one ``us_scores`` row per configured player. A row per
   player, plus the one ``us_songs`` row the import query joins against — without that
   row Wingman imports nothing and the results screen stays empty;
5. exits, which is what makes Wingman import the scores and end the sing.

``release.json`` may be empty (``{}``) or may name the scores::

    {"scores": {"Bender": 9842, "Fry": 6104}, "difficulty": 1}

A name the file does not mention gets a plausible score derived from its own letters, so
a release with no content at all still produces a believable scoreboard. ``{"scores":
{}}`` writes nothing, which is what a song nobody had a microphone for looks like.

The hard timeout below is a safety net: a stand-in nobody ever releases exits on its own
without writing, so a forgotten process cannot drop scores into a later song.
"""

from __future__ import annotations

import configparser
import json
import os
import sqlite3
import sys
import time
import zlib
from pathlib import Path

# How long a held song may stay held. Well past any capture, far short of "forever".
MAX_HOLD_SECONDS = 900.0

POLL_SECONDS = 0.2

# What an unused player slot is called in USDX (``karaoke/usdx.py``). Never scored.
EMPTY_SLOT_NAME = "-"

# The range a made-up score lands in. High enough to look like a good evening, never so
# high that a screenshot claims somebody sang a perfect song.
_MIN_SCORE = 4200
_MAX_SCORE = 8900


def main() -> int:
    base = Path(__file__).resolve().parent
    work = base / "standin"
    work.mkdir(parents=True, exist_ok=True)
    pid_file = work / "pids.txt"
    with pid_file.open("a", encoding="utf-8") as file:
        file.write(f"{os.getpid()}\n")

    try:
        return _run(base, work)
    finally:
        # Only the ids of processes that are still alive belong in the file. Windows hands
        # a process id out again once it is free, and the seed's teardown kills whatever it
        # finds listed here — a leftover line is one chance to kill somebody else's process.
        _forget_own_pid(pid_file)


def _forget_own_pid(pid_file: Path) -> None:
    try:
        lines = [line for line in pid_file.read_text(encoding="utf-8").split() if line]
        remaining = [line for line in lines if line != str(os.getpid())]
        pid_file.write_text("".join(f"{line}\n" for line in remaining), encoding="utf-8")
    except OSError:
        pass


def _run(base: Path, work: Path) -> int:
    players = _players(base / "config.ini")
    song = _song_directory(sys.argv[1:])
    (work / "last-launch.json").write_text(
        json.dumps(
            {"argv": sys.argv[1:], "players": players, "song_dir": song, "pid": os.getpid()},
            indent=2,
        ),
        encoding="utf-8",
    )

    release = _wait_for_release(work / "release.json")
    if release is None:
        print("stand-in USDX: nobody released it, exiting without scores", file=sys.stderr)
        return 0
    _write_scores(base / "Ultrastar.db", players, release, song)
    return 0


def _song_directory(argv: list[str]) -> str | None:
    """What ``-SongPath`` pointed at. Absent when Wingman opened USDX for its own menus."""
    if "-SongPath" in argv:
        return argv[argv.index("-SongPath") + 1]
    return None


def _players(config_file: Path) -> list[str]:
    """The singers Wingman wrote into ``config.ini``, in slot order, empty slots dropped.

    ``utf-8-sig`` and a case-sensitive key reader, because that is how Wingman writes the
    file (``karaoke/usdx_config.py``) and how USDX itself reads it.
    """
    if not config_file.is_file():
        return []
    parser = configparser.RawConfigParser()
    parser.optionxform = str  # type: ignore[method-assign,assignment]
    parser.read(config_file, encoding="utf-8-sig")
    if not parser.has_section("Name"):
        return []
    count = parser.getint("Game", "Players", fallback=len(parser.options("Name")))
    names = []
    for number in range(1, count + 1):
        name = parser.get("Name", f"P{number}", fallback="").strip()
        if name and name != EMPTY_SLOT_NAME:
            names.append(name)
    return names


def _wait_for_release(sentinel: Path) -> dict[str, object] | None:
    """Block until the sentinel appears, then take it away and answer with its content.

    Deleted before the scores are written rather than after: a sentinel left lying would
    release the *next* song the moment it started, and a screenshot of a song that ended
    by itself is not a screenshot of anything.
    """
    deadline = time.monotonic() + MAX_HOLD_SECONDS
    while time.monotonic() < deadline:
        if sentinel.is_file():
            try:
                content = json.loads(sentinel.read_text(encoding="utf-8") or "{}")
            except (OSError, ValueError):
                content = {}
            sentinel.unlink(missing_ok=True)
            return content if isinstance(content, dict) else {}
        time.sleep(POLL_SECONDS)
    return None


def _write_scores(
    database: Path, players: list[str], release: dict[str, object], song: str | None
) -> None:
    wanted = release.get("scores")
    difficulty = release.get("difficulty", 1)
    rows = []
    for player in players:
        if isinstance(wanted, dict):
            if player not in wanted:
                continue
            score = int(wanted[player])
        else:
            score = _plausible_score(player, song)
        rows.append((player, score, int(time.time()), difficulty))
    if not rows:
        return

    connection = sqlite3.connect(database)
    try:
        connection.execute(
            "CREATE TABLE IF NOT EXISTS us_songs (ID INTEGER PRIMARY KEY, Artist TEXT, Title TEXT)"
        )
        connection.execute(
            "CREATE TABLE IF NOT EXISTS us_scores"
            " (Player TEXT, Score INT, Date INT, SongID INT, Difficulty INT)"
        )
        # Wingman's import joins the scores against this table, so the row has to exist.
        # Which song it claims to be does not matter: Wingman knows what it started.
        connection.execute("INSERT OR REPLACE INTO us_songs VALUES (1, 'Artist', 'Title')")
        connection.executemany(
            "INSERT INTO us_scores (Player, Score, Date, SongID, Difficulty)"
            " VALUES (?, ?, ?, 1, ?)",
            rows,
        )
        connection.commit()
    finally:
        connection.close()


def _plausible_score(player: str, song: str | None) -> int:
    """A believable score for a singer nobody named a number for. Derived from the names,
    so the same singer on the same song scores the same in every run."""
    seed = zlib.crc32(f"{player}|{song or ''}".encode())
    return _MIN_SCORE + seed % (_MAX_SCORE - _MIN_SCORE + 1)


if __name__ == "__main__":
    sys.exit(main())
