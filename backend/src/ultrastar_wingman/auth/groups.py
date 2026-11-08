"""Permission groups and who is in them (docs/dev/permission-groups.md). Knows nothing about
FastAPI.

A group is a bundle of capabilities (`group_capabilities`), and an account holds User's
bundle plus the bundles of every group a `user_groups` row puts it in. Three groups are
built in — Guest, User, Admin — and everything else is the host's.

Every write here is held to the two rules of §5, on the *change* and never on the body
(both writes carry a whole set, so the stored set is what they are compared with):

1. **Admin is an administrator's.** Putting somebody in Admin, taking somebody out of it,
   and deleting an account that is in it need an administrator (`AdminRequiredError`).
2. **Nobody but an administrator hands out a right they do not hold.** A capability added to
   a group, and a group somebody is added to, must be covered by what the caller holds
   (`MissingPermissionError`, naming the first missing capability in catalogue order).
   Taking away is free.

The caller is handed in as what it holds (`held`) and whether it is an administrator
(`is_admin`), the `tags.Viewer` split: the `Principal` is FastAPI's and stays in `deps.py`.
"""

import logging
from collections.abc import Collection, Iterable, Sequence
from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..events import GroupsChanged, TagsChanged, event_bus
from ..tags.model import TagPermission
from .model import Group, GroupCapability, User, UserGroup
from .permissions import (
    ADMIN,
    ALL_CAPABILITIES,
    BUILT_IN_GROUPS,
    CAPABILITIES,
    GUEST,
    USER,
    AdminNotEditableError,
    BuiltInGroupError,
    NotAssignableError,
    UnknownCapabilityError,
    UnknownGroupError,
    all_group_capabilities,
    invalidate_cache,
)
from .schema import GroupList, GroupRead, GroupRef

logger = logging.getLogger(__name__)

# SQLite's `lower()` folds ASCII alone, and the name index is built on it; sorting with the
# same fold keeps the listed order the one the index would give.
_ASCII_LOWER = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")


class DuplicateGroupNameError(ValueError):
    def __init__(self, name: str) -> None:
        super().__init__(f"a group called '{name}' already exists")
        self.name = name


class AdminRequiredError(PermissionError):
    """Rule 1: only an administrator changes who is in Admin."""

    def __init__(self) -> None:
        super().__init__("only an administrator changes who is in Admin")


class MissingPermissionError(PermissionError):
    """Rule 2: the caller would hand out `capability`, which they do not hold."""

    def __init__(self, capability: str) -> None:
        super().__init__(f"you do not hold '{capability}' yourself")
        self.capability = capability


class LastAdminError(ValueError):
    def __init__(self) -> None:
        super().__init__("the last administrator cannot leave Admin or be deleted")


@dataclass(frozen=True)
class Caller:
    """Who is writing, as the rules need them: what they hold on this request, and whether
    they are an administrator (the host screen or a member of Admin)."""

    held: frozenset[str]
    is_admin: bool


def is_built_in(group_id: str) -> bool:
    return group_id in BUILT_IN_GROUPS


def _rank(group_id: str) -> int:
    """§2.5: Guest, User, everything else, Admin last — the one that is not edited."""
    if group_id == GUEST:
        return 0
    if group_id == USER:
        return 1
    if group_id == ADMIN:
        return 3
    return 2


def order_key(group_id: str, name: str) -> tuple[int, str, str]:
    """The one order every list of groups is drawn and answered in (§2.5)."""
    return (_rank(group_id), name.translate(_ASCII_LOWER), group_id)


def _in_catalogue_order(capabilities: Collection[str]) -> list[str]:
    return [capability for capability in CAPABILITIES if capability in capabilities]


async def _names(session: AsyncSession) -> dict[str, str]:
    """group id -> name, every group there is."""
    return {group.id: group.name for group in await session.scalars(select(Group))}


async def group_refs(session: AsyncSession, group_ids: Collection[str]) -> list[GroupRef]:
    """The groups behind `group_ids`, by name and in the one order. An id that names no group
    any more (a hand-edited row) is left out rather than listed under a name it does not have."""
    names = await _names(session)
    present = [group_id for group_id in group_ids if group_id in names]
    return [
        GroupRef(id=group_id, name=names[group_id])
        for group_id in sorted(present, key=lambda group_id: order_key(group_id, names[group_id]))
    ]


async def member_group_ids(session: AsyncSession, user_id: str) -> frozenset[str]:
    """The groups an account has a row in, joined to `groups` so a row naming a group that is
    gone gives nothing. Read on every request by `deps.current_principal` — one query on the
    primary key's leading column — and never cached, so a membership change reaches that
    account's next request with nothing to invalidate (§4)."""
    return frozenset(
        await session.scalars(
            select(UserGroup.group_id)
            .join(Group, Group.id == UserGroup.group_id)
            .where(UserGroup.user_id == user_id)
        )
    )


async def groups_of(session: AsyncSession, user_id: str) -> list[str]:
    """The account's explicit memberships, as ids in the one order — never `user`."""
    return [ref.id for ref in await group_refs(session, await member_group_ids(session, user_id))]


async def memberships(session: AsyncSession) -> dict[str, list[str]]:
    """user id -> its explicit memberships in the one order, for listing every account
    without a query per row. An account in no group is absent."""
    rows = await session.execute(
        select(UserGroup.user_id, Group.id, Group.name).join(Group, Group.id == UserGroup.group_id)
    )
    grouped: dict[str, list[tuple[str, str]]] = {}
    for user_id, group_id, name in rows:
        grouped.setdefault(user_id, []).append((group_id, name))
    return {
        user_id: [group_id for group_id, _ in sorted(pairs, key=lambda pair: order_key(*pair))]
        for user_id, pairs in grouped.items()
    }


async def admin_count(session: AsyncSession) -> int:
    """How many accounts are in Admin — rows whose account still exists. The host screen is
    an administrator without a row and never counts: it is one browser, and its token works
    once per start."""
    return (
        await session.scalar(
            select(func.count())
            .select_from(UserGroup)
            .join(User, User.id == UserGroup.user_id)
            .where(UserGroup.group_id == ADMIN)
        )
        or 0
    )


async def _member_counts(session: AsyncSession) -> dict[str, int]:
    """group id -> how many existing accounts have a row in it, in one GROUP BY."""
    return {
        group_id: count
        for group_id, count in await session.execute(
            select(UserGroup.group_id, func.count())
            .join(User, User.id == UserGroup.user_id)
            .group_by(UserGroup.group_id)
        )
    }


def _can_assign(group_id: str, carried: frozenset[str], caller: Caller) -> bool:
    if group_id in (GUEST, USER):
        return False
    if caller.is_admin:
        return True
    if group_id == ADMIN:
        return False
    return carried <= caller.held


def _right_count(group_id: str, carried: frozenset[str], user_rights: frozenset[str]) -> int | None:
    if group_id == ADMIN:
        return None
    if group_id in (GUEST, USER):
        return len(carried)
    return len(carried - user_rights)


async def read_groups(
    session: AsyncSession, caller: Caller, manages: bool, only: str | None = None
) -> list[GroupRead]:
    """Every group (or the one `only` names) as `caller` may see it, in the one order.
    `manages` is `permissions.manage`: only such a caller is told each group's capabilities."""
    groups = list(await session.scalars(select(Group)))
    mapping = await all_group_capabilities(session)
    counts = await _member_counts(session)
    accounts = await session.scalar(select(func.count()).select_from(User)) or 0
    user_rights = mapping.get(USER, frozenset())
    reads = []
    for group in sorted(groups, key=lambda group: order_key(group.id, group.name)):
        if only is not None and group.id != only:
            continue
        carried = mapping.get(group.id, frozenset())
        member_count: int | None
        if group.id == GUEST:
            member_count = None
        elif group.id == USER:
            member_count = accounts
        else:
            member_count = counts.get(group.id, 0)
        reads.append(
            GroupRead(
                id=group.id,
                name=group.name,
                built_in=is_built_in(group.id),
                member_count=member_count,
                capabilities=_in_catalogue_order(carried) if manages else None,
                right_count=_right_count(group.id, carried, user_rights),
                can_assign=_can_assign(group.id, carried, caller),
            )
        )
    return reads


async def list_groups(session: AsyncSession, caller: Caller, manages: bool) -> GroupList:
    return GroupList(
        groups=await read_groups(session, caller, manages),
        capabilities=list(CAPABILITIES) if manages else None,
    )


async def read_group(
    session: AsyncSession, group: Group, caller: Caller, manages: bool
) -> GroupRead:
    return (await read_groups(session, caller, manages, only=group.id))[0]


def _check_capabilities(capabilities: Iterable[str]) -> frozenset[str]:
    """Raises `UnknownCapabilityError` for the first name the catalogue does not hold."""
    requested = frozenset(capabilities)
    unknown = next((name for name in sorted(requested) if name not in ALL_CAPABILITIES), None)
    if unknown is not None:
        raise UnknownCapabilityError(unknown)
    return requested


def _check_hand_out(added: Collection[str], caller: Caller) -> None:
    """Rule 2 over what is being handed out: raises `MissingPermissionError` for the first
    capability, in catalogue order, the caller does not hold."""
    if caller.is_admin:
        return
    missing = next(
        (
            capability
            for capability in CAPABILITIES
            if capability in added and capability not in caller.held
        ),
        None,
    )
    if missing is not None:
        raise MissingPermissionError(missing)


async def _check_name(session: AsyncSession, name: str, group_id: str | None) -> None:
    """Raises `DuplicateGroupNameError`. Case-insensitive like the index behind it, and the
    built-ins are rows, so "admin" clashes with Admin without a list of reserved words."""
    query = select(Group.id).where(func.lower(Group.name) == name.translate(_ASCII_LOWER))
    if group_id is not None:
        query = query.where(Group.id != group_id)
    if await session.scalar(query) is not None:
        raise DuplicateGroupNameError(name)


async def _commit_named(session: AsyncSession, name: str) -> None:
    """Commit a write that names a group. The index on `lower(name)` is the authority, so a
    name taken between the check and the write is the same refusal, not a 500."""
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise DuplicateGroupNameError(name) from error


async def create_group(
    session: AsyncSession, name: str, capabilities: Sequence[str], caller: Caller
) -> Group:
    """A new group with its name and its capabilities in one write, so it never exists half
    made. Raises `UnknownCapabilityError`, `MissingPermissionError` or
    `DuplicateGroupNameError`."""
    name = name.strip()
    requested = _check_capabilities(capabilities)
    _check_hand_out(requested, caller)
    await _check_name(session, name, None)
    group = Group(name=name)
    session.add(group)
    try:
        # The id is a column default, so it only exists once the row reaches the database.
        await session.flush()
    except IntegrityError as error:
        await session.rollback()
        raise DuplicateGroupNameError(name) from error
    session.add_all(
        GroupCapability(group_id=group.id, capability=capability) for capability in requested
    )
    await _commit_named(session, name)
    invalidate_cache()
    logger.info("Group '%s' created", group.name)
    await event_bus.broadcast(GroupsChanged())
    return group


async def update_group(
    session: AsyncSession,
    group: Group,
    caller: Caller,
    name: str | None = None,
    capabilities: Sequence[str] | None = None,
) -> Group:
    """Rename a group, set its capabilities, or both — a PATCH touches what it names.

    Raises `BuiltInGroupError` (a name for a built-in), `AdminNotEditableError` (capabilities
    for Admin), `UnknownCapabilityError`, `MissingPermissionError` (rule 2, over the
    capabilities being *added* only) or `DuplicateGroupNameError`.
    """
    if name is not None and is_built_in(group.id):
        raise BuiltInGroupError(group.id)
    if capabilities is not None and group.id == ADMIN:
        raise AdminNotEditableError
    stored = frozenset(
        await session.scalars(
            select(GroupCapability.capability).where(GroupCapability.group_id == group.id)
        )
    )
    requested = None if capabilities is None else _check_capabilities(capabilities)
    if requested is not None:
        _check_hand_out(requested - stored, caller)
    if name is not None:
        name = name.strip()
        await _check_name(session, name, group.id)

    old_name = group.name
    renamed = name is not None and name != group.name
    rights_changed = requested is not None and requested != stored
    if not renamed and not rights_changed:
        return group
    if renamed and name is not None:
        group.name = name
    if requested is not None and rights_changed:
        await session.execute(
            delete(GroupCapability).where(
                GroupCapability.group_id == group.id,
                GroupCapability.capability.not_in(requested),
            )
        )
        session.add_all(
            GroupCapability(group_id=group.id, capability=capability)
            for capability in requested - stored
        )
    await _commit_named(session, group.name)
    if renamed:
        logger.info("Group '%s' is now called '%s'", old_name, group.name)
    if rights_changed:
        invalidate_cache()
        logger.info("The rights of the group %s changed", group.name)
    await event_bus.broadcast(GroupsChanged())
    return group


async def delete_group(session: AsyncSession, group: Group) -> None:
    """The group, its capabilities, its memberships and its tag rows, in one transaction. Its
    members lose what it gave them and nothing else. Raises `BuiltInGroupError`."""
    if is_built_in(group.id):
        raise BuiltInGroupError(group.id)
    tag_rows = await session.scalar(
        select(func.count()).select_from(TagPermission).where(TagPermission.group_id == group.id)
    )
    await session.execute(delete(GroupCapability).where(GroupCapability.group_id == group.id))
    await session.execute(delete(UserGroup).where(UserGroup.group_id == group.id))
    await session.execute(delete(TagPermission).where(TagPermission.group_id == group.id))
    name = group.name
    await session.delete(group)
    await session.commit()
    invalidate_cache()
    logger.info("Group '%s' deleted", name)
    await event_bus.broadcast(GroupsChanged())
    if tag_rows:
        # Who may see which tag changed with it — the songs a deleted group was the only way
        # to see included — and every open tag listing has to say so.
        await event_bus.broadcast(TagsChanged())


def _joined(names: Sequence[str]) -> str:
    if len(names) == 1:
        return names[0]
    return f"{', '.join(names[:-1])} and {names[-1]}"


async def set_user_groups(
    session: AsyncSession, user: User, requested: Sequence[str], caller: Caller
) -> None:
    """Put the account in exactly `requested` — its whole set of explicit memberships.

    The one write path for memberships, so both rules and the last-admin count live here.
    Raises, before anything is written: `NotAssignableError` (User, Guest), `UnknownGroupError`,
    `AdminRequiredError` (rule 1), `MissingPermissionError` (rule 2, over the groups being
    *added*), `LastAdminError`.
    """
    names = await _names(session)
    wanted: set[str] = set()
    for group_id in requested:
        if group_id in (USER, GUEST):
            raise NotAssignableError(group_id)
        if group_id not in names:
            raise UnknownGroupError(group_id)
        wanted.add(group_id)
    # Every stored row, a stale one included: one that is not in the body goes.
    stored = set(
        await session.scalars(select(UserGroup.group_id).where(UserGroup.user_id == user.id))
    )
    added = wanted - stored
    removed = stored - wanted
    if not added and not removed:
        return
    if ADMIN in added | removed and not caller.is_admin:
        raise AdminRequiredError
    if not caller.is_admin:
        mapping = await all_group_capabilities(session)
        for group_id in sorted(added, key=lambda group_id: order_key(group_id, names[group_id])):
            _check_hand_out(mapping.get(group_id, frozenset()), caller)
    if ADMIN in removed and await admin_count(session) <= 1:
        raise LastAdminError

    if removed:
        await session.execute(
            delete(UserGroup).where(UserGroup.user_id == user.id, UserGroup.group_id.in_(removed))
        )
    session.add_all(UserGroup(user_id=user.id, group_id=group_id) for group_id in added)
    await session.commit()
    now_in = [
        names[group_id]
        for group_id in sorted(wanted, key=lambda group_id: order_key(group_id, names[group_id]))
    ]
    if now_in:
        logger.info("'%s' is in %s now", user.username, _joined(now_in))
    else:
        logger.info("'%s' is in no group now", user.username)
    await event_bus.broadcast(GroupsChanged())
