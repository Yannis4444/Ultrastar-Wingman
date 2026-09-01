"""The achievement engine, and the pass that writes down what it decided.

The semantics are checked over hand-built `ScoreRow`s: they are the whole contract of
`evaluate`, and building them by hand keeps a test about `different_artists` from also
being a test about SQL. Only the last section touches a database, and only to check that
the rows a pass writes say what the engine answered.

Conditions are built through `Condition.model_validate` rather than constructed, because
that is how they arrive — out of a JSON column, or off the wire.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ultrastar_wingman.achievements import service
from ultrastar_wingman.achievements.evaluate import Outcome, ScoreRow, evaluate
from ultrastar_wingman.achievements.model import Achievement, PlayerAchievement
from ultrastar_wingman.achievements.schema import Condition, parse_definition
from ultrastar_wingman.auth.model import as_utc
from ultrastar_wingman.karaoke.model import Score, Sing
from ultrastar_wingman.songs.model import Song

# A fixed instant: nothing here may depend on the wall clock.
START = datetime(2026, 9, 1, 20, 0, tzinfo=UTC)

PLAYER = "player-1"
OTHER_PLAYER = "player-2"
GONE_SONG_ID = "usdb:gone"


def row(
    score: int,
    *,
    sing_id: str = "sing-1",
    session_id: str | None = "party-a",
    song_id: str = "usdb:1",
    title: str | None = "Song",
    artist: str | None = "Artist",
    genre: str | None = None,
    language: str | None = None,
    edition: str | None = None,
    year: int | None = None,
    is_duet: bool | None = False,
    has_video: bool | None = False,
) -> ScoreRow:
    return ScoreRow(
        score=score,
        sing_id=sing_id,
        session_id=session_id,
        song_id=song_id,
        title=title,
        artist=artist,
        genre=genre,
        language=language,
        edition=edition,
        year=year,
        is_duet=is_duet,
        has_video=has_video,
    )


def orphan(score: int, *, sing_id: str = "sing-9", session_id: str | None = "party-a") -> ScoreRow:
    """A score whose song has left the library: every song field is None."""
    return ScoreRow(
        score=score,
        sing_id=sing_id,
        session_id=session_id,
        song_id=GONE_SONG_ID,
        title=None,
        artist=None,
        genre=None,
        language=None,
        edition=None,
        year=None,
        is_duet=None,
        has_video=None,
    )


def condition(**fields: Any) -> Condition:
    return Condition.model_validate(fields)


# ---------------------------------------------------------------- the condition models


def test_a_condition_chooses_songs_by_ids_or_by_a_selector_but_not_both() -> None:
    with pytest.raises(ValidationError):
        condition(
            metric="number_of_scores",
            comparator=">=",
            value=1,
            songs={"ids": ["usdb:1"]},
            match={"clauses": []},
        )


@pytest.mark.parametrize(
    "clause",
    [
        # A year cannot contain something, and text cannot be greater than something.
        {"field": "year", "op": "contains", "value": "197"},
        {"field": "title", "op": ">=", "value": "Bo"},
        # The value has to suit the field, or the clause could only ever not match.
        {"field": "year", "op": "=", "value": "1975"},
        {"field": "is_duet", "op": "equals", "value": 1},
        {"field": "genre", "op": "equals", "value": True},
        # Only `equals` says anything about a yes/no field.
        {"field": "has_video", "op": "contains", "value": True},
    ],
)
def test_a_clause_its_field_cannot_answer_is_refused(clause: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        condition(metric="number_of_scores", comparator=">=", value=1, match={"clauses": [clause]})


def test_an_unreadable_definition_is_never_satisfied_rather_than_an_exception(
    caplog: pytest.LogCaptureFixture,
) -> None:
    # Whoever has to repair the row needs to be told which one it is.
    with caplog.at_level(logging.WARNING):
        assert parse_definition("the-broken-one", [{"metric": "nonsense"}]) is None
    assert "the-broken-one" in caplog.text

    # A definition that is not a list of conditions at all, and one with a hole in it.
    assert parse_definition("broken", {"metric": "any_score"}) is None
    assert parse_definition("broken", None) is None
    assert parse_definition("broken", [None]) is None
    assert parse_definition("fine", [{"metric": "any_score", "comparator": ">=", "value": 1}]) == [
        condition(metric="any_score", comparator=">=", value=1)
    ]


def test_an_achievement_that_asks_for_nothing_is_earned_by_nobody() -> None:
    assert evaluate([], [row(9000)]) == Outcome(False, None, None, None)


# ------------------------------------------------------------------------- the metrics


# Two scores in one sing (a duet), three songs, two artists once the case is folded.
METRIC_ROWS = [
    row(1000, sing_id="s1", song_id="usdb:1", artist="Queen"),
    row(2000, sing_id="s1", song_id="usdb:1", artist="Queen"),
    row(3001, sing_id="s2", song_id="usdb:2", artist="queen"),
    row(4000, sing_id="s3", song_id="usdb:3", artist="ABBA"),
]


@pytest.mark.parametrize(
    ("metric", "expected"),
    [
        ("sum_of_scores", 10001),
        # Rounded down: 10001 / 4 is 2500.25.
        ("average_score", 2500),
        ("number_of_scores", 4),
        ("number_of_sings", 3),
        ("different_songs", 3),
        ("different_artists", 2),
    ],
)
def test_each_metric_measures_what_it_says(metric: str, expected: int) -> None:
    assert evaluate([condition(metric=metric, comparator="=", value=expected)], METRIC_ROWS).earned
    assert not evaluate(
        [condition(metric=metric, comparator="=", value=expected + 1)], METRIC_ROWS
    ).earned


def test_any_score_reads_the_best_one_upward_and_the_worst_one_downward() -> None:
    rows = [row(1000), row(9000)]
    assert evaluate([condition(metric="any_score", comparator=">=", value=9000)], rows).earned
    assert evaluate([condition(metric="any_score", comparator=">", value=8999)], rows).earned
    assert not evaluate([condition(metric="any_score", comparator=">=", value=9001)], rows).earned
    assert evaluate([condition(metric="any_score", comparator="<=", value=1000)], rows).earned
    assert evaluate([condition(metric="any_score", comparator="<", value=1001)], rows).earned
    assert not evaluate([condition(metric="any_score", comparator="<=", value=999)], rows).earned


def test_any_score_with_equals_asks_whether_some_score_is_that_number() -> None:
    """Neither end of the set: "a score of exactly 9000" is an existence test, so both the
    best and the worst satisfy it and a number between them satisfies nothing."""
    rows = [row(1000), row(9000)]
    assert evaluate([condition(metric="any_score", comparator="=", value=9000)], rows).earned
    assert evaluate([condition(metric="any_score", comparator="=", value=1000)], rows).earned
    assert not evaluate([condition(metric="any_score", comparator="=", value=5000)], rows).earned


def test_any_score_with_equals_only_looks_at_the_scores_the_filters_left() -> None:
    exactly_1000_among_the_high_ones = condition(
        metric="any_score", comparator="=", value=1000, score_filter={"min": 2000}
    )
    assert not evaluate([exactly_1000_among_the_high_ones], [row(1000), row(9000)]).earned


def test_average_score_over_nothing_is_not_satisfiable() -> None:
    """Not even by a condition every average would meet — an average of nothing is not a
    number, and the filter here leaves no scores at all."""
    nothing_survives = condition(
        metric="average_score", comparator="<=", value=1_000_000, score_filter={"min": 9000}
    )
    assert not evaluate([nothing_survives], [row(1000)]).earned


def test_different_artists_ignores_a_song_that_left_the_library() -> None:
    rows = [row(1000, artist="Queen"), orphan(2000)]
    assert evaluate([condition(metric="different_artists", comparator="=", value=1)], rows).earned


# ------------------------------------------------------------------------- the filters


def test_score_filter_drops_rows_before_the_metric_is_computed() -> None:
    rows = [row(1000), row(9000), row(9500)]
    above = {"min": 9000}
    assert evaluate(
        [condition(metric="number_of_scores", comparator=">=", value=2, score_filter=above)], rows
    ).earned
    assert not evaluate(
        [condition(metric="number_of_scores", comparator=">=", value=3, score_filter=above)], rows
    ).earned
    exactly_9000 = {"min": 9000, "max": 9000}
    assert evaluate(
        [condition(metric="number_of_scores", comparator="=", value=1, score_filter=exactly_9000)],
        rows,
    ).earned


def test_songs_limits_a_condition_to_the_ids_it_names() -> None:
    rows = [row(9000, song_id="usdb:1"), row(1000, song_id="usdb:2")]
    on_one = condition(metric="any_score", comparator=">=", value=9000, songs={"ids": ["usdb:1"]})
    on_the_other = condition(
        metric="any_score", comparator=">=", value=9000, songs={"ids": ["usdb:2"]}
    )
    assert evaluate([on_one], rows).earned
    assert not evaluate([on_the_other], rows).earned


SELECTOR_SONG = row(
    5000,
    title="Bohemian Rhapsody",
    artist="Queen",
    genre="Rock",
    language="English",
    edition="Best Of",
    year=1975,
    is_duet=True,
    has_video=False,
)


@pytest.mark.parametrize(
    ("clause", "matches"),
    [
        # Text: three operators, all case-insensitive.
        ({"field": "title", "op": "contains", "value": "RHAPSODY"}, True),
        ({"field": "title", "op": "contains", "value": "waltz"}, False),
        ({"field": "title", "op": "starts_with", "value": "bohemian"}, True),
        ({"field": "title", "op": "starts_with", "value": "rhapsody"}, False),
        ({"field": "artist", "op": "equals", "value": "queen"}, True),
        ({"field": "artist", "op": "equals", "value": "que"}, False),
        ({"field": "genre", "op": "contains", "value": "roc"}, True),
        ({"field": "language", "op": "equals", "value": "english"}, True),
        ({"field": "edition", "op": "starts_with", "value": "BEST"}, True),
        # The year takes the three number operators.
        ({"field": "year", "op": "=", "value": 1975}, True),
        ({"field": "year", "op": ">=", "value": 1975}, True),
        ({"field": "year", "op": ">=", "value": 1976}, False),
        ({"field": "year", "op": "<=", "value": 1974}, False),
        # The two booleans take `equals` and nothing else.
        ({"field": "is_duet", "op": "equals", "value": True}, True),
        ({"field": "is_duet", "op": "equals", "value": False}, False),
        ({"field": "has_video", "op": "equals", "value": False}, True),
        ({"field": "has_video", "op": "equals", "value": True}, False),
    ],
)
def test_every_selector_field_and_operator(clause: dict[str, Any], matches: bool) -> None:
    one_matching_score = condition(
        metric="number_of_scores", comparator=">=", value=1, match={"clauses": [clause]}
    )
    assert evaluate([one_matching_score], [SELECTOR_SONG]).earned is matches


def test_combine_all_wants_every_clause_and_any_wants_one() -> None:
    right_and_wrong = [
        {"field": "genre", "op": "equals", "value": "Rock"},
        {"field": "artist", "op": "equals", "value": "ABBA"},
    ]
    both = condition(
        metric="number_of_scores",
        comparator=">=",
        value=1,
        match={"combine": "all", "clauses": right_and_wrong},
    )
    either = condition(
        metric="number_of_scores",
        comparator=">=",
        value=1,
        match={"combine": "any", "clauses": right_and_wrong},
    )
    assert not evaluate([both], [SELECTOR_SONG]).earned
    assert evaluate([either], [SELECTOR_SONG]).earned


def test_a_clause_on_a_field_the_song_does_not_have_never_matches() -> None:
    """A song with no genre is not "genre equals anything" — under `any`, where a single
    matching clause would be enough, it still contributes nothing."""
    no_genre = row(5000, genre=None, artist="Queen")
    genre_or_artist = condition(
        metric="number_of_scores",
        comparator=">=",
        value=1,
        match={
            "combine": "any",
            "clauses": [{"field": "genre", "op": "contains", "value": "rock"}],
        },
    )
    assert not evaluate([genre_or_artist], [no_genre]).earned
    assert evaluate(
        [
            condition(
                metric="number_of_scores",
                comparator=">=",
                value=1,
                match={
                    "combine": "any",
                    "clauses": [
                        {"field": "genre", "op": "contains", "value": "rock"},
                        {"field": "artist", "op": "equals", "value": "queen"},
                    ],
                },
            )
        ],
        [no_genre],
    ).earned


def test_a_song_that_left_the_library_counts_only_for_an_unfiltered_condition() -> None:
    rows = [orphan(9000)]
    assert evaluate([condition(metric="any_score", comparator=">=", value=9000)], rows).earned
    by_id = condition(
        metric="any_score", comparator=">=", value=9000, songs={"ids": [GONE_SONG_ID]}
    )
    assert not evaluate([by_id], rows).earned
    # Even a selector that restricts nothing: there is no metadata row left to have matched.
    by_nothing_in_particular = condition(
        metric="any_score", comparator=">=", value=9000, match={"clauses": []}
    )
    assert not evaluate([by_nothing_in_particular], rows).earned


# ------------------------------------------------------------ global and session scope


def test_session_conditions_must_hold_inside_one_and_the_same_party() -> None:
    two_in_one_party = condition(
        scope="session", metric="number_of_scores", comparator=">=", value=2
    )
    spread_over_two = [
        row(9000, sing_id="s1", session_id="party-a"),
        row(9000, sing_id="s2", session_id="party-b"),
    ]
    assert not evaluate([two_in_one_party], spread_over_two).earned

    in_one = [
        row(9000, sing_id="s1", session_id="party-a"),
        row(9000, sing_id="s2", session_id="party-a"),
    ]
    outcome = evaluate([two_in_one_party], in_one)
    assert outcome.earned
    assert outcome.session_id == "party-a"


def test_two_session_conditions_want_one_party_that_satisfies_both() -> None:
    """Not "each condition is satisfied by some party": the party is the same for every
    session-scoped condition of an achievement, which is the whole point of the scope."""
    two_scores = condition(scope="session", metric="number_of_scores", comparator=">=", value=2)
    a_high_one = condition(scope="session", metric="any_score", comparator=">=", value=9000)
    each_in_its_own_party = [
        row(1000, sing_id="s1", session_id="party-a"),
        row(1000, sing_id="s2", session_id="party-a"),
        row(9000, sing_id="s3", session_id="party-b"),
    ]
    assert not evaluate([two_scores, a_high_one], each_in_its_own_party).earned

    both_in_one = each_in_its_own_party + [row(9000, sing_id="s4", session_id="party-a")]
    outcome = evaluate([two_scores, a_high_one], both_in_one)
    assert outcome.earned
    assert outcome.session_id == "party-a"


def test_the_earliest_party_that_satisfies_it_is_the_one_it_was_earned_in() -> None:
    one_score = condition(scope="session", metric="number_of_scores", comparator=">=", value=1)
    rows = [
        row(9000, sing_id="s1", session_id="party-a"),
        row(9000, sing_id="s2", session_id="party-b"),
    ]
    assert evaluate([one_score], rows).session_id == "party-a"


def test_a_mixed_achievement_wants_one_party_and_the_whole_record() -> None:
    conditions = [
        condition(scope="session", metric="number_of_scores", comparator=">=", value=2),
        condition(metric="number_of_scores", comparator=">=", value=4),
    ]
    one_party_but_too_few_overall = [
        row(9000, sing_id="s1", session_id="party-a"),
        row(9000, sing_id="s2", session_id="party-a"),
    ]
    assert not evaluate(conditions, one_party_but_too_few_overall).earned

    enough_overall_but_no_single_party = [
        row(9000, sing_id="s1", session_id="party-a"),
        row(9000, sing_id="s2", session_id="party-b"),
        row(9000, sing_id="s3", session_id="party-c"),
        row(9000, sing_id="s4", session_id="party-d"),
    ]
    assert not evaluate(conditions, enough_overall_but_no_single_party).earned

    both = enough_overall_but_no_single_party[:1] + [
        row(9000, sing_id="s5", session_id="party-a"),
        row(9000, sing_id="s6", session_id="party-b"),
        row(9000, sing_id="s7", session_id="party-c"),
    ]
    outcome = evaluate(conditions, both)
    assert outcome.earned
    assert outcome.session_id == "party-a"


def test_a_global_only_achievement_names_no_party() -> None:
    outcome = evaluate([condition(metric="number_of_scores", comparator=">=", value=1)], [row(1)])
    assert outcome.earned
    assert outcome.session_id is None


def test_a_score_outside_any_party_still_counts_globally() -> None:
    rows = [row(9000, sing_id="s1", session_id=None), row(9000, sing_id="s2", session_id=None)]
    session_scoped = condition(scope="session", metric="number_of_scores", comparator=">=", value=2)
    assert not evaluate([session_scoped], rows).earned
    assert evaluate([condition(metric="number_of_scores", comparator=">=", value=2)], rows).earned


# ------------------------------------------------------------------------- the progress


def test_progress_counts_toward_the_number_that_would_satisfy_the_condition() -> None:
    rows = [row(1000, sing_id="s1"), row(2000, sing_id="s2")]
    at_least = evaluate([condition(metric="number_of_scores", comparator=">=", value=10)], rows)
    assert (at_least.progress_current, at_least.progress_target) == (2, 10)
    # `>` has to be exceeded, so "more than ten" is a target of eleven.
    more_than = evaluate([condition(metric="number_of_scores", comparator=">", value=10)], rows)
    assert (more_than.progress_current, more_than.progress_target) == (2, 11)


def test_progress_is_stored_uncapped() -> None:
    rows = [row(1000, sing_id="s1"), row(2000, sing_id="s2"), row(3000, sing_id="s3")]
    outcome = evaluate([condition(metric="number_of_scores", comparator=">=", value=2)], rows)
    assert outcome.earned
    assert (outcome.progress_current, outcome.progress_target) == (3, 2)


@pytest.mark.parametrize(("comparator", "value"), [("=", 1000), ("<", 1001), ("<=", 1000)])
def test_a_condition_with_no_direction_to_grow_in_draws_no_bar(comparator: str, value: int) -> None:
    outcome = evaluate(
        [condition(metric="any_score", comparator=comparator, value=value)], [row(1000)]
    )
    assert outcome.earned
    assert (outcome.progress_current, outcome.progress_target) == (None, None)


def test_progress_is_the_least_complete_condition() -> None:
    rows = [row(9000)]
    conditions = [
        # Half way.
        condition(metric="number_of_scores", comparator=">=", value=2),
        # Barely started, and so the honest number.
        condition(metric="sum_of_scores", comparator=">=", value=100_000),
    ]
    outcome = evaluate(conditions, rows)
    assert (outcome.progress_current, outcome.progress_target) == (9000, 100_000)


def test_progress_beside_a_condition_that_has_none() -> None:
    """A non-progressible condition is skipped, not treated as zero — otherwise every
    achievement with a `<` in it would draw an empty bar forever."""
    conditions = [
        condition(metric="any_score", comparator="<", value=100),
        condition(metric="number_of_scores", comparator=">=", value=4),
    ]
    outcome = evaluate(conditions, [row(50, sing_id="s1"), row(60, sing_id="s2")])
    assert (outcome.progress_current, outcome.progress_target) == (2, 4)


def test_session_progress_is_the_best_single_party() -> None:
    rows = [
        row(9000, sing_id="s1", session_id="party-a"),
        row(9000, sing_id="s2", session_id="party-a"),
        row(9000, sing_id="s3", session_id="party-b"),
        row(9000, sing_id="s4", session_id="party-b"),
        row(9000, sing_id="s5", session_id="party-b"),
    ]
    outcome = evaluate(
        [condition(scope="session", metric="number_of_scores", comparator=">=", value=5)], rows
    )
    assert not outcome.earned
    # Three in one party, not five over both.
    assert (outcome.progress_current, outcome.progress_target) == (3, 5)


# ------------------------------------------------------------------------ the DB pass


async def add_song(session: AsyncSession, song_id: str, *, video: bool = False) -> None:
    session.add(
        Song(
            id=song_id,
            source="usdb",
            source_id=song_id.split(":")[1],
            title="Song",
            artist="Artist",
            fingerprint="artist|song",
            directory=f"/songs/{song_id}",
            txt_file=f"/songs/{song_id}/song.txt",
            video_file=f"/songs/{song_id}/video.mp4" if video else None,
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
    """One sing with one score on it — the shape `load_rows` reads."""
    session.add(Sing(id=sing_id, song_id=song_id, session_id=session_id, started_at=at))
    recorded = Score(
        sing_id=sing_id, player_id=player_id, player_name=player_id, score=score, recorded_at=at
    )
    session.add(recorded)
    await session.commit()
    return recorded


async def add_achievement(
    session: AsyncSession,
    achievement_id: str,
    definition: list[dict[str, Any]],
    *,
    enabled: bool = True,
) -> None:
    """One hand-built achievement, on a catalogue holding nothing else.

    Migration 0023 seeds the seventeen Wingman ships, and a pass looks at every enabled one —
    so they are dropped first. What they mean is `test_achievements_triggers`' business;
    these tests are about the engine, and the assertions here name every row a pass wrote.
    """
    await session.execute(delete(Achievement).where(Achievement.built_in.is_(True)))
    session.add(
        Achievement(
            id=achievement_id,
            name=achievement_id,
            color="gold",
            enabled=enabled,
            definition=definition,
        )
    )
    await session.commit()


async def player_rows(session: AsyncSession, player_id: str) -> list[PlayerAchievement]:
    rows = await session.scalars(
        select(PlayerAchievement)
        .where(PlayerAchievement.player_id == player_id)
        .order_by(PlayerAchievement.achievement_id)
    )
    return list(rows)


TWO_SCORES = [{"metric": "number_of_scores", "comparator": ">=", "value": 2}]


async def test_load_rows_carries_the_song_beside_the_score(session: AsyncSession) -> None:
    await add_song(session, "usdb:1", video=True)
    await add_score(
        session,
        sing_id="s1",
        song_id="usdb:1",
        session_id="party-a",
        player_id=PLAYER,
        score=9000,
        at=START,
    )
    # The second sing is on a song that never existed: a score outlives its song.
    await add_score(
        session,
        sing_id="s2",
        song_id=GONE_SONG_ID,
        session_id="party-a",
        player_id=PLAYER,
        score=1000,
        at=START + timedelta(minutes=5),
    )
    await add_score(
        session,
        sing_id="s3",
        song_id="usdb:1",
        session_id="party-a",
        player_id=OTHER_PLAYER,
        score=5000,
        at=START + timedelta(minutes=10),
    )

    # A sing recorded before sessions existed: it has no party, and it is still a score.
    await add_score(
        session,
        sing_id="s4",
        song_id="usdb:1",
        session_id=None,
        player_id=PLAYER,
        score=7000,
        at=START + timedelta(minutes=15),
    )

    rows = await service.load_rows(session, PLAYER)
    assert [one.score for one in rows] == [9000, 1000, 7000]
    assert rows[2].session_id is None
    assert rows[0].title == "Song"
    assert rows[0].has_video is True
    assert rows[0].session_id == "party-a"
    # Everything about the song that is gone is None, `has_video` included: it says nothing
    # about video rather than "no video".
    assert rows[1].song_known is False
    assert rows[1].has_video is None
    assert rows[1].song_id == GONE_SONG_ID


async def test_a_pass_writes_a_row_for_every_enabled_achievement(session: AsyncSession) -> None:
    await add_achievement(session, "two-scores", TWO_SCORES)
    await add_achievement(session, "ten-scores", [{**TWO_SCORES[0], "value": 10}])
    await add_achievement(session, "switched-off", TWO_SCORES, enabled=False)
    await add_song(session, "usdb:1")
    for index in range(2):
        await add_score(
            session,
            sing_id=f"s{index}",
            song_id="usdb:1",
            session_id="party-a",
            player_id=PLAYER,
            score=9000,
            at=START + timedelta(minutes=index),
        )

    assert await service.evaluate_player(session, PLAYER, now=START) == ["two-scores"]

    rows = await player_rows(session, PLAYER)
    assert [one.achievement_id for one in rows] == ["ten-scores", "two-scores"]
    unearned, earned = rows
    assert unearned.earned_at is None
    assert (unearned.progress_current, unearned.progress_target) == (2, 10)
    assert earned.earned_at is not None
    assert as_utc(earned.earned_at) == START
    # Global-only conditions belong to no party.
    assert earned.session_id is None


async def test_a_second_pass_leaves_a_badge_that_still_holds_alone(session: AsyncSession) -> None:
    """Held without interruption is not earned again: the stamp stays and the pass reports
    nothing new, or every finished song would re-announce every badge somebody has."""
    await add_achievement(session, "two-scores", TWO_SCORES)
    await add_song(session, "usdb:1")
    for index in range(2):
        await add_score(
            session,
            sing_id=f"s{index}",
            song_id="usdb:1",
            session_id="party-a",
            player_id=PLAYER,
            score=9000,
            at=START + timedelta(minutes=index),
        )
    await service.evaluate_player(session, PLAYER, now=START)

    later = START + timedelta(days=1)
    assert await service.evaluate_player(session, PLAYER, now=later) == []
    (earned,) = await player_rows(session, PLAYER)
    assert earned.earned_at is not None
    assert as_utc(earned.earned_at) == START


async def test_losing_the_score_takes_the_badge_back(session: AsyncSession) -> None:
    await add_achievement(session, "two-scores", TWO_SCORES)
    await add_song(session, "usdb:1")
    scores = [
        await add_score(
            session,
            sing_id=f"s{index}",
            song_id="usdb:1",
            session_id="party-a",
            player_id=PLAYER,
            score=9000,
            at=START + timedelta(minutes=index),
        )
        for index in range(2)
    ]
    await service.evaluate_player(session, PLAYER, now=START)

    await session.delete(scores[1])
    await session.commit()
    assert await service.evaluate_player(session, PLAYER, now=START) == []
    (row_after,) = await player_rows(session, PLAYER)
    assert row_after.earned_at is None
    assert (row_after.progress_current, row_after.progress_target) == (1, 2)

    # The last score gone, the player holds no rows at all.
    await session.delete(scores[0])
    await session.commit()
    await service.evaluate_player(session, PLAYER, now=START)
    assert await player_rows(session, PLAYER) == []


async def test_earning_it_again_stamps_a_fresh_date_and_is_reported_anew(
    session: AsyncSession,
) -> None:
    """There is deliberately no memory of the first time: the moment an achievement was
    earned is not derivable from the scores, so a revoked date does not come back."""
    await add_achievement(session, "two-scores", TWO_SCORES)
    await add_song(session, "usdb:1")
    scores = [
        await add_score(
            session,
            sing_id=f"s{index}",
            song_id="usdb:1",
            session_id="party-a",
            player_id=PLAYER,
            score=9000,
            at=START + timedelta(minutes=index),
        )
        for index in range(2)
    ]
    await service.evaluate_player(session, PLAYER, now=START)
    await session.delete(scores[1])
    await session.commit()
    await service.evaluate_player(session, PLAYER, now=START + timedelta(hours=1))

    later = START + timedelta(days=1)
    await add_score(
        session,
        sing_id="s2",
        song_id="usdb:1",
        session_id="party-a",
        player_id=PLAYER,
        score=9000,
        at=later,
    )
    assert await service.evaluate_player(session, PLAYER, now=later) == ["two-scores"]
    (earned,) = await player_rows(session, PLAYER)
    assert earned.earned_at is not None
    assert as_utc(earned.earned_at) == later


async def test_a_disabled_achievement_drops_the_rows_it_had(session: AsyncSession) -> None:
    await add_achievement(session, "two-scores", TWO_SCORES)
    await add_song(session, "usdb:1")
    for index in range(2):
        await add_score(
            session,
            sing_id=f"s{index}",
            song_id="usdb:1",
            session_id="party-a",
            player_id=PLAYER,
            score=9000,
            at=START + timedelta(minutes=index),
        )
    await service.evaluate_player(session, PLAYER, now=START)
    assert len(await player_rows(session, PLAYER)) == 1

    achievement = await session.get(Achievement, "two-scores")
    assert achievement is not None
    achievement.enabled = False
    await session.commit()

    await service.evaluate_player(session, PLAYER, now=START)
    assert await player_rows(session, PLAYER) == []


async def test_an_unreadable_definition_earns_nobody_and_breaks_no_other_row(
    session: AsyncSession,
) -> None:
    await add_achievement(session, "broken", [{"metric": "nonsense"}])
    await add_achievement(session, "two-scores", TWO_SCORES)
    await add_song(session, "usdb:1")
    for index in range(2):
        await add_score(
            session,
            sing_id=f"s{index}",
            song_id="usdb:1",
            session_id="party-a",
            player_id=PLAYER,
            score=9000,
            at=START + timedelta(minutes=index),
        )

    assert await service.evaluate_player(session, PLAYER, now=START) == ["two-scores"]
    broken, _ = await player_rows(session, PLAYER)
    assert broken.achievement_id == "broken"
    assert broken.earned_at is None
    assert (broken.progress_current, broken.progress_target) == (None, None)


async def test_evaluate_all_covers_every_player_that_has_a_score(session: AsyncSession) -> None:
    await add_achievement(session, "one-score", [{**TWO_SCORES[0], "value": 1}])
    await add_song(session, "usdb:1")
    await add_score(
        session,
        sing_id="s1",
        song_id="usdb:1",
        session_id="party-a",
        player_id=PLAYER,
        score=9000,
        at=START,
    )
    await add_score(
        session,
        sing_id="s2",
        song_id="usdb:1",
        session_id="party-a",
        player_id=OTHER_PLAYER,
        score=1000,
        at=START + timedelta(minutes=1),
    )
    # A score USDX recorded under a name matching no slot belongs to nobody and earns nothing.
    session.add(Sing(id="s3", song_id="usdb:1", session_id="party-a", started_at=START))
    session.add(
        Score(sing_id="s3", player_id=None, player_name="walk-in", score=8000, recorded_at=START)
    )
    await session.commit()

    earned = await service.evaluate_all(session, now=START)
    assert earned == {PLAYER: ["one-score"], OTHER_PLAYER: ["one-score"]}


async def test_a_session_scoped_badge_records_the_party_it_was_earned_in(
    session: AsyncSession,
) -> None:
    await add_achievement(
        session,
        "two-tonight",
        [{"scope": "session", "metric": "number_of_scores", "comparator": ">=", "value": 2}],
    )
    await add_song(session, "usdb:1")
    for index, party in enumerate(["party-a", "party-b", "party-b"]):
        await add_score(
            session,
            sing_id=f"s{index}",
            song_id="usdb:1",
            session_id=party,
            player_id=PLAYER,
            score=9000,
            at=START + timedelta(minutes=index),
        )

    await service.evaluate_player(session, PLAYER, now=START)
    (earned,) = await player_rows(session, PLAYER)
    assert earned.earned_at is not None
    assert earned.session_id == "party-b"
