import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ultrastar_wingman.settings import (
    SettingDefinition,
    SettingsService,
    SettingTypeError,
    SettingValue,
    UnknownSettingError,
)

TEST_DEFINITIONS = {
    definition.key: definition
    for definition in [
        SettingDefinition(
            key="test.text",
            value_type=str,
            default="hello",
            group="Test",
            description="A string.",
        ),
        SettingDefinition(
            key="test.count", value_type=int, default=3, group="Test", description="An int."
        ),
        SettingDefinition(
            key="test.enabled", value_type=bool, default=False, group="Test", description="A bool."
        ),
        SettingDefinition(
            key="test.ratio", value_type=float, default=0.5, group="Test", description="A float."
        ),
    ]
}


def make_service(session: AsyncSession) -> SettingsService:
    return SettingsService(session, TEST_DEFINITIONS)


async def test_get_falls_back_to_the_definition_default(session: AsyncSession) -> None:
    service = make_service(session)
    assert await service.get("test.text") == "hello"
    assert await service.get("test.count") == 3
    assert await service.get("test.enabled") is False
    assert await service.get("test.ratio") == 0.5


async def test_all_merges_stored_values_with_defaults(session: AsyncSession) -> None:
    service = make_service(session)
    await service.set("test.count", 7)
    assert await service.all() == {
        "test.text": "hello",
        "test.count": 7,
        "test.enabled": False,
        "test.ratio": 0.5,
    }


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("test.text", "changed"),
        ("test.count", 42),
        ("test.enabled", True),
        ("test.ratio", 1.25),
    ],
)
async def test_set_then_get_keeps_the_value_and_its_type(
    session: AsyncSession, key: str, value: SettingValue
) -> None:
    service = make_service(session)
    assert await service.set(key, value) == value
    stored = await service.get(key)
    assert stored == value
    assert type(stored) is type(value)


async def test_int_is_accepted_for_a_float_setting(session: AsyncSession) -> None:
    service = make_service(session)
    assert await service.set("test.ratio", 2) == 2.0
    assert type(await service.get("test.ratio")) is float


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("test.text", 5),
        ("test.count", "many"),
        ("test.count", True),  # a bool is not an int here
        ("test.enabled", 1),
        ("test.ratio", "fast"),
    ],
)
async def test_set_rejects_a_wrong_type(session: AsyncSession, key: str, value: object) -> None:
    with pytest.raises(SettingTypeError):
        await make_service(session).set(key, value)  # type: ignore[arg-type]


async def test_reset_drops_the_stored_value(session: AsyncSession) -> None:
    service = make_service(session)
    await service.set("test.text", "changed")
    assert await service.stored_keys() == {"test.text"}

    assert await service.reset("test.text") == "hello"
    assert await service.get("test.text") == "hello"
    assert await service.stored_keys() == set()


async def test_reset_of_an_untouched_setting_is_a_no_op(session: AsyncSession) -> None:
    assert await make_service(session).reset("test.count") == 3


async def test_unknown_key_raises(session: AsyncSession) -> None:
    service = make_service(session)
    with pytest.raises(UnknownSettingError):
        await service.get("test.nope")
    with pytest.raises(UnknownSettingError):
        await service.set("test.nope", "x")
    with pytest.raises(UnknownSettingError):
        await service.reset("test.nope")


async def test_value_survives_a_new_session(
    session_factory: async_sessionmaker[AsyncSession],
) -> None:
    async with session_factory() as session:
        await make_service(session).set("test.text", "persisted")
    async with session_factory() as session:
        assert await make_service(session).get("test.text") == "persisted"
