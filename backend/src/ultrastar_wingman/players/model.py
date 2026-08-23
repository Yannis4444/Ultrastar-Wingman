"""The `players` table: who sings. IDs are opaque so display names stay renameable."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


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
    # Accounts arrive in phase 4; nothing sets this to true yet.
    registered: Mapped[bool] = mapped_column(Boolean, default=False)
    # Absolute path of the stored avatar image, `<data_dir>/avatars/<id>.<ext>`.
    avatar_file: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
