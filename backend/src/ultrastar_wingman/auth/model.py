"""The `users` and `sessions` tables, and the permission groups: `groups`,
`group_capabilities` and `user_groups` (docs/dev/permission-groups.md §2).

No foreign keys: SQLite only enforces them when `PRAGMA foreign_keys` is on, which it is
not here, so a decorative constraint would be worse than none — the service deletes a
user's sessions and memberships and unlinks their player explicitly, deleting a group
deletes its rows, and every reader treats a row naming a group that is gone as giving
nothing.
"""

import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


def as_utc(value: datetime) -> datetime:
    """A stored timestamp as an aware UTC datetime.

    SQLAlchemy's `DateTime(timezone=True)` is a no-op on SQLite: the offset is dropped on
    write, so everything read back is naive. Every value we write is UTC, so attaching it
    back is correct — and comparing naive with aware would raise.
    """
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


class User(Base):
    """An account. It is in User without a row and in every group a `user_groups` row puts
    it in; the capabilities behind those groups are data (`group_capabilities`), not code."""

    __tablename__ = "users"
    # Usernames are unique case-insensitively, exactly like player names (same ASCII-only
    # fold — see the comment on the players index).
    __table_args__ = (
        Index("ix_users_username_lower", text("lower(username)"), unique=True),
        # SQLite counts every NULL as distinct in a unique index, so the local accounts do
        # not collide over their empty subject.
        Index("ix_users_oidc_subject", "oidc_subject", unique=True),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    username: Mapped[str] = mapped_column(Text)
    # NULL for an account that has no password: an OIDC account authenticates at its provider.
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # Which `providers.PROVIDERS` entry this account belongs to. The username stays the
    # identity inside Wingman; for an OIDC account the provider's `sub` is the identity
    # outside it, because a username at the provider can be reassigned.
    auth_provider: Mapped[str] = mapped_column(Text, default="local")
    oidc_subject: Mapped[str | None] = mapped_column(Text, nullable=True)


class UserSession(Base):
    """A logged-in browser. The raw token never touches the database — only its sha256, so
    a stolen database dump cannot be replayed as a cookie."""

    __tablename__ = "sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    # Null for a host session: the host UI is trusted by device, not by account.
    user_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_host: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Group(Base):
    """A bundle of capabilities people can be put in. The three built-ins (`guest`, `user`,
    `admin`) are rows too, so their names reserve themselves in the name index; whether a
    group is built in is read off its id (`permissions.BUILT_IN_GROUPS`), never stored."""

    __tablename__ = "groups"
    # Unique case-insensitively, exactly like tags, usernames and player names (the same
    # ASCII-only fold): "admin" is refused because the built-in row is called "Admin".
    __table_args__ = (Index("ix_groups_name_lower", text("lower(name)"), unique=True),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid.uuid4().hex)
    name: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GroupCapability(Base):
    """One capability granted to one group. Editable at runtime, hence a table and not a
    constant. Admin has no rows: it holds every capability by rule."""

    __tablename__ = "group_capabilities"

    group_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    capability: Mapped[str] = mapped_column(String(64), primary_key=True)


class UserGroup(Base):
    """One account in one group. Never a row for `user` (every account is in it) or `guest`
    (nobody with an account is)."""

    __tablename__ = "user_groups"

    user_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    # Indexed for the member counts; the primary key's leading column serves the per-request
    # read of one account's groups.
    group_id: Mapped[str] = mapped_column(String(32), primary_key=True, index=True)
