"""Reading and writing song comments. Knows nothing about FastAPI.

Who may write and who may delete is decided in `api.py` (a capability in the decorator, an
author-or-moderator dependency for the delete); this module is handed the answer as the
plain `viewer_id` / `can_moderate` pair, the same split `tags.service` uses for its
`Viewer`.
"""

import logging
from collections.abc import Collection, Sequence

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.model import User, as_utc
from ..events import CommentsChanged, event_bus
from ..players.model import Player
from ..players.schema import avatar_version
from .model import SongComment
from .schema import CommentAuthor, CommentRead

logger = logging.getLogger(__name__)

MODERATE_CAPABILITY = "comments.moderate"


async def _authors(session: AsyncSession, user_ids: Collection[str]) -> dict[str, CommentAuthor]:
    """user id -> who to draw beside their comments. An account with no row is simply
    absent, which reads as "the account is gone"."""
    if not user_ids:
        return {}
    rows = await session.execute(
        select(User, Player)
        # Outer: an account that never sang has no player, and so no picture.
        .outerjoin(Player, Player.user_id == User.id)
        .where(User.id.in_(user_ids))
    )
    return {
        user.id: CommentAuthor(
            user_id=user.id,
            username=user.username,
            player_id=None if player is None else player.id,
            avatar_version=None if player is None else avatar_version(player.avatar_file),
        )
        for user, player in rows
    }


def _read(
    comment: SongComment,
    authors: dict[str, CommentAuthor],
    viewer_id: str | None,
    can_moderate: bool,
) -> CommentRead:
    mine = viewer_id is not None and comment.user_id == viewer_id
    return CommentRead(
        id=comment.id,
        song_id=comment.song_id,
        body=comment.body,
        # Naive coming out of SQLite; everything we write is UTC (see `as_utc`).
        created_at=as_utc(comment.created_at),
        author=authors.get(comment.user_id),
        mine=mine,
        can_delete=mine or can_moderate,
    )


async def comments_for(session: AsyncSession, song_id: str) -> Sequence[SongComment]:
    """One song's comments, oldest first — a conversation reads down the page. The id
    breaks ties, so two comments stamped the same second keep a stable order."""
    result = await session.scalars(
        select(SongComment)
        .where(SongComment.song_id == song_id)
        .order_by(SongComment.created_at, SongComment.id)
    )
    return result.all()


async def read_comments(
    session: AsyncSession, song_id: str, viewer_id: str | None, can_moderate: bool
) -> list[CommentRead]:
    rows = await comments_for(session, song_id)
    authors = await _authors(session, {row.user_id for row in rows})
    return [_read(row, authors, viewer_id, can_moderate) for row in rows]


async def read_comment(
    session: AsyncSession, comment: SongComment, viewer_id: str | None, can_moderate: bool
) -> CommentRead:
    return _read(comment, await _authors(session, [comment.user_id]), viewer_id, can_moderate)


async def count_for(session: AsyncSession, song_id: str) -> int:
    return (
        await session.scalar(
            select(func.count()).select_from(SongComment).where(SongComment.song_id == song_id)
        )
        or 0
    )


async def get_comment(session: AsyncSession, comment_id: int) -> SongComment | None:
    return await session.get(SongComment, comment_id)


async def add_comment(session: AsyncSession, song_id: str, user_id: str, body: str) -> SongComment:
    comment = SongComment(song_id=song_id, user_id=user_id, body=body)
    session.add(comment)
    await session.commit()
    logger.debug("comment %s added to song '%s'", comment.id, song_id)
    await _announce(session, song_id)
    return comment


async def delete_comment(session: AsyncSession, comment: SongComment) -> None:
    song_id = comment.song_id
    await session.delete(comment)
    await session.commit()
    await _announce(session, song_id)


async def _announce(session: AsyncSession, song_id: str) -> None:
    """After the commit, so the count on the wire is the one a listener would read back."""
    await event_bus.broadcast(
        CommentsChanged(song_id=song_id, count=await count_for(session, song_id))
    )


async def delete_user_data(session: AsyncSession, user_id: str) -> None:
    """Drop what this account said.

    Unlike a score's player or a `song_tags` row's author, a comment *is* the person: it
    carries their name and their words, so it leaves with the account rather than turning
    into an unattributed one.

    Does not commit — `auth.service.delete_user` removes the account in the same
    transaction, so a half-deleted user cannot exist. No event either: the comment counts
    of every song that account touched would each need one, and every open song modal
    refetches after the account list changes anyway.
    """
    await session.execute(delete(SongComment).where(SongComment.user_id == user_id))
