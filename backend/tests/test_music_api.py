"""The background music's routes: the controls and their refusals, the volumes, the options,
and the sink protocol.

The state machine itself is `test_music_state.py`; this is about what the HTTP layer does
with it — the status codes, the bodies, and which writes reach the event bus.
"""

import logging
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from test_music_state import add_song
from ultrastar_wingman.music import service


@pytest.fixture
async def playable(session: AsyncSession, tmp_path: Path) -> str:
    return await add_song(session, tmp_path, 1)


async def turn_on(client: AsyncClient, **options: Any) -> dict[str, Any]:
    response = await client.patch("/api/v1/music/settings", json={"enabled": True, **options})
    assert response.status_code == 200, response.text
    settings: dict[str, Any] = response.json()
    return settings


async def register(client: AsyncClient) -> str:
    response = await client.post("/api/v1/music/sink")
    assert response.status_code == 200, response.text
    sink_id: str = response.json()["sink_id"]
    return sink_id


def events_named(events: list[dict[str, object]], name: str) -> list[dict[str, object]]:
    return [event for event in events if event["event"] == name]


async def test_the_music_reads_as_off_on_a_fresh_install(client: AsyncClient) -> None:
    response = await client.get("/api/v1/music")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "off"
    assert body["track"] is None
    assert body["sink_online"] is False
    # The volumes ride along, so a guest phone draws the slider without `settings.view`.
    assert body["volume"] == {"master": 100, "music": 100, "preview": 100, "effects": 100}


async def test_the_controls_refuse_while_the_music_is_off(client: AsyncClient) -> None:
    for route in ("play", "skip"):
        response = await client.post(f"/api/v1/music/{route}")
        assert response.status_code == 409
        assert response.json() == {"detail": "music_disabled"}


async def test_pause_never_refuses(client: AsyncClient) -> None:
    # There is no state in which "be quiet" is a thing to argue with.
    response = await client.post("/api/v1/music/pause")
    assert response.status_code == 200
    assert response.json()["status"] == "off"


async def test_an_empty_library_refuses_play_and_says_why(client: AsyncClient) -> None:
    await turn_on(client)
    await register(client)
    response = await client.post("/api/v1/music/play")
    assert response.status_code == 409
    assert response.json() == {"detail": "empty_pool"}


async def test_turning_the_music_on_starts_a_song_once_a_screen_is_there(
    client: AsyncClient, playable: str, broadcast_events: list[dict[str, object]]
) -> None:
    await turn_on(client)
    await register(client)

    body = (await client.get("/api/v1/music")).json()
    assert body["status"] == "playing"
    assert body["track"]["song"]["id"] == playable
    # From the beginning. These tests run on the real clock, so "0" is "not a second in".
    assert body["track"]["position_s"] < 1
    assert body["sink_online"] is True
    assert events_named(broadcast_events, "music.changed")


async def test_the_settings_carry_the_playlist_and_the_state_does_not(
    client: AsyncClient, playable: str
) -> None:
    await turn_on(client, scope="playlist", playlist="some-playlist-id")

    settings = (await client.get("/api/v1/music/settings")).json()
    assert settings["playlist"] == "some-playlist-id"

    # Deliberately absent from the open payload: an id on the anonymous event bus could
    # name a list its owner keeps to themselves.
    assert "playlist" not in (await client.get("/api/v1/music")).json()


async def test_a_scope_the_app_does_not_know_is_refused(client: AsyncClient) -> None:
    response = await client.patch("/api/v1/music/settings", json={"scope": "everything"})
    assert response.status_code == 422
    assert "all" in response.json()["detail"]


async def test_a_resume_delay_out_of_range_is_refused(client: AsyncClient) -> None:
    response = await client.patch("/api/v1/music/settings", json={"resume_delay_s": 9999})
    assert response.status_code == 422
    # The registry's own sentence, verbatim, which is what the panel shows under the field.
    assert response.json()["detail"].endswith("between 0 and 120 seconds")


async def test_the_volume_is_written_without_the_settings_right(
    client: AsyncClient, broadcast_events: list[dict[str, object]]
) -> None:
    response = await client.put("/api/v1/music/volume", json={"music": 25})
    assert response.status_code == 200
    assert response.json()["volume"]["music"] == 25

    # The registry holds it, so the Settings page shows the same number.
    settings = (await client.get("/api/v1/settings")).json()
    assert {row["key"]: row["value"] for row in settings}["sound.music_volume"] == 25

    # And a Settings page somebody has open is told, as well as every player.
    changed = events_named(broadcast_events, "setting.changed")
    assert [event["key"] for event in changed] == ["sound.music_volume"]
    assert events_named(broadcast_events, "music.changed")


async def test_a_volume_is_no_line_in_the_console_but_another_setting_is(
    client: AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    """A volume is a slider on every phone, written on each pause in the drag."""
    caplog.set_level(logging.INFO, logger="ultrastar_wingman.settings")

    await client.put("/api/v1/music/volume", json={"music": 25, "master": 60})
    await client.patch("/api/v1/settings/sound.reel_preview", json={"value": False})

    assert [record.getMessage() for record in caplog.records] == [
        "Setting 'sound.reel_preview' changed"
    ]


async def test_a_volume_set_on_the_settings_page_reaches_the_music(
    client: AsyncClient, broadcast_events: list[dict[str, Any]]
) -> None:
    """The Settings page writes the ordinary `sound.*` key; the host screen reads the volume
    off the music state, so that write has to land there too — and be announced."""
    response = await client.patch("/api/v1/settings/sound.music_volume", json={"value": 30})
    assert response.status_code == 200

    body = (await client.get("/api/v1/music")).json()
    assert body["volume"]["music"] == 30
    assert events_named(broadcast_events, "music.changed")


async def test_the_reel_switch_is_a_sound_setting_and_not_a_music_option(
    client: AsyncClient,
) -> None:
    rows = {row["key"]: row for row in (await client.get("/api/v1/settings")).json()}
    assert rows["sound.reel_preview"]["value"] is True
    assert rows["sound.reel_preview"]["group"] == "Sound"
    assert rows["sound.preview_volume"]["value"] == 100
    # The gear's panel knows nothing of it.
    assert "preview_on_spin" not in (await client.get("/api/v1/music/settings")).json()
    response = await client.patch("/api/v1/settings/sound.reel_preview", json={"value": False})
    assert response.status_code == 200
    # And the state carries no preview while nothing is spun.
    assert (await client.get("/api/v1/music")).json()["preview"] is None


async def test_the_sound_effects_switch_rides_the_music_state(
    client: AsyncClient, broadcast_events: list[dict[str, Any]]
) -> None:
    """The host plays its effects off the music state, so the switch is on it — and a write
    on the Settings page reaches an open host page as `music.changed`, without a reload."""
    rows = {row["key"]: row for row in (await client.get("/api/v1/settings")).json()}
    assert rows["sound.effects"]["value"] is True
    assert rows["sound.effects"]["group"] == "Sound"
    assert (await client.get("/api/v1/music")).json()["sound_effects"] is True

    response = await client.patch("/api/v1/settings/sound.effects", json={"value": False})
    assert response.status_code == 200

    changed = events_named(broadcast_events, "music.changed")
    assert changed
    payload = changed[-1]["music"]
    assert isinstance(payload, dict)
    assert payload["sound_effects"] is False
    assert (await client.get("/api/v1/music")).json()["sound_effects"] is False


async def test_the_sound_effects_switch_sits_next_to_the_song_preview(
    client: AsyncClient,
) -> None:
    """Registered right after `sound.reel_preview`, so the Settings page, which keeps the
    registry's order inside a group, draws the two switches together."""
    keys = [row["key"] for row in (await client.get("/api/v1/settings")).json()]
    assert keys.index("sound.effects") == keys.index("sound.reel_preview") + 1


async def test_only_the_volumes_named_are_written(client: AsyncClient) -> None:
    await client.put("/api/v1/music/volume", json={"master": 40})
    body = (await client.put("/api/v1/music/volume", json={"effects": 10})).json()
    assert body["volume"] == {"master": 40, "music": 100, "preview": 100, "effects": 10}


async def test_a_volume_out_of_range_is_refused(client: AsyncClient) -> None:
    response = await client.put("/api/v1/music/volume", json={"master": 101})
    # Bounded by the request model before it ever reaches the registry.
    assert response.status_code == 422


async def test_skipping_moves_to_another_song(
    client: AsyncClient, session: AsyncSession, tmp_path: Path
) -> None:
    await add_song(session, tmp_path, 1)
    await add_song(session, tmp_path, 2)
    await turn_on(client)
    await register(client)

    first = (await client.get("/api/v1/music")).json()["track"]
    second = (await client.post("/api/v1/music/skip")).json()["track"]
    assert second["song"]["id"] != first["song"]["id"]
    assert second["position_s"] < 1


async def test_the_newest_screen_wins_and_the_old_one_is_told(
    client: AsyncClient, playable: str
) -> None:
    first = await register(client)
    second = await register(client)
    assert first != second

    stale = await client.post(
        "/api/v1/music/sink/report",
        json={
            "sink_id": first,
            "track_id": "whatever",
            "event": "progress",
            "position_s": 1.0,
        },
    )
    assert stale.status_code == 409
    assert stale.json() == {"detail": "not_the_sink"}


async def test_a_report_for_an_old_track_is_answered_and_ignored(
    client: AsyncClient, playable: str
) -> None:
    await turn_on(client)
    sink_id = await register(client)
    track = (await client.get("/api/v1/music")).json()["track"]

    await client.post(
        "/api/v1/music/sink/report",
        json={"sink_id": sink_id, "track_id": track["id"], "event": "ended", "position_s": 9.0},
    )
    after = (await client.get("/api/v1/music")).json()["track"]

    # The same report again: a retry after a timeout, or one that crossed a skip. It is a
    # 200 carrying the state, never an error the host would retry forever.
    repeat = await client.post(
        "/api/v1/music/sink/report",
        json={"sink_id": sink_id, "track_id": track["id"], "event": "ended", "position_s": 9.0},
    )
    assert repeat.status_code == 200
    assert repeat.json()["track"]["id"] == after["id"]


async def test_a_progress_report_is_not_broadcast_but_the_first_duration_is(
    client: AsyncClient, playable: str, broadcast_events: list[dict[str, object]]
) -> None:
    await turn_on(client)
    sink_id = await register(client)
    track = (await client.get("/api/v1/music")).json()["track"]
    broadcast_events.clear()

    body = {
        "sink_id": sink_id,
        "track_id": track["id"],
        "event": "progress",
        "position_s": 3.0,
        "duration_s": 214.0,
    }
    first = await client.post("/api/v1/music/sink/report", json=body)
    assert first.json()["track"]["duration_s"] == 214.0
    # The one report worth telling the room about, and it carries the number it learned.
    told = events_named(broadcast_events, "music.changed")
    assert len(told) == 1
    assert told[0]["music"]["track"]["duration_s"] == 214.0  # type: ignore[index]

    broadcast_events.clear()
    await client.post("/api/v1/music/sink/report", json={**body, "position_s": 8.0})
    # Every one after it is silent: a socket message per screen per five seconds is a busy
    # room for nothing.
    assert events_named(broadcast_events, "music.changed") == []


async def test_releasing_a_lease_nobody_holds_is_still_a_204(client: AsyncClient) -> None:
    response = await client.post("/api/v1/music/sink/release", json={"sink_id": "nobody"})
    assert response.status_code == 204


async def test_releasing_the_lease_takes_the_screen_offline(
    client: AsyncClient, playable: str
) -> None:
    await turn_on(client)
    sink_id = await register(client)
    assert (await client.get("/api/v1/music")).json()["sink_online"] is True

    response = await client.post("/api/v1/music/sink/release", json={"sink_id": sink_id})
    assert response.status_code == 204

    body = (await client.get("/api/v1/music")).json()
    assert body["sink_online"] is False
    # The track stays: "playing, but no screen is listening" is what the phone turns into
    # "open the host screen to hear it".
    assert body["status"] == "playing"
    assert body["track"] is not None


async def test_a_sing_blocks_the_music_and_says_which_way(
    client: AsyncClient, playable: str
) -> None:
    await turn_on(client)
    await register(client)
    await service.sing_started()

    body = (await client.get("/api/v1/music")).json()
    assert body["status"] == "blocked"
    assert body["blocked_by"] == "sing"

    refused = await client.post("/api/v1/music/skip")
    assert refused.status_code == 409
    assert refused.json() == {"detail": "music_blocked"}
