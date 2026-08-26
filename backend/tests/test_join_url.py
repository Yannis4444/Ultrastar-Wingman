"""The join-URL override: what the validator accepts, what normalisation does to it, and
what `/join` answers with and without it."""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from ultrastar_wingman.join_url import MAX_LENGTH, normalize_join_url, validate_join_url
from ultrastar_wingman.settings import SettingsService, SettingValueError

SETTING = "host.join_url"


@pytest.mark.parametrize(
    "value",
    [
        pytest.param("", id="empty means auto"),
        pytest.param("http://192.168.0.5:1234", id="ip and port"),
        pytest.param("https://party.example", id="https, no port"),
        pytest.param("192.168.0.5:1234", id="no scheme"),
        pytest.param("wingman.local", id="host name alone"),
        pytest.param("http://192.168.0.5:1234/", id="trailing slash"),
        pytest.param("http://192.168.0.5:1234/wingman", id="behind a path"),
    ],
)
def test_an_openable_address_is_accepted(value: str) -> None:
    validate_join_url(value)


@pytest.mark.parametrize(
    ("value", "reason"),
    [
        pytest.param("ftp://192.168.0.5", "http://", id="wrong scheme"),
        pytest.param("http://", "needs a host", id="no host"),
        pytest.param("http://192.168.0.5:port", "port", id="non-numeric port"),
        pytest.param("192.168.0.5 :1234", "spaces", id="whitespace inside"),
        pytest.param("h" * (MAX_LENGTH + 1), "at most", id="too long"),
    ],
)
def test_an_address_no_phone_could_open_is_refused(value: str, reason: str) -> None:
    with pytest.raises(ValueError, match=reason):
        validate_join_url(value)


@pytest.mark.parametrize(
    ("stored", "expected"),
    [
        pytest.param("192.168.0.5:1234", "http://192.168.0.5:1234", id="scheme added"),
        pytest.param("http://192.168.0.5:1234/", "http://192.168.0.5:1234", id="slash dropped"),
        pytest.param("  http://a.b  ", "http://a.b", id="trimmed"),
        pytest.param("", "", id="empty stays empty"),
        # Rejected at write time, so only a hand-edited database reaches this — it still
        # must not turn into the nonsense "http:".
        pytest.param("http://", "http://", id="scheme alone survives"),
    ],
)
def test_normalisation_is_what_the_qr_encodes(stored: str, expected: str) -> None:
    assert normalize_join_url(stored) == expected


@pytest.mark.parametrize(
    ("stored", "expected"),
    [
        # The motivating case: "my PC is at 192.168.1.5" — Wingman does not listen on
        # 80, so without its own port the QR sends every guest nowhere.
        pytest.param("192.168.1.5", "http://192.168.1.5:8080", id="bare address"),
        pytest.param("wingman.local", "http://wingman.local:8080", id="bare host name"),
        pytest.param("wingman.local/party", "http://wingman.local:8080/party", id="bare with path"),
        pytest.param("[::1]", "http://[::1]:8080", id="bare ipv6"),
        # A port of their own is a port of their own.
        pytest.param("192.168.1.5:1234", "http://192.168.1.5:1234", id="port kept"),
        # A typed scheme means a real URL — a reverse proxy on its default port, which
        # Wingman's own port would break.
        pytest.param("http://192.168.1.5", "http://192.168.1.5", id="typed http left alone"),
        pytest.param("https://party.example", "https://party.example", id="typed https left alone"),
        pytest.param("", "", id="empty stays empty"),
    ],
)
def test_a_bare_address_is_completed_with_the_port_wingman_listens_on(
    stored: str, expected: str
) -> None:
    assert normalize_join_url(stored, port=8080) == expected


async def test_join_guesses_the_lan_address_while_the_setting_is_empty(
    client: AsyncClient,
) -> None:
    response = await client.get("/api/v1/join")
    assert response.status_code == 200
    url = response.json()["url"]
    assert url.startswith("http://")
    assert url.rsplit(":", 1)[1].isdigit()


async def test_join_returns_the_override_normalised(client: AsyncClient) -> None:
    patched = await client.patch(f"/api/v1/settings/{SETTING}", json={"value": "10.0.0.7:9000/"})
    assert patched.status_code == 200

    response = await client.get("/api/v1/join")
    assert response.json()["url"] == "http://10.0.0.7:9000"


async def test_join_completes_a_bare_address_with_the_running_port(client: AsyncClient) -> None:
    guessed = (await client.get("/api/v1/join")).json()["url"]
    port = guessed.rsplit(":", 1)[1]

    await client.patch(f"/api/v1/settings/{SETTING}", json={"value": "192.168.1.5"})

    # The host corrected which address to advertise, not which port to listen on.
    assert (await client.get("/api/v1/join")).json()["url"] == f"http://192.168.1.5:{port}"


async def test_clearing_the_override_brings_the_guess_back(client: AsyncClient) -> None:
    await client.patch(f"/api/v1/settings/{SETTING}", json={"value": "10.0.0.7:9000"})
    await client.patch(f"/api/v1/settings/{SETTING}", json={"value": None})

    url = (await client.get("/api/v1/join")).json()["url"]
    assert url != "http://10.0.0.7:9000"
    assert url.startswith("http://")


async def test_an_unusable_override_is_refused_and_the_qr_keeps_working(
    client: AsyncClient,
) -> None:
    await client.patch(f"/api/v1/settings/{SETTING}", json={"value": "10.0.0.7:9000"})

    response = await client.patch(f"/api/v1/settings/{SETTING}", json={"value": "ftp://nope"})
    assert response.status_code == 422
    # The registry's own complaint, verbatim: the settings field prints it under the input.
    assert response.json()["detail"] == (
        f"setting '{SETTING}': a join URL must start with http:// or https://"
    )
    # The refused value was never stored, so the TV still shows the address that worked.
    assert (await client.get("/api/v1/join")).json()["url"] == "http://10.0.0.7:9000"


async def test_the_registered_definition_carries_the_validator(session: AsyncSession) -> None:
    service = SettingsService(session)
    assert await service.set(SETTING, "http://192.168.0.5:1234") == "http://192.168.0.5:1234"

    with pytest.raises(SettingValueError, match="needs a host"):
        await service.set(SETTING, "http://")
