"""The two seeding revisions, run both ways.

Every other test in the suite reaches the schema through `run_migrations`, which only ever
goes forward — so `downgrade()` is the half of a revision nothing exercises, and a broken one
is discovered by whoever first has to step a live database back. These tests walk 0023 and
0024 up, down and up again, and assert the database is the same at both tops.

The round trip is the point: a downgrade that forgets its rows makes the second upgrade
insert the seventeen a second time, and a primary key is the only thing that would notice.
"""

import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import create_async_engine

from ultrastar_wingman.achievements.builtin import BUILT_INS
from ultrastar_wingman.achievements.model import Achievement, PlayerAchievement
from ultrastar_wingman.auth.model import RolePermission
from ultrastar_wingman.db import migrations_dir


def _config(database_url: str) -> Config:
    config = Config()
    config.set_main_option("script_location", str(migrations_dir()))
    # Alembic reads options through ConfigParser: a literal % must be escaped.
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    return config


async def _alembic(database_url: str, revision: str, *, down: bool = False) -> None:
    """Alembic is sync and opens its own event loop, so it runs in a worker thread."""
    run = command.downgrade if down else command.upgrade
    await asyncio.to_thread(run, _config(database_url), revision)


async def test_the_seed_revisions_survive_a_round_trip(tmp_path: Path) -> None:
    """Up to head, back to 0022, up to head again.

    An operator stepping a database back to try an older build and then forward again is the
    real version of this, and it has to leave them with seventeen achievements rather than
    thirty-four or none.
    """
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'round-trip.db'}"
    slugs = [built_in.id for built_in in BUILT_INS]

    await _alembic(database_url, "head")
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            seeded = list(await connection.scalars(select(Achievement.id).order_by(Achievement.id)))
            granted = list(
                await connection.scalars(
                    select(RolePermission.role).where(
                        RolePermission.capability == "achievements.manage"
                    )
                )
            )
        assert sorted(seeded) == sorted(slugs)
        assert granted == ["admin"]

        # A player's progress on one of them, so the downgrade has something to clean up.
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    "INSERT INTO player_achievements "
                    "(achievement_id, player_id, earned_at, session_id, "
                    "progress_current, progress_target) "
                    "VALUES ('builtin-score-9000', 'a-player', NULL, NULL, 1, 2)"
                )
            )

        await _alembic(database_url, "0022", down=True)
        async with engine.connect() as connection:
            assert list(await connection.scalars(select(Achievement.id))) == []
            # The progress row went with the achievement it was progress toward: leaving it
            # behind is what would make the next upgrade seed on top of an orphan.
            assert list(await connection.scalars(select(PlayerAchievement.achievement_id))) == []
            assert (
                await connection.scalar(
                    select(func.count())
                    .select_from(RolePermission)
                    .where(RolePermission.capability == "achievements.manage")
                )
            ) == 0

        await _alembic(database_url, "head")
        async with engine.connect() as connection:
            again = list(await connection.scalars(select(Achievement.id)))
            roles = list(
                await connection.scalars(
                    select(RolePermission.role).where(
                        RolePermission.capability == "achievements.manage"
                    )
                )
            )
        assert sorted(again) == sorted(slugs)
        assert roles == ["admin"]
    finally:
        await engine.dispose()


async def test_the_seed_reaches_a_database_that_already_stopped_at_0022(tmp_path: Path) -> None:
    """The two revisions are what an existing instance runs on its next start — 0022 created
    the tables and left them empty, so the seed has to work on that database and not only on
    one built in a single sweep."""
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'stepwise.db'}"

    await _alembic(database_url, "0022")
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            assert list(await connection.scalars(select(Achievement.id))) == []

        await _alembic(database_url, "head")
        async with engine.connect() as connection:
            seeded = list(await connection.scalars(select(Achievement.id)))
            ordered = list(
                await connection.scalars(select(Achievement.id).order_by(Achievement.sort_order))
            )
        assert len(seeded) == len(BUILT_INS)
        # The file's order is the drawing order, and a bulk insert gets no ORM default for it.
        assert ordered == [built_in.id for built_in in BUILT_INS]
    finally:
        await engine.dispose()
