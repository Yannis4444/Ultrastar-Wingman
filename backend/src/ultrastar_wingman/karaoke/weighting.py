"""How much a song weighs in the reel: the two rules of docs/dev/reel-weighting.md.

*Fair wishes* — one wish of somebody who holds `n` wishes weighs `(1 + ln n) / n`, so all of
one person's wishes together weigh `1 + ln n`: the first few count almost fully, a long list
flattens out, and one more wish never lowers what somebody's wishes weigh together.

*Rest skipped songs* — a song the reel on the host screen landed on, and the room spun
past, weighs a fifth the moment it was spun and climbs back in a straight line to its full
weight after `REST_MINUTES`. Never zero: a song is never out of the pool.

A leaf: `settings.py` imports the keys from here, so this module imports nothing of
Wingman's — the `karaoke.slots` and `sound` arrangement.
"""

import math
from datetime import timedelta

FAIR_WISHES = "karaoke.fair_wishes"
REST_SKIPPED = "karaoke.rest_skipped_songs"

# What a song the reel just landed on weighs, as a share of its own weight.
REST_FLOOR = 0.2
# How long, in minutes, until a song the room passed over weighs what it did before.
REST_MINUTES = 30


def wish_weight(held: int) -> float:
    """What one wish weighs when its owner holds `held` wishes. Raises `ValueError` below
    one: an owner of a wish holds at least that wish."""
    if held < 1:
        raise ValueError(f"an owner of a wish holds at least one, not {held}")
    return (1 + math.log(held)) / held


def rest_factor(age: timedelta) -> float:
    """What a song spun `age` ago weighs, as a share of its own weight: `REST_FLOOR` at
    once, 1 from `REST_MINUTES` on. A negative age — a clock set back — counts as none."""
    minutes = min(max(age.total_seconds() / 60, 0.0), float(REST_MINUTES))
    return REST_FLOOR + (1 - REST_FLOOR) * minutes / REST_MINUTES
