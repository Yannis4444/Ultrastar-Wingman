"""The `users`, `sessions` and `role_permissions` tables.

No foreign keys: SQLite only enforces them when `PRAGMA foreign_keys` is on, which it is
not here, so a decorative constraint would be worse than none — the service deletes a
user's sessions and unlinks their player explicitly.
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
    """An account. `role` is one of `permissions.ROLES`; the capabilities behind it are
    data (`role_permissions`), not code."""

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
    role: Mapped[str] = mapped_column(String(16))
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


class RolePermission(Base):
    """One capability granted to one role. Editable at runtime, hence a table and not a
    constant — the defaults are seeded by migration 0006."""

    __tablename__ = "role_permissions"

    role: Mapped[str] = mapped_column(String(16), primary_key=True)
    capability: Mapped[str] = mapped_column(String(64), primary_key=True)
