"""The seeding revisions, run both ways.

Every other test in the suite reaches the schema through `run_migrations`, which only ever
goes forward — so `downgrade()` is the half of a revision nothing exercises, and a broken one
is discovered by whoever first has to step a live database back. These tests walk 0023, 0024,
0030 and 0031 up, down and up again, and assert the database is the same at both tops.

The round trip is the point: a downgrade that forgets its rows makes the second upgrade
insert the shipped set a second time, and a primary key is the only thing that would notice.
"""

import asyncio
import importlib.util
from pathlib import Path
from types import ModuleType

from alembic import command
from alembic.config import Config
from sqlalchemy import bindparam, func, select, text
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
    real version of this, and it has to leave them with the shipped set once rather than
    twice or not at all.
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


async def _name_of(database_url: str, achievement_id: str) -> str | None:
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            return await connection.scalar(
                select(Achievement.name).where(Achievement.id == achievement_id)
            )
    finally:
        await engine.dispose()


async def _set_name(database_url: str, achievement_id: str, name: str) -> None:
    engine = create_async_engine(database_url)
    try:
        async with engine.begin() as connection:
            await connection.execute(
                text("UPDATE achievements SET name = :name WHERE id = :id"),
                {"name": name, "id": achievement_id},
            )
    finally:
        await engine.dispose()


async def test_0025_fixes_the_seeded_spelling(tmp_path: Path) -> None:
    """0023 seeded *Well Travelled* into every database built before this change, and reading
    `builtin.py` again is not something an existing instance ever does. So the American
    spelling needs 0025 to reach one."""
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'spelling.db'}"

    await _alembic(database_url, "0024")
    await _set_name(database_url, "builtin-artists-10", "Well Travelled")

    await _alembic(database_url, "head")
    assert await _name_of(database_url, "builtin-artists-10") == "Well Traveled"


async def test_0025_leaves_a_host_s_own_name_alone(tmp_path: Path) -> None:
    """What a party called the badge is theirs. The update only touches a row still holding
    the text 0023 wrote."""
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'renamed.db'}"

    await _alembic(database_url, "0024")
    await _set_name(database_url, "builtin-artists-10", "Jetsetter")

    await _alembic(database_url, "head")
    assert await _name_of(database_url, "builtin-artists-10") == "Jetsetter"


async def test_0029_gives_the_progress_already_stored_no_party(tmp_path: Path) -> None:
    """The column says which party `progress_current` was counted in, and progress written
    before this revision was the best any single party ever reached — so it names none.

    NULL is what the API reads as "not a party's number", which leaves such a row showing the
    old figure until the next pass rewrites it. That is deliberate: a pass runs on the next
    sing and on any edit to the catalogue, and inventing a party id in a migration would be a
    claim about an evening the column was not written in.
    """
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'progress.db'}"

    await _alembic(database_url, "0028")
    engine = create_async_engine(database_url)
    try:
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    "INSERT INTO player_achievements "
                    "(achievement_id, player_id, earned_at, session_id, "
                    "progress_current, progress_target) "
                    "VALUES ('builtin-sings-10', 'a-player', NULL, NULL, 9, 10)"
                )
            )

        await _alembic(database_url, "head")
        async with engine.connect() as connection:
            row = (
                await connection.execute(
                    select(
                        PlayerAchievement.progress_current,
                        PlayerAchievement.progress_target,
                        PlayerAchievement.progress_session_id,
                    )
                )
            ).one()
        assert tuple(row) == (9, 10, None)

        # And back off again: the column goes, the progress it was beside stays.
        await _alembic(database_url, "0028", down=True)
        async with engine.connect() as connection:
            kept = (
                await connection.execute(
                    select(PlayerAchievement.progress_current, PlayerAchievement.progress_target)
                )
            ).one()
        assert tuple(kept) == (9, 10)
    finally:
        await engine.dispose()


# --- 0030, the second batch of built-ins ---------------------------------------------------

# A row 0023 seeded and 0030 therefore may not touch, used below as the one a host moved a
# long way. It is `BUILT_INS`'s last first-batch id, which is what makes the "nothing that was
# already there moves" assertion read in order.
LAST_SEEDED_BY_0023 = "builtin-brave-soul"


def _revision(number: str) -> ModuleType:
    """One seeding revision's own module, loaded by its path: a file name that starts with a
    digit is not an importable module name, and `NEW_IDS` is the only place that says which
    ids a revision is responsible for.

    A module name of its own per revision, so two of them never share one.
    """
    (path,) = (migrations_dir() / "versions").glob(f"{number}_*.py")
    spec = importlib.util.spec_from_file_location(f"wingman_revision_{number}", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _split() -> tuple[list[str], list[str], list[str]]:
    """The ids 0023 seeded, the ids 0030 seeded and the ids 0031 seeded, each in `BUILT_INS`
    order — which is the order each of them inserts its own in, because all three read
    `seed_rows()` and the later two only filter it.

    Read off those revisions' frozen `NEW_IDS` and not off slices of `BUILT_INS`: the batches
    are not contiguous in the file, whose hidden built-ins stand at its end whichever batch
    they came with and whose *All Night Long* stands with the ladder it is the third rung of.
    A built-in added to the file without a revision of its own therefore lands in the
    **first** list here and fails the counts below, which is the warning that was wanted —
    every batch is counted for exactly that reason.
    """
    seeded_by_0030 = set(_revision("0030").NEW_IDS)
    seeded_by_0031 = set(_revision("0031").NEW_IDS)
    ids = [built_in.id for built_in in BUILT_INS]
    return (
        [one for one in ids if one not in seeded_by_0030 | seeded_by_0031],
        [one for one in ids if one in seeded_by_0030],
        [one for one in ids if one in seeded_by_0031],
    )


async def _catalogue(database_url: str) -> list[tuple[str, int]]:
    """Every achievement id with its place, in that order."""
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            rows = await connection.execute(
                select(Achievement.id, Achievement.sort_order).order_by(Achievement.sort_order)
            )
        return [(str(row[0]), int(row[1])) for row in rows]
    finally:
        await engine.dispose()


async def _execute(database_url: str, statement: str, parameters: dict[str, object]) -> None:
    engine = create_async_engine(database_url)
    try:
        async with engine.begin() as connection:
            await connection.execute(text(statement), parameters)
    finally:
        await engine.dispose()


async def test_0030_adds_its_seventeen_behind_whatever_the_host_arranged(tmp_path: Path) -> None:
    """The database an existing instance runs 0030 on: seeded when `builtin.py` held only the
    first seventeen, and arranged since — the catalogue's order is the host's, so the numbers
    already in the table are theirs and say nothing about `BUILT_INS`.

    The new ones go behind the highest of them, all seventeen of them, in file order, and
    nothing that was already there moves. 0031's one row rides along at the end of the same
    walk to head, which is what an instance that has been away for both revisions really
    runs; 0031 on its own is below.
    """
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'existing.db'}"
    first, second, third = _split()
    # Every batch, because only the later ones are filtered by a frozen `NEW_IDS`: a
    # thirty-sixth built-in added to `builtin.py` without a seed revision of its own lands in
    # `first` and would otherwise pass here unnoticed.
    assert (len(first), len(second), len(third)) == (17, 17, 1)

    # 0023 imports `builtin.py` live, so migrating there seeds all thirty-five. Taking
    # everything the later revisions own back off is what leaves the database an instance
    # from before this batch really has.
    await _alembic(database_url, "0029")
    engine = create_async_engine(database_url)
    try:
        async with engine.begin() as connection:
            await connection.execute(
                text("DELETE FROM achievements WHERE id IN :ids").bindparams(
                    bindparam("ids", value=second + third, expanding=True)
                )
            )
            # And a host who moved one row a long way, so the highest place in the table is
            # nothing like "seventeen".
            await connection.execute(
                text("UPDATE achievements SET sort_order = 40 WHERE id = :id"),
                {"id": LAST_SEEDED_BY_0023},
            )
    finally:
        await engine.dispose()
    before = await _catalogue(database_url)
    assert [row[0] for row in before] == first[:-1] + [LAST_SEEDED_BY_0023]

    await _alembic(database_url, "head")
    after = await _catalogue(database_url)

    # Everything that was there is where it was, and the new ones follow the highest place —
    # 40 — in the order the file lists them: 0030's seventeen, then 0031's one behind them.
    assert after[: len(before)] == before
    assert after[len(before) :] == [
        (row_id, 41 + index) for index, row_id in enumerate(second + third)
    ]


async def test_the_later_revisions_seed_nothing_where_0023_seeded_everything(
    tmp_path: Path,
) -> None:
    """A database created after `builtin.py` grew: 0023 read the file live and inserted all
    thirty-five itself, so 0030 and 0031 have nothing to do — and must not do it anyway. A
    blind insert would be a primary-key error on the way to a duplicated catalogue.

    Which is also the whole claim about where a **fresh** database draws the new ones: in
    `BUILT_INS` order, so *All Night Long* stands directly behind *Iron Lungs* there and not
    at the end, as it does on a database that had been seeded already.
    """
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'fresh.db'}"

    await _alembic(database_url, "head")
    rows = await _catalogue(database_url)

    ids = [row[0] for row in rows]
    assert ids == [built_in.id for built_in in BUILT_INS]
    assert [row[1] for row in rows] == list(range(len(BUILT_INS)))
    # Spelled out, because "where the ladder's third rung lands" is the decision `builtin.py`
    # takes by listing it there and not at the end.
    assert ids[ids.index("builtin-evening-songs-10") + 1] == "builtin-evening-songs-20"


async def test_0030_takes_only_its_own_seventeen_back_off(tmp_path: Path) -> None:
    """Stepping back to 0029 leaves the database an instance from before this batch had: the
    first seventeen, with what players earned on them, and no trace of the second — nor of
    0031's one row, which the same step passes through."""
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'stepped-back.db'}"
    first, second, third = _split()

    await _alembic(database_url, "head")
    for achievement_id in (first[0], second[0]):
        await _execute(
            database_url,
            "INSERT INTO player_achievements "
            "(achievement_id, player_id, earned_at, session_id, progress_current, "
            "progress_target, progress_session_id) "
            "VALUES (:id, 'a-player', NULL, NULL, 1, 2, NULL)",
            {"id": achievement_id},
        )

    await _alembic(database_url, "0029", down=True)
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            kept = list(await connection.scalars(select(Achievement.id)))
            progress = list(await connection.scalars(select(PlayerAchievement.achievement_id)))
    finally:
        await engine.dispose()
    assert sorted(kept) == sorted(first)
    # The progress row of an achievement that is gone went with it; the other one stayed.
    assert progress == [first[0]]

    # And forward again: the seventeen come back once, behind the seventeen that stayed, with
    # 0031's row behind them.
    await _alembic(database_url, "head")
    assert [row[0] for row in await _catalogue(database_url)] == first + second + third


# --- 0031, the ladder's third rung ---------------------------------------------------------


async def test_0031_adds_its_row_behind_whatever_the_host_arranged(tmp_path: Path) -> None:
    """The database an existing instance runs 0031 on: seeded through 0030 and arranged since.

    *All Night Long* goes behind the highest place in the table and nothing else moves — so
    the one place it stands directly behind *Iron Lungs* is a **fresh** database, and on this
    one it is the last row of the host's own order.
    """
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'seeded-through-0030.db'}"
    _, _, third = _split()
    (new_id,) = third

    # 0023 imports `builtin.py` live, so a walk to 0030 seeds all thirty-five. Taking this
    # revision's row back off is what leaves the database an instance from before it has.
    await _alembic(database_url, "0030")
    ids_before = [built_in.id for built_in in BUILT_INS if built_in.id != new_id]
    engine = create_async_engine(database_url)
    try:
        async with engine.begin() as connection:
            await connection.execute(
                text("DELETE FROM achievements WHERE id = :id"), {"id": new_id}
            )
            # And a host who moved one row a long way, so the highest place in the table is
            # nothing like "thirty-four".
            await connection.execute(
                text("UPDATE achievements SET sort_order = 40 WHERE id = :id"),
                {"id": ids_before[0]},
            )
    finally:
        await engine.dispose()
    before = await _catalogue(database_url)
    assert [row[0] for row in before] == ids_before[1:] + [ids_before[0]]

    await _alembic(database_url, "head")

    assert await _catalogue(database_url) == before + [(new_id, 41)]


async def test_0031_takes_only_its_own_row_back_off(tmp_path: Path) -> None:
    """Stepping back to 0030 leaves the database an instance from before this one had: the
    thirty-four, with what players earned on them, and no trace of the thirty-fifth."""
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'stepped-back-to-0030.db'}"
    first, second, third = _split()
    (new_id,) = third
    kept_ids = [built_in.id for built_in in BUILT_INS if built_in.id != new_id]

    await _alembic(database_url, "head")
    for achievement_id in (first[0], new_id):
        await _execute(
            database_url,
            "INSERT INTO player_achievements "
            "(achievement_id, player_id, earned_at, session_id, progress_current, "
            "progress_target, progress_session_id) "
            "VALUES (:id, 'a-player', NULL, NULL, 1, 2, NULL)",
            {"id": achievement_id},
        )

    await _alembic(database_url, "0030", down=True)
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            kept = list(await connection.scalars(select(Achievement.id)))
            progress = list(await connection.scalars(select(PlayerAchievement.achievement_id)))
    finally:
        await engine.dispose()
    assert sorted(kept) == sorted(kept_ids)
    # The progress row of the achievement that is gone went with it; the other one stayed.
    assert progress == [first[0]]

    # And forward again: it comes back once, behind everything that stayed — the seeded
    # numbers those thirty-four kept have a gap where it was, and the row lands after the
    # highest of them rather than back in the gap.
    await _alembic(database_url, "head")
    assert [row[0] for row in await _catalogue(database_url)] == kept_ids + [new_id]


async def _combines(database_url: str) -> dict[str, str]:
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            rows = await connection.execute(text("SELECT id, combine FROM achievements"))
        return {str(row[0]): str(row[1]) for row in rows}
    finally:
        await engine.dispose()


async def test_0038_reads_every_achievement_already_there_as_all(tmp_path: Path) -> None:
    """Every definition written before 0038 is a list of conditions that all have to hold, and
    the column it adds says so of every row already in the table — the built-ins and the
    host's own alike — so nothing changes meaning. Stepping back takes the column off again
    and leaves the rows."""
    database_url = f"sqlite+aiosqlite:///{tmp_path / 'combine.db'}"

    await _alembic(database_url, "0037")
    await _execute(
        database_url,
        "INSERT INTO achievements "
        "(id, name, description, color, hidden, enabled, built_in, sort_order, definition, "
        "created_at) "
        "VALUES ('a-host-s-own', 'Own', '', 'gold', 0, 1, 0, 99, '[]', '2026-09-01 20:00:00')",
        {},
    )

    await _alembic(database_url, "head")
    combines = await _combines(database_url)
    assert sorted(combines) == sorted([built_in.id for built_in in BUILT_INS] + ["a-host-s-own"])
    assert set(combines.values()) == {"all"}

    await _alembic(database_url, "0037", down=True)
    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            columns = [
                row[1] for row in await connection.execute(text("PRAGMA table_info(achievements)"))
            ]
            count = await connection.scalar(text("SELECT COUNT(*) FROM achievements"))
    finally:
        await engine.dispose()
    assert "combine" not in columns
    assert count == len(BUILT_INS) + 1
