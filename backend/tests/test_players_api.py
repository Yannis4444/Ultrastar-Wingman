from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from httpx import AsyncClient

from conftest import admin_client, authenticate_admin
from ultrastar_wingman.app import create_app
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.players.service import MAX_AVATAR_BYTES

# Smallest real images, so declared content type and magic bytes genuinely agree.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01" + b"\x00" * 16 + b"\xff\xd9"
WEBP = b"RIFF" + (20).to_bytes(4, "little") + b"WEBPVP8 " + b"\x00" * 12


def upload(data: bytes, filename: str, content_type: str) -> dict[str, tuple[str, bytes, str]]:
    return {"file": (filename, data, content_type)}


def avatar_files(avatars_dir: Path) -> list[str]:
    """Sync on purpose: ruff's ASYNC rules ban pathlib calls inside async functions."""
    return sorted(path.name for path in avatars_dir.iterdir()) if avatars_dir.is_dir() else []


async def create(client: AsyncClient, name: str) -> dict[str, object]:
    response = await client.post("/api/v1/players", json={"name": name})
    assert response.status_code == 201, response.text
    result: dict[str, object] = response.json()
    return result


@pytest.fixture
async def avatars_dir(bootstrap_settings: BootstrapSettings) -> Path:
    return bootstrap_settings.data_dir / "avatars"


async def test_create_list_and_delete_a_player(client: AsyncClient) -> None:
    player = await create(client, "Yannis")
    assert player["name"] == "Yannis"
    assert player["registered"] is False
    assert player["has_avatar"] is False
    assert len(str(player["id"])) == 32

    listed = await client.get("/api/v1/players")
    assert listed.status_code == 200
    assert listed.json() == {"players": [player]}

    deleted = await client.delete(f"/api/v1/players/{player['id']}")
    assert deleted.status_code == 204
    assert (await client.get("/api/v1/players")).json() == {"players": []}


async def test_players_are_listed_case_insensitively_by_name(client: AsyncClient) -> None:
    for name in ("zoe", "Anna", "bob"):
        await create(client, name)

    listed = await client.get("/api/v1/players")

    assert [player["name"] for player in listed.json()["players"]] == ["Anna", "bob", "zoe"]


async def test_the_name_is_trimmed_and_bounded(client: AsyncClient) -> None:
    assert (await create(client, "  Spacey  "))["name"] == "Spacey"
    assert (await client.post("/api/v1/players", json={"name": "   "})).status_code == 422
    assert (await client.post("/api/v1/players", json={"name": "x" * 65})).status_code == 422
    assert (await client.post("/api/v1/players", json={"name": "x" * 64})).status_code == 201


async def test_a_duplicate_name_is_409_regardless_of_case(client: AsyncClient) -> None:
    await create(client, "Yannis")

    conflict = await client.post("/api/v1/players", json={"name": "yAnNiS"})

    assert conflict.status_code == 409
    assert conflict.json() == {"detail": "duplicate_name"}
    assert len((await client.get("/api/v1/players")).json()["players"]) == 1


async def test_unknown_player_is_404(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/players/nope/avatar")).status_code == 404
    assert (await client.delete("/api/v1/players/nope")).status_code == 404
    assert (
        await client.put("/api/v1/players/nope/avatar", files=upload(PNG, "a.png", "image/png"))
    ).status_code == 404


@pytest.mark.parametrize(
    ("data", "filename", "content_type", "extension"),
    [
        (PNG, "avatar.png", "image/png", ".png"),
        (JPEG, "avatar.jpg", "image/jpeg", ".jpg"),
        (WEBP, "avatar.webp", "image/webp", ".webp"),
    ],
)
async def test_uploading_an_avatar_stores_and_serves_it(
    client: AsyncClient,
    avatars_dir: Path,
    data: bytes,
    filename: str,
    content_type: str,
    extension: str,
) -> None:
    player = await create(client, "Yannis")

    uploaded = await client.put(
        f"/api/v1/players/{player['id']}/avatar", files=upload(data, filename, content_type)
    )

    assert uploaded.status_code == 200
    assert uploaded.json()["has_avatar"] is True
    assert (avatars_dir / f"{player['id']}{extension}").read_bytes() == data

    served = await client.get(f"/api/v1/players/{player['id']}/avatar")
    assert served.status_code == 200
    assert served.content == data
    assert served.headers["content-type"] == content_type


async def test_a_player_without_an_avatar_is_404(client: AsyncClient) -> None:
    player = await create(client, "Yannis")
    assert (await client.get(f"/api/v1/players/{player['id']}/avatar")).status_code == 404


async def test_a_non_image_upload_is_rejected(client: AsyncClient, avatars_dir: Path) -> None:
    player = await create(client, "Yannis")

    rejected = await client.put(
        f"/api/v1/players/{player['id']}/avatar",
        files=upload(b"hello", "notes.txt", "text/plain"),
    )

    assert rejected.status_code == 415
    assert rejected.json() == {"detail": "unsupported_avatar_type"}
    assert avatar_files(avatars_dir) == []


async def test_a_text_file_renamed_to_png_is_rejected(
    client: AsyncClient, avatars_dir: Path
) -> None:
    player = await create(client, "Yannis")

    # Claims to be a png by extension and content type, but the magic bytes say otherwise.
    rejected = await client.put(
        f"/api/v1/players/{player['id']}/avatar",
        files=upload(b"just some text, definitely not a png", "avatar.png", "image/png"),
    )

    assert rejected.status_code == 415
    assert (await client.get(f"/api/v1/players/{player['id']}/avatar")).status_code == 404
    assert avatar_files(avatars_dir) == []


async def test_a_png_declared_as_jpeg_is_rejected(client: AsyncClient) -> None:
    player = await create(client, "Yannis")

    rejected = await client.put(
        f"/api/v1/players/{player['id']}/avatar", files=upload(PNG, "avatar.jpg", "image/jpeg")
    )

    assert rejected.status_code == 415


async def test_an_oversized_avatar_is_rejected(client: AsyncClient, avatars_dir: Path) -> None:
    player = await create(client, "Yannis")
    too_big = PNG + b"\x00" * (MAX_AVATAR_BYTES - len(PNG) + 1)

    rejected = await client.put(
        f"/api/v1/players/{player['id']}/avatar", files=upload(too_big, "big.png", "image/png")
    )

    assert rejected.status_code == 413
    assert rejected.json() == {"detail": "avatar_too_large"}
    assert avatar_files(avatars_dir) == []


async def test_replacing_an_avatar_leaves_exactly_one_file(
    client: AsyncClient, avatars_dir: Path
) -> None:
    player = await create(client, "Yannis")
    url = f"/api/v1/players/{player['id']}/avatar"
    assert (await client.put(url, files=upload(PNG, "a.png", "image/png"))).status_code == 200

    # A different extension: the old file must go, not linger next to the new one.
    assert (await client.put(url, files=upload(JPEG, "a.jpg", "image/jpeg"))).status_code == 200

    assert avatar_files(avatars_dir) == [f"{player['id']}.jpg"]
    assert (await client.get(url)).content == JPEG


async def test_deleting_a_player_deletes_the_avatar_file(
    client: AsyncClient, avatars_dir: Path
) -> None:
    player = await create(client, "Yannis")
    await client.put(
        f"/api/v1/players/{player['id']}/avatar", files=upload(PNG, "a.png", "image/png")
    )

    assert (await client.delete(f"/api/v1/players/{player['id']}")).status_code == 204

    assert avatar_files(avatars_dir) == []


async def test_players_survive_a_restart(
    bootstrap_settings: BootstrapSettings, avatars_dir: Path
) -> None:
    """Temporary players are persisted — the old app kept them in memory only."""
    async for first in _client(bootstrap_settings):
        player = await create(first, "Yannis")
        await first.put(
            f"/api/v1/players/{player['id']}/avatar", files=upload(PNG, "a.png", "image/png")
        )

    async for second in _client(bootstrap_settings):
        listed = await second.get("/api/v1/players")
        assert listed.status_code == 200
        assert listed.json()["players"] == [{**player, "has_avatar": True}]
        assert (await second.get(f"/api/v1/players/{player['id']}/avatar")).content == PNG


async def _client(settings: BootstrapSettings) -> AsyncIterator[AsyncClient]:
    """One app instance at a time — two live lifespans would fight over the scanner task."""
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        await authenticate_admin(app)
        async with admin_client(app) as client:
            yield client
