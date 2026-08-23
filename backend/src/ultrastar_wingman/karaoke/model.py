"""The `karaoke_sessions`, `sings` and `scores` tables: Wingman's own record of who
sang what.

This is the source of truth for statistics from now on. USDX's `Ultrastar.db` is
only an ingestion source — it cannot tell two runs of the same song apart, which
is why the old app's statistics were guesswork.
"""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base

# A sing joins the newest session while that session has been idle for less than this, and
# opens a new one otherwise. The old app re-derived the same 6-hour rule over the whole
# history on every restart, which made session ids (array indexes) shift under the UI.
SESSION_GAP = timedelta(hours=6)


def _now() -> datetime:
    return datetime.now(UTC)


class KaraokeSession(Base):
    """One party: the sings that happened without a long break between them.

    Recorded when a song starts, never inferred at read time, so the id stays stable and
    the host can name it ("Yannis' birthday").
    """

    __tablename__ = "karaoke_sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # When the last sing of this session started. Bumped on every attachment; what the
    # `SESSION_GAP` rule compares against.
    last_activity_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Sing(Base):
    """One run of one song. `ended_at` stays NULL if Wingman went down mid-song —
    what a stale open sing means is a statistics question, decided in phase 6."""

    __tablename__ = "sings"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    # Not a foreign key: statistics must survive a song leaving the library.
    song_id: Mapped[str] = mapped_column(String(64), index=True)
    # Nullable only because migration 0008 added the column to existing rows; every sing
    # Wingman records from now on belongs to a session.
    session_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Score(Base):
    """One score USDX awarded during a sing."""

    __tablename__ = "scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Declared for documentation; SQLite does not enforce foreign keys without a pragma.
    sing_id: Mapped[str] = mapped_column(ForeignKey("sings.id"), index=True)
    # NULL when the name USDX scored under matched no launched slot. Not enforced as a
    # foreign key (SQLite checks none by default), so `player_name` is the durable label.
    player_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    player_name: Mapped[str] = mapped_column(Text)
    score: Mapped[int] = mapped_column(Integer)
    difficulty: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
