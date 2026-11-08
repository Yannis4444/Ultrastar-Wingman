"""The `players` table: who sings. IDs are opaque so display names stay renameable."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base

# The two values of `Player.avatar_source`.
AVATAR_MANUAL = "manual"
AVATAR_OIDC = "oidc"


def _now() -> datetime:
    return datetime.now(UTC)


class Player(Base):
    """One player. Temporary (unregistered) players are persisted too — the old app kept them
    in memory and lost every guest on restart."""

    __tablename__ = "players"
    # Names are unique case-insensitively. SQLite's lower() folds ASCII only, so "Jörg" and
    # "jörg" can coexist — acceptable, unicode case folding is not worth a custom collation.
    __table_args__ = (Index("ix_players_name_lower", text("lower(name)"), unique=True),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    name: Mapped[str] = mapped_column(Text)
    # True exactly when `user_id` is set: the player belongs to an account. Deleting the
    # account unlinks the player (it becomes a temporary one again) instead of deleting it.
    registered: Mapped[bool] = mapped_column(Boolean, default=False)
    user_id: Mapped[str | None] = mapped_column(String(32), nullable=True, unique=True)
    # Put out of sight for the evening: the player is gone from the singer picker, and their
    # account's wishes from the shared wishlist and every spin pool (filtered, never deleted:
    # `library.service._counted`) — every score, session and statistic still names them.
    # Logging in clears it again, so somebody hidden after they went home is back, wishes and
    # all, the moment they return.
    hidden: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"))
    # Absolute path of the stored avatar image, `<data_dir>/avatars/<id>.<ext>`.
    avatar_file: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Where the picture in `avatar_file` came from: `manual` (somebody uploaded it) or `oidc`
    # (the identity provider's picture, taken at a single sign-on login). A login replaces
    # the picture only while there is none or it is the provider's own, so a hand-picked one
    # always wins. `manual` while there is no picture at all, which the rule reads as "none".
    avatar_source: Mapped[str] = mapped_column(
        Text, default=AVATAR_MANUAL, server_default=text(f"'{AVATAR_MANUAL}'")
    )
    # For an `oidc` picture: the address it was downloaded from and the `ETag` that answer
    # carried, so the next login asks the provider "has it changed?" instead of downloading
    # the same file again. NULL for a picture that was uploaded.
    avatar_source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_source_etag: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
