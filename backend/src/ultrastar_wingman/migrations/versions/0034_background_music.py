"""the three capabilities the background music is read and run by

Revision ID: 0034
Revises: 0033

No table. What the background music is doing right now — which song, how far in, which host
tab is making the sound — is module state in `music.service`, for the same reason the running
sing is: there is one pair of speakers in the room, and none of it should outlive the process.
What the host configures is settings rows, which need no schema of their own either.

So this revision is the seed and nothing else. `music.view` is a guest's, because what is
playing is the room's own soundtrack; `music.control` is an account's, because pausing or
skipping changes what everybody hears; `music.manage` is a helper's, because switching the
music on and choosing what it plays from is a decision about the evening.

`admin` is seeded too, although the code hands it every capability regardless: the test that
proves this table and `permissions.DEFAULT_ROLE_CAPABILITIES` never drift reads the rows for
every role, `admin` included.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0034"
down_revision: str | None = "0033"
branch_labels: str | None = None
depends_on: str | None = None

VIEW = "music.view"
CONTROL = "music.control"
MANAGE = "music.manage"

CAPABILITIES: tuple[str, ...] = (VIEW, CONTROL, MANAGE)

# role -> the capabilities it is seeded with. Roles are bundles and not a ladder, so every
# grant is spelled out per role.
SEEDED: dict[str, tuple[str, ...]] = {
    "guest": (VIEW,),
    "user": (VIEW, CONTROL),
    "trusted": (VIEW, CONTROL, MANAGE),
    "admin": (VIEW, CONTROL, MANAGE),
}

_SEED = sa.text(
    "INSERT INTO role_permissions (role, capability) "
    "SELECT :role, :capability WHERE NOT EXISTS ("
    "SELECT 1 FROM role_permissions WHERE role = :role AND capability = :capability)"
)

role_permissions = sa.table(
    "role_permissions", sa.column("role", sa.String), sa.column("capability", sa.String)
)


def upgrade() -> None:
    for role, capabilities in SEEDED.items():
        for capability in capabilities:
            op.execute(_SEED.bindparams(role=role, capability=capability))


def downgrade() -> None:
    op.execute(role_permissions.delete().where(role_permissions.c.capability.in_(CAPABILITIES)))
