"""The reel: the one place Wingman picks a song for somebody.

Three callers, one picker. The selection — a phone that spins the reel on the host screen,
and through it the player selector's start button at a quiet room — and the background
music all hand the pick to `pick_song`, so what "a random song out of the wishlist" means
cannot drift between them — and the phone's own reel (the animation on the Random song
page, which picks locally) documents the same rules, in `docs/user/party/reel.md`, and draws
*Wishlist (weighted)* with the very weights this module draws with (`WishRead.weight`).

Every pick is one weighted draw over the candidates sorted (docs/dev/reel-weighting.md).
A song weighs 1 in every scope but *Wishlist (weighted)*, where it weighs what its wishes
weigh: with `karaoke.fair_wishes` on, each further wish of the same person counts a little
less (`weighting.wish_weight`), off, one per wish. And a host spin — the selection's, never
the music's — passes `rest_at`: then, with `karaoke.rest_skipped_songs` on, a song the reel
landed on within the last half hour (`note_spun`, cleared by `clear_spun` once it is sung)
weighs `weighting.rest_factor` of that, a fifth right after and never nothing. The marks
are module state, like the selection itself: a restart forgets at most half an hour.

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
from datetime import datetime, timedelta
from typing import get_args

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..library import service as library
from ..library.model import Favorite, PlaylistEntry
from ..settings import SettingsService
from ..songs.model import Song
from ..tags import service as tags
from .schema import Scope
from .weighting import REST_MINUTES, REST_SKIPPED, rest_factor

logger = logging.getLogger(__name__)

SCOPES: tuple[str, ...] = get_args(Scope)

# Song id to the last time the reel on the host screen landed on it, for as long as it
# still weighs less for that (`REST_MINUTES`). Module state, not a column: a mood that lasts
# half an hour needs no migration, and a restart forgets at most that half hour.
_spun_at: dict[str, datetime] = {}


def note_spun(song_id: str, at: datetime) -> None:
    """The reel on the host screen landed on `song_id` at `at`. Called once the selection
    carries the song, never from `pick_song`: a pick the slots then refused was never
    shown. Drops every mark that has run out by `at`, so this never holds more than half an
    hour of songs."""
    cutoff = at - timedelta(minutes=REST_MINUTES)
    for stale in [key for key, spun in _spun_at.items() if spun <= cutoff]:
        del _spun_at[stale]
    _spun_at[song_id] = at


def clear_spun(song_id: str) -> None:
    """The song is being sung: the room chose it, so it was not passed over."""
    _spun_at.pop(song_id, None)


def forget_spins() -> None:
    """Every mark gone — for the tests, whose clock and songs are their own."""
    _spun_at.clear()


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
    rest_at: datetime | None = None,
) -> Song | None:
    """One song out of `scope`, or None when there is nothing to pick from.

    `favorites` needs an account behind `viewer` and answers None without one, like it does
    for an account that has hearted nothing. `weighted` is the wishlist with every song
    weighing what its wishes weigh (`WishRead.weight`: each further wish of one person a
    little less while `karaoke.fair_wishes` is on, one per wish while it is off). Every
    other scope weighs each song the same. `playlist` is the entries of
    `playlist_id`, None for a playlist that is gone or empty; whether the viewer may *see*
    that playlist is the caller's question, not this one's — the device sings from whatever
    playlist the host configured, and a phone is checked at the door.

    `exclude` is songs this caller does not want back — the background music passes the song
    that just played, so a small pool alternates instead of repeating. `require_audio`
    leaves out the songs with no audio file at all, which the background music cannot play
    and which a spin would simply hand to Ultrastar Deluxe. Both default to what every
    caller before them asked for.

    `rest_at` is what a host spin passes, the time it spins at: while
    `karaoke.rest_skipped_songs` is on, a song the reel landed on (`note_spun`) and nobody
    sang since weighs `weighting.rest_factor` of its weight — less, never nothing. The
    background music and every other caller pass none.

    One weighted draw over the candidates sorted, so a seeded random number generator picks
    the same song twice: a choice out of whatever order SQLite felt like is not one anybody
    could reproduce.
    """
    hidden = await tags.hidden_song_ids(session, viewer)
    if require_audio:
        hidden = hidden | await _songs_without_audio(session)
    if exclude:
        hidden = hidden | exclude
    weights = await _candidates(session, scope, viewer, hidden, playlist_id)
    if not weights:
        return None
    if rest_at is not None and _spun_at and await SettingsService(session).get(REST_SKIPPED):
        for song_id, spun in _spun_at.items():
            if song_id in weights:
                weights[song_id] *= rest_factor(rest_at - spun)
    return await session.get(Song, _draw(weights))


def _draw(weights: dict[str, float]) -> str:
    """One song id out of `weights`, each as likely as its weight. Sorted first, so a seeded
    generator lands where it landed before; never handed an empty pool."""
    ids = sorted(weights)
    return random.choices(ids, weights=[weights[song_id] for song_id in ids], k=1)[0]


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
) -> dict[str, float]:
    """The song ids in the running, each with what it weighs: 1 everywhere but on
    `weighted`, where it is the song's `WishRead.weight`. Nothing here is sorted;
    `pick_song` does that once."""
    if scope == "all":
        folded = await tags.folded_song_ids(session, viewer)
        return {
            song_id: 1.0
            for song_id in await session.scalars(select(Song.id))
            if song_id not in hidden and song_id not in folded
        }
    if scope == "favorites":
        if viewer.user_id is None:
            return {}
        # Joined against `songs`: a heart survives its song leaving the library, and the
        # phone's favorites pool is the library filtered by the hearts, so it never sees one.
        return {
            song_id: 1.0
            for song_id in await session.scalars(
                select(Favorite.song_id)
                .join(Song, Song.id == Favorite.song_id)
                .where(Favorite.user_id == viewer.user_id)
            )
            if song_id not in hidden
        }
    if scope in ("wishlist", "weighted"):
        wishes = await library.wishlist(session, None, None, hidden)
        if scope == "wishlist":
            return {wish.song.id: 1.0 for wish in wishes}
        return {wish.song.id: wish.weight for wish in wishes}
    if playlist_id is None:
        return {}
    return {
        song_id: 1.0
        for song_id in await session.scalars(
            select(PlaylistEntry.song_id)
            .join(Song, Song.id == PlaylistEntry.song_id)
            .where(PlaylistEntry.playlist_id == playlist_id)
        )
        if song_id not in hidden
    }
