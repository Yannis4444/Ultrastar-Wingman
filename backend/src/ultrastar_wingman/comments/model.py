"""The `song_comments` table: what one account said about one song.

No foreign keys, like the rest of the schema: SQLite only enforces them with
`PRAGMA foreign_keys` on, which Wingman does not set. A comment on a song that left the
library is left alone rather than deleted, so a `usdb:1234` that comes back keeps what was
said about it; the read joins `songs` through `song_or_404` and never reaches an orphan.

A comment always belongs to an account — the host screen is an administrator but nobody,
and an anonymous guest may read the list but not write to it — so `user_id` is NOT NULL.
`comments.service.delete_user_data` takes the rows with the account.
"""

from datetime import UTC, datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base

# The longest a comment may get. Long enough for a story about the song, short enough that
# the modal stays a modal.
MAX_BODY_LENGTH = 1000


def _now() -> datetime:
    return datetime.now(UTC)


class SongComment(Base):
    """One comment. There is no editing in v1: a comment is said, or it is deleted."""

    __tablename__ = "song_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    song_id: Mapped[str] = mapped_column(String(64), index=True)
    # Who said it. Never NULL — see the module docstring.
    user_id: Mapped[str] = mapped_column(String(32), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
