"""Wishlist, favorites and playlist read models. FastAPI-free like the other schemas, so
the service can build them for the event bus."""

from datetime import datetime

from pydantic import BaseModel

from ..songs.schema import SongRead


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
    shared: bool
    # None when the owning account was deleted — playlists outlive nothing, but a shared
    # one may still be listed while its owner row is gone in an old database.
    owner_username: str | None
    song_count: int
    mine: bool


class PlaylistList(BaseModel):
    playlists: list[PlaylistRead]


class PlaylistEntryRead(BaseModel):
    song: SongRead
    position: int


class PlaylistDetail(PlaylistRead):
    entries: list[PlaylistEntryRead]
