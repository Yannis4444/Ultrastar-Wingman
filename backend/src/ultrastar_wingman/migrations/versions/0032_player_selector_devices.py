"""the player selector's tables, and the capability that configures them

Revision ID: 0032
Revises: 0031

Two tables. `devices` is a player selector standing in the room: its name, the hash of the
bearer token it reports with, and the mapping from reader and button positions onto what
they mean. What lies on the readers is deliberately not a column: it is a person standing in
the room, and it lives in `devices.service` for as long as the process does. `reader_states`
and `button_positions` are what a report leaves behind, so the mapping page works on a device
that is unplugged: a role on a reader that never answered is refused, and a button set to
*nothing* is still drawn as the row it is.

`player_cards` is the card table: a uid, uppercase hex as the reader read it, and the player
it belongs to. Several cards per player is the point (a fob on a keyring and a card in a
wallet are the same singer), which is why the uid is the key and the player is not. The
foreign key is declared for the reader of the schema; SQLite only enforces one with
`PRAGMA foreign_keys`, which Wingman does not set, so `players.service.delete_player` drops
the cards itself.

`devices.manage` is seeded for `admin` and for nobody else, the same reasoning as
`songs.delete` (0018), `stats.moderate` (0020), `achievements.manage` (0024) and `stats.hide`
(0028): the token this capability mints is a standing key to the report endpoint, and the
reader mapping decides which card puts which person on the TV. Handing that out is handing
out the room's singer selection, which is the host's own machine.

`admin` gets a row even though the code hands an administrator every capability regardless:
`test_permissions.test_the_migration_seeds_the_module_defaults` reads `role_permissions` and
compares it against `DEFAULT_ROLE_CAPABILITIES`, admin included. Insert-if-missing, so
re-running against a hand-edited database cannot duplicate the row.
"""

import sqlalchemy as sa
from alembic import op

revision: str = "0032"
down_revision: str | None = "0031"
branch_labels: str | None = None
depends_on: str | None = None

MANAGE = "devices.manage"

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
    op.create_table(
        "devices",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("firmware_version", sa.String(length=32), nullable=True),
        sa.Column("protocol", sa.Integer(), nullable=True),
        sa.Column("reader_states", sa.Text(), nullable=False),
        sa.Column("reader_roles", sa.Text(), nullable=False),
        sa.Column("button_actions", sa.Text(), nullable=False),
        sa.Column("button_positions", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_devices_token_hash"), "devices", ["token_hash"], unique=True)
    op.create_table(
        "player_cards",
        sa.Column("uid", sa.String(length=20), nullable=False),
        sa.Column("player_id", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["player_id"], ["players.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("uid"),
    )
    op.create_index(op.f("ix_player_cards_player_id"), "player_cards", ["player_id"], unique=False)
    for role, capabilities in SEEDED.items():
        for capability in capabilities:
            op.execute(_SEED.bindparams(role=role, capability=capability))


def downgrade() -> None:
    op.execute(role_permissions.delete().where(role_permissions.c.capability == MANAGE))
    op.drop_index(op.f("ix_player_cards_player_id"), table_name="player_cards")
    op.drop_table("player_cards")
    op.drop_index(op.f("ix_devices_token_hash"), table_name="devices")
    op.drop_table("devices")
