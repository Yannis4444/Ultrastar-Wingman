"""The background music's state machine.

Every test here moves `service._now` by hand and calls `service.tick()` explicitly. Nothing
sleeps: the module's whole design is a deadline plus a tick, precisely so that the clock is
an argument rather than something a test has to wait for.
"""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ultrastar_wingman.library.model import Wish
from ultrastar_wingman.music import service
from ultrastar_wingman.music import settings as music_settings
from ultrastar_wingman.songs.model import Song
from ultrastar_wingman.tags.model import SongTag, Tag

START = datetime(2026, 9, 12, 20, 0, tzinfo=UTC)


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> "Clock":
    moment = Clock()
    monkeypatch.setattr(service, "_now", lambda: moment.now)
    return moment


class Clock:
    """The module's clock, in the test's hand."""

    def __init__(self) -> None:
        self.now = START

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


async def add_song(
    session: AsyncSession, tmp_path: Path, number: int, *, audio: bool = True
) -> str:
    """A song the music could actually play. `audio=False` is a video-only or broken entry,
    which the picker has to leave alone."""
    directory = tmp_path / f"song{number}"
    directory.mkdir(parents=True, exist_ok=True)
    txt = directory / "song.txt"
    txt.write_text(f"#TITLE:Title {number}\n#ARTIST:Artist {number}\n", encoding="utf-8")
    audio_file = directory / "song.mp3"
    if audio:
        audio_file.write_bytes(b"not really an mp3")
    song = Song(
        id=f"usdb:{number}",
        source="usdb",
        source_id=str(number),
        title=f"Title {number}",
        artist=f"Artist {number}",
        fingerprint=f"artist {number}|title {number}",
        directory=str(directory),
        txt_file=str(txt),
        audio_file=str(audio_file) if audio else None,
    )
    session.add(song)
    await session.commit()
    return song.id


async def enable(session: AsyncSession, **options: Any) -> None:
    """Switch the music on, and load the caches the way the watchdog would."""
    settings = music_settings.service(session)
    await settings.set(music_settings.ENABLED, True)
    for key, value in options.items():
        await settings.set(f"music.{key}", value)
    await service.apply_settings(session)


async def register(session: AsyncSession) -> str:
    """A host screen that is listening. Without one the music never picks anything."""
    sink_id, _, _ = await service.register_sink(session)
    return sink_id


async def test_the_music_is_off_until_somebody_turns_it_on(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    await add_song(session, tmp_path, 1)
    await service.apply_settings(session)
    await register(session)
    await service.tick(session_factory)

    state = await service.read()
    assert state.status == "off"
    assert state.track is None


async def test_a_song_is_picked_once_a_screen_is_listening(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    song_id = await add_song(session, tmp_path, 1)
    await enable(session)
    await register(session)

    state = await service.read()
    assert state.status == "playing"
    assert state.track is not None
    assert state.track.song.id == song_id
    # From the beginning, always: the position is never inherited from anything.
    assert state.track.position_s == 0
    # The host has not measured the file yet, so nothing claims to know how long it is.
    assert state.track.duration_s is None


async def test_the_position_only_advances_while_a_screen_is_listening(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    await add_song(session, tmp_path, 1)
    await enable(session)
    sink_id = await register(session)

    clock.advance(10)
    state = await service.read()
    assert state.track is not None
    assert state.track.position_s == pytest.approx(10)

    # The host page closed. The track freezes where it stood rather than marching on.
    await service.release_sink(sink_id)
    clock.advance(30)
    state = await service.read()
    assert state.sink_online is False
    assert state.track is not None
    assert state.track.position_s == pytest.approx(10)


async def test_a_screen_that_stops_reporting_is_gone(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    await add_song(session, tmp_path, 1)
    await enable(session)
    await register(session)

    clock.advance(service.SINK_TIMEOUT.total_seconds() + 1)
    await service.tick(session_factory)

    state = await service.read()
    assert state.sink_online is False
    # The track is kept, not dropped: "playing but nobody is listening" is the state the
    # phone turns into "open the host screen".
    assert state.status == "playing"
    assert state.track is not None


async def test_a_sing_takes_the_speakers_and_the_music_comes_back_on_a_new_song(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    for number in range(1, 6):
        await add_song(session, tmp_path, number)
    await enable(session, resume_delay_s=10)
    await register(session)

    first = await service.read()
    assert first.track is not None
    clock.advance(20)

    await service.sing_started()
    blocked = await service.read()
    assert blocked.status == "blocked"
    assert blocked.blocked_by == "sing"
    assert blocked.track is None

    await service.sing_ended()
    waiting = await service.read()
    assert waiting.status == "waiting"
    assert waiting.resume_at == START + timedelta(seconds=30)

    # Still waiting a moment before the delay is up.
    clock.advance(9)
    await service.tick(session_factory)
    assert (await service.read()).status == "waiting"

    clock.advance(2)
    await service.tick(session_factory)
    resumed = await service.read()
    assert resumed.status == "playing"
    assert resumed.track is not None
    # A fresh track from the beginning — never the one the singing interrupted, and never
    # the offset it had reached.
    assert resumed.track.id != first.track.id
    assert resumed.track.position_s == 0


async def test_a_forced_start_clears_the_wait_the_finished_song_set(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    await add_song(session, tmp_path, 1)
    await enable(session, resume_delay_s=30)
    await register(session)

    # What a forced sing does: the running song is finished off first, and the new one
    # starts in the same breath.
    await service.sing_started()
    await service.sing_ended()
    assert (await service.read()).status == "waiting"

    await service.sing_started()
    state = await service.read()
    assert state.status == "blocked"
    assert state.resume_at is None


async def test_usdx_in_its_own_menus_takes_the_speakers_too(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    await add_song(session, tmp_path, 1)
    await enable(session, resume_delay_s=0)
    await register(session)

    await service.usdx_opened()
    state = await service.read()
    assert state.status == "blocked"
    assert state.blocked_by == "usdx"

    await service.usdx_closed()
    await service.tick(session_factory)
    assert (await service.read()).status == "playing"


async def test_the_song_that_just_played_is_not_picked_again(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    await add_song(session, tmp_path, 1)
    await add_song(session, tmp_path, 2)
    await enable(session)
    sink_id = await register(session)

    first = await service.read()
    assert first.track is not None
    await service.report_sink(
        session,
        sink_id=sink_id,
        track_id=first.track.id,
        event="ended",
        position_s=180.0,
    )
    second = await service.read()
    assert second.track is not None
    assert second.track.song.id != first.track.song.id


async def test_one_song_in_the_pool_plays_again_rather_than_stopping(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    song_id = await add_song(session, tmp_path, 1)
    await enable(session)
    sink_id = await register(session)

    first = await service.read()
    assert first.track is not None
    await service.report_sink(
        session, sink_id=sink_id, track_id=first.track.id, event="ended", position_s=1.0
    )
    second = await service.read()
    assert second.track is not None
    assert second.track.song.id == song_id
    # A new track all the same, so the host reloads the element and starts from the top.
    assert second.track.id != first.track.id


async def test_a_song_without_audio_is_never_picked(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    await add_song(session, tmp_path, 1, audio=False)
    playable = await add_song(session, tmp_path, 2)
    await enable(session)
    await register(session)

    for _ in range(5):
        state = await service.read()
        assert state.track is not None
        assert state.track.song.id == playable
        await service.skip(session)


async def test_nothing_to_play_is_a_state_that_retries(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    await enable(session)
    await register(session)

    empty = await service.read()
    assert empty.status == "empty"
    assert empty.retry_at == START + service.EMPTY_RETRY

    # A song arrives, but the retry deadline has not come round: the pool is not re-read on
    # every tick, which is the whole point of the deadline.
    await add_song(session, tmp_path, 1)
    clock.advance(5)
    await service.tick(session_factory)
    assert (await service.read()).status == "empty"

    clock.advance(service.EMPTY_RETRY.total_seconds())
    await service.tick(session_factory)
    assert (await service.read()).status == "playing"


async def test_a_playlist_that_is_gone_does_not_fall_back_to_the_library(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    await add_song(session, tmp_path, 1)
    await enable(session, scope="playlist", playlist="a-playlist-nobody-has")
    await register(session)

    # Unlike the selector's one-off press, an evening's music does not quietly start playing
    # out of the pool the host excluded.
    assert (await service.read()).status == "empty"


async def test_the_wishlist_scope_plays_what_the_room_wished_for(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    await add_song(session, tmp_path, 1)
    wished = await add_song(session, tmp_path, 2)
    session.add(Wish(song_id=wished, guest_id="somebody"))
    await session.commit()
    await enable(session, scope="wishlist")
    await register(session)

    state = await service.read()
    assert state.track is not None
    assert state.track.song.id == wished


async def test_a_song_hidden_from_guests_is_never_picked(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    secret = await add_song(session, tmp_path, 1)
    open_song = await add_song(session, tmp_path, 2)
    # A tag with no `view_songs` row at all hides its songs from everybody but an
    # administrator (`tags.service.hidden_song_ids` is default-deny). The music picks as a
    # guest, and its pick rides the anonymous socket, so this is the bar it has to clear.
    tag = Tag(name="Private", color="neutral", hide_by_default=False)
    session.add(tag)
    await session.flush()
    session.add(SongTag(tag_id=tag.id, song_id=secret))
    await session.commit()

    await enable(session)
    await register(session)

    for _ in range(5):
        state = await service.read()
        assert state.track is not None
        assert state.track.song.id == open_song
        await service.skip(session)


async def test_pause_survives_a_sing(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    await add_song(session, tmp_path, 1)
    await add_song(session, tmp_path, 2)
    await enable(session, resume_delay_s=0)
    await register(session)

    await service.pause(session)
    assert (await service.read()).status == "paused"

    await service.sing_started()
    await service.sing_ended()
    await service.tick(session_factory)

    # Somebody silenced the room on purpose. A song finishing is not a reason to undo that.
    assert (await service.read()).status == "paused"


async def test_skip_keeps_a_paused_room_quiet(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    await add_song(session, tmp_path, 1)
    await add_song(session, tmp_path, 2)
    await enable(session)
    await register(session)

    await service.pause(session)
    state = await service.skip(session)
    assert state.status == "paused"
    assert state.track is not None


async def test_play_cancels_the_wait_after_a_song(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    await add_song(session, tmp_path, 1)
    await enable(session, resume_delay_s=120)
    await register(session)

    await service.sing_started()
    await service.sing_ended()
    assert (await service.read()).status == "waiting"

    state = await service.play(session)
    assert state.status == "playing"
    assert state.resume_at is None


async def test_pause_freezes_the_position(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    await add_song(session, tmp_path, 1)
    await enable(session)
    await register(session)

    # Inside the sink's own timeout: the position only advances while somebody is
    # listening, so a test that let the lease lapse would be measuring silence.
    clock.advance(10)
    await service.pause(session)
    clock.advance(60)
    state = await service.read()
    assert state.track is not None
    assert state.track.position_s == pytest.approx(10)


async def test_the_controls_say_why_they_did_nothing(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    await add_song(session, tmp_path, 1)

    with pytest.raises(service.MusicDisabledError):
        await service.play(session)

    await enable(session)
    await register(session)
    await service.sing_started()
    with pytest.raises(service.MusicBlockedError):
        await service.skip(session)


async def test_a_report_for_a_track_that_is_gone_is_ignored(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    await add_song(session, tmp_path, 1)
    await add_song(session, tmp_path, 2)
    await enable(session)
    sink_id = await register(session)

    first = await service.read()
    assert first.track is not None
    await service.report_sink(
        session, sink_id=sink_id, track_id=first.track.id, event="ended", position_s=180.0
    )
    second = await service.read()
    assert second.track is not None

    # The same `ended` again — a retry after a timeout, or a report that crossed a skip on
    # the wire. It must not advance the music a second time.
    state, changed = await service.report_sink(
        session, sink_id=sink_id, track_id=first.track.id, event="ended", position_s=180.0
    )
    assert changed is False
    assert state.track is not None
    assert state.track.id == second.track.id


async def test_the_newest_screen_takes_the_sound_over(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    await add_song(session, tmp_path, 1)
    await enable(session)
    first = await register(session)
    second = await register(session)

    assert second != first
    # The tab that lost learns from its next report, and from the generation in the payload.
    assert (await service.read()).sink_generation == 2
    with pytest.raises(service.NotTheSinkError):
        await service.report_sink(
            session, sink_id=first, track_id="whatever", event="progress", position_s=1.0
        )


async def test_the_real_duration_comes_from_the_screen(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    await add_song(session, tmp_path, 1)
    await enable(session)
    sink_id = await register(session)
    track = (await service.read()).track
    assert track is not None

    # The first report carrying a length is the one worth telling everybody about: it is
    # what lets a progress bar exist at all.
    state, changed = await service.report_sink(
        session,
        sink_id=sink_id,
        track_id=track.id,
        event="progress",
        position_s=5.0,
        duration_s=214.0,
    )
    assert changed is True
    assert state.track is not None
    assert state.track.duration_s == pytest.approx(214.0)

    # Every plain report after it is silent.
    _, changed = await service.report_sink(
        session,
        sink_id=sink_id,
        track_id=track.id,
        event="progress",
        position_s=10.0,
        duration_s=214.0,
    )
    assert changed is False


async def test_a_library_that_will_not_play_stands_down(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    for number in range(1, 4):
        await add_song(session, tmp_path, number)
    await enable(session)
    sink_id = await register(session)

    for _ in range(service.MAX_ERRORS):
        track = (await service.read()).track
        assert track is not None
        await service.report_sink(
            session,
            sink_id=sink_id,
            track_id=track.id,
            event="error",
            position_s=0.0,
            detail="404",
        )

    state = await service.read()
    assert state.status == "empty"
    assert state.retry_at == clock.now + service.ERROR_BACKOFF


async def test_the_hooks_are_quiet_after_shutdown(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
    broadcast_events: list[dict[str, object]],
) -> None:
    await add_song(session, tmp_path, 1)
    await enable(session)
    await register(session)
    await service.stop_watchdog()
    broadcast_events.clear()

    await service.sing_started()
    await service.sing_ended()

    assert broadcast_events == []
