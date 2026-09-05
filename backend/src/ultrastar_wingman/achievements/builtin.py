"""The thirty-five achievements Wingman ships.

Data, not rows: the list below is what the seed migrations insert and what
`service.reset_built_in` reads back, so there is one place that says what *First Time on the
Mic* means. Once seeded they are ordinary rows, and `built_in = True` buys exactly three
things: a `DELETE` on one is a 409; its **conditions** are this file's, which no `PATCH` and
no import may move; and only a built-in has a `POST /achievements/{id}/reset`, which puts
everything here back. What a built-in looks like and whether it is on at all stay as editable
as anybody else's, because a party is not obliged to want *Brave Soul*.

That makes this file the only place a shipped definition is ever improved — and, because a
seed migration runs once, a reset is the only way an improvement here reaches a database that
already holds the old one. That is deliberate: a definition improved in a migration would
revoke the badge from everybody who earned it under the old number, without a host ever
pressing anything.

They arrived in batches — the seventeen of 2026-09 seeded by 0023, the seventeen of
2026-09-04 seeded by 0030, then *All Night Long* on top of them, seeded by 0031 — but the
file is no longer in arrival order: since 2026-09-04 the **hidden** ones stand at the end
(see the comment over `BUILT_INS`), so *Brave Soul*, which came with the first batch, sits
behind the second, and *All Night Long* stands with the two rungs below it rather than at the
end of the list. Which ids a seed migration is responsible for is frozen in that migration
(0030's and 0031's `NEW_IDS`) rather than taken as a slice of this list, and that is what
makes ordering the list by what it means rather than by when it arrived safe. What such an
order may not do is renumber the rows an older revision seeded, and it does not: the order
only decides what a **fresh** database starts with, and after that the order of the catalogue
is the host's — which is why a fresh database has *All Night Long* behind *Iron Lungs* and a
database that has been running since 2026-09-04 finds it at the end of its own arrangement.

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
    file lists them in is the order a **fresh** database is drawn in; after that the
    catalogue's order is the host's."""

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


def _artist(pattern: str) -> dict[str, Any]:
    """A selector matching one band and nothing that merely starts like it.

    `regex` and not `contains`: *Queen* would otherwise take Queensberry, Queens of the Stone
    Age and QUEEN BEE with it. The tail is what a song file writes after the band when a
    guest sings on it, so `^abba` alone would still be too greedy against *Abbacadabra*.
    """
    return {
        "combine": "all",
        "clauses": [{"field": "artist", "op": "regex", "value": pattern}],
    }


def _decade(start: int) -> list[dict[str, Any]]:
    """Five different songs from one decade, in one party.

    Two clauses and not one: a year takes `=`, `>=` and `<=` (`schema.YEAR_OPS`), so a decade
    is a range rather than a value — nothing in the selector divides by ten. And
    `different_songs` rather than `number_of_sings`, so one song five times is not a tour of
    the decade.
    """
    return _session(
        "different_songs",
        5,
        match={
            "combine": "all",
            "clauses": [
                {"field": "year", "op": ">=", "value": start},
                {"field": "year", "op": "<=", "value": start + 9},
            ],
        },
    )


# The order is the list a fresh instance is seeded with, and it is in two halves: the
# twenty-nine a party can read in the catalogue from the start, then the six that are
# **hidden until earned**, at the end. Hidden ones last because the catalogue is mostly read
# as a list of things to go for, and six locked rows in the middle of it are six holes; each
# half keeps the order the achievements arrived in, except that a rung added to a ladder
# later stands with its ladder (*All Night Long*) rather than behind all of it.
#
# The visible twenty-nine: a ladder of scores, a ladder of counts, and the same two again
# inside one party — then a duet, a ladder of wins, one badge per decade (a family, so all
# four are blue whatever each costs), and six nods to the songs and bands a karaoke night
# keeps coming back to. The colours climb with the achievement: neutral, blue, gold.
#
# The hidden six: a consolation prize, one long haul, two about the *range* of one evening,
# and two more jokes at the singer's expense — one of which is a nod that names the song it
# wants, and a joke told before it happens is not a joke. Pink belongs to this half: the
# three that are more joke than ladder wear it, and nothing in the visible half is pink.
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
        id="builtin-evening-songs-20",
        name="All Night Long",
        description="Sing 20 songs in one party.",
        icon="moon",
        color="gold",
        hidden=False,
        # The third rung of *Five in a Night* → *Iron Lungs*, and gold like the top of every
        # other three-step ladder here. It arrived after the two rungs below it and 0031 is
        # what seeds it, but it stands with its ladder rather than at the end of the file: a
        # fresh catalogue reads as a list of things to go for, and a ladder is read in order.
        definition=_session("number_of_sings", 20),
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
        id="builtin-wins-1",
        name="First Place",
        description="Win a song against another singer.",
        icon="star",
        color="neutral",
        hidden=False,
        # A win is a score that came first in a sing somebody else also sang, and the two
        # columns it is read off are written once and never corrected — so this one survives
        # the beaten score being deleted (`achievements.md`, the metric table). A song nobody
        # else sang is not a win, which is what "against another singer" says in the
        # description.
        definition=_global("number_of_wins", ">=", 1),
    ),
    BuiltInAchievement(
        id="builtin-wins-10",
        name="On a Roll",
        description="Win 10 songs against other singers.",
        icon="flag",
        color="blue",
        hidden=False,
        definition=_global("number_of_wins", ">=", 10),
    ),
    BuiltInAchievement(
        id="builtin-wins-50",
        name="Undisputed",
        description="Win 50 songs against other singers.",
        icon="shield",
        color="gold",
        hidden=False,
        definition=_global("number_of_wins", ">=", 50),
    ),
    # The four decades are one shape at four numbers (`_decade`), and all four are blue
    # rather than climbing the ladder: they cost the same, and a family reads as a family.
    BuiltInAchievement(
        id="builtin-decade-1970s",
        name="Back to the 70s",
        description="Sing 5 songs from the 1970s in one party.",
        icon="disc",
        color="blue",
        hidden=False,
        definition=_decade(1970),
    ),
    BuiltInAchievement(
        id="builtin-decade-1980s",
        name="Back to the 80s",
        description="Sing 5 songs from the 1980s in one party.",
        icon="tv",
        color="blue",
        hidden=False,
        definition=_decade(1980),
    ),
    BuiltInAchievement(
        id="builtin-decade-1990s",
        name="Back to the 90s",
        description="Sing 5 songs from the 1990s in one party.",
        icon="bell",
        color="blue",
        hidden=False,
        definition=_decade(1990),
    ),
    BuiltInAchievement(
        id="builtin-decade-2000s",
        name="Back to the 2000s",
        description="Sing 5 songs from the 2000s in one party.",
        icon="headphones",
        color="blue",
        hidden=False,
        definition=_decade(2000),
    ),
    BuiltInAchievement(
        id="builtin-rap-god",
        name="Rap God",
        description="Score 8,000 or more in a rap or hip-hop song.",
        icon="mic",
        color="gold",
        hidden=False,
        definition=_global(
            "any_score",
            ">=",
            8000,
            match={
                "combine": "any",
                "clauses": [
                    {"field": "genre", "op": "contains", "value": "rap"},
                    {"field": "genre", "op": "contains", "value": "hip-hop"},
                ],
            },
        ),
    ),
    BuiltInAchievement(
        id="builtin-queen-10",
        name="Killer Queen",
        description="Sing 10 different Queen songs.",
        icon="crown",
        color="gold",
        hidden=False,
        definition=_global("different_songs", ">=", 10, match=_artist(r"^queen($| feat| &)")),
    ),
    BuiltInAchievement(
        id="builtin-abba-5",
        name="Super Trouper",
        description="Sing 5 different ABBA songs.",
        icon="sun",
        color="blue",
        hidden=False,
        definition=_global("different_songs", ">=", 5, match=_artist(r"^abba($| feat| &)")),
    ),
    BuiltInAchievement(
        id="builtin-beatles-4",
        name="The Fab Four",
        description="Sing 4 different Beatles songs.",
        icon="anchor",
        color="neutral",
        hidden=False,
        # `contains` is safe for this one: nothing else is called anything with "beatles" in
        # it, and *The Beatles* is written both ways round in the wild.
        definition=_global(
            "different_songs",
            ">=",
            4,
            match={
                "combine": "all",
                "clauses": [{"field": "artist", "op": "contains", "value": "beatles"}],
            },
        ),
    ),
    BuiltInAchievement(
        id="builtin-christmas",
        name="Christmas Number One",
        description="Score 8,000 or more in a Christmas song.",
        icon="snowflake",
        color="gold",
        hidden=False,
        definition=_global(
            "any_score",
            ">=",
            8000,
            match={
                # The title carries this one: far more festive songs say so in their name
                # than are ever tagged with the genre, and either will do.
                "combine": "any",
                "clauses": [
                    {"field": "genre", "op": "contains", "value": "christmas"},
                    {"field": "title", "op": "regex", "value": "christmas|weihnacht|xmas"},
                ],
            },
        ),
    ),
    BuiltInAchievement(
        id="builtin-soundtrack",
        name="Roll the Credits",
        description="Collect 20,000 points from soundtrack songs in one party.",
        icon="film",
        color="blue",
        hidden=False,
        definition=_session(
            "sum_of_scores",
            20000,
            match={
                "combine": "any",
                "clauses": [
                    {"field": "genre", "op": "contains", "value": "soundtrack"},
                    {"field": "genre", "op": "contains", "value": "musical"},
                ],
            },
        ),
    ),
    # --- Hidden until earned -------------------------------------------------------------
    BuiltInAchievement(
        id="builtin-artists-10",
        name="Well Traveled",
        description="Sing songs by 20 different artists.",
        icon="plane",
        color="blue",
        # Hidden since 2026-09-04: twenty artists is a long haul, and a locked row is a
        # better companion to it than a bar that spends a year at "6 / 20".
        #
        # Its id is `builtin-artists-10`, which both names the condition and holds a number
        # this achievement stopped asking for — the one place the "an id gives a hidden one
        # away" rule below is broken, and knowingly: the id is frozen. Import matches by it,
        # `images/builtin-artists-10.png` is named after it and 0025 renames by it, so the
        # leak is cheaper than the rename.
        hidden=True,
        definition=_global("different_artists", ">=", 20),
    ),
    BuiltInAchievement(
        id="builtin-brave-soul",
        name="Brave Soul",
        description="Finish a song with 2,000 points or fewer.",
        icon="ghost",
        color="neutral",
        # The first hidden one there ever was, and the reason four of the others are: it is a
        # joke at the singer's expense, and a joke that announced itself in the catalogue
        # beforehand would read as an instruction to sing badly.
        #
        # Which is also why the id is the name and not the condition: masking blanks the
        # name and the description, but every masked row still carries its id, so a
        # `builtin-low-score` would give the whole joke away to anybody reading the JSON.
        hidden=True,
        definition=_global("any_score", "<=", 2000),
    ),
    BuiltInAchievement(
        id="builtin-time-traveler",
        name="Time Traveler",
        description="Sing songs from 5 different decades in one party.",
        icon="clock",
        color="pink",
        # Hidden, and the id says the name rather than the condition, for Brave Soul's
        # reason: a masked row still ships its id, so `builtin-five-decades` would hand the
        # surprise to anybody reading the JSON. The four decade badges are its hint — they
        # are what teaches somebody that a year is a thing Wingman counts — and they stand
        # in the visible half of the list, this one down here with the rest of the locked
        # rows.
        hidden=True,
        definition=_session("different_decades", 5),
    ),
    BuiltInAchievement(
        id="builtin-mixtape",
        name="Mixtape",
        description="Sing 10 different genres in one party.",
        icon="layers",
        color="pink",
        # The other half of Time Traveler, and hidden for the same reason. Ten genres asks a
        # lot of a library: a song whose file has no genre — or the literal `None` USDB
        # writes — counts for nothing here, so this is an evening of well-tagged songs.
        hidden=True,
        definition=_session("different_genres", 10),
    ),
    BuiltInAchievement(
        id="builtin-full-commitment",
        name="Rickrolled",
        description="Sing Never Gonna Give You Up.",
        icon="gift",
        color="gold",
        # Hidden, and the id is deliberately not the song: the whole of this one is that
        # nobody saw it coming, and a masked row still carries its id.
        hidden=True,
        definition=_global(
            "number_of_sings",
            ">=",
            1,
            match={
                "combine": "all",
                # Title *and* artist: the song has been covered by everybody, and the joke is
                # the original. Not the genre — the file USDB ships has none.
                "clauses": [
                    {"field": "title", "op": "contains", "value": "never gonna give you up"},
                    {"field": "artist", "op": "contains", "value": "astley"},
                ],
            },
        ),
    ),
    BuiltInAchievement(
        id="builtin-groundhog-day",
        name="Groundhog Day",
        description="Sing the same song three times.",
        icon="refresh",
        color="pink",
        # Hidden since 2026-09-04: it is the other joke at the singer's expense, and a
        # catalogue that asked for it in advance would be asking somebody to bore the room
        # on purpose.
        hidden=True,
        # Over any number of parties, and the other songs in between do not matter: that is
        # what `most_sings_of_one_song` measures, and it is why this is one condition rather
        # than a count of sings beside a count of songs.
        definition=_global("most_sings_of_one_song", ">=", 3),
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
