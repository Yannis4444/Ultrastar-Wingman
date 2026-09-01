"""The achievement endpoints: the catalogue, its icons, its three options — and `hidden`.

Reading takes no capability at all, which is the point: the host screen and every guest
phone draw badges. Writing takes `achievements.manage`, and the matrix in
`test_permissions.py` is what proves the five write routes really demand it.

The half worth the most attention here is the masking. `hidden` is enforced by the API and
never by the UI, so it is checked from all three sides — the manager who has to be able to
edit the thing, the player who has earned it, and the stranger who must learn nothing about
it but that a locked slot is there.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from conftest import BASE_URL, add_session, add_user
from ultrastar_wingman.achievements import service
from ultrastar_wingman.achievements.builtin import BUILT_INS
from ultrastar_wingman.achievements.model import Achievement, PlayerAchievement
from ultrastar_wingman.achievements.schema import Condition
from ultrastar_wingman.app import create_app
from ultrastar_wingman.auth.deps import COOKIE_NAME
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.images import MAX_IMAGE_BYTES
from ultrastar_wingman.karaoke.model import Score, Sing
from ultrastar_wingman.players.model import Player
from ultrastar_wingman.songs import scanner

# Smallest real images, so declared content type, magic bytes and header dimensions all
# genuinely agree — the same three the avatar upload checks, out of the same module.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
)
JPEG = bytes.fromhex("ffd8ffe000104a46494600010100000100010000ffc0000b080001000101011100ffd9")

# A plain account and a helper: neither holds `achievements.manage`, which nobody but an
# administrator does by default.
ACCOUNTS = {"user": "user", "trusted": "trusted", "admin": "admin"}

SECRET = {
    "name": "Brave Soul",
    "description": "Finish a song with 2,000 points or fewer.",
    "icon": "ghost",
    "color": "neutral",
    "hidden": True,
    "definition": [{"metric": "any_score", "comparator": "<=", "value": 2000}],
}


@dataclass
class Party:
    """One app, one client per identity — never two lifespans, they fight over the scanner."""

    app: FastAPI
    clients: dict[str, AsyncClient]
    ids: dict[str, str]
    icons: Path

    def __getitem__(self, identity: str) -> AsyncClient:
        return self.clients[identity]

    @property
    def factory(self) -> async_sessionmaker[AsyncSession]:
        session_factory: async_sessionmaker[AsyncSession] = self.app.state.session_factory
        return session_factory


def _client(app: FastAPI, token: str | None = None) -> AsyncClient:
    cookies = {} if token is None else {COOKIE_NAME: token}
    return AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL, cookies=cookies)


@pytest.fixture
async def party(bootstrap_settings: BootstrapSettings) -> AsyncIterator[Party]:
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        # The startup scan reconciles the library against a disk these tests never wrote to.
        await scanner.stop_scan()
        clients = {"anonymous": _client(app)}
        ids: dict[str, str] = {}
        session_factory: async_sessionmaker[AsyncSession] = app.state.session_factory
        for name, role in ACCOUNTS.items():
            ids[name] = await add_user(session_factory, f"{name}-account", role)
            await add_session(session_factory, f"{name}-token", ids[name])
            clients[name] = _client(app, f"{name}-token")
        try:
            yield Party(
                app=app,
                clients=clients,
                ids=ids,
                icons=bootstrap_settings.data_dir / "achievement_icons",
            )
        finally:
            # Let the background passes a write started finish rather than cancelling them
            # mid-query: a cancelled session hands its connection back after the loop is gone.
            await service.wait_for_passes()
            for client in clients.values():
                await client.aclose()


async def catalogue(client: AsyncClient) -> list[dict[str, Any]]:
    response = await client.get("/api/v1/achievements")
    assert response.status_code == 200, response.text
    rows: list[dict[str, Any]] = response.json()["achievements"]
    return rows


async def create(client: AsyncClient, **fields: Any) -> dict[str, Any]:
    body = {"name": "Test", "color": "gold", "definition": [], **fields}
    response = await client.post("/api/v1/achievements", json=body)
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


async def add_player(party: Party, identity: str | None, name: str) -> str:
    """A player, linked to an account when `identity` names one — that link is what "the
    caller's own player" means, exactly as in `stats.api`."""
    async with party.factory() as session:
        player = Player(
            name=name,
            registered=identity is not None,
            user_id=None if identity is None else party.ids[identity],
        )
        session.add(player)
        await session.commit()
        return player.id


async def award(party: Party, achievement_id: str, player_id: str) -> None:
    """Hand a player the badge directly. What a pass would have decided is
    `test_achievements_triggers`; this is about what the API then shows of it."""
    async with party.factory() as session:
        session.add(
            PlayerAchievement(
                achievement_id=achievement_id,
                player_id=player_id,
                earned_at=datetime(2026, 9, 1, 20, 0, tzinfo=UTC),
            )
        )
        await session.commit()


def upload(data: bytes, filename: str, content_type: str) -> dict[str, tuple[str, bytes, str]]:
    return {"file": (filename, data, content_type)}


def icon_files(icons_dir: Path) -> list[str]:
    """Sync on purpose: ruff's ASYNC rules ban pathlib calls inside async functions."""
    return sorted(path.name for path in icons_dir.iterdir()) if icons_dir.is_dir() else []


async def test_the_seventeen_built_ins_are_seeded_in_order(party: Party) -> None:
    rows = await catalogue(party["anonymous"])

    assert [row["id"] for row in rows] == [built_in.id for built_in in BUILT_INS]
    assert all(row["built_in"] and row["enabled"] for row in rows)
    assert [row["sort_order"] for row in rows] == list(range(len(BUILT_INS)))


async def test_every_built_in_definition_is_one_the_engine_can_read(party: Party) -> None:
    """The seed is hand-written JSON, so the models are what stand between a typo in it and
    seventeen badges nobody can earn."""
    for row in await catalogue(party["admin"]):
        assert row["definition"], row["id"]
        for condition in row["definition"]:
            Condition.model_validate(condition)


async def test_the_catalogue_carries_the_three_settings_at_their_defaults(party: Party) -> None:
    response = await party["anonymous"].get("/api/v1/achievements")

    assert response.json()["settings"] == {
        "enabled": True,
        "host_seconds_base": 4,
        "host_seconds_per_badge": 2,
    }


async def test_create_edit_and_delete_one(party: Party) -> None:
    created = await create(
        party["admin"],
        name="Encore",
        description="Sing twice in a row.",
        icon="music",
        definition=[{"metric": "number_of_sings", "comparator": ">=", "value": 2}],
    )
    assert created["name"] == "Encore"
    assert created["built_in"] is False
    # At the end of the list, behind the seventeen it was added to.
    assert created["sort_order"] == len(BUILT_INS)
    (condition,) = created["definition"]
    # `scope` was not sent: the models default it in, and what is stored is what they read.
    assert condition["scope"] == "global"
    assert (condition["metric"], condition["comparator"], condition["value"]) == (
        "number_of_sings",
        ">=",
        2,
    )

    edited = await party["admin"].patch(
        f"/api/v1/achievements/{created['id']}", json={"name": "Double Act", "enabled": False}
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["name"] == "Double Act"
    assert edited.json()["enabled"] is False
    # Everything the PATCH did not name is untouched.
    assert edited.json()["icon"] == "music"

    deleted = await party["admin"].delete(f"/api/v1/achievements/{created['id']}")
    assert deleted.status_code == 204
    assert [row["id"] for row in await catalogue(party["admin"])] == [one.id for one in BUILT_INS]


async def test_an_explicit_null_icon_clears_it_and_leaving_it_out_keeps_it(party: Party) -> None:
    created = await create(party["admin"], icon="music")

    kept = await party["admin"].patch(
        f"/api/v1/achievements/{created['id']}", json={"name": "Renamed"}
    )
    assert kept.json()["icon"] == "music"

    cleared = await party["admin"].patch(
        f"/api/v1/achievements/{created['id']}", json={"icon": None}
    )
    assert cleared.json()["icon"] is None


async def test_deleting_a_built_in_is_a_conflict(party: Party) -> None:
    """It may be switched off like any other. It may not be taken away: import and export
    recognise the shipped set by its slug ids."""
    refused = await party["admin"].delete("/api/v1/achievements/builtin-score-9000")

    assert refused.status_code == 409
    assert refused.json() == {"detail": "built_in_achievement"}
    assert len(await catalogue(party["admin"])) == len(BUILT_INS)

    switched_off = await party["admin"].patch(
        "/api/v1/achievements/builtin-score-9000", json={"enabled": False}
    )
    assert switched_off.status_code == 200
    assert switched_off.json()["enabled"] is False


async def test_an_unknown_achievement_is_404(party: Party) -> None:
    client = party["admin"]
    assert (await client.patch("/api/v1/achievements/nope", json={"name": "x"})).status_code == 404
    assert (await client.delete("/api/v1/achievements/nope")).status_code == 404
    assert (await client.get("/api/v1/achievements/nope/icon")).status_code == 404
    assert (await client.delete("/api/v1/achievements/nope/icon")).status_code == 404
    assert (
        await client.put("/api/v1/achievements/nope/icon", files=upload(PNG, "a.png", "image/png"))
    ).status_code == 404


@pytest.mark.parametrize(
    "definition",
    [
        pytest.param([{"metric": "nonsense", "comparator": ">=", "value": 1}], id="unknown metric"),
        pytest.param([{"metric": "any_score", "comparator": "~", "value": 1}], id="bad comparator"),
        pytest.param(
            [
                {
                    "metric": "any_score",
                    "comparator": ">=",
                    "value": 1,
                    "songs": {"ids": ["usdb:1"]},
                    "match": {"combine": "all", "clauses": []},
                }
            ],
            id="both ways of choosing songs",
        ),
        pytest.param(
            [
                {
                    "metric": "any_score",
                    "comparator": ">=",
                    "value": 1,
                    "match": {
                        "combine": "all",
                        "clauses": [{"field": "year", "op": "contains", "value": "80"}],
                    },
                }
            ],
            id="an operator the field cannot answer",
        ),
    ],
)
async def test_a_definition_the_models_refuse_is_422(
    party: Party, definition: list[dict[str, Any]]
) -> None:
    """Refused on the way in, never stored: a row nobody can ever earn is indistinguishable
    from one nobody has earned yet."""
    response = await party["admin"].post(
        "/api/v1/achievements", json={"name": "Broken", "color": "gold", "definition": definition}
    )

    assert response.status_code == 422, response.text
    assert len(await catalogue(party["admin"])) == len(BUILT_INS)


async def test_a_score_filter_whose_min_is_above_its_max_is_422(party: Party) -> None:
    """No score survives that range, so the condition could never be satisfied by anybody —
    and a transposed pair is the one mistake this shape invites."""
    body = {
        "name": "Impossible",
        "color": "gold",
        "definition": [
            {
                "metric": "number_of_scores",
                "comparator": ">=",
                "value": 1,
                "score_filter": {"min": 9000, "max": 1000},
            }
        ],
    }

    assert (await party["admin"].post("/api/v1/achievements", json=body)).status_code == 422
    # The same range the other way round is an ordinary window and is accepted.
    body["definition"][0]["score_filter"] = {"min": 1000, "max": 9000}  # type: ignore[index]
    assert (await party["admin"].post("/api/v1/achievements", json=body)).status_code == 201


@pytest.mark.parametrize(
    ("data", "filename", "content_type", "extension"),
    [
        (PNG, "icon.png", "image/png", ".png"),
        (JPEG, "icon.jpg", "image/jpeg", ".jpg"),
    ],
)
async def test_an_icon_is_uploaded_served_and_removed_again(
    party: Party, data: bytes, filename: str, content_type: str, extension: str
) -> None:
    created = await create(party["admin"], icon="music")

    uploaded = await party["admin"].put(
        f"/api/v1/achievements/{created['id']}/icon", files=upload(data, filename, content_type)
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["has_image"] is True
    assert icon_files(party.icons) == [f"{created['id']}{extension}"]

    # Open to a guest phone, like the catalogue: a badge on the TV is an image the TV fetches.
    served = await party["anonymous"].get(f"/api/v1/achievements/{created['id']}/icon")
    assert served.status_code == 200
    assert served.content == data
    assert served.headers["content-type"] == content_type

    removed = await party["admin"].delete(f"/api/v1/achievements/{created['id']}/icon")
    assert removed.status_code == 200
    assert removed.json()["has_image"] is False
    assert icon_files(party.icons) == []
    assert (
        await party["anonymous"].get(f"/api/v1/achievements/{created['id']}/icon")
    ).status_code == 404


async def test_a_hidden_achievements_picture_is_kept_back_until_somebody_earns_it(
    party: Party,
) -> None:
    """The masked row still carries the id, so "you would have to know the id" protects
    nothing — and a picture would give the surprise away as loudly as the name would.

    Revealed once *anybody* has earned it, not once the reader has: earning one announces it
    to every socket, and a phone drawing somebody else's badges has to draw this one too.
    """
    created = await create(party["admin"], **SECRET)
    await party["admin"].put(
        f"/api/v1/achievements/{created['id']}/icon", files=upload(PNG, "a.png", "image/png")
    )

    kept_back = await party["anonymous"].get(f"/api/v1/achievements/{created['id']}/icon")
    # The same answer as an achievement with no picture at all: a stranger cannot tell the
    # two apart.
    assert kept_back.status_code == 404
    assert kept_back.json() == {"detail": f"achievement '{created['id']}' has no icon"}
    # Somebody has to be able to see what they uploaded.
    assert (
        await party["admin"].get(f"/api/v1/achievements/{created['id']}/icon")
    ).status_code == 200

    await award(party, created["id"], await add_player(party, None, "Guest"))

    assert (
        await party["anonymous"].get(f"/api/v1/achievements/{created['id']}/icon")
    ).status_code == 200


async def test_replacing_an_icon_leaves_exactly_one_file(party: Party) -> None:
    created = await create(party["admin"])
    await party["admin"].put(
        f"/api/v1/achievements/{created['id']}/icon", files=upload(PNG, "a.png", "image/png")
    )

    await party["admin"].put(
        f"/api/v1/achievements/{created['id']}/icon", files=upload(JPEG, "a.jpg", "image/jpeg")
    )

    assert icon_files(party.icons) == [f"{created['id']}.jpg"]


@pytest.mark.parametrize(
    ("data", "filename", "content_type", "status"),
    [
        pytest.param(b"just text", "note.txt", "text/plain", 415, id="not an image at all"),
        pytest.param(b"just text", "note.png", "image/png", 415, id="a lie about the bytes"),
        pytest.param(PNG, "icon.png", "image/jpeg", 415, id="a lie about the type"),
    ],
)
async def test_an_upload_that_is_not_a_picture_is_refused(
    party: Party, data: bytes, filename: str, content_type: str, status: int
) -> None:
    created = await create(party["admin"])

    response = await party["admin"].put(
        f"/api/v1/achievements/{created['id']}/icon", files=upload(data, filename, content_type)
    )

    assert response.status_code == status, response.text
    assert icon_files(party.icons) == []


async def test_an_icon_with_an_absurd_canvas_is_refused(party: Party) -> None:
    """A few hundred bytes of png declaring a 30000x30000 canvas: 900 megapixels, gigabytes
    of memory in whatever draws the badge. The byte cap lets it through, so the icon route
    has to read the header's own size — the same check an avatar gets, out of `images.py`.
    """
    created = await create(party["admin"])
    bomb = (
        b"\x89PNG\r\n\x1a\n"
        + (13).to_bytes(4, "big")
        + b"IHDR"
        + (30000).to_bytes(4, "big")
        + (30000).to_bytes(4, "big")
        + b"\x08\x06\x00\x00\x00"
    )

    response = await party["admin"].put(
        f"/api/v1/achievements/{created['id']}/icon", files=upload(bomb, "bomb.png", "image/png")
    )

    assert response.status_code == 413
    assert response.json() == {"detail": "icon_too_many_pixels"}
    assert icon_files(party.icons) == []


async def test_an_icon_whose_header_has_no_size_is_refused(party: Party) -> None:
    """Magic bytes are eight characters anyone can prepend. Without a readable header this is
    not a picture, whatever the content type says — and an unbounded one is what the pixel cap
    exists to refuse."""
    created = await create(party["admin"])

    response = await party["admin"].put(
        f"/api/v1/achievements/{created['id']}/icon",
        files=upload(b"\x89PNG\r\n\x1a\nand then some junk", "fake.png", "image/png"),
    )

    assert response.status_code == 415
    assert response.json() == {"detail": "unsupported_icon_type"}
    assert icon_files(party.icons) == []


async def test_an_oversized_upload_is_refused(party: Party) -> None:
    created = await create(party["admin"])
    too_big = PNG + b"\x00" * (MAX_IMAGE_BYTES - len(PNG) + 1)

    response = await party["admin"].put(
        f"/api/v1/achievements/{created['id']}/icon", files=upload(too_big, "a.png", "image/png")
    )

    assert response.status_code == 413
    assert response.json() == {"detail": "icon_too_large"}


async def test_deleting_an_achievement_takes_its_picture_with_it(party: Party) -> None:
    created = await create(party["admin"])
    await party["admin"].put(
        f"/api/v1/achievements/{created['id']}/icon", files=upload(PNG, "a.png", "image/png")
    )

    await party["admin"].delete(f"/api/v1/achievements/{created['id']}")

    assert icon_files(party.icons) == []


async def test_the_settings_round_trip(party: Party) -> None:
    response = await party["admin"].patch(
        "/api/v1/achievements/settings", json={"host_seconds_base": 7, "host_seconds_per_badge": 0}
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "enabled": True,
        "host_seconds_base": 7,
        "host_seconds_per_badge": 0,
    }
    # Stored, and handed to every reader of the catalogue.
    listed = await party["anonymous"].get("/api/v1/achievements")
    assert listed.json()["settings"]["host_seconds_base"] == 7


@pytest.mark.parametrize("seconds", [-1, 61])
async def test_a_second_count_outside_the_range_is_refused(party: Party, seconds: int) -> None:
    """A typo that parks the host screen for an hour is worse than a refusal — there is no
    way out of it from a phone while it lasts."""
    response = await party["admin"].patch(
        "/api/v1/achievements/settings", json={"host_seconds_base": seconds}
    )

    assert response.status_code == 422, response.text
    listed = await party["anonymous"].get("/api/v1/achievements")
    assert listed.json()["settings"]["host_seconds_base"] == 4


async def test_the_settings_route_is_not_read_as_an_achievement_id(party: Party) -> None:
    """`PATCH /achievements/settings` is registered before `PATCH /achievements/{id}`, or
    "settings" would be an id nothing answers to."""
    response = await party["admin"].patch("/api/v1/achievements/settings", json={"enabled": False})

    assert response.status_code == 200
    assert response.json()["enabled"] is False


async def test_a_hidden_achievement_is_blank_for_a_stranger(party: Party) -> None:
    created = await create(party["admin"], **SECRET)

    (row,) = [one for one in await catalogue(party["anonymous"]) if one["id"] == created["id"]]

    assert row["hidden"] is True
    assert row["name"] == ""
    assert row["description"] == ""
    assert row["icon"] is None
    assert row["has_image"] is False
    # What is left is the shape of a badge, which is what a locked slot is drawn from.
    assert row["color"] == "neutral"
    assert row["definition"] is None


async def test_a_hidden_achievement_is_whole_for_the_player_who_earned_it(party: Party) -> None:
    """Earning one is what reveals it — and it is the caller's *own player* that decides,
    resolved the way `stats.api` resolves one."""
    created = await create(party["admin"], **SECRET)
    player_id = await add_player(party, "user", "Yannis")
    await award(party, created["id"], player_id)

    (row,) = [one for one in await catalogue(party["user"]) if one["id"] == created["id"]]

    assert row["name"] == "Brave Soul"
    assert row["icon"] == "ghost"
    # Revealed, not managed: what it asks for is still the manager's business.
    assert row["definition"] is None

    # The account next to them earned nothing and still sees nothing.
    (theirs,) = [one for one in await catalogue(party["trusted"]) if one["id"] == created["id"]]
    assert theirs["name"] == ""


async def test_a_manager_sees_every_hidden_achievement_and_its_definition(party: Party) -> None:
    """Somebody has to be able to write the thing."""
    created = await create(party["admin"], **SECRET)

    (row,) = [one for one in await catalogue(party["admin"]) if one["id"] == created["id"]]

    assert row["name"] == "Brave Soul"
    (condition,) = row["definition"]
    assert (condition["metric"], condition["comparator"], condition["value"]) == (
        "any_score",
        "<=",
        2000,
    )


async def test_a_players_badges_are_masked_over_that_player_not_the_reader(party: Party) -> None:
    """It is that player's record: a hidden one *they* have not earned is blank whoever is
    looking, and its progress numbers go with it — a bar that filled would say what the badge
    is for as loudly as its name would."""
    secret = await create(party["admin"], **SECRET)
    open_one = await create(
        party["admin"],
        name="Regular",
        definition=[{"metric": "number_of_sings", "comparator": ">=", "value": 10}],
    )
    player_id = await add_player(party, "user", "Yannis")
    async with party.factory() as session:
        session.add(
            PlayerAchievement(
                achievement_id=secret["id"],
                player_id=player_id,
                progress_current=1,
                progress_target=1,
            )
        )
        session.add(
            PlayerAchievement(
                achievement_id=open_one["id"],
                player_id=player_id,
                progress_current=3,
                progress_target=10,
            )
        )
        await session.commit()

    response = await party["user"].get(f"/api/v1/players/{player_id}/achievements")

    assert response.status_code == 200, response.text
    rows = {row["achievement_id"]: row for row in response.json()["achievements"]}
    assert rows[secret["id"]]["achievement"]["name"] == ""
    assert rows[secret["id"]]["progress_current"] is None
    assert rows[secret["id"]]["progress_target"] is None
    # An achievement that is not hidden keeps its bar.
    assert rows[open_one["id"]]["progress_current"] == 3
    assert rows[open_one["id"]]["progress_target"] == 10


async def test_a_players_badges_are_whole_once_they_are_earned(party: Party) -> None:
    created = await create(party["admin"], **SECRET)
    player_id = await add_player(party, None, "Guest")
    await award(party, created["id"], player_id)

    response = await party["anonymous"].get(f"/api/v1/players/{player_id}/achievements")

    (row,) = response.json()["achievements"]
    assert row["achievement"]["name"] == "Brave Soul"
    assert row["earned_at"] is not None


async def test_a_player_who_never_sang_has_an_empty_record_and_an_unknown_one_is_404(
    party: Party,
) -> None:
    player_id = await add_player(party, None, "Guest")

    assert (await party["anonymous"].get(f"/api/v1/players/{player_id}/achievements")).json() == {
        "achievements": []
    }
    assert (await party["anonymous"].get("/api/v1/players/nope/achievements")).status_code == 404


async def test_a_row_whose_achievement_is_gone_is_left_out(party: Party) -> None:
    """The same way every other listing in the app skips an orphan."""
    player_id = await add_player(party, None, "Guest")
    await award(party, "an-achievement-that-was-deleted", player_id)

    response = await party["anonymous"].get(f"/api/v1/players/{player_id}/achievements")

    assert response.json() == {"achievements": []}


async def test_the_reading_routes_answer_a_guest_phone(party: Party) -> None:
    """No capability at all on any of them — the host screen and every phone draw badges."""
    player_id = await add_player(party, None, "Guest")

    assert (await party["anonymous"].get("/api/v1/achievements")).status_code == 200
    assert (
        await party["anonymous"].get(f"/api/v1/players/{player_id}/achievements")
    ).status_code == 200
    # No icon on this one, so a 404 — which is still not a 403.
    assert (
        await party["anonymous"].get("/api/v1/achievements/builtin-score-9000/icon")
    ).status_code == 404


def changed(events: list[dict[str, object]]) -> int:
    """How many `achievements.changed` went out. The catalogue is what a client refetches on
    it, so what matters is that one arrived at all, not what else was on the bus."""
    return sum(1 for event in events if event["event"] == "achievements.changed")


async def test_every_catalogue_write_tells_the_room_the_catalogue_changed(
    party: Party, broadcast_events: list[dict[str, object]]
) -> None:
    """A client holding the catalogue open would otherwise draw a badge that has been renamed,
    recoloured, switched off or deleted until it happened to ask again.

    No payload on the event: the masking is decided per caller, so a listener refetches
    `GET /achievements` and is masked for whoever it is.
    """
    created = await create(party["admin"], name="Encore")
    assert changed(broadcast_events) == 1
    assert broadcast_events[-1] == {"event": "achievements.changed"}

    for request in (
        party["admin"].patch(f"/api/v1/achievements/{created['id']}", json={"name": "Renamed"}),
        party["admin"].put(
            f"/api/v1/achievements/{created['id']}/icon", files=upload(PNG, "a.png", "image/png")
        ),
        party["admin"].delete(f"/api/v1/achievements/{created['id']}/icon"),
        party["admin"].patch("/api/v1/achievements/settings", json={"host_seconds_base": 7}),
        party["admin"].delete(f"/api/v1/achievements/{created['id']}"),
    ):
        before = changed(broadcast_events)
        response = await request
        assert response.status_code in (200, 204), response.text
        assert changed(broadcast_events) == before + 1, response.request.url


async def test_a_refused_write_changes_nothing_and_says_nothing(
    party: Party, broadcast_events: list[dict[str, object]]
) -> None:
    """The event means the catalogue moved. A 404, a 409 and a 422 all left it where it was."""
    await party["admin"].delete("/api/v1/achievements/builtin-score-9000")
    await party["admin"].patch("/api/v1/achievements/nope", json={"name": "x"})
    await party["admin"].post(
        "/api/v1/achievements",
        json={"name": "Broken", "color": "gold", "definition": [{"metric": "nonsense"}]},
    )
    # A PATCH that names no field is not a change either.
    await party["admin"].patch("/api/v1/achievements/settings", json={})

    assert changed(broadcast_events) == 0


async def test_a_created_achievement_is_recomputed_for_everybody_in_the_background(
    party: Party,
) -> None:
    """The editor does not sit through a query per player, but the pass really happens: an
    achievement that is true of what somebody already did is earned the moment it exists."""
    async with party.factory() as session:
        session.add(Achievement(id="ignored", name="x", color="gold", definition=[]))
        await session.commit()
    player_id = await add_player(party, None, "Guest")
    await _add_score(party, player_id, 9500)

    created = await create(
        party["admin"],
        name="Golden",
        definition=[{"metric": "any_score", "comparator": ">=", "value": 9000}],
    )
    await service.wait_for_passes()

    response = await party["anonymous"].get(f"/api/v1/players/{player_id}/achievements")
    earned = {row["achievement_id"] for row in response.json()["achievements"] if row["earned_at"]}
    assert created["id"] in earned


async def _add_score(party: Party, player_id: str, score: int) -> None:
    async with party.factory() as session:
        moment = datetime(2026, 9, 1, 20, 0, tzinfo=UTC)
        session.add(Sing(id="sing-1", song_id="usdb:1", session_id="party-a", started_at=moment))
        session.add(
            Score(
                sing_id="sing-1",
                player_id=player_id,
                player_name="Guest",
                score=score,
                recorded_at=moment,
            )
        )
        await session.commit()
