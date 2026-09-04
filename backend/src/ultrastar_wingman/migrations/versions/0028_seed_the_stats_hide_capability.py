"""seed the stats.hide capability

Revision ID: 0028
Revises: 0027

`stats.hide` takes a party out of the Scores page's picker for everybody in the room, a
guest's phone included, so it is seeded for `admin` and for nobody else — the same reasoning
as `songs.delete` (0018), `stats.moderate` (0020) and `achievements.manage` (0024). It is
fully reversible and reaches that one list, so `trusted` is a defensible home for it; which
evenings the room still gets to look at is the host's call all the same, and handing it over
is one row in the permissions table afterwards. What a migration writes is only where a fresh
database starts.

`admin` gets a row even though the code hands an administrator every capability regardless:
`test_permissions.test_the_migration_seeds_the_module_defaults` reads `role_permissions` and
compares it against `DEFAULT_ROLE_CAPABILITIES`, which includes admin. The grant is written
out literally, exactly like 0006 to 0024 — a migration has to keep producing the same
database after the module's defaults change. Insert-if-missing, so re-running against a
hand-edited database cannot duplicate the row.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0028"
down_revision: str | None = "0027"
branch_labels: str | None = None
depends_on: str | None = None

HIDE = "stats.hide"

# role -> the capabilities it is seeded with. Roles are bundles and not a ladder, so every
# grant is spelled out per role.
SEEDED: dict[str, tuple[str, ...]] = {"admin": (HIDE,)}

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
    op.execute(role_permissions.delete().where(role_permissions.c.capability == HIDE))
