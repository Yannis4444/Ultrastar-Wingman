"""The reel: the one place Wingman picks a song for somebody.

Two callers, one picker. A phone that spins the reel on the host screen and the player
selector's start button at a quiet room both hand the pick to `pick_song`, so what "a
random song out of the wishlist" means cannot drift between the two — and the phone's own
reel (the animation on the Random song page, which picks locally) documents the same rules,
in `docs/user/party/reel.md`.

Who is asking matters twice. Every scope leaves out the songs the viewer may not see at all
(`tags.hidden_song_ids`: a tag whose `view_songs` they do not hold), because a song hidden
from somebody must not be handed to them by a spin. *All songs* also leaves out the songs a
tag folds away for them (`tags.folded_song_ids`): the reel is the song list in another shape,
and the list keeps those back until somebody asks. The other scopes are what people picked
out by hand — a heart, a wish, a place on a playlist — and a folded-away song somebody asked
for on purpose stays in the running.

Knows nothing about FastAPI, and imports nothing of the selection: the selection calls this.
"""

import logging
import random
from typing import get_args

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..library import service as library
from ..library.model import Favorite, PlaylistEntry
from ..songs.model import Song
from ..tags import service as tags
from .schema import Scope

logger = logging.getLogger(__name__)

SCOPES: tuple[str, ...] = get_args(Scope)


def parse_scope(value: str) -> Scope:
    """A stored or typed scope as the type. Raises `ValueError` for anything that is not
    one, which is what a hand-edited settings row would be."""
    if value == "all":
        return "all"
    if value == "favorites":
        return "favorites"
    if value == "wishlist":
        return "wishlist"
    if value == "weighted":
        return "weighted"
    if value == "playlist":
        return "playlist"
    raise ValueError(f"unknown reel scope '{value}'")


async def pick_song(
    session: AsyncSession,
    scope: Scope,
    viewer: tags.Viewer,
    *,
    playlist_id: str | None = None,
    exclude: frozenset[str] = frozenset(),
    require_audio: bool = False,
) -> Song | None:
    """One song out of `scope`, or None when there is nothing to pick from.

    `favorites` needs an account behind `viewer` and answers None without one, like it does
    for an account that has hearted nothing. `weighted` is the wishlist with every song in
    the running as many times as it was wished for. `playlist` is the entries of
    `playlist_id`, None for a playlist that is gone or empty; whether the viewer may *see*
    that playlist is the caller's question, not this one's — the device sings from whatever
    playlist the host configured, and a phone is checked at the door.

    `exclude` is songs this caller does not want back — the background music passes the song
    that just played, so a small pool alternates instead of repeating. `require_audio`
    leaves out the songs with no audio file at all, which the background music cannot play
    and which a spin would simply hand to Ultrastar Deluxe. Both default to what every
    caller before them asked for.

    The candidates are sorted before the choice, so a seeded random number generator picks
    the same song twice: a choice out of whatever order SQLite felt like is not one anybody
    could reproduce.
    """
    hidden = await tags.hidden_song_ids(session, viewer)
    if require_audio:
        hidden = hidden | await _songs_without_audio(session)
    if exclude:
        hidden = hidden | exclude
    candidates = await _candidates(session, scope, viewer, hidden, playlist_id)
    if not candidates:
        return None
    return await session.get(Song, random.choice(sorted(candidates)))


async def _songs_without_audio(session: AsyncSession) -> frozenset[str]:
    """The songs no screen could play: the txt named no audio file, or the scan could not
    find the one it named. Subtracted like a hidden song, so every scope drops them at once
    rather than each branch remembering to."""
    return frozenset(await session.scalars(select(Song.id).where(Song.audio_file.is_(None))))


async def top_wish(session: AsyncSession, viewer: tags.Viewer) -> Song | None:
    """The song the room wished for most, as the viewer may see it.

    `library.service`'s own ordering and nothing of its own: the start button and the
    wishlist on everybody's phone have to agree about what "most wished for" means.
    """
    hidden = await tags.hidden_song_ids(session, viewer)
    wishes = await library.wishlist(session, None, None, hidden)
    if not wishes:
        return None
    return await session.get(Song, wishes[0].song.id)


async def _candidates(
    session: AsyncSession,
    scope: Scope,
    viewer: tags.Viewer,
    hidden: frozenset[str],
    playlist_id: str | None,
) -> list[str]:
    """The song ids in the running, a song more than once where it counts more than once.
    Nothing here is sorted; `pick_song` does that once."""
    if scope == "all":
        folded = await tags.folded_song_ids(session, viewer)
        return [
            song_id
            for song_id in await session.scalars(select(Song.id))
            if song_id not in hidden and song_id not in folded
        ]
    if scope == "favorites":
        if viewer.user_id is None:
            return []
        # Joined against `songs`: a heart survives its song leaving the library, and the
        # phone's favorites pool is the library filtered by the hearts, so it never sees one.
        return [
            song_id
            for song_id in await session.scalars(
                select(Favorite.song_id)
                .join(Song, Song.id == Favorite.song_id)
                .where(Favorite.user_id == viewer.user_id)
            )
            if song_id not in hidden
        ]
    if scope in ("wishlist", "weighted"):
        wishes = await library.wishlist(session, None, None, hidden)
        if scope == "wishlist":
            return [wish.song.id for wish in wishes]
        return [wish.song.id for wish in wishes for _ in range(wish.count)]
    if playlist_id is None:
        return []
    return [
        song_id
        for song_id in await session.scalars(
            select(PlaylistEntry.song_id)
            .join(Song, Song.id == PlaylistEntry.song_id)
            .where(PlaylistEntry.playlist_id == playlist_id)
        )
        if song_id not in hidden
    ]
