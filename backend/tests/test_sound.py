"""The volume settings: what the validator accepts, and that the registry enforces it."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from ultrastar_wingman.settings import (
    DEFINITIONS,
    SettingsService,
    SettingTypeError,
    SettingValueError,
)
from ultrastar_wingman.sound import (
    EFFECTS_VOLUME,
    MASTER_VOLUME,
    MUSIC_VOLUME,
    VOLUME_KEYS,
    validate_volume,
)


@pytest.mark.parametrize("value", [0, 1, 50, 99, 100])
def test_a_percentage_is_accepted(value: int) -> None:
    validate_volume(value)


@pytest.mark.parametrize(
    "value",
    [
        pytest.param(-1, id="below zero"),
        pytest.param(101, id="above a hundred"),
        pytest.param(1000, id="far above"),
    ],
)
def test_a_number_outside_the_range_is_refused(value: int) -> None:
    with pytest.raises(ValueError):
        validate_volume(value)


@pytest.mark.parametrize(
    "value",
    [
        # `bool` is an `int` in Python, so the type check has to say so itself: a checkbox
        # is not a volume, and the registry would otherwise widen `True` into 1.
        pytest.param(True, id="a checkbox"),
        pytest.param(50.5, id="a fraction"),
        pytest.param("50", id="the number as text"),
    ],
)
def test_anything_that_is_not_a_whole_number_is_refused(value: object) -> None:
    with pytest.raises(ValueError):
        validate_volume(value)


def test_the_three_keys_are_registered_in_one_group() -> None:
    assert {MASTER_VOLUME, MUSIC_VOLUME, EFFECTS_VOLUME} == VOLUME_KEYS
    for key in VOLUME_KEYS:
        assert DEFINITIONS[key].group == "Sound"
        assert DEFINITIONS[key].value_type is int


async def test_the_registry_refuses_a_volume_out_of_range(session: AsyncSession) -> None:
    settings = SettingsService(session)
    with pytest.raises(SettingValueError):
        await settings.set(MUSIC_VOLUME, 101)
    # The refused write left the default standing rather than a clamped value.
    assert await settings.get(MUSIC_VOLUME) == DEFINITIONS[MUSIC_VOLUME].default


async def test_the_registry_refuses_a_volume_of_the_wrong_type(session: AsyncSession) -> None:
    settings = SettingsService(session)
    with pytest.raises(SettingTypeError):
        await settings.set(MASTER_VOLUME, "loud")


async def test_a_volume_round_trips(session: AsyncSession) -> None:
    settings = SettingsService(session)
    await settings.set(EFFECTS_VOLUME, 35)
    assert await settings.get(EFFECTS_VOLUME) == 35
