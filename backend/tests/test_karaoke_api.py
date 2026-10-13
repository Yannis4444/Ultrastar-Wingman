"""The sing flow, end to end, against a fake "USDX".

No real USDX, no real installation: the executable is a tiny python script (behind a
wrapper the OS can exec) that records how it was called and optionally appends rows to
a synthetic `Ultrastar.db` before exiting. Everything lives in a temp directory.
"""

import asyncio
import configparser
import contextlib
import json
import logging
import os
import signal
import sqlite3
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any, cast

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ultrastar_wingman.auth.model import utcnow
from ultrastar_wingman.karaoke import service, usdx_window
from ultrastar_wingman.karaoke.model import KaraokeSession, Score, Sing
from ultrastar_wingman.karaoke.usdx import COPY_DIR_NAME
from ultrastar_wingman.library.model import Wish
from ultrastar_wingman.players.model import Player
from ultrastar_wingman.settings import SettingsService
from ultrastar_wingman.songs.model import Song

# USDX stores its strings fixed-width, padded with NUL characters — they must not end up
# in Wingman's data.
NUL = chr(0)

# The stand-in for ultrastardx.exe. Reads what to do from spec.json next to itself, so the
# test can change its behaviour without rewriting the script.
FAKE_USDX = """
import json
import os
import pathlib
import sqlite3
import sys
import time

here = pathlib.Path(__file__).parent
spec = json.loads((here / "spec.json").read_text(encoding="utf-8"))

# The launcher only sees the wrapper, so this process survives being killed. The fixture
# reaps whatever is still listed here when the test ends.
with (here / "pids.txt").open("a", encoding="utf-8") as file:
    file.write(f"{os.getpid()}\\n")

(here / "argv.json").write_text(json.dumps(sys.argv[1:]), encoding="utf-8")

# Started for its own settings, USDX gets no arguments at all — there is no song
# directory to list then.
if "-Song" in sys.argv:
    song_txt = pathlib.Path(sys.argv[sys.argv.index("-Song") + 1])
    (here / "song_dir.json").write_text(
        json.dumps(sorted(entry.name for entry in song_txt.parent.iterdir())), encoding="utf-8"
    )

if spec["scores"]:
    connection = sqlite3.connect(spec["database"])
    connection.execute(
        "CREATE TABLE IF NOT EXISTS us_songs (ID INTEGER PRIMARY KEY, Artist TEXT, Title TEXT)"
    )
    connection.execute(
        "CREATE TABLE IF NOT EXISTS us_scores"
        " (Player TEXT, Score INT, Date INT, SongID INT, Difficulty INT)"
    )
    connection.execute("INSERT OR REPLACE INTO us_songs VALUES (1, 'Artist', 'Title')")
    connection.executemany(
        "INSERT INTO us_scores (Player, Score, Date, SongID, Difficulty) VALUES (?, ?, ?, 1, ?)",
        [(player, score, date, difficulty) for player, score, date, difficulty in spec["scores"]],
    )
    connection.commit()
    connection.close()

time.sleep(spec["sleep"])
"""

# Long enough that it never elapses: every test that uses it kills the process, and the
# app's shutdown kills whatever a failing test left behind.
FOREVER = 300.0


@dataclass
class FakeUsdx:
    """A pretend USDX installation. `base` is what `usdx.base_path` points at."""

    base: Path
    executable: Path
    songs_dir: Path

    @property
    def config_file(self) -> Path:
        return self.base / "config.ini"

    @property
    def ultrastar_db(self) -> Path:
        return self.base / "Ultrastar.db"

    @property
    def avatars_dir(self) -> Path:
        return self.base / "avatars"

    def behave(
        self,
        scores: list[tuple[str, int, int, int | None]] | None = None,
        sleep: float = 0.0,
    ) -> None:
        """What the fake does on its next run: write these score rows, then sleep."""
        (self.base / "spec.json").write_text(
            json.dumps(
                {"database": str(self.ultrastar_db), "scores": scores or [], "sleep": sleep}
            ),
            encoding="utf-8",
        )

    @property
    def argv_file(self) -> Path:
        return self.base / "argv.json"

    @property
    def argv(self) -> list[str]:
        return list(json.loads(self.argv_file.read_text(encoding="utf-8")))

    def forget(self) -> None:
        """Drop what the last run recorded, so the next assertion cannot read it instead."""
        self.argv_file.unlink(missing_ok=True)

    @property
    def song_dir_contents(self) -> list[str]:
        """What was in the directory it was pointed at, while it was running."""
        return list(json.loads((self.base / "song_dir.json").read_text(encoding="utf-8")))

    def config(self) -> configparser.RawConfigParser:
        parser = configparser.RawConfigParser()
        parser.optionxform = str  # type: ignore[method-assign,assignment]
        parser.read(self.config_file, encoding="utf-8-sig")
        return parser


@pytest.fixture
def fake_usdx(tmp_path: Path) -> Iterator[FakeUsdx]:
    base = tmp_path / "usdx"
    songs_dir = base / "songs"
    songs_dir.mkdir(parents=True)
    script = base / "fake_usdx.py"
    script.write_text(FAKE_USDX, encoding="utf-8")

    # A python script is not executable by itself, so the "executable" USDX setting points
    # at a wrapper that runs it with this interpreter.
    if sys.platform == "win32":
        executable = base / "ultrastardx.cmd"
        executable.write_text(
            f'@echo off\r\n"{sys.executable}" "{script}" %*\r\n', encoding="utf-8"
        )
    else:
        executable = base / "ultrastardx.sh"
        executable.write_text(f'#!/bin/sh\n"{sys.executable}" "{script}" "$@"\n', encoding="utf-8")
        executable.chmod(0o755)

    usdx = FakeUsdx(base=base, executable=executable, songs_dir=songs_dir)
    usdx.behave()
    try:
        yield usdx
    finally:
        _reap(base / "pids.txt")


def _reap(pid_file: Path) -> None:
    """Kill leftover fakes. Only the test needs this: killing the wrapper does not take its
    python child with it, whereas the real USDX is a single process."""
    if not pid_file.exists():
        return
    for line in pid_file.read_text(encoding="utf-8").split():
        with contextlib.suppress(OSError, ValueError):
            os.kill(int(line), signal.SIGTERM)


@pytest.fixture
async def configured(session: AsyncSession, fake_usdx: FakeUsdx) -> FakeUsdx:
    """USDX settings pointing at the fake: base path plus the executable override."""
    settings = SettingsService(session)
    await settings.set("usdx.base_path", str(fake_usdx.base))
    await settings.set("usdx.executable", str(fake_usdx.executable))
    await settings.set("songs.directory", str(fake_usdx.songs_dir))
    return fake_usdx


def make_song_dir(parent: Path, name: str) -> Path:
    directory = parent / name
    directory.mkdir(parents=True)
    (directory / "song.txt").write_text("#TITLE:Title\n#ARTIST:Artist\n", encoding="utf-8")
    return directory


async def add_song(session: AsyncSession, directory: Path) -> str:
    song = Song(
        id="usdb:1234",
        source="usdb",
        source_id="1234",
        title="Title",
        artist="Artist",
        fingerprint="artist|title",
        directory=str(directory),
        txt_file=str(directory / "song.txt"),
    )
    session.add(song)
    await session.commit()
    return song.id


@pytest.fixture
async def song(session: AsyncSession, configured: FakeUsdx) -> str:
    """A song in the USDX songs directory, with a name USDX copes with."""
    return await add_song(session, make_song_dir(configured.songs_dir, "Artist - Title"))


async def wait_for(path: Path, seconds: float = 10.0) -> None:
    """Wait until the fake wrote `path`. A launch returns as soon as the process was
    spawned, so what it recorded is not there yet."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + seconds
    while loop.time() < deadline:
        if await asyncio.to_thread(path.exists):
            return
        await asyncio.sleep(0.05)
    raise AssertionError(f"{path} was never written")


async def add_player(client: AsyncClient, name: str) -> dict[str, Any]:
    response = await client.post("/api/v1/players", json={"name": name})
    assert response.status_code == 201, response.text
    player: dict[str, Any] = response.json()
    return player


def seed_scores(database: Path, rows: list[tuple[str, int, int, int | None]]) -> None:
    """Pre-existing USDX scores: everything older than the launch must stay out."""
    connection = sqlite3.connect(database)
    connection.execute(
        "CREATE TABLE IF NOT EXISTS us_songs (ID INTEGER PRIMARY KEY, Artist TEXT, Title TEXT)"
    )
    connection.execute(
        "CREATE TABLE IF NOT EXISTS us_scores"
        " (Player TEXT, Score INT, Date INT, SongID INT, Difficulty INT)"
    )
    connection.execute("INSERT OR REPLACE INTO us_songs VALUES (1, 'Artist', 'Title')")
    connection.executemany(
        "INSERT INTO us_scores (Player, Score, Date, SongID, Difficulty) VALUES (?, ?, ?, 1, ?)",
        rows,
    )
    connection.commit()
    connection.close()


async def sing(
    client: AsyncClient, song_id: str, slots: list[dict[str, object]], force: bool = False
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/karaoke/sing", json={"song_id": song_id, "slots": slots, "force": force}
    )
    assert response.status_code == 202, response.text
    result: dict[str, Any] = response.json()
    return result


async def test_the_colors_come_from_the_backend(client: AsyncClient) -> None:
    response = await client.get("/api/v1/karaoke/colors")

    assert response.status_code == 200
    colors = response.json()["colors"]
    # The index in this list is what USDX stores, so the order is part of the contract.
    assert len(colors) == 16
    assert colors[0] == {"name": "blue", "hex": "#048BB9"}
    assert colors[-1] == {"name": "green_yellow", "hex": "#91BE00"}


async def test_a_finished_song_records_scores_for_the_players_who_sang(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    yannis = await add_player(client, "Yannis")
    alex = await add_player(client, "Alex")
    seed_scores(configured.ultrastar_db, [("Someone" + NUL * 5, 4000, 1000, 1)])
    configured.behave(
        scores=[
            # USDX pads the names it wrote itself, and we set these names.
            ("Yannis" + NUL * 10, 8500, 2000, 3),
            ("Alex" + NUL * 12, 7000, 2001, None),
        ]
    )

    started = await sing(
        client,
        song,
        [{"color": "blue", "player_id": yannis["id"]}, {"color": "red", "player_id": alex["id"]}],
    )
    await service.wait_for_sing_end()

    assert started["song"]["id"] == song
    assert started["slots"] == [
        {"color": "blue", "player": yannis},
        {"color": "red", "player": alex},
    ]

    scores = list(await session.scalars(select(Score).order_by(Score.id)))
    assert [
        (score.player_id, score.player_name, score.score, score.difficulty) for score in scores
    ] == [
        (yannis["id"], "Yannis", 8500, 3),
        (alex["id"], "Alex", 7000, None),
    ]
    assert {score.sing_id for score in scores} == {started["sing_id"]}

    sing_row = await session.get(Sing, started["sing_id"])
    assert sing_row is not None
    assert sing_row.song_id == song
    assert sing_row.ended_at is not None

    assert configured.config()["Name"]["P1"] == "Yannis"
    assert configured.config()["Name"]["P2"] == "Alex"
    assert configured.config()["Game"]["Players"] == "2"

    events = [event["event"] for event in broadcast_events]
    # `achievements.earned` closes the sequence: both singers just crossed a built-in
    # (*First Time on the Mic* at the very least). What is in it is
    # `test_achievements_triggers`' business — here it only has to come last, after the
    # scores it was earned from.
    assert events == [
        "karaoke.started",
        "karaoke.ended",
        "scores.recorded",
        "achievements.earned",
    ]
    recorded = broadcast_events[2]
    assert recorded["sing_id"] == started["sing_id"]
    recorded_scores = cast(list[dict[str, Any]], recorded["scores"])
    assert [score["player_name"] for score in recorded_scores] == ["Yannis", "Alex"]
    # The placement rides along on the event, like every other column of the row.
    assert [(score["placement"], score["field_size"]) for score in recorded_scores] == [
        (1, 2),
        (2, 2),
    ]


async def test_the_console_follows_a_sing_from_the_start_to_the_badges(
    client: AsyncClient, configured: FakeUsdx, song: str, caplog: pytest.LogCaptureFixture
) -> None:
    """What the host reads in the window: who sings what, how it ended, what it earned."""
    yannis = await add_player(client, "Yannis")
    alex = await add_player(client, "Alex")
    configured.behave(scores=[("Alex", 7000, 2001, None), ("Yannis", 10000, 2000, 3)])
    caplog.set_level(logging.INFO, logger="ultrastar_wingman.karaoke.service")

    await sing(
        client,
        song,
        [{"color": "blue", "player_id": yannis["id"]}, {"color": "red", "player_id": alex["id"]}],
    )
    await service.wait_for_sing_end()

    lines = [record.getMessage() for record in caplog.records]
    assert "Singing Artist - Title: Yannis (blue), Alex (red)" in lines
    # Best first, with the thousands separator the scores page uses.
    assert "Artist - Title is over: Yannis 10,000, Alex 7,000" in lines
    assert any(
        line.startswith("Yannis earned ") and "'First Time on the Mic'" in line for line in lines
    )


async def test_a_duet_records_who_came_first_and_how_big_the_field_was(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, song: str
) -> None:
    """Written when the scores are, and never worked out later: once one of these rows is
    deleted, nothing could reconstruct that this was a duel rather than a solo."""
    yannis = await add_player(client, "Yannis")
    alex = await add_player(client, "Alex")
    configured.behave(
        scores=[("Yannis" + NUL * 10, 7000, 2000, 3), ("Alex" + NUL * 12, 8500, 2001, 3)]
    )

    await sing(
        client,
        song,
        [{"color": "blue", "player_id": yannis["id"]}, {"color": "red", "player_id": alex["id"]}],
    )
    await service.wait_for_sing_end()

    scores = list(await session.scalars(select(Score).order_by(Score.id)))
    assert [
        (score.player_name, score.score, score.placement, score.field_size) for score in scores
    ] == [("Yannis", 7000, 2, 2), ("Alex", 8500, 1, 2)]

    # And the correction that takes the loser off the record leaves the win standing, which
    # is the whole reason the two columns are written down.
    assert (await client.delete(f"/api/v1/stats/scores/{scores[0].id}")).status_code == 204
    session.expire_all()
    remaining = list(
        await session.execute(select(Score.player_name, Score.placement, Score.field_size))
    )
    assert remaining == [("Alex", 1, 2)]


async def test_two_singers_on_the_same_score_share_the_first_place(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, song: str
) -> None:
    """Standard competition ranking: both of them came first, and the third came third —
    nobody came second to a tie."""
    names = [await add_player(client, name) for name in ("Yannis", "Alex", "Mia")]
    configured.behave(
        scores=[
            ("Yannis" + NUL * 10, 8500, 2000, 3),
            ("Alex" + NUL * 12, 8500, 2001, 3),
            ("Mia" + NUL * 13, 4000, 2002, 3),
        ]
    )

    await sing(
        client,
        song,
        [
            {"color": color, "player_id": player["id"]}
            for color, player in zip(("blue", "red", "green"), names, strict=True)
        ],
    )
    await service.wait_for_sing_end()

    scores = list(await session.scalars(select(Score).order_by(Score.id)))
    assert [(score.player_name, score.placement, score.field_size) for score in scores] == [
        ("Yannis", 1, 3),
        ("Alex", 1, 3),
        ("Mia", 3, 3),
    ]


async def test_a_walk_in_counts_in_the_field_of_the_sing(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, song: str
) -> None:
    """A name matching no launched slot is somebody Wingman cannot put a player row to — but
    they were on a microphone, so they take a placement and the field is two."""
    yannis = await add_player(client, "Yannis")
    configured.behave(
        scores=[("Yannis" + NUL * 10, 6000, 2000, 3), ("Someone else", 9000, 2001, 3)]
    )

    await sing(client, song, [{"color": "blue", "player_id": yannis["id"]}])
    await service.wait_for_sing_end()

    scores = list(await session.scalars(select(Score).order_by(Score.id)))
    assert [
        (score.player_id, score.player_name, score.placement, score.field_size) for score in scores
    ] == [(yannis["id"], "Yannis", 2, 2), (None, "Someone else", 1, 2)]


async def test_consecutive_sings_share_a_session_until_the_party_goes_quiet(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, song: str
) -> None:
    """The recorded session is what the statistics group by, so the sing flow has to attach
    every run to one."""
    player = await add_player(client, "Yannis")

    first = await sing(client, song, [{"color": "blue", "player_id": player["id"]}])
    await service.wait_for_sing_end()
    second = await sing(client, song, [{"color": "red", "player_id": player["id"]}])
    await service.wait_for_sing_end()

    rows = {row.id: row for row in await session.scalars(select(Sing))}
    session_id = rows[first["sing_id"]].session_id
    assert session_id is not None
    assert rows[second["sing_id"]].session_id == session_id

    # Backdate the session instead of waiting six hours: same thing as far as the rule cares.
    karaoke_session = await session.get(KaraokeSession, session_id)
    assert karaoke_session is not None
    karaoke_session.last_activity_at = utcnow() - timedelta(hours=7)
    await session.commit()

    third = await sing(client, song, [{"color": "green", "player_id": player["id"]}])
    await service.wait_for_sing_end()

    session.expire_all()
    third_row = await session.get(Sing, third["sing_id"])
    assert third_row is not None
    assert third_row.session_id not in (None, session_id)
    assert len(list(await session.scalars(select(KaraokeSession)))) == 2


async def test_the_song_file_is_passed_to_usdx(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, song: str
) -> None:
    player = await add_player(client, "Yannis")
    song_row = await session.get(Song, song)
    assert song_row is not None

    await sing(client, song, [{"color": "blue", "player_id": player["id"]}])
    await service.wait_for_sing_end()

    assert configured.argv == ["-Song", song_row.txt_file]
    assert configured.song_dir_contents == ["song.txt"]


async def test_a_name_no_slot_used_is_recorded_without_a_player(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, song: str
) -> None:
    player = await add_player(client, "Yannis")
    # Somebody renamed themselves inside USDX: the score is worth keeping, the attribution
    # is not inventable.
    configured.behave(scores=[("Someone else", 3000, 2000, 1)])

    started = await sing(client, song, [{"color": "blue", "player_id": player["id"]}])
    await service.wait_for_sing_end()

    scores = list(await session.scalars(select(Score)))
    assert [(score.player_id, score.player_name) for score in scores] == [(None, "Someone else")]
    assert started["sing_id"] == scores[0].sing_id


async def test_a_song_nobody_scored_ends_without_scores(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    player = await add_player(client, "Yannis")
    seed_scores(configured.ultrastar_db, [("Yannis", 4000, 1000, 1)])

    started = await sing(client, song, [{"color": "blue", "player_id": player["id"]}])
    await service.wait_for_sing_end()

    # The row from before the launch is not this run's.
    assert list(await session.scalars(select(Score))) == []
    assert [event["event"] for event in broadcast_events] == ["karaoke.started", "karaoke.ended"]
    sing_row = await session.get(Sing, started["sing_id"])
    assert sing_row is not None and sing_row.ended_at is not None


async def test_a_missing_score_database_is_not_fatal(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, song: str
) -> None:
    player = await add_player(client, "Yannis")
    assert not configured.ultrastar_db.exists()

    started = await sing(client, song, [{"color": "blue", "player_id": player["id"]}])
    await service.wait_for_sing_end()

    sing_row = await session.get(Sing, started["sing_id"])
    assert sing_row is not None and sing_row.ended_at is not None


async def test_starting_a_song_takes_it_off_the_wishlist(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    """Wished for by the singer, by somebody who is only watching and by a phone with no
    account: starting it settles the singer's wish and every account-less one."""
    temporary = await add_player(client, "Alex")
    singer = Player(name="Yannis", registered=True, user_id="singer-account")
    session.add(singer)
    session.add_all(
        [
            Wish(song_id=song, user_id="singer-account"),
            Wish(song_id=song, user_id="watcher-account"),
            Wish(song_id=song, guest_id="a-phone"),
            Wish(song_id="local:other", guest_id="a-phone"),
        ]
    )
    await session.commit()

    await sing(
        client,
        song,
        [
            {"color": "blue", "player_id": singer.id},
            {"color": "red", "player_id": temporary["id"]},
        ],
    )
    await service.wait_for_sing_end()

    wishes = await session.scalars(select(Wish))
    assert {(wish.song_id, wish.user_id, wish.guest_id) for wish in wishes} == {
        (song, "watcher-account", None),
        ("local:other", None, "a-phone"),
    }
    # The count the clients get is the one wish that is left, so the row stays on the list.
    update = next(event for event in broadcast_events if event["event"] == "wishlist.updated")
    assert (update["song_id"], update["count"]) == (song, 1)


async def test_the_running_song_is_reported_and_can_be_stopped(
    client: AsyncClient, configured: FakeUsdx, song: str
) -> None:
    player = await add_player(client, "Yannis")
    configured.behave(sleep=FOREVER)

    started = await sing(client, song, [{"color": "blue", "player_id": player["id"]}])

    current = await client.get("/api/v1/karaoke/current")
    assert current.status_code == 200
    assert current.json() == {"sing": started}

    stopped = await client.post("/api/v1/karaoke/stop")
    assert stopped.status_code == 204
    assert (await client.get("/api/v1/karaoke/current")).json() == {"sing": None}


async def test_stopping_is_idempotent(client: AsyncClient, configured: FakeUsdx, song: str) -> None:
    player = await add_player(client, "Yannis")
    assert (await client.post("/api/v1/karaoke/stop")).status_code == 204

    configured.behave(sleep=FOREVER)
    await sing(client, song, [{"color": "blue", "player_id": player["id"]}])

    for _ in range(3):
        assert (await client.post("/api/v1/karaoke/stop")).status_code == 204


async def test_a_second_song_needs_force(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    player = await add_player(client, "Yannis")
    configured.behave(sleep=FOREVER)
    first = await sing(client, song, [{"color": "blue", "player_id": player["id"]}])

    refused = await client.post(
        "/api/v1/karaoke/sing",
        json={"song_id": song, "slots": [{"color": "blue", "player_id": player["id"]}]},
    )
    assert refused.status_code == 409
    assert refused.json() == {"detail": "already_playing"}

    second = await sing(client, song, [{"color": "green", "player_id": player["id"]}], force=True)

    assert second["sing_id"] != first["sing_id"]
    # The killed run is closed off before the new one starts, not left dangling.
    first_row = await session.get(Sing, first["sing_id"])
    assert first_row is not None and first_row.ended_at is not None
    assert [event["event"] for event in broadcast_events] == [
        "karaoke.started",
        "karaoke.ended",
        "karaoke.started",
    ]
    assert (await client.get("/api/v1/karaoke/current")).json()["sing"]["sing_id"] == (
        second["sing_id"]
    )


async def test_a_song_outside_the_songs_directory_is_copied(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, tmp_path: Path
) -> None:
    """A song outside USDX's own songs dir is launched from a copy inside it: under
    `-SongPath` a path anywhere else only *added* to the library, and USDX opened on the
    first song of the whole list. The rule is kept under `-Song` (see `usdx.py`)."""
    outside = make_song_dir(tmp_path / "elsewhere", "Artist - Title")
    song = await add_song(session, outside)
    player = await add_player(client, "Yannis")
    copy_dir = configured.songs_dir / COPY_DIR_NAME

    await sing(client, song, [{"color": "blue", "player_id": player["id"]}])
    await service.wait_for_sing_end()

    assert configured.argv == ["-Song", str(copy_dir / "song.txt")]
    # The copy really was there while USDX ran, and is gone afterwards.
    assert configured.song_dir_contents == ["song.txt"]
    assert not copy_dir.exists()


async def test_a_song_from_a_library_of_its_own_is_copied_into_the_usdx_songs_dir(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, tmp_path: Path
) -> None:
    """The reported bug: Wingman's song library is not USDX's songs directory.

    A plain, unproblematic song directory — but in the library Wingman scans, which is a
    folder of its own here. Launched from there, USDX would load its whole library on top
    and open on the alphabetically first song, not the one that was picked.
    """
    library = tmp_path / "karaoke library"
    await SettingsService(session).set("songs.directory", str(library))
    song = await add_song(session, make_song_dir(library, "Celine Dion - My Heart Will Go On"))
    player = await add_player(client, "Yannis")
    copy_dir = configured.songs_dir / COPY_DIR_NAME

    await sing(client, song, [{"color": "blue", "player_id": player["id"]}])
    await service.wait_for_sing_end()

    assert configured.argv == ["-Song", str(copy_dir / "song.txt")]
    assert configured.song_dir_contents == ["song.txt"]
    assert not copy_dir.exists()


async def test_the_usdx_songs_dir_override_is_where_the_song_is_launched_from(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, tmp_path: Path
) -> None:
    """A portable install whose songs are not under the base path: the override says where
    USDX loads from, and that is the directory the song has to be started from."""
    usdx_songs = tmp_path / "portable" / "songs"
    usdx_songs.mkdir(parents=True)
    settings = SettingsService(session)
    await settings.set("usdx.songs_dir", str(usdx_songs))
    song = await add_song(session, make_song_dir(configured.songs_dir, "Artist - Title"))
    player = await add_player(client, "Yannis")
    copy_dir = usdx_songs / COPY_DIR_NAME

    await sing(client, song, [{"color": "blue", "player_id": player["id"]}])
    await service.wait_for_sing_end()

    # Under the base path but not under the configured songs dir, so it is copied there.
    assert configured.argv == ["-Song", str(copy_dir / "song.txt")]
    assert configured.song_dir_contents == ["song.txt"]
    assert not copy_dir.exists()


async def test_a_song_with_special_characters_in_its_name_is_copied(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx
) -> None:
    """Already in the songs dir, but USDX cannot handle the directory name."""
    inside = make_song_dir(configured.songs_dir, "Künstler & Lied!")
    song = await add_song(session, inside)
    player = await add_player(client, "Yannis")
    copy_dir = configured.songs_dir / COPY_DIR_NAME

    await sing(client, song, [{"color": "blue", "player_id": player["id"]}])
    await service.wait_for_sing_end()

    assert configured.argv == ["-Song", str(copy_dir / "song.txt")]
    assert not copy_dir.exists()


async def test_an_empty_slot_keeps_the_colors_of_the_following_ones(
    client: AsyncClient, configured: FakeUsdx, song: str
) -> None:
    player = await add_player(client, "Yannis")

    started = await sing(
        client,
        song,
        [
            {"color": "blue", "player_id": None},
            {"color": "red", "player_id": player["id"]},
            {"color": "green", "player_id": None},
        ],
    )
    await service.wait_for_sing_end()

    config = configured.config()
    # Trailing empty slots are dropped, the one in between stays so P2 keeps red (2).
    assert config["Game"]["Players"] == "2"
    assert config["Name"]["P1"] == "-"
    assert config["Name"]["P2"] == "Yannis"
    assert config["PlayerColor"]["P2"] == "2"
    assert [slot["player"] for slot in started["slots"]] == [None, player, None]


async def test_the_avatar_of_a_player_reaches_usdx(
    client: AsyncClient, configured: FakeUsdx, song: str
) -> None:
    player = await add_player(client, "Yannis")
    png = bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
        "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
    )
    uploaded = await client.put(
        f"/api/v1/players/{player['id']}/avatar",
        files={"file": ("avatar.png", png, "image/png")},
    )
    assert uploaded.status_code == 200

    await sing(client, song, [{"color": "blue", "player_id": player["id"]}])
    await service.wait_for_sing_end()

    # Copied into USDX's own avatars dir and referenced by the md5 of its content.
    assert (configured.avatars_dir / f"{player['id']}.png").read_bytes() == png
    assert len(configured.config()["PlayerAvatar"]["P1"]) == 32


async def test_unknown_songs_players_colors_and_empty_selections_are_refused(
    client: AsyncClient, configured: FakeUsdx, song: str
) -> None:
    player = await add_player(client, "Yannis")

    unknown_song = await client.post(
        "/api/v1/karaoke/sing",
        json={"song_id": "usdb:9999", "slots": [{"color": "blue", "player_id": player["id"]}]},
    )
    assert unknown_song.status_code == 404

    unknown_player = await client.post(
        "/api/v1/karaoke/sing",
        json={"song_id": song, "slots": [{"color": "blue", "player_id": "nope"}]},
    )
    assert unknown_player.status_code == 404

    unknown_color = await client.post(
        "/api/v1/karaoke/sing",
        json={"song_id": song, "slots": [{"color": "chartreuse", "player_id": player["id"]}]},
    )
    assert unknown_color.status_code == 422

    nobody = await client.post(
        "/api/v1/karaoke/sing",
        json={"song_id": song, "slots": [{"color": "blue", "player_id": None}]},
    )
    assert nobody.status_code == 422

    no_slots = await client.post("/api/v1/karaoke/sing", json={"song_id": song, "slots": []})
    assert no_slots.status_code == 422


async def test_a_singer_on_a_slot_the_host_removed_is_refused(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, song: str
) -> None:
    """The host cut the party down to two mics while a phone still showed four slots."""
    await SettingsService(session).set("karaoke.player_colors", "blue,red")
    player = await add_player(client, "Yannis")

    stale = await client.post(
        "/api/v1/karaoke/sing",
        json={"song_id": song, "slots": [{"color": "green", "player_id": player["id"]}]},
    )

    assert stale.status_code == 422
    assert "not one of the configured player slots" in stale.json()["detail"]
    assert list(await session.scalars(select(Sing))) == []

    # An *empty* slot outside the configuration is dropped instead: nobody sings on it,
    # and USDX must not end up with more players than the host configured.
    started = await sing(
        client,
        song,
        [
            {"color": "blue", "player_id": player["id"]},
            {"color": "green", "player_id": None},
        ],
    )
    await service.wait_for_sing_end()
    assert configured.config()["Game"]["Players"] == "1"
    assert started["slots"] == [{"color": "blue", "player": player}]


async def test_the_same_slot_twice_is_refused(
    client: AsyncClient, configured: FakeUsdx, song: str
) -> None:
    """Two singers in one color cannot be told apart — neither on the TV nor in the
    scores, which are matched by the name written into that slot."""
    alice = await add_player(client, "Alice")
    bob = await add_player(client, "Bob")

    doubled = await client.post(
        "/api/v1/karaoke/sing",
        json={
            "song_id": song,
            "slots": [
                {"color": "blue", "player_id": alice["id"]},
                {"color": "blue", "player_id": bob["id"]},
            ],
        },
    )

    assert doubled.status_code == 422
    assert "color of their own" in doubled.json()["detail"]


async def test_five_singers_reach_usdx_as_six_slots(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, song: str
) -> None:
    """USDX has no five-player mode: it looks `Players` up in a fixed list and falls back
    to the first entry — written a five, it would play with *one* player and leave four
    singers without a microphone."""
    six_slots = "blue,red,green,yellow,orange,pink"
    await SettingsService(session).set("karaoke.player_colors", six_slots)
    names = ["Alice", "Bob", "Cara", "Dan", "Eve"]
    players = [await add_player(client, name) for name in names]

    await sing(
        client,
        song,
        [
            {"color": color, "player_id": player["id"]}
            for color, player in zip(
                ["blue", "red", "green", "yellow", "orange"], players, strict=True
            )
        ],
    )
    await service.wait_for_sing_end()

    config = configured.config()
    assert config["Game"]["Players"] == "6"
    # Everybody keeps the slot they were put on, colors included.
    assert [config["Name"][f"P{number}"] for number in range(1, 6)] == names
    assert config["PlayerColor"]["P5"] == "5"
    # The sixth slot exists only because five is not a count USDX knows.
    assert config["Name"]["P6"] == "-"


async def test_the_placeholder_of_an_empty_slot_is_not_a_singer(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, song: str
) -> None:
    """An empty slot is a player called "-" to USDX, and USDX scores it like any other.
    Such a row is nobody's performance and must stay out of the statistics."""
    alice = await add_player(client, "Alice")
    configured.behave(
        scores=[("-" + NUL * 15, 120, 2000, None), ("Alice" + NUL * 11, 8000, 2001, 2)]
    )

    await sing(
        client,
        song,
        [
            {"color": "blue", "player_id": None},
            {"color": "red", "player_id": alice["id"]},
        ],
    )
    await service.wait_for_sing_end()

    scores = list(await session.scalars(select(Score).order_by(Score.id)))
    assert [(score.player_name, score.score) for score in scores] == [("Alice", 8000)]
    # And it is not part of the field either: Alice sang alone, whatever USDX filed under
    # the placeholder. Counting it would turn every solo into a won duel.
    assert [(score.placement, score.field_size) for score in scores] == [(1, 1)]


async def test_an_unconfigured_usdx_is_a_clear_error(
    client: AsyncClient, session: AsyncSession, fake_usdx: FakeUsdx
) -> None:
    """Nothing is set up: the answer names every setting that needs fixing."""
    song = await add_song(session, make_song_dir(fake_usdx.songs_dir, "Artist - Title"))
    player = await add_player(client, "Yannis")

    response = await client.post(
        "/api/v1/karaoke/sing",
        json={"song_id": song, "slots": [{"color": "blue", "player_id": player["id"]}]},
    )

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["error"] == "usdx_not_configured"
    assert any("usdx.executable" in problem for problem in detail["problems"])
    assert any("songs.directory" in problem for problem in detail["problems"])
    assert (await client.get("/api/v1/karaoke/current")).json() == {"sing": None}


async def test_the_status_of_a_configured_usdx_is_clean(
    client: AsyncClient, configured: FakeUsdx
) -> None:
    response = await client.get("/api/v1/karaoke/status")

    assert response.status_code == 200
    assert response.json() == {
        "configured": True,
        "problems": [],
        "bundled": False,
        "usdx_dir": None,
    }


async def test_the_status_names_every_problem_for_a_host(client: AsyncClient) -> None:
    """Nothing is set up at all: an admin sees which settings need filling in."""
    response = await client.get("/api/v1/karaoke/status")

    assert response.status_code == 200
    body = response.json()
    assert body["configured"] is False
    assert any("usdx.executable" in problem for problem in body["problems"])
    assert any("songs.directory" in problem for problem in body["problems"])


async def test_the_status_hides_the_problems_from_a_guest(anonymous_client: AsyncClient) -> None:
    """The problems name paths on the host's file system — `settings.view` territory."""
    response = await anonymous_client.get("/api/v1/karaoke/status")

    assert response.status_code == 200
    assert response.json() == {
        "configured": False,
        "problems": [],
        "bundled": False,
        "usdx_dir": None,
    }


async def test_a_guest_still_learns_that_usdx_works(
    anonymous_client: AsyncClient, configured: FakeUsdx
) -> None:
    """`configured` is the truth for everybody — the setup banner has to disappear for a
    guest too once the host fixed the settings."""
    response = await anonymous_client.get("/api/v1/karaoke/status")

    assert response.status_code == 200
    assert response.json() == {
        "configured": True,
        "problems": [],
        "bundled": False,
        "usdx_dir": None,
    }


async def test_a_missing_executable_is_a_clear_error(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, song: str
) -> None:
    settings = SettingsService(session)
    await settings.set("usdx.executable", str(configured.base / "not-there.exe"))
    player = await add_player(client, "Yannis")

    response = await client.post(
        "/api/v1/karaoke/sing",
        json={"song_id": song, "slots": [{"color": "blue", "player_id": player["id"]}]},
    )

    assert response.status_code == 400
    assert response.json()["detail"]["error"] == "usdx_not_configured"
    # Nothing was recorded for a song that never started.
    assert list(await session.scalars(select(Sing))) == []


# --- USDX for its own settings -----------------------------------------------------------


LAUNCH_URL = "/api/v1/karaoke/usdx/launch"


async def test_usdx_can_be_started_for_its_own_settings(
    client: AsyncClient, configured: FakeUsdx
) -> None:
    """The microphones can only be assigned inside USDX, so the settings start it plainly:
    no song, and above all no rewritten config — the host is about to change it by hand."""
    configured.behave(sleep=FOREVER)

    response = await client.post(LAUNCH_URL)

    assert response.status_code == 200
    assert response.json() == {"started": True}
    await wait_for(configured.argv_file)
    assert configured.argv == []
    assert not configured.config_file.exists()


async def test_starting_usdx_again_while_it_runs_is_not_an_error(
    client: AsyncClient, configured: FakeUsdx
) -> None:
    """Two taps on the button are not a mistake worth an error message."""
    configured.behave(sleep=FOREVER)
    assert (await client.post(LAUNCH_URL)).json() == {"started": True}
    await wait_for(configured.argv_file)

    second = await client.post(LAUNCH_URL)

    assert second.status_code == 200
    assert second.json() == {"started": False}


class WindowRequests:
    """Stands in for `usdx_window.bring_to_front`: which process was asked about, and
    whether it was still running at that moment."""

    def __init__(self) -> None:
        self.pids: list[int] = []
        self.running: list[bool] = []

    async def __call__(self, pid: int, is_running: Any) -> None:
        self.pids.append(pid)
        self.running.append(is_running())


async def test_a_sing_puts_the_usdx_window_in_front(
    client: AsyncClient, configured: FakeUsdx, song: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Wingman is a background console program, so Windows would leave the window it starts
    behind the browser the host just pressed Play in."""
    requests = WindowRequests()
    monkeypatch.setattr(usdx_window, "bring_to_front", requests)
    player = await add_player(client, "Yannis")
    configured.behave(sleep=FOREVER)

    await sing(client, song, [{"color": "blue", "player_id": player["id"]}])
    await wait_for(configured.argv_file)

    assert len(requests.pids) == 1
    assert requests.running == [True]


async def test_the_window_wait_ends_with_usdx(
    client: AsyncClient, configured: FakeUsdx, song: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A USDX that exits before it ever shows a window must not leave the wait behind."""
    waiting = asyncio.Event()
    cancelled = asyncio.Event()

    async def wait_forever(pid: int, is_running: Any) -> None:
        waiting.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    monkeypatch.setattr(usdx_window, "bring_to_front", wait_forever)
    player = await add_player(client, "Yannis")
    configured.behave(sleep=1.0)

    await sing(client, song, [{"color": "blue", "player_id": player["id"]}])
    await asyncio.wait_for(waiting.wait(), 10)
    await service.wait_for_sing_end()

    assert cancelled.is_set()


async def test_asking_for_an_open_usdx_again_puts_it_in_front(
    client: AsyncClient, configured: FakeUsdx, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A second Launch most likely means the host cannot see the first one."""
    requests = WindowRequests()
    monkeypatch.setattr(usdx_window, "bring_to_front", requests)
    configured.behave(sleep=FOREVER)
    await client.post(LAUNCH_URL)
    await wait_for(configured.argv_file)

    assert (await client.post(LAUNCH_URL)).json() == {"started": False}
    await asyncio.sleep(0)

    [first, second] = requests.pids
    assert first == second
    assert requests.running == [True, True]


async def test_usdx_is_not_started_while_a_song_is_playing(
    client: AsyncClient, configured: FakeUsdx, song: str
) -> None:
    player = await add_player(client, "Yannis")
    configured.behave(sleep=FOREVER)
    await sing(client, song, [{"color": "blue", "player_id": player["id"]}])

    response = await client.post(LAUNCH_URL)

    assert response.status_code == 409
    assert response.json() == {"detail": "already_playing"}


async def test_a_sing_replaces_the_usdx_the_settings_opened(
    client: AsyncClient, configured: FakeUsdx, song: str
) -> None:
    """USDX standing in its own menus blocks a song exactly like another song does — and
    the same force flag gets past it, so a phone is never stuck behind the TV."""
    player = await add_player(client, "Yannis")
    configured.behave(sleep=FOREVER)
    assert (await client.post(LAUNCH_URL)).json() == {"started": True}
    await wait_for(configured.argv_file)

    refused = await client.post(
        "/api/v1/karaoke/sing",
        json={"song_id": song, "slots": [{"color": "blue", "player_id": player["id"]}]},
    )
    assert refused.status_code == 409
    assert refused.json() == {"detail": "already_playing"}

    configured.forget()
    # This one has to end by itself, so the score import can be awaited below.
    configured.behave()
    await sing(client, song, [{"color": "blue", "player_id": player["id"]}], force=True)
    await service.wait_for_sing_end()

    assert "-Song" in configured.argv
    # The settings USDX is gone, so the button offers to start one again.
    assert not service.usdx_is_open()


async def test_an_unconfigured_usdx_cannot_be_started(client: AsyncClient) -> None:
    """Nothing is set up: the same problem report the sing endpoint gives."""
    response = await client.post(LAUNCH_URL)

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert detail["error"] == "usdx_not_configured"
    assert any("usdx.executable" in problem for problem in detail["problems"])


async def test_a_usdx_that_refuses_to_start_is_reported(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx
) -> None:
    """The executable is there but not runnable — that is a settings problem too."""
    broken = configured.base / "not-an-executable.exe"
    broken.write_bytes(b"")
    await SettingsService(session).set("usdx.executable", str(broken))

    response = await client.post(LAUNCH_URL)

    assert response.status_code == 400
    assert response.json()["detail"]["error"] == "usdx_not_configured"
    assert not service.usdx_is_open()
