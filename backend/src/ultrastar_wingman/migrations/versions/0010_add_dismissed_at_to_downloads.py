"""mark a download as read

Revision ID: 0010
Revises: 0009

Without this the download panel only ever grew: a failure from weeks ago stayed on the
screen and kept the header button red. A dismissed row leaves the panel and becomes
prunable, which is what bounds the table.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # Nullable and unindexed on purpose: the queue is small, and every query that reads the
    # column already filters on the indexed `status` or scans the few newest rows.
    op.add_column("downloads", sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("downloads", "dismissed_at")
