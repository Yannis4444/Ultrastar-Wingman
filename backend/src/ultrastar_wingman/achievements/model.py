"""The `achievements` and `player_achievements` tables.

An achievement is presentation (name, description, icon, colour, the three flags) plus one
JSON `definition`: the list of conditions — all of which must hold, or any one of them, as
`combine` says. The definition is never
queried in SQL — it is evaluated in Python against the scores a player already has
(`evaluate.py`), so a table per condition would buy nothing and cost a migration every time
an operator is added. The same JSON is what the export archive carries, which is what makes
export → hand-edit → import a round trip.

No foreign keys, like the rest of the schema (see the note in `tags/model.py`): SQLite only
enforces them with a pragma Wingman does not set, and a `player_achievements` row names a
player id that is not a foreign key anywhere else either — `scores.player_id` is the same
kind of loose reference.
"""

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base

# An achievement is drawn beside the tags, so it is drawn in the same four colours. Imported
# rather than re-declared: two lists of colour names would drift, and the CSS behind them is
# one set of classes.
from ..tags.model import TAG_COLORS

__all__ = ["TAG_COLORS", "Achievement", "PlayerAchievement"]


def _now() -> datetime:
    return datetime.now(UTC)


class Achievement(Base):
    """One achievement. `built_in` marks the ones Wingman ships: they may be edited and
    switched off like any other, but not deleted, so an instance always has the set the
    import format's stable slug ids name.

    `enabled` is what a pass looks at — a disabled achievement is evaluated for nobody and
    its `player_achievements` rows are dropped, so switching it back on is a recomputation
    and never a stale badge.
    """

    __tablename__ = "achievements"

    # A uuid4 hex for one somebody made, a stable slug (`builtin-score-9000`) for one Wingman
    # ships — import matches by id, and a slug is what lets a built-in be recognised across
    # instances. Wider than a tag's 32 hex characters for exactly that reason.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    # May be empty: not every badge needs a sentence under its name.
    description: Mapped[str] = mapped_column(Text, default="", server_default=text("''"))
    # An `ICON_PATHS` key in the frontend, exactly like `tags.icon`. Validated by shape only
    # — the backend has no list of the icons the UI ships, and an unknown one draws nothing.
    icon: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Absolute path of an uploaded image, which replaces the glyph when it is set.
    icon_file: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str] = mapped_column(String(16))
    # Its name, description and icon are kept from anybody who has not earned it — enforced
    # by the API, because a client that ignored the flag would spoil every surprise.
    hidden: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("1"))
    built_in: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("0"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    # The conditions, in the shape `schema.Condition` describes. Typed as plain JSON here
    # and parsed on the way out: the column is storage, and one row somebody hand-edited
    # into a shape the models refuse must not break the pass for every other achievement.
    definition: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    # How the conditions combine: `all` of them have to hold, or `any` one is enough
    # (`schema.Combine`). Its own column rather than a second shape of `definition`, so the
    # definition stays the one list it has always been — in the API, in an archive and in
    # every row written before migration 0038, which reads `all` and means what it meant.
    # Parsed on the way out like the definition (`schema.parse_combine`): a value somebody
    # wrote straight into the database is "never satisfied", never an exception.
    combine: Mapped[str] = mapped_column(String(8), default="all", server_default=text("'all'"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class PlayerAchievement(Base):
    """What one player has reached on one achievement.

    A row exists for every (enabled achievement, player who has at least one score) — a
    player who never sang has none at all, rather than a full set of empty ones. So a row
    is not a badge: `earned_at` is NULL while it carries progress only.

    Players, not accounts: `scores.player_id` is what an achievement is keyed on, so a guest
    who sang tonight earns badges the host screen can show and a registered account sees
    them through its player.
    """

    __tablename__ = "player_achievements"

    achievement_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    player_id: Mapped[str] = mapped_column(String(32), primary_key=True, index=True)
    # NULL until it is earned, and NULL again when a recomputation says it no longer holds —
    # revoking is what makes a mis-attributed score fully correctable.
    earned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The party a session-scoped achievement was earned in. NULL for a global-only one, which
    # was earned over the whole record and belongs to no single party.
    session_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Where the player stands on the achievement's least complete condition — its most
    # complete one when the conditions combine as `any`. Both NULL when
    # no condition of it is progressible (see `evaluate._progress`) — there is no progressing
    # toward *fewer*, and a bar that fills as somebody gets worse would be a lie.
    progress_current: Mapped[int | None] = mapped_column(Integer, nullable=True)
    progress_target: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # The party `progress_current` was counted in, when it came from a session-scoped
    # condition — the party that satisfied it, or the player's newest party at the time of
    # the pass while none has. NULL when the progress is a global condition's, which belongs
    # to no single party.
    #
    # Stored because the engine has no clock: `achievements.api` compares this against the
    # party that is still going, and answers 0 for a number counted at a party that is over.
    # That is what makes a "ten songs in one evening" bar read 0 of 10 the next morning
    # without a pass having to run at midnight.
    progress_session_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
