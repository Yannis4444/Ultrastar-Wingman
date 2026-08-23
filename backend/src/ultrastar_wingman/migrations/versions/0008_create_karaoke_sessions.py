"""create karaoke_sessions, attach sings to them, seed the statistics capabilities

Revision ID: 0008
Revises: 0007

Sessions become recorded rows instead of something re-derived from the sing history on
every restart (the old app's ids were array indexes, so they shifted under the UI). The
existing sings are grouped once, here, by the same 6-hour-gap rule the runtime uses —
spelled out literally, like the capability seeds below: a migration must keep producing
the same database after the module's constants change.
"""

import uuid
from datetime import timedelta

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | None = None
depends_on: str | None = None

# Mirrors `karaoke.model.SESSION_GAP`.
SESSION_GAP = timedelta(hours=6)

_STATS = ("stats.view",)
_MANAGE = (*_STATS, "stats.manage")

# Everybody at the party may look at the scoreboard; naming a session is a host's job.
NEW_CAPABILITIES: dict[str, tuple[str, ...]] = {
    "guest": _STATS,
    "user": _STATS,
    "trusted": _MANAGE,
    # Stored for completeness only — the code hands admin every capability regardless.
    "admin": _MANAGE,
}

role_permissions = sa.table(
    "role_permissions", sa.column("role", sa.String), sa.column("capability", sa.String)
)

# Typed columns on purpose: without them the timestamps come back as strings.
sings = sa.table(
    "sings",
    sa.column("id", sa.String),
    sa.column("session_id", sa.String),
    sa.column("started_at", sa.DateTime(timezone=True)),
)

karaoke_sessions = sa.table(
    "karaoke_sessions",
    sa.column("id", sa.String),
    sa.column("name", sa.Text),
    sa.column("started_at", sa.DateTime(timezone=True)),
    sa.column("last_activity_at", sa.DateTime(timezone=True)),
)


def upgrade() -> None:
    op.create_table(
        "karaoke_sessions",
        sa.Column("id", sa.String(length=32), primary_key=True),
        # NULL until somebody names the party.
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        # The `started_at` of the newest sing in the session.
        sa.Column("last_activity_at", sa.DateTime(timezone=True), nullable=False),
    )
    # Nullable: SQLite rebuilds the whole table for a NOT NULL column, and the backfill
    # below fills every existing row anyway.
    op.add_column("sings", sa.Column("session_id", sa.String(length=32), nullable=True))
    op.create_index("ix_sings_session_id", "sings", ["session_id"])

    _backfill_sessions()

    op.bulk_insert(
        role_permissions,
        [
            {"role": role, "capability": capability}
            for role, capabilities in NEW_CAPABILITIES.items()
            for capability in capabilities
        ],
    )


def _backfill_sessions() -> None:
    """Group the sings that already exist into sessions by the 6-hour-gap rule.

    Ordered by `(started_at, id)` so the result does not depend on the order SQLite hands
    the rows back in.
    """
    connection = op.get_bind()
    rows = connection.execute(
        sa.select(sings.c.id, sings.c.started_at).order_by(sings.c.started_at, sings.c.id)
    ).all()
    if not rows:
        return

    groups: list[list[tuple[str, object]]] = []
    previous_started_at = None
    for sing_id, started_at in rows:
        if previous_started_at is None or started_at - previous_started_at >= SESSION_GAP:
            groups.append([])
        groups[-1].append((sing_id, started_at))
        previous_started_at = started_at

    for group in groups:
        session_id = uuid.uuid4().hex
        connection.execute(
            karaoke_sessions.insert().values(
                id=session_id,
                name=None,
                started_at=group[0][1],
                last_activity_at=group[-1][1],
            )
        )
        connection.execute(
            sings.update()
            .where(sings.c.id.in_([sing_id for sing_id, _ in group]))
            .values(session_id=session_id)
        )


def downgrade() -> None:
    op.execute(
        role_permissions.delete().where(role_permissions.c.capability.in_(sorted(set(_MANAGE))))
    )
    op.drop_index("ix_sings_session_id", table_name="sings")
    op.drop_column("sings", "session_id")
    op.drop_table("karaoke_sessions")
