"""seed the achievements.manage capability

Revision ID: 0024
Revises: 0023

An achievement is written once and earned by the whole room, so `achievements.manage` is
seeded for `admin` and for nobody else — the same reasoning as `songs.delete` (0018) and
`stats.moderate` (0020). Editing a definition mid-party revokes badges from people who did
nothing wrong, and a `hidden` one only stays a surprise while the few who may read it keep
it. The host can still hand it to `trusted` in the permissions table afterwards; what a
migration writes is only where a fresh database starts.

`admin` gets a row even though the code hands an administrator every capability regardless:
`test_permissions.test_the_migration_seeds_the_module_defaults` reads `role_permissions` and
compares it against `DEFAULT_ROLE_CAPABILITIES`, which includes admin. The grant is written
out literally, exactly like 0006 to 0023 — a migration has to keep producing the same
database after the module's defaults change. Insert-if-missing, so re-running against a
hand-edited database cannot duplicate the row.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0024"
down_revision: str | None = "0023"
branch_labels: str | None = None
depends_on: str | None = None

MANAGE = "achievements.manage"

# role -> the capabilities it is seeded with. Roles are bundles and not a ladder, so every
# grant is spelled out per role.
SEEDED: dict[str, tuple[str, ...]] = {"admin": (MANAGE,)}

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
    op.execute(role_permissions.delete().where(role_permissions.c.capability == MANAGE))
