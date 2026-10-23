"""Background music read models. FastAPI-free on purpose: the service builds these for the
event bus, and the event bus must not depend on the routing layer."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from ..karaoke.schema import Scope
from ..songs.schema import SongRead

# What the music is doing, as one word.
#
# `off` and `blocked` are not the same silence: one is a host who did not want music, the
# other is Ultrastar Deluxe holding the speakers, and the player says so rather than looking
# broken. `waiting` is the pause after a song, `empty` is a pool with nothing in it.
MusicStatus = Literal["off", "blocked", "waiting", "empty", "playing", "paused"]

# What took the speakers away. `sing` is a song being sung, `usdx` is Ultrastar Deluxe
# standing open in its own menus — two states in `karaoke.service`, and the room hears the
# same nothing either way.
MusicBlocker = Literal["sing", "usdx"]


class MusicTrackRead(BaseModel):
    """The song the music is on, and where in it we are.

    `position_s` is where the track was at `position_at`, not where it is now: a reader
    works the current position out itself, which is what lets the server stay quiet between
    reports. It only advances while the music is `playing` and a sink is online — a frozen
    track is one nobody is listening to, and it must not run past its own end on a clock in
    an empty room.

    `duration_s` is the audio file's real length, as the host screen measured it, and is
    null until the host has said. It is deliberately not `song.duration_seconds`, which is
    narrowed by the song's `#START` and `#END` and is therefore not how long the file plays.

    `gain_db` and `peak` are the audio file's ReplayGain — the track gain in dB against
    -18 LUFS and the true peak as a linear value, the numbers Ultrastar Deluxe evens the
    song out with — and null while Wingman does not know them (`Song.replay_gain_db`). On
    the track and not on `song`, because only the screen making the sound has a use for
    them. A host that applies them plays at `10^(gain_db/20)`, at most `1/peak`.
    """

    id: str
    song: SongRead
    started_at: datetime
    position_s: float
    position_at: datetime
    duration_s: float | None
    gain_db: float | None
    peak: float | None


class MusicPreviewRead(BaseModel):
    """The song the room is picking singers for, for the host screen to play.

    Set while a selection with a song stands and the host has *Song preview* on
    (`sound.reel_preview`): the background music freezes, and from `reveal_at` — the reel's
    landing on the server's clock for a spun selection, the moment it opened for one opened
    with a song — the host fades this song in from `start_s`, where the file says a preview
    should start (`songs.txt.SongTxt.preview_start`; 0 for a file that says nothing). `id`
    changes on every spin, respin and new selection and on nothing else — a spin moving on
    to its singers keeps it, so the song plays on — and `reveal_at` moves when a press in
    the room lands the reel early, so a host times its fade-in on the pair. `gain_db` and
    `peak` are the song's ReplayGain, as on `MusicTrackRead`.
    """

    id: str
    song: SongRead
    start_s: float
    reveal_at: datetime
    gain_db: float | None
    peak: float | None


class MusicVolumeRead(BaseModel):
    """The four volumes, as percentages. The host multiplies them itself — an effective
    volume worked out here would be a number nobody set."""

    master: int
    music: int
    preview: int
    effects: int


class MusicRead(BaseModel):
    """What the music is doing, for everybody at once.

    This is also the whole payload of `music.changed`, which rides the anonymous WebSocket,
    so nothing in it may be something a guest must not see: the song was picked as a guest,
    the sink's id is only ever answered to the tab that registered, and `playlist_id` is
    left out on purpose — an id on an open bus could name a private list. It lives in
    `MusicSettings`, behind `music.manage`.
    """

    status: MusicStatus
    track: MusicTrackRead | None
    # The song being picked, while the room's selection has one and the host plays it.
    # Independent of `status`: it is about the selection, not the soundtrack, so it is
    # set with the music switched off too. While it is set the track does not advance.
    preview: MusicPreviewRead | None
    blocked_by: MusicBlocker | None
    # When the music comes back after a song, and when an empty pool is worth asking about
    # again. Both are absolute times so a phone needs no clock of the server's.
    resume_at: datetime | None
    retry_at: datetime | None
    sink_online: bool
    # Rises on every registration. A host tab that finds a number other than its own has
    # been taken over, and silences itself without waiting for a refused report.
    sink_generation: int
    volume: MusicVolumeRead
    scope: Scope


class MusicSettings(BaseModel):
    """The options behind `music.manage`. `playlist` is here and not in `MusicRead`."""

    enabled: bool
    scope: str
    playlist: str
    resume_delay_s: int


class MusicSinkRegistered(BaseModel):
    """The answer to a registration: the lease, how often to report, and the state the
    host starts from, so registering costs it no second request."""

    sink_id: str
    heartbeat_interval_s: int
    music: MusicRead


class MusicSinkReport(BaseModel):
    """One report from the screen making the sound.

    `track_id` is what makes the protocol safe against its own races: a report naming a
    track that is no longer the current one is ignored, which covers a retried `ended`, a
    report that crossed a skip on the wire, and a tab that woke up on a stale song.
    """

    sink_id: str
    track_id: str
    event: Literal["progress", "ended", "error"]
    position_s: float
    duration_s: float | None = None
    detail: str | None = None
