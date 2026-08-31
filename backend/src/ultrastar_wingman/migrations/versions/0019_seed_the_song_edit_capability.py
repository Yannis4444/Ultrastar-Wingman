"""seed the songs.edit capability

Revision ID: 0019
Revises: 0018

Editing a song's metadata rewrites the headers of its `.txt` — never the lyrics, never the
media, and nothing it does is a deletion — so `songs.edit` is seeded for `trusted` and
`admin`: the two roles that may already put songs into the library are the ones who may fix
the ones that came in wrong.

`admin` gets a row even though the code hands an administrator every capability regardless:
`test_permissions.test_the_migration_seeds_the_module_defaults` reads `role_permissions` and
compares it against `DEFAULT_ROLE_CAPABILITIES`, which includes admin. Every grant is
written out literally, exactly like 0006 to 0018 — a migration has to keep producing the
same database after the module's defaults change. Insert-if-missing, so re-running against a
hand-edited database cannot duplicate the row.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | None = None
depends_on: str | None = None

EDIT = "songs.edit"

# role -> the capabilities it is seeded with. Roles are bundles and not a ladder, so every
# grant is spelled out per role.
SEEDED: dict[str, tuple[str, ...]] = {"trusted": (EDIT,), "admin": (EDIT,)}

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
    op.execute(role_permissions.delete().where(role_permissions.c.capability == EDIT))
