"""The party the documentation screenshots show, as data.

``seed.py`` is the machinery; this file is the story. Change a score, a wish or a playlist
here and the next seed run tells it differently. Nothing in here talks to anything.

Two rules the numbers below have to keep, because manifest rows depend on them:

* **Leela has scores on exactly two songs.** The *Sung* mark on the song list is "songs
  this account's player ever scored on", and the ``songs-list`` row asks for two of them.
* **Bender sings nine 1980s songs tonight and nothing else tonight.** That leaves him one
  short of both *Iron Lungs* (ten songs in one party) and the *Eighties Marathon* the
  documentation walks through, so the one sing the capture harness starts through the
  stand-in launcher earns him two badges at once. Give him a tenth here and the
  ``host-achievements`` row has nothing to photograph.
* **Only Leela holds a card.** The *My cards* block is drawn for any account that holds
  one, and three manifest rows photograph Fry and Bender on their own user page. Give
  either of them a card and a block that has nothing to do with those pictures grows into
  them.

Songs are named by their ``usdb_id`` from ``songs.json``, so a renamed title never
silently drops a score.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# --- the people --------------------------------------------------------------------------

# The three accounts, in the order they are created: the first account an instance ever has
# is its administrator, so Leela has to come first.
ADMIN = "Leela"

ACCOUNTS: tuple[tuple[str, str], ...] = (
    ("Leela", "leela-screenshot-pw"),
    ("Fry", "fry-screenshot-pw"),
    ("Bender", "bender-screenshot-pw"),
)

# Everybody else sings as a guest player, created by the host. Scruffy is hidden: the
# people-admin row needs one player who is out of the singer picker.
GUEST_PLAYERS: tuple[str, ...] = (
    "Zoidberg",
    "Amy",
    "Hermes",
    "Farnsworth",
    "Zapp",
    "Kif",
    "Scruffy",
)

HIDDEN_PLAYER = "Scruffy"

# Picture file stems in the avatars directory, one per player. A stem with no file is
# reported and the player keeps the app's own initials avatar.
AVATAR_STEMS: dict[str, str] = {
    "Leela": "leela",
    "Fry": "fry",
    "Bender": "bender",
    "Zoidberg": "zoidberg",
    "Amy": "amy",
    "Hermes": "hermes",
    "Farnsworth": "farnsworth",
    "Zapp": "zapp",
    "Kif": "kif",
    "Scruffy": "scruffy",
}


# --- the two parties ---------------------------------------------------------------------


@dataclass(frozen=True)
class SingPlan:
    """One run of one song, and what it scored. ``minute`` is how many minutes before the
    party's last sing this one started, so a party reads back to front."""

    usdb_id: int
    minute: int
    scores: tuple[tuple[str, int], ...]


@dataclass(frozen=True)
class PartyPlan:
    """One karaoke session. ``days_ago`` and ``ends_minutes_ago`` place it against the
    moment the seed runs — tonight's party has to be recent enough that a sing started
    during the capture joins it instead of opening a new one (the six hour session gap)."""

    key: str
    name: str | None
    days_ago: int
    ends_minutes_ago: int
    sings: tuple[SingPlan, ...] = field(default_factory=tuple)


# A week ago. Gives every singer a history, which is what "All my scores" and the second
# entry in the party selector need. Bender's four songs here are deliberately not from the
# eighties.
OLDER_PARTY = PartyPlan(
    key="older",
    name="Zoidberg's birthday",
    days_ago=7,
    ends_minutes_ago=30,
    sings=(
        SingPlan(1103, 150, (("Bender", 9842),)),
        SingPlan(1301, 135, (("Bender", 7530),)),
        SingPlan(1403, 120, (("Bender", 6244),)),
        SingPlan(1101, 105, (("Bender", 5109),)),
        SingPlan(1502, 95, (("Fry", 6001),)),
        SingPlan(1302, 80, (("Fry", 5588),)),
        SingPlan(1305, 65, (("Fry", 6930),)),
        SingPlan(1102, 55, (("Zoidberg", 2204),)),
        SingPlan(1306, 45, (("Zoidberg", 3455),)),
        SingPlan(1303, 35, (("Zoidberg", 2918),)),
        SingPlan(1404, 25, (("Amy", 7220),)),
        SingPlan(1405, 20, (("Amy", 6610),)),
        SingPlan(1211, 15, (("Hermes", 6880),)),
        SingPlan(1304, 10, (("Hermes", 7140),)),
        SingPlan(1208, 5, (("Zapp", 5400),)),
    ),
)

# Tonight, still going. Twenty-three scores over five singers, which is what the scores
# page and the host screen are photographed against. Named, because the picture of the
# party button would otherwise read "Party 9/3/2026, 05:18 AM": the seed runs relative to
# the clock, so an unnamed party looks like it started at whatever hour the run happened.
# Short enough that the button does not have to ellipsize it at 390px.
TONIGHT = PartyPlan(
    key="tonight",
    name="Robot Hell karaoke",
    days_ago=0,
    ends_minutes_ago=5,
    sings=(
        SingPlan(1201, 110, (("Bender", 7412),)),
        SingPlan(1403, 105, (("Fry", 5940),)),
        SingPlan(1202, 100, (("Bender", 6833),)),
        SingPlan(1508, 95, (("Amy", 7044),)),
        SingPlan(1203, 90, (("Bender", 8104),)),
        SingPlan(1102, 85, (("Zoidberg", 1842),)),
        SingPlan(1205, 80, (("Bender", 5977),)),
        SingPlan(1501, 75, (("Fry", 7103),)),
        SingPlan(1209, 70, (("Bender", 8662),)),
        SingPlan(1406, 65, (("Zoidberg", 3105),)),
        SingPlan(1212, 60, (("Bender", 7205),)),
        SingPlan(1510, 55, (("Amy", 6120),)),
        SingPlan(1214, 50, (("Bender", 6540),)),
        SingPlan(1301, 45, (("Fry", 4880),)),
        SingPlan(1213, 40, (("Bender", 7881),)),
        SingPlan(1101, 35, (("Zoidberg", 2460),)),
        SingPlan(1207, 30, (("Bender", 6318),)),
        SingPlan(1104, 25, (("Fry", 6712), ("Leela", 8241))),
        SingPlan(1509, 20, (("Zoidberg", 3890),)),
        SingPlan(1504, 15, (("Amy", 8309),)),
        SingPlan(1402, 10, (("Leela", 7690),)),
        SingPlan(1507, 5, (("Fry", 6455),)),
    ),
)

PARTIES: tuple[PartyPlan, ...] = (OLDER_PARTY, TONIGHT)


# --- what people asked for ---------------------------------------------------------------


@dataclass(frozen=True)
class WishPlan:
    """One wished song and everybody who wished for it. A wisher is an account name or
    ``guest:<name>``, which becomes a fixed browser cookie of its own."""

    usdb_id: int
    wishers: tuple[str, ...]


# The order matters: ``seed.py wishes --count N`` takes the first N of these. Four of them
# is the Home page's picture, six is the wishlist's — and the first two rows are the ones
# two people wished for.
WISHES: tuple[WishPlan, ...] = (
    WishPlan(1301, ("Leela", "Fry")),
    WishPlan(1101, ("Bender", "guest:Amy")),
    WishPlan(1201, ("Leela",)),
    WishPlan(1102, ("guest:Zoidberg",)),
    WishPlan(1202, ("Fry",)),
    WishPlan(1211, ("guest:Hermes",)),
)

# Two for Leela, because the songs page is photographed as Leela and wants two hearts.
FAVORITES: dict[str, tuple[int, ...]] = {
    "Leela": (1104, 1402),
    "Bender": (1103, 1209, 1213),
    "Fry": (1501, 1507),
}


# --- playlists ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PlaylistPlan:
    owner: str
    name: str
    description: str | None
    is_global: bool
    usdb_ids: tuple[int, ...]
    # username -> access, for the membership rows the manage page shows.
    members: tuple[tuple[str, str], ...] = field(default_factory=tuple)


PLAYLISTS: tuple[PlaylistPlan, ...] = (
    PlaylistPlan(
        owner="Leela",
        name="Planet Express party mix",
        description="What the crew agrees on. Mostly.",
        is_global=True,
        usdb_ids=(1201, 1209, 1302, 1301, 1507, 1404, 1212, 1101),
        members=(("Fry", "write"), ("Bender", "read")),
    ),
    PlaylistPlan(
        owner="Bender",
        name="Bender's bangers",
        description="Loud ones only.",
        is_global=False,
        usdb_ids=(1103, 1203, 1401, 1213, 1209),
        # Shared with Leela, and so is the one below: the playlists page is photographed
        # as Leela, and the manifest asks for three rows there. A playlist that is neither
        # global nor shared with the reader is a playlist they never see.
        members=(("Leela", "read"),),
    ),
    PlaylistPlan(
        owner="Fry",
        name="Slow ones for later",
        description=None,
        is_global=False,
        usdb_ids=(1504, 1405, 1104, 1304),
        members=(("Leela", "read"),),
    ),
)

# The playlist the manifest photographs. Named by its position above.
FEATURED_PLAYLIST = 0


# --- tags --------------------------------------------------------------------------------


@dataclass(frozen=True)
class TagPlan:
    name: str
    icon: str
    color: str
    show_in_list: bool
    hide_by_default: bool
    usdb_ids: tuple[int, ...]
    # Roles that may see the tag and the songs it sits on. Without them a tag is
    # administrators-only and every song it touches disappears for everybody else.
    view_roles: tuple[str, ...] = ("guest", "user", "trusted")
    assign_roles: tuple[str, ...] = ("trusted",)
    # Accounts named on the tag by hand, so the editor has a "Specific people" row. Each of
    # them is given all three actions; assign on its own is a misconfiguration the editor
    # warns about, and the tag editor's picture must not be of one.
    assign_users: tuple[str, ...] = ()


TAGS: tuple[TagPlan, ...] = (
    TagPlan(
        name="Crowd pleaser",
        icon="star",
        color="gold",
        show_in_list=True,
        hide_by_default=False,
        usdb_ids=(1201, 1209, 1302, 1507, 1303),
        assign_users=("Fry",),
    ),
    TagPlan(
        name="Late night",
        icon="moon",
        color="blue",
        show_in_list=False,
        hide_by_default=False,
        usdb_ids=(1504, 1405, 1304),
    ),
    TagPlan(
        name="Needs fixing",
        icon="alert",
        color="pink",
        show_in_list=True,
        hide_by_default=True,
        # Deliberately not Sandstorm: a song hidden by default is out of the reel, and the
        # reel screenshot has to be able to land on it.
        usdb_ids=(1306, 1506),
    ),
)


# --- comments ----------------------------------------------------------------------------

# Three of them on the duet, which is the song the song modal is photographed on. The last
# number is how many hours before the seed runs the comment was said: the API stamps a
# comment with the moment it is written, and three lines all reading "just now" are the one
# thing on that modal that says the picture was staged.
COMMENTS: tuple[tuple[int, str, str, int], ...] = (
    (1104, "Fry", "Leela and I have this one. Nobody else touches it.", 14 * 24),
    (1104, "Leela", "He starts too early every single time.", 6 * 24),
    (1104, "Bender", "I have seen better duets in a scrapyard.", 30),
)


# --- achievements ------------------------------------------------------------------------

# The party's own two, imported as an archive so their ids stay the same in every run and
# the documentation can link to one. The first is the worked example the docs walk through;
# the second is switched off, which is what the management page needs to show.
OWN_ACHIEVEMENTS: tuple[dict[str, object], ...] = (
    {
        "id": "eighties-marathon",
        "name": "Eighties Marathon",
        "description": "Sing 10 songs from the 80s in one evening.",
        "icon": "disc",
        "color": "gold",
        "hidden": False,
        "enabled": True,
        "definition": [
            {
                "scope": "session",
                "metric": "number_of_sings",
                "comparator": ">=",
                "value": 10,
                "match": {
                    "combine": "all",
                    "clauses": [
                        {"field": "year", "op": ">=", "value": 1980},
                        {"field": "year", "op": "<=", "value": 1989},
                    ],
                },
            }
        ],
    },
    {
        "id": "sandstorm-survivor",
        "name": "Sandstorm Survivor",
        "description": "Sing Sandstorm all the way through. Somebody had to.",
        "icon": "ghost",
        "color": "blue",
        "hidden": False,
        "enabled": False,
        "definition": [
            {
                "scope": "global",
                "metric": "number_of_sings",
                "comparator": ">=",
                "value": 1,
                "match": {
                    "combine": "all",
                    "clauses": [{"field": "title", "op": "equals", "value": "Sandstorm"}],
                },
            }
        ],
    },
)

# The achievement whose lock the management page is photographed with — one of the six
# Wingman ships that are hidden until they are earned (they stand at the end of the shipped
# list, which is why the seed moves this one). The catalogue is one order over all of it, and
# the seed arranges the party's own two at the head of it with this one just behind them, so
# the lock and the off row the management page is photographed for are on the first screen.
# Nothing else about it changes.
LOCKED_BUILT_IN = "builtin-brave-soul"

# The achievement the seed leaves Bender one sing short of, and the song that finishes it.
# Both are 1980s songs he has not sung tonight, so either completes the marathon.
PENDING_ACHIEVEMENT = "eighties-marathon"
PENDING_SINGER = "Bender"
FINISHING_SONG = 1210

# Long enough that a badge row on the host screen holds still while a picture is taken.
# The app's own defaults are 4 and 2 seconds.
HOST_SECONDS_BASE = 30
HOST_SECONDS_PER_BADGE = 15


# --- the player selector -------------------------------------------------------------------

# One device, so the selector pages have something on them. Six reader positions, the first
# two wired with a card lying on each: one card belongs to a player, the other belongs to
# nobody, which is the pair the admin page, the TV and the *My cards* block are all about.
DEVICE_NAME = "The box by the TV"

# One version behind the image this build of Wingman bundles, so the device page offers the
# update over Wi-Fi. A device that already ran the bundled version would offer nothing.
DEVICE_FIRMWARE = "0.2.0"

# Leela holds the known card, and neither Fry nor Bender holds one. Those two are the ones
# photographed on their own user page, and a card of their own would put a *My cards* block
# into pictures that are not about it. Fry is therefore the one `user-my-cards` is taken as:
# the block is on his page because a card is lying on the selector, not because he owns one.
CARD_HOLDER = "Leela"
CARD_CLAIMER = "Fry"

# Uppercase hex, 8 to 20 characters, the way a reader reads a MIFARE Classic id.
KNOWN_CARD = "04A1B2C3"
UNKNOWN_CARD = "0B7E4419"

# The song the TV is photographed picking singers for: the duet the phone's own player
# selection is photographed with, so the two pictures tell one story.
PICKING_SONG = 1104


# --- the download queue ------------------------------------------------------------------

# Written straight into the database: a real download would need yt-dlp, ffmpeg and the
# real USDB. The first row is the one the panel draws a bar for.
DOWNLOADS: tuple[dict[str, object], ...] = (
    {
        "source_song_id": "9101",
        "artist": "ABBA",
        "title": "Mamma Mia",
        "status": "running",
        "progress": 60.0,
        "step": "downloading the video",
    },
    {
        "source_song_id": "9103",
        "artist": "Bon Jovi",
        "title": "It's My Life",
        "status": "queued",
        "progress": None,
        "step": None,
    },
)

# The address the host screen puts under its QR code. A made-up LAN address, so no picture
# ever shows the machine it was taken on.
JOIN_URL = "http://192.168.1.42:8091"

# The USDB account the settings page shows. There is no such account anywhere: it exists
# only for the stand-in server, which lets anybody in.
USDB_USERNAME = "wingman-demo"
USDB_PASSWORD = "not-a-real-password"
