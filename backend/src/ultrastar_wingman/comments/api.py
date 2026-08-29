"""Comment endpoints: what the song modal shows under a song, and who may add to it.

Reading is `songs.view` — a guest phone at the party reads what everybody said. Writing
needs an account (`comments.write` *and* `account_id`): the host screen is an
administrator but nobody, so it has no name to sign a comment with. Deleting is the
author's own right, or `comments.moderate` over anybody's — an author-or-moderator
dependency in the style of `players.api.own_player_or_avatar_right`.
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, StringConstraints

from ..auth.deps import AccountIdDep, HiddenSongsDep, Principal, PrincipalDep, account_id, require
from ..db import SessionDep
from ..songs.api import song_or_404
from . import service
from .model import MAX_BODY_LENGTH, SongComment
from .schema import CommentList, CommentRead

logger = logging.getLogger(__name__)

router = APIRouter(tags=["comments"])

CommentBody = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_BODY_LENGTH)
]

UNKNOWN_SONG: dict[int | str, dict[str, object]] = {404: {"description": "Unknown song."}}


class CommentCreate(BaseModel):
    body: CommentBody


@router.get(
    "/songs/{song_id}/comments",
    response_model=CommentList,
    dependencies=[Depends(require("songs.view"))],
    responses=UNKNOWN_SONG,
)
async def list_song_comments(
    song_id: str, session: SessionDep, principal: PrincipalDep, hidden: HiddenSongsDep
) -> CommentList:
    """What was said about one song, oldest first. Open to a guest phone: reading the
    conversation is part of looking at the song, writing to it is what needs an account."""
    await song_or_404(song_id, session, hidden)
    return CommentList(
        comments=await service.read_comments(
            session, song_id, _user_id(principal), _moderates(principal)
        )
    )


@router.post(
    "/songs/{song_id}/comments",
    response_model=CommentRead,
    status_code=201,
    # Capability first, account second — the same order as `copy_playlist`: an anonymous
    # caller has to reach the 403 the permission matrix asserts, and only a caller who may
    # comment at all is then told that it takes an account.
    dependencies=[Depends(require("comments.write")), Depends(account_id)],
    responses={
        **UNKNOWN_SONG,
        401: {"description": "A comment needs an account to sign it."},
    },
)
async def add_song_comment(
    song_id: str,
    body: CommentCreate,
    session: SessionDep,
    principal: PrincipalDep,
    user_id: AccountIdDep,
    hidden: HiddenSongsDep,
) -> CommentRead:
    """Say something about a song. There is no editing: a comment is said, or deleted."""
    await song_or_404(song_id, session, hidden)
    comment = await service.add_comment(session, song_id, user_id, body.body)
    return await service.read_comment(session, comment, user_id, _moderates(principal))


async def own_comment_or_moderate_right(
    comment_id: int, session: SessionDep, principal: PrincipalDep
) -> SongComment | None:
    """The comment to delete, once this caller is allowed to delete it.

    Your own words are yours, like your favorites — there is nothing for an administrator
    to grant. Everybody else's takes `comments.moderate`.

    A dependency and not an `if` in the handler, both because the permission belongs in the
    decorator (code-style.md) and because it has to refuse *before* the comment is known to
    exist: without that, a caller who may delete nothing could tell a real comment id from
    a made-up one by the status code. So an unknown id is a 403 for a plain account and a
    404 only for a moderator, who was going to be told either way.
    """
    comment = await service.get_comment(session, comment_id)
    if comment is None or principal.user is None or comment.user_id != principal.user.id:
        principal.require(service.MODERATE_CAPABILITY)
    return comment


@router.delete(
    "/songs/{song_id}/comments/{comment_id}",
    status_code=204,
    dependencies=[Depends(require("songs.view"))],
    responses={
        403: {"description": "Somebody else's comment, without `comments.moderate`."},
        404: {"description": "Unknown song or comment."},
    },
)
async def delete_song_comment(
    song_id: str,
    comment_id: int,
    session: SessionDep,
    hidden: HiddenSongsDep,
    comment: Annotated[SongComment | None, Depends(own_comment_or_moderate_right)],
) -> None:
    """Take a comment back, or moderate one away."""
    await song_or_404(song_id, session, hidden)
    # A comment id that belongs to another song is as unknown as one that never existed:
    # the pair in the path is what the client was shown.
    if comment is None or comment.song_id != song_id:
        raise HTTPException(status_code=404, detail=f"unknown comment '{comment_id}'")
    await service.delete_comment(session, comment)


def _user_id(principal: Principal) -> str | None:
    """None for the host screen and for every anonymous reader: neither owns a comment."""
    return None if principal.user is None else principal.user.id


def _moderates(principal: Principal) -> bool:
    return service.MODERATE_CAPABILITY in principal.capabilities
