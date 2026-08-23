"""Wishlist, favorites and playlists. Knows nothing about FastAPI.

A wishlist owner is passed around as the pair `(user_id, guest_id)` with exactly one of
them set — the FastAPI dependency that resolves it lives in `auth.deps`, which this module
must not import.
"""

import logging
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import ColumnElement, delete, false, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.model import User, as_utc
from ..events import WishlistUpdated, event_bus
from ..songs.model import Song
from ..songs.schema import read_song
from .model import Favorite, Playlist, PlaylistEntry, Wish
from .schema import PlaylistDetail, PlaylistEntryRead, PlaylistRead, WishRead

logger = logging.getLogger(__name__)


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


async def visible_playlists(session: AsyncSession, user_id: str | None) -> list[PlaylistRead]:
    """The caller's own playlists plus every shared one."""
    playlists = await session.scalars(
        select(Playlist)
        .where(or_(Playlist.owner_user_id == user_id, Playlist.shared.is_(True)))
        .order_by(func.lower(Playlist.name), Playlist.id)
    )
    counts = {
        playlist_id: count
        for playlist_id, count in await session.execute(
            select(PlaylistEntry.playlist_id, func.count()).group_by(PlaylistEntry.playlist_id)
        )
    }
    usernames = {user.id: user.username for user in await session.scalars(select(User))}
    return [
        PlaylistRead(
            id=playlist.id,
            name=playlist.name,
            shared=playlist.shared,
            owner_username=usernames.get(playlist.owner_user_id),
            song_count=counts.get(playlist.id, 0),
            mine=playlist.owner_user_id == user_id,
        )
        for playlist in playlists
    ]


async def read_playlist(
    session: AsyncSession, playlist: Playlist, user_id: str | None
) -> PlaylistRead:
    owner = await session.get(User, playlist.owner_user_id)
    song_count = await session.scalar(
        select(func.count())
        .select_from(PlaylistEntry)
        .where(PlaylistEntry.playlist_id == playlist.id)
    )
    return PlaylistRead(
        id=playlist.id,
        name=playlist.name,
        shared=playlist.shared,
        owner_username=None if owner is None else owner.username,
        song_count=song_count or 0,
        mine=playlist.owner_user_id == user_id,
    )


async def read_playlist_detail(
    session: AsyncSession, playlist: Playlist, user_id: str | None
) -> PlaylistDetail:
    meta = await read_playlist(session, playlist, user_id)
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


async def create_playlist(
    session: AsyncSession, name: str, shared: bool, owner_user_id: str
) -> Playlist:
    playlist = Playlist(name=name, shared=shared, owner_user_id=owner_user_id)
    session.add(playlist)
    await session.commit()
    logger.info("playlist '%s' created by %s (%s)", name, owner_user_id, playlist.id)
    return playlist


async def update_playlist(
    session: AsyncSession, playlist: Playlist, name: str | None, shared: bool | None
) -> Playlist:
    if name is not None:
        playlist.name = name
    if shared is not None:
        playlist.shared = shared
    await session.commit()
    return playlist


async def delete_playlist(session: AsyncSession, playlist: Playlist) -> None:
    await session.execute(delete(PlaylistEntry).where(PlaylistEntry.playlist_id == playlist.id))
    await session.delete(playlist)
    await session.commit()


async def add_entry(session: AsyncSession, playlist: Playlist, song_id: str) -> None:
    """Append a song. Raises `DuplicateEntryError` — a playlist is a set in an order."""
    rows = await _entries(session, playlist.id)
    if any(row.song_id == song_id for row in rows):
        raise DuplicateEntryError(song_id)
    session.add(PlaylistEntry(playlist_id=playlist.id, song_id=song_id, position=len(rows)))
    await session.commit()


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


async def reorder_entries(session: AsyncSession, playlist: Playlist, song_ids: list[str]) -> None:
    """Rewrite the order. Raises `OrderMismatchError` unless `song_ids` is a permutation of
    what the playlist holds — a partial order would silently drop songs."""
    rows = {row.song_id: row for row in await _entries(session, playlist.id)}
    if sorted(song_ids) != sorted(rows):
        raise OrderMismatchError
    for position, song_id in enumerate(song_ids):
        rows[song_id].position = position
    await session.commit()


async def delete_user_data(session: AsyncSession, user_id: str) -> None:
    """Drop everything an account owns: its playlists, wishes and favorites.

    Does not commit — `auth.service.delete_user` removes the account in the same
    transaction, so a half-deleted user cannot exist.
    """
    playlist_ids = list(
        await session.scalars(select(Playlist.id).where(Playlist.owner_user_id == user_id))
    )
    if playlist_ids:
        await session.execute(
            delete(PlaylistEntry).where(PlaylistEntry.playlist_id.in_(playlist_ids))
        )
        await session.execute(delete(Playlist).where(Playlist.id.in_(playlist_ids)))
    await session.execute(delete(Wish).where(Wish.user_id == user_id))
    await session.execute(delete(Favorite).where(Favorite.user_id == user_id))
