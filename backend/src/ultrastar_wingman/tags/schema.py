"""Tag read models. FastAPI-free like the other schemas, so the service can build them."""

from typing import Literal

from pydantic import BaseModel

# The literals mirror `model.TAG_ACTIONS` and `model.TAG_COLORS`; a test asserts the two
# never drift. Spelled out here because a `Literal` cannot be built from a tuple.
TagAction = Literal["view", "view_songs", "assign"]
TagColor = Literal["neutral", "blue", "pink", "gold"]


class TagPermissionRead(BaseModel):
    """Who may do one thing with a tag: a role, or one account."""

    action: TagAction
    role: str | None
    user_id: str | None
    # Filled beside `user_id` so the manage UI does not need a second request; None for a
    # role row and for an account that is gone.
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
    # The permission rows, for a caller who holds `tags.manage`; None for everybody else,
    # who has no business knowing which accounts were named on a tag.
    permissions: list[TagPermissionRead] | None = None


class TagList(BaseModel):
    tags: list[TagRead]


class TagAssignment(BaseModel):
    """Which songs carry one tag. Ids only — the client already has the song list."""

    tag_id: str
    song_ids: list[str]


class TagAssignments(BaseModel):
    assignments: list[TagAssignment]
