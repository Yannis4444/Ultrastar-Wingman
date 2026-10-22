"""When achievements are recomputed, and what the room is told about it.

Four things start a pass: a finished sing, the two corrections `stats.moderate` may make,
and any write to the catalogue or to the global toggle. The engine itself is
`test_achievements_evaluate.py`'s business — these tests are about the wiring: that the
trigger fires at all, that it reaches the right players, and that the one event on the bus
carries what the host screen needs.

The finished sing runs against the fake USDX of `test_karaoke_api`, so the trigger is
exercised where it really sits: on the launcher's exit path, right after `scores.recorded`.
"""

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import test_karaoke_api
from test_karaoke_api import FakeUsdx, add_player, sing
from ultrastar_wingman.achievements import service
from ultrastar_wingman.achievements.builtin import BUILT_INS
from ultrastar_wingman.achievements.model import Achievement, PlayerAchievement
from ultrastar_wingman.achievements.schema import parse_definition
from ultrastar_wingman.achievements.settings import DEFINITIONS, ENABLED
from ultrastar_wingman.karaoke import service as karaoke
from ultrastar_wingman.karaoke.model import Score, Sing
from ultrastar_wingman.players.model import Player
from ultrastar_wingman.settings import SettingsService
from ultrastar_wingman.songs.model import Song

# The fake-USDX fixtures, bound here so pytest can resolve them by name: the finished-sing
# trigger sits on the launcher's exit path, so the only honest way to test it is to let a
# (fake) song end. Bound rather than imported, because a test's own `configured` parameter
# would otherwise read as a redefinition of the import.
fake_usdx = test_karaoke_api.fake_usdx
configured = test_karaoke_api.configured
song = test_karaoke_api.song

# USDX stores its strings fixed-width, padded with NUL characters.
NUL = chr(0)

START = datetime(2026, 9, 1, 20, 0, tzinfo=UTC)


async def drop_built_ins(session: AsyncSession) -> None:
    """Take the set Wingman ships off the catalogue.

    Migrations 0023, 0030 and 0031 seed them and a pass looks at every enabled one, so a test
    that names exactly what somebody earned has to be run against a catalogue it built
    itself. What the shipped set means is checked on its own further down.
    """
    await session.execute(delete(Achievement).where(Achievement.built_in.is_(True)))
    await session.commit()


async def add_achievement(
    session: AsyncSession,
    achievement_id: str,
    definition: list[dict[str, Any]],
    *,
    name: str | None = None,
    hidden: bool = False,
    sort_order: int = 0,
) -> None:
    await drop_built_ins(session)
    session.add(
        Achievement(
            id=achievement_id,
            name=name or achievement_id,
            color="gold",
            hidden=hidden,
            sort_order=sort_order,
            definition=definition,
        )
    )
    await session.commit()


async def add_player_row(session: AsyncSession, name: str) -> str:
    """The player's id, not the row: the assertions below run after another session has
    written, and an ORM instance held across that only invites a stale read."""
    player = Player(name=name)
    session.add(player)
    await session.commit()
    return player.id


async def add_song(session: AsyncSession, song_id: str, artist: str, is_duet: bool = False) -> None:
    session.add(
        Song(
            id=song_id,
            source="usdb",
            source_id=song_id.split(":")[1],
            title=f"Song {song_id}",
            artist=artist,
            is_duet=is_duet,
            fingerprint=f"{artist.lower()}|{song_id}",
            directory=f"/songs/{song_id}",
            txt_file=f"/songs/{song_id}/song.txt",
        )
    )
    await session.commit()


async def add_score(
    session: AsyncSession,
    *,
    sing_id: str,
    song_id: str,
    session_id: str | None,
    player_id: str,
    score: int,
    at: datetime,
) -> Score:
    if await session.get(Sing, sing_id) is None:
        session.add(Sing(id=sing_id, song_id=song_id, session_id=session_id, started_at=at))
    row = Score(
        sing_id=sing_id, player_id=player_id, player_name=player_id, score=score, recorded_at=at
    )
    session.add(row)
    await session.commit()
    return row


async def earned_of(session: AsyncSession, player_id: str) -> set[str]:
    rows = await session.scalars(
        select(PlayerAchievement.achievement_id).where(
            PlayerAchievement.player_id == player_id,
            PlayerAchievement.earned_at.is_not(None),
        )
    )
    return set(rows)


async def test_a_finished_sing_awards_and_announces(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    """One event for the whole sing, right after `scores.recorded`, with every singer it
    earned something for — that is what the host screen choreographs from."""
    await add_achievement(
        session, "golden", [{"metric": "any_score", "comparator": ">=", "value": 8000}]
    )
    yannis = await add_player(client, "Yannis")
    alex = await add_player(client, "Alex")
    # Adding them announced the players list; the sing's own sequence is what is checked.
    broadcast_events.clear()
    configured.behave(
        scores=[("Yannis" + NUL * 10, 8500, 2000, 3), ("Alex" + NUL * 12, 7000, 2001, None)]
    )

    started = await sing(
        client,
        song,
        [{"color": "blue", "player_id": yannis["id"]}, {"color": "red", "player_id": alex["id"]}],
    )
    await karaoke.wait_for_sing_end()

    events = [event["event"] for event in broadcast_events]
    assert events == ["karaoke.started", "karaoke.ended", "scores.recorded", "achievements.earned"]
    earned = broadcast_events[3]
    assert earned["sing_id"] == started["sing_id"]
    players = cast(list[dict[str, Any]], earned["players"])
    # Only the singer who crossed the line is in it — Alex scored 7000 and earned nothing.
    assert [entry["player"]["name"] for entry in players] == ["Yannis"]
    assert [one["id"] for one in players[0]["achievements"]] == ["golden"]
    # The whole player rides along, because the host screen draws the picture beside the badge.
    assert players[0]["player"]["id"] == yannis["id"]

    assert await earned_of(session, str(yannis["id"])) == {"golden"}
    assert await earned_of(session, str(alex["id"])) == set()


async def test_the_event_names_a_singer_s_badges_in_the_catalogue_s_order(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    """A pass hands its badges over in the order it walked the catalogue, and that order
    reaches the TV: the host screen throws them in the order this event names them.

    So `sort_order` decides it. Both of the other candidates are made to disagree with it
    here: the id, which the pass sorted on until 2026-09-05, and the moment the achievement
    was made, which is what settles a tie in `sort_order` and nothing else.
    """
    await add_achievement(
        session,
        "aaa-warmed-up",
        [{"metric": "any_score", "comparator": ">=", "value": 6000}],
        sort_order=2,
    )
    await add_achievement(
        session,
        "zzz-golden",
        [{"metric": "any_score", "comparator": ">=", "value": 8000}],
        sort_order=1,
    )
    yannis = await add_player(client, "Yannis")
    configured.behave(scores=[("Yannis" + NUL * 10, 8500, 2000, 3)])

    await sing(client, song, [{"color": "blue", "player_id": yannis["id"]}])
    await karaoke.wait_for_sing_end()

    (earned,) = [event for event in broadcast_events if event["event"] == "achievements.earned"]
    players = cast(list[dict[str, Any]], earned["players"])
    assert [one["id"] for one in players[0]["achievements"]] == ["zzz-golden", "aaa-warmed-up"]


async def test_winning_a_song_is_earned_off_the_placement_the_sing_recorded(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, song: str
) -> None:
    """`number_of_wins`, end to end: the placement `_finish` wrote is what the pass reads
    back, so the badge lands on the singer who came first and on nobody else."""
    await add_achievement(
        session, "winner", [{"metric": "number_of_wins", "comparator": ">=", "value": 1}]
    )
    yannis = await add_player(client, "Yannis")
    alex = await add_player(client, "Alex")
    configured.behave(
        scores=[("Yannis" + NUL * 10, 8500, 2000, 3), ("Alex" + NUL * 12, 7000, 2001, 3)]
    )

    await sing(
        client,
        song,
        [{"color": "blue", "player_id": yannis["id"]}, {"color": "red", "player_id": alex["id"]}],
    )
    await karaoke.wait_for_sing_end()

    assert await earned_of(session, str(yannis["id"])) == {"winner"}
    assert await earned_of(session, str(alex["id"])) == set()

    # And it survives the loser being taken off the record: the win was against somebody,
    # and the columns that say so are never recomputed (`stats.service.delete_score`).
    loser = await session.scalar(select(Score).where(Score.player_id == alex["id"]))
    assert loser is not None
    assert (await client.delete(f"/api/v1/stats/scores/{loser.id}")).status_code == 204
    assert await earned_of(session, str(yannis["id"])) == {"winner"}


async def test_a_reassigned_score_takes_its_win_with_it(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, song: str
) -> None:
    """The other `stats.moderate` correction: the win moves to whoever the score is put on.

    Nothing about the sing is renumbered — both rows keep the placement and the field size
    they were given — and the pass that follows the correction reads them back, so the badge
    lands on the new owner and is taken off the old one. The new owner now holds *both*
    scores of that sing, which is the state a duet swap goes through: one of them is
    placement 1, so it is one win and not two.
    """
    await add_achievement(
        session, "winner", [{"metric": "number_of_wins", "comparator": ">=", "value": 1}]
    )
    await add_achievement(
        session, "double", [{"metric": "number_of_wins", "comparator": ">=", "value": 2}]
    )
    yannis = await add_player(client, "Yannis")
    alex = await add_player(client, "Alex")
    configured.behave(
        scores=[("Yannis" + NUL * 10, 8500, 2000, 3), ("Alex" + NUL * 12, 7000, 2001, 3)]
    )

    await sing(
        client,
        song,
        [{"color": "blue", "player_id": yannis["id"]}, {"color": "red", "player_id": alex["id"]}],
    )
    await karaoke.wait_for_sing_end()
    assert await earned_of(session, str(yannis["id"])) == {"winner"}

    winning = await session.scalar(select(Score).where(Score.player_id == yannis["id"]))
    assert winning is not None
    moved = await client.patch(f"/api/v1/stats/scores/{winning.id}", json={"player_id": alex["id"]})
    assert moved.status_code == 200

    session.expire_all()
    rows = list(
        await session.execute(
            select(Score.player_name, Score.score, Score.placement, Score.field_size).order_by(
                Score.score.desc()
            )
        )
    )
    assert rows == [("Alex", 8500, 1, 2), ("Alex", 7000, 2, 2)]
    assert await earned_of(session, str(yannis["id"])) == set()
    assert await earned_of(session, str(alex["id"])) == {"winner"}


async def test_a_song_sung_alone_earns_no_win(
    client: AsyncClient, session: AsyncSession, configured: FakeUsdx, song: str
) -> None:
    """The user's own question, answered: without the field size a solo and a victory would
    be the same row, and everybody who ever sang would hold this badge."""
    await add_achievement(
        session, "winner", [{"metric": "number_of_wins", "comparator": ">=", "value": 1}]
    )
    yannis = await add_player(client, "Yannis")
    configured.behave(scores=[("Yannis" + NUL * 10, 8500, 2000, 3)])

    await sing(client, song, [{"color": "blue", "player_id": yannis["id"]}])
    await karaoke.wait_for_sing_end()

    assert await earned_of(session, str(yannis["id"])) == set()


async def test_the_bus_reveals_a_hidden_badge_but_never_what_it_asked_for(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    """Earning one is what reveals it, so the name and the glyph go out in full — the host
    screen has to be able to draw the thing it just awarded.

    The `definition` never does. The bus is open to anonymous sockets, and what a hidden
    achievement *asks* for is the surprise itself: a listener that could read it would know
    what to sing to earn the rest.
    """
    await add_achievement(
        session,
        "brave",
        [{"metric": "any_score", "comparator": "<=", "value": 2000}],
        name="Brave Soul",
        hidden=True,
    )
    yannis = await add_player(client, "Yannis")
    configured.behave(scores=[("Yannis" + NUL * 10, 1500, 2000, 3)])

    await sing(client, song, [{"color": "blue", "player_id": yannis["id"]}])
    await karaoke.wait_for_sing_end()

    (earned,) = [event for event in broadcast_events if event["event"] == "achievements.earned"]
    players = cast(list[dict[str, Any]], earned["players"])
    (badge,) = players[0]["achievements"]
    assert badge["name"] == "Brave Soul"
    assert badge["hidden"] is True
    assert badge["definition"] is None


async def test_a_sing_that_earned_nothing_is_silent(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    await add_achievement(
        session, "untouchable", [{"metric": "any_score", "comparator": ">=", "value": 9500}]
    )
    yannis = await add_player(client, "Yannis")
    configured.behave(scores=[("Yannis" + NUL * 10, 4000, 2000, 3)])

    await sing(client, song, [{"color": "blue", "player_id": yannis["id"]}])
    await karaoke.wait_for_sing_end()

    assert "achievements.earned" not in [event["event"] for event in broadcast_events]


async def test_the_global_toggle_stops_every_evaluation(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
) -> None:
    """Off means nothing is evaluated and nothing is drawn — not a row is written, and the
    bus stays quiet."""
    await SettingsService(session, DEFINITIONS).set(ENABLED, False)
    await add_achievement(
        session, "golden", [{"metric": "any_score", "comparator": ">=", "value": 1}]
    )
    yannis = await add_player(client, "Yannis")
    configured.behave(scores=[("Yannis" + NUL * 10, 8500, 2000, 3)])

    await sing(client, song, [{"color": "blue", "player_id": yannis["id"]}])
    await karaoke.wait_for_sing_end()

    assert "achievements.earned" not in [event["event"] for event in broadcast_events]
    assert list(await session.scalars(select(PlayerAchievement))) == []


async def test_switching_the_toggle_off_keeps_what_was_earned(session: AsyncSession) -> None:
    """The evening is not erased; switching it back on is the full pass that corrects it."""
    await add_achievement(
        session, "golden", [{"metric": "any_score", "comparator": ">=", "value": 1}]
    )
    player_id = await add_player_row(session, "Yannis")
    await add_song(session, "usdb:1", "Artist")
    await add_score(
        session,
        sing_id="s1",
        song_id="usdb:1",
        session_id="party-a",
        player_id=player_id,
        score=9000,
        at=START,
    )
    await service.evaluate_player(session, player_id, now=START)
    assert await earned_of(session, player_id) == {"golden"}

    await SettingsService(session, DEFINITIONS).set(ENABLED, False)
    assert await service.evaluate_player(session, player_id, now=START) == []
    assert await service.evaluate_all(session, now=START) == {}

    assert await earned_of(session, player_id) == {"golden"}


async def test_reassigning_a_score_moves_the_badge(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Both ends of the move: the singer who lost the score loses the badge with it, and the
    one who gained it has just earned it."""
    await add_achievement(
        session, "golden", [{"metric": "any_score", "comparator": ">=", "value": 9000}]
    )
    yannis_id = await add_player_row(session, "Yannis")
    alex_id = await add_player_row(session, "Alex")
    await add_song(session, "usdb:1", "Artist")
    score = await add_score(
        session,
        sing_id="s1",
        song_id="usdb:1",
        session_id="party-a",
        player_id=yannis_id,
        score=9500,
        at=START,
    )
    await service.evaluate_all(session, now=START)
    assert await earned_of(session, yannis_id) == {"golden"}

    response = await client.patch(f"/api/v1/stats/scores/{score.id}", json={"player_id": alex_id})

    assert response.status_code == 200, response.text
    assert await earned_of(session, yannis_id) == set()
    assert await earned_of(session, alex_id) == {"golden"}


async def test_deleting_a_score_revokes_what_it_earned(
    client: AsyncClient, session: AsyncSession
) -> None:
    await add_achievement(
        session, "golden", [{"metric": "any_score", "comparator": ">=", "value": 9000}]
    )
    yannis_id = await add_player_row(session, "Yannis")
    await add_song(session, "usdb:1", "Artist")
    good = await add_score(
        session,
        sing_id="s1",
        song_id="usdb:1",
        session_id="party-a",
        player_id=yannis_id,
        score=9500,
        at=START,
    )
    await add_score(
        session,
        sing_id="s2",
        song_id="usdb:1",
        session_id="party-a",
        player_id=yannis_id,
        score=1000,
        at=START + timedelta(minutes=5),
    )
    await service.evaluate_all(session, now=START)
    assert await earned_of(session, yannis_id) == {"golden"}

    response = await client.delete(f"/api/v1/stats/scores/{good.id}")

    assert response.status_code == 204
    assert await earned_of(session, yannis_id) == set()
    # The row itself stays and carries the progress — it is not a badge, it is where they are.
    (row,) = list(await session.scalars(select(PlayerAchievement)))
    assert row.earned_at is None


async def test_an_edited_definition_is_recomputed_for_everybody(
    client: AsyncClient, session: AsyncSession
) -> None:
    """Not only for whoever happens to sing next: raising a target revokes it from people who
    are not in the room any more."""
    await drop_built_ins(session)
    yannis_id = await add_player_row(session, "Yannis")
    await add_song(session, "usdb:1", "Artist")
    await add_score(
        session,
        sing_id="s1",
        song_id="usdb:1",
        session_id="party-a",
        player_id=yannis_id,
        score=9200,
        at=START,
    )
    created = await client.post(
        "/api/v1/achievements",
        json={
            "name": "Golden",
            "color": "gold",
            "definition": [{"metric": "any_score", "comparator": ">=", "value": 9000}],
        },
    )
    assert created.status_code == 201, created.text
    achievement_id = created.json()["id"]
    await service.wait_for_passes()
    assert await earned_of(session, yannis_id) == {achievement_id}

    edited = await client.patch(
        f"/api/v1/achievements/{achievement_id}",
        json={"definition": [{"metric": "any_score", "comparator": ">=", "value": 9500}]},
    )
    assert edited.status_code == 200, edited.text
    await service.wait_for_passes()

    assert await earned_of(session, yannis_id) == set()


async def test_switching_the_feature_back_on_recomputes_everybody(
    client: AsyncClient, session: AsyncSession
) -> None:
    await SettingsService(session, DEFINITIONS).set(ENABLED, False)
    await add_achievement(
        session, "golden", [{"metric": "any_score", "comparator": ">=", "value": 1}]
    )
    yannis_id = await add_player_row(session, "Yannis")
    await add_song(session, "usdb:1", "Artist")
    await add_score(
        session,
        sing_id="s1",
        song_id="usdb:1",
        session_id="party-a",
        player_id=yannis_id,
        score=9000,
        at=START,
    )

    response = await client.patch("/api/v1/achievements/settings", json={"enabled": True})

    assert response.status_code == 200, response.text
    await service.wait_for_passes()
    assert await earned_of(session, yannis_id) == {"golden"}


@pytest.mark.parametrize(
    ("achievement_id", "expected"),
    [
        ("builtin-first-song", True),
        ("builtin-score-6000", True),
        ("builtin-score-8000", True),
        ("builtin-score-9000", True),
        ("builtin-score-9500", False),
        ("builtin-evening-50k", False),
        ("builtin-evening-songs-5", False),
        ("builtin-evening-songs-20", False),
        ("builtin-evening-hat-trick", False),
        ("builtin-first-duet", True),
        ("builtin-artists-10", False),
        ("builtin-brave-soul", True),
    ],
)
async def test_the_seeded_built_ins_evaluate_against_a_small_party(
    session: AsyncSession, achievement_id: str, expected: bool
) -> None:
    """A realistic little evening: four songs, one of them a duet, one of them a disaster.

    The point is that the shipped definitions mean what their sentences say — the engine's
    own semantics are `test_achievements_evaluate.py`'s.
    """
    assert achievement_id in {one.id for one in BUILT_INS}
    player_id = await add_player_row(session, "Yannis")
    await add_song(session, "usdb:1", "Abba")
    await add_song(session, "usdb:2", "Queen")
    await add_song(session, "usdb:3", "Grease", is_duet=True)
    await add_song(session, "usdb:4", "Nirvana")
    for index, (song_id, score) in enumerate(
        [("usdb:1", 9100), ("usdb:2", 6200), ("usdb:3", 8300), ("usdb:4", 1500)]
    ):
        await add_score(
            session,
            sing_id=f"s{index}",
            song_id=song_id,
            session_id="party-a",
            player_id=player_id,
            score=score,
            at=START + timedelta(minutes=index * 5),
        )

    await service.evaluate_player(session, player_id, now=START)

    assert (achievement_id in await earned_of(session, player_id)) is expected


async def sing_through(
    session: AsyncSession, player_id: str, songs: list[tuple[str, int, str]], *, first: int = 0
) -> None:
    """One sing per entry, five minutes apart. `songs` is (song id, score, party).

    A sing id per player, so two singers in the same test never share one — a shared sing is
    a duet, and `number_of_sings` counts it once.
    """
    for index, (song_id, score, party) in enumerate(songs, start=first):
        await add_score(
            session,
            sing_id=f"{player_id}-s{index}",
            song_id=song_id,
            session_id=party,
            player_id=player_id,
            score=score,
            at=START + timedelta(minutes=index * 5),
        )


async def test_the_hat_trick_wants_its_three_high_scores_in_the_same_party(
    session: AsyncSession,
) -> None:
    """*Score 9,000 or more three times in one party* is `number_of_scores >= 3` with a
    `score_filter.min` — the filter runs first, and `session` scope is what makes "in one
    party" mean one party.

    The near miss is the half worth pinning: three high scores that are not in the same
    evening earn nothing, which is exactly what a definition that forgot its scope would
    still award.
    """
    for song_id, artist in [("usdb:1", "Abba"), ("usdb:2", "Queen"), ("usdb:3", "Nirvana")]:
        await add_song(session, song_id, artist)
    one_night = await add_player_row(session, "Yannis")
    await sing_through(
        session,
        one_night,
        [("usdb:1", 9100, "party-a"), ("usdb:2", 9200, "party-a"), ("usdb:3", 9300, "party-a")],
    )
    spread_out = await add_player_row(session, "Alex")
    await sing_through(
        session,
        spread_out,
        [("usdb:1", 9100, "party-a"), ("usdb:2", 9200, "party-a"), ("usdb:3", 9300, "party-b")],
    )

    await service.evaluate_players(session, [one_night, spread_out], now=START)

    assert "builtin-evening-hat-trick" in await earned_of(session, one_night)
    assert "builtin-evening-hat-trick" not in await earned_of(session, spread_out)


async def test_a_scoreful_night_below_the_line_is_no_hat_trick(session: AsyncSession) -> None:
    """The `score_filter` is what the badge is about: ten mediocre songs are not three good
    ones, and a definition that lost its filter would hand this player the badge."""
    await add_song(session, "usdb:1", "Abba")
    player_id = await add_player_row(session, "Yannis")
    await sing_through(session, player_id, [("usdb:1", 8999, "party-a")] * 10)

    await service.evaluate_player(session, player_id, now=START)

    assert "builtin-evening-hat-trick" not in await earned_of(session, player_id)


async def test_all_night_long_wants_its_twenty_songs_in_the_same_party(
    session: AsyncSession,
) -> None:
    """The third rung of *Five in a Night* → *Iron Lungs*: `number_of_sings >= 20`, `session`
    scope, and nothing else — the same song twenty times counts, because the ladder is about
    how long somebody held the microphone and not about how much of the library they got
    through.

    The near miss is what pins the scope: nineteen songs at one party and one at the next is
    twenty sings and no badge, and it earns the two rungs below this one on the way.
    """
    await add_song(session, "usdb:1", "Abba")
    one_night = await add_player_row(session, "Yannis")
    await sing_through(session, one_night, [("usdb:1", 5000, "party-a")] * 20)
    over_two = await add_player_row(session, "Alex")
    await sing_through(
        session,
        over_two,
        [("usdb:1", 5000, "party-a")] * 19 + [("usdb:1", 5000, "party-b")],
    )

    await service.evaluate_players(session, [one_night, over_two], now=START)

    assert "builtin-evening-songs-20" in await earned_of(session, one_night)
    earned = await earned_of(session, over_two)
    assert "builtin-evening-songs-20" not in earned
    assert {"builtin-evening-songs-5", "builtin-evening-songs-10"} <= earned


async def test_well_travelled_counts_twenty_distinct_artists_case_blind(
    session: AsyncSession,
) -> None:
    """`different_artists`, compared case-insensitively — so singing *Abba* and *ABBA* is one
    artist and not two, and nineteen artists is not twenty (the bar since 2026-09-04)."""
    artists = [
        "Abba",
        "Queen",
        "Nirvana",
        "Blur",
        "Oasis",
        "Pulp",
        "Suede",
        "Ash",
        "Doves",
        "Elbow",
        "Muse",
        "Keane",
        "Travis",
        "Feeder",
        "Placebo",
        "Garbage",
        "Texas",
        "Cast",
        "Kula Shaker",
    ]
    for index, artist in enumerate(artists):
        await add_song(session, f"usdb:{index}", artist)
    # A twentieth song by the first artist under another spelling: still nineteen artists.
    await add_song(session, f"usdb:{len(artists)}", "ABBA")
    player_id = await add_player_row(session, "Yannis")
    sung = len(artists) + 1
    await sing_through(
        session, player_id, [(f"usdb:{index}", 5000, "party-a") for index in range(sung)]
    )
    await service.evaluate_player(session, player_id, now=START)
    assert "builtin-artists-10" not in await earned_of(session, player_id)

    await add_song(session, f"usdb:{sung}", "Radiohead")
    await sing_through(session, player_id, [(f"usdb:{sung}", 5000, "party-a")], first=sung)
    await service.evaluate_player(session, player_id, now=START)

    assert "builtin-artists-10" in await earned_of(session, player_id)


async def test_brave_soul_is_earned_by_scoring_badly_and_draws_no_bar(
    session: AsyncSession,
) -> None:
    """The one `<=` built-in. It is not progressible in either direction — there is no
    progressing toward *fewer*, and a bar that filled as somebody got worse would be a lie —
    so the row it writes carries no numbers at all.
    """
    await add_song(session, "usdb:1", "Abba")
    player_id = await add_player_row(session, "Yannis")
    await sing_through(session, player_id, [("usdb:1", 1500, "party-a")])

    await service.evaluate_player(session, player_id, now=START)

    assert "builtin-brave-soul" in await earned_of(session, player_id)
    row = await session.get(PlayerAchievement, ("builtin-brave-soul", player_id))
    assert row is not None
    assert (row.progress_current, row.progress_target) == (None, None)
    # It is one of the hidden ones, so the API is what keeps it a surprise until then.
    assert (await session.get(Achievement, "builtin-brave-soul")).hidden is True  # type: ignore[union-attr]


def test_every_shipped_definition_parses() -> None:
    """A definition `parse_definition` cannot read is "never satisfied" and not an exception,
    so a typo in `builtin.py` would ship as a badge nobody can ever earn — silently. This is
    the only thing standing between the hand-written JSON in that file and a catalogue of
    them.
    """
    for built_in in BUILT_INS:
        assert parse_definition(built_in.id, built_in.definition) is not None, built_in.id


async def test_a_failing_achievement_pass_does_not_swallow_the_end_of_the_song(
    client: AsyncClient,
    session: AsyncSession,
    configured: FakeUsdx,
    song: str,
    broadcast_events: list[dict[str, object]],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """This pass runs on the launcher's exit path. A badge is the least important thing
    happening there: the scores still have to be recorded, the UI still has to be told the
    song ended, and `wait_for_sing_end` still has to return — otherwise the evening stops.
    """

    async def boom(*args: Any, **kwargs: Any) -> dict[str, list[str]]:
        raise RuntimeError("the engine fell over")

    monkeypatch.setattr(service, "evaluate_players", boom)
    await add_achievement(
        session, "golden", [{"metric": "any_score", "comparator": ">=", "value": 1}]
    )
    yannis = await add_player(client, "Yannis")
    # Adding the player announced the players list; the sing's own sequence is checked.
    broadcast_events.clear()
    configured.behave(scores=[("Yannis" + NUL * 10, 8500, 2000, 3)])

    await sing(client, song, [{"color": "blue", "player_id": yannis["id"]}])
    await karaoke.wait_for_sing_end()

    assert [event["event"] for event in broadcast_events] == [
        "karaoke.started",
        "karaoke.ended",
        "scores.recorded",
    ]
    assert list(await session.scalars(select(Score))) != []
    # Swallowed for the room, never for whoever has to fix it.
    assert "evaluating the achievements" in caplog.text


async def test_a_background_pass_that_fails_says_so_in_the_log(
    session_factory: async_sessionmaker[AsyncSession], caplog: pytest.LogCaptureFixture
) -> None:
    """Nobody is waiting for a full pass's answer, so its failure has nowhere to surface but
    the log — a task that swallowed it would leave the catalogue silently unrecomputed."""

    def broken() -> AsyncSession:
        raise RuntimeError("no database")

    service.start_full_pass(cast(async_sessionmaker[AsyncSession], broken), "a test")
    await service.wait_for_passes()

    assert "recomputing the achievements failed" in caplog.text


async def test_shutdown_cancels_a_pass_that_is_still_running() -> None:
    """A pass must not outlive the database engine: the lifespan cancels what is left before
    disposing it, or the pass wakes up on a dead connection pool."""
    started = asyncio.Event()

    class Blocking:
        async def __aenter__(self) -> None:
            started.set()
            await asyncio.Event().wait()

        async def __aexit__(self, *args: object) -> None:
            return None

    task = service.start_full_pass(cast(Any, Blocking), "a test")
    await started.wait()

    await service.stop_passes()

    assert task.cancelled()
    assert service._passes == set()


async def test_two_passes_over_one_player_do_not_race_on_the_first_row(
    session: AsyncSession, session_factory: async_sessionmaker[AsyncSession]
) -> None:
    """A finishing sing and a moderator's correction can both find no row and both try to
    insert the same composite key. The module lock is what makes the second one wait.

    Two real sessions, because that is what the two call sites have — one session used from
    two tasks would be a different bug entirely.
    """
    await add_achievement(
        session, "golden", [{"metric": "any_score", "comparator": ">=", "value": 1}]
    )
    player_id = await add_player_row(session, "Yannis")
    await add_song(session, "usdb:1", "Artist")
    await add_score(
        session,
        sing_id="s1",
        song_id="usdb:1",
        session_id="party-a",
        player_id=player_id,
        score=9000,
        at=START,
    )

    async def pass_over() -> list[str]:
        async with session_factory() as own:
            return await service.evaluate_player(own, player_id, now=START)

    await asyncio.gather(pass_over(), pass_over())

    assert len(list(await session.scalars(select(PlayerAchievement)))) == 1
