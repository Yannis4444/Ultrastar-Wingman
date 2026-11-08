"""What a song weighs in the reel: the two numbers of docs/dev/reel-weighting.md, the rest
marks the host spins leave behind, and one long seeded run proving the shares the design
promises three wishers."""

import random
from collections import Counter
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from test_songs_api import make_song
from ultrastar_wingman.karaoke import reel, weighting
from ultrastar_wingman.library.model import Wish
from ultrastar_wingman.tags import service as tags


def test_one_wish_weighs_less_the_more_its_owner_holds() -> None:
    assert weighting.wish_weight(1) == 1.0
    assert weighting.wish_weight(3) == pytest.approx(0.69954, abs=1e-5)
    assert weighting.wish_weight(20) == pytest.approx(0.19979, abs=1e-5)


def test_all_of_one_owner_s_wishes_weigh_one_plus_the_log_of_how_many() -> None:
    """One more wish never lowers what somebody's wishes weigh together."""
    totals = [held * weighting.wish_weight(held) for held in range(1, 60)]
    assert totals == sorted(totals)
    assert totals[19] == pytest.approx(4.0, abs=0.01)


def test_an_owner_of_no_wish_is_no_owner() -> None:
    with pytest.raises(ValueError):
        weighting.wish_weight(0)


@pytest.mark.parametrize(
    ("minutes", "factor"),
    [(0, 0.2), (5, 0.33333), (20, 0.73333), (30, 1.0), (45, 1.0), (-5, 0.2)],
)
def test_a_skipped_song_climbs_back_to_full_weight_in_half_an_hour(
    minutes: float, factor: float
) -> None:
    """A fifth at once, a straight line to 1 at thirty minutes, 1 after; a clock set back
    counts as no time at all."""
    assert weighting.rest_factor(timedelta(minutes=minutes)) == pytest.approx(factor, abs=1e-5)


def test_a_mark_is_dropped_once_it_weighs_nothing_any_more() -> None:
    """`note_spun` keeps at most half an hour of songs, whatever the room did before."""
    start = datetime(2026, 11, 8, 21, 0, tzinfo=UTC)
    reel.note_spun("early", start)
    reel.note_spun("later", start + timedelta(minutes=10))

    reel.note_spun("now", start + timedelta(minutes=30))

    assert set(reel._spun_at) == {"later", "now"}
    reel.clear_spun("later")
    reel.clear_spun("never spun")
    assert set(reel._spun_at) == {"now"}
    reel.forget_spins()
    assert reel._spun_at == {}


# §3.2 of the design: A holds one wish, B three and C twenty, no song shared. Guests, so each
# cookie is its own owner.
WISHERS = {"a": 1, "b": 3, "c": 20}
# What one song of each wins over the whole pool: 1, 1 + ln 3 and 1 + ln 20 out of their sum.
EXPECTED_SHARES = {"a": 14.1, "b": 29.6, "c": 56.3}
PICKS = 10_000


async def three_wishers(session: AsyncSession) -> dict[str, str]:
    """The 24 wished songs, each owned by one wisher. Returns song id to wisher."""
    owners: dict[str, str] = {}
    for wisher, held in WISHERS.items():
        for number in range(held):
            song_id = f"local:{wisher}{number:02d}"
            session.add(make_song(song_id, wisher, song_id))
            session.add(Wish(song_id=song_id, guest_id=f"{wisher}-cookie"))
            owners[song_id] = wisher
    await session.commit()
    return owners


async def test_ten_thousand_weighted_spins_share_out_as_the_design_promises(
    session: AsyncSession,
) -> None:
    """Ten thousand weighted draws under one seed, over the weights the server works out
    for §3.2's three wishers: each wisher's songs land within a percentage point.

    The weights are read once, through the reel's own `_candidates`, and the ten thousand
    draws are the reel's own `_draw`; a seeded `pick_song` is shown to land exactly where
    `_draw` does, so the draws are what a spin does. Ten thousand whole `pick_song` calls
    would be ten thousand round trips to the database for the same weights — over a minute
    of the suite's time for nothing the one call does not already prove.
    """
    owners = await three_wishers(session)
    weights = await reel._candidates(session, "weighted", tags.GUEST_VIEWER, frozenset(), None)
    assert set(weights) == set(owners)
    random.seed(1108)
    song = await reel.pick_song(session, "weighted", tags.GUEST_VIEWER)
    random.seed(1108)
    assert song is not None and song.id == reel._draw(dict(weights))

    random.seed(20261108)
    landed = Counter(owners[reel._draw(weights)] for _ in range(PICKS))

    shares = {wisher: 100 * landed[wisher] / PICKS for wisher in WISHERS}
    for wisher, expected in EXPECTED_SHARES.items():
        assert shares[wisher] == pytest.approx(expected, abs=1.0), shares
