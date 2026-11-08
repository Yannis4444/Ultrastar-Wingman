"""Song comments: who may read them, who may write one, and who may take one away.

Reading is `songs.view`, so a guest phone reads the conversation under a song. Writing
takes an account — `comments.write` *and* a user behind the session, which the host screen
is not. Deleting is the author's own right, and `comments.moderate` over anybody's.

The interesting half is the delete: the author-or-moderator check runs *before* the comment
is looked up, so a caller who may delete nothing cannot tell a real comment id from a
made-up one by the status code.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from conftest import BASE_URL, IDENTITY_GROUPS, add_session, add_user
from test_wishlist_api import OTHER_SONG, SONG, add_songs, factory
from ultrastar_wingman.app import create_app
from ultrastar_wingman.auth.deps import COOKIE_NAME
from ultrastar_wingman.comments.model import MAX_BODY_LENGTH, SongComment
from ultrastar_wingman.config import BootstrapSettings
from ultrastar_wingman.players.model import Player
from ultrastar_wingman.tags.model import BROKEN_TAG_ID

# The accounts in the fixture. `other` is a second plain account, so "somebody else's
# comment" is a plain user's comment and not a helper's.
ACCOUNTS = ("user", "other", "trusted", "admin")
# The groups each account is in: `other` is a second plain account.
GROUPS_OF = {**IDENTITY_GROUPS, "other": IDENTITY_GROUPS["user"]}


@dataclass
class Party:
    """One app, one client per identity — never two lifespans, they fight over the scanner."""

    app: FastAPI
    clients: dict[str, AsyncClient]
    ids: dict[str, str]
    avatars: Path

    def __getitem__(self, identity: str) -> AsyncClient:
        return self.clients[identity]


def _client(app: FastAPI, token: str | None = None) -> AsyncClient:
    cookies = {} if token is None else {COOKIE_NAME: token}
    return AsyncClient(transport=ASGITransport(app=app), base_url=BASE_URL, cookies=cookies)


@pytest.fixture
async def party(bootstrap_settings: BootstrapSettings) -> AsyncIterator[Party]:
    app = create_app(bootstrap_settings)
    avatars = bootstrap_settings.data_dir / "avatars"
    avatars.mkdir(parents=True, exist_ok=True)
    async with app.router.lifespan_context(app):
        await add_songs(app, SONG, OTHER_SONG)
        clients = {"anonymous": _client(app)}
        ids: dict[str, str] = {}
        for name in ACCOUNTS:
            ids[name] = await add_user(factory(app), f"{name}-account", groups=GROUPS_OF[name])
            await add_session(factory(app), f"{name}-token", ids[name])
            clients[name] = _client(app, f"{name}-token")
        # The host screen: an administrator by device, with no account behind it.
        await add_session(factory(app), "host-token", None, is_host=True)
        clients["host"] = _client(app, "host-token")
        try:
            yield Party(app=app, clients=clients, ids=ids, avatars=avatars)
        finally:
            for client in clients.values():
                await client.aclose()


async def add_player(party: Party, identity: str, name: str, with_avatar: bool) -> str:
    """Give an account the player it would have got by registering — that is where the
    picture beside a comment comes from."""
    avatar = None
    if with_avatar:
        avatar = party.avatars / f"{identity}.png"
        avatar.write_bytes(b"not really a png")
    async with factory(party.app)() as session:
        player = Player(
            name=name,
            registered=True,
            user_id=party.ids[identity],
            avatar_file=None if avatar is None else str(avatar),
        )
        session.add(player)
        await session.commit()
        return player.id


async def comments_of(client: AsyncClient, song_id: str = SONG) -> list[dict[str, Any]]:
    response = await client.get(f"/api/v1/songs/{song_id}/comments")
    assert response.status_code == 200, response.text
    rows: list[dict[str, Any]] = response.json()["comments"]
    return rows


async def say(
    client: AsyncClient, body: str, song_id: str = SONG, expect: int = 201
) -> dict[str, Any]:
    response = await client.post(f"/api/v1/songs/{song_id}/comments", json={"body": body})
    assert response.status_code == expect, response.text
    created: dict[str, Any] = response.json()
    return created


async def hide_song(party: Party, song_id: str = SONG) -> None:
    """Mark the song broken, which is the seeded tag no guest and no plain account holds
    `view_songs` on — so the song is not there as far as they are concerned."""
    response = await party["trusted"].put(f"/api/v1/songs/{song_id}/tags/{BROKEN_TAG_ID}")
    assert response.status_code == 204, response.text


async def test_a_comment_carries_its_author_and_is_listed_oldest_first(party: Party) -> None:
    player_id = await add_player(party, "user", "Yannis", with_avatar=True)
    await add_player(party, "other", "Jörg", with_avatar=False)

    first = await say(party["user"], "Best duet of the night")
    second = await say(party["other"], "Only if you can hit the note")

    rows = await comments_of(party["anonymous"])
    assert [row["id"] for row in rows] == [first["id"], second["id"]]
    assert [row["body"] for row in rows] == [
        "Best duet of the night",
        "Only if you can hit the note",
    ]
    assert rows[0]["song_id"] == SONG
    author = rows[0]["author"]
    assert author["user_id"] == party.ids["user"]
    assert author["username"] == "user-account"
    assert author["player_id"] == player_id
    # A real cache buster, not a placeholder: it is the picture file's modification time,
    # the same one `PlayerRead` carries.
    assert isinstance(author["avatar_version"], int)
    # An account whose player never got a picture has no version to bust.
    assert rows[1]["author"]["avatar_version"] is None
    # Serialized with the UTC offset SQLite dropped on write.
    assert rows[0]["created_at"].endswith("Z")


async def test_an_account_with_no_player_still_has_a_name(party: Party) -> None:
    await say(party["user"], "No player, still an opinion")

    author = (await comments_of(party["user"]))[0]["author"]

    assert author["username"] == "user-account"
    assert author["player_id"] is None
    assert author["avatar_version"] is None


async def test_the_flags_say_whose_comment_it_is(party: Party) -> None:
    await say(party["user"], "Mine")

    async def flags(identity: str) -> tuple[bool, bool]:
        row = (await comments_of(party[identity]))[0]
        return row["mine"], row["can_delete"]

    assert await flags("user") == (True, True)
    # Another plain account may read it and nothing else.
    assert await flags("other") == (False, False)
    assert await flags("anonymous") == (False, False)
    # A moderator did not write it but may take it away.
    assert await flags("trusted") == (False, True)
    assert await flags("admin") == (False, True)
    # The host screen is an administrator but nobody, so it owns no comment.
    assert await flags("host") == (False, True)


async def test_a_comment_belongs_to_one_song(party: Party) -> None:
    await say(party["user"], "About this one")
    await say(party["user"], "About the other one", song_id=OTHER_SONG)

    assert [row["body"] for row in await comments_of(party["user"])] == ["About this one"]
    assert [row["body"] for row in await comments_of(party["user"], OTHER_SONG)] == [
        "About the other one"
    ]


async def test_an_anonymous_reader_may_not_comment(party: Party) -> None:
    response = await party["anonymous"].post(
        f"/api/v1/songs/{SONG}/comments", json={"body": "Anonymous applause"}
    )

    assert response.status_code == 403
    assert response.json() == {"detail": "missing_permission:comments.write"}


async def test_the_host_screen_has_no_name_to_sign_with(party: Party) -> None:
    """An administrator by device, but nobody: the capability is there, the account is not."""
    response = await party["host"].post(f"/api/v1/songs/{SONG}/comments", json={"body": "From TV"})

    assert response.status_code == 401
    assert response.json() == {"detail": "not_authenticated"}


@pytest.mark.parametrize("body", ["", "   ", "\n\t "])
async def test_an_empty_comment_is_refused(party: Party, body: str) -> None:
    await say(party["user"], body, expect=422)


async def test_the_body_is_stripped_and_bounded(party: Party) -> None:
    assert (await say(party["user"], "  spaces around  "))["body"] == "spaces around"
    assert len((await say(party["user"], "x" * MAX_BODY_LENGTH))["body"]) == MAX_BODY_LENGTH
    await say(party["user"], "x" * (MAX_BODY_LENGTH + 1), expect=422)


async def test_the_author_takes_their_own_comment_back(party: Party) -> None:
    comment = await say(party["user"], "Actually, never mind")

    response = await party["user"].delete(f"/api/v1/songs/{SONG}/comments/{comment['id']}")

    assert response.status_code == 204, response.text
    assert await comments_of(party["user"]) == []


async def test_another_account_may_not_delete_it(party: Party) -> None:
    comment = await say(party["user"], "Stays put")

    response = await party["other"].delete(f"/api/v1/songs/{SONG}/comments/{comment['id']}")

    assert response.status_code == 403
    assert response.json() == {"detail": "missing_permission:comments.moderate"}
    assert len(await comments_of(party["user"])) == 1


async def test_a_moderator_deletes_anybodys_comment(party: Party) -> None:
    comment = await say(party["user"], "Out of line")

    response = await party["trusted"].delete(f"/api/v1/songs/{SONG}/comments/{comment['id']}")

    assert response.status_code == 204, response.text
    assert await comments_of(party["user"]) == []


async def test_an_unknown_comment_id_tells_a_plain_account_nothing(party: Party) -> None:
    """403 before 404: the check runs before the lookup, so the status code cannot be used
    to find out which comment ids exist. A moderator was going to be told either way."""
    refused = await party["user"].delete(f"/api/v1/songs/{SONG}/comments/999999")
    assert refused.status_code == 403
    assert refused.json() == {"detail": "missing_permission:comments.moderate"}

    unknown = await party["trusted"].delete(f"/api/v1/songs/{SONG}/comments/999999")
    assert unknown.status_code == 404


async def test_a_comment_of_another_song_is_unknown_here(party: Party) -> None:
    comment = await say(party["user"], "About the other one", song_id=OTHER_SONG)

    response = await party["user"].delete(f"/api/v1/songs/{SONG}/comments/{comment['id']}")

    assert response.status_code == 404
    assert len(await comments_of(party["user"], OTHER_SONG)) == 1


async def test_a_hidden_song_has_no_comments_to_speak_of(party: Party) -> None:
    """A song a tag keeps back answers exactly like one that was never there — a 403 would
    confirm it exists. The comment is written before the tag goes on, so the delete below
    is the author's own and reaches the song check rather than the permission one."""
    comment = await say(party["user"], "Written while it was visible")
    await hide_song(party)

    assert (await party["user"].get(f"/api/v1/songs/{SONG}/comments")).status_code == 404
    assert (
        await party["user"].post(f"/api/v1/songs/{SONG}/comments", json={"body": "Hello?"})
    ).status_code == 404
    assert (
        await party["user"].delete(f"/api/v1/songs/{SONG}/comments/{comment['id']}")
    ).status_code == 404
    assert (await party["anonymous"].get(f"/api/v1/songs/{SONG}/comments")).status_code == 404

    # Whoever may see the song sees the conversation under it, and may end it.
    assert [row["body"] for row in await comments_of(party["trusted"])] == [
        "Written while it was visible"
    ]
    assert (
        await party["trusted"].delete(f"/api/v1/songs/{SONG}/comments/{comment['id']}")
    ).status_code == 204


async def test_deleting_the_account_takes_its_comments_with_it(party: Party) -> None:
    """Unlike a score's player or a `song_tags` row's author, a comment carries the
    account's name and its words, so it does not outlive it."""
    await say(party["user"], "Signed with my name")
    await say(party["other"], "And mine")

    deleted = await party["admin"].delete(f"/api/v1/users/{party.ids['user']}")

    assert deleted.status_code == 204, deleted.text
    assert [row["body"] for row in await comments_of(party["admin"])] == ["And mine"]
    async with factory(party.app)() as session:
        assert list(await session.scalars(select(SongComment.user_id))) == [party.ids["other"]]


async def test_the_changes_are_broadcast(
    party: Party, broadcast_events: list[dict[str, object]]
) -> None:
    first = await say(party["user"], "One")
    await say(party["other"], "Two")
    await party["trusted"].delete(f"/api/v1/songs/{SONG}/comments/{first['id']}")

    assert broadcast_events == [
        {"event": "comments.changed", "song_id": SONG, "count": 1},
        {"event": "comments.changed", "song_id": SONG, "count": 2},
        {"event": "comments.changed", "song_id": SONG, "count": 1},
    ]
