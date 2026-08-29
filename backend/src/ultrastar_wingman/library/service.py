"""Wishlist, favorites and playlists. Knows nothing about FastAPI.

A wishlist owner is passed around as the pair `(user_id, guest_id)` with exactly one of
them set — the FastAPI dependency that resolves it lives in `auth.deps`, which this module
must not import.
"""

import logging
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import cast

from sqlalchemy import ColumnElement, delete, false, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.model import User, as_utc
from ..events import PlaylistsChanged, WishlistUpdated, event_bus
from ..players.model import Player
from ..songs.model import Song
from ..songs.schema import read_song
from .model import Favorite, Playlist, PlaylistEntry, PlaylistMember, Wish
from .schema import (
    MemberAccess,
    PlaylistAccess,
    PlaylistDetail,
    PlaylistEntryRead,
    PlaylistMemberRead,
    PlaylistRead,
    WishRead,
)

logger = logging.getLogger(__name__)

# Row-level, so it can never be a route dependency: it widens what its holder may do to
# every playlist they can already see, and to none they cannot.
MODERATE_CAPABILITY = "playlists.moderate"

# The member accesses that may add, remove and reorder songs. `admin` also renames,
# shares and deletes; the owner always does everything.
_EDITORS: tuple[str, ...] = ("write", "admin")

# The longest a playlist name may get, copies included.
MAX_NAME_LENGTH = 64

_COPY_SUFFIX = " (copy)"

# How many covers a playlist row's mosaic holds — the client draws a 2x2 of them.
COVER_SONGS = 4


class AlreadyWishedError(ValueError):
    def __init__(self, song_id: str) -> None:
        super().__init__(f"'{song_id}' is already wished for by this caller")
        self.song_id = song_id


class NotWishedError(LookupError):
    def __init__(self, song_id: str) -> None:
        super().__init__(f"this caller has no wish for '{song_id}'")
        self.song_id = song_id


class DuplicateEntryError(ValueError):
    def __init__(self, song_id: str) -> None:
        super().__init__(f"'{song_id}' is already in this playlist")
        self.song_id = song_id


class UnknownEntryError(LookupError):
    def __init__(self, song_id: str) -> None:
        super().__init__(f"'{song_id}' is not in this playlist")
        self.song_id = song_id


class OrderMismatchError(ValueError):
    def __init__(self) -> None:
        super().__init__("the new order must be a permutation of the playlist's songs")


class AlreadyOwnerError(ValueError):
    """The owner is the implicit admin of their own list; a member row would say less."""

    def __init__(self, user_id: str) -> None:
        super().__init__(f"'{user_id}' already owns this playlist")
        self.user_id = user_id


class NotAMemberError(LookupError):
    def __init__(self, user_id: str) -> None:
        super().__init__(f"'{user_id}' is not a member of this playlist")
        self.user_id = user_id


def _owner(user_id: str | None, guest_id: str | None) -> ColumnElement[bool]:
    """Match the wishes of one owner."""
    if user_id is not None:
        return Wish.user_id == user_id
    if guest_id is not None:
        return Wish.guest_id == guest_id
    # An anonymous browser with no cookie yet owns nothing. Falling through to
    # `guest_id IS NULL` would match every account's wishes instead.
    return false()


async def _find_wish(
    session: AsyncSession, song_id: str, user_id: str | None, guest_id: str | None
) -> Wish | None:
    return await session.scalar(
        select(Wish).where(Wish.song_id == song_id, _owner(user_id, guest_id))
    )


async def _aggregate(session: AsyncSession, song_id: str) -> tuple[int, datetime | None]:
    count, latest = (
        await session.execute(
            select(func.count(), func.max(Wish.created_at)).where(Wish.song_id == song_id)
        )
    ).one()
    return count, None if latest is None else as_utc(latest)


async def _broadcast(session: AsyncSession, song_id: str) -> tuple[int, datetime | None]:
    """Announce a song's new wish count and return it. `count` is 0 once the last wish
    for a song is gone — the UI has to drop the row."""
    count, latest = await _aggregate(session, song_id)
    await event_bus.broadcast(WishlistUpdated(song_id=song_id, count=count, latest=latest))
    return count, latest


async def wishlist(
    session: AsyncSession, user_id: str | None, guest_id: str | None
) -> list[WishRead]:
    """Every wished song, most-wanted first. Aggregated in SQL: the counts are what the
    party votes with, and `mine` is the only per-caller part."""
    mine = set(await session.scalars(select(Wish.song_id).where(_owner(user_id, guest_id))))
    counts = {
        song_id: (count, as_utc(latest))
        for song_id, count, latest in await session.execute(
            select(Wish.song_id, func.count(), func.max(Wish.created_at)).group_by(Wish.song_id)
        )
    }
    # A wish whose song left the library keeps its row but drops out of the listing.
    songs = await session.scalars(select(Song).where(Song.id.in_(counts)))
    wishes = [
        WishRead(
            song=read_song(song),
            count=counts[song.id][0],
            latest=counts[song.id][1],
            mine=song.id in mine,
        )
        for song in songs
    ]
    # Most wished for first, then most recently wished for; the id only breaks ties so the
    # order is stable across requests.
    wishes.sort(key=lambda wish: (-wish.count, -wish.latest.timestamp(), wish.song.id))
    return wishes


async def add_wish(
    session: AsyncSession, song: Song, user_id: str | None, guest_id: str | None
) -> WishRead:
    """Wish for a song. Raises `AlreadyWishedError` — two different people wishing for the
    same song is the normal case, the same one twice is not."""
    if await _find_wish(session, song.id, user_id, guest_id) is not None:
        raise AlreadyWishedError(song.id)
    wish = Wish(song_id=song.id, user_id=user_id, guest_id=guest_id)
    session.add(wish)
    await session.commit()
    count, _ = await _broadcast(session, song.id)
    # Nothing can be newer than the row just written, so this is the aggregate's `latest`.
    return WishRead(song=read_song(song), count=count, latest=as_utc(wish.created_at), mine=True)


async def remove_wish(
    session: AsyncSession, song_id: str, user_id: str | None, guest_id: str | None
) -> None:
    """Take back the caller's own wish, never anybody else's. Raises `NotWishedError`."""
    wish = await _find_wish(session, song_id, user_id, guest_id)
    if wish is None:
        raise NotWishedError(song_id)
    await session.delete(wish)
    await session.commit()
    await _broadcast(session, song_id)


async def clear_wishes(session: AsyncSession, song_id: str) -> int:
    """Drop every wish for a song, whoever made it — the moderation counterpart to
    `remove_wish`. Returns how many went; 0 means the song was not wished for at all.
    """
    wish_ids = list(await session.scalars(select(Wish.id).where(Wish.song_id == song_id)))
    if not wish_ids:
        return 0
    await session.execute(delete(Wish).where(Wish.id.in_(wish_ids)))
    await session.commit()
    await _broadcast(session, song_id)
    logger.info("every wish for '%s' cleared (%d)", song_id, len(wish_ids))
    return len(wish_ids)


async def clear_fulfilled_wishes(
    session: AsyncSession, song_id: str, user_ids: Collection[str]
) -> int:
    """Drop the wishes a starting song fulfils and announce the song's new count. Returns
    how many wishes went.

    `user_ids` are the accounts of the people about to sing it. Every wish made without an
    account goes too, whoever made it: such a wish belongs to a browser cookie, not to a
    player, so a singer's own wish cannot be told apart from a bystander's — and a wish is
    "somebody should sing this tonight", which the sing that is starting settles.
    """
    owners = or_(Wish.guest_id.is_not(None), Wish.user_id.in_(user_ids))
    wish_ids = list(await session.scalars(select(Wish.id).where(Wish.song_id == song_id, owners)))
    if not wish_ids:
        return 0
    await session.execute(delete(Wish).where(Wish.id.in_(wish_ids)))
    await session.commit()
    await _broadcast(session, song_id)
    return len(wish_ids)


async def merge_guest_wishes(session: AsyncSession, guest_id: str, user_id: str) -> None:
    """Hand the wishes of a browser to the account that just logged in from it.

    Called from both the login and the register handler. A song both already had keeps the
    older timestamp, so the wishlist order the party is looking at does not jump around.
    """
    guest_wishes = list(await session.scalars(select(Wish).where(Wish.guest_id == guest_id)))
    if not guest_wishes:
        return
    owned = {
        wish.song_id: wish
        for wish in await session.scalars(select(Wish).where(Wish.user_id == user_id))
    }
    for wish in guest_wishes:
        existing = owned.get(wish.song_id)
        if existing is None:
            wish.user_id = user_id
            wish.guest_id = None
        else:
            existing.created_at = min(as_utc(existing.created_at), as_utc(wish.created_at))
            await session.delete(wish)
    await session.commit()
    logger.info("merged %d guest wishes into user %s", len(guest_wishes), user_id)
    for song_id in {wish.song_id for wish in guest_wishes}:
        await _broadcast(session, song_id)


async def favorite_song_ids(session: AsyncSession, user_id: str) -> list[str]:
    return list(
        await session.scalars(
            select(Favorite.song_id)
            .where(Favorite.user_id == user_id)
            .order_by(Favorite.created_at, Favorite.song_id)
        )
    )


async def add_favorite(session: AsyncSession, user_id: str, song_id: str) -> None:
    """Idempotent: marking a favorite twice is the same as marking it once."""
    if await session.get(Favorite, (user_id, song_id)) is not None:
        return
    session.add(Favorite(user_id=user_id, song_id=song_id))
    await session.commit()


async def remove_favorite(session: AsyncSession, user_id: str, song_id: str) -> None:
    favorite = await session.get(Favorite, (user_id, song_id))
    if favorite is None:
        return
    await session.delete(favorite)
    await session.commit()


@dataclass(frozen=True)
class Rights:
    """What one caller may do with one playlist.

    Ownership and membership are properties of the row, so none of this can be a route
    dependency — `library.api` builds a `Rights` per request and the routes branch on it.
    """

    # False means the caller is told the playlist does not exist: whose lists exist is
    # not a stranger's business either.
    visible: bool
    my_access: PlaylistAccess | None
    followed: bool
    # Add, remove and reorder songs.
    can_edit: bool
    # Name, description, global flag, members, delete.
    can_manage: bool


def rights_for(
    playlist: Playlist,
    user_id: str | None,
    capabilities: Collection[str],
    member: PlaylistMember | None,
) -> Rights:
    """`member` is the caller's own row, or None — the host session and every guest have
    none, and neither does a stranger looking at a global list."""
    owner = user_id is not None and playlist.owner_user_id == user_id
    access: PlaylistAccess | None = None
    if owner:
        access = "owner"
    elif member is not None:
        access = cast(PlaylistAccess, member.access)
    visible = owner or playlist.is_global or member is not None
    # Moderation follows what can be looked at, so it never opens a list its holder could
    # not already read.
    moderates = visible and MODERATE_CAPABILITY in capabilities
    return Rights(
        visible=visible,
        my_access=access,
        followed=True if owner else (member.followed if member is not None else False),
        can_edit=owner or access in _EDITORS or moderates,
        can_manage=owner or access == "admin" or moderates,
    )


async def member_row(
    session: AsyncSession, playlist_id: str, user_id: str | None
) -> PlaylistMember | None:
    """The caller's own membership of one playlist, or None."""
    if user_id is None:
        return None
    return await session.get(PlaylistMember, (playlist_id, user_id))


async def _owners(
    session: AsyncSession, user_ids: Collection[str]
) -> dict[str, tuple[str, str | None]]:
    """owner id -> (username, player id). Missing when the account was deleted."""
    if not user_ids:
        return {}
    players = {
        user_id: player_id
        for user_id, player_id in await session.execute(
            select(Player.user_id, Player.id).where(Player.user_id.in_(user_ids))
        )
        if user_id is not None
    }
    return {
        user.id: (user.username, players.get(user.id))
        for user in await session.scalars(select(User).where(User.id.in_(user_ids)))
    }


async def _entry_totals(
    session: AsyncSession, playlist_ids: Collection[str]
) -> dict[str, tuple[int, int]]:
    """playlist id -> (song count, seconds).

    The count is every stored entry, the seconds only the songs still in the library with
    a known duration — one unknown song must not make the whole sum unknown.
    """
    if not playlist_ids:
        return {}
    counts = {
        playlist_id: count
        for playlist_id, count in await session.execute(
            select(PlaylistEntry.playlist_id, func.count())
            .where(PlaylistEntry.playlist_id.in_(playlist_ids))
            .group_by(PlaylistEntry.playlist_id)
        )
    }
    durations = {
        playlist_id: int(total or 0)
        for playlist_id, total in await session.execute(
            select(PlaylistEntry.playlist_id, func.sum(Song.duration_seconds))
            .join(Song, Song.id == PlaylistEntry.song_id)
            .where(PlaylistEntry.playlist_id.in_(playlist_ids))
            .group_by(PlaylistEntry.playlist_id)
        )
    }
    return {
        playlist_id: (count, durations.get(playlist_id, 0)) for playlist_id, count in counts.items()
    }


async def _cover_song_ids(
    session: AsyncSession, playlist_ids: Collection[str]
) -> dict[str, list[str]]:
    """playlist id -> the first `COVER_SONGS` song ids, in playlist order.

    Ranked in SQL rather than by reading every entry: a listing of long playlists must not
    pull thousands of rows to draw four covers each. Songs that left the library are left
    out, the way the detail's entries are — a cover URL for one would only 404.
    """
    if not playlist_ids:
        return {}
    ranked = (
        select(
            PlaylistEntry.playlist_id.label("playlist_id"),
            PlaylistEntry.song_id.label("song_id"),
            func.row_number()
            .over(
                partition_by=PlaylistEntry.playlist_id,
                order_by=PlaylistEntry.position,
            )
            .label("rank"),
        )
        .join(Song, Song.id == PlaylistEntry.song_id)
        .where(PlaylistEntry.playlist_id.in_(playlist_ids))
        .subquery()
    )
    covers: dict[str, list[str]] = {}
    for playlist_id, song_id in await session.execute(
        select(ranked.c.playlist_id, ranked.c.song_id)
        .where(ranked.c.rank <= COVER_SONGS)
        .order_by(ranked.c.playlist_id, ranked.c.rank)
    ):
        covers.setdefault(playlist_id, []).append(song_id)
    return covers


def _read_playlist(
    playlist: Playlist,
    rights: Rights,
    owners: dict[str, tuple[str, str | None]],
    totals: dict[str, tuple[int, int]],
    covers: dict[str, list[str]],
    contains: bool | None,
) -> PlaylistRead:
    owner_username, owner_player_id = owners.get(playlist.owner_user_id, (None, None))
    song_count, duration_seconds = totals.get(playlist.id, (0, 0))
    return PlaylistRead(
        id=playlist.id,
        name=playlist.name,
        description=playlist.description,
        is_global=playlist.is_global,
        owner_username=owner_username,
        owner_player_id=owner_player_id,
        song_count=song_count,
        duration_seconds=duration_seconds,
        cover_song_ids=covers.get(playlist.id, []),
        my_access=rights.my_access,
        followed=rights.followed,
        can_edit=rights.can_edit,
        can_manage=rights.can_manage,
        contains=contains,
    )


async def visible_playlists(
    session: AsyncSession,
    user_id: str | None,
    capabilities: Collection[str],
    song_id: str | None = None,
) -> list[PlaylistRead]:
    """Everything the caller may see: their own lists, every list they were named on —
    followed or not, the client groups them — and every global one.

    `song_id` fills `contains` so a song's "add to playlist" picker needs one request
    instead of one per list.
    """
    members = (
        {}
        if user_id is None
        else {
            row.playlist_id: row
            for row in await session.scalars(
                select(PlaylistMember).where(PlaylistMember.user_id == user_id)
            )
        }
    )
    playlists = list(
        await session.scalars(
            select(Playlist)
            .where(
                or_(
                    Playlist.owner_user_id == user_id,
                    Playlist.is_global.is_(True),
                    Playlist.id.in_(list(members)),
                )
            )
            .order_by(func.lower(Playlist.name), Playlist.id)
        )
    )
    owners = await _owners(session, {playlist.owner_user_id for playlist in playlists})
    totals = await _entry_totals(session, [playlist.id for playlist in playlists])
    covers = await _cover_song_ids(session, [playlist.id for playlist in playlists])
    holders = (
        None
        if song_id is None
        else set(
            await session.scalars(
                select(PlaylistEntry.playlist_id).where(PlaylistEntry.song_id == song_id)
            )
        )
    )
    return [
        _read_playlist(
            playlist,
            rights_for(playlist, user_id, capabilities, members.get(playlist.id)),
            owners,
            totals,
            covers,
            None if holders is None else playlist.id in holders,
        )
        for playlist in playlists
    ]


async def read_playlist(
    session: AsyncSession, playlist: Playlist, rights: Rights, contains: bool | None = None
) -> PlaylistRead:
    return _read_playlist(
        playlist,
        rights,
        await _owners(session, [playlist.owner_user_id]),
        await _entry_totals(session, [playlist.id]),
        await _cover_song_ids(session, [playlist.id]),
        contains,
    )


async def read_playlist_detail(
    session: AsyncSession, playlist: Playlist, rights: Rights
) -> PlaylistDetail:
    meta = await read_playlist(session, playlist, rights)
    rows = await _entries(session, playlist.id)
    songs = {
        song.id: song
        for song in await session.scalars(
            select(Song).where(Song.id.in_([row.song_id for row in rows]))
        )
    }
    return PlaylistDetail(
        **meta.model_dump(),
        # An entry whose song left the library is skipped, so the positions the client sees
        # may have gaps even though the stored ones never do.
        entries=[
            PlaylistEntryRead(song=read_song(songs[row.song_id]), position=row.position)
            for row in rows
            if row.song_id in songs
        ],
    )


async def _entries(session: AsyncSession, playlist_id: str) -> Sequence[PlaylistEntry]:
    result = await session.scalars(
        select(PlaylistEntry)
        .where(PlaylistEntry.playlist_id == playlist_id)
        .order_by(PlaylistEntry.position)
    )
    return result.all()


async def announce_playlists(playlist_id: str | None = None) -> None:
    """Tell every client one playlist changed — or, with no id, that several did.

    Ids only: the bus is anonymous, so what a listener may see is decided when it asks.
    """
    await event_bus.broadcast(PlaylistsChanged(playlist_id=playlist_id))


class _Unset:
    """Marker for a PATCH field the request did not mention. `None` cannot serve: for a
    nullable column it is a value the caller may well be sending on purpose."""


UNSET = _Unset()


async def create_playlist(
    session: AsyncSession,
    name: str,
    description: str | None,
    is_global: bool,
    owner_user_id: str,
) -> Playlist:
    playlist = Playlist(
        name=name, description=description, is_global=is_global, owner_user_id=owner_user_id
    )
    session.add(playlist)
    await session.commit()
    logger.info("playlist '%s' created by %s (%s)", name, owner_user_id, playlist.id)
    await announce_playlists(playlist.id)
    return playlist


async def update_playlist(
    session: AsyncSession,
    playlist: Playlist,
    name: str | None = None,
    is_global: bool | None = None,
    description: str | None | _Unset = UNSET,
) -> Playlist:
    if name is not None:
        playlist.name = name
    if is_global is not None:
        playlist.is_global = is_global
    if not isinstance(description, _Unset):
        playlist.description = description
    await session.commit()
    await announce_playlists(playlist.id)
    return playlist


async def delete_playlist(session: AsyncSession, playlist: Playlist) -> None:
    playlist_id = playlist.id
    await session.execute(delete(PlaylistEntry).where(PlaylistEntry.playlist_id == playlist_id))
    await session.execute(delete(PlaylistMember).where(PlaylistMember.playlist_id == playlist_id))
    await session.delete(playlist)
    await session.commit()
    await announce_playlists(playlist_id)


def copy_name(name: str) -> str:
    """`<name> (copy)`, within the same bound as any other name. The original is what gets
    cut back, never the suffix: a copy of a maximum-length name has to stay tellable from
    the list it was copied from."""
    return f"{name[: MAX_NAME_LENGTH - len(_COPY_SUFFIX)].rstrip()}{_COPY_SUFFIX}"


async def copy_playlist(
    session: AsyncSession, playlist: Playlist, owner_user_id: str, name: str | None
) -> Playlist:
    """A private copy for the caller: the same songs in the same order and the same
    description, but none of the sharing — a copy is theirs, not a second front door to
    somebody else's list."""
    copy = Playlist(
        name=name or copy_name(playlist.name),
        description=playlist.description,
        is_global=False,
        owner_user_id=owner_user_id,
    )
    session.add(copy)
    session.add_all(
        PlaylistEntry(playlist_id=copy.id, song_id=row.song_id, position=row.position)
        for row in await _entries(session, playlist.id)
    )
    await session.commit()
    logger.info("playlist %s copied to %s by %s", playlist.id, copy.id, owner_user_id)
    await announce_playlists(copy.id)
    return copy


async def list_members(session: AsyncSession, playlist: Playlist) -> list[PlaylistMemberRead]:
    """Who the playlist was shared with, in the order they were added."""
    rows = list(
        await session.scalars(
            select(PlaylistMember)
            .where(PlaylistMember.playlist_id == playlist.id)
            .order_by(PlaylistMember.created_at, PlaylistMember.user_id)
        )
    )
    people = await _owners(session, [row.user_id for row in rows])
    return [
        PlaylistMemberRead(
            user_id=row.user_id,
            # A member row whose account is gone should not exist; if one does, the id is
            # still the truth and the listing has to keep working.
            username=people.get(row.user_id, (row.user_id, None))[0],
            player_id=people.get(row.user_id, (row.user_id, None))[1],
            access=cast(MemberAccess, row.access),
            created_at=as_utc(row.created_at),
            # `followed` is deliberately absent: whether somebody keeps the list in their
            # own listing is theirs, not something the sharer is shown.
        )
        for row in rows
    ]


async def set_member(
    session: AsyncSession, playlist: Playlist, user: User, access: MemberAccess
) -> bool:
    """Share the playlist, or change what an existing member may do. Returns True when the
    row was created. Raises `AlreadyOwnerError`."""
    if user.id == playlist.owner_user_id:
        raise AlreadyOwnerError(user.id)
    row = await session.get(PlaylistMember, (playlist.id, user.id))
    created = row is None
    if row is None:
        session.add(PlaylistMember(playlist_id=playlist.id, user_id=user.id, access=access))
    else:
        row.access = access
    await session.commit()
    logger.info("playlist %s shared with %s (%s)", playlist.id, user.username, access)
    await announce_playlists(playlist.id)
    return created


async def remove_member(session: AsyncSession, playlist: Playlist, user_id: str) -> None:
    """Take the access away. Raises `NotAMemberError`."""
    row = await session.get(PlaylistMember, (playlist.id, user_id))
    if row is None:
        raise NotAMemberError(user_id)
    await session.delete(row)
    await session.commit()
    await announce_playlists(playlist.id)


async def set_followed(
    session: AsyncSession, playlist: Playlist, user_id: str, followed: bool
) -> None:
    """Keep the shared list in the caller's own listing, or hide it. Idempotent. Raises
    `NotAMemberError` — the owner and a plain global viewer have no row to flip."""
    row = await session.get(PlaylistMember, (playlist.id, user_id))
    if row is None:
        raise NotAMemberError(user_id)
    row.followed = followed
    await session.commit()
    await announce_playlists(playlist.id)


async def add_entry(session: AsyncSession, playlist: Playlist, song_id: str) -> None:
    """Append a song. Raises `DuplicateEntryError` — a playlist is a set in an order."""
    rows = await _entries(session, playlist.id)
    if any(row.song_id == song_id for row in rows):
        raise DuplicateEntryError(song_id)
    session.add(PlaylistEntry(playlist_id=playlist.id, song_id=song_id, position=len(rows)))
    await session.commit()
    await announce_playlists(playlist.id)


async def remove_entry(session: AsyncSession, playlist: Playlist, song_id: str) -> None:
    """Raises `UnknownEntryError`. The survivors are renumbered, so positions stay dense."""
    rows = list(await _entries(session, playlist.id))
    entry = next((row for row in rows if row.song_id == song_id), None)
    if entry is None:
        raise UnknownEntryError(song_id)
    await session.delete(entry)
    for position, row in enumerate(row for row in rows if row is not entry):
        row.position = position
    await session.commit()
    await announce_playlists(playlist.id)


async def reorder_entries(session: AsyncSession, playlist: Playlist, song_ids: list[str]) -> None:
    """Rewrite the order. Raises `OrderMismatchError` unless `song_ids` is a permutation of
    what the playlist holds — a partial order would silently drop songs."""
    rows = {row.song_id: row for row in await _entries(session, playlist.id)}
    if sorted(song_ids) != sorted(rows):
        raise OrderMismatchError
    for position, song_id in enumerate(song_ids):
        rows[song_id].position = position
    await session.commit()
    await announce_playlists(playlist.id)


async def delete_user_data(session: AsyncSession, user_id: str) -> None:
    """Drop everything an account owns: its wishes, favorites and playlists.

    A shared playlist is handed to its earliest admin member instead of being deleted —
    the point of admin access is that the list survives its creator. Only a playlist with
    nobody to hand it to goes, entries and members included; the account's own membership
    of other people's lists goes either way.

    Does not commit — `auth.service.delete_user` removes the account in the same
    transaction, so a half-deleted user cannot exist.
    """
    orphaned: list[str] = []
    for playlist in await session.scalars(
        select(Playlist).where(Playlist.owner_user_id == user_id)
    ):
        heir = await session.scalar(
            select(PlaylistMember)
            .where(PlaylistMember.playlist_id == playlist.id, PlaylistMember.access == "admin")
            # The user id only breaks a tie, so the handover cannot differ between runs.
            .order_by(PlaylistMember.created_at, PlaylistMember.user_id)
            .limit(1)
        )
        if heir is None:
            orphaned.append(playlist.id)
            continue
        playlist.owner_user_id = heir.user_id
        # The new owner is the implicit admin, so the row it was granted through goes.
        await session.delete(heir)
        logger.info("playlist %s handed over to %s", playlist.id, heir.user_id)
    if orphaned:
        await session.execute(delete(PlaylistEntry).where(PlaylistEntry.playlist_id.in_(orphaned)))
        await session.execute(
            delete(PlaylistMember).where(PlaylistMember.playlist_id.in_(orphaned))
        )
        await session.execute(delete(Playlist).where(Playlist.id.in_(orphaned)))
    await session.execute(delete(PlaylistMember).where(PlaylistMember.user_id == user_id))
    await session.execute(delete(Wish).where(Wish.user_id == user_id))
    await session.execute(delete(Favorite).where(Favorite.user_id == user_id))
