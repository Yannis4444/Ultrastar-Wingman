"""The achievement engine: pure functions over the scores one player has.

Evaluation is recomputation and never an incremental counter — a counter would drift every
time the global toggle went off and on, a definition was edited, or a moderator moved a
score to another singer. Nothing in here touches the database or the clock, so every rule
`docs/dev/achievements.md` states is testable against a handful of hand-built `ScoreRow`s.
"""

import logging
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from .schema import (
    MAX_SUBJECT_LENGTH,
    PATTERN_FLAGS,
    Comparator,
    Condition,
    ScoreFilter,
    SelectorClause,
    SelectorOp,
    SongSelector,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ScoreRow:
    """One score with everything an achievement can be evaluated against. The song fields
    are None when that song has left the library."""

    score: int
    sing_id: str
    session_id: str | None
    song_id: str
    title: str | None
    artist: str | None
    genre: str | None
    language: str | None
    edition: str | None
    year: int | None
    is_duet: bool | None
    has_video: bool | None

    @property
    def song_known(self) -> bool:
        """Whether the song is still in the library. `title` is the witness: `songs.title`
        is NOT NULL, so it is None here only because the outer join found no row."""
        return self.title is not None


@dataclass(frozen=True)
class Outcome:
    earned: bool
    # Which party earned it, for an achievement with session-scoped conditions.
    session_id: str | None
    progress_current: int | None
    progress_target: int | None


NOT_EARNED = Outcome(earned=False, session_id=None, progress_current=None, progress_target=None)


def evaluate(conditions: Sequence[Condition], rows: Sequence[ScoreRow]) -> Outcome:
    """Whether these conditions hold over these scores, and how far along they are.

    All of them must hold. The session-scoped ones must hold within one and the same party —
    a `GROUP BY session HAVING …`, not one party per condition — while the global ones are
    checked over everything, so an achievement mixing both means "this much tonight, by
    somebody who has also done that much overall".
    """
    if not conditions:
        # An achievement that asks for nothing is not something anybody can earn. Vacuous
        # truth would hand it to every player who ever sang, which is the one way a
        # half-written definition could do real damage.
        return NOT_EARNED

    session_conditions = [condition for condition in conditions if condition.scope == "session"]
    sessions = _by_session(rows)

    earned_in: str | None = None
    for session_id, session_rows in sessions.items():
        if all(_holds(condition, session_rows) for condition in session_conditions):
            # The first party in row order, which is the earliest one: the party it was
            # earned in, not merely one of the parties that would do.
            earned_in = session_id
            break

    globally = all(
        _holds(condition, rows) for condition in conditions if condition.scope == "global"
    )
    earned = globally and (not session_conditions or earned_in is not None)
    current, target = _progress(conditions, rows, sessions)
    return Outcome(
        earned=earned,
        session_id=earned_in if earned and session_conditions else None,
        progress_current=current,
        progress_target=target,
    )


def _by_session(rows: Sequence[ScoreRow]) -> dict[str, list[ScoreRow]]:
    """The rows of each party, parties in the order they first appear.

    A row with no session — a sing recorded before sessions existed — belongs to no party
    and so can never help satisfy a session-scoped condition. It still counts for the global
    ones: it was a score somebody got.
    """
    sessions: dict[str, list[ScoreRow]] = {}
    for row in rows:
        if row.session_id is not None:
            sessions.setdefault(row.session_id, []).append(row)
    return sessions


def _holds(condition: Condition, rows: Sequence[ScoreRow]) -> bool:
    if condition.metric == "any_score" and condition.comparator == "=":
        # *Any* is the word in all three of `any_score`'s readings, and this is the third:
        # `>`/`>=` ask about the best score and `<`/`<=` about the worst, but "a score of
        # exactly 9000" is neither end — no single number summarises the set for it, so it is
        # an existence test over the scores the filters left rather than a comparison.
        return any(row.score == condition.value for row in rows if _kept(condition, row))
    measured = _measure(condition, rows)
    return measured is not None and _compare(measured, condition.comparator, condition.value)


def _measure(condition: Condition, rows: Sequence[ScoreRow]) -> int | None:
    """What the condition's metric says about these rows, or `None` when the metric has no
    answer over them — which never satisfies anything."""
    kept = [row for row in rows if _kept(condition, row)]
    match condition.metric:
        case "any_score":
            if not kept:
                return None
            scores = [row.score for row in kept]
            # Which end is meant is what the comparator already says, so there is no separate
            # highest/lowest metric: the best one for `>`/`>=`, the worst for `<`/`<=`. `=`
            # never arrives here — `_holds` answers it as an existence test, which no single
            # summary number could.
            return max(scores) if _upward(condition.comparator) else min(scores)
        case "sum_of_scores":
            return sum(row.score for row in kept)
        case "average_score":
            if not kept:
                # An average of nothing is not a number, so zero scores never satisfy it.
                return None
            return sum(row.score for row in kept) // len(kept)
        case "number_of_scores":
            return len(kept)
        case "number_of_sings":
            # A duet scored twice is one sing.
            return len({row.sing_id for row in kept})
        case "different_songs":
            return len({row.song_id for row in kept})
        case "different_artists":
            # Case-insensitively, and a song that has left the library carries no artist and
            # counts for nothing.
            return len({row.artist.casefold() for row in kept if row.artist is not None})


def _upward(comparator: Comparator) -> bool:
    return comparator in (">", ">=")


def _kept(condition: Condition, row: ScoreRow) -> bool:
    """Whether the row survives the condition's filters — all of them run before the metric
    is computed."""
    if condition.score_filter is not None and not _in_range(condition.score_filter, row.score):
        return False
    if condition.songs is not None:
        # A song-filtered condition cannot match a score whose song left the library: the
        # metadata row it would have been matched against is gone. An unfiltered condition
        # still counts it.
        return row.song_known and row.song_id in condition.songs.ids
    if condition.match is not None:
        return row.song_known and _matches(condition.match, row)
    return True


def _in_range(score_filter: ScoreFilter, score: int) -> bool:
    if score_filter.min is not None and score < score_filter.min:
        return False
    return score_filter.max is None or score <= score_filter.max


def _matches(selector: SongSelector, row: ScoreRow) -> bool:
    if not selector.clauses:
        # No clauses is no restriction, whichever way they would have been combined. Spelled
        # out because `any(())` is False and would empty the condition instead.
        return True
    results = (_clause_matches(clause, row) for clause in selector.clauses)
    return all(results) if selector.combine == "all" else any(results)


def _clause_matches(clause: SelectorClause, row: ScoreRow) -> bool:
    """One clause against one row.

    A clause whose field is missing on the song never matches — a song with no genre is not
    "genre equals anything". The `isinstance` checks only narrow the value's union for the
    type checker: `SelectorClause` already refused every pairing they could reject.
    """
    if clause.field in ("is_duet", "has_video"):
        flag = row.is_duet if clause.field == "is_duet" else row.has_video
        return flag is not None and flag is clause.value
    if clause.field == "year":
        if row.year is None or not isinstance(clause.value, int):
            return False
        return _compare(row.year, clause.op, clause.value)
    text: str | None = getattr(row, clause.field)
    if text is None or not isinstance(clause.value, str):
        return False
    return _matches_text(text, clause.op, clause.value)


def _matches_text(actual: str, op: SelectorOp, wanted: str) -> bool:
    """All four text operators are case-insensitive."""
    if op == "regex":
        # Before the fold, and this is not a nicety: `"\\D".casefold()` is `"\\d"`, so a
        # folded pattern would quietly mean the opposite of what it says. A regular
        # expression carries its own case-insensitivity in `PATTERN_FLAGS` instead.
        return _matches_pattern(actual, wanted)
    folded, sought = actual.casefold(), wanted.casefold()
    match op:
        case "contains":
            return sought in folded
        case "starts_with":
            return folded.startswith(sought)
        case _:
            # `equals`; the clause model allows no other operator on a text field.
            return folded == sought


def _matches_pattern(actual: str, pattern: str) -> bool:
    """The `regex` operator: a search, so it matches *anywhere* in the field the way
    `contains` does — `^` and `$` are how an author asks for the whole of it.

    `re.search` and not a compiled object kept somewhere: `re` caches compiled patterns
    itself, and a cache of our own would be one more thing to invalidate when a definition
    is edited.

    Only the first `MAX_SUBJECT_LENGTH` characters of the field are searched. No real title
    or edition comes near that, and it is what makes `schema.MAX_PATTERN_COMBINATIONS` a
    real bound: what an open-ended repetition costs is the length of what it is repeated
    over, so the pattern's budget only means anything if the field has a length too.

    A pattern that cannot compile never matches, and never raises. `SelectorClause` refuses
    one at every door a definition comes in by, so this can only be a row edited straight
    into the database — and one such row must no more break the pass for every other
    achievement than an unreadable definition does (`schema.parse_definition`).
    """
    try:
        return re.search(pattern, actual[:MAX_SUBJECT_LENGTH], PATTERN_FLAGS) is not None
    # The same three as `schema.check_pattern`, and for the same reason: an evaluation pass
    # answers "no" for a rule it cannot read, and never raises out of itself.
    except (re.error, OverflowError, RecursionError) as error:
        logger.warning("a song rule holds a pattern that cannot be compiled: %s", error)
        return False


def _compare(left: int, comparator: Comparator | SelectorOp, right: int) -> bool:
    match comparator:
        case ">":
            return left > right
        case ">=":
            return left >= right
        case "=":
            return left == right
        case "<=":
            return left <= right
        case "<":
            return left < right
        case _:
            # `contains`, `starts_with` and `regex` never arrive here — the clause model
            # allows them on the text fields only, and those go through `_matches_text`.
            return False


def _progress(
    conditions: Sequence[Condition],
    rows: Sequence[ScoreRow],
    sessions: Mapping[str, list[ScoreRow]],
) -> tuple[int | None, int | None]:
    """How far along the achievement is: its least complete condition.

    All of them have to hold, so the weakest is the honest number. Only a condition compared
    with `>` or `>=` has one at all — there is no progressing toward *fewer*, and a bar that
    filled as somebody got worse would be a lie — and an achievement with no progressible
    condition stores `(None, None)` and draws no bar.
    """
    weakest: tuple[float, int, int] | None = None
    for condition in conditions:
        target = _target(condition)
        if target is None:
            continue
        if condition.scope == "session":
            # The best any single session reached, the current party included. Per condition:
            # earning still takes one party that satisfies every session-scoped condition,
            # but a bar is drawn for a condition and not for a party.
            current = max(
                (_measure(condition, session_rows) or 0 for session_rows in sessions.values()),
                default=0,
            )
        else:
            current = _measure(condition, rows) or 0
        fraction = min(current, target) / target
        # Strictly less, so a tie keeps the earlier condition and a re-run of an unchanged
        # record never rewrites the row.
        if weakest is None or fraction < weakest[0]:
            weakest = (fraction, current, target)
    if weakest is None:
        return None, None
    # Stored uncapped: `min(current, target) / target` is the bar, and the raw number is what
    # "9 of 10" wants to say.
    return weakest[1], weakest[2]


def _target(condition: Condition) -> int | None:
    """The number a progressible condition is working toward, or `None` when it has none.

    A target of zero or less is not progressible either: the condition is already satisfied
    by everybody, and there is no fraction to draw.
    """
    if condition.comparator == ">=":
        target = condition.value
    elif condition.comparator == ">":
        # `>` has to be *exceeded*, so the first number that satisfies it is one past `value`.
        target = condition.value + 1
    else:
        return None
    return target if target > 0 else None
