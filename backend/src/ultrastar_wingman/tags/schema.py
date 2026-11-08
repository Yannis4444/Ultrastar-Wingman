"""Tag read models. FastAPI-free like the other schemas, so the service can build them."""

from typing import Literal

from pydantic import BaseModel

# The literals mirror `model.TAG_ACTIONS` and `model.TAG_COLORS`; a test asserts the two
# never drift. Spelled out here because a `Literal` cannot be built from a tuple.
TagAction = Literal["view", "view_songs", "assign"]
TagColor = Literal["neutral", "blue", "pink", "gold"]

# The eight things Wingman brings with it, in the order the *Built-in* section lists
# them. They are not rows in `tags`: a tag is one global row somebody wrote, while these
# are what the app already knows — two facts about *one reader* (their favorites, the
# songs they have sung) and six read straight out of the song files. Their ids are words,
# and a tag id is 32 hex characters, so `/user/tags/favorites` can never mean a real tag.
BuiltInTagId = Literal[
    "favorites", "sung", "duet", "video", "genre", "language", "edition", "decade"
]

# What a built-in *is*, which is the same as saying which options it has:
#
# * `mark` — a fact about the reader (Favorites, Sung): a colour and `show_in_list`.
# * `boolean` — a yes/no fact about the song (Duet, Video): those two and
#   `show_in_filter`, because a fact everybody shares is worth filtering on.
# * `valued` — a fact with a value (Genre, Language, Edition, Decade): `show_in_filter`
#   alone. Its values are a near-universal attribute, so §1.3 keeps them off the rows and
#   there is no colour to draw them in.
BuiltInTagKind = Literal["mark", "boolean", "valued"]


class TagPermissionRead(BaseModel):
    """Who may do one thing with a tag: a permission group, or one account. No group name:
    the tag editor has `GET /groups` for that."""

    action: TagAction
    group_id: str | None
    user_id: str | None
    # Filled beside `user_id` so the manage UI does not need a second request; None for a
    # group row and for an account that is gone.
    username: str | None


class TagRead(BaseModel):
    id: str
    name: str
    # An icon name the frontend resolves; None means the tag is a plain word.
    icon: str | None
    color: str
    # Draw it on every song row, like the favorites star and the sung marker.
    show_in_list: bool
    # A client-side default: fold this tag's songs away from the list. Only meaningful to
    # somebody who may view the tag — hiding songs from everybody else is `view_songs`.
    hide_by_default: bool
    # Whether the tag exists as far as the caller is concerned. True for every row of
    # every listing but one: a `tags.manage` holder is shown the tags they may not view,
    # because managing a tag is not the same right as knowing it. Reader-facing surfaces
    # — the marks on a song row, the modal's Tags row, the filter panel — draw only the
    # rows where this is true.
    can_view: bool
    # Whether the caller may tag and untag songs with it.
    can_assign: bool
    # How many songs carry the tag, over the whole library — songs this caller may not
    # see included, songs that have left it not. A manager who never gave themselves
    # `view_songs` still has to be told what a delete would take the tag off, and a count
    # is not a listing: `GET /tags/assignments` remains the only place ids come from.
    song_count: int
    # The permission rows, for a caller who holds `tags.manage`; None for everybody else,
    # who has no business knowing which accounts were named on a tag.
    permissions: list[TagPermissionRead] | None = None


class BuiltInTagRead(BaseModel):
    """One built-in, and the little about it a party may decide.

    No name, icon, permissions or song count: the glyph and the name are fixed, and how
    many songs carry it is a different number for every reader (a mark) or one number per
    value (a valued facet). What is left is what a tag row would also have — the colour it
    is drawn in, whether it belongs on a song row, and whether the Filter panel offers it.

    One flat model rather than three, one per kind: `kind` says which options exist, and
    an option the kind does not have is **null** — not absent, and never a value that
    could be mistaken for a setting somebody made. So a reader checks `kind` (or, for one
    field, `is not None`) and a `PATCH` naming a null option is a 422."""

    id: BuiltInTagId
    kind: BuiltInTagKind
    # The colour it is drawn in — `mark` and `boolean`; null for a valued facet, which
    # draws no mark and whose Filter row is neutral.
    color: str | None
    # Draw it on every song row it applies to, like a `show_in_list` tag — `mark` and
    # `boolean`; null for a valued facet (§1.3: a genre is not a row mark).
    show_in_list: bool | None
    # Offer it as a row in the Filter panel — `boolean` and `valued`; null for the two
    # marks, which the panel always lists (they are the Favorites and Sung chips).
    show_in_filter: bool | None


class TagList(BaseModel):
    tags: list[TagRead]
    # A separate list, not rows among the tags: every reader gets all eight — a guest with
    # no account included, because the marks are drawn for everybody — while `tags` is
    # filtered by what the caller may view, and nothing about a built-in is per-caller.
    built_ins: list[BuiltInTagRead]


class TagAssignment(BaseModel):
    """Which songs carry one tag. Ids only — the client already has the song list."""

    tag_id: str
    song_ids: list[str]


class TagAssignments(BaseModel):
    assignments: list[TagAssignment]
