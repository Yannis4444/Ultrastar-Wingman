"""Typed WebSocket event bus (server to client only)."""

import logging
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
