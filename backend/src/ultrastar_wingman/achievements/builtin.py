"""The seventeen achievements Wingman ships.

Data, not rows: the list below is what migration 0023 seeds and what `service.reset_built_in`
reads back, so there is one place that says what *First Time on the Mic* means. Once seeded
they are ordinary rows, and `built_in = True` buys exactly three things: a `DELETE` on one is
a 409; its **conditions** are this file's, which no `PATCH` and no import may move; and only
a built-in has a `POST /achievements/{id}/reset`, which puts everything here back. What a
built-in looks like and whether it is on at all stay as editable as anybody else's, because a
party is not obliged to want *Brave Soul*.

That makes this file the only place a shipped definition is ever improved — and, because the
seed migration runs once, a reset is the only way an improvement here reaches a database that
already holds the old one.

The ids are stable slugs (`builtin-score-9000`) rather than uuids: import matches by id, so a
slug is what lets an instance recognise a built-in that came from somewhere else, and what
makes export → hand-edit → import a round trip.

The definitions are written here as plain JSON — the same shape the `definition` column
holds and the same shape an export carries. They are parsed through `schema.Condition` like
every other definition (a test pins that), so a typo in this file is a failing test rather
than a badge nobody can earn.
"""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class BuiltInAchievement:
    """One shipped achievement. `sort_order` is its index in `BUILT_INS`, so the order this
    file lists them in is the order they are drawn in."""

    id: str
    name: str
    description: str
    icon: str
    color: str
    hidden: bool
    definition: list[dict[str, Any]]


def _global(metric: str, comparator: str, value: int, **extra: Any) -> list[dict[str, Any]]:
    return [
        {"scope": "global", "metric": metric, "comparator": comparator, "value": value, **extra}
    ]


def _session(metric: str, value: int, **extra: Any) -> list[dict[str, Any]]:
    return [{"scope": "session", "metric": metric, "comparator": ">=", "value": value, **extra}]


# A ladder of scores, a ladder of counts, and the same two again inside one party — plus the
# three that are about *what* was sung rather than how much (a duet, ten artists) and the one
# hidden consolation prize. The colours climb with the achievement: neutral, blue, gold.
BUILT_INS: tuple[BuiltInAchievement, ...] = (
    BuiltInAchievement(
        id="builtin-first-song",
        name="First Time on the Mic",
        description="Sing your first song.",
        icon="smile",
        color="neutral",
        hidden=False,
        definition=_global("number_of_sings", ">=", 1),
    ),
    BuiltInAchievement(
        id="builtin-score-6000",
        name="Warmed Up",
        description="Score 6,000 or more in a song.",
        icon="thumbs-up",
        color="neutral",
        hidden=False,
        definition=_global("any_score", ">=", 6000),
    ),
    BuiltInAchievement(
        id="builtin-score-8000",
        name="In Tune",
        description="Score 8,000 or more in a song.",
        icon="bolt",
        color="blue",
        hidden=False,
        definition=_global("any_score", ">=", 8000),
    ),
    BuiltInAchievement(
        id="builtin-score-9000",
        name="Golden Voice",
        description="Score 9,000 or more in a song.",
        icon="trophy",
        color="gold",
        hidden=False,
        definition=_global("any_score", ">=", 9000),
    ),
    BuiltInAchievement(
        id="builtin-score-9500",
        name="Untouchable",
        description="Score 9,500 or more in a song.",
        icon="crown",
        color="gold",
        hidden=False,
        definition=_global("any_score", ">=", 9500),
    ),
    BuiltInAchievement(
        id="builtin-evening-50k",
        name="A Good Evening",
        description="Collect 50,000 points in one party.",
        icon="beer",
        color="neutral",
        hidden=False,
        definition=_session("sum_of_scores", 50000),
    ),
    BuiltInAchievement(
        id="builtin-evening-100k",
        name="Big Night",
        description="Collect 100,000 points in one party.",
        icon="flame",
        color="blue",
        hidden=False,
        definition=_session("sum_of_scores", 100000),
    ),
    BuiltInAchievement(
        id="builtin-evening-250k",
        name="Marathon",
        description="Collect 250,000 points in one party.",
        icon="rocket",
        color="gold",
        hidden=False,
        definition=_session("sum_of_scores", 250000),
    ),
    BuiltInAchievement(
        id="builtin-songs-10",
        name="Regular",
        description="Sing 10 songs.",
        icon="music",
        color="neutral",
        hidden=False,
        definition=_global("number_of_sings", ">=", 10),
    ),
    BuiltInAchievement(
        id="builtin-songs-50",
        name="Resident",
        description="Sing 50 songs.",
        icon="guitar",
        color="blue",
        hidden=False,
        definition=_global("number_of_sings", ">=", 50),
    ),
    BuiltInAchievement(
        id="builtin-songs-100",
        name="Living Legend",
        description="Sing 100 songs.",
        icon="graduation-cap",
        color="gold",
        hidden=False,
        definition=_global("number_of_sings", ">=", 100),
    ),
    BuiltInAchievement(
        id="builtin-evening-songs-5",
        name="Five in a Night",
        description="Sing 5 songs in one party.",
        icon="hourglass",
        color="neutral",
        hidden=False,
        definition=_session("number_of_sings", 5),
    ),
    BuiltInAchievement(
        id="builtin-evening-songs-10",
        name="Iron Lungs",
        description="Sing 10 songs in one party.",
        icon="dumbbell",
        color="blue",
        hidden=False,
        definition=_session("number_of_sings", 10),
    ),
    BuiltInAchievement(
        id="builtin-evening-hat-trick",
        name="Hat-trick",
        description="Score 9,000 or more three times in one party.",
        icon="drum",
        color="gold",
        hidden=False,
        # The filter runs before the metric, so this counts the scores that were already
        # above 9000 rather than all of them.
        definition=_session("number_of_scores", 3, score_filter={"min": 9000}),
    ),
    BuiltInAchievement(
        id="builtin-first-duet",
        name="Better Together",
        description="Sing a duet.",
        icon="users",
        color="neutral",
        hidden=False,
        definition=_global(
            "number_of_sings",
            ">=",
            1,
            match={
                "combine": "all",
                "clauses": [{"field": "is_duet", "op": "equals", "value": True}],
            },
        ),
    ),
    BuiltInAchievement(
        id="builtin-artists-10",
        name="Well Travelled",
        description="Sing songs by 10 different artists.",
        icon="plane",
        color="blue",
        hidden=False,
        definition=_global("different_artists", ">=", 10),
    ),
    BuiltInAchievement(
        id="builtin-brave-soul",
        name="Brave Soul",
        description="Finish a song with 2,000 points or fewer.",
        icon="ghost",
        color="neutral",
        # The one hidden one: it is a joke at the singer's expense, and a joke that announced
        # itself in the catalogue beforehand would read as an instruction to sing badly.
        #
        # Which is also why the id is the name and not the condition: masking blanks the
        # name and the description, but every masked row still carries its id, so a
        # `builtin-low-score` would give the whole joke away to anybody reading the JSON.
        hidden=True,
        definition=_global("any_score", "<=", 2000),
    ),
)

BY_ID: dict[str, BuiltInAchievement] = {built_in.id: built_in for built_in in BUILT_INS}


def seed_rows() -> list[dict[str, Any]]:
    """The `achievements` rows the seed migration inserts, in `BUILT_INS` order.

    Every column spelled out, `sort_order` included: a bulk insert gets no ORM defaults.
    """
    return [
        {
            "id": built_in.id,
            "name": built_in.name,
            "description": built_in.description,
            "icon": built_in.icon,
            "icon_file": None,
            "color": built_in.color,
            "hidden": built_in.hidden,
            "enabled": True,
            "built_in": True,
            "sort_order": index,
            "definition": built_in.definition,
        }
        for index, built_in in enumerate(BUILT_INS)
    ]
