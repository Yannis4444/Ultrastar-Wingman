"""Permission groups: the groups themselves, who is in them, and the two rules that keep a
helper from growing beyond their own rights (docs/dev/permission-groups.md §5).

Every row of §5.1's threat table is a test here, besides the ones other files own: an
account single sign-on creates (test_auth_oidc), a session outliving a change
(test_permissions), and a tag row naming a group (test_tags_api, plus Admin and an unknown
id below).
"""

import logging
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response

from conftest import BASE_URL, add_session, add_user
from test_wishlist_api import factory
from ultrastar_wingman.app import create_app
from ultrastar_wingman.auth.deps import COOKIE_NAME
from ultrastar_wingman.auth.model import GroupCapability, UserGroup
from ultrastar_wingman.auth.permissions import (
    ADMIN,
    CAPABILITIES,
    DEFAULT_GROUP_CAPABILITIES,
    GUEST,
    TRUSTED_GROUP_ID,
    USER,
)
from ultrastar_wingman.config import BootstrapSettings

USER_RIGHTS = DEFAULT_GROUP_CAPABILITIES[USER]
TRUSTED_RIGHTS = DEFAULT_GROUP_CAPABILITIES[TRUSTED_GROUP_ID]

# The helpers' own groups: one job each, on top of User.
PEOPLE = ("People", ["users.manage"])
RIGHTS = ("Rights", ["permissions.manage"])
BOTH = ("Both", ["users.manage", "permissions.manage"])


@dataclass
class Party:
    """One app, one client per identity. `groups` maps a helper group's name to its id."""

    app: FastAPI
    clients: dict[str, AsyncClient]
    ids: dict[str, str]
    groups: dict[str, str]

    def __getitem__(self, identity: str) -> AsyncClient:
        return self.clients[identity]


def _client(app: FastAPI, token: str | None = None) -> AsyncClient:
    cookies = {} if token is None else {COOKIE_NAME: token}
    return AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL, cookies=cookies)


async def make_group(
    client: AsyncClient, name: str, capabilities: Sequence[str] = (), expect: int = 201
) -> dict[str, Any]:
    response = await client.post(
        "/api/v1/groups", json={"name": name, "capabilities": list(capabilities)}
    )
    assert response.status_code == expect, response.text
    body: dict[str, Any] = response.json()
    return body


async def put_in(client: AsyncClient, user_id: str, groups: Sequence[str]) -> Response:
    return await client.put(f"/api/v1/users/{user_id}/groups", json={"groups": list(groups)})


async def listed(client: AsyncClient) -> dict[str, dict[str, Any]]:
    response = await client.get("/api/v1/groups")
    assert response.status_code == 200, response.text
    return {group["id"]: group for group in response.json()["groups"]}


async def me(client: AsyncClient) -> dict[str, Any]:
    body: dict[str, Any] = (await client.get("/api/v1/auth/me")).json()
    return body


def detail(response: Response) -> tuple[int, Any]:
    return response.status_code, response.json().get("detail")


@pytest.fixture
async def party(bootstrap_settings: BootstrapSettings) -> AsyncIterator[Party]:
    app = create_app(bootstrap_settings)
    async with app.router.lifespan_context(app):
        clients = {"anonymous": _client(app)}
        ids: dict[str, str] = {}
        accounts = {
            "admin": [ADMIN],
            "plain": [],
            "trusted": [TRUSTED_GROUP_ID],
            "people": [],
            "rights": [],
            "both": [],
        }
        for name, member_of in accounts.items():
            ids[name] = await add_user(factory(app), f"{name}-account", groups=member_of)
            await add_session(factory(app), f"{name}-token", ids[name])
            clients[name] = _client(app, f"{name}-token")
        # The host screen: an administrator by device, with no account behind it.
        await add_session(factory(app), "host-token", None, is_host=True)
        clients["host"] = _client(app, "host-token")

        groups: dict[str, str] = {}
        for name, capabilities in (PEOPLE, RIGHTS, BOTH):
            groups[name] = (await make_group(clients["admin"], name, capabilities))["id"]
            account = name.lower()
            assert (await put_in(clients["admin"], ids[account], [groups[name]])).status_code == 200
        try:
            yield Party(app=app, clients=clients, ids=ids, groups=groups)
        finally:
            for client in clients.values():
                await client.aclose()


# --- §5.1, row by row -----------------------------------------------------------------------


async def test_a_people_manager_cannot_put_themselves_in_admin(party: Party) -> None:
    refused = await put_in(party["people"], party.ids["people"], [party.groups["People"], ADMIN])

    assert detail(refused) == (403, "admin_required")
    assert (await me(party["people"]))["is_admin"] is False


async def test_a_people_manager_cannot_delete_an_administrator(party: Party) -> None:
    refused = await party["people"].delete(f"/api/v1/users/{party.ids['admin']}")
    assert detail(refused) == (403, "admin_required")

    # An administrator may — but never the last one.
    last = await party["host"].delete(f"/api/v1/users/{party.ids['admin']}")
    assert detail(last) == (409, "last_admin")


async def test_a_rights_manager_cannot_give_their_group_every_capability(party: Party) -> None:
    rights = party.groups["Rights"]

    refused = await party["rights"].patch(
        f"/api/v1/groups/{rights}", json={"capabilities": list(CAPABILITIES)}
    )

    # The first capability, in catalogue order, the helper does not hold.
    assert detail(refused) == (403, "missing_permission:songs.rescan")
    # The ones they hold go through, and change nothing for them.
    held = sorted(USER_RIGHTS | {"permissions.manage"})
    allowed = await party["rights"].patch(f"/api/v1/groups/{rights}", json={"capabilities": held})
    assert allowed.status_code == 200, allowed.text
    assert set((await me(party["rights"]))["capabilities"]) == set(held)


async def test_nobody_but_an_administrator_hands_out_what_they_lack_when_creating(
    party: Party,
) -> None:
    refused = await party["rights"].post(
        "/api/v1/groups", json={"name": "Everything", "capabilities": list(CAPABILITIES)}
    )
    assert detail(refused) == (403, "missing_permission:songs.rescan")
    assert all(group["name"] != "Everything" for group in (await listed(party["admin"])).values())


async def test_joining_a_group_needs_everything_it_carries(party: Party) -> None:
    """An administrator made a group with every capability: a people manager putting
    themselves in it is refused for the first one they lack, themselves as the account
    included."""
    everything = await make_group(party["admin"], "Everything", CAPABILITIES)

    refused = await put_in(
        party["people"], party.ids["people"], [party.groups["People"], everything["id"]]
    )

    assert detail(refused) == (403, "missing_permission:songs.rescan")
    # Nor anybody else.
    other = await put_in(party["people"], party.ids["plain"], [everything["id"]])
    assert detail(other) == (403, "missing_permission:songs.rescan")


async def test_a_helper_holding_both_may_make_a_group_of_what_they_hold_and_join_it(
    party: Party,
) -> None:
    held = sorted(USER_RIGHTS | {"users.manage", "permissions.manage"})
    made = await make_group(party["both"], "Mine", held)

    joined = await put_in(party["both"], party.ids["both"], [party.groups["Both"], made["id"]])

    assert joined.status_code == 200, joined.text
    assert set((await me(party["both"]))["capabilities"]) == set(held)


async def test_nobody_edits_admins_capabilities(party: Party) -> None:
    for identity in ("admin", "host", "rights"):
        refused = await party[identity].patch(
            "/api/v1/groups/admin", json={"capabilities": ["songs.view"]}
        )
        assert detail(refused) == (409, "admin_not_editable"), identity


async def test_the_built_ins_are_neither_renamed_nor_deleted(party: Party) -> None:
    for group_id in (GUEST, USER, ADMIN):
        renamed = await party["admin"].patch(f"/api/v1/groups/{group_id}", json={"name": "Mine"})
        deleted = await party["admin"].delete(f"/api/v1/groups/{group_id}")
        assert detail(renamed) == (409, "built_in_group"), group_id
        assert deleted.status_code == 409, group_id
        assert deleted.json() == {"detail": "built_in_group"}
    assert [group["name"] for group in (await listed(party["admin"])).values()][:2] == [
        "Guest",
        "User",
    ]


async def test_admin_can_never_be_emptied(party: Party) -> None:
    taken_out = await put_in(party["admin"], party.ids["admin"], [])
    deleted = await party["admin"].delete(f"/api/v1/users/{party.ids['admin']}")

    assert detail(taken_out) == detail(deleted) == (409, "last_admin")
    # The host screen is an administrator but no member: it never counts.
    assert (await listed(party["host"]))[ADMIN]["member_count"] == 1


async def test_a_row_whose_account_is_gone_neither_counts_nor_keeps_admin_alive(
    party: Party,
) -> None:
    """A hand-edited Admin row for an account that does not exist is no administrator: the
    last real one still cannot leave, and no member count includes it."""
    async with factory(party.app)() as session:
        session.add(UserGroup(user_id="0" * 32, group_id=ADMIN))
        session.add(UserGroup(user_id="0" * 32, group_id=TRUSTED_GROUP_ID))
        await session.commit()

    taken_out = await put_in(party["host"], party.ids["admin"], [])

    assert detail(taken_out) == (409, "last_admin")
    groups = await listed(party["host"])
    assert groups[ADMIN]["member_count"] == 1
    assert groups[TRUSTED_GROUP_ID]["member_count"] == 1


@pytest.mark.parametrize("name", ["admin", "Admin", " ADMIN "])
async def test_admins_name_is_taken_in_every_case(party: Party, name: str) -> None:
    refused = await party["admin"].post("/api/v1/groups", json={"name": name})

    assert detail(refused) == (409, "duplicate_group_name")


@pytest.mark.parametrize("name", ["admin", "Admin", " ADMIN "])
async def test_a_rights_manager_cannot_rename_their_group_to_admin(party: Party, name: str) -> None:
    refused = await party["rights"].patch(
        f"/api/v1/groups/{party.groups['Rights']}", json={"name": name}
    )

    assert detail(refused) == (409, "duplicate_group_name")
    assert (await me(party["rights"]))["is_admin"] is False
    # Nor does the host's own Trusted become Admin by a name.
    renamed = await party["admin"].patch(f"/api/v1/groups/{TRUSTED_GROUP_ID}", json={"name": name})
    assert detail(renamed) == (409, "duplicate_group_name")


async def test_user_and_guest_are_assigned_to_nobody(party: Party) -> None:
    for group_id in (USER, GUEST):
        refused = await put_in(party["admin"], party.ids["plain"], [group_id])
        assert detail(refused) == (422, "not_assignable"), group_id


async def test_a_group_that_does_not_exist_is_refused_before_anything_is_written(
    party: Party,
) -> None:
    refused = await put_in(party["admin"], party.ids["plain"], [TRUSTED_GROUP_ID, "nope"])

    assert detail(refused) == (422, "unknown_group")
    # The Trusted row in the same body was not written either.
    users = (await party["admin"].get("/api/v1/users")).json()["users"]
    assert {user["id"]: user for user in users}[party.ids["plain"]]["groups"] == []

    tag = await party["admin"].post(
        "/api/v1/tags",
        json={"name": "x", "color": "blue", "permissions": [{"action": "view", "group_id": "no"}]},
    )
    assert detail(tag) == (422, "unknown_group")


async def test_a_tag_row_for_admin_is_refused(party: Party) -> None:
    refused = await party["admin"].post(
        "/api/v1/tags",
        json={"name": "x", "color": "blue", "permissions": [{"action": "view", "group_id": ADMIN}]},
    )

    assert detail(refused) == (422, "not_assignable")


async def test_a_stored_row_naming_a_group_that_is_gone_gives_nothing(party: Party) -> None:
    """A hand-edited row: no capability, not listed, never a 500 — and the next write of the
    account's whole set drops it."""
    stale = "0" * 32
    async with factory(party.app)() as session:
        session.add(UserGroup(user_id=party.ids["plain"], group_id=stale))
        session.add(GroupCapability(group_id=stale, capability="downloads.view"))
        await session.commit()

    plain = await me(party["plain"])
    assert [group["id"] for group in plain["groups"]] == [USER]
    assert plain["user"]["groups"] == []
    assert "downloads.view" not in plain["capabilities"]
    users = (await party["admin"].get("/api/v1/users")).json()["users"]
    assert {user["id"]: user for user in users}[party.ids["plain"]]["groups"] == []
    assert stale not in await listed(party["admin"])

    assert (await put_in(party["admin"], party.ids["plain"], [])).status_code == 200
    async with factory(party.app)() as session:
        assert await session.get(UserGroup, (party.ids["plain"], stale)) is None


async def test_a_right_for_guest_is_only_handed_out_by_a_holder(party: Party) -> None:
    """Ticking `users.manage` under Guest is the host's own table (accepted in §5.1), but rule 2
    still binds whoever ticks it."""
    with_it = sorted(DEFAULT_GROUP_CAPABILITIES[GUEST] | {"users.manage"})

    refused = await party["rights"].patch("/api/v1/groups/guest", json={"capabilities": with_it})
    allowed = await party["both"].patch("/api/v1/groups/guest", json={"capabilities": with_it})

    assert detail(refused) == (403, "missing_permission:users.manage")
    assert allowed.status_code == 200, allowed.text


async def test_taking_away_is_free_for_a_helper(party: Party) -> None:
    # Taking somebody out of a group whose rights the helper lacks.
    taken_out = await put_in(party["people"], party.ids["trusted"], [])
    assert taken_out.status_code == 200, taken_out.text
    assert taken_out.json()["groups"] == []
    for group_id in (GUEST, USER):
        emptied = await party["rights"].patch(
            f"/api/v1/groups/{group_id}", json={"capabilities": []}
        )
        assert emptied.status_code == 200, emptied.text
    assert (await party["rights"].delete(f"/api/v1/groups/{TRUSTED_GROUP_ID}")).status_code == 204
    assert TRUSTED_GROUP_ID not in await listed(party["admin"])


async def test_a_people_manager_may_delete_an_account_in_a_richer_group(party: Party) -> None:
    deleted = await party["people"].delete(f"/api/v1/users/{party.ids['trusted']}")

    assert deleted.status_code == 204, deleted.text


# --- the rules bind on the difference --------------------------------------------------------


async def test_an_administrator_carried_along_in_the_body_is_no_change_to_admin(
    party: Party,
) -> None:
    """A people manager puts an administrator in People: the body still carries `admin`,
    which they could never add or take — and need not, because it is no change."""
    put = await put_in(party["people"], party.ids["admin"], [ADMIN, party.groups["People"]])

    assert put.status_code == 200, put.text
    assert put.json()["groups"] == [party.groups["People"], ADMIN]
    # Leaving `admin` out of the body is a change, and that one is refused.
    dropped = await put_in(party["people"], party.ids["admin"], [party.groups["People"]])
    assert detail(dropped) == (403, "admin_required")


async def test_a_capability_the_helper_lacks_but_the_group_has_stays(party: Party) -> None:
    """Saving Trusted with everything it holds but one: nothing is added, so nothing the
    helper lacks is handed out — Trusted keeps `songs.rescan` without the helper holding it."""
    kept = sorted(TRUSTED_RIGHTS - {"music.manage"})

    saved = await party["rights"].patch(
        f"/api/v1/groups/{TRUSTED_GROUP_ID}", json={"capabilities": kept}
    )

    assert saved.status_code == 200, saved.text
    assert "songs.rescan" in saved.json()["capabilities"]
    # Putting it back is adding `music.manage`, which they do not hold.
    back = await party["rights"].patch(
        f"/api/v1/groups/{TRUSTED_GROUP_ID}", json={"capabilities": sorted(TRUSTED_RIGHTS)}
    )
    assert detail(back) == (403, "missing_permission:music.manage")


# --- names ----------------------------------------------------------------------------------


async def test_a_name_is_one_to_thirty_two_characters_after_trimming(party: Party) -> None:
    for name in ("", "   ", "x" * 33):
        refused = await party["admin"].post("/api/v1/groups", json={"name": name})
        assert refused.status_code == 422, name
    made = await make_group(party["admin"], "  " + "x" * 32 + "  ")
    assert made["name"] == "x" * 32


async def test_a_duplicate_name_is_refused_after_trimming_and_folding(party: Party) -> None:
    await make_group(party["admin"], "DJs")

    for name in ("DJs", "  djs  "):
        refused = await party["admin"].post("/api/v1/groups", json={"name": name})
        assert detail(refused) == (409, "duplicate_group_name"), name
    renamed = await party["admin"].patch(
        f"/api/v1/groups/{party.groups['People']}", json={"name": "djs"}
    )
    assert detail(renamed) == (409, "duplicate_group_name")


async def test_a_rename_keeps_the_id_and_the_members(party: Party) -> None:
    people = party.groups["People"]

    renamed = await party["admin"].patch(f"/api/v1/groups/{people}", json={"name": "Crew"})

    assert renamed.status_code == 200, renamed.text
    assert (renamed.json()["id"], renamed.json()["name"]) == (people, "Crew")
    assert renamed.json()["member_count"] == 1
    # A case-only rename of a group's own name is no clash.
    recased = await party["admin"].patch(f"/api/v1/groups/{people}", json={"name": "CREW"})
    assert recased.status_code == 200, recased.text
    names = [group["name"] for group in (await me(party["people"]))["groups"]]
    assert names == ["User", "CREW"]


# --- what GET /groups answers ---------------------------------------------------------------


async def test_the_listing_for_an_administrator(party: Party) -> None:
    groups = await listed(party["admin"])

    assert list(groups) == [
        GUEST,
        USER,
        party.groups["Both"],
        party.groups["People"],
        party.groups["Rights"],
        TRUSTED_GROUP_ID,
        ADMIN,
    ]
    assert groups[ADMIN]["capabilities"] == list(CAPABILITIES)
    assert groups[ADMIN]["member_count"] == 1
    assert groups[ADMIN]["right_count"] is None
    assert groups[GUEST]["member_count"] is None
    assert groups[USER]["member_count"] == 6
    assert groups[TRUSTED_GROUP_ID]["member_count"] == 1
    assert groups[GUEST]["right_count"] == len(DEFAULT_GROUP_CAPABILITIES[GUEST])
    assert groups[USER]["right_count"] == len(USER_RIGHTS)
    # What a group adds to User.
    assert groups[TRUSTED_GROUP_ID]["right_count"] == len(TRUSTED_RIGHTS - USER_RIGHTS)
    assert [group["built_in"] for group in groups.values()] == [
        True,
        True,
        False,
        False,
        False,
        False,
        True,
    ]
    # An administrator may put anybody anywhere but in Guest and User.
    assert {group_id: group["can_assign"] for group_id, group in groups.items()} == {
        GUEST: False,
        USER: False,
        party.groups["Both"]: True,
        party.groups["People"]: True,
        party.groups["Rights"]: True,
        TRUSTED_GROUP_ID: True,
        ADMIN: True,
    }


async def test_the_listing_for_a_people_manager(party: Party) -> None:
    """No capabilities without `permissions.manage`, the counts for everybody, and
    `can_assign` only where the reader holds everything the group carries."""
    response = await party["people"].get("/api/v1/groups")
    body = response.json()
    groups = {group["id"]: group for group in body["groups"]}

    assert body["capabilities"] is None
    assert all(group["capabilities"] is None for group in groups.values())
    assert groups[TRUSTED_GROUP_ID]["right_count"] == len(TRUSTED_RIGHTS - USER_RIGHTS)
    assert {group_id: group["can_assign"] for group_id, group in groups.items()} == {
        GUEST: False,
        USER: False,
        party.groups["Both"]: False,
        party.groups["People"]: True,
        party.groups["Rights"]: False,
        TRUSTED_GROUP_ID: False,
        ADMIN: False,
    }


async def test_the_groups_are_closed_to_an_account_without_any_of_the_four(
    party: Party,
) -> None:
    for identity in ("anonymous", "plain"):
        refused = await party[identity].get("/api/v1/groups")
        assert detail(refused) == (403, "missing_permission:users.view"), identity


async def test_the_host_is_an_administrator_without_a_row(party: Party) -> None:
    host = await me(party["host"])

    assert host["groups"] == [{"id": ADMIN, "name": "Admin"}]
    assert host["is_admin"] is True
    assert host["user"] is None


async def test_me_lists_an_accounts_groups_in_the_one_order(party: Party) -> None:
    put = await put_in(party["admin"], party.ids["plain"], [TRUSTED_GROUP_ID, party.groups["Both"]])
    assert put.status_code == 200, put.text

    plain = await me(party["plain"])

    assert [group["name"] for group in plain["groups"]] == ["User", "Both", "Trusted"]
    assert plain["user"]["groups"] == [party.groups["Both"], TRUSTED_GROUP_ID]
    assert plain["is_admin"] is False


# --- deleting a group -----------------------------------------------------------------------


async def test_deleting_a_group_takes_its_rows_and_nothing_else(party: Party) -> None:
    people = party.groups["People"]
    # A second membership, so there is something the delete must leave alone.
    assert (
        await put_in(party["admin"], party.ids["people"], [people, TRUSTED_GROUP_ID])
    ).status_code == 200
    tag = await party["admin"].post(
        "/api/v1/tags",
        json={
            "name": "crew",
            "color": "blue",
            "permissions": [
                {"action": "view", "group_id": people},
                {"action": "view", "group_id": USER},
            ],
        },
    )
    assert tag.status_code == 201, tag.text

    assert (await party["admin"].delete(f"/api/v1/groups/{people}")).status_code == 204

    after = await me(party["people"])
    assert [group["id"] for group in after["groups"]] == [USER, TRUSTED_GROUP_ID]
    assert "users.manage" not in after["capabilities"]
    assert "downloads.manage" in after["capabilities"]
    async with factory(party.app)() as session:
        assert await session.get(GroupCapability, (people, "users.manage")) is None
    tags = (await party["admin"].get("/api/v1/tags")).json()["tags"]
    crew = next(row for row in tags if row["name"] == "crew")
    assert [row["group_id"] for row in crew["permissions"]] == [USER]
    assert (await party["admin"].delete(f"/api/v1/groups/{people}")).status_code == 404


# --- events and log lines -------------------------------------------------------------------


async def test_every_group_write_announces_groups_changed(
    party: Party, broadcast_events: list[dict[str, object]]
) -> None:
    broadcast_events.clear()
    made = await make_group(party["admin"], "DJs", ["music.manage"])
    await party["admin"].patch(f"/api/v1/groups/{made['id']}", json={"name": "Music crew"})
    await party["admin"].patch(f"/api/v1/groups/{made['id']}", json={"capabilities": []})
    await put_in(party["admin"], party.ids["plain"], [made["id"]])
    await party["admin"].delete(f"/api/v1/groups/{made['id']}")

    assert [event for event in broadcast_events if event["event"] == "groups.changed"] == [
        {"event": "groups.changed"}
    ] * 5


async def test_registering_or_deleting_an_account_sends_no_groups_changed(
    party: Party, broadcast_events: list[dict[str, object]]
) -> None:
    broadcast_events.clear()
    registered = await party["anonymous"].post(
        "/api/v1/auth/register", json={"username": "newcomer", "password": "password123"}
    )
    assert registered.status_code == 201, registered.text
    await party["admin"].delete(f"/api/v1/users/{registered.json()['id']}")

    assert {"event": "groups.changed"} not in broadcast_events
    assert {"event": "players.changed"} in broadcast_events


async def test_one_log_line_per_write_naming_the_group_never_its_id(
    party: Party, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO, logger="ultrastar_wingman.auth")
    made = await make_group(party["admin"], "DJs", ["music.manage"])
    await party["admin"].patch(f"/api/v1/groups/{made['id']}", json={"name": "Music crew"})
    await party["admin"].patch(f"/api/v1/groups/{made['id']}", json={"capabilities": []})
    await put_in(party["admin"], party.ids["plain"], [made["id"], TRUSTED_GROUP_ID])
    await put_in(party["admin"], party.ids["plain"], [])
    await party["admin"].delete(f"/api/v1/groups/{made['id']}")

    lines = [
        record.getMessage()
        for record in caplog.records
        if record.name == "ultrastar_wingman.auth.groups"
    ]
    assert lines == [
        "Group 'DJs' created",
        "Group 'DJs' is now called 'Music crew'",
        "The rights of the group Music crew changed",
        "'plain-account' is in Music crew and Trusted now",
        "'plain-account' is in no group now",
        "Group 'Music crew' deleted",
    ]
    assert not any(made["id"] in line or TRUSTED_GROUP_ID in line for line in lines)
