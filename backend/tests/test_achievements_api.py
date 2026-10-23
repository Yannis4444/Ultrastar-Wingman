"""The achievement endpoints: the catalogue, its icons, its three options — and `hidden`.

Reading takes no capability at all, which is the point: the host screen and every guest
phone draw badges. Writing takes `achievements.manage`, and the matrix in
`test_permissions.py` is what proves every one of the write routes really demands it.

The half worth the most attention here is the masking. `hidden` is enforced by the API and
never by the UI, so it is checked from all four sides — the management page, which has to be
able to edit the thing and says so with `manage=true`; the player who has earned it; the
stranger who must learn nothing about it but that a locked slot is there; and the
administrator who is merely *reading*, on their own user page or on the TV, and gets the
stranger's answer because holding the capability is not the same as using it.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from conftest import BASE_URL, add_session, add_user
from ultrastar_wingman.achievements import pictures, service
from ultrastar_wingman.achievements.builtin import BUILT_INS, BY_ID
from ultrastar_wingman.achievements.model import Achievement, PlayerAchievement
from ultrastar_wingman.achievements.schema import Condition
from ultrastar_wingman.app import create_app
from ultrastar_wingman.auth.deps import COOKIE_NAME
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.images import MAX_IMAGE_BYTES
from ultrastar_wingman.karaoke.model import SESSION_GAP, KaraokeSession, Score, Sing
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

# "Ten songs in one evening" — the shape of every condition whose bar counts the party being
# sung rather than the whole record.
SESSION_CONDITION = {
    "scope": "session",
    "metric": "number_of_sings",
    "comparator": ">=",
    "value": 10,
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


async def catalogue(client: AsyncClient, *, manage: bool = False) -> list[dict[str, Any]]:
    """`manage=True` is the management page's answer — every row whole and its definition —
    and takes `achievements.manage`. Everything else gets the masked one, whatever it holds."""
    query = {"manage": "true"} if manage else None
    response = await client.get("/api/v1/achievements", params=query)
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


async def stored_definition(party: Party, achievement_id: str) -> object:
    """The `definition` column as it stands. The API's own answer is the parsed models spelled
    out in full, so the column is what a claim about the stored JSON has to be made against —
    and it is the shape `builtin.py` declares and the seed migration writes."""
    async with party.factory() as session:
        row = await session.get(Achievement, achievement_id)
        assert row is not None
        return row.definition


def touch_and_read_version(icon: Path) -> int:
    """Move the file's modification time on and report the version the API should now serve.
    Sync for the same reason as `icon_files`."""
    icon.touch()
    return icon.stat().st_mtime_ns // 1_000_000


async def test_the_built_ins_are_seeded_in_order(party: Party) -> None:
    rows = await catalogue(party["anonymous"])

    assert [row["id"] for row in rows] == [built_in.id for built_in in BUILT_INS]
    assert all(row["built_in"] and row["enabled"] for row in rows)
    assert [row["sort_order"] for row in rows] == list(range(len(BUILT_INS)))


def test_the_hidden_built_ins_come_last_in_the_default_order() -> None:
    """Since 2026-09-04 every built-in that is hidden until earned stands at the end of
    `BUILT_INS`: the catalogue is read as a list of things to go for, and a locked row in the
    middle of it is a hole. The order of a database that has already been seeded is the
    host's, so this is a claim about the file — and, through the test above, about what a
    fresh instance starts with.
    """
    hidden = [index for index, built_in in enumerate(BUILT_INS) if built_in.hidden]
    visible = [index for index, built_in in enumerate(BUILT_INS) if not built_in.hidden]

    assert hidden and visible
    assert min(hidden) > max(visible)
    # Spelled out, because which ones are hidden is a decision and not an accident: this half
    # keeps the order the achievements arrived in.
    assert [BUILT_INS[index].id for index in hidden] == [
        "builtin-artists-10",
        "builtin-brave-soul",
        "builtin-time-traveler",
        "builtin-mixtape",
        "builtin-full-commitment",
        "builtin-groundhog-day",
    ]


def test_the_songs_in_one_party_ladder_is_five_ten_twenty() -> None:
    """*Five in a Night* → *Iron Lungs* → *All Night Long*, the third rung, seeded by 0031.

    One condition apart from its number, the colours climbing neutral → blue → gold like
    every other three-step ladder here, none of them hidden, and the three standing in that
    order in `BUILT_INS` — a rung filed anywhere but behind the one below it would read as a
    hole in the ladder on a fresh instance.
    """
    ladder = [BY_ID[f"builtin-evening-songs-{count}"] for count in (5, 10, 20)]

    assert [one.definition for one in ladder] == [
        [{"scope": "session", "metric": "number_of_sings", "comparator": ">=", "value": count}]
        for count in (5, 10, 20)
    ]
    assert [one.description for one in ladder] == [
        f"Sing {count} songs in one party." for count in (5, 10, 20)
    ]
    assert [one.color for one in ladder] == ["neutral", "blue", "gold"]
    assert not any(one.hidden for one in ladder)
    places = [BUILT_INS.index(one) for one in ladder]
    assert places == [places[0], places[0] + 1, places[0] + 2]


def test_the_tuned_built_ins_ask_for_what_their_descriptions_say() -> None:
    """What the 2026-09-04 tuning settled, pinned in the one place the two halves of a badge
    can disagree: the sentence and the number its condition compares against are written by
    hand, so one asking for 20,000 points while the other asks for 15,000 is a bug nothing
    outside this file could see. *Groundhog Day* is here for its flag alone.
    """
    assert BY_ID["builtin-artists-10"].description == "Sing songs by 20 different artists."
    assert BY_ID["builtin-artists-10"].definition[0]["value"] == 20
    assert (
        BY_ID["builtin-soundtrack"].description
        == "Collect 20,000 points from soundtrack songs in one party."
    )
    assert BY_ID["builtin-soundtrack"].definition[0]["value"] == 20000
    assert BY_ID["builtin-groundhog-day"].hidden
    # "Win", because *Beat another singer on a song (50 times)* read as a puzzle. What a win
    # is stays `number_of_wins`'s business.
    assert [BY_ID[f"builtin-wins-{count}"].description for count in (1, 10, 50)] == [
        "Win a song against another singer.",
        "Win 10 songs against other singers.",
        "Win 50 songs against other singers.",
    ]


async def test_every_built_in_definition_is_one_the_engine_can_read(party: Party) -> None:
    """The seed is hand-written JSON, so the models are what stand between a typo in it and
    a catalogue of badges nobody can earn."""
    for row in await catalogue(party["admin"], manage=True):
        assert row["definition"], row["id"]
        for condition in row["definition"]:
            Condition.model_validate(condition)


async def test_every_built_in_definition_is_written_the_way_the_models_write_it() -> None:
    """`builtin.py` is hand-written JSON, and three things have to agree on it: what the seed
    migration inserts (that file, raw), what a reset writes back (that file, raw) and what
    `dump_definition` makes of a definition sent to the API — which is what the refusal on
    `PATCH` compares against. A condition spelled with a field the models default would make
    those three drift apart silently."""
    for built_in in BUILT_INS:
        parsed = [Condition.model_validate(condition) for condition in built_in.definition]
        assert service.dump_definition(parsed) == built_in.definition, built_in.id


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
    # At the end of the list, behind the shipped set it was added to.
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


async def test_a_built_ins_conditions_cannot_be_changed(party: Party) -> None:
    """What one of the shipped built-ins asks for is `builtin.py`'s. 409 and not 422: the
    body is one the condition models parsed happily, and what refuses it is the row it was
    sent to — the same reasoning as the 409 on deleting one."""
    refused = await party["admin"].patch(
        "/api/v1/achievements/builtin-score-9000",
        json={
            "name": "Renamed",
            "definition": [{"metric": "any_score", "comparator": ">=", "value": 1}],
        },
    )

    assert refused.status_code == 409, refused.text
    # A slug and not a sentence, like every other 409 in the app: the client that has to
    # explain a refusal is the one that speaks the reader's language (`errors.ts`).
    assert refused.json() == {"detail": "built_in_definition"}
    # Nothing at all was written — not the conditions, and not the name beside them.
    assert (
        await stored_definition(party, "builtin-score-9000")
        == BY_ID["builtin-score-9000"].definition
    )
    rows = {row["id"]: row for row in await catalogue(party["admin"], manage=True)}
    assert rows["builtin-score-9000"]["name"] == "Golden Voice"


async def test_a_patch_repeating_a_built_ins_own_conditions_is_no_refusal(party: Party) -> None:
    """A client that sends the whole achievement back — the shipped definition included —
    changed nothing about the conditions, and is not refused for a field it never meant to
    touch."""
    response = await party["admin"].patch(
        "/api/v1/achievements/builtin-score-9000",
        json={
            "name": "Goldene Stimme",
            "definition": BY_ID["builtin-score-9000"].definition,
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Goldene Stimme"
    assert (
        await stored_definition(party, "builtin-score-9000")
        == BY_ID["builtin-score-9000"].definition
    )


async def test_the_catalogues_own_definition_patches_back_onto_every_built_in(
    party: Party,
) -> None:
    """The no-op above, but with the definition a real client actually holds.

    `builtin.py`'s raw JSON leaves every defaulted field out; the API answers with the parsed
    models spelled out in full, nulls included. Both have to dump to the stored column, or a
    client that reads the catalogue and PATCHes a renamed row straight back gets a 409 for a
    field it never touched — on some subset of the shipped set, silently.
    """
    rows = {row["id"]: row for row in await catalogue(party["admin"], manage=True)}
    for built_in in BUILT_INS:
        response = await party["admin"].patch(
            f"/api/v1/achievements/{built_in.id}",
            json={"name": rows[built_in.id]["name"], "definition": rows[built_in.id]["definition"]},
        )
        assert response.status_code == 200, (built_in.id, response.text)
        assert await stored_definition(party, built_in.id) == built_in.definition, built_in.id


async def test_resetting_a_built_in_puts_back_everything_but_whether_it_is_on(
    party: Party,
) -> None:
    """The improvement asked for "reset title etc.": every field `builtin.py` declares comes
    back out of that file, an uploaded picture is dropped so the restored glyph is what is
    drawn — and two fields are left exactly as they stand. `enabled`, because switching a
    built-in off is the one thing a party is told it may do to one; and `sort_order`, because
    the order of the catalogue is the host's (`PUT /achievements/order`) and not a fact about
    this achievement — see the test below."""
    client = party["admin"]
    await client.patch(
        "/api/v1/achievements/builtin-score-9000",
        json={
            "name": "Nine Thousand",
            "description": "Something else entirely.",
            "icon": "beer",
            "color": "pink",
            "hidden": True,
            "enabled": False,
        },
    )
    await client.put(
        "/api/v1/achievements/builtin-score-9000/icon", files=upload(PNG, "a.png", "image/png")
    )
    # Two columns no single-row route can move any more, written here directly. `definition`
    # because a database seeded before the conditions were frozen can still hold a
    # hand-edited one, and putting it right is what reset is for; `sort_order` because only
    # `PUT /achievements/order` writes it, and this test is about the field being left where
    # it stands rather than about how it got there.
    async with party.factory() as session:
        row = await session.get(Achievement, "builtin-score-9000")
        assert row is not None
        row.definition = [{"metric": "any_score", "comparator": ">=", "value": 1}]
        row.sort_order = 99
        await session.commit()

    response = await client.post("/api/v1/achievements/builtin-score-9000/reset")

    assert response.status_code == 200, response.text
    shipped = BY_ID["builtin-score-9000"]
    restored = response.json()
    assert restored["name"] == shipped.name
    assert restored["description"] == shipped.description
    assert restored["icon"] == shipped.icon
    assert restored["color"] == shipped.color
    assert restored["hidden"] == shipped.hidden
    # The upload is gone and the picture Wingman ships is drawn again.
    assert restored["has_image"] is True
    assert restored["image_shipped"] is True
    assert icon_files(party.icons) == []
    # Kept: somebody who switched this one off did it on purpose, and somebody put this row
    # where it is on purpose too.
    assert restored["enabled"] is False
    assert restored["sort_order"] == 99
    assert await stored_definition(party, "builtin-score-9000") == shipped.definition
    assert icon_files(party.icons) == []


async def test_resetting_one_is_the_cure_for_a_definition_nothing_can_read(
    party: Party,
) -> None:
    """The one repair there is. A column hand-edited into a shape the models refuse evaluates
    as "never satisfied", and `PATCH` cannot put it right — a definition on a built-in is a
    409 whatever it says. Reset writes the shipped JSON over it without reading what was
    there, which is what makes the claim in `docs/dev/achievements.md` true."""
    async with party.factory() as session:
        row = await session.get(Achievement, "builtin-score-9000")
        assert row is not None
        row.definition = "nonsense"  # type: ignore[assignment]
        await session.commit()
    refused = await party["admin"].patch(
        "/api/v1/achievements/builtin-score-9000",
        json={"definition": BY_ID["builtin-score-9000"].definition},
    )
    assert refused.status_code == 409, refused.text

    response = await party["admin"].post("/api/v1/achievements/builtin-score-9000/reset")

    assert response.status_code == 200, response.text
    shipped = BY_ID["builtin-score-9000"]
    assert await stored_definition(party, "builtin-score-9000") == shipped.definition
    assert response.json()["definition"][0]["value"] == shipped.definition[0]["value"]


async def test_resetting_an_achievement_nobody_ships_is_a_conflict(party: Party) -> None:
    """One somebody made here has nothing to be put back to — `builtin.py` never heard of
    it."""
    created = await create(party["admin"], name="Encore")

    refused = await party["admin"].post(f"/api/v1/achievements/{created['id']}/reset")

    assert refused.status_code == 409, refused.text
    assert refused.json() == {"detail": "not_built_in"}
    assert (await catalogue(party["admin"]))[-1]["name"] == "Encore"


async def test_a_reset_definition_is_worked_out_for_everybody_again(party: Party) -> None:
    """A reset can take a badge away: the conditions it puts back are stricter than the ones
    somebody had loosened, and recomputation is the truth."""
    player_id = await add_player(party, None, "Guest")
    await _add_score(party, player_id, 500)
    await award(party, "builtin-score-9000", player_id)

    response = await party["admin"].post("/api/v1/achievements/builtin-score-9000/reset")
    assert response.status_code == 200, response.text
    await service.wait_for_passes()

    record = await party["anonymous"].get(f"/api/v1/players/{player_id}/achievements")
    rows = {row["achievement_id"]: row for row in record.json()["achievements"]}
    assert rows["builtin-score-9000"]["earned_at"] is None


async def test_the_catalogue_takes_the_order_it_is_sent(party: Party) -> None:
    """The improvement asked for a sortable list. One sequence over the whole table: the
    numbers are handed out 0, 1, 2 … in the order sent, so what comes back is the order and
    not an arithmetic accident of what the rows held before."""
    made = await create(party["admin"], name="Encore")
    ids = [row["id"] for row in await catalogue(party["admin"])]
    assert ids[-1] == made["id"]
    wanted = [made["id"], *ids[:-1]]

    response = await party["admin"].put("/api/v1/achievements/order", json={"ids": wanted})

    assert response.status_code == 200, response.text
    answered = response.json()["achievements"]
    assert [row["id"] for row in answered] == wanted
    assert [row["sort_order"] for row in answered] == list(range(len(wanted)))
    # The managing answer, so the page that reordered can hold what it drew: every row's
    # definition is on it, the hidden ones spelled out.
    assert all(row["definition"] is not None for row in answered)
    assert all(row["name"] != "" for row in answered)
    # And it stuck: the next listing, for anybody, is in that order.
    assert [row["id"] for row in await catalogue(party["anonymous"])] == wanted


@pytest.mark.parametrize(
    "sent",
    [
        pytest.param("short", id="one left out"),
        pytest.param("extra", id="an id nothing holds"),
        pytest.param("twice", id="the same id twice"),
        pytest.param("empty", id="nothing at all"),
    ],
)
async def test_an_order_that_is_not_a_permutation_is_refused(party: Party, sent: str) -> None:
    """A partial order would silently decide where everything it left out belongs, and a list
    naming a row twice is no order at all. Nothing is renumbered — the same refusal a
    playlist's reorder gives."""
    before = [row["id"] for row in await catalogue(party["admin"])]
    bodies = {
        "short": before[:-1],
        "extra": [*before, "nope"],
        "twice": [before[0], *before],
        "empty": [],
    }

    refused = await party["admin"].put("/api/v1/achievements/order", json={"ids": bodies[sent]})

    assert refused.status_code == 422, refused.text
    assert refused.json() == {"detail": "order_mismatch"}
    assert [row["id"] for row in await catalogue(party["admin"])] == before


async def test_no_other_route_writes_where_a_row_sits(party: Party) -> None:
    """`PUT /achievements/order` is the one write over `sort_order`, and it takes the whole
    catalogue as one permutation — so the column is always one sequence, 0, 1, 2 … A second
    writer over a single row could put two rows on the same number, which is why neither the
    PATCH nor the create body carries the field at all. A body that names it anyway is the
    no-op the models make of a field they do not declare, not a refused write: refusing a
    whole edit over a number is no help to anybody, and an older client is the likeliest
    sender."""
    client = party["admin"]
    before = [row["id"] for row in await catalogue(client)]

    edited = await client.patch(
        f"/api/v1/achievements/{before[-1]}", json={"name": "Renamed", "sort_order": 0}
    )

    assert edited.status_code == 200, edited.text
    assert edited.json()["name"] == "Renamed"
    assert edited.json()["sort_order"] == len(before) - 1
    assert [row["id"] for row in await catalogue(client)] == before

    # And a create lands at the end of the list whatever it asks for.
    made = await create(client, name="Encore", sort_order=0)

    assert made["sort_order"] == len(before)
    assert [row["id"] for row in await catalogue(client)] == [*before, made["id"]]


async def test_a_reset_leaves_a_built_in_where_the_host_put_it(party: Party) -> None:
    """The interaction between the two: a reset restores what an achievement *is*, not where
    it is filed. Putting `BUILT_INS.index()` back after the whole table has been renumbered
    would drop the row at an arbitrary spot rather than "where Wingman had it"."""
    ids = [row["id"] for row in await catalogue(party["admin"])]
    moved = [ids[-1], *ids[:-1]]
    assert (
        await party["admin"].put("/api/v1/achievements/order", json={"ids": moved})
    ).status_code == 200

    response = await party["admin"].post(f"/api/v1/achievements/{moved[0]}/reset")

    assert response.status_code == 200, response.text
    assert response.json()["sort_order"] == 0
    assert [row["id"] for row in await catalogue(party["admin"])] == moved


async def test_an_unknown_achievement_is_404(party: Party) -> None:
    client = party["admin"]
    assert (await client.patch("/api/v1/achievements/nope", json={"name": "x"})).status_code == 404
    assert (await client.delete("/api/v1/achievements/nope")).status_code == 404
    assert (await client.post("/api/v1/achievements/nope/reset")).status_code == 404
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
        pytest.param(
            [
                {
                    "metric": "any_score",
                    "comparator": ">=",
                    "value": 1,
                    "match": {
                        "combine": "all",
                        "clauses": [{"field": "title", "op": "regex", "value": "(a+"}],
                    },
                }
            ],
            id="a regular expression that cannot compile",
        ),
        pytest.param(
            [
                {
                    "metric": "any_score",
                    "comparator": ">=",
                    "value": 1,
                    "match": {
                        "combine": "all",
                        "clauses": [{"field": "title", "op": "regex", "value": "(a+)+$"}],
                    },
                }
            ],
            id="a regular expression that would never finish",
        ),
        pytest.param(
            [
                {
                    "metric": "any_score",
                    "comparator": ">=",
                    "value": 1,
                    "match": {
                        "combine": "all",
                        # `re.compile` answers this one with an `OverflowError`, which used
                        # to escape the validator and be a 500 instead of a refusal.
                        "clauses": [{"field": "title", "op": "regex", "value": "(a){4294967296}"}],
                    },
                }
            ],
            id="a regular expression whose repetition count is absurd",
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


async def test_a_song_rule_takes_a_regular_expression_and_hands_it_back(party: Party) -> None:
    """Stored as written — a pattern is bytes the author chose, and a definition that came
    back normalised would be a definition they cannot edit. The 422 for a pattern Python
    refuses carries its own words, which is what tells somebody *where* to look."""
    pattern = r"^(?-i:Live) at .*\d{4}$"
    body = {
        "name": "Live and loud",
        "color": "gold",
        "definition": [
            {
                "metric": "number_of_scores",
                "comparator": ">=",
                "value": 5,
                "match": {
                    "combine": "all",
                    "clauses": [{"field": "title", "op": "regex", "value": pattern}],
                },
            }
        ],
    }

    response = await party["admin"].post("/api/v1/achievements", json=body)
    assert response.status_code == 201, response.text
    clause = response.json()["definition"][0]["match"]["clauses"][0]
    assert clause == {"field": "title", "op": "regex", "value": pattern}

    body["definition"][0]["match"]["clauses"][0]["value"] = "(a+"  # type: ignore[index]
    refused = await party["admin"].post("/api/v1/achievements", json=body)
    assert refused.status_code == 422
    assert "unterminated subpattern" in refused.text


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


async def test_a_hidden_achievement_gives_away_no_version_of_the_picture_it_has(
    party: Party,
) -> None:
    """A version that moved would say a hidden achievement has a picture just as loudly as
    `has_image` would — and having one is part of the surprise."""
    created = await create(party["admin"], **SECRET)
    await party["admin"].put(
        f"/api/v1/achievements/{created['id']}/icon", files=upload(PNG, "a.png", "image/png")
    )

    (blank,) = [one for one in await catalogue(party["anonymous"]) if one["id"] == created["id"]]
    (whole,) = [
        one for one in await catalogue(party["admin"], manage=True) if one["id"] == created["id"]
    ]

    assert blank["has_image"] is False
    assert blank["icon_version"] is None
    # The picture really is there, so the two None answers above are the masking and not the
    # absence of one.
    assert whole["has_image"] is True
    assert isinstance(whole["icon_version"], int)


async def test_the_icon_version_moves_only_when_the_picture_does(party: Party) -> None:
    """Replacing a picture changes neither the icon URL nor `has_image`, so this is the only
    field a client can hang a cache buster on."""
    created = await create(party["admin"])
    assert created["icon_version"] is None
    url = f"/api/v1/achievements/{created['id']}/icon"

    uploaded = (await party["admin"].put(url, files=upload(PNG, "a.png", "image/png"))).json()
    assert isinstance(uploaded["icon_version"], int)
    # Reading the catalogue again reports the same version: nothing but a write moves it.
    (listed,) = [one for one in await catalogue(party["admin"]) if one["id"] == created["id"]]
    assert listed["icon_version"] == uploaded["icon_version"]

    # A touch of the stored file stands in for a second upload a moment later.
    touched = touch_and_read_version(party.icons / f"{created['id']}.png")
    (replaced,) = [one for one in await catalogue(party["admin"]) if one["id"] == created["id"]]
    assert replaced["icon_version"] == touched

    removed = await party["admin"].delete(url)

    assert removed.json()["has_image"] is False
    assert removed.json()["icon_version"] is None


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


async def test_the_management_page_sees_every_hidden_achievement_and_its_definition(
    party: Party,
) -> None:
    """Somebody has to be able to write the thing — and asking is what says they are."""
    created = await create(party["admin"], **SECRET)

    (row,) = [
        one for one in await catalogue(party["admin"], manage=True) if one["id"] == created["id"]
    ]

    assert row["name"] == "Brave Soul"
    (condition,) = row["definition"]
    assert (condition["metric"], condition["comparator"], condition["value"]) == (
        "any_score",
        "<=",
        2000,
    )


async def test_a_manager_who_did_not_ask_to_manage_is_masked_like_anybody_else(
    party: Party,
) -> None:
    """The bug this is here for: the administrator and the host screen hold every capability
    and read this very listing on the user page and on the TV. A hidden achievement spelled
    out there is the surprise gone for the whole room, so holding the capability unmasks
    nothing — only using it does."""
    created = await create(party["admin"], **SECRET)
    await add_player(party, "admin", "Yannis")

    (row,) = [one for one in await catalogue(party["admin"]) if one["id"] == created["id"]]

    assert row["name"] == ""
    assert row["description"] == ""
    assert row["icon"] is None
    assert row["has_image"] is False
    assert row["definition"] is None


async def test_earning_it_reveals_it_to_a_manager_too(party: Party) -> None:
    """The unmasking rule is one rule for everybody: the caller's own player has it."""
    created = await create(party["admin"], **SECRET)
    await award(party, created["id"], await add_player(party, "admin", "Yannis"))

    (row,) = [one for one in await catalogue(party["admin"]) if one["id"] == created["id"]]

    assert row["name"] == "Brave Soul"
    # Revealed, not managed: what it asks for still takes asking to manage.
    assert row["definition"] is None


async def test_asking_to_manage_without_the_capability_is_refused(party: Party) -> None:
    """Not "masked anyway": a listing that quietly ignored the question would tell a client
    nothing about why it got a locked slot back."""
    await create(party["admin"], **SECRET)

    for identity in ("anonymous", "user", "trusted"):
        response = await party[identity].get("/api/v1/achievements", params={"manage": "true"})
        assert response.status_code == 403, identity
        assert response.json()["detail"] == "missing_permission:achievements.manage"


async def test_the_host_screen_is_masked_like_anybody_else(party: Party) -> None:
    """The other caller that holds every capability without ever managing anything: the host
    session is trusted by device and is an administrator (`auth/deps.py`), and the stage
    reads this very catalogue. A hidden achievement spelled out on the projector is the
    surprise gone for the whole room, so the TV gets the stranger's answer — it is nobody's
    player and has earned nothing."""
    created = await create(party["admin"], **SECRET)
    await add_session(party.factory, "host-token", None, is_host=True)
    host = _client(party.app, "host-token")
    try:
        (row,) = [one for one in await catalogue(host) if one["id"] == created["id"]]

        assert row["name"] == ""
        assert row["definition"] is None
        # It could ask — it holds the capability — and nothing on the stage does.
        assert (
            await host.get("/api/v1/achievements", params={"manage": "true"})
        ).status_code == 200
    finally:
        await host.aclose()


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

    # A manager reading it is a reader like any other: a singer's record is not something to
    # manage, and this is the page an administrator's own phone opens.
    for identity in ("user", "anonymous", "admin"):
        response = await party[identity].get(f"/api/v1/players/{player_id}/achievements")

        assert response.status_code == 200, response.text
        rows = {row["achievement_id"]: row for row in response.json()["achievements"]}
        assert rows[secret["id"]]["achievement"]["name"] == "", identity
        assert rows[secret["id"]]["achievement"]["definition"] is None, identity
        assert rows[secret["id"]]["progress_current"] is None, identity
        assert rows[secret["id"]]["progress_target"] is None, identity
        # An achievement that is not hidden keeps its bar.
        assert rows[open_one["id"]]["progress_current"] == 3, identity
        assert rows[open_one["id"]]["progress_target"] == 10, identity


async def test_every_answer_counts_the_players_who_hold_an_achievement(party: Party) -> None:
    """What the modal says under the description: players with the badge, a player taken out
    of the singer picker among them, and never a row that is progress only or names a player
    who is gone."""
    held = await create(party["admin"], name="Regular")
    nobody = await create(party["admin"], name="Untouchable")
    yannis = await add_player(party, "user", "Yannis")
    hidden = await add_player(party, None, "Alex")
    on_the_way = await add_player(party, None, "Sam")
    await award(party, held["id"], yannis)
    await award(party, held["id"], hidden)
    async with party.factory() as session:
        player = await session.get(Player, hidden)
        assert player is not None
        player.hidden = True
        # On the way there, and not there yet.
        session.add(
            PlayerAchievement(
                achievement_id=held["id"],
                player_id=on_the_way,
                progress_current=3,
                progress_target=10,
            )
        )
        # Left behind by a deleted player: `delete_player` keeps the row.
        session.add(
            PlayerAchievement(
                achievement_id=held["id"],
                player_id="0" * 32,
                earned_at=datetime(2026, 9, 1, 20, 0, tzinfo=UTC),
            )
        )
        await session.commit()

    for rows in (
        await catalogue(party["anonymous"]),
        await catalogue(party["user"]),
        await catalogue(party["admin"], manage=True),
    ):
        counts = {row["id"]: row["holder_count"] for row in rows}
        assert counts[held["id"]] == 2
        assert counts[nobody["id"]] == 0

    response = await party["anonymous"].get(f"/api/v1/players/{yannis}/achievements")
    assert response.status_code == 200, response.text
    (row,) = [one for one in response.json()["achievements"] if one["achievement_id"] == held["id"]]
    assert row["achievement"]["holder_count"] == 2


async def test_a_hidden_achievement_keeps_how_many_hold_it_with_its_name(party: Party) -> None:
    """How many people found a hidden one says it can be found, and how often: the count is
    masked exactly where the name is, and nowhere else."""
    secret = await create(party["admin"], **SECRET)
    yannis = await add_player(party, "user", "Yannis")
    stranger = await add_player(party, "trusted", "Alex")
    await award(party, secret["id"], yannis)
    async with party.factory() as session:
        session.add(
            PlayerAchievement(
                achievement_id=secret["id"],
                player_id=stranger,
                progress_current=0,
                progress_target=1,
            )
        )
        await session.commit()

    def count_in(rows: list[dict[str, Any]]) -> object:
        (row,) = [one for one in rows if one["id"] == secret["id"]]
        return row["holder_count"]

    for identity in ("anonymous", "trusted", "admin"):
        assert count_in(await catalogue(party[identity])) is None, identity
    assert count_in(await catalogue(party["user"])) == 1
    assert count_in(await catalogue(party["admin"], manage=True)) == 1

    async def record_count(player_id: str) -> object:
        response = await party["anonymous"].get(f"/api/v1/players/{player_id}/achievements")
        assert response.status_code == 200, response.text
        (row,) = [
            one for one in response.json()["achievements"] if one["achievement_id"] == secret["id"]
        ]
        return row["achievement"]["holder_count"]

    # Masked over the subject, like the rest of a player's record.
    assert await record_count(stranger) is None
    assert await record_count(yannis) == 1


async def add_party(party: Party, session_id: str, *, minutes_ago: float) -> None:
    """One recorded party, last sung into `minutes_ago` minutes ago. What
    `stats.service.current_session` reads to answer whether an evening is still going."""
    moment = datetime.now(UTC) - timedelta(minutes=minutes_ago)
    async with party.factory() as session:
        session.add(KaraokeSession(id=session_id, started_at=moment, last_activity_at=moment))
        await session.commit()


async def standing(party: Party, player_id: str) -> dict[str, dict[str, Any]]:
    response = await party["anonymous"].get(f"/api/v1/players/{player_id}/achievements")
    assert response.status_code == 200, response.text
    return {row["achievement_id"]: row for row in response.json()["achievements"]}


async def test_progress_counted_at_a_party_that_is_over_starts_again_at_zero(
    party: Party,
) -> None:
    """ "Sing ten songs in one evening" is ten songs again tomorrow.

    The engine has no clock: it counts a session-scoped condition in the singer's newest
    party and writes down which one that was. Here is where that number meets the time —
    while that party is the one still going it is what the bar says, and once it is over the
    bar reads `0 / N`. Zero and **not** null: null is how a row with no bar at all says so,
    and a row that had one last night still has one tonight.
    """
    tonight = await create(party["admin"], name="Tonight", definition=[SESSION_CONDITION])
    last_month = await create(party["admin"], name="Last month", definition=[SESSION_CONDITION])
    global_one = await create(
        party["admin"],
        name="Over all time",
        definition=[{"metric": "number_of_sings", "comparator": ">=", "value": 10}],
    )
    player_id = await add_player(party, "user", "Yannis")
    await add_party(party, "party-now", minutes_ago=5)
    await add_party(party, "party-old", minutes_ago=60 * 24 * 30)
    async with party.factory() as session:
        for achievement_id, progress_session_id in (
            (tonight["id"], "party-now"),
            (last_month["id"], "party-old"),
            # Progress from a global condition names no party and is never zeroed.
            (global_one["id"], None),
        ):
            session.add(
                PlayerAchievement(
                    achievement_id=achievement_id,
                    player_id=player_id,
                    progress_current=9,
                    progress_target=10,
                    progress_session_id=progress_session_id,
                )
            )
        await session.commit()

    rows = await standing(party, player_id)

    assert rows[tonight["id"]]["progress_current"] == 9
    assert rows[last_month["id"]]["progress_current"] == 0
    # The target stays either way, which is what keeps the bar on the page.
    assert rows[last_month["id"]]["progress_target"] == 10
    assert rows[global_one["id"]]["progress_current"] == 9


async def test_progress_from_the_last_party_is_zero_once_no_party_is_running(
    party: Party,
) -> None:
    """Nothing has been sung for longer than the session gap, so there is no current party
    at all and every party-scoped bar has started again."""
    tonight = await create(party["admin"], name="Tonight", definition=[SESSION_CONDITION])
    player_id = await add_player(party, "user", "Yannis")
    await add_party(party, "party-now", minutes_ago=SESSION_GAP.total_seconds() / 60 + 1)
    async with party.factory() as session:
        session.add(
            PlayerAchievement(
                achievement_id=tonight["id"],
                player_id=player_id,
                progress_current=9,
                progress_target=10,
                progress_session_id="party-now",
            )
        )
        await session.commit()

    assert (await standing(party, player_id))[tonight["id"]]["progress_current"] == 0


async def test_an_earned_badge_keeps_the_numbers_it_was_earned_with(party: Party) -> None:
    """It was earned. The number beside a badge is a record of how it was reached, not an
    invitation, so nothing about it starts again in the morning.

    This is the reading half only — the row is written by hand. That the engine puts the
    earning party's own number on such a row in the first place is
    `test_an_earned_badge_counts_the_party_that_earned_it`.
    """
    earned = await create(party["admin"], name="Earned", definition=[SESSION_CONDITION])
    player_id = await add_player(party, "user", "Yannis")
    await add_party(party, "party-old", minutes_ago=60 * 24 * 30)
    async with party.factory() as session:
        session.add(
            PlayerAchievement(
                achievement_id=earned["id"],
                player_id=player_id,
                earned_at=datetime(2026, 8, 1, 20, 0, tzinfo=UTC),
                session_id="party-old",
                progress_current=10,
                progress_target=10,
                progress_session_id="party-old",
            )
        )
        await session.commit()

    row = (await standing(party, player_id))[earned["id"]]

    assert row["progress_current"] == 10
    assert row["earned_at"] is not None


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
    # The shipped picture, served to a phone that never logged in.
    assert (
        await party["anonymous"].get("/api/v1/achievements/builtin-score-9000/icon")
    ).status_code == 200


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
        # A reset can rename, recolour and re-condition a badge in one go, so it is as much a
        # catalogue change as an edit is.
        party["admin"].post("/api/v1/achievements/builtin-score-9000/reset"),
        # The order is what every badge surface lists in, so moving it moves what a client
        # holding the catalogue open draws.
        party["admin"].put(
            "/api/v1/achievements/order",
            json={"ids": [row["id"] for row in reversed(await catalogue(party["admin"]))]},
        ),
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
    # The conditions of a built-in, and a reset of something nobody ships: both 409s.
    await party["admin"].patch(
        "/api/v1/achievements/builtin-score-9000",
        json={"definition": [{"metric": "any_score", "comparator": ">=", "value": 1}]},
    )
    await party["admin"].post("/api/v1/achievements/nope/reset")
    await party["admin"].post(
        "/api/v1/achievements",
        json={"name": "Broken", "color": "gold", "definition": [{"metric": "nonsense"}]},
    )
    # An order that is not a permutation of the catalogue: nothing was renumbered.
    await party["admin"].put("/api/v1/achievements/order", json={"ids": ["nope"]})
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


# --- The pictures Wingman ships ------------------------------------------------------------

# The built-ins whose artwork does not exist yet — **empty since 2026-09-05**, when the last
# eighteen pictures landed: every built-in ships its two PNGs today. The set stays because the
# next built-in arrives before its picture does: the pictures are drawn by hand, one at a time,
# out of the motif entries in `docs/dev/achievement-artwork.md` (§4), and a badge without its
# two PNGs is drawn with its glyph in the meantime — so the promise below is "every built-in
# except these". An id lives here from the commit that adds it to `BUILT_INS` until the commit
# that adds its two files, and leaves in that second one.
#
# Emptying it skips nothing that was checking a file: the listings below are still pinned, so
# a stray or misnamed file in either directory fails just as it did, and a picture that lands
# while its id is still named here fails too. The one thing an empty set does skip is the
# parametrized glyph test under it, which has no built-in left to ask about — pytest reports
# it as `got empty parameter set`, and it comes back with the next built-in.
PICTURES_PENDING: frozenset[str] = frozenset()


def test_every_built_in_ships_a_picture_in_both_sizes() -> None:
    """What `docs/dev/achievement-artwork.md` promises: one full-size and one small PNG per
    built-in, named by its id, and nothing else in either directory — a stray file there
    would ship in every wheel and every installer. Except the ones whose artwork is still to
    be drawn (`PICTURES_PENDING`), which ship no file at all."""
    directory = pictures.images_dir()
    ids = {built_in.id for built_in in BUILT_INS}
    # A renamed or misspelled id in the set would otherwise quietly excuse a real built-in.
    assert ids >= PICTURES_PENDING
    expected = {f"{built_in_id}.png" for built_in_id in ids - PICTURES_PENDING}

    assert {path.name for path in directory.glob("*.png")} == expected
    assert {path.name for path in (directory / "small").glob("*.png")} == expected


@pytest.mark.parametrize("achievement_id", sorted(PICTURES_PENDING))
async def test_a_built_in_whose_artwork_is_still_to_come_is_drawn_with_its_glyph(
    party: Party, achievement_id: str
) -> None:
    """A built-in ships a picture "unless" — and until the file exists there is nothing to
    serve, so the row says so and the badge falls back to the glyph it declares
    (`AchievementBadge` draws the glyph whenever `has_image` is false).

    `pictures.shipped_picture` asks the disk and not `builtin.py`, which is what makes this
    the ordinary answer rather than a broken one. The test list empties itself as the pictures
    land."""
    rows = {row["id"]: row for row in await catalogue(party["admin"], manage=True)}
    row = rows[achievement_id]

    assert row["has_image"] is False
    assert row["image_shipped"] is False
    assert row["icon_version"] is None
    # No file, so no picture to fetch — for a manager as much as for a stranger. `manage`
    # lifts the masking of a hidden achievement, never the absence of a file.
    url = f"/api/v1/achievements/{achievement_id}/icon"
    assert (await party["admin"].get(url)).status_code == 404
    assert (await party["anonymous"].get(url)).status_code == 404


async def test_a_fresh_built_in_is_drawn_with_its_shipped_picture(party: Party) -> None:
    """Nobody uploaded anything, and a built-in whose artwork exists has a picture anyway; an
    achievement somebody made has none until they give it one."""
    rows = {row["id"]: row for row in await catalogue(party["anonymous"])}
    golden = rows["builtin-score-9000"]
    assert golden["has_image"] is True
    assert golden["image_shipped"] is True
    # The shipped file's own version, so a reinstall with new artwork busts the cache too.
    assert isinstance(golden["icon_version"], int)

    created = await create(party["admin"])
    assert created["has_image"] is False
    assert created["image_shipped"] is False
    assert created["icon_version"] is None


async def test_the_shipped_picture_is_served_in_two_sizes(party: Party) -> None:
    """`size=small` is the row's and the TV's; the default is the whole picture."""
    url = "/api/v1/achievements/builtin-score-9000/icon"

    full = await party["anonymous"].get(url)
    assert full.status_code == 200
    assert full.headers["content-type"] == "image/png"
    assert full.content == (pictures.images_dir() / "builtin-score-9000.png").read_bytes()

    small = await party["anonymous"].get(url, params={"size": "small"})
    assert small.status_code == 200
    assert (
        small.content == (pictures.images_dir() / "small" / "builtin-score-9000.png").read_bytes()
    )
    assert len(small.content) < len(full.content)

    assert (await party["anonymous"].get(url, params={"size": "huge"})).status_code == 422


async def test_an_upload_stands_in_front_of_the_shipped_picture_until_it_is_removed(
    party: Party,
) -> None:
    """An upload wins, at every size — nothing resizes it, so a row asking for `small` gets
    the upload itself — and removing it is the way back to the shipped picture, which is
    what `image_shipped` tells the editor to call that button."""
    url = "/api/v1/achievements/builtin-score-9000/icon"

    uploaded = await party["admin"].put(url, files=upload(PNG, "a.png", "image/png"))
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["has_image"] is True
    assert uploaded.json()["image_shipped"] is False
    assert (await party["anonymous"].get(url, params={"size": "small"})).content == PNG

    removed = await party["admin"].delete(url)
    assert removed.status_code == 200
    assert removed.json()["has_image"] is True
    assert removed.json()["image_shipped"] is True
    assert icon_files(party.icons) == []
    served = await party["anonymous"].get(url)
    assert served.content == (pictures.images_dir() / "builtin-score-9000.png").read_bytes()


async def test_a_hidden_built_in_keeps_its_shipped_picture_back_too(party: Party) -> None:
    """Brave Soul ships hidden and ships a picture. A stranger gets neither the flag nor the
    file until somebody has earned it; a manager, who may edit it, gets the file."""
    (row,) = [
        one for one in await catalogue(party["anonymous"]) if one["id"] == "builtin-brave-soul"
    ]
    assert row["has_image"] is False
    assert row["image_shipped"] is False
    assert row["icon_version"] is None

    url = "/api/v1/achievements/builtin-brave-soul/icon"
    assert (await party["anonymous"].get(url)).status_code == 404
    assert (await party["admin"].get(url)).status_code == 200
