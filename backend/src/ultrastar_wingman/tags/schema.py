"""Tag read models. FastAPI-free like the other schemas, so the service can build them."""

from typing import Literal

from pydantic import BaseModel

# The literals mirror `model.TAG_ACTIONS` and `model.TAG_COLORS`; a test asserts the two
# never drift. Spelled out here because a `Literal` cannot be built from a tuple.
TagAction = Literal["view", "view_songs", "assign"]
TagColor = Literal["neutral", "blue", "pink", "gold"]

# The two marks Wingman brings with it. They are not rows in `tags`: what they say about a
# song is a fact about *one reader* — their favorites, the songs they have sung — while a
# tag is one global row everybody shares. Their ids are words, and a tag id is 32 hex
# characters, so `/user/tags/favorites` can never mean a real tag.
BuiltInTagId = Literal["favorites", "sung"]


class TagPermissionRead(BaseModel):
    """Who may do one thing with a tag: a role, or one account."""

    action: TagAction
    role: str | None
    user_id: str | None
    # Filled beside `user_id` so the manage UI does not need a second request; None for a
    # role row and for an account that is gone.
    username: str | None


class TagRuleRead(BaseModel):
    """The rule a tag carries, if it carries one: a kind from the registry and, for the
    kinds that compare a field, the value it compares against."""

    kind: str
    value: str | None


class TagRuleKindRead(BaseModel):
    """One entry of the rule registry, as the tag editor needs it: what to call it, whether
    it needs a value, and the values the library holds for the field it reads."""

    kind: str
    label: str
    needs_value: bool
    # Empty for a kind that needs no value; otherwise the library's own values, for the
    # editor's datalist. Over the whole library, songs the caller may not see included.
    suggestions: list[str]


class TagRuleKindList(BaseModel):
    rules: list[TagRuleKindRead]


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
    # Whether the caller may tag and untag songs with it. Always false for a tag carrying
    # a rule: an automatic tag is the scanner's, and nobody — an administrator included —
    # puts it on a song by hand. The permission rows behind it are left alone, so taking
    # the rule off gives the tag back to the people it was granted to.
    can_assign: bool
    # The rule that puts this tag on songs, or null for a tag people set themselves.
    rule: TagRuleRead | None
    # How many songs carry the tag, over the whole library — songs this caller may not
    # see included, songs that have left it not. A manager who never gave themselves
    # `view_songs` still has to be told what a delete would take the tag off, and a count
    # is not a listing: `GET /tags/assignments` remains the only place ids come from.
    song_count: int
    # The permission rows, for a caller who holds `tags.manage`; None for everybody else,
    # who has no business knowing which accounts were named on a tag.
    permissions: list[TagPermissionRead] | None = None


class BuiltInTagRead(BaseModel):
    """One of the two built-in marks, and the little about it a party may decide.

    No name, icon, permissions or song count: the glyph is fixed (`heart` / `mic`), the
    name is what the app calls it, and how many songs carry it is a different number for
    every reader. What is left is what a tag row would also have — the colour it is drawn
    in, and whether it belongs on a song row at all."""

    id: BuiltInTagId
    color: str
    # Draw the mark on every song row it applies to, like a `show_in_list` tag.
    show_in_list: bool


class TagList(BaseModel):
    tags: list[TagRead]
    # A separate list, not rows among the tags: every reader gets these two — a guest with
    # no account included, because the marks are drawn for everybody — while `tags` is
    # filtered by what the caller may view, and nothing about a built-in is per-caller.
    built_ins: list[BuiltInTagRead]


class TagAssignment(BaseModel):
    """Which songs carry one tag. Ids only — the client already has the song list."""

    tag_id: str
    song_ids: list[str]


class TagAssignments(BaseModel):
    assignments: list[TagAssignment]
