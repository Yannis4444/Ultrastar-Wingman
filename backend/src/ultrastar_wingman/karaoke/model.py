"""The `karaoke_sessions`, `sings` and `scores` tables: Wingman's own record of who
sang what.

This is the source of truth for statistics from now on. USDX's `Ultrastar.db` is
only an ingestion source — it cannot tell two runs of the same song apart, which
is why the old app's statistics were guesswork.
"""

import uuid
from collections.abc import Sequence
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
    # Where this score came in among the scores of its own sing, `1` being the best, and how
    # many scores that sing had. Written once, when the sing's scores are imported, and never
    # touched again — that is the whole point of storing them (see `placements` below):
    # deleting or reassigning one score of a sing months later must not be able to rewrite
    # who won it at the time. They are therefore a snapshot and not a derived value, and a
    # score list that has since lost a row still knows what the field was.
    #
    # Both NULL for a score recorded before migration 0026 that the backfill could not reach,
    # and for anything else that cannot say — never 0. `field_size` is what tells a solo sing
    # (`1`) from a win (`>= 2` with `placement == 1`); without it the two are the same row.
    placement: Mapped[int | None] = mapped_column(Integer, nullable=True)
    field_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


def placements(scores: Sequence[int]) -> list[int]:
    """The placement of each score among them, `1` being the best.

    Standard competition ranking: a score's placement is how many scores beat it, plus one.
    Two singers tied for the top are both `1` and the next one is `3` — "nobody came second"
    is the truth of what happened, and the dense alternative (1, 1, 2) would say that the
    third singer came second to two people who did not.

    Pure, and here beside the columns it fills, because migration 0026 backfills the same
    rule in SQL: the two have to agree, or a party's history would rank differently from the
    evening that follows it.
    """
    return [1 + sum(1 for other in scores if other > score) for score in scores]
