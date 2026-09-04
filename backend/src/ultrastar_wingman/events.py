"""Typed WebSocket event bus (server to client only)."""

import logging
from datetime import datetime
from typing import Literal

from fastapi import WebSocket
from pydantic import BaseModel

from .achievements.schema import EarnedByPlayer
from .downloads.schema import DownloadRead
from .karaoke.schema import CurrentSing, ScoreRead
from .songs.schema import SongRead

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


class SongUpdated(Event):
    """A song's metadata was corrected — a wrong title, a missing year. The whole song
    rides along: every listing in the app draws it from a `SongRead`, so a listener can put
    the new one straight where the old one was."""

    event: Literal["songs.updated"] = "songs.updated"
    song: SongRead


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


class ScoresChanged(Event):
    """A recorded score was put on another singer or removed (`stats.moderate`).

    Deliberately not `scores.recorded`: nothing was just sung, and that event un-dismisses
    the host screen's results panel — a correction hours later must not throw the last
    song's scoreboard back onto the TV. Ids only, like the other "something changed" events:
    every listener refetches whichever list it happens to have open.
    """

    event: Literal["scores.changed"] = "scores.changed"
    sing_id: str


class SessionsChanged(Event):
    """A party was named (`stats.manage`), or kept out of the Scores page's party picker,
    or put back (`stats.hide`).

    No payload, for the same reason `tags.changed` has none: what the listing holds is
    decided per caller — a reader without `stats.hide` never sees a hidden party, and one
    who holds it can ask for them — and the bus does not know who is on the other end.
    Every client fetches `GET /stats/sessions` again and gets its own answer.

    Deliberately not `scores.changed`: no score moved, and nothing about any party's
    numbers is different. Naming and hiding reach that one listing and nothing else.
    """

    event: Literal["sessions.changed"] = "sessions.changed"


class AchievementsEarned(Event):
    """What a finished sing just earned, for everybody it earned something.

    One event per **sing**, not per player: the host screen choreographs the whole sequence
    out of one payload — whose badges come first, how long the row stays — and a stream of
    per-player events would make that animation racy, with the second singer's arrival
    landing in the middle of the first singer's row.

    The achievements in it are **unmasked**, `hidden` ones included: earning one is what
    reveals it, and the scores it was earned from are already on the bus. `definition` is
    left out all the same — the bus is open to anonymous clients, and what a hidden
    achievement asks for is the surprise itself.

    Sent only when something was newly earned; a party where nobody crossed a line is silent.
    """

    event: Literal["achievements.earned"] = "achievements.earned"
    sing_id: str
    players: list[EarnedByPlayer]


class AchievementsChanged(Event):
    """The catalogue itself changed: one was created, edited, deleted, had its picture
    replaced or removed, or the three options were retimed.

    No payload, for the same reason `tags.changed` has none: what a listener may see of the
    catalogue is masked per caller — a `hidden` one is blank for everybody who has not earned
    it — and the bus does not know who is on the other end. Every client refetches
    `GET /achievements`, which masks for whoever asks.

    Not the same event as `achievements.earned`: that one says somebody *reached* something
    and belongs to a sing. This one says the thing itself is different now. A recomputation
    pass finishing broadcasts neither — it has no sing to name, and the write that started it
    already sent this.
    """

    event: Literal["achievements.changed"] = "achievements.changed"


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
