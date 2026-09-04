"""The condition language, and the read models the API answers with.

FastAPI-free like every other `schema.py`, so the engine and (later) the event bus can
speak in achievement payloads.

These models are both halves of the definition's life: what an editor sends is parsed by
them, and what the column holds is parsed back by them. That is what keeps "a year cannot
*contain* something" a 422 at creation rather than a clause that silently never matches
inside an `any` selector.
"""

import logging
import re

# `re`'s own parser, so that counting what a pattern asks for (`_combinations`) reads the
# engine's syntax the way the engine does. Private, and the only alternative was a second
# parser of our own — see `_combinations`.
import re._parser as re_parser  # type: ignore[import-not-found]
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, StringConstraints, ValidationError, model_validator

from ..images import image_version
from ..players.schema import PlayerRead
from .model import Achievement
from .pictures import picture_of

logger = logging.getLogger(__name__)

# The three presentation fields that are text, with the shape every way in has to agree on.
# They live here rather than in `api.py` because an archive is a second way in
# (`archive.AchievementFile`) and it is FastAPI-free: two copies of the constraints would
# drift, and an import that accepted a ten-kilobyte name the API refuses is a hole.
AchievementName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)
]
AchievementDescription = Annotated[str, StringConstraints(strip_whitespace=True, max_length=512)]
# The name of an entry in the frontend's `ICON_PATHS`, exactly like `tags.icon`. Only the
# shape is checked: the backend ships no icon list, and one the UI does not know draws nothing.
AchievementIcon = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9-]{0,31}$")]

# `global` — every score the player ever got. `session` — the condition has to hold inside
# *one* party, and it is the same party for every session-scoped condition of the
# achievement.
Scope = Literal["global", "session"]

Metric = Literal[
    "any_score",
    "sum_of_scores",
    "average_score",
    "number_of_scores",
    "number_of_sings",
    "different_songs",
    "different_artists",
    # How often the singer came first. A win is `placement == 1` in a sing whose
    # `field_size` is at least 2 — a song nobody else sang is not one won, and a shared
    # first place is (both singers came first; neither came second). Both fields were
    # written when the sing was scored and are never corrected afterwards
    # (`karaoke.model.Score`), which is what makes the count survive a deleted score.
    "number_of_wins",
]

Comparator = Literal[">", ">=", "=", "<=", "<"]

Combine = Literal["all", "any"]

# Spelled the way `evaluate.ScoreRow` spells its columns, which is what lets a clause read
# its field straight off a row. They are the fields `SongRead` already carries.
SelectorField = Literal[
    "title", "artist", "genre", "language", "edition", "year", "is_duet", "has_video"
]

SelectorOp = Literal["contains", "equals", "starts_with", "regex", "=", ">=", "<="]

TEXT_FIELDS: frozenset[str] = frozenset({"title", "artist", "genre", "language", "edition"})
BOOLEAN_FIELDS: frozenset[str] = frozenset({"is_duet", "has_video"})
TEXT_OPS: frozenset[str] = frozenset({"contains", "equals", "starts_with", "regex"})
YEAR_OPS: frozenset[str] = frozenset({"=", ">=", "<="})

# The flags `regex` is compiled with, here rather than in the engine because the validator
# below compiles with them too: a pattern accepted at the door and rejected at evaluation
# time (or the other way round) would be the one bug this operator can hide. Case-insensitive
# like the other three text operators — `contains` and `equals` casefold both sides, and a
# fourth test that alone cared about capitals would be a trap nobody can see. An author who
# does care spells it out: `(?-i:Love)` is what insists on them (a bare `(?-i)` is not a
# pattern Python accepts, which is why the editor's line names the scoped form).
PATTERN_FLAGS = re.IGNORECASE

# How long a pattern may be. `archive.py`'s caps and this module's constrained strings are
# the same stance: a bound nobody real ever meets, so nothing that arrives is unbounded.
# Length alone says nothing about what a pattern costs — `(a+)+b` is eleven characters — so
# `check_pattern` counts what it asks for as well; `MAX_PATTERN_COMBINATIONS` is that bound.
MAX_PATTERN_LENGTH = 200

# How much of a field a pattern is matched against. Every real title, artist, genre, language
# and edition is far shorter, and the bound is what turns `MAX_PATTERN_COMBINATIONS` from an
# estimate into a promise: the number of ways an open-ended repetition can divide a field is
# the length of that field, so a field of unknown length is a cost of unknown size.
MAX_SUBJECT_LENGTH = 200

# How many ways a pattern may ask to be tried before it is refused, counted by
# `_combinations` below. This is the defence against catastrophic backtracking, and the only
# one available: Python's `re` cannot be interrupted — there is no timeout, and a thread
# running a match holds the GIL, so the rest of the process does not even tick while it runs
# (measured). What can be done is refuse, at the door, a pattern whose *shape* says it may
# explode, and that is what this is: `(a+)+b`, `(a|a)+b`, `a?` thirty times and `.*` twelve
# times are all far past it, while everything a song rule really wants — a few literals, an
# alternation, one or two `.*` — is orders of magnitude below.
#
# A million combinations times the places `re.search` may start (`MAX_SUBJECT_LENGTH`) is
# the worst a pattern that gets past here can cost: large, and finite, which is the whole
# difference. `docs/dev/achievements.md` carries the argument in full.
MAX_PATTERN_COMBINATIONS = 1_000_000

# The saturating "past the budget" value: multiplying anything by it stays past the budget,
# so no product ever has to be computed in full.
_TOO_MANY = MAX_PATTERN_COMBINATIONS + 1


def _is_number(value: bool | int | str) -> bool:
    """`True` is an `int` in Python and is still not a year."""
    return isinstance(value, int) and not isinstance(value, bool)


def _times(left: int, right: int) -> int:
    """Multiply, saturating at `_TOO_MANY` rather than growing a number nobody needs."""
    product = left * right
    return _TOO_MANY if product > MAX_PATTERN_COMBINATIONS else product


def _repeated(low: int, high: int, item: re_parser.SubPattern) -> int:
    """What a repetition asks for: how many lengths it may consume, times what the thing it
    repeats asks for, once per repetition. A repetition of something with a choice in it is
    where the explosion lives — `(a+)+` is `200` choices taken `200` times — and the
    saturating multiply is what lets that be counted without computing it."""
    inner = _combinations(item)
    # An open-ended repetition is `MAXREPEAT`, an int far past any field; either way it can
    # only repeat as often as the field has characters.
    repeats = min(high, MAX_SUBJECT_LENGTH)
    lengths = max(1, repeats - min(low, repeats) + 1)
    if inner == 1:
        # The ordinary case — `.*`, `a{2,5}`, `[a-z]+` — where the only choice is how much
        # of the field to take.
        return lengths
    total = lengths
    for _ in range(repeats):
        total = _times(total, inner)
        if total >= _TOO_MANY:
            return _TOO_MANY
    return total


def _combinations(parsed: re_parser.SubPattern) -> int:
    """An upper bound on the number of ways this pattern can try to match one field.

    Walked over `re`'s own parse tree and not over the pattern's characters: an operator
    counted wrong because a `*` inside `[…]` was read as a repetition would be a hole, and
    the engine's parser is the only thing that cannot misread the engine's own syntax. It is
    a private module (`re._parser`, `sre_parse` before 3.11) — the alternative was a second
    parser of our own, which would be wrong in exactly the cases this is here to catch. The
    unit tests fail loudly if a future Python moves it.

    Anything unrecognised counts as past the budget rather than as free: a construct nobody
    has thought about is refused, not waved through.
    """
    total = 1
    for opcode, argument in parsed:
        name = str(opcode)
        if name in {"LITERAL", "NOT_LITERAL", "IN", "ANY", "AT"}:
            # One character or one position, no choice to make.
            continue
        elif name == "SUBPATTERN":
            # `(…)`, `(?:…)`, `(?-i:…)` — the group's own contents at index 3.
            total = _times(total, _combinations(argument[3]))
        elif name == "ATOMIC_GROUP":
            # `(?>…)` cannot be backtracked into at all, so this over-counts. Deliberately:
            # the budget may be pessimistic, never optimistic.
            total = _times(total, _combinations(argument))
        elif name in {"ASSERT", "ASSERT_NOT"}:
            # A look-around is tried like anything else, so it costs like anything else —
            # and it is not refused, "everything except a live recording" being a song rule
            # `(?!…)` is the only way to write.
            total = _times(total, _combinations(argument[1]))
        elif name == "BRANCH":
            # `a|b`: the branches are alternatives, so they add rather than multiply.
            branches = 0
            for branch in argument[1]:
                branches += _combinations(branch)
                if branches >= _TOO_MANY:
                    break
            total = _times(total, min(branches, _TOO_MANY))
        elif name in {"MAX_REPEAT", "MIN_REPEAT", "POSSESSIVE_REPEAT"}:
            total = _times(total, _repeated(argument[0], argument[1], argument[2]))
        else:
            # `GROUPREF` and `GROUPREF_EXISTS` today, whatever a later Python adds tomorrow.
            return _TOO_MANY
        if total >= _TOO_MANY:
            return _TOO_MANY
    return total


def check_pattern(pattern: str) -> None:
    """Raise `ValueError` unless this is a regular expression Wingman will run.

    Every way a definition gets in goes through `SelectorClause`, so this one check covers
    all of them: the API answers 422 with the sentence, an archive names the achievement the
    bad pattern is in, and a row somebody edited straight into the database is unreadable to
    `parse_definition` and therefore "never satisfied" rather than an exception in the middle
    of an evaluation pass. Python's dialect is the authority — the editor cannot be, being
    written in another language (`achievements.ts`).

    Three refusals: empty, longer than `MAX_PATTERN_LENGTH`, and not a pattern `re` will
    compile. Then a fourth that is not about the pattern's *meaning* at all — a pattern that
    asks for more combinations than `MAX_PATTERN_COMBINATIONS`, which is the only thing
    standing between an evaluation pass and a match that never finishes.
    """
    if not pattern:
        # `re.search("", …)` matches every string, so an empty pattern is not a rule at all;
        # a half-typed clause would silently mean "every song" until somebody finished it.
        raise ValueError("a regular expression cannot be empty")
    if len(pattern) > MAX_PATTERN_LENGTH:
        raise ValueError(
            f"a regular expression cannot be longer than {MAX_PATTERN_LENGTH} characters"
        )
    try:
        re.compile(pattern, PATTERN_FLAGS)
    # `re.error` is the ordinary refusal, but not the only one: `(a){4294967296}` raises
    # `OverflowError` and a deeply nested pattern can raise `RecursionError`, and either of
    # those escaping would be a 500 at the API and — far worse — an exception thrown out of
    # `parse_definition`, whose whole contract is that a row it cannot read is never
    # satisfied rather than the end of the pass.
    except (re.error, OverflowError, RecursionError) as error:
        # The message is Python's own ("missing ), unterminated subpattern at position 0"),
        # which is the only thing that tells somebody holding a text editor *where* to look.
        raise ValueError(f"'{pattern}' is not a valid regular expression: {error}") from error
    try:
        combinations = _combinations(re_parser.parse(pattern, PATTERN_FLAGS))
    except (re.error, OverflowError, RecursionError) as error:  # pragma: no cover
        # `re.compile` parses the same way, so getting here means the two disagreed. Refuse
        # rather than guess, for the same reason as above.
        raise ValueError(f"'{pattern}' is not a valid regular expression: {error}") from error
    if combinations > MAX_PATTERN_COMBINATIONS:
        raise ValueError(
            f"'{pattern}' asks Wingman to try too many combinations to be safe: use at most "
            "two open-ended repetitions (* + {n,}) and never one wrapped around another. A "
            "pattern already matches anywhere in the field, so a leading or trailing '.*' "
            "does nothing"
        )


class ScoreFilter(BaseModel):
    """Which scores the metric is computed over. Both ends inclusive, both optional.

    "Ten scores above 9000" is `number_of_scores >= 10` with `min = 9000` — the filter runs
    *before* the metric, which is what makes counting a filtered set expressible at all.
    """

    min: int | None = None
    max: int | None = None

    @model_validator(mode="after")
    def _the_range_has_to_hold_something(self) -> "ScoreFilter":
        if self.min is not None and self.max is not None and self.min > self.max:
            # No score survives it, so the condition can never be satisfied by anybody. A
            # transposed pair is the one mistake this shape invites, and a badge nobody can
            # ever earn is indistinguishable from a badge nobody has earned *yet*.
            raise ValueError("a score filter's 'min' cannot be above its 'max'")
        return self


class SongIds(BaseModel):
    """An explicit list of song ids the scores must be on."""

    ids: list[str]


class SelectorClause(BaseModel):
    """One test against one song field.

    Which operators and which kind of value a field takes is checked here rather than at
    evaluation time: an impossible clause inside an `any` selector would otherwise just
    never match, and the person who wrote it would never learn why.
    """

    field: SelectorField
    op: SelectorOp
    # `bool` before `int`: `True` is an `int` in Python, and a union that tried `int` first
    # would read the two boolean fields' values back as 1 and 0.
    value: bool | int | str

    @model_validator(mode="after")
    def _operator_fits_the_field(self) -> "SelectorClause":
        if self.field in TEXT_FIELDS:
            if self.op not in TEXT_OPS or not isinstance(self.value, str):
                raise ValueError(f"'{self.field}' takes contains/equals/starts_with/regex and text")
            if self.op == "regex":
                # Compiled here and never at evaluation time: a pattern that cannot compile
                # is a mistake its author must be told about while they are still looking at
                # the box, not a clause that quietly matches nothing months later.
                check_pattern(self.value)
        elif self.field in BOOLEAN_FIELDS:
            # `isinstance(..., bool)` and not `value in (True, False)`: `1 == True`.
            if self.op != "equals" or not isinstance(self.value, bool):
                raise ValueError(f"'{self.field}' takes equals and true or false")
        elif self.op not in YEAR_OPS or not _is_number(self.value):
            raise ValueError("'year' takes =/>=/<= and a number")
        return self


class SongSelector(BaseModel):
    """A test over song metadata instead of a list of ids. One flat list, no nesting —
    `combine` says whether every clause has to match or only one of them."""

    combine: Combine = "all"
    clauses: list[SelectorClause] = []


class Condition(BaseModel):
    """One thing that has to be true. An achievement is a list of them, all of which hold.

    `value` is a whole number: scores are, counts are, and an average is floored before it
    is compared, so a fractional target could only ever mean the number next to it.
    """

    # Defaulted rather than required: a hand-edited export that leaves it out means the
    # ordinary thing, which is "over everything".
    scope: Scope = "global"
    metric: Metric
    comparator: Comparator
    value: int
    score_filter: ScoreFilter | None = None
    songs: SongIds | None = None
    match: SongSelector | None = None

    @model_validator(mode="after")
    def _one_way_of_choosing_songs(self) -> "Condition":
        if self.songs is not None and self.match is not None:
            raise ValueError("a condition chooses songs by 'songs' or by 'match', never both")
        return self


class AchievementRead(BaseModel):
    """The catalogue entry. Everybody may read it — the host screen and every guest phone
    draw badges — which is why `definition` is not part of what everybody gets."""

    id: str
    name: str
    description: str
    icon: str | None
    # A picture replaces the glyph: an uploaded one, or for a built-in the one Wingman ships
    # (`pictures.py`). The path stays server-side, like a player's avatar: the client only
    # has to know one exists and asks the image endpoint for it.
    has_image: bool
    # Whether that picture is the shipped one rather than an upload. It is what lets the
    # editor say "back to the included picture" instead of offering a glyph a built-in
    # cannot be drawn with. False whenever `has_image` is.
    image_shipped: bool = False
    # The cache buster for that endpoint, exactly like `PlayerRead.avatar_version`: replacing
    # a picture changes neither the URL nor `has_image`, so this is the only thing that says
    # the picture is a different one. `None` on a masked row, with `has_image` — a version
    # that moved would say a hidden achievement has a picture, and having one is part of the
    # surprise.
    icon_version: int | None = None
    color: str
    hidden: bool
    enabled: bool
    built_in: bool
    sort_order: int
    # Filled for the management page — `GET /achievements?manage=true`, which takes
    # `achievements.manage` — and None for every other answer, exactly like
    # `TagRead.permissions`. What a hidden achievement asks for is the surprise `hidden`
    # exists to keep, so it is not handed to the user page of somebody who could edit it.
    definition: list[Condition] | None = None


class PlayerAchievementRead(BaseModel):
    """Where one player stands on one achievement. Not a badge on its own: a row with no
    `earned_at` carries progress only."""

    achievement_id: str
    player_id: str
    earned_at: datetime | None
    # The party it was earned in, for a session-scoped achievement.
    session_id: str | None
    progress_current: int | None
    progress_target: int | None
    # The achievement itself, so a page that draws somebody's badges needs one request. The
    # same masking as the catalogue applies to it, decided over the *subject* player: this is
    # that player's record, not the reader's.
    achievement: AchievementRead


class AchievementSettings(BaseModel):
    """The three knobs, handed to every reader of the catalogue: whether badges exist at all,
    and how long the host screen holds a row of them."""

    enabled: bool
    host_seconds_base: int
    host_seconds_per_badge: int


class AchievementList(BaseModel):
    """`GET /achievements`. The settings ride along because every surface that draws a badge
    needs both, and one request is one request."""

    achievements: list[AchievementRead]
    settings: AchievementSettings


class PlayerAchievementList(BaseModel):
    achievements: list[PlayerAchievementRead]


class AchievementImportResult(BaseModel):
    """What an imported archive did. Both lists in the archive's own order.

    Two lists rather than a count, so the page that ran the import can say something true —
    "three added, fourteen updated" — instead of "done". Import matches by id, so every
    achievement in the archive is in exactly one of them.
    """

    created: list[str]
    updated: list[str]


class EarnedByPlayer(BaseModel):
    """One singer and what they just earned — the unit the `achievements.earned` event is a
    list of. `PlayerRead` and not an id: the host screen draws the picture and the name
    beside the badge, and the bus is what it draws from."""

    player: PlayerRead
    achievements: list[AchievementRead]


def read_achievement(
    achievement: Achievement, *, definition: bool = False, mask: bool = False
) -> AchievementRead:
    """One catalogue entry.

    `mask` blanks what a hidden achievement keeps back — its name, its sentence and its
    glyph — and it is the API that decides when, never the client: a reader that ignored the
    flag would otherwise spoil every surprise in the list. What is left is the shape of a
    badge (the colour, the sort order, that it exists at all), which is what lets the UI draw
    a locked slot without knowing what is behind it.

    `definition` is handed only to the management page — `GET /achievements?manage=true`,
    behind `achievements.manage`. It says what a hidden achievement asks for, which is the
    surprise itself, so a manager reading a singer-facing listing does not get it either.
    """
    # The upload, or the shipped picture of a built-in (`pictures.py`). File paths stay
    # server-side, like a player's avatar: a client only needs to know whether to ask the
    # image endpoint for one, and which of the two it would get.
    picture = None if mask else picture_of(achievement)
    return AchievementRead(
        id=achievement.id,
        name="" if mask else achievement.name,
        description="" if mask else achievement.description,
        icon=None if mask else achievement.icon,
        has_image=picture is not None,
        image_shipped=picture is not None and picture.shipped,
        icon_version=None if picture is None else image_version(str(picture.path)),
        color=achievement.color,
        hidden=achievement.hidden,
        enabled=achievement.enabled,
        built_in=achievement.built_in,
        sort_order=achievement.sort_order,
        # Never on a masked row, and never on the event bus either — that one is anonymous.
        definition=parse_definition(achievement.id, achievement.definition) if definition else None,
    )


def parse_definition(achievement_id: str, definition: object) -> list[Condition] | None:
    """The stored JSON as conditions, or `None` when it cannot be read.

    `None` means "never satisfied" and not "no conditions": one row somebody hand-edited (or
    imported) into a shape these models refuse must not break the pass for every other
    achievement, and quietly handing it to everybody would be far worse than never handing
    it out at all.
    """
    if not isinstance(definition, list):
        logger.warning("achievement %s: definition is not a list of conditions", achievement_id)
        return None
    try:
        return [Condition.model_validate(condition) for condition in definition]
    except ValidationError as error:
        logger.warning("achievement %s has an unreadable definition: %s", achievement_id, error)
        return None
