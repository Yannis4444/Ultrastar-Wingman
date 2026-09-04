"""The catalogue, and recomputing achievements from the scores. Knows nothing about FastAPI.

Every rule lives in `evaluate.py`; this module reads the rows the engine needs, writes the
`player_achievements` its answer implies, and owns the handful of writes the catalogue itself
takes (a new achievement, an edited one, an uploaded icon, a built-in put back the way
Wingman ships it). Each of those broadcasts
`achievements.changed` — a client holding the catalogue open would otherwise draw an edited
badge until it happened to refetch.

The global toggle is consulted **here**, inside the pass, and not at the four call sites: a
trigger that forgot to ask would keep writing rows nobody draws, and there are four of them.
Switched off, a pass returns without touching a row — the earned ones are kept, so switching
back on is the full pass that brings them up to date rather than an evening erased.
"""

import asyncio
import contextlib
import logging
import shutil
import uuid
from collections.abc import Collection, Iterable
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import anyio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..events import AchievementsChanged, event_bus
from ..images import (
    IMAGE_MEDIA_TYPES,
    ImageTooLargeError,
    ImageTooManyPixelsError,
    ImageTypeError,
    remove_images,
    store_image,
    validate_image,
)
from ..karaoke.model import Score, Sing
from ..players.model import Player
from ..players.schema import read_player
from ..songs.model import Song
from . import builtin
from . import settings as achievement_settings
from .archive import (
    ArchivedAchievement,
    ArchiveEntry,
    ArchiveIconError,
    ArchiveImage,
    build_archive,
    read_archive,
)
from .evaluate import NOT_EARNED, ScoreRow, evaluate
from .model import Achievement, PlayerAchievement
from .schema import (
    AchievementImportResult,
    Condition,
    EarnedByPlayer,
    parse_definition,
    read_achievement,
)

logger = logging.getLogger(__name__)

MANAGE_CAPABILITY = "achievements.manage"

# One pass at a time, for the whole process. Two passes over the same player race on the
# first insert — a finishing sing and a `stats.moderate` correction can both find no row and
# both add the same composite primary key, and the second one raises. One process, one lock,
# and it stops two passes redoing each other's work as well.
_write_lock = asyncio.Lock()

# The full passes a catalogue write kicked off. Tracked rather than fired and forgotten
# (architecture.md): a failure is logged, and shutdown cancels what is still running before
# the engine goes.
_passes: set[asyncio.Task[dict[str, list[str]]]] = set()


# The sentinel for "the PATCH did not name this field", the same shape `tags.service` uses:
# `None` is a real value for `icon`, so leaving a field out and clearing it cannot be the
# same thing.
class _Unset:
    pass


UNSET = _Unset()


class BuiltInAchievementError(ValueError):
    """A built-in cannot be deleted. Its presentation may be edited and it may be switched
    off like any other — but an instance always has the set the import format's stable slug
    ids name."""

    def __init__(self, achievement_id: str) -> None:
        super().__init__(f"'{achievement_id}' is one of the built-in achievements")
        self.achievement_id = achievement_id


class BuiltInDefinitionError(ValueError):
    """What one of the shipped achievements asks for is Wingman's own.

    `builtin.py` is the one place that says what *Golden Voice* means, and a party that
    renamed it into something else entirely still has an achievement whose conditions every
    other instance agrees on. The only write that touches them is `reset_built_in`, which
    puts the shipped ones back.
    """

    def __init__(self, achievement_id: str) -> None:
        super().__init__(
            f"the conditions of '{achievement_id}' are Wingman's own and cannot be changed"
        )
        self.achievement_id = achievement_id


class NotBuiltInError(ValueError):
    """Only a built-in can be reset. An achievement somebody made here has nothing to be put
    back to — `builtin.py` never heard of it."""

    def __init__(self, achievement_id: str) -> None:
        super().__init__(f"'{achievement_id}' is not one of the built-in achievements")
        self.achievement_id = achievement_id


class OrderMismatchError(ValueError):
    """The order sent is not a permutation of the catalogue.

    The same refusal a playlist's reorder gives (`library.service.reorder_entries`): a
    partial list would silently decide where everything it left out belongs, and a list
    naming an id twice has no order at all. The management page holds the whole catalogue,
    so sending all of it costs it nothing.
    """

    def __init__(self) -> None:
        super().__init__("the order must name every achievement exactly once")


class UnknownAchievementError(LookupError):
    """An export named an id the catalogue does not hold. Named rather than skipped: an
    archive quietly missing one of the achievements somebody asked for would only be found
    out much later, in another instance."""

    def __init__(self, achievement_id: str) -> None:
        super().__init__(f"unknown achievement '{achievement_id}'")
        self.achievement_id = achievement_id


async def load_rows(session: AsyncSession, player_id: str) -> list[ScoreRow]:
    """Every score of one player, with its sing and the song that sing was on.

    One query and not one per score: the engine needs the whole set at once, and a party's
    worth of scores is a few hundred rows. The join to `songs` is an outer one — a score
    outlives the song it was sung on, and a condition that filters by nothing still counts
    it.
    """
    rows = await session.execute(
        select(
            Score.score,
            Sing.id,
            Sing.session_id,
            Sing.song_id,
            Song.title,
            Song.artist,
            Song.genre,
            Song.language,
            Song.edition,
            Song.year,
            Song.is_duet,
            Song.video_file,
            Score.placement,
            Score.field_size,
        )
        .join(Sing, Sing.id == Score.sing_id)
        .outerjoin(Song, Song.id == Sing.song_id)
        .where(Score.player_id == player_id)
        # Chronological, id breaking ties: which party earned a session-scoped achievement
        # is the first one in this order that satisfies it, so the order has to be stable.
        .order_by(Score.recorded_at, Score.id)
    )
    return [
        ScoreRow(
            score=score,
            sing_id=sing_id,
            session_id=session_id,
            song_id=song_id,
            title=title,
            artist=artist,
            genre=genre,
            language=language,
            edition=edition,
            year=year,
            is_duet=is_duet,
            # File paths stay server-side, exactly like `songs.schema.read_song`. A song that
            # is gone says nothing about video rather than "no video".
            has_video=None if title is None else video_file is not None,
            # Straight off the score row and never recomputed from the rows still standing:
            # what `number_of_wins` counts is the evening as it was scored, which is the
            # whole reason these two are columns (`karaoke.model.Score`).
            placement=placement,
            field_size=field_size,
        )
        for (
            score,
            sing_id,
            session_id,
            song_id,
            title,
            artist,
            genre,
            language,
            edition,
            year,
            is_duet,
            video_file,
            placement,
            field_size,
        ) in rows
    ]


async def evaluate_player(
    session: AsyncSession, player_id: str, now: datetime | None = None
) -> list[str]:
    """Recompute every enabled achievement for one player, and answer with the ids this pass
    newly earned — the ones that had no `earned_at` before and have one now."""
    return (await evaluate_players(session, [player_id], now)).get(player_id, [])


async def evaluate_players(
    session: AsyncSession, player_ids: Collection[str], now: datetime | None = None
) -> dict[str, list[str]]:
    """The same for several players at once, newly earned ids per player.

    Per player rather than one big query: the engine works on one player's scores, and a
    handful of players is a handful of queries. The achievements themselves are read once.

    Nothing at all while `achievements.enabled` is off, the existing rows included: they are
    kept, and switching the feature back on runs the full pass that corrects them.
    """
    if not await achievement_settings.enabled(session):
        return {}
    async with _write_lock:
        achievements = await _enabled(session)
        moment = now or datetime.now(UTC)
        # `fromkeys` rather than a set: the same player named twice is one pass, and the
        # order callers pass them in is the order they get back.
        earned = {
            player_id: await _write(session, player_id, achievements, moment)
            for player_id in dict.fromkeys(player_ids)
        }
        await session.commit()
        return earned


async def evaluate_all(session: AsyncSession, now: datetime | None = None) -> dict[str, list[str]]:
    """Recompute for every player that has at least one score — the background pass behind
    an edited definition or a flipped toggle.

    A player with no scores is deliberately not in the list: they hold no rows, and the pass
    that took their last score away is the one that deleted them.
    """
    if not await achievement_settings.enabled(session):
        return {}
    player_ids = await session.scalars(
        select(Score.player_id).where(Score.player_id.is_not(None)).distinct()
    )
    return await evaluate_players(
        session, [player_id for player_id in player_ids if player_id is not None], now
    )


async def _enabled(session: AsyncSession) -> list[Achievement]:
    """The achievements a pass looks at. The id breaks ties so two achievements sorted the
    same keep a stable order between runs."""
    rows = await session.scalars(
        select(Achievement)
        .where(Achievement.enabled.is_(True))
        .order_by(Achievement.sort_order, Achievement.id)
    )
    return list(rows)


async def _write(
    session: AsyncSession,
    player_id: str,
    achievements: list[Achievement],
    now: datetime,
) -> list[str]:
    """One player's pass, without the commit. Returns what this pass newly earned."""
    existing = {
        row.achievement_id: row
        for row in await session.scalars(
            select(PlayerAchievement).where(PlayerAchievement.player_id == player_id)
        )
    }
    rows = await load_rows(session, player_id)
    if not rows:
        # A player who never sang — or whose last score was just deleted — carries no rows at
        # all, rather than one empty row per achievement.
        for stale in existing.values():
            await session.delete(stale)
        return []

    newly_earned: list[str] = []
    for achievement in achievements:
        conditions = parse_definition(achievement.id, achievement.definition)
        outcome = NOT_EARNED if conditions is None else evaluate(conditions, rows)
        row = existing.pop(achievement.id, None)
        if row is None:
            row = PlayerAchievement(achievement_id=achievement.id, player_id=player_id)
            session.add(row)
        if not outcome.earned:
            # Recomputation is the truth: one whose conditions stopped holding is revoked,
            # which is the only way a mis-attributed score can be fully corrected.
            row.earned_at = None
        elif row.earned_at is None:
            # Earned again after a revocation is stamped fresh, deliberately: the moment an
            # achievement was first earned is not derivable from the scores, so a date that
            # survived its own revocation would be a claim the data cannot back.
            row.earned_at = now
            newly_earned.append(achievement.id)
        # Held without interruption since: the stamp is left alone, so a badge does not
        # change its date on every pass.
        row.session_id = outcome.session_id
        row.progress_current = outcome.progress_current
        row.progress_target = outcome.progress_target

    # Whatever is left named an achievement that is disabled or gone. Dropping the row is
    # what makes switching one back on a recomputation rather than a stale badge.
    for stale in existing.values():
        await session.delete(stale)
    return newly_earned


async def list_achievements(session: AsyncSession) -> list[Achievement]:
    """Every achievement, disabled ones included — the catalogue is what a manager edits and
    what everybody else draws its locked slots from.

    `created_at` breaks a tie in `sort_order`, so two rows sorted the same keep the order
    they were made in instead of shuffling between requests.
    """
    rows = await session.scalars(
        select(Achievement).order_by(Achievement.sort_order, Achievement.created_at)
    )
    return list(rows)


async def by_ids(session: AsyncSession, achievement_ids: Iterable[str]) -> list[Achievement]:
    """The named achievements, in catalogue order — what an `achievements.earned` payload is
    built from."""
    wanted = list(achievement_ids)
    if not wanted:
        return []
    rows = await session.scalars(
        select(Achievement)
        .where(Achievement.id.in_(wanted))
        .order_by(Achievement.sort_order, Achievement.created_at)
    )
    return list(rows)


async def earned_ids(session: AsyncSession, player_id: str | None) -> frozenset[str]:
    """What one player has actually earned — the set the hidden masking is decided against.

    A caller with no player of their own has earned nothing, which is what `None` answers:
    the host screen is an administrator but nobody, and a guest phone has no identity at all.
    """
    if player_id is None:
        return frozenset()
    rows = await session.scalars(
        select(PlayerAchievement.achievement_id).where(
            PlayerAchievement.player_id == player_id,
            PlayerAchievement.earned_at.is_not(None),
        )
    )
    return frozenset(rows)


async def earned_by_anybody(session: AsyncSession, achievement_id: str) -> bool:
    """Whether one achievement has been earned at all, by anyone.

    What decides whether a hidden achievement's uploaded picture may be served. Not "has the
    caller earned it": the moment somebody earns one it is announced to every socket with its
    name and its glyph, and a phone drawing another player's badges is meant to see it too.
    Until then the picture is as much of the surprise as the name is.
    """
    found = await session.scalar(
        select(PlayerAchievement.player_id)
        .where(
            PlayerAchievement.achievement_id == achievement_id,
            PlayerAchievement.earned_at.is_not(None),
        )
        .limit(1)
    )
    return found is not None


async def rows_of_player(
    session: AsyncSession, player_id: str
) -> list[tuple[PlayerAchievement, Achievement]]:
    """One player's record: every row they hold, with the achievement it is about.

    An inner join, so a row left behind by an achievement that is gone is simply not in the
    answer — the same way every other listing in the app skips an orphan.
    """
    rows = await session.execute(
        select(PlayerAchievement, Achievement)
        .join(Achievement, Achievement.id == PlayerAchievement.achievement_id)
        .where(PlayerAchievement.player_id == player_id)
        .order_by(Achievement.sort_order, Achievement.created_at)
    )
    return [(row, achievement) for row, achievement in rows]


async def earned_by_players(
    session: AsyncSession, earned: dict[str, list[str]]
) -> list[EarnedByPlayer]:
    """What a pass just awarded, as the `achievements.earned` event carries it.

    Unmasked, `hidden` ones included: earning one is what reveals it. Without the
    `definition` all the same — the bus is open to anonymous clients, and what a hidden
    achievement *asks* for is the surprise itself.

    A player whose row has gone missing (deleted mid-party) is left out rather than announced
    as an id nothing can draw.
    """
    filled = {player_id: ids for player_id, ids in earned.items() if ids}
    if not filled:
        return []
    achievements = {
        achievement.id: achievement
        for achievement in await by_ids(session, {one for ids in filled.values() for one in ids})
    }
    payload: list[EarnedByPlayer] = []
    for player_id, ids in filled.items():
        player = await session.get(Player, player_id)
        if player is None:
            continue
        payload.append(
            EarnedByPlayer(
                player=read_player(player),
                achievements=[
                    read_achievement(achievements[one]) for one in ids if one in achievements
                ],
            )
        )
    return payload


def dump_definition(conditions: list[Condition]) -> list[dict[str, Any]]:
    """The conditions as the JSON column holds them.

    Written out of the parsed models rather than out of the request body, so what is stored
    is what the engine reads back: a field the models defaulted is stored spelled out, and
    one nobody set is left out rather than stored as null.
    """
    return [condition.model_dump(mode="json", exclude_none=True) for condition in conditions]


async def create_achievement(
    session: AsyncSession,
    *,
    name: str,
    description: str,
    icon: str | None,
    color: str,
    hidden: bool,
    enabled: bool,
    definition: list[Condition],
) -> Achievement:
    """A new achievement, at the end of the list.

    Where it sits after that is `reorder_achievements`' business and nobody else's, so
    there is nothing to place it with here.

    A uuid4 hex id: the stable slugs belong to the set Wingman ships, and one an operator
    made here has no meaning another instance could recognise.
    """
    achievement = Achievement(
        id=uuid.uuid4().hex,
        name=name,
        description=description,
        icon=icon,
        color=color,
        hidden=hidden,
        enabled=enabled,
        sort_order=await _next_sort_order(session),
        definition=dump_definition(definition),
    )
    session.add(achievement)
    await session.commit()
    logger.info("achievement '%s' created (%s)", achievement.name, achievement.id)
    await event_bus.broadcast(AchievementsChanged())
    return achievement


async def update_achievement(
    session: AsyncSession,
    achievement: Achievement,
    *,
    name: str | None = None,
    description: str | None = None,
    icon: str | None | _Unset = UNSET,
    color: str | None = None,
    hidden: bool | None = None,
    enabled: bool | None = None,
    definition: list[Condition] | None = None,
) -> Achievement:
    """Change what an achievement is, or what it asks for.

    Not where it sits: `sort_order` is `reorder_achievements`' column alone, which renumbers
    the whole catalogue 0, 1, 2 … from one permutation. A second writer with a different
    rule — one row, any number, duplicates allowed — is a bug waiting for the day two rows
    share a number, and the order is the host's arrangement of the catalogue rather than a
    field of one achievement anyway.

    A built-in's presentation is as editable as anybody else's — only its **conditions** are
    not: a `definition` that would move them raises `BuiltInDefinitionError` and nothing at
    all is written. A `definition` that repeats what the row already holds is let through as
    the no-op it is, so a client that sends the whole achievement back unchanged is not
    refused for a field it never meant to touch.
    """
    if definition is not None and achievement.built_in:
        # Checked before a single field is applied, so a refusal leaves the row untouched
        # rather than dirty in the session. The stored column is what `dump_definition`
        # writes, so comparing the dumped form is an exact comparison and not a guess.
        if dump_definition(definition) != achievement.definition:
            raise BuiltInDefinitionError(achievement.id)
        definition = None
    if name is not None:
        achievement.name = name
    if description is not None:
        achievement.description = description
    if not isinstance(icon, _Unset):
        # An explicit null clears the glyph; leaving the field out keeps it.
        achievement.icon = icon
    if color is not None:
        achievement.color = color
    if hidden is not None:
        achievement.hidden = hidden
    if enabled is not None:
        achievement.enabled = enabled
    if definition is not None:
        achievement.definition = dump_definition(definition)
    await session.commit()
    logger.info("achievement '%s' updated (%s)", achievement.name, achievement.id)
    await event_bus.broadcast(AchievementsChanged())
    return achievement


async def reorder_achievements(session: AsyncSession, achievement_ids: list[str]) -> None:
    """Rewrite the whole catalogue's order: the ids in the order they are to be listed in.

    Raises `OrderMismatchError` unless the list is a permutation of every achievement there
    is. One sequence over one column, so there is nothing per caller about it — a manager
    sees the whole catalogue, disabled and hidden rows included, and the numbers are handed
    out 0, 1, 2 … in the order sent rather than nudged, so the result is the order and not an
    arithmetic accident of what the rows held before.

    No recomputation follows: where an achievement sits in the list has nothing to do with
    who has earned it.
    """
    rows = {row.id: row for row in await list_achievements(session)}
    if sorted(achievement_ids) != sorted(rows):
        raise OrderMismatchError
    for position, achievement_id in enumerate(achievement_ids):
        rows[achievement_id].sort_order = position
    await session.commit()
    logger.info("the achievement catalogue was reordered (%d rows)", len(achievement_ids))
    await event_bus.broadcast(AchievementsChanged())


async def reset_built_in(
    session: AsyncSession, achievement: Achievement, icons_dir: Path
) -> Achievement:
    """Put one of the shipped achievements back the way Wingman ships it.

    Everything `builtin.py` declares is written back from that file — the name, the
    description, the glyph, the colour, `hidden` and the conditions — and an uploaded picture
    is dropped, so the shipped picture (`pictures.py`) is what is drawn again rather than a
    picture standing in front of it. The definition is written exactly as the seed migration
    writes it, so a reset row and a freshly seeded one are the same row.

    Two things are deliberately **left alone**. `enabled`, because switching a built-in off
    is the one thing the documentation promises a party may do to it, and somebody who
    switched *Brave Soul* off did it on purpose. And `sort_order`, because the order of the
    catalogue is the host's: `reorder_achievements` hands out 0, 1, 2 … over the whole table,
    so this row's index in `BUILT_INS` means nothing beside the numbers the others now hold —
    putting it back would drop the row at an arbitrary spot rather than at "where Wingman had
    it". A reset restores what an achievement *is*, not where it was filed.

    Restoring the conditions is also the only way an improved shipped definition ever reaches
    a database that was seeded with the old one: the seed runs once, and no other write may
    touch a built-in's conditions.

    Raises `NotBuiltInError` for anything else in the catalogue — there is nothing to put it
    back to.
    """
    built_in = builtin.BY_ID.get(achievement.id)
    if built_in is None or not achievement.built_in:
        raise NotBuiltInError(achievement.id)
    await remove_images(icons_dir, achievement.id)
    achievement.name = built_in.name
    achievement.description = built_in.description
    achievement.icon = built_in.icon
    achievement.icon_file = None
    achievement.color = built_in.color
    achievement.hidden = built_in.hidden
    # A copy: the column would otherwise hold the very list `builtin.py` declares, and a JSON
    # column is a mutable the ORM hands out again on the next read.
    achievement.definition = deepcopy(built_in.definition)
    await session.commit()
    logger.info("achievement '%s' reset to the one Wingman ships", achievement.id)
    await event_bus.broadcast(AchievementsChanged())
    return achievement


async def delete_achievement(
    session: AsyncSession, achievement: Achievement, icons_dir: Path
) -> None:
    """Delete one, everything anybody reached on it, and its uploaded picture.

    Raises `BuiltInAchievementError` for one of the built-ins: the set Wingman ships is what
    import/export recognises by id, so it may be switched off but never taken away.

    The `player_achievements` rows go with it rather than staying as orphans. Unlike a score,
    which is the record of something that happened, a progress row is a derived number and
    says nothing at all once the thing it was progress toward is gone.
    """
    if achievement.built_in:
        raise BuiltInAchievementError(achievement.id)
    await remove_images(icons_dir, achievement.id)
    for row in await session.scalars(
        select(PlayerAchievement).where(PlayerAchievement.achievement_id == achievement.id)
    ):
        await session.delete(row)
    await session.delete(achievement)
    await session.commit()
    logger.info("achievement '%s' deleted (%s)", achievement.name, achievement.id)
    await event_bus.broadcast(AchievementsChanged())


async def store_icon(
    session: AsyncSession,
    achievement: Achievement,
    icons_dir: Path,
    content_type: str | None,
    data: bytes,
) -> Achievement:
    """Replace the glyph with an uploaded picture.

    The same rules as a player's avatar, out of the same module (`images.py`): the same
    content-type allowlist, the same byte cap and the same pixel cap, one file per
    achievement, and the previous one dropped even when it had another extension.
    """
    extension = validate_image(content_type, data)
    path = await store_image(icons_dir, achievement.id, extension, data)
    achievement.icon_file = str(path)
    await session.commit()
    await event_bus.broadcast(AchievementsChanged())
    return achievement


async def remove_icon(
    session: AsyncSession, achievement: Achievement, icons_dir: Path
) -> Achievement:
    """Back to the glyph — or, for a built-in, back to the picture Wingman ships
    (`pictures.py`). A no-op when there was no upload: asking twice is not a mistake."""
    await remove_images(icons_dir, achievement.id)
    achievement.icon_file = None
    await session.commit()
    await event_bus.broadcast(AchievementsChanged())
    return achievement


async def export_archive(session: AsyncSession, achievement_ids: list[str]) -> bytes:
    """The named achievements as one `.tar.gz`, uploaded pictures included.

    An id that is not in the catalogue raises `UnknownAchievementError` rather than being
    skipped: an export that quietly held sixteen of the seventeen ids somebody asked for
    would be found out much later, in another instance.

    A `icon_file` column pointing at a file that is no longer there exports as an
    achievement with no picture. That is a broken row, not a broken request, and the archive
    is still exactly what this instance can show.
    """
    achievements = {row.id: row for row in await by_ids(session, achievement_ids)}
    missing = [one for one in achievement_ids if one not in achievements]
    if missing:
        raise UnknownAchievementError(missing[0])
    entries = []
    for achievement in achievements.values():
        entries.append(
            ArchiveEntry(
                id=achievement.id,
                name=achievement.name,
                description=achievement.description,
                icon=achievement.icon,
                color=achievement.color,
                hidden=achievement.hidden,
                enabled=achievement.enabled,
                sort_order=achievement.sort_order,
                # The stored column rather than parsed conditions: an export is a faithful
                # copy of the row, so one somebody hand-edited into a shape the models refuse
                # comes out as it stands and can be fixed in the archive.
                definition=achievement.definition,
                icon_image=await _icon_image(achievement),
            )
        )
    return await anyio.to_thread.run_sync(build_archive, entries)


async def import_archive(
    session: AsyncSession, data: bytes, icons_dir: Path
) -> AchievementImportResult:
    """Read an archive and put every achievement in it into the catalogue.

    Matched **by id**: a known id is updated in place, an unknown one is created. That is
    what makes export → hand-edit → import a round trip, and what lets a built-in be shared
    between instances.

    `built_in` is not in the archive and is never written by one. An existing row keeps the
    flag it has — a built-in is updated by an import exactly the way `PATCH` updates it, its
    **conditions left alone**, and stays undeletable. A row an import *creates* is a built-in
    if and only if its id is one of the ids Wingman ships, so an archive cannot mint an
    undeletable achievement of its own — and one it creates under a shipped id is given the
    shipped conditions rather than the file's, so an `achievement.json` is never a way past
    the refusal `PATCH` gives.

    The archive is the whole description of the achievement it names, so an entry that
    brought no picture **clears** whatever picture the row had. Anything else would make
    importing the same archive twice mean two different things.

    Raises `ArchiveError` (from `archive.py`) for anything wrong with the file. The whole
    archive is parsed before a single row is written, so an import either happens or does
    not: there is no half-imported catalogue.

    Icons cannot join that transaction, so they are staged instead: every new picture is
    written beside the icons directory *before* the commit and moved in afterwards, and no
    picture that is already being served is touched until the commit has gone through. That
    is what makes a disk that fills up on the fifteenth achievement a request that changed
    nothing, rather than one that answers "nothing happened" having already deleted the first
    fourteen pictures.
    """
    # In a thread like `build_archive`: unpacking is up to `MAX_UNCOMPRESSED_BYTES` of
    # decompression, and the event loop is what carries the host screen's socket.
    parsed = await anyio.to_thread.run_sync(read_archive, data)
    # Every picture checked before a single row is written, so a bad one in the last
    # directory cannot leave the first sixteen achievements imported.
    extensions = {entry.achievement.id: _icon_extension(entry) for entry in parsed}
    staging = icons_dir / f".importing-{uuid.uuid4().hex}"
    try:
        staged = await _stage_icons(staging, parsed, extensions)
        created: list[str] = []
        updated: list[str] = []
        # One query rather than one per created row: the rows this loop adds are not flushed,
        # so asking the database again would give every one of them the same place in the
        # list.
        next_order = await _next_sort_order(session)
        for entry in parsed:
            file = entry.achievement
            achievement = await session.get(Achievement, file.id)
            shipped = builtin.BY_ID.get(file.id)
            if achievement is None:
                achievement = Achievement(
                    id=file.id,
                    # The id is the only thing that may say a row is one of the shipped set.
                    built_in=shipped is not None,
                    sort_order=next_order,
                )
                next_order += 1
                session.add(achievement)
                created.append(file.id)
                # A built-in this import *creates* — a row somebody removed behind Wingman's
                # back — is given the conditions Wingman ships rather than the archive's, so
                # the shipped seventeen mean the same thing in every instance whichever way
                # they got there.
                achievement.definition = (
                    dump_definition(file.definition)
                    if shipped is None
                    else deepcopy(shipped.definition)
                )
            else:
                updated.append(file.id)
                if achievement.built_in:
                    # An archive never rewrites what a built-in asks for: an
                    # `achievement.json` in a text file would otherwise be a way straight
                    # past the refusal `PATCH` gives. Said out loud in the log when the file
                    # really did carry other conditions, because the answer only counts the
                    # row as updated.
                    if achievement.definition != dump_definition(file.definition):
                        logger.info(
                            "the archive's conditions for the built-in '%s' were left "
                            "alone: what one of the shipped achievements asks for is not "
                            "something an import may change",
                            file.id,
                        )
                else:
                    achievement.definition = dump_definition(file.definition)
            achievement.name = file.name
            achievement.description = file.description
            achievement.icon = file.icon
            achievement.color = file.color
            achievement.hidden = file.hidden
            achievement.enabled = file.enabled
            if file.sort_order is not None:
                # The one other write over `sort_order` besides `reorder_achievements`, and
                # it stays one: an archive is a whole set of rows carrying a coherent order
                # from the instance that exported them — the same kind of write as a
                # permutation, not the single-row poke `PATCH` no longer allows. What it can
                # leave behind is two rows on one number, which the listings already settle
                # the same way every time (`sort_order`, then `created_at`) and which the
                # next arrangement washes out. Dropping the field instead would make
                # export → import stop being a fixed point over the order.
                achievement.sort_order = file.sort_order
            picture = staged.get(file.id)
            achievement.icon_file = None if picture is None else str(icons_dir / picture.name)
        await session.commit()
        await _apply_icons(icons_dir, staged, [entry.achievement.id for entry in parsed])
    finally:
        await _discard_staging(staging)
    logger.info("imported %d achievement(s) from an archive", len(parsed))
    # One broadcast for the whole archive, not one per row: every client refetches the
    # catalogue on it, and seventeen of those would be sixteen wasted round trips.
    await event_bus.broadcast(AchievementsChanged())
    return AchievementImportResult(created=created, updated=updated)


async def _stage_icons(
    staging: Path, parsed: list[ArchivedAchievement], extensions: dict[str, str | None]
) -> dict[str, Path]:
    """Every picture the archive brought, written where nothing serves it yet.

    Writing is the step that runs out of disk, so it happens while rolling the transaction
    back is still free. A directory of its own rather than a temporary suffix beside the real
    files: `images.remove_images` drops everything matching `<id>.*`, and a half-written
    `<id>.png.part` is exactly what that would sweep away.
    """
    staged: dict[str, Path] = {}
    for entry in parsed:
        extension = extensions[entry.achievement.id]
        if entry.icon_image is None or extension is None:
            continue
        staged[entry.achievement.id] = await store_image(
            staging, entry.achievement.id, extension, entry.icon_image.data
        )
    return staged


async def _apply_icons(icons_dir: Path, staged: dict[str, Path], imported: list[str]) -> None:
    """Move the staged pictures to where they are served from, and drop the ones the archive
    replaced with nothing.

    After the commit, so what is left to go wrong is a rename rather than a write. One that
    does fail leaves a row naming a file that is not there — the state a picture deleted
    behind Wingman's back already leaves, which every reader of an icon answers with a 404
    and which re-importing the archive puts right. Raising here instead would fail a request
    whose achievements are already in the catalogue, which would be the less true answer.
    """
    for achievement_id in imported:
        try:
            await remove_images(icons_dir, achievement_id)
            picture = staged.get(achievement_id)
            if picture is not None:
                await anyio.to_thread.run_sync(picture.replace, icons_dir / picture.name)
        except OSError:
            logger.exception("could not put the imported icon of '%s' in place", achievement_id)


async def _discard_staging(staging: Path) -> None:
    """Whatever is left of the staging directory, whether the import got through or not."""
    await anyio.to_thread.run_sync(lambda: shutil.rmtree(staging, ignore_errors=True))


def _icon_extension(entry: ArchivedAchievement) -> str | None:
    """The extension one archived picture may be stored under, or `None` when it brought
    none.

    A picture out of an archive goes through exactly the rules an upload does — the same
    allowlist, the same byte cap and the same pixel cap, out of `images.py`. The member's own
    extension says which content type its bytes claim to be, and `validate_image` is what
    makes the bytes agree with it: an `icon.png` holding something else is refused here
    rather than served as a png later.
    """
    if entry.icon_image is None:
        return None
    try:
        return validate_image(IMAGE_MEDIA_TYPES[entry.icon_image.extension], entry.icon_image.data)
    except (ImageTypeError, ImageTooLargeError, ImageTooManyPixelsError) as error:
        raise ArchiveIconError(entry.achievement.id, str(error)) from error


async def _icon_image(achievement: Achievement) -> ArchiveImage | None:
    """The uploaded picture behind one row, read off the disk for an export.

    Uploads only, never the shipped picture of a built-in (`pictures.py`): every instance
    already has those, and carrying one would turn export → import on the same instance
    from the fixed point the archive promises into an uploaded copy of a shipped file.
    """
    if achievement.icon_file is None:
        return None
    path = Path(achievement.icon_file)
    extension = path.suffix.lower()
    if extension not in IMAGE_MEDIA_TYPES:
        return None
    data = await anyio.to_thread.run_sync(_read_if_file, path)
    return None if data is None else ArchiveImage(extension=extension, data=data)


def _read_if_file(path: Path) -> bytes | None:
    return path.read_bytes() if path.is_file() else None


async def _next_sort_order(session: AsyncSession) -> int:
    highest = await session.scalar(select(func.max(Achievement.sort_order)))
    return 0 if highest is None else int(highest) + 1


def start_full_pass(
    session_factory: async_sessionmaker[AsyncSession], reason: str
) -> "asyncio.Task[dict[str, list[str]]]":
    """Recompute every player, without making the request that caused it wait.

    A definition that changed can award or revoke a badge for everybody who ever sang, which
    is a query per player — the editor must not sit through that. A task per write rather
    than one shared task like the library scan: a second edit has to be recomputed too, and
    `_write_lock` already serialises them, so they queue instead of racing.

    Nothing is broadcast when one finishes. `achievements.earned` belongs to a sing and a
    pass over the whole record has no sing to name — and the write that started this pass has
    already sent `achievements.changed`, which is what a client refetches on.
    """
    task = asyncio.create_task(_full_pass(session_factory, reason))
    _passes.add(task)
    task.add_done_callback(_pass_finished)
    return task


async def wait_for_passes() -> None:
    """Let whatever is queued finish — what a test waits on instead of sleeping."""
    while _passes:
        await asyncio.gather(*list(_passes), return_exceptions=True)


async def stop_passes() -> None:
    """Cancel what is still running, so no pass outlives the database engine."""
    pending = list(_passes)
    _passes.clear()
    for task in pending:
        task.cancel()
    for task in pending:
        # Whatever it was doing, it is being shut down: the cancellation is expected and a
        # failure is already on the done callback's log.
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task


async def _full_pass(
    session_factory: async_sessionmaker[AsyncSession], reason: str
) -> dict[str, list[str]]:
    async with session_factory() as session:
        earned = await evaluate_all(session)
    logger.info("achievements recomputed for %d player(s) after %s", len(earned), reason)
    return earned


def _pass_finished(task: "asyncio.Task[dict[str, list[str]]]") -> None:
    _passes.discard(task)
    if task.cancelled():
        return
    error = task.exception()
    if error is not None:
        logger.error("recomputing the achievements failed", exc_info=error)
