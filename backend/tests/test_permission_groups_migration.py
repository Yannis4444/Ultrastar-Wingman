"""Migration 0039 — roles become permission groups — run over a database that already holds
accounts, edited role rows and tag rows (docs/dev/permission-groups.md §8).

Every other test reaches the schema through `run_migrations` on a fresh database, where every
table is empty and every role row is the module's default. The host meets this revision on a
`0038` database whose roles they may have edited by hand, so that is what is built here:

- the rights of every caller before and after, row by row of §8.3 — nobody loses one, and a
  helper whose Trusted bundle was not a superset of User's gains what User held;
- the tag rows for `admin` and for a role string no caller ever matched, deleted;
- the three indexes the two rebuilds have to recreate by hand;
- the revision run again over the empty `groups` table a failure halfway leaves (§8.1);
- and the best-effort downgrade.
"""

import asyncio
import sqlite3
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from ultrastar_wingman.auth import groups as auth_groups
from ultrastar_wingman.auth import permissions
from ultrastar_wingman.auth.permissions import (
    ALL_CAPABILITIES,
    DEFAULT_GROUP_CAPABILITIES,
    GUEST,
    TRUSTED_GROUP_ID,
    USER,
)
from ultrastar_wingman.db import migrations_dir

BROKEN_TAG_ID = "9f95e47cdadc42a59273e16d7b0e5ace"
TAG_ID = "c0ffee00c0ffee00c0ffee00c0ffee00"

# The host's own edits to the role table before the update: Guest may also read the download
# queue, User may no longer stop a song, and Trusted lost `karaoke.stop` too — while User
# keeps `music.control` that Trusted had taken away, which is the non-nested case.
GUEST_ROWS = DEFAULT_GROUP_CAPABILITIES["guest"] | {"downloads.view"}
USER_ROWS = DEFAULT_GROUP_CAPABILITIES["user"] - {"karaoke.stop"}
TRUSTED_ROWS = DEFAULT_GROUP_CAPABILITIES[TRUSTED_GROUP_ID] - {"karaoke.stop", "music.control"}

ACCOUNTS = {
    "a-admin": "admin",
    "a-trusted": "trusted",
    "a-user": "user",
    # Only a hand edit makes these two: neither was reachable through the API.
    "a-guest": "guest",
    "a-wizard": "wizard",
}

# (action, role) rows on one tag, one for each role and the two only a hand edit makes.
TAG_ROWS = [
    ("view", "guest"),
    ("view_songs", "user"),
    ("assign", "trusted"),
    ("view", "admin"),
    ("view", "wizard"),
]


def _config(database: Path) -> Config:
    config = Config()
    config.set_main_option("script_location", str(migrations_dir()))
    url = f"sqlite+aiosqlite:///{database}"
    # Alembic reads options through ConfigParser: a literal % must be escaped.
    config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    return config


async def _alembic(database: Path, revision: str, *, down: bool = False) -> None:
    """Alembic is sync and opens its own event loop, so it runs in a worker thread."""
    run = command.downgrade if down else command.upgrade
    await asyncio.to_thread(run, _config(database), revision)


def _seed_0038(database: Path) -> None:
    """Accounts in every role, the host's edited role rows, and tag rows for each role."""
    with sqlite3.connect(database) as connection:
        connection.execute("DELETE FROM role_permissions")
        rows = (
            [("guest", capability) for capability in GUEST_ROWS]
            + [("user", capability) for capability in USER_ROWS]
            + [("trusted", capability) for capability in TRUSTED_ROWS]
            # Stored for admin, never copied: Admin is a rule.
            + [("admin", "songs.view"), ("admin", "devices.manage")]
            # A role string no caller ever was.
            + [("wizard", "songs.delete")]
        )
        connection.executemany(
            "INSERT INTO role_permissions (role, capability) VALUES (?, ?)", rows
        )
        connection.executemany(
            "INSERT INTO users (id, username, password_hash, role, created_at, auth_provider) "
            "VALUES (?, ?, 'x', ?, '2026-11-01 20:00:00', 'local')",
            [(user_id, user_id, role) for user_id, role in ACCOUNTS.items()],
        )
        connection.execute(
            "INSERT INTO tags (id, name, icon, color, show_in_list, hide_by_default, created_at) "
            "VALUES (?, 'mine', NULL, 'blue', 0, 0, '2026-11-01 20:00:00')",
            (TAG_ID,),
        )
        connection.executemany(
            "INSERT INTO tag_permissions (tag_id, action, role, user_id) VALUES (?, ?, ?, NULL)",
            [(TAG_ID, action, role) for action, role in TAG_ROWS],
        )
        connection.execute(
            "INSERT INTO tag_permissions (tag_id, action, role, user_id) "
            "VALUES (?, 'view', NULL, 'a-user')",
            (TAG_ID,),
        )


def _group_rows(connection: sqlite3.Connection) -> dict[str, set[str]]:
    grouped: dict[str, set[str]] = {}
    for group_id, capability in connection.execute(
        "SELECT group_id, capability FROM group_capabilities"
    ):
        grouped.setdefault(group_id, set()).add(capability)
    return grouped


def _holds(rows: dict[str, set[str]], groups: set[str]) -> set[str]:
    """What a caller in `groups` holds by the rows alone — Admin is checked separately."""
    held: set[str] = set()
    for group_id in groups:
        held |= rows.get(group_id, set())
    return held


def _assert_upgraded(database: Path) -> None:
    """§8.3, row by row, and the shape the two rebuilds leave."""
    with sqlite3.connect(database) as connection:
        assert sorted(connection.execute("SELECT id, name FROM groups")) == sorted(
            [
                ("guest", "Guest"),
                ("user", "User"),
                ("admin", "Admin"),
                (TRUSTED_GROUP_ID, "Trusted"),
            ]
        )
        rows = _group_rows(connection)
        # Copied as they stood, the host's edits included; Admin's and the unknown role's not.
        assert rows == {"guest": GUEST_ROWS, "user": USER_ROWS, TRUSTED_GROUP_ID: TRUSTED_ROWS}

        members = set(connection.execute("SELECT user_id, group_id FROM user_groups"))
        assert members == {("a-admin", "admin"), ("a-trusted", TRUSTED_GROUP_ID)}

        # Nobody loses a right. A plain account had User's rows and still has them; a helper
        # had Trusted's and now holds User's on top — which here is a gain of `music.control`,
        # the right User kept and Trusted had been without.
        assert _holds(rows, {"user"}) == USER_ROWS
        helper = _holds(rows, {"user", TRUSTED_GROUP_ID})
        assert helper >= TRUSTED_ROWS
        assert helper - TRUSTED_ROWS == {"music.control"}
        # A caller without an account: Guest's rows, unchanged.
        assert _holds(rows, {"guest"}) == GUEST_ROWS

        columns = {row[1] for row in connection.execute("PRAGMA table_info(users)")}
        assert "role" not in columns
        tag_columns = {row[1] for row in connection.execute("PRAGMA table_info(tag_permissions)")}
        assert "role" not in tag_columns and "group_id" in tag_columns

        tag_rows = set(
            connection.execute(
                "SELECT action, group_id, user_id FROM tag_permissions WHERE tag_id = ?",
                (TAG_ID,),
            )
        )
        # `admin` (Admin sees every tag by rule) and `wizard` (matched nobody) are gone.
        assert tag_rows == {
            ("view", "guest", None),
            ("view_songs", "user", None),
            ("assign", TRUSTED_GROUP_ID, None),
            ("view", None, "a-user"),
        }
        # The seeded *broken* tag's three rows now name the Trusted id.
        broken = set(
            connection.execute(
                "SELECT action, group_id FROM tag_permissions WHERE tag_id = ?", (BROKEN_TAG_ID,)
            )
        )
        assert broken == {
            ("view", TRUSTED_GROUP_ID),
            ("view_songs", TRUSTED_GROUP_ID),
            ("assign", TRUSTED_GROUP_ID),
        }

        indexes = {
            row[0]: row[1]
            for row in connection.execute(
                "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL"
            )
        }
        assert "lower(username)" in indexes["ix_users_username_lower"]
        assert "UNIQUE" in indexes["ix_users_username_lower"]
        assert "UNIQUE" in indexes["ix_users_oidc_subject"]
        assert "ix_tag_permissions_tag_id" in indexes
        assert "lower(name)" in indexes["ix_groups_name_lower"]
        assert "ix_user_groups_group_id" in indexes
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master")}
        assert "role_permissions" not in tables

        # The new check holds: a row with neither subject is refused, as is a name that
        # clashes with a built-in in another case.
        for statement in (
            "INSERT INTO tag_permissions (tag_id, action, group_id, user_id) "
            f"VALUES ('{TAG_ID}', 'assign', NULL, NULL)",
            "INSERT INTO groups (id, name, created_at) VALUES ('x', 'ADMIN', '2026-11-01')",
            "INSERT INTO users (id, username, password_hash, created_at, auth_provider) "
            "VALUES ('dup', 'A-ADMIN', 'x', '2026-11-01', 'local')",
        ):
            try:
                connection.execute(statement)
            except sqlite3.IntegrityError:
                continue
            raise AssertionError(f"accepted: {statement}")


async def test_the_roles_become_groups_and_nobody_loses_a_right(tmp_path: Path) -> None:
    database = tmp_path / "groups.db"
    await _alembic(database, "0038")
    _seed_0038(database)

    await _alembic(database, "0039")

    _assert_upgraded(database)


async def test_the_revision_runs_again_after_a_failure_halfway(tmp_path: Path) -> None:
    """A failure leaves the step-1 `groups` table and its index committed and empty, and
    everything else as it was at 0038 (§8.1). The next start runs the revision from the top
    over that, and must land exactly where a clean run does."""
    database = tmp_path / "rerun.db"
    await _alembic(database, "0038")
    _seed_0038(database)
    with sqlite3.connect(database) as connection:
        connection.execute(
            "CREATE TABLE groups (id VARCHAR(32) NOT NULL, name TEXT NOT NULL, "
            "created_at DATETIME NOT NULL, PRIMARY KEY (id))"
        )
        connection.execute("CREATE UNIQUE INDEX ix_groups_name_lower ON groups (lower(name))")

    await _alembic(database, "0039")

    _assert_upgraded(database)


async def test_the_revision_runs_again_over_every_table_steps_one_to_three_make(
    tmp_path: Path,
) -> None:
    """The same, one step further: the three new tables and their rows are already there."""
    database = tmp_path / "rerun-more.db"
    await _alembic(database, "0038")
    _seed_0038(database)
    with sqlite3.connect(database) as connection:
        connection.execute(
            "CREATE TABLE groups (id VARCHAR(32) NOT NULL, name TEXT NOT NULL, "
            "created_at DATETIME NOT NULL, PRIMARY KEY (id))"
        )
        connection.execute("CREATE UNIQUE INDEX ix_groups_name_lower ON groups (lower(name))")
        connection.execute(
            "INSERT INTO groups VALUES ('guest', 'Guest', '2026-11-01 20:00:00.000000')"
        )
        connection.execute(
            "CREATE TABLE group_capabilities (group_id VARCHAR(32) NOT NULL, "
            "capability VARCHAR(64) NOT NULL, PRIMARY KEY (group_id, capability))"
        )
        connection.execute("INSERT INTO group_capabilities VALUES ('guest', 'songs.view')")
        connection.execute(
            "CREATE TABLE user_groups (user_id VARCHAR(32) NOT NULL, "
            "group_id VARCHAR(32) NOT NULL, PRIMARY KEY (user_id, group_id))"
        )
        connection.execute("INSERT INTO user_groups VALUES ('a-admin', 'admin')")

    await _alembic(database, "0039")

    _assert_upgraded(database)


# --- every caller's rights, the old rule against the live code ------------------------------

# The three roles `ASSIGNABLE_ROLES` let the API give an account.
API_ACCOUNTS = {"a-admin": "admin", "a-trusted": "trusted", "a-user": "user"}


def _seed_accounts(database: Path, accounts: dict[str, str]) -> None:
    with sqlite3.connect(database) as connection:
        connection.executemany(
            "INSERT INTO users (id, username, password_hash, role, created_at, auth_provider) "
            "VALUES (?, ?, 'x', ?, '2026-11-01 20:00:00', 'local')",
            [(user_id, user_id, role) for user_id, role in accounts.items()],
        )


def _rights_before(database: Path) -> dict[str | None, set[str]]:
    """Every caller's set under the old rule, read off the 0038 tables: an account held its
    role's rows, `admin` every capability in code, a caller without one `guest`'s rows.
    Keyed by account id, `None` for the caller without one."""
    with sqlite3.connect(database) as connection:
        rows: dict[str, set[str]] = {}
        for role, capability in connection.execute("SELECT role, capability FROM role_permissions"):
            rows.setdefault(role, set()).add(capability)
        accounts = dict(connection.execute("SELECT id, role FROM users"))
    rights: dict[str | None, set[str]] = {None: rows.get("guest", set())}
    for user_id, role in accounts.items():
        rights[user_id] = set(ALL_CAPABILITIES) if role == "admin" else rows.get(role, set())
    return rights


async def _rights_after(database: Path, user_ids: list[str]) -> dict[str | None, set[str]]:
    """Every caller's set as the running app works it out — `deps.current_principal`'s own
    two calls — over the upgraded database."""
    engine = create_async_engine(f"sqlite+aiosqlite:///{database}")
    permissions.invalidate_cache()
    try:
        async with AsyncSession(engine) as session:
            rights: dict[str | None, set[str]] = {
                None: set(await permissions.capabilities_for_groups(session, frozenset({GUEST})))
            }
            for user_id in user_ids:
                member_of = await auth_groups.member_group_ids(session, user_id)
                rights[user_id] = set(
                    await permissions.capabilities_for_groups(
                        session, frozenset({USER}) | member_of
                    )
                )
            return rights
    finally:
        permissions.invalidate_cache()
        await engine.dispose()


async def test_every_caller_the_api_could_make_keeps_exactly_their_rights(
    tmp_path: Path,
) -> None:
    """On the role rows Wingman seeded — where User's are a subset of Trusted's — every
    account the API could have made, and a caller without one, holds exactly the same set
    after the upgrade as before it, computed by the code that answers requests."""
    database = tmp_path / "exact.db"
    await _alembic(database, "0038")
    _seed_accounts(database, API_ACCOUNTS)
    before = _rights_before(database)

    await _alembic(database, "0039")

    assert await _rights_after(database, list(API_ACCOUNTS)) == before


async def test_on_edited_roles_nobody_loses_a_right_and_only_a_helper_gains(
    tmp_path: Path,
) -> None:
    """On the host's edited, non-nested role rows: the same comparison, by the running code.
    Nobody loses; a plain account, an administrator and a caller without an account keep
    exactly theirs; a helper gains what User held and Trusted had been without."""
    database = tmp_path / "edited.db"
    await _alembic(database, "0038")
    _seed_0038(database)
    before = _rights_before(database)

    await _alembic(database, "0039")

    after = await _rights_after(database, list(ACCOUNTS))
    for caller in (None, "a-user", "a-admin"):
        assert after[caller] == before[caller], caller
    assert after["a-trusted"] - before["a-trusted"] == {"music.control"}
    assert after["a-trusted"] >= before["a-trusted"]
    # The hand-edited `guest` account held Guest's rows and now holds User's: the one loss
    # the docstring names, reachable only by editing the database by hand.
    assert before["a-guest"] - after["a-guest"] == GUEST_ROWS - USER_ROWS


async def test_a_failure_halfway_leaves_the_old_tables_and_runs_again(tmp_path: Path) -> None:
    """§8.1, measured rather than reproduced: a `group_capabilities` table already there in
    a shape step 2's copy cannot fill makes the revision fail at its second INSERT. What is
    left behind is the 0038 database — every old table untouched — plus the step-1 `groups`
    table, empty; and once the obstacle is gone the same upgrade lands where a clean one does."""
    database = tmp_path / "fails.db"
    await _alembic(database, "0038")
    _seed_0038(database)
    with sqlite3.connect(database) as connection:
        connection.execute(
            "CREATE TABLE group_capabilities (group_id VARCHAR(32) NOT NULL, "
            "capability VARCHAR(64) NOT NULL, poison TEXT NOT NULL, "
            "PRIMARY KEY (group_id, capability))"
        )

    with pytest.raises(IntegrityError):
        await _alembic(database, "0039")

    with sqlite3.connect(database) as connection:
        assert list(connection.execute("SELECT version_num FROM alembic_version")) == [("0038",)]
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master")}
        assert {"role_permissions", "groups", "ix_groups_name_lower"} <= tables
        assert "user_groups" not in tables
        # The built-in rows went in after the first INSERT began the transaction: rolled back.
        assert list(connection.execute("SELECT COUNT(*) FROM groups")) == [(0,)]
        assert "role" in {row[1] for row in connection.execute("PRAGMA table_info(users)")}
        assert "role" in {
            row[1] for row in connection.execute("PRAGMA table_info(tag_permissions)")
        }
        connection.execute("DROP TABLE group_capabilities")

    await _alembic(database, "0039")

    _assert_upgraded(database)


async def test_the_downgrade_gives_the_roles_back(tmp_path: Path) -> None:
    """Best effort: the three bundles and every account's role come back; a custom group and
    its members do not, and the docstring says so."""
    database = tmp_path / "down.db"
    await _alembic(database, "0038")
    _seed_0038(database)
    await _alembic(database, "0039")
    with sqlite3.connect(database) as connection:
        connection.execute(
            "INSERT INTO groups (id, name, created_at) "
            "VALUES ('djs', 'DJs', '2026-11-02 20:00:00.000000')"
        )
        connection.execute("INSERT INTO group_capabilities VALUES ('djs', 'music.manage')")
        connection.execute("INSERT INTO user_groups VALUES ('a-user', 'djs')")
        connection.execute(
            "INSERT INTO tag_permissions (tag_id, action, group_id, user_id) "
            f"VALUES ('{TAG_ID}', 'assign', 'djs', NULL)"
        )

    await _alembic(database, "0038", down=True)

    with sqlite3.connect(database) as connection:
        roles: dict[str, set[str]] = {}
        for role, capability in connection.execute("SELECT role, capability FROM role_permissions"):
            roles.setdefault(role, set()).add(capability)
        assert roles["guest"] == GUEST_ROWS
        assert roles["user"] == USER_ROWS
        assert roles["trusted"] == TRUSTED_ROWS
        assert "devices.manage" in roles["admin"] and "permissions.manage" in roles["admin"]
        assert "djs" not in roles

        assert dict(connection.execute("SELECT id, role FROM users")) == {
            "a-admin": "admin",
            "a-trusted": "trusted",
            "a-user": "user",
            # The hand-edited roles became plain accounts on the way up and stay that.
            "a-guest": "user",
            "a-wizard": "user",
        }
        assert set(
            connection.execute(
                "SELECT action, role, user_id FROM tag_permissions WHERE tag_id = ?", (TAG_ID,)
            )
        ) == {
            ("view", "guest", None),
            ("view_songs", "user", None),
            ("assign", "trusted", None),
            ("view", None, "a-user"),
        }
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master")}
        assert not tables & {"groups", "group_capabilities", "user_groups"}
        indexes = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'index'")
        }
        assert {
            "ix_users_username_lower",
            "ix_users_oidc_subject",
            "ix_tag_permissions_tag_id",
        } <= (indexes)

    # And forward again lands where it did.
    await _alembic(database, "0039")
    with sqlite3.connect(database) as connection:
        assert set(connection.execute("SELECT user_id, group_id FROM user_groups")) == {
            ("a-admin", "admin"),
            ("a-trusted", TRUSTED_GROUP_ID),
        }
