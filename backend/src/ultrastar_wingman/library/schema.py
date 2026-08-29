"""Wishlist, favorites and playlist read models. FastAPI-free like the other schemas, so
the service can build them for the event bus."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from ..songs.schema import SongRead

# What a member row may grant, plus `owner` — which is no row at all but the strongest of
# them, so the client can switch on one field.
MemberAccess = Literal["read", "write", "admin"]
PlaylistAccess = Literal["owner", "admin", "write", "read"]


class WishRead(BaseModel):
    """One wished song, aggregated over everybody who wished for it."""

    song: SongRead
    count: int
    latest: datetime
    # True when the caller is one of those `count` people.
    mine: bool


class WishlistRead(BaseModel):
    wishes: list[WishRead]


class FavoritesRead(BaseModel):
    song_ids: list[str]


class PlaylistRead(BaseModel):
    id: str
    name: str
    description: str | None
    # Visible to everybody who may view playlists, changeable by nobody but the people
    # named on it.
    is_global: bool
    # None when the owning account was deleted — playlists outlive nothing, but a global
    # one may still be listed while its owner row is gone in an old database.
    owner_username: str | None
    owner_player_id: str | None
    # The songs still in the library, so the number agrees with the entries the detail
    # hands out; a song that left takes its entry out of the count until it comes back.
    song_count: int
    # Over the songs whose duration is known; an unknown one counts as nothing rather
    # than making the whole sum unknown.
    duration_seconds: int
    # The first few songs still in the library, in playlist order — the ids the client
    # needs for the cover mosaic on a playlist row. Four of them, so a listing draws its
    # covers without one detail request per row.
    cover_song_ids: list[str]
    # How the caller reaches this list: `owner`, their member row's access, or None for a
    # global list they were never named on.
    my_access: PlaylistAccess | None
    # False once a member unfollows: the access stays, the list leaves their listing.
    followed: bool
    can_edit: bool
    can_manage: bool
    # Whether the playlist holds the song `?song_id=` named. None when it was not asked for.
    contains: bool | None = None


class PlaylistList(BaseModel):
    playlists: list[PlaylistRead]


class PlaylistMemberRead(BaseModel):
    user_id: str
    username: str
    player_id: str | None
    access: MemberAccess
    created_at: datetime


class PlaylistMemberList(BaseModel):
    members: list[PlaylistMemberRead]


class PlaylistEntryRead(BaseModel):
    song: SongRead
    position: int


class PlaylistDetail(PlaylistRead):
    entries: list[PlaylistEntryRead]
