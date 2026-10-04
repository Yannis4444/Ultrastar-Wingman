"""Tags, their permissions, and which songs carry them. Knows nothing about FastAPI.

The caller is passed around as a `Viewer` — a role and, when there is an account behind
the request, its id. The FastAPI dependency that builds one lives in `auth.deps`, which
this module must not import.
"""

import logging
from collections.abc import Collection, Iterable, Sequence
from dataclasses import dataclass
from typing import cast

from sqlalchemy import ColumnElement, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.model import User
from ..auth.permissions import ADMIN, DEFAULT_ROLE, ROLES, UnknownRoleError
from ..events import SongTagsChanged, TagsChanged, event_bus
from ..songs.model import Song
from .model import SongTag, Tag, TagPermission
from .schema import TagAction, TagAssignment, TagPermissionRead, TagRead

logger = logging.getLogger(__name__)

# Holding `tags.manage` is the right to create a tag and to say who it is for. It is
# deliberately not the right to *use* one: a manager who never gave themselves `assign`
# cannot tag songs with it, exactly like everybody else.
MANAGE_CAPABILITY = "tags.manage"


class DuplicateTagNameError(ValueError):
    def __init__(self, name: str) -> None:
        super().__init__(f"a tag called '{name}' already exists")
        self.name = name


class UnknownUserError(LookupError):
    def __init__(self, user_id: str) -> None:
        super().__init__(f"unknown user '{user_id}'")
        self.user_id = user_id


@dataclass(frozen=True)
class Viewer:
    """Who is asking. `user_id` is None for the host screen and for every anonymous
    caller — the host is an administrator by device, so it never needs a per-user row."""

    role: str
    user_id: str | None


# The viewer for everything Wingman does with no account behind it at all: the player
# selector's start button, and the background music picking the room's next song. What such
# a caller may reach is what a party guest may see — and it matters twice over for the
# music, whose pick is broadcast on the anonymous socket.
#
# It lives here rather than in either caller because a constant that decides what a stranger
# may see should have exactly one copy.
GUEST_VIEWER = Viewer(role=DEFAULT_ROLE, user_id=None)


@dataclass(frozen=True)
class PermissionSpec:
    """One row a manager asked for. Exactly one of `role` and `user_id` is set — the
    request model enforces that, so the service only has to check they exist."""

    action: TagAction
    role: str | None = None
    user_id: str | None = None


@dataclass(frozen=True)
class TagRights:
    """What one caller may do with one tag."""

    # False means the tag is not there as far as this caller is concerned.
    can_view: bool
    # False hides every song carrying the tag, everywhere.
    can_see_songs: bool
    can_assign: bool


class _Unset:
    """Marker for a PATCH field the request did not mention. `None` cannot serve: for a
    nullable column it is a value the caller may well be sending on purpose."""


UNSET = _Unset()


def allowed(rows: Iterable[TagPermission], action: str, viewer: Viewer) -> bool:
    """Whether `viewer` holds `action` on the tag those rows belong to.

    Roles are bundles, not a ladder: a row for `trusted` says nothing about `admin`, which
    is why "trusted and above" is stored as one row per role. The one exception is `admin`
    itself, which is not data anywhere in Wingman — an administrator sees every tag.
    """
    if viewer.role == ADMIN:
        return True
    for row in rows:
        if row.action != action:
            continue
        if row.role is not None and row.role == viewer.role:
            return True
        if viewer.user_id is not None and row.user_id == viewer.user_id:
            return True
    return False


def rights_for(rows: Iterable[TagPermission], viewer: Viewer) -> TagRights:
    """`assign` needs `view` as well: setting a tag you are not allowed to know about
    would tell you it exists the moment you tried."""
    rows = list(rows)
    can_view = allowed(rows, "view", viewer)
    return TagRights(
        can_view=can_view,
        can_see_songs=allowed(rows, "view_songs", viewer),
        can_assign=can_view and allowed(rows, "assign", viewer),
    )


def _subject(viewer: Viewer) -> ColumnElement[bool]:
    """Match the permission rows that speak for this caller. `user_id == None` would be
    wrong rather than empty: it matches every role row, whose `user_id` is NULL."""
    if viewer.user_id is None:
        return TagPermission.role == viewer.role
    return or_(TagPermission.role == viewer.role, TagPermission.user_id == viewer.user_id)


async def permission_rows(
    session: AsyncSession, tag_ids: Collection[str] | None = None
) -> dict[str, list[TagPermission]]:
    """tag id -> its rows. Every tag with no row at all is simply absent, which reads as
    "nobody but an administrator"."""
    query = select(TagPermission)
    if tag_ids is not None:
        if not tag_ids:
            return {}
        query = query.where(TagPermission.tag_id.in_(tag_ids))
    rows: dict[str, list[TagPermission]] = {}
    for row in await session.scalars(query.order_by(TagPermission.id)):
        rows.setdefault(row.tag_id, []).append(row)
    return rows


async def all_tags(session: AsyncSession) -> Sequence[Tag]:
    """Every tag, by name — case-insensitively, so "Broken" sorts where a reader expects."""
    result = await session.scalars(select(Tag).order_by(func.lower(Tag.name), Tag.id))
    return result.all()


async def _song_counts(session: AsyncSession, tag_ids: Collection[str]) -> dict[str, int]:
    """tag id -> how many songs carry it. A tag nobody has used is absent.

    Over every `song_tags` row, whoever is asking: a count is not a listing, and the tag
    admin has to be told the size of what it manages even where `view_songs` would keep
    the songs themselves back. Joined against `songs` so a tag left on a song that has
    left the library is not counted — the same rows `assignments` drops as orphans.
    """
    if not tag_ids:
        return {}
    return {
        tag_id: count
        for tag_id, count in await session.execute(
            select(SongTag.tag_id, func.count())
            .join(Song, Song.id == SongTag.song_id)
            .where(SongTag.tag_id.in_(tag_ids))
            .group_by(SongTag.tag_id)
        )
    }


async def _usernames(session: AsyncSession, user_ids: Collection[str]) -> dict[str, str]:
    if not user_ids:
        return {}
    return {
        user.id: user.username
        for user in await session.scalars(select(User).where(User.id.in_(user_ids)))
    }


def _read_permissions(
    rows: Iterable[TagPermission], usernames: dict[str, str]
) -> list[TagPermissionRead]:
    return [
        TagPermissionRead(
            # The CHECK constraint on the column is what keeps this cast honest.
            action=cast(TagAction, row.action),
            role=row.role,
            user_id=row.user_id,
            username=None if row.user_id is None else usernames.get(row.user_id),
        )
        for row in rows
    ]


def _read_tag(
    tag: Tag,
    rows: Sequence[TagPermission],
    rights: TagRights,
    usernames: dict[str, str],
    song_count: int,
    with_permissions: bool,
) -> TagRead:
    return TagRead(
        id=tag.id,
        name=tag.name,
        icon=tag.icon,
        color=tag.color,
        show_in_list=tag.show_in_list,
        hide_by_default=tag.hide_by_default,
        can_view=rights.can_view,
        can_assign=rights.can_assign,
        song_count=song_count,
        permissions=_read_permissions(rows, usernames) if with_permissions else None,
    )


async def read_tag(
    session: AsyncSession, tag: Tag, viewer: Viewer, with_permissions: bool
) -> TagRead:
    rows = (await permission_rows(session, [tag.id])).get(tag.id, [])
    usernames = await _usernames(session, [row.user_id for row in rows if row.user_id])
    counts = await _song_counts(session, [tag.id])
    return _read_tag(
        tag, rows, rights_for(rows, viewer), usernames, counts.get(tag.id, 0), with_permissions
    )


async def _listed(
    session: AsyncSession, viewer: Viewer, manages: bool
) -> list[tuple[Tag, list[TagPermission]]]:
    """The tags a listing shows this caller, with their permission rows.

    Everybody sees the tags they may view. A `tags.manage` holder sees every tag, viewable
    or not: managing a tag is not the same right as knowing it, and a manager who unticks
    their own *See tag* must not watch the tag vanish from the page they unticked it on.
    Each row carries `can_view`, so the reader-facing surfaces can drop the rest.
    """
    tags = await all_tags(session)
    rows = await permission_rows(session, [tag.id for tag in tags])
    listed = [(tag, rows.get(tag.id, [])) for tag in tags]
    if manages:
        return listed
    return [(tag, tag_rows) for tag, tag_rows in listed if allowed(tag_rows, "view", viewer)]


async def visible_tags(session: AsyncSession, viewer: Viewer, manages: bool) -> list[TagRead]:
    """The tags a listing shows this caller (see `_listed`). `manages` is the `tags.manage`
    half twice over: which accounts were named on a tag is a manager's business, nobody
    else's, and so is a tag they gave themselves no right to see."""
    listed = await _listed(session, viewer, manages)
    usernames = (
        await _usernames(
            session,
            {row.user_id for _, tag_rows in listed for row in tag_rows if row.user_id},
        )
        if manages
        else {}
    )
    counts = await _song_counts(session, [tag.id for tag, _ in listed])
    return [
        _read_tag(
            tag,
            tag_rows,
            rights_for(tag_rows, viewer),
            usernames,
            counts.get(tag.id, 0),
            manages,
        )
        for tag, tag_rows in listed
    ]


async def hidden_song_ids(session: AsyncSession, viewer: Viewer) -> frozenset[str]:
    """Every song this caller may not see, because it carries a tag whose `view_songs`
    they do not hold.

    Default-deny: a tag nobody was granted `view_songs` on hides its songs from everybody
    but an administrator, which is what makes "hide the broken ones" a single new tag with
    no rows rather than a setting. Cheap when nothing is tagged: two small queries and an
    empty set.
    """
    if viewer.role == ADMIN:
        return frozenset()
    tag_ids = set(await session.scalars(select(Tag.id)))
    if not tag_ids:
        return frozenset()
    granted = set(
        await session.scalars(
            select(TagPermission.tag_id).where(
                TagPermission.action == "view_songs", _subject(viewer)
            )
        )
    )
    denied = tag_ids - granted
    if not denied:
        return frozenset()
    return frozenset(
        await session.scalars(select(SongTag.song_id).where(SongTag.tag_id.in_(denied)))
    )


async def folded_song_ids(session: AsyncSession, viewer: Viewer) -> frozenset[str]:
    """Every song a `hide_by_default` tag folds away for this caller — the songs the song
    list keeps back until they ask, and the reel's *All songs* never lands on.

    A default and not a permission, so it is only ever applied to *this* caller's own
    copy of the phone's rule: a tag folds its songs away for the people who may `view` it
    (the client builds its criteria over the tags it can see, `tags.ts`'s
    `defaultTagCriteria`). A tag the caller may not know about folds nothing — and if it
    also keeps its songs back, that is `hidden_song_ids`, the stricter set, which every
    reel scope applies on top of this one.
    """
    folding = list(await session.scalars(select(Tag.id).where(Tag.hide_by_default.is_(True))))
    if not folding:
        return frozenset()
    rows = await permission_rows(session, folding)
    viewable = [tag_id for tag_id in folding if allowed(rows.get(tag_id, []), "view", viewer)]
    if not viewable:
        return frozenset()
    return frozenset(
        await session.scalars(select(SongTag.song_id).where(SongTag.tag_id.in_(viewable)))
    )


async def assignments(
    session: AsyncSession, viewer: Viewer, hidden: frozenset[str], manages: bool
) -> list[TagAssignment]:
    """Which songs carry which tag, over exactly the tags `visible_tags` lists — one
    listing without the other would leave the client holding assignments for a tag it
    never heard of, or a tag whose songs it cannot count.

    Joined against `songs` so a tag left on a song that is no longer in the library does
    not turn up as an id the client cannot resolve — and so that song keeps its tags for
    the day it comes back.
    """
    listed = [tag.id for tag, _ in await _listed(session, viewer, manages)]
    if not listed:
        return []
    grouped: dict[str, list[str]] = {tag_id: [] for tag_id in listed}
    for tag_id, song_id in await session.execute(
        select(SongTag.tag_id, SongTag.song_id)
        .join(Song, Song.id == SongTag.song_id)
        .where(SongTag.tag_id.in_(listed))
        .order_by(SongTag.tag_id, SongTag.song_id)
    ):
        if song_id not in hidden:
            grouped[tag_id].append(song_id)
    return [TagAssignment(tag_id=tag_id, song_ids=grouped[tag_id]) for tag_id in listed]


async def _check_name(session: AsyncSession, name: str, tag_id: str | None) -> None:
    """Raises `DuplicateTagNameError`. Case-insensitive, like the unique index behind it —
    which would otherwise turn a second "Broken" into a 500."""
    query = select(Tag).where(func.lower(Tag.name) == name.lower())
    if tag_id is not None:
        query = query.where(Tag.id != tag_id)
    clash = await session.scalar(query)
    if clash is not None:
        raise DuplicateTagNameError(name)


async def _check_subjects(session: AsyncSession, specs: Sequence[PermissionSpec]) -> None:
    """Raises `UnknownRoleError` / `UnknownUserError`. Called before anything is written,
    so a bad row in the body cannot leave half a tag behind."""
    user_ids = {spec.user_id for spec in specs if spec.user_id is not None}
    known = await _usernames(session, user_ids)
    for spec in specs:
        if spec.role is not None and spec.role not in ROLES:
            raise UnknownRoleError(spec.role)
        if spec.user_id is not None and spec.user_id not in known:
            raise UnknownUserError(spec.user_id)


def _rows_for(tag_id: str, specs: Sequence[PermissionSpec]) -> list[TagPermission]:
    """The rows to insert. The same row twice is one row: the unique index would make a
    body that repeats itself a 500 rather than the no-op it means."""
    seen: set[tuple[str, str | None, str | None]] = set()
    rows = []
    for spec in specs:
        key = (spec.action, spec.role, spec.user_id)
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            TagPermission(tag_id=tag_id, action=spec.action, role=spec.role, user_id=spec.user_id)
        )
    return rows


async def create_tag(
    session: AsyncSession,
    name: str,
    icon: str | None,
    color: str,
    show_in_list: bool,
    hide_by_default: bool,
    specs: Sequence[PermissionSpec],
) -> Tag:
    """Raises `DuplicateTagNameError`, `UnknownRoleError` or `UnknownUserError`."""
    await _check_name(session, name, None)
    await _check_subjects(session, specs)
    tag = Tag(
        name=name,
        icon=icon,
        color=color,
        show_in_list=show_in_list,
        hide_by_default=hide_by_default,
    )
    session.add(tag)
    # The id is a column default, so it only exists once the row reaches the database —
    # and the permission rows below have to carry it.
    await session.flush()
    session.add_all(_rows_for(tag.id, specs))
    await session.commit()
    logger.info("Tag '%s' created", name)
    await event_bus.broadcast(TagsChanged())
    return tag


async def update_tag(
    session: AsyncSession,
    tag: Tag,
    name: str | None = None,
    icon: str | None | _Unset = UNSET,
    color: str | None = None,
    show_in_list: bool | None = None,
    hide_by_default: bool | None = None,
) -> Tag:
    """Raises `DuplicateTagNameError`."""
    if name is not None:
        await _check_name(session, name, tag.id)
        tag.name = name
    if not isinstance(icon, _Unset):
        tag.icon = icon
    if color is not None:
        tag.color = color
    if show_in_list is not None:
        tag.show_in_list = show_in_list
    if hide_by_default is not None:
        tag.hide_by_default = hide_by_default
    await session.commit()
    await event_bus.broadcast(TagsChanged())
    return tag


async def replace_permissions(
    session: AsyncSession, tag: Tag, specs: Sequence[PermissionSpec]
) -> None:
    """Rewrite who the tag is for, in one transaction. Raises `UnknownRoleError` /
    `UnknownUserError` before anything is deleted."""
    await _check_subjects(session, specs)
    rows = _rows_for(tag.id, specs)
    await session.execute(delete(TagPermission).where(TagPermission.tag_id == tag.id))
    session.add_all(rows)
    await session.commit()
    logger.debug("tag %s now has %d permission rows", tag.id, len(rows))
    await event_bus.broadcast(TagsChanged())


async def delete_tag(session: AsyncSession, tag: Tag) -> None:
    """The tag, what it was put on, and who it was for."""
    await session.execute(delete(SongTag).where(SongTag.tag_id == tag.id))
    await session.execute(delete(TagPermission).where(TagPermission.tag_id == tag.id))
    await session.delete(tag)
    await session.commit()
    await event_bus.broadcast(TagsChanged())


async def assign(session: AsyncSession, tag: Tag, song: Song, user_id: str | None) -> None:
    """Put the tag on the song. Idempotent — the UI sends it on every click of a toggle,
    and a second click must not be an error."""
    if await session.get(SongTag, (tag.id, song.id)) is not None:
        return
    session.add(SongTag(tag_id=tag.id, song_id=song.id, user_id=user_id))
    await session.commit()
    await event_bus.broadcast(SongTagsChanged(song_id=song.id, tag_id=tag.id))


async def unassign(session: AsyncSession, tag: Tag, song: Song) -> None:
    """Take the tag off the song. Idempotent, for the same reason."""
    row = await session.get(SongTag, (tag.id, song.id))
    if row is None:
        return
    await session.delete(row)
    await session.commit()
    await event_bus.broadcast(SongTagsChanged(song_id=song.id, tag_id=tag.id))


async def delete_user_data(session: AsyncSession, user_id: str) -> None:
    """Drop the permission rows that named this account.

    Its `song_tags` rows stay: `user_id` there is attribution — who marked this song
    broken — and it survives the account exactly like a score's player does.

    Does not commit — `auth.service.delete_user` removes the account in the same
    transaction, so a half-deleted user cannot exist.
    """
    await session.execute(delete(TagPermission).where(TagPermission.user_id == user_id))
