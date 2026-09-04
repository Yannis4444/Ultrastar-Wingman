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
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from conftest import add_session, add_user
from ultrastar_wingman.auth import permissions
from ultrastar_wingman.auth.deps import COOKIE_NAME
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


async def sign_in(
    client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    username: str,
    player: Player | None = None,
    role: str = "user",
) -> str:
    """Log `client` in as a fresh account, optionally the one `player` sings as.

    Linking the player is what makes the account a *singer*: a score carries a player id,
    so that is the only thing tying an account to a party it was at.
    """
    user_id = await add_user(session_factory, username, role)
    if player is not None:
        player.user_id = user_id
        player.registered = True
    await session.commit()
    await add_session(session_factory, f"{username}-token", user_id)
    client.cookies.set(COOKIE_NAME, f"{username}-token", domain="wingman.test", path="/")
    return user_id


async def take_history_away(session: AsyncSession, role: str = "user") -> None:
    """Drop `stats.history` from a role — what a host does who keeps the archive to
    themselves. Everything below it is then identity, not a capability."""
    await session.execute(
        delete(RolePermission).where(
            RolePermission.role == role, RolePermission.capability == "stats.history"
        )
    )
    await session.commit()
    permissions.invalidate_cache()


@pytest.fixture
async def parties(session: AsyncSession) -> dict[str, Any]:
    """Three parties around one singer: one Yannis sang at, one he missed, and the one that
    is still going (which he has not sung at either).

    Clock-relative like `running` below, because "the party that is still going" is defined
    against `datetime.now` and a fixed instant cannot express it.
    """
    await add_song(session, "usdb:1", "Song One")
    await add_song(session, "usdb:2", "Song Two")

    yannis = Player(name="Yannis")
    mona = Player(name="Mona")
    now = datetime.now(UTC)
    mine = KaraokeSession(
        name="My party",
        started_at=now - timedelta(days=9),
        last_activity_at=now - timedelta(days=9),
    )
    theirs = KaraokeSession(
        name="Without me",
        started_at=now - timedelta(days=3),
        last_activity_at=now - timedelta(days=3),
    )
    live = KaraokeSession(
        started_at=now - timedelta(minutes=40), last_activity_at=now - timedelta(minutes=10)
    )
    session.add_all([yannis, mona, mine, theirs, live])
    await session.flush()
    linked = {"Yannis": yannis.id, "Mona": mona.id}

    mine_sing = await add_sing(
        session, mine, "usdb:1", now - timedelta(days=9), [("Yannis", 5000), ("Mona", 4000)], linked
    )
    await add_sing(session, theirs, "usdb:2", now - timedelta(days=3), [("Mona", 6000)], linked)
    live_sing = await add_sing(
        session, live, "usdb:1", now - timedelta(minutes=10), [("Mona", 7000)], linked
    )
    return {
        "mine": mine,
        "theirs": theirs,
        "live": live,
        "mine_sing": mine_sing,
        "live_sing": live_sing,
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
    # Yannis and Alex sang at the newer party, Yannis alone at the older one — the third
    # figure of the picker's meta line. Alex is a walk-in and counts by name.
    assert [row["singer_count"] for row in sessions] == [2, 1]
    # Serialized with the UTC offset SQLite dropped on write, not as a naive local-looking
    # timestamp the UI would render in the wrong time zone.
    assert sessions[1]["started_at"] == "2026-08-01T20:00:00Z"


async def test_an_empty_installation_has_no_sessions(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/stats/sessions")).json() == {
        "sessions": [],
        "session_count": 0,
        "score_count": 0,
    }


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


async def test_naming_a_session_tells_the_room(
    client: AsyncClient, seeded: dict[str, Any], broadcast_events: list[dict[str, object]]
) -> None:
    """A phone with the party picker open reads the new name without being reloaded — the
    same event hiding a party sends, and with no payload for the same reason."""
    await client.patch(
        f"/api/v1/stats/sessions/{seeded['new'].id}", json={"name": "Yannis' birthday"}
    )

    assert broadcast_events[-1] == {"event": "sessions.changed"}


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


async def test_a_guest_sees_only_the_running_party_in_the_session_list(
    anonymous_client: AsyncClient, running: dict[str, Any]
) -> None:
    """`stats.history` is not a guest right: tonight's scoreboard is still theirs, the
    parties before it are not. A short list rather than a 403 — the page keeps working."""
    response = await anonymous_client.get("/api/v1/stats/sessions")

    assert response.status_code == 200
    assert [entry["id"] for entry in response.json()["sessions"]] == [running["live"].id]


async def test_a_guest_reads_the_running_party_s_scores_but_not_an_older_one_s(
    anonymous_client: AsyncClient, running: dict[str, Any]
) -> None:
    live = await anonymous_client.get(f"/api/v1/stats/sessions/{running['live'].id}/scores")
    older = await anonymous_client.get(f"/api/v1/stats/sessions/{running['over'].id}/scores")

    assert live.status_code == 200
    assert older.status_code == 403
    assert older.json() == {"detail": "missing_permission:stats.history"}


async def test_a_song_s_whole_history_needs_stats_history(
    anonymous_client: AsyncClient, seeded: dict[str, Any]
) -> None:
    """Every score a song ever got reaches back over every party, so there is no
    "tonight only" version of it."""
    response = await anonymous_client.get("/api/v1/stats/songs/usdb:1/scores")

    assert response.status_code == 403
    assert response.json() == {"detail": "missing_permission:stats.history"}


async def test_your_own_scores_need_no_history_right_but_somebody_else_s_do(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    seeded: dict[str, Any],
) -> None:
    """Identity, not a capability: "Your scores" must not empty out when the host takes the
    archive away from the `user` role."""
    yannis: Player = seeded["yannis"]
    user_id = await add_user(session_factory, "yannis", "user")
    yannis.user_id = user_id
    yannis.registered = True
    await session.execute(
        delete(RolePermission).where(
            RolePermission.role == "user", RolePermission.capability == "stats.history"
        )
    )
    await session.commit()
    await add_session(session_factory, "yannis-token", user_id)
    permissions.invalidate_cache()
    anonymous_client.cookies.set(COOKIE_NAME, "yannis-token", domain="wingman.test", path="/")

    own = await anonymous_client.get(f"/api/v1/stats/players/{yannis.id}/scores")
    other = await anonymous_client.get(f"/api/v1/stats/players/{seeded['mona'].id}/scores")

    assert own.status_code == 200
    assert [score["score"] for score in own.json()["scores"]] == [8500, 5000]
    assert other.status_code == 403
    assert other.json() == {"detail": "missing_permission:stats.history"}


async def test_a_singer_sees_the_parties_they_were_at_without_the_history_right(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    parties: dict[str, Any],
) -> None:
    """The party you sang at is yours: it is your own evening, and the same reasoning as
    "your own scores" on the user page. The one you missed is still the archive."""
    await sign_in(anonymous_client, session_factory, session, "yannis", parties["yannis"])
    await take_history_away(session)

    listed = await anonymous_client.get("/api/v1/stats/sessions")

    assert listed.status_code == 200
    # Newest first: the party going on right now, then the one he sang at nine days ago.
    assert [row["id"] for row in listed.json()["sessions"]] == [
        parties["live"].id,
        parties["mine"].id,
    ]

    mine = await anonymous_client.get(f"/api/v1/stats/sessions/{parties['mine'].id}/scores")
    theirs = await anonymous_client.get(f"/api/v1/stats/sessions/{parties['theirs'].id}/scores")

    assert mine.status_code == 200
    # The whole scoreboard of that evening, not only his own row: a party is what the room
    # sang, and everybody who was there saw the same board.
    assert [row["score"] for row in mine.json()["scores"]] == [4000, 5000]
    assert theirs.status_code == 403
    assert theirs.json() == {"detail": "missing_permission:stats.history"}


async def test_a_signed_in_stranger_sees_only_the_running_party(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    parties: dict[str, Any],
) -> None:
    """An account is not a ticket to every past party — only to the ones it sang at. This
    one has no player at all, so it was at none of them."""
    await sign_in(anonymous_client, session_factory, session, "newcomer")
    await take_history_away(session)

    listed = await anonymous_client.get("/api/v1/stats/sessions")

    assert [row["id"] for row in listed.json()["sessions"]] == [parties["live"].id]
    assert (
        await anonymous_client.get(f"/api/v1/stats/sessions/{parties['mine'].id}/scores")
    ).status_code == 403


async def test_the_history_right_still_opens_every_party(
    client: AsyncClient, parties: dict[str, Any]
) -> None:
    listed = await client.get("/api/v1/stats/sessions")

    assert [row["id"] for row in listed.json()["sessions"]] == [
        parties["live"].id,
        parties["theirs"].id,
        parties["mine"].id,
    ]
    assert (
        await client.get(f"/api/v1/stats/sessions/{parties['theirs'].id}/scores")
    ).status_code == 200


async def test_every_party_at_once_holds_the_whole_archive_for_a_history_reader(
    client: AsyncClient, parties: dict[str, Any]
) -> None:
    response = await client.get("/api/v1/stats/scores")

    assert response.status_code == 200
    # Newest first across all three parties; the two of the oldest sing are one second apart.
    assert [row["score"] for row in response.json()["scores"]] == [7000, 6000, 4000, 5000]


async def test_every_party_at_once_leaves_out_a_sing_that_belongs_to_no_party(
    client: AsyncClient, session: AsyncSession, parties: dict[str, Any]
) -> None:
    """Migration 0008 added `sings.session_id`, so every run recorded before it has none.
    Such a score is in no session listing, and the head row has to agree with the parties it
    claims to add up — otherwise "All parties" would be more than all the sessions."""
    orphan = Sing(song_id="usdb:1", session_id=None, started_at=datetime.now(UTC))
    session.add(orphan)
    await session.flush()
    session.add(
        Score(
            sing_id=orphan.id,
            player_id=parties["yannis"].id,
            player_name="Yannis",
            score=9999,
            recorded_at=datetime.now(UTC),
        )
    )
    await session.commit()

    meta = (await client.get("/api/v1/stats/scores")).json()["scores"]
    per_session: list[int] = []
    for entry in (await client.get("/api/v1/stats/sessions")).json()["sessions"]:
        listing = await client.get(f"/api/v1/stats/sessions/{entry['id']}/scores")
        per_session += [row["id"] for row in listing.json()["scores"]]

    assert 9999 not in [row["score"] for row in meta]
    # The head row is exactly the visible sessions summed, which is the whole point of it.
    assert sorted(row["id"] for row in meta) == sorted(per_session)
    # It is still that player's own score, and still the last thing that happened.
    own = await client.get(f"/api/v1/stats/players/{parties['yannis'].id}/scores")
    assert 9999 in [row["score"] for row in own.json()["scores"]]


async def test_every_party_at_once_holds_only_your_own_parties_without_history(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    parties: dict[str, Any],
) -> None:
    """The head row without the history right: the parties this reader may open, and
    nothing from the one they were not at."""
    await sign_in(anonymous_client, session_factory, session, "yannis", parties["yannis"])
    await take_history_away(session)

    response = await anonymous_client.get("/api/v1/stats/scores")

    assert response.status_code == 200
    assert [row["score"] for row in response.json()["scores"]] == [7000, 4000, 5000]


async def test_every_party_at_once_is_tonight_alone_for_a_guest(
    anonymous_client: AsyncClient, parties: dict[str, Any]
) -> None:
    """A guest phone has no identity, so it was at no party but the one it is standing in."""
    response = await anonymous_client.get("/api/v1/stats/scores")

    assert response.status_code == 200
    assert [row["score"] for row in response.json()["scores"]] == [7000]


async def test_a_hidden_party_drops_out_of_the_listing(
    client: AsyncClient, seeded: dict[str, Any], broadcast_events: list[dict[str, object]]
) -> None:
    hidden = await client.put(
        f"/api/v1/stats/sessions/{seeded['old'].id}/hidden", json={"hidden": True}
    )

    assert hidden.status_code == 200
    assert hidden.json()["hidden"] is True
    # The whole row comes back, counts included, so the UI does not have to refetch.
    assert hidden.json()["sing_count"] == 1

    listed = (await client.get("/api/v1/stats/sessions")).json()
    assert [row["id"] for row in listed["sessions"]] == [seeded["new"].id]
    # The head row of the picker stands for `GET /stats/scores`, which hiding does not
    # touch — so its two figures count the hidden party too.
    assert (listed["session_count"], listed["score_count"]) == (2, 4)
    # Ids say nothing about who may see what, so the event carries none.
    assert broadcast_events[-1] == {"event": "sessions.changed"}


async def test_hiding_a_party_changes_that_one_list_and_nothing_else(
    client: AsyncClient, seeded: dict[str, Any]
) -> None:
    """The party keeps every score it has, everywhere a score is read back."""
    before = {
        path: (await client.get(path)).json()
        for path in (
            "/api/v1/stats/scores",
            f"/api/v1/stats/sessions/{seeded['old'].id}/scores",
            "/api/v1/stats/songs/usdb:1/scores",
            f"/api/v1/stats/players/{seeded['yannis'].id}/scores",
            "/api/v1/stats/latest",
            f"/api/v1/players/{seeded['yannis'].id}/achievements",
        )
    }

    await client.put(f"/api/v1/stats/sessions/{seeded['old'].id}/hidden", json={"hidden": True})

    for path, answer in before.items():
        assert (await client.get(path)).json() == answer, path


async def test_a_hidden_party_comes_back_when_it_is_asked_for(
    client: AsyncClient, seeded: dict[str, Any]
) -> None:
    await client.put(f"/api/v1/stats/sessions/{seeded['old'].id}/hidden", json={"hidden": True})

    listed = (await client.get("/api/v1/stats/sessions?include_hidden=true")).json()

    assert [(row["id"], row["hidden"]) for row in listed["sessions"]] == [
        (seeded["new"].id, False),
        (seeded["old"].id, True),
    ]
    # Asking for the hidden ones cannot change what the head row says.
    assert (listed["session_count"], listed["score_count"]) == (2, 4)


async def test_a_hidden_party_can_be_put_back(client: AsyncClient, seeded: dict[str, Any]) -> None:
    await client.put(f"/api/v1/stats/sessions/{seeded['old'].id}/hidden", json={"hidden": True})
    back = await client.put(
        f"/api/v1/stats/sessions/{seeded['old'].id}/hidden", json={"hidden": False}
    )

    assert back.status_code == 200
    assert back.json()["hidden"] is False
    listed = (await client.get("/api/v1/stats/sessions")).json()["sessions"]
    assert [row["id"] for row in listed] == [seeded["new"].id, seeded["old"].id]


async def test_asking_for_the_hidden_parties_needs_the_capability(
    client: AsyncClient,
    anonymous_client: AsyncClient,
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    seeded: dict[str, Any],
) -> None:
    """A reader without `stats.hide` gets the default list whatever they ask — a short list
    rather than a 403, the way this route already answers."""
    await client.put(f"/api/v1/stats/sessions/{seeded['old'].id}/hidden", json={"hidden": True})
    # An account that may read the whole archive, and still may not ask for the hidden ones.
    await sign_in(anonymous_client, session_factory, session, "reader", role="trusted")

    listed = (await anonymous_client.get("/api/v1/stats/sessions?include_hidden=true")).json()

    assert [row["id"] for row in listed["sessions"]] == [seeded["new"].id]


async def test_hiding_a_party_is_not_a_naming_right(
    anonymous_client: AsyncClient,
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    seeded: dict[str, Any],
) -> None:
    """`stats.manage` names a party; deciding which evenings the room still gets to look at
    is a right of its own."""
    await sign_in(anonymous_client, session_factory, session, "helper", role="trusted")

    named = await anonymous_client.patch(
        f"/api/v1/stats/sessions/{seeded['old'].id}", json={"name": "Renamed"}
    )
    hidden = await anonymous_client.put(
        f"/api/v1/stats/sessions/{seeded['old'].id}/hidden", json={"hidden": True}
    )

    assert named.status_code == 200
    assert hidden.status_code == 403


async def test_the_party_being_sung_cannot_be_hidden(
    client: AsyncClient, parties: dict[str, Any], broadcast_events: list[dict[str, object]]
) -> None:
    """The evening in progress is what the Scores page is for."""
    response = await client.put(
        f"/api/v1/stats/sessions/{parties['live'].id}/hidden", json={"hidden": True}
    )

    assert response.status_code == 409
    assert parties["live"].id in response.json()["detail"]
    assert broadcast_events == []


async def test_the_party_being_sung_stays_listed_and_can_be_put_back(
    client: AsyncClient,
    anonymous_client: AsyncClient,
    session: AsyncSession,
    parties: dict[str, Any],
) -> None:
    """A party hidden while it was over, and then sung into again: the flag is dormant while
    the evening lasts, so a phone at that party is not left with an empty page — and it can
    be taken off without waiting for the room to go home."""
    live = await session.get(KaraokeSession, parties["live"].id)
    assert live is not None
    live.hidden = True
    await session.commit()

    guest = (await anonymous_client.get("/api/v1/stats/sessions")).json()["sessions"]
    assert [(row["id"], row["hidden"], row["current"]) for row in guest] == [
        (parties["live"].id, True, True)
    ]

    back = await client.put(
        f"/api/v1/stats/sessions/{parties['live'].id}/hidden", json={"hidden": False}
    )
    assert back.status_code == 200
    assert back.json()["hidden"] is False


async def test_hiding_an_unknown_party_is_a_404(client: AsyncClient) -> None:
    response = await client.put("/api/v1/stats/sessions/nope/hidden", json={"hidden": True})

    assert response.status_code == 404


async def test_a_score_moves_to_the_singer_it_belongs_to(
    client: AsyncClient,
    parties: dict[str, Any],
    broadcast_events: list[dict[str, object]],
) -> None:
    """The fix for a wrongly picked player: the number and the song stay, the singer
    changes."""
    scores = (await client.get(f"/api/v1/stats/sessions/{parties['mine'].id}/scores")).json()
    wrong = next(row for row in scores["scores"] if row["score"] == 5000)

    response = await client.patch(
        f"/api/v1/stats/scores/{wrong['id']}", json={"player_id": parties["mona"].id}
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["player_id"], body["player_name"]) == (parties["mona"].id, "Mona")
    # The sing it was scored in — and with it the party and the song — is untouched.
    assert body["sing_id"] == wrong["sing_id"] == parties["mine_sing"].id
    assert body["score"] == 5000
    # It is Mona's record now and no longer Yannis's.
    mona = await client.get(f"/api/v1/stats/players/{parties['mona'].id}/scores")
    assert sorted(row["score"] for row in mona.json()["scores"]) == [4000, 5000, 6000, 7000]
    yannis = await client.get(f"/api/v1/stats/players/{parties['yannis'].id}/scores")
    assert yannis.json()["scores"] == []
    # The other screens in the room hear about it — but not as a fresh sing, which would
    # throw last song's results back onto the host TV.
    assert [event for event in broadcast_events if event["event"] == "scores.recorded"] == []
    assert [event for event in broadcast_events if event["event"] == "scores.changed"] == [
        {"event": "scores.changed", "sing_id": parties["mine_sing"].id}
    ]


async def test_both_singers_of_a_duet_may_end_up_on_one_player(
    client: AsyncClient, parties: dict[str, Any]
) -> None:
    """Nothing stops it, on purpose: swapping the two singers of a duet passes through
    exactly this state, and a rule against it would block the correction it exists for."""
    scores = (await client.get(f"/api/v1/stats/sessions/{parties['mine'].id}/scores")).json()
    yannis_score = next(row for row in scores["scores"] if row["score"] == 5000)

    response = await client.patch(
        f"/api/v1/stats/scores/{yannis_score['id']}", json={"player_id": parties["mona"].id}
    )

    assert response.status_code == 200
    after = (await client.get(f"/api/v1/stats/sessions/{parties['mine'].id}/scores")).json()
    assert [row["player_name"] for row in after["scores"]] == ["Mona", "Mona"]
    # One singer now, where there were two.
    listed = (await client.get("/api/v1/stats/sessions")).json()["sessions"]
    assert next(row for row in listed if row["id"] == parties["mine"].id)["singer_count"] == 1


async def test_moving_a_score_needs_a_score_and_a_player_that_exist(
    client: AsyncClient, parties: dict[str, Any]
) -> None:
    scores = (await client.get("/api/v1/stats/scores")).json()["scores"]

    assert (
        await client.patch("/api/v1/stats/scores/999999", json={"player_id": parties["mona"].id})
    ).status_code == 404
    unknown_player = await client.patch(
        f"/api/v1/stats/scores/{scores[0]['id']}", json={"player_id": "nope"}
    )
    assert unknown_player.status_code == 404
    assert unknown_player.json() == {"detail": "unknown player 'nope'"}


async def test_deleting_a_score_leaves_the_sing_behind(
    client: AsyncClient,
    parties: dict[str, Any],
    broadcast_events: list[dict[str, object]],
) -> None:
    """The score goes, the performance stays: the song *was* played, which is what the
    Recent tab and a party's `sing_count` are counted from."""
    live = (await client.get(f"/api/v1/stats/sessions/{parties['live'].id}/scores")).json()
    only = live["scores"][0]

    response = await client.delete(f"/api/v1/stats/scores/{only['id']}")

    assert response.status_code == 204
    assert (await client.get(f"/api/v1/stats/sessions/{parties['live'].id}/scores")).json() == {
        "scores": []
    }
    listed = (await client.get("/api/v1/stats/sessions")).json()["sessions"]
    live_row = next(row for row in listed if row["id"] == parties["live"].id)
    # The sing is still counted, and so is the party itself.
    assert (live_row["sing_count"], live_row["score_count"], live_row["singer_count"]) == (1, 0, 0)
    sings = (await client.get("/api/v1/stats/sessions/current/sings")).json()["sings"]
    assert [row["sing_id"] for row in sings] == [parties["live_sing"].id]
    assert [event for event in broadcast_events if event["event"] == "scores.changed"] == [
        {"event": "scores.changed", "sing_id": parties["live_sing"].id}
    ]


async def test_deleting_an_unknown_score_is_a_404(
    client: AsyncClient, parties: dict[str, Any]
) -> None:
    assert (await client.delete("/api/v1/stats/scores/999999")).status_code == 404


async def test_correcting_a_score_is_not_a_singers_own_right(
    anonymous_client: AsyncClient,
    session_factory: async_sessionmaker[AsyncSession],
    session: AsyncSession,
    parties: dict[str, Any],
) -> None:
    """Being at the party lets you read its scoreboard, never rewrite it — `stats.moderate`
    starts with the administrator alone."""
    await sign_in(anonymous_client, session_factory, session, "yannis", parties["yannis"])
    scores = (await anonymous_client.get("/api/v1/stats/scores")).json()["scores"]
    own = next(row for row in scores if row["score"] == 5000)

    moved = await anonymous_client.patch(
        f"/api/v1/stats/scores/{own['id']}", json={"player_id": parties["mona"].id}
    )
    deleted = await anonymous_client.delete(f"/api/v1/stats/scores/{own['id']}")

    assert moved.status_code == 403
    assert moved.json() == {"detail": "missing_permission:stats.moderate"}
    assert deleted.status_code == 403


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
