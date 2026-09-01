"""The condition language, and the read models the API answers with.

FastAPI-free like every other `schema.py`, so the engine and (later) the event bus can
speak in achievement payloads.

These models are both halves of the definition's life: what an editor sends is parsed by
them, and what the column holds is parsed back by them. That is what keeps "a year cannot
*contain* something" a 422 at creation rather than a clause that silently never matches
inside an `any` selector.
"""

import logging
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ValidationError, model_validator

from ..players.schema import PlayerRead
from .model import Achievement

logger = logging.getLogger(__name__)

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
]

Comparator = Literal[">", ">=", "=", "<=", "<"]

Combine = Literal["all", "any"]

# Spelled the way `evaluate.ScoreRow` spells its columns, which is what lets a clause read
# its field straight off a row. They are the fields `SongRead` already carries.
SelectorField = Literal[
    "title", "artist", "genre", "language", "edition", "year", "is_duet", "has_video"
]

SelectorOp = Literal["contains", "equals", "starts_with", "=", ">=", "<="]

TEXT_FIELDS: frozenset[str] = frozenset({"title", "artist", "genre", "language", "edition"})
BOOLEAN_FIELDS: frozenset[str] = frozenset({"is_duet", "has_video"})
TEXT_OPS: frozenset[str] = frozenset({"contains", "equals", "starts_with"})
YEAR_OPS: frozenset[str] = frozenset({"=", ">=", "<="})


def _is_number(value: bool | int | str) -> bool:
    """`True` is an `int` in Python and is still not a year."""
    return isinstance(value, int) and not isinstance(value, bool)


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
                raise ValueError(f"'{self.field}' takes contains/equals/starts_with and text")
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
    # An uploaded image replaces the glyph. The path stays server-side, like a player's
    # avatar: the client only has to know one exists and asks the image endpoint for it.
    has_image: bool
    color: str
    hidden: bool
    enabled: bool
    built_in: bool
    sort_order: int
    # Filled for a caller who holds `achievements.manage`, None for everybody else, exactly
    # like `TagRead.permissions`. What a hidden achievement asks for is the surprise
    # `hidden` exists to keep.
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

    `definition` is handed only to a caller holding `achievements.manage`. It says what a
    hidden achievement asks for, which is the surprise itself.
    """
    return AchievementRead(
        id=achievement.id,
        name="" if mask else achievement.name,
        description="" if mask else achievement.description,
        icon=None if mask else achievement.icon,
        # File paths stay server-side, like a player's avatar: a client only needs to know
        # whether to ask the image endpoint for one.
        has_image=not mask and achievement.icon_file is not None,
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
