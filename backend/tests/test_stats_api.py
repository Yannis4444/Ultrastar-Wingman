"""The statistics endpoints, and the session grouping underneath them.

Sings and scores are inserted straight into the database here: what USDX does with them is
`test_karaoke_api`'s job, and these tests are about reading them back.
"""

import sqlite3
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import MappingProxyType
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from httpx import AsyncClient
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from ultrastar_wingman.auth import permissions
from ultrastar_wingman.auth.model import RolePermission, as_utc
from ultrastar_wingman.db import migrations_dir
from ultrastar_wingman.karaoke import service
from ultrastar_wingman.karaoke.model import KaraokeSession, Score, Sing
from ultrastar_wingman.players.model import Player
from ultrastar_wingman.songs.model import Song
from ultrastar_wingman.stats import service as stats_service

# A fixed instant: nothing here may depend on the wall clock.
START = datetime(2026, 8, 1, 20, 0, tzinfo=UTC)

# The song of the second sing is deliberately never inserted — a score outlives its song.
GONE_SONG_ID = "usdb:gone"


async def add_song(session: AsyncSession, song_id: str, title: str) -> Song:
    song = Song(
        id=song_id,
        source="usdb",
        source_id=song_id.split(":")[1],
        title=title,
        artist="Artist",
        fingerprint=f"artist|{title.lower()}",
        directory=f"/songs/{title}",
        txt_file=f"/songs/{title}/song.txt",
    )
    session.add(song)
    await session.commit()
    return song


async def add_sing(
    session: AsyncSession,
    karaoke_session: KaraokeSession,
    song_id: str,
    started_at: datetime,
    scores: list[tuple[str, int]],
    player_ids: Mapping[str, str] = MappingProxyType({}),
) -> Sing:
    """`player_ids` links a scored name to a player row; a name that is not in it stays a
    walk-in singer, exactly as USDX leaves one."""
    sing = Sing(
        song_id=song_id,
        session_id=karaoke_session.id,
        started_at=started_at,
        ended_at=started_at + timedelta(minutes=3),
    )
    session.add(sing)
    await session.flush()
    for index, (player_name, score) in enumerate(scores):
        session.add(
            Score(
                sing_id=sing.id,
                player_id=player_ids.get(player_name),
                player_name=player_name,
                score=score,
                difficulty=1,
                # One second apart, so "newest first" has something to order by.
                recorded_at=started_at + timedelta(minutes=3, seconds=index),
            )
        )
    await session.commit()
    return sing


@pytest.fixture
async def seeded(session: AsyncSession) -> dict[str, Any]:
    """Two parties: the older one sang one song, the newer one two (the second of which has
    since left the library).

    Yannis is a registered player, so his scores carry an id; Alex is a walk-in whose scores
    carry only a name. Mona is registered but has never sung.
    """
    await add_song(session, "usdb:1", "Song One")
    await add_song(session, "usdb:2", "Song Two")

    yannis = Player(name="Yannis")
    mona = Player(name="Mona")
    old = KaraokeSession(started_at=START, last_activity_at=START, name="Last year")
    new_start = START + timedelta(days=30)
    new = KaraokeSession(started_at=new_start, last_activity_at=new_start + timedelta(hours=1))
    session.add_all([yannis, mona, old, new])
    await session.flush()
    linked = {"Yannis": yannis.id}

    old_sing = await add_sing(session, old, "usdb:1", START, [("Yannis", 5000)], linked)
    first = await add_sing(
        session, new, "usdb:1", new_start, [("Yannis", 8500), ("Alex", 7000)], linked
    )
    second = await add_sing(
        session, new, GONE_SONG_ID, new_start + timedelta(hours=1), [("Alex", 9000)]
    )
    return {
        "old": old,
        "new": new,
        "old_sing": old_sing,
        "first": first,
        "second": second,
        "yannis": yannis,
        "mona": mona,
    }


async def test_the_sessions_are_listed_newest_first_with_their_counts(
    client: AsyncClient, seeded: dict[str, Any]
) -> None:
    response = await client.get("/api/v1/stats/sessions")

    assert response.status_code == 200
    sessions = response.json()["sessions"]
    assert [
        (row["id"], row["name"], row["sing_count"], row["score_count"]) for row in sessions
    ] == [
        (seeded["new"].id, None, 2, 3),
        (seeded["old"].id, "Last year", 1, 1),
    ]
    # Serialized with the UTC offset SQLite dropped on write, not as a naive local-looking
    # timestamp the UI would render in the wrong time zone.
    assert sessions[1]["started_at"] == "2026-08-01T20:00:00Z"


async def test_an_empty_installation_has_no_sessions(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/stats/sessions")).json() == {"sessions": []}


async def test_a_session_can_be_named_and_the_name_cleared(
    client: AsyncClient, seeded: dict[str, Any]
) -> None:
    named = await client.patch(
        f"/api/v1/stats/sessions/{seeded['new'].id}", json={"name": "Yannis' birthday"}
    )

    assert named.status_code == 200
    assert named.json()["name"] == "Yannis' birthday"
    # The counts come back with the renamed row, so the UI does not have to refetch.
    assert named.json()["sing_count"] == 2

    cleared = await client.patch(f"/api/v1/stats/sessions/{seeded['new'].id}", json={"name": None})
    assert cleared.status_code == 200
    assert cleared.json()["name"] is None

    listed = (await client.get("/api/v1/stats/sessions")).json()["sessions"]
    assert listed[0]["name"] is None


async def test_an_unknown_session_is_a_404(client: AsyncClient, seeded: dict[str, Any]) -> None:
    assert (
        await client.patch("/api/v1/stats/sessions/nope", json={"name": "x"})
    ).status_code == 404
    assert (await client.get("/api/v1/stats/sessions/nope/scores")).status_code == 404


async def test_a_sessions_scores_carry_the_song_and_the_sing_start(
    client: AsyncClient, seeded: dict[str, Any]
) -> None:
    response = await client.get(f"/api/v1/stats/sessions/{seeded['new'].id}/scores")

    assert response.status_code == 200
    scores = response.json()["scores"]
    # Newest first: the second sing's score, then the two of the first one.
    assert [(row["player_name"], row["score"]) for row in scores] == [
        ("Alex", 9000),
        ("Alex", 7000),
        ("Yannis", 8500),
    ]
    # The song of the newest score left the library; the score itself stayed.
    assert scores[0]["song"] is None
    assert scores[0]["sing_id"] == seeded["second"].id
    assert scores[1]["song"]["id"] == "usdb:1"
    assert scores[1]["song"]["title"] == "Song One"
    assert scores[1]["sing_started_at"] == "2026-08-31T20:00:00Z"
    # The other party's score is not in this session.
    assert all(row["score"] != 5000 for row in scores)


async def test_a_songs_scores_span_every_session(
    client: AsyncClient, seeded: dict[str, Any]
) -> None:
    response = await client.get("/api/v1/stats/songs/usdb:1/scores")

    assert response.status_code == 200
    scores = response.json()["scores"]
    assert [row["score"] for row in scores] == [7000, 8500, 5000]
    assert {row["song"]["id"] for row in scores} == {"usdb:1"}


async def test_a_song_nobody_sang_has_no_scores(
    client: AsyncClient, seeded: dict[str, Any]
) -> None:
    assert (await client.get("/api/v1/stats/songs/usdb:2/scores")).json() == {"scores": []}


async def test_an_unknown_song_is_a_404(client: AsyncClient, seeded: dict[str, Any]) -> None:
    """Even the song of a recorded score: its page cannot show a song that is gone."""
    assert (await client.get("/api/v1/stats/songs/usdb:9999/scores")).status_code == 404
    assert (await client.get(f"/api/v1/stats/songs/{GONE_SONG_ID}/scores")).status_code == 404


async def test_a_players_scores_span_every_session_and_leave_out_walk_ins(
    client: AsyncClient, seeded: dict[str, Any]
) -> None:
    response = await client.get(f"/api/v1/stats/players/{seeded['yannis'].id}/scores")

    assert response.status_code == 200
    scores = response.json()["scores"]
    # Newest first, across both parties — and not a single one of Alex's.
    assert [row["score"] for row in scores] == [8500, 5000]
    assert {row["player_name"] for row in scores} == {"Yannis"}
    assert scores[0]["song"]["id"] == "usdb:1"


async def test_a_player_who_never_sang_has_no_scores(
    client: AsyncClient, seeded: dict[str, Any]
) -> None:
    response = await client.get(f"/api/v1/stats/players/{seeded['mona'].id}/scores")

    assert response.status_code == 200
    assert response.json() == {"scores": []}


async def test_an_unknown_player_is_a_404(client: AsyncClient, seeded: dict[str, Any]) -> None:
    """Not an empty list: a page asking for a player that is gone should say so."""
    assert (await client.get("/api/v1/stats/players/nope/scores")).status_code == 404


async def test_the_latest_scores_are_newest_first_and_limited(
    client: AsyncClient, seeded: dict[str, Any]
) -> None:
    response = await client.get("/api/v1/stats/latest")

    assert response.status_code == 200
    assert [row["score"] for row in response.json()["scores"]] == [9000, 7000, 8500, 5000]

    limited = await client.get("/api/v1/stats/latest", params={"limit": 2})
    assert [row["score"] for row in limited.json()["scores"]] == [9000, 7000]
    assert (await client.get("/api/v1/stats/latest", params={"limit": 0})).status_code == 422


async def test_sings_close_together_share_a_session(session: AsyncSession) -> None:
    first = await service.attach_to_session(session, START)
    still_going = await service.attach_to_session(session, START + timedelta(hours=5, minutes=59))

    assert still_going.id == first.id
    # The idle window is measured from the newest sing, not from the session's start.
    assert as_utc(still_going.last_activity_at) == START + timedelta(hours=5, minutes=59)
    assert as_utc(still_going.started_at) == START


async def test_a_sing_after_a_long_break_opens_a_new_session(session: AsyncSession) -> None:
    first = await service.attach_to_session(session, START)
    # Exactly the gap: long enough. Six hours of silence is a new party.
    later = await service.attach_to_session(session, START + timedelta(hours=6))

    assert later.id != first.id
    assert as_utc(later.started_at) == START + timedelta(hours=6)
    assert as_utc(first.last_activity_at) == START


@pytest.fixture
async def running(session: AsyncSession) -> dict[str, Any]:
    """A party that is still going, plus one from three days ago that must stay out of it.

    Clock-relative on purpose, unlike everything above: "the current session" is defined
    against `datetime.now` (`SESSION_GAP`), so a fixed instant cannot express it. The
    offsets are minutes and days, nowhere near the six-hour boundary.
    """
    await add_song(session, "usdb:1", "Song One")
    await add_song(session, "usdb:2", "Song Two")
    await add_song(session, "usdb:3", "Song Three")

    now = datetime.now(UTC)
    over = KaraokeSession(
        started_at=now - timedelta(days=3), last_activity_at=now - timedelta(days=3)
    )
    live = KaraokeSession(
        started_at=now - timedelta(minutes=50), last_activity_at=now - timedelta(minutes=10)
    )
    session.add_all([over, live])
    await session.flush()

    await add_sing(session, over, "usdb:3", now - timedelta(days=3), [("Yannis", 5000)])
    first = await add_sing(session, live, "usdb:1", now - timedelta(minutes=50), [("Yannis", 8500)])
    gone = await add_sing(
        session, live, GONE_SONG_ID, now - timedelta(minutes=40), [("Alex", 9000)]
    )
    # No scores at all: USDX was stopped before it awarded any. It was still played.
    unscored = await add_sing(session, live, "usdb:2", now - timedelta(minutes=30), [])
    again = await add_sing(session, live, "usdb:1", now - timedelta(minutes=10), [("Alex", 7000)])
    return {
        "over": over,
        "live": live,
        "first": first,
        "gone": gone,
        "unscored": unscored,
        "again": again,
    }


async def test_the_current_sessions_sings_are_newest_first_and_one_row_per_song(
    client: AsyncClient, running: dict[str, Any]
) -> None:
    response = await client.get("/api/v1/stats/sessions/current/sings")

    assert response.status_code == 200
    sings = response.json()["sings"]
    # Song One was sung twice and appears once, at the newer start; the unscored Song Two
    # is in; the song that left the library keeps its place with no song to show.
    assert [(row["song_id"], row["sing_id"]) for row in sings] == [
        ("usdb:1", running["again"].id),
        ("usdb:2", running["unscored"].id),
        (GONE_SONG_ID, running["gone"].id),
    ]
    assert sings[0]["song"]["title"] == "Song One"
    assert sings[1]["song"]["title"] == "Song Two"
    assert sings[2]["song"] is None
    # Serialized with the UTC offset SQLite dropped on write.
    assert sings[0]["started_at"].endswith("Z")
    assert sings[0]["started_at"] > sings[1]["started_at"] > sings[2]["started_at"]
    # The other party's song is not in the current session.
    assert all(row["song_id"] != "usdb:3" for row in sings)


async def test_an_empty_installation_has_no_current_sings(client: AsyncClient) -> None:
    response = await client.get("/api/v1/stats/sessions/current/sings")

    assert response.status_code == 200
    assert response.json() == {"sings": []}


async def test_a_finished_party_is_no_longer_the_current_session(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Nothing sung for `SESSION_GAP`: the next sing opens a new session, so the tab is
    empty rather than showing last night."""
    await add_song(session, "usdb:1", "Song One")
    long_ago = datetime.now(UTC) - timedelta(hours=7)
    over = KaraokeSession(started_at=long_ago, last_activity_at=long_ago)
    session.add(over)
    await session.flush()
    await add_sing(session, over, "usdb:1", long_ago, [("Yannis", 5000)])

    response = await client.get("/api/v1/stats/sessions/current/sings")

    assert response.status_code == 200
    assert response.json() == {"sings": []}


async def test_the_current_session_ends_exactly_at_the_session_gap(session: AsyncSession) -> None:
    """The same boundary `attach_to_session` applies, asserted without the wall clock."""
    party = await service.attach_to_session(session, START)
    await session.commit()

    still_going = await stats_service.current_session(
        session, START + timedelta(hours=5, minutes=59)
    )
    over = await stats_service.current_session(session, START + timedelta(hours=6))

    assert still_going is not None and still_going.id == party.id
    assert over is None


async def test_listing_the_current_sings_needs_stats_view(
    anonymous_client: AsyncClient, session: AsyncSession
) -> None:
    await session.execute(
        delete(RolePermission).where(
            RolePermission.role == "guest", RolePermission.capability == "stats.view"
        )
    )
    await session.commit()
    permissions.invalidate_cache()

    response = await anonymous_client.get("/api/v1/stats/sessions/current/sings")

    assert response.status_code == 403
    assert response.json() == {"detail": "missing_permission:stats.view"}


def _upgrade(database_url: str, revision: str) -> None:
    """Alembic up to one revision. Sync on purpose: `migrations/env.py` calls
    `asyncio.run`, which cannot happen inside a running event loop."""
    config = Config()
    config.set_main_option("script_location", str(migrations_dir()))
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    command.upgrade(config, revision)


def test_the_migration_groups_existing_sings_into_sessions(tmp_path: Path) -> None:
    """Upgrading a database recorded before phase 6: the old sings get sessions by the same
    6-hour-gap rule the runtime uses."""
    database = tmp_path / "wingman.db"
    url = f"sqlite+aiosqlite:///{database}"
    _upgrade(url, "0007")

    # SQLAlchemy's SQLite dialect stores (and parses) timestamps in exactly this format.
    offsets = [
        timedelta(),
        timedelta(hours=1),
        # Exactly six hours after the previous one: a new session starts here.
        timedelta(hours=7),
        timedelta(hours=7, minutes=30),
    ]
    connection = sqlite3.connect(database)
    connection.executemany(
        "INSERT INTO sings (id, song_id, started_at) VALUES (?, 'usdb:1', ?)",
        [
            (f"sing{index}", (START + offset).strftime("%Y-%m-%d %H:%M:%S.%f"))
            for index, offset in enumerate(offsets)
        ],
    )
    connection.commit()
    connection.close()

    _upgrade(url, "head")

    connection = sqlite3.connect(database)
    try:
        grouped = connection.execute("SELECT id, session_id FROM sings ORDER BY id").fetchall()
        sessions = connection.execute(
            "SELECT id, name, started_at, last_activity_at FROM karaoke_sessions"
        ).fetchall()
    finally:
        connection.close()

    by_sing = dict(grouped)
    assert by_sing["sing0"] == by_sing["sing1"]
    assert by_sing["sing2"] == by_sing["sing3"]
    assert by_sing["sing0"] != by_sing["sing2"]
    assert len(sessions) == 2

    spans = {row[0]: (row[2][:19], row[3][:19]) for row in sessions}
    assert spans[by_sing["sing0"]] == ("2026-08-01 20:00:00", "2026-08-01 21:00:00")
    assert spans[by_sing["sing2"]] == ("2026-08-02 03:00:00", "2026-08-02 03:30:00")
    assert all(row[1] is None for row in sessions)
