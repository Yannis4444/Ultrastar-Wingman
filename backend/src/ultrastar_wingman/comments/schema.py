"""Comment read models. FastAPI-free like the other schemas, so the service can build them."""

from datetime import datetime

from pydantic import BaseModel


class CommentAuthor(BaseModel):
    """Who said it, as the list draws them: a name and, when the account sings, the player
    whose picture goes next to it.

    `player_id` is None for an account that never got a player, and `avatar_version` is
    None until that player has a picture — the same cache buster `PlayerRead` carries.
    """

    user_id: str
    username: str
    player_id: str | None
    avatar_version: int | None


class CommentRead(BaseModel):
    id: int
    song_id: str
    body: str
    created_at: datetime
    # None only when the account behind the comment is gone. Deleting an account takes its
    # comments with it, so this is robustness against a hand-edited database rather than a
    # state the app can reach.
    author: CommentAuthor | None
    # The caller wrote this one. Their own comment is theirs to delete, moderator or not.
    mine: bool
    # Whether the delete button belongs on this row: `mine`, or `comments.moderate`.
    can_delete: bool


class CommentList(BaseModel):
    comments: list[CommentRead]
