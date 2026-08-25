"""The configured singing slots: how many people sing and in which colors.

One setting holds the whole thing (`karaoke.player_colors`), so the count and the
colors can never disagree. These tests pin the rules Ultrastar Deluxe imposes on it.
"""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from ultrastar_wingman.karaoke import service
from ultrastar_wingman.karaoke.colors import COLOR_NAMES
from ultrastar_wingman.karaoke.slots import (
    DEFAULT_SLOT_COLORS,
    PLAYER_COUNTS,
    InvalidSlotColorsError,
    format_slot_colors,
    parse_slot_colors,
)
from ultrastar_wingman.settings import Setting, SettingsService, SettingValueError

KEY = "karaoke.player_colors"


def test_the_defaults_are_usdx_own_first_four_colors() -> None:
    """USDX starts player n on color n; four players is what a party has mics for."""
    assert DEFAULT_SLOT_COLORS == ("blue", "red", "green", "yellow")
    assert len(DEFAULT_SLOT_COLORS) in PLAYER_COUNTS


@pytest.mark.parametrize("count", PLAYER_COUNTS)
def test_every_count_usdx_accepts_parses(count: int) -> None:
    raw = format_slot_colors(COLOR_NAMES[:count])
    assert parse_slot_colors(raw) == list(COLOR_NAMES[:count])


def test_surrounding_whitespace_and_empty_entries_are_tolerated() -> None:
    assert parse_slot_colors(" blue , red ,") == ["blue", "red"]


@pytest.mark.parametrize(
    ("raw", "complaint"),
    [
        # 5 is not in USDX's `IPlayers`, so it would silently mean *one* player.
        ("blue,red,green,yellow,orange", "on one screen"),
        ("", "on one screen"),
        ("blue,red,green,yellow,orange,pink,violet", "on one screen"),
        ("blue,chartreuse", "unknown color"),
        ("blue,blue", "color of their own"),
    ],
)
def test_an_unusable_list_is_refused(raw: str, complaint: str) -> None:
    with pytest.raises(InvalidSlotColorsError, match=complaint):
        parse_slot_colors(raw)


async def test_the_setting_defaults_to_the_default_slots(session: AsyncSession) -> None:
    assert await SettingsService(session).get(KEY) == "blue,red,green,yellow"
    assert await service.slot_colors(session) == ["blue", "red", "green", "yellow"]


async def test_the_setting_rejects_a_list_usdx_could_not_use(session: AsyncSession) -> None:
    service_ = SettingsService(session)
    with pytest.raises(SettingValueError):
        await service_.set(KEY, "blue,red,green,yellow,orange")
    # Nothing was stored, so the slots are still the ones USDX was told about.
    assert await service.slot_colors(session) == list(DEFAULT_SLOT_COLORS)


async def test_a_hand_edited_database_falls_back_to_the_default(session: AsyncSession) -> None:
    """The value is validated on the way in, but a broken row must not break the sing flow."""
    session.add(Setting(key=KEY, value='"blue,blue,blue"'))
    await session.commit()

    assert await service.slot_colors(session) == list(DEFAULT_SLOT_COLORS)


async def test_the_slots_endpoint_answers_with_the_configured_colors(
    client: AsyncClient, session: AsyncSession
) -> None:
    response = await client.get("/api/v1/karaoke/slots")

    assert response.status_code == 200
    body = response.json()
    assert body["slots"] == [
        {"name": "blue", "hex": "#048BB9"},
        {"name": "red", "hex": "#D00000"},
        {"name": "green", "hex": "#00AC00"},
        {"name": "yellow", "hex": "#E7E700"},
    ]
    # The counts USDX plays on one screen: no client has to know that 5 is not one.
    assert body["player_counts"] == [1, 2, 3, 4, 6]

    await SettingsService(session).set(KEY, "gray,dark_blue")

    changed = await client.get("/api/v1/karaoke/slots")
    assert changed.json()["slots"] == [
        {"name": "gray", "hex": "#888888"},
        {"name": "dark_blue", "hex": "#0000C7"},
    ]


async def test_the_settings_api_reports_the_registrys_complaint(client: AsyncClient) -> None:
    refused = await client.patch(f"/api/v1/settings/{KEY}", json={"value": "blue,blue"})

    assert refused.status_code == 422
    assert "color of their own" in refused.json()["detail"]

    accepted = await client.patch(f"/api/v1/settings/{KEY}", json={"value": "pink,cyan"})
    assert accepted.status_code == 200
    assert accepted.json()["value"] == "pink,cyan"


async def test_a_guest_sees_the_slots_too(anonymous_client: AsyncClient) -> None:
    """A party guest starts songs from their phone, so the player selection — and with it
    the slot list — has to work without an account."""
    response = await anonymous_client.get("/api/v1/karaoke/slots")

    assert response.status_code == 200
    assert [slot["name"] for slot in response.json()["slots"]] == list(DEFAULT_SLOT_COLORS)
