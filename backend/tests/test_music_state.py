"""The background music's state machine.

Every test here moves `service._now` by hand and calls `service.tick()` explicitly. Nothing
sleeps: the module's whole design is a deadline plus a tick, precisely so that the clock is
an argument rather than something a test has to wait for.
"""

import dataclasses
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ultrastar_wingman.karaoke import reel, selection
from ultrastar_wingman.library.model import Wish
from ultrastar_wingman.music import service
from ultrastar_wingman.music import settings as music_settings
from ultrastar_wingman.settings import SettingsService
from ultrastar_wingman.songs.model import Song
from ultrastar_wingman.sound import REEL_PREVIEW
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
    """Switch the music on, and load the caches the way the watchdog would. The reel
    switch is a registered `sound.*` setting and goes through the registry."""
    settings = music_settings.service(session)
    await settings.set(music_settings.ENABLED, True)
    for key, value in options.items():
        if key == "song_preview":
            await SettingsService(session).set(REEL_PREVIEW, value)
        else:
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
    # Nor its loudness: no tag was ever read off it.
    assert (state.track.gain_db, state.track.peak) == (None, None)


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


def record_draws(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, float]]:
    """Every draw the reel makes, its ids with their weights rounded to four places, landing
    on the first id."""
    draws: list[dict[str, float]] = []

    def choices(
        population: Sequence[str],
        weights: Sequence[float] | None = None,
        *,
        cum_weights: Sequence[float] | None = None,
        k: int = 1,
    ) -> list[str]:
        assert weights is not None
        draws.append(
            {song_id: round(weight, 4) for song_id, weight in zip(population, weights, strict=True)}
        )
        return [population[0]]

    monkeypatch.setattr(reel.random, "choices", choices)
    return draws


async def test_the_weighted_scope_plays_with_fair_wishes(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """*Wishlist (weighted)* means one thing everywhere: one guest's two wishes weigh
    (1 + ln 2) / 2 each, another guest's one wish 1."""
    one = await add_song(session, tmp_path, 1)
    two = await add_song(session, tmp_path, 2)
    session.add_all(
        [
            Wish(song_id=one, guest_id="many"),
            Wish(song_id=two, guest_id="many"),
            Wish(song_id=two, guest_id="once"),
        ]
    )
    await session.commit()
    draws = record_draws(monkeypatch)
    await enable(session, scope="weighted")
    await register(session)

    assert draws == [{one: 0.8466, two: 1.8466}]


async def test_the_music_never_sees_a_skipped_song_s_mark_nor_makes_one(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The rest rule is the host spins' alone: the music's own pick, and the selector's
    cancel button skipping to the next song, weigh a song the reel just passed over in full
    and leave the marks as they found them."""
    one = await add_song(session, tmp_path, 1)
    two = await add_song(session, tmp_path, 2)
    three = await add_song(session, tmp_path, 3)
    reel.note_spun(one, START)
    reel.note_spun(two, START)
    marks = dict(reel._spun_at)
    draws = record_draws(monkeypatch)
    await enable(session)
    await register(session)

    playing = await service.read()
    assert playing.track is not None and playing.track.song.id == one
    await selection.button_pressed(session, session_factory, "cancel", skip_music=True)

    skipped = await service.read()
    assert skipped.track is not None and skipped.track.song.id == two
    assert draws == [{one: 1.0, two: 1.0, three: 1.0}, {two: 1.0, three: 1.0}]
    assert reel._spun_at == marks


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


async def test_play_carries_on_from_where_pause_left_it(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    """The silence must not be added to the position: pause at 5, play three seconds later,
    and a second after that the track is at 6 — not at 9. The whole thing inside the sink's
    timeout, as `test_pause_freezes_the_position` explains."""
    await add_song(session, tmp_path, 1)
    await enable(session)
    await register(session)

    clock.advance(5)
    await service.pause(session)
    clock.advance(3)
    await service.play(session)
    clock.advance(1)
    state = await service.read()
    assert state.status == "playing"
    assert state.track is not None
    assert state.track.position_s == pytest.approx(6)


def spin_preview(
    song_id: str,
    *,
    key: str = "s:1",
    start_s: float | None = 12.0,
    has_audio: bool = True,
    reveal_at: datetime = START + timedelta(seconds=5.5),
) -> service.SelectionPreview:
    from ultrastar_wingman.songs.schema import SongRead

    return service.SelectionPreview(
        key=key,
        song=SongRead(
            id=song_id,
            source="usdb",
            title="Title",
            artist="Artist",
            duration_seconds=None,
            has_video=False,
            is_duet=False,
            language=None,
            genre=None,
            year=None,
            edition=None,
            creator=None,
            created_at=START,
        ),
        start_s=start_s,
        reveal_at=reveal_at,
        has_audio=has_audio,
    )


async def test_the_reel_freezes_the_music_and_gives_it_back_where_it_stopped(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    song = await add_song(session, tmp_path, 1)
    await enable(session)
    await register(session)
    clock.advance(4)

    await service.selection_changed(spin_preview(song))
    state = await service.read()
    assert state.preview is not None
    assert state.preview.id == "s:1"
    assert state.preview.start_s == 12.0
    assert state.preview.reveal_at == START + timedelta(seconds=5.5)
    # The background froze at 4 and stays there for as long as the reel's song plays.
    clock.advance(3)
    assert (await service.read()).track.position_s == pytest.approx(4)  # type: ignore[union-attr]

    # The selection is gone: the preview goes, and the track moves again from here.
    await service.selection_changed(None)
    state = await service.read()
    assert state.preview is None
    clock.advance(2)
    assert (await service.read()).track.position_s == pytest.approx(6)  # type: ignore[union-attr]


async def test_the_track_and_the_preview_carry_the_songs_replay_gain(
    session: AsyncSession, tmp_path: Path, clock: Clock
) -> None:
    """What the host plays them at (`downloads.loudness`), and None while nobody knows."""
    song = await add_song(session, tmp_path, 1)
    row = await session.get(Song, song)
    assert row is not None
    row.replay_gain_db, row.replay_gain_peak = -6.5, 0.9
    await session.commit()
    await enable(session)
    await register(session)

    state = await service.read()
    assert state.track is not None
    assert (state.track.gain_db, state.track.peak) == (-6.5, 0.9)

    await service.selection_changed(dataclasses.replace(spin_preview(song), gain_db=1.5, peak=0.25))
    state = await service.read()
    assert state.preview is not None
    assert (state.preview.gain_db, state.preview.peak) == (1.5, 0.25)
    await service.selection_changed(spin_preview(song, key="s:2"))
    preview = (await service.read()).preview
    assert preview is not None
    assert (preview.gain_db, preview.peak) == (None, None)


async def test_the_reel_plays_with_the_music_switched_off(
    session: AsyncSession, tmp_path: Path, clock: Clock
) -> None:
    song = await add_song(session, tmp_path, 1)
    await service.apply_settings(session)
    assert (await service.read()).status == "off"

    await service.selection_changed(spin_preview(song))
    state = await service.read()
    assert state.status == "off"
    assert state.preview is not None


async def test_the_reel_is_silent_without_a_file_or_with_the_switch_off_or_under_a_sing(
    session: AsyncSession, tmp_path: Path, clock: Clock
) -> None:
    song = await add_song(session, tmp_path, 1)
    await enable(session)

    await service.selection_changed(spin_preview(song, has_audio=False))
    assert (await service.read()).preview is None

    await service.sing_started()
    await service.selection_changed(spin_preview(song))
    assert (await service.read()).preview is None
    await service.sing_ended()

    await enable(session, song_preview=False)
    await service.selection_changed(spin_preview(song))
    assert (await service.read()).preview is None


async def test_switching_the_reels_song_off_ends_one_that_plays(
    session: AsyncSession, tmp_path: Path, clock: Clock
) -> None:
    # The Settings page writes `sound.reel_preview`; `api.update_setting` applies the
    # settings again, which is the path a switch flipped mid-reel takes to the speakers.
    song = await add_song(session, tmp_path, 1)
    await enable(session)
    await service.selection_changed(spin_preview(song))
    assert (await service.read()).preview is not None

    await SettingsService(session).set(REEL_PREVIEW, False)
    await service.apply_settings(session)
    assert (await service.read()).preview is None


async def test_a_sing_takes_the_reels_song_off_the_speakers(
    session: AsyncSession, tmp_path: Path, clock: Clock
) -> None:
    song = await add_song(session, tmp_path, 1)
    await enable(session)
    await service.selection_changed(spin_preview(song))
    assert (await service.read()).preview is not None

    await service.sing_started()
    assert (await service.read()).preview is None


async def test_no_song_is_picked_while_the_reels_song_plays(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    # A sing ends, somebody spins the reel inside the wait, and the wait runs out while the
    # reel's song plays: the phones must not show a track at 0:00 that nobody hears.
    song = await add_song(session, tmp_path, 1)
    await enable(session, resume_delay_s=5)
    await register(session)
    await service.sing_started()
    await service.sing_ended()
    await service.selection_changed(spin_preview(song))
    clock.advance(6)
    await service.tick(session_factory)
    assert (await service.read()).track is None

    await service.selection_changed(None)
    await service.tick(session_factory)
    assert (await service.read()).track is not None


async def test_a_file_that_names_no_preview_start_plays_from_the_beginning(
    session: AsyncSession, tmp_path: Path, clock: Clock
) -> None:
    song = await add_song(session, tmp_path, 1)
    await enable(session)
    await service.selection_changed(spin_preview(song, start_s=None))
    assert (await service.read()).preview.start_s == 0.0  # type: ignore[union-attr]


def music_events(events: list[dict[str, object]]) -> list[dict[str, object]]:
    return [event for event in events if event["event"] == "music.changed"]


async def test_the_same_selection_reported_again_changes_nothing(
    session: AsyncSession,
    tmp_path: Path,
    clock: Clock,
    broadcast_events: list[dict[str, object]],
) -> None:
    # A phone moving slots is a selection broadcast several times a second, every one of
    # them handing the music the same song of the same selection. None of them may restart
    # the song, re-freeze the background or tell the room anything.
    song = await add_song(session, tmp_path, 1)
    await enable(session)
    await register(session)
    clock.advance(4)
    broadcast_events.clear()

    await service.selection_changed(spin_preview(song, key="opened:song"))
    assert len(music_events(broadcast_events)) == 1
    first = await service.read()
    assert first.preview is not None

    for _ in range(5):
        clock.advance(1)
        await service.selection_changed(spin_preview(song, key="opened:song"))
    assert len(music_events(broadcast_events)) == 1
    state = await service.read()
    assert state.preview == first.preview
    # Frozen where the first one found it, not where any of the repeats did.
    assert state.track is not None
    assert state.track.position_s == pytest.approx(4)


async def test_an_early_landing_moves_the_preview_and_a_new_key_restarts_it(
    session: AsyncSession,
    tmp_path: Path,
    clock: Clock,
    broadcast_events: list[dict[str, object]],
) -> None:
    song = await add_song(session, tmp_path, 1)
    other = await add_song(session, tmp_path, 2)
    await enable(session)
    await register(session)
    clock.advance(4)
    await service.selection_changed(spin_preview(song))
    broadcast_events.clear()

    # A press landed the reel early: the same spin, a sooner landing — the host re-arms.
    clock.advance(2)
    await service.selection_changed(spin_preview(song, reveal_at=clock.now))
    state = await service.read()
    assert state.preview is not None
    assert state.preview.id == "s:1"
    assert state.preview.reveal_at == clock.now
    assert len(music_events(broadcast_events)) == 1

    # A respin, or a new selection: a new key, so a new preview from its start.
    await service.selection_changed(spin_preview(other, key="s:2"))
    state = await service.read()
    assert state.preview is not None
    assert state.preview.id == "s:2"
    assert state.preview.song.id == other
    assert len(music_events(broadcast_events)) == 2
    # The background stayed frozen at 4 throughout: the preview never went away.
    assert state.track is not None
    assert state.track.position_s == pytest.approx(4)


async def test_a_selection_lined_up_during_a_sing_is_heard_once_the_pause_is_over(
    session: AsyncSession,
    session_factory: async_sessionmaker[AsyncSession],
    tmp_path: Path,
    clock: Clock,
) -> None:
    # The next singers are picked while this song is being sung: nothing plays over
    # Ultrastar Deluxe, and the song they picked comes in once the pause after it is over —
    # on the tick, like the background music, whether that is switched on or not.
    song = await add_song(session, tmp_path, 1)
    await enable(session, resume_delay_s=5, enabled=False)
    await service.sing_started()
    await service.selection_changed(spin_preview(song, key="opened:song"))
    assert (await service.read()).preview is None

    await service.sing_ended()
    assert (await service.read()).preview is None
    clock.advance(4)
    await service.tick(session_factory)
    assert (await service.read()).preview is None
    clock.advance(2)
    await service.tick(session_factory)
    state = await service.read()
    assert state.preview is not None
    assert state.preview.id == "opened:song"

    # The same for the switch: off ends it, on again brings the standing selection back.
    await enable(session, song_preview=False)
    assert (await service.read()).preview is None
    await enable(session, song_preview=True)
    assert (await service.read()).preview is not None

    # And once the selection is gone, neither brings anything back.
    await service.selection_changed(None)
    await service.sing_started()
    await service.sing_ended()
    assert (await service.read()).preview is None


async def test_a_forced_start_over_a_standing_selection_never_swells_its_song_in(
    session: AsyncSession,
    tmp_path: Path,
    clock: Clock,
    broadcast_events: list[dict[str, object]],
) -> None:
    # A forced start stops the old song (`sing_ended`) and launches the new one a moment
    # later (`sing_started`) while the selection still stands: the song being picked must
    # not come in for that moment — and with no pause configured it still waits a moment
    # (`PREVIEW_HOLD_MIN`), for the tick to bring it.
    song = await add_song(session, tmp_path, 1)
    await enable(session, resume_delay_s=0)
    await service.sing_started()
    await service.selection_changed(spin_preview(song, key="opened:song"))
    broadcast_events.clear()

    await service.sing_ended()
    await service.sing_started()

    assert all(event["music"]["preview"] is None for event in music_events(broadcast_events))  # type: ignore[index]
    assert (await service.read()).preview is None


async def test_a_selection_opened_after_a_sing_is_heard_at_once(
    session: AsyncSession, tmp_path: Path, clock: Clock
) -> None:
    # The pause after a song holds back only a selection that stood through it: one the room
    # opens afterwards is somebody asking for that song now.
    song = await add_song(session, tmp_path, 1)
    await enable(session)
    await service.sing_started()
    await service.selection_changed(spin_preview(song, key="during:song"))
    await service.sing_ended()
    assert (await service.read()).preview is None

    await service.selection_changed(spin_preview(song, key="after:song"))
    state = await service.read()
    assert state.preview is not None
    assert state.preview.id == "after:song"


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
