"""The download quality setting: its presets, its validator and what the downloader does
with it."""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from ultrastar_wingman.downloads import media, video_quality
from ultrastar_wingman.settings import SettingsService, SettingValueError

SETTING = "downloads.video_format"


def test_the_default_is_one_of_the_presets() -> None:
    """The presets are what the UI offers; a default outside them would show up as a
    "Custom" format string nobody typed."""
    assert video_quality.DEFAULT_VIDEO_FORMAT in {
        preset.video_format for preset in video_quality.PRESETS
    }


def test_every_preset_passes_its_own_validator() -> None:
    for preset in video_quality.PRESETS:
        video_quality.validate_video_format(preset.video_format)


@pytest.mark.parametrize(
    "value",
    [
        pytest.param("best", id="plain"),
        # The characters a format selector is written with: refusing these would refuse
        # the default itself.
        pytest.param("bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best*", id="selector"),
    ],
)
def test_a_usable_format_is_accepted(value: str) -> None:
    video_quality.validate_video_format(value)


@pytest.mark.parametrize(
    "value",
    [
        pytest.param("", id="empty"),
        pytest.param("   ", id="blank"),
        pytest.param("best; rm -rf /", id="semicolon"),
        pytest.param("best | tee out", id="pipe"),
        pytest.param("best && echo", id="ampersand"),
        pytest.param("$(id)", id="substitution"),
        pytest.param("`id`", id="backtick"),
        pytest.param('best"', id="quote"),
        pytest.param("best\nworst", id="newline"),
        pytest.param("b" * (video_quality.MAX_FORMAT_LENGTH + 1), id="too-long"),
    ],
)
def test_an_unusable_format_is_refused(value: str) -> None:
    with pytest.raises(ValueError):
        video_quality.validate_video_format(value)


async def test_the_setting_refuses_what_the_validator_refuses(session: AsyncSession) -> None:
    with pytest.raises(SettingValueError):
        await SettingsService(session).set(SETTING, "best; whoami")


async def test_a_rejected_format_is_reported_at_the_field(client: AsyncClient) -> None:
    response = await client.patch(f"/api/v1/settings/{SETTING}", json={"value": "best; whoami"})

    assert response.status_code == 422
    assert "must not contain ;" in response.json()["detail"]


async def test_the_presets_are_served_with_their_format_strings(client: AsyncClient) -> None:
    response = await client.get("/api/v1/downloads/video-quality")

    assert response.status_code == 200
    presets = response.json()["presets"]
    assert [preset["key"] for preset in presets] == [preset.key for preset in video_quality.PRESETS]
    high = next(preset for preset in presets if preset["key"] == "high")
    assert high["video_format"] == video_quality.DEFAULT_VIDEO_FORMAT
    assert high["label"] == "High (1080p)"
    assert high["description"]


async def test_the_download_format_is_the_configured_one(session: AsyncSession) -> None:
    assert await media.video_format(session) == video_quality.DEFAULT_VIDEO_FORMAT

    await SettingsService(session).set(SETTING, "worstvideo+worstaudio")

    assert await media.video_format(session) == "worstvideo+worstaudio"
