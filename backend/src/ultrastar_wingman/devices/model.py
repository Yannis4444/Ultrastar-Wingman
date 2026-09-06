"""The `devices` and `player_cards` tables.

A device row is what the host configured: its name, the token it authenticates with, and
the mapping from reader and button positions onto what they mean. What lies on the readers
right now is not a column — it is live state in `service.py`, gone with the process, because
a card on a reader is a person standing in the room and not a fact about the database.

The two things the row does remember of a report are `reader_states` — which positions
answered at the last boot probe — and `button_positions`, which buttons the build has. The
mapping page has to be usable while the device is unplugged: refusing a role on a reader that
is not wired needs to know which readers are wired, and a button whose action is *nothing* is
still a row to be drawn, which no other column would say.

No foreign keys, like the rest of the schema (see the note in `tags/model.py`): SQLite only
enforces them with `PRAGMA foreign_keys` on, which Wingman does not set. `player_cards`
declares the reference anyway, for the reader of the schema, and the cards of a deleted
player are removed by `players.service.delete_player` calling into this module.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base

# What a reader can be told to be:
#
# * `slot:<color>` — one reader per singer slot. A card lying on it *is* the singer on that
#   color, and lifting it takes them off.
# * `sequential` — one reader everybody scans in turn; each scan fills the next free slot.
# * `unused` — a wired reader the host wants nothing from.
SEQUENTIAL = "sequential"
UNUSED = "unused"
SLOT_PREFIX = "slot:"

# What a button can be told to do. `none` is a wired button with nothing on it.
BUTTON_ACTIONS: tuple[str, ...] = ("start", "clear", "cancel", "none")

# The token a device carries, `wd_` and 20 bytes of randomness as hex. Prefixed so a token
# found in a log or in a device's flash is recognisable as Wingman's own.
TOKEN_PREFIX = "wd_"
TOKEN_BYTES = 20

MAX_NAME_LENGTH = 64


def _now() -> datetime:
    return datetime.now(UTC)


class Device(Base):
    """One player selector standing in the room."""

    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    # Not unique: two devices may honestly be called "Living room", and a name collision is
    # the host's own business. The token is what tells them apart.
    name: Mapped[str] = mapped_column(Text)
    # sha256 of the bearer token, exactly like a session's — the raw token is readable once,
    # when the device is created or its token is rotated, and never again.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # When the last report arrived. Persisted so the admin page can say "last seen
    # yesterday" after a restart; `online` is decided by the live state, not by this.
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    firmware_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # The protocol version of the last report, whether or not Wingman speaks it: that is
    # what makes an incompatible device show up as one that needs updating.
    protocol: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # JSON objects keyed by the position as a string, because JSON has no integer keys:
    # `{"0": "wired", "2": "fault"}`, `{"0": "slot:blue"}`, `{"1": "start"}`. Text and not
    # a JSON column, like `settings.value`: nothing queries into them in SQL.
    reader_states: Mapped[str] = mapped_column(Text, default="{}")
    reader_roles: Mapped[str] = mapped_column(Text, default="{}")
    button_actions: Mapped[str] = mapped_column(Text, default="{}")
    # The button positions of the last report, as a JSON array: `[0, 1, 2, 3]`. A list and
    # not an object because a button has no state to remember — only whether the build has
    # one. Without it a button set to *nothing* would have nowhere to be listed from while
    # the device is quiet, and its row would go missing from the page that set it.
    button_positions: Mapped[str] = mapped_column(Text, default="[]")


class PlayerCard(Base):
    """One card, and who it belongs to. Several cards per player is the point: a fob on a
    keyring and a card in a wallet are the same singer."""

    __tablename__ = "player_cards"

    # The uid as the reader read it, uppercase hex. The card *is* the key: assigning a card
    # that already belongs to somebody moves it, which is what happens when a card is
    # handed on to the next guest.
    uid: Mapped[str] = mapped_column(String(20), primary_key=True)
    player_id: Mapped[str] = mapped_column(ForeignKey("players.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
