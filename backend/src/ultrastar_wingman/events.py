"""Typed WebSocket event bus (server to client only)."""

import logging
from datetime import datetime
from typing import Literal

from fastapi import WebSocket
from pydantic import BaseModel

from .downloads.schema import DownloadRead
from .karaoke.schema import CurrentSing, ScoreRead

logger = logging.getLogger(__name__)


class Event(BaseModel):
    """Base event. `event` is the name clients switch on."""

    event: str


class ServerReady(Event):
    event: Literal["server.ready"] = "server.ready"
    version: str


class SettingChanged(Event):
    event: Literal["setting.changed"] = "setting.changed"
    key: str
    value: str | int | bool | float | None = None


class SongsScanStarted(Event):
    event: Literal["songs.scan_started"] = "songs.scan_started"


class SongsScanFinished(Event):
    event: Literal["songs.scan_finished"] = "songs.scan_finished"
    added: int
    removed: int
    updated: int
    total: int


class SongDeleted(Event):
    """One song was deleted from the library, files and all. The id alone: every listing
    that carried it has to be fetched again anyway, and the row is gone from all of them."""

    event: Literal["songs.deleted"] = "songs.deleted"
    song_id: str


class DownloadUpdated(Event):
    """Every state change of a download, plus throttled progress while it runs."""

    event: Literal["download.updated"] = "download.updated"
    download: DownloadRead


class KaraokeStarted(Event):
    event: Literal["karaoke.started"] = "karaoke.started"
    sing: CurrentSing


class KaraokeEnded(Event):
    event: Literal["karaoke.ended"] = "karaoke.ended"
    sing_id: str
    song_id: str


class ScoresRecorded(Event):
    """Sent right after `karaoke.ended`, and only when USDX actually scored something."""

    event: Literal["scores.recorded"] = "scores.recorded"
    sing_id: str
    scores: list[ScoreRead]


class WishlistUpdated(Event):
    """One song's wish count changed: somebody wished for it, took the wish back, or logged
    in and brought their guest wishes along. `count` is 0 when the last wish is gone."""

    event: Literal["wishlist.updated"] = "wishlist.updated"
    song_id: str
    count: int
    latest: datetime | None = None


class PlaylistsChanged(Event):
    """A playlist was created, changed, shared, followed, copied or deleted. Ids only —
    the bus is anonymous, and who may see the list is decided when the client asks for it.
    `playlist_id` is None when several changed at once (an account being deleted)."""

    event: Literal["playlists.changed"] = "playlists.changed"
    playlist_id: str | None = None


class TagsChanged(Event):
    """A tag was created, edited, deleted, or had its permission rows replaced. No payload:
    what a listener may see of the tags depends on who it is, which the bus does not know."""

    event: Literal["tags.changed"] = "tags.changed"


class SongTagsChanged(Event):
    """One song was tagged or untagged. Ids only, for the same reason: a client that may
    not view the tag learns nothing from the pair it cannot resolve."""

    event: Literal["song_tags.changed"] = "song_tags.changed"
    song_id: str
    tag_id: str


class CommentsChanged(Event):
    """One song's comments changed: somebody said something, took it back, or a moderator
    removed it. `count` is what the song's badge shows — the bodies themselves are not on
    the bus, so a listener refetches the list it happens to have open."""

    event: Literal["comments.changed"] = "comments.changed"
    song_id: str
    count: int


class EventBus:
    """Fans events out to all connected sockets."""

    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self._connections.discard(websocket)

    async def broadcast(self, event: Event) -> None:
        message = event.model_dump(mode="json")
        for websocket in list(self._connections):
            try:
                await websocket.send_json(message)
            except Exception:
                # A socket that died between connect and send must not abort the fan-out.
                logger.info("dropping unreachable websocket", exc_info=True)
                self._connections.discard(websocket)


event_bus = EventBus()
