from pathlib import Path

import pytest
from httpx import AsyncClient

from ultrastar_wingman import APP_NAME, __version__
from ultrastar_wingman.config import BootstrapSettings


async def test_health(client: AsyncClient) -> None:
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"name": APP_NAME, "version": __version__}


async def test_openapi_schema_is_served_under_the_api_prefix(client: AsyncClient) -> None:
    # The frontend's client generator reads this exact URL (openapi-ts.config.ts).
    response = await client.get("/api/v1/openapi.json")
    assert response.status_code == 200
    paths = response.json()["paths"]
    assert "/api/v1/health" in paths
    # Handler names are the operation ids, so generated client methods stay readable.
    assert paths["/api/v1/settings"]["get"]["operationId"] == "list_settings"


async def test_list_settings_returns_definitions_with_defaults(client: AsyncClient) -> None:
    response = await client.get("/api/v1/settings")
    assert response.status_code == 200
    by_key = {item["key"]: item for item in response.json()}
    assert by_key["usdb.username"] == {
        "key": "usdb.username",
        "value": "",
        "value_type": "str",
        "default": "",
        "group": "USDB",
        "description": "Account used to search and download songs from usdb.animux.de.",
        "secret": False,
    }
    assert by_key["usdb.password"]["secret"] is True


async def test_patch_setting_updates_the_value(client: AsyncClient) -> None:
    response = await client.patch("/api/v1/settings/usdb.username", json={"value": "singer"})
    assert response.status_code == 200
    assert response.json()["value"] == "singer"

    listed = {item["key"]: item for item in (await client.get("/api/v1/settings")).json()}
    assert listed["usdb.username"]["value"] == "singer"


async def test_secret_values_are_never_returned(client: AsyncClient) -> None:
    response = await client.patch("/api/v1/settings/usdb.password", json={"value": "hunter2"})
    assert response.status_code == 200
    assert response.json()["value"] is None

    listed = {item["key"]: item for item in (await client.get("/api/v1/settings")).json()}
    assert listed["usdb.password"]["value"] is None


async def test_patch_unknown_setting_is_404(client: AsyncClient) -> None:
    response = await client.patch("/api/v1/settings/nope.nope", json={"value": "x"})
    assert response.status_code == 404


async def test_patch_with_a_wrong_type_is_rejected(client: AsyncClient) -> None:
    response = await client.patch("/api/v1/settings/usdb.username", json={"value": 5})
    assert response.status_code == 422

    listed = {item["key"]: item for item in (await client.get("/api/v1/settings")).json()}
    assert listed["usdb.username"]["value"] == ""


def test_bootstrap_settings_read_the_wingman_env_prefix(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("WINGMAN_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("WINGMAN_PORT", "9999")
    settings = BootstrapSettings()
    assert settings.data_dir == tmp_path
    assert settings.port == 9999
    assert settings.host == "0.0.0.0"
    assert settings.database_url.endswith("/wingman.db")


def test_bootstrap_defaults() -> None:
    settings = BootstrapSettings(_env_file=None)  # type: ignore[call-arg]
    assert settings.port == 8080
    assert settings.host == "0.0.0.0"
    assert settings.database_path.name == "wingman.db"
