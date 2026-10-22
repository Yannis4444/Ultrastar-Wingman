from collections.abc import AsyncIterator
from pathlib import Path
from unittest import mock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from conftest import BASE_URL, add_session, add_user, admin_client, authenticate_admin
from ultrastar_wingman.app import create_app
from ultrastar_wingman.auth.deps import COOKIE_NAME
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.players.model import Player
from ultrastar_wingman.players.service import MAX_AVATAR_BYTES, MAX_AVATAR_PIXELS

# Smallest real images, so declared content type, magic bytes and header dimensions all
# genuinely agree — the upload reads the canvas size out of each of these headers.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)
# SOI, a JFIF header, a 1x1 baseline frame header (SOF0), EOI.
JPEG = bytes.fromhex(
    "ffd8"  # SOI
    "ffe000104a46494600010100000100010000"  # APP0, the JFIF header
    "ffc0000b080001000101011100"  # SOF0: 1x1, one component
    "ffd9"  # EOI
)


def webp(chunk: bytes, payload: bytes) -> bytes:
    return (
        b"RIFF"
        + (4 + 8 + len(payload)).to_bytes(4, "little")
        + b"WEBP"
        + chunk
        + len(payload).to_bytes(4, "little")
        + payload
    )


# Lossy: the keyframe tag, the start code and 1x1 in 14 bits each.
WEBP = webp(b"VP8 ", b"\x50\x00\x00\x9d\x01\x2a" + (1).to_bytes(2, "little") * 2)
# Lossless: the signature byte, then width-1 and height-1 in 14 bits each.
WEBP_LOSSLESS = webp(b"VP8L", b"\x2f\x00\x00\x00\x00")


def vp8x(width: int, height: int) -> bytes:
    """An extended webp, whose canvas size is a header field of its own."""
    canvas = (width - 1).to_bytes(3, "little") + (height - 1).to_bytes(3, "little")
    return webp(b"VP8X", b"\x00\x00\x00\x00" + canvas)


def upload(data: bytes, filename: str, content_type: str) -> dict[str, tuple[str, bytes, str]]:
    return {"file": (filename, data, content_type)}


def avatar_files(avatars_dir: Path) -> list[str]:
    """Sync on purpose: ruff's ASYNC rules ban pathlib calls inside async functions."""
    return sorted(path.name for path in avatars_dir.iterdir()) if avatars_dir.is_dir() else []


def touch_and_read_version(avatar: Path) -> int:
    """Move the file's modification time on and report the version the API should now
    serve. Sync for the same reason as `avatar_files`."""
    avatar.touch()
    return avatar.stat().st_mtime_ns // 1_000_000


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
    assert (await client.patch("/api/v1/players/nope", json={"hidden": True})).status_code == 404
    assert (
        await client.put("/api/v1/players/nope/avatar", files=upload(PNG, "a.png", "image/png"))
    ).status_code == 404


async def test_a_player_can_be_hidden_and_shown_again(client: AsyncClient) -> None:
    """Hiding is a flag on the row, not a deletion: the player stays in every listing and
    the singer picker is the one surface that drops them."""
    player = await create(client, "Yannis")
    assert player["hidden"] is False

    hidden = await client.patch(f"/api/v1/players/{player['id']}", json={"hidden": True})

    assert hidden.status_code == 200
    assert hidden.json() == {**player, "hidden": True}
    assert (await client.get("/api/v1/players")).json() == {"players": [{**player, "hidden": True}]}

    shown = await client.patch(f"/api/v1/players/{player['id']}", json={"hidden": False})

    assert shown.json()["hidden"] is False
    assert (await client.get("/api/v1/players")).json() == {"players": [player]}


async def test_hiding_a_player_survives_a_restart(
    bootstrap_settings: BootstrapSettings,
) -> None:
    """The flag is a column, so an evening's hiding outlives the app that wrote it."""
    async for first in _client(bootstrap_settings):
        player = await create(first, "Yannis")
        await first.patch(f"/api/v1/players/{player['id']}", json={"hidden": True})

    async for second in _client(bootstrap_settings):
        assert (await second.get("/api/v1/players")).json()["players"][0]["hidden"] is True


@pytest.mark.parametrize(
    ("data", "filename", "content_type", "extension"),
    [
        (PNG, "avatar.png", "image/png", ".png"),
        (JPEG, "avatar.jpg", "image/jpeg", ".jpg"),
        (WEBP, "avatar.webp", "image/webp", ".webp"),
        (WEBP_LOSSLESS, "avatar.webp", "image/webp", ".webp"),
        (vp8x(1, 1), "avatar.webp", "image/webp", ".webp"),
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


async def test_an_empty_file_is_rejected(client: AsyncClient, avatars_dir: Path) -> None:
    """Nothing is stored that a screen would then fail to draw."""
    player = await create(client, "Yannis")

    rejected = await client.put(
        f"/api/v1/players/{player['id']}/avatar", files=upload(b"", "avatar.png", "image/png")
    )

    assert rejected.status_code == 415
    assert avatar_files(avatars_dir) == []


async def test_an_oversized_avatar_is_rejected(client: AsyncClient, avatars_dir: Path) -> None:
    player = await create(client, "Yannis")
    too_big = PNG + b"\x00" * (MAX_AVATAR_BYTES - len(PNG) + 1)

    rejected = await client.put(
        f"/api/v1/players/{player['id']}/avatar", files=upload(too_big, "big.png", "image/png")
    )

    assert rejected.status_code == 413
    assert rejected.json() == {"detail": "avatar_too_large"}
    assert avatar_files(avatars_dir) == []


@pytest.mark.parametrize(
    ("data", "filename", "content_type"),
    [
        # A few hundred bytes of png that declare a 30000x30000 canvas: 900 megapixels,
        # 3.6 GB of memory in whatever decodes it.
        (
            b"\x89PNG\r\n\x1a\n"
            + (13).to_bytes(4, "big")
            + b"IHDR"
            + (30000).to_bytes(4, "big")
            + (30000).to_bytes(4, "big")
            + b"\x08\x06\x00\x00\x00",
            "bomb.png",
            "image/png",
        ),
        (
            bytes.fromhex("ffd8ffc0000b084e204e2001011100ffd9"),  # SOF0 saying 20000x20000
            "bomb.jpg",
            "image/jpeg",
        ),
        (vp8x(16383, 16383), "bomb.webp", "image/webp"),
    ],
)
async def test_an_image_with_an_absurd_canvas_is_rejected(
    client: AsyncClient,
    avatars_dir: Path,
    data: bytes,
    filename: str,
    content_type: str,
) -> None:
    """Small files, enormous pictures: the byte limit lets these through, so the header's
    own canvas size has to be checked before the file is stored and handed to USDX."""
    player = await create(client, "Yannis")

    rejected = await client.put(
        f"/api/v1/players/{player['id']}/avatar", files=upload(data, filename, content_type)
    )

    assert rejected.status_code == 413
    assert rejected.json() == {"detail": "avatar_too_many_pixels"}
    assert avatar_files(avatars_dir) == []


async def test_an_image_whose_header_has_no_size_is_rejected(
    client: AsyncClient, avatars_dir: Path
) -> None:
    """Magic bytes are four characters anyone can prepend; without a readable header this
    is not a picture, whatever the content type says."""
    player = await create(client, "Yannis")

    rejected = await client.put(
        f"/api/v1/players/{player['id']}/avatar",
        files=upload(b"\x89PNG\r\n\x1a\nand then some junk", "fake.png", "image/png"),
    )

    assert rejected.status_code == 415
    assert rejected.json() == {"detail": "unsupported_avatar_type"}
    assert avatar_files(avatars_dir) == []


async def test_a_picture_right_at_the_pixel_limit_is_accepted(client: AsyncClient) -> None:
    side = int(MAX_AVATAR_PIXELS**0.5)
    player = await create(client, "Yannis")

    accepted = await client.put(
        f"/api/v1/players/{player['id']}/avatar",
        files=upload(vp8x(side, side), "large.webp", "image/webp"),
    )

    assert accepted.status_code == 200


async def test_the_avatar_version_moves_only_when_the_picture_does(
    client: AsyncClient, avatars_dir: Path
) -> None:
    """The URL and `has_avatar` are the same before and after a replacement, so this is the
    only field a client can hang a cache buster on."""
    player = await create(client, "Yannis")
    assert player["avatar_version"] is None
    url = f"/api/v1/players/{player['id']}/avatar"

    first = (await client.put(url, files=upload(PNG, "a.png", "image/png"))).json()
    assert isinstance(first["avatar_version"], int)
    # Listing the player again reports the same version: nothing but an upload moves it.
    assert (await client.get("/api/v1/players")).json()["players"] == [first]

    # A touch of the stored file stands in for a second upload a moment later.
    touched = touch_and_read_version(avatars_dir / f"{player['id']}.png")
    second = (await client.get("/api/v1/players")).json()["players"][0]

    assert second["avatar_version"] == touched


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


def players_changed(events: list[dict[str, object]]) -> int:
    return sum(1 for event in events if event["event"] == "players.changed")


async def test_every_change_to_the_players_list_is_announced(
    client: AsyncClient, broadcast_events: list[dict[str, object]]
) -> None:
    """The host screen draws the standing's avatars from `GET /players` and stays open all
    evening, so every write that changes that answer has to tell it — a picture uploaded
    after the TV was turned on stayed an initial there until a reload."""
    player = await create(client, "Yannis")
    assert broadcast_events == [{"event": "players.changed"}]

    await client.put(
        f"/api/v1/players/{player['id']}/avatar", files=upload(PNG, "a.png", "image/png")
    )
    assert players_changed(broadcast_events) == 2

    await client.patch(f"/api/v1/players/{player['id']}", json={"hidden": True})
    assert players_changed(broadcast_events) == 3

    await client.delete(f"/api/v1/players/{player['id']}")
    assert players_changed(broadcast_events) == 4


async def test_a_refused_change_announces_nothing(
    client: AsyncClient, broadcast_events: list[dict[str, object]]
) -> None:
    player = await create(client, "Yannis")
    broadcast_events.clear()

    assert (await client.post("/api/v1/players", json={"name": "yannis"})).status_code == 409
    refused = await client.put(
        f"/api/v1/players/{player['id']}/avatar", files=upload(b"hello", "a.png", "image/png")
    )
    assert refused.status_code == 415

    assert players_changed(broadcast_events) == 0


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
        restored = listed.json()["players"][0]
        # The version follows the file, so it survives the restart with it.
        assert restored == {**player, "has_avatar": True, "avatar_version": mock.ANY}
        assert isinstance(restored["avatar_version"], int)
        assert (await second.get(f"/api/v1/players/{player['id']}/avatar")).content == PNG


@pytest.fixture
async def party(
    bootstrap_settings: BootstrapSettings,
) -> AsyncIterator[tuple[FastAPI, AsyncClient]]:
    """One app plus its administrator, so a second client can be pointed at the very same
    instance — the identity tests need two callers on one database."""
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        await authenticate_admin(app)
        async with admin_client(app) as admin:
            yield app, admin


async def singer(app: FastAPI, player_id: str, username: str) -> AsyncClient:
    """A logged-in `user` account that sings as `player_id`. A plain `user` holds neither
    `players.manage` nor `players.avatar`, which is the whole point of these tests."""
    factory: async_sessionmaker[AsyncSession] = app.state.session_factory
    user_id = await add_user(factory, username, "user")
    async with factory() as session:
        player = await session.get(Player, player_id)
        assert player is not None
        player.user_id = user_id
        player.registered = True
        await session.commit()
    await add_session(factory, f"{username}-token", user_id)
    return AsyncClient(
        transport=ASGITransport(app=app),
        base_url=BASE_URL,
        cookies={COOKIE_NAME: f"{username}-token"},
    )


async def test_your_own_picture_needs_no_capability(party: tuple[FastAPI, AsyncClient]) -> None:
    """Identity, not a capability — the same rule favorites follow."""
    app, admin = party
    player = await create(admin, "Yannis")
    yannis = await singer(app, str(player["id"]), "yannis")

    async with yannis:
        uploaded = await yannis.put(
            f"/api/v1/players/{player['id']}/avatar", files=upload(PNG, "a.png", "image/png")
        )

    assert uploaded.status_code == 200
    assert uploaded.json()["has_avatar"] is True


async def test_somebody_else_s_picture_needs_players_avatar(
    party: tuple[FastAPI, AsyncClient],
) -> None:
    app, admin = party
    player = await create(admin, "Yannis")
    other = await create(admin, "Mona")
    yannis = await singer(app, str(player["id"]), "yannis")

    async with yannis:
        refused = await yannis.put(
            f"/api/v1/players/{other['id']}/avatar", files=upload(PNG, "a.png", "image/png")
        )

    assert refused.status_code == 403
    assert refused.json() == {"detail": "missing_permission:players.avatar"}


async def test_an_account_without_a_player_may_change_nobody_s_picture(
    party: tuple[FastAPI, AsyncClient],
) -> None:
    """ "Which player is mine" answers None for such an account, and None must never match
    a player — least of all one whose own `user_id` is null too."""
    app, admin = party
    player = await create(admin, "Yannis")
    factory: async_sessionmaker[AsyncSession] = app.state.session_factory
    user_id = await add_user(factory, "nobody", "user")
    await add_session(factory, "nobody-token", user_id)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url=BASE_URL, cookies={COOKIE_NAME: "nobody-token"}
    ) as stranger:
        refused = await stranger.put(
            f"/api/v1/players/{player['id']}/avatar", files=upload(PNG, "a.png", "image/png")
        )

    assert refused.status_code == 403


async def _client(settings: BootstrapSettings) -> AsyncIterator[AsyncClient]:
    """One app instance at a time — two live lifespans would fight over the scanner task."""
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        await authenticate_admin(app)
        async with admin_client(app) as client:
            yield client
