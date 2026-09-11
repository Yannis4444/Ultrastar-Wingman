"""How loud Wingman's own sound is, on the screen that makes it.

Three settings, one shape. `sound.master_volume` scales everything the host screen plays;
the other two are the per-kind trims under it, so turning the party down is one number and
"the music is louder than the effects" stays true when you do. The host multiplies them
itself — the backend never works out an effective volume, because the two numbers are what a
reader adjusts and a single product would be a value nobody set.

None of it is about Ultrastar Deluxe. USDX plays a sing through its own mixer and Wingman
does not touch it; these are the background music and (later) the sound effects, which come
out of the host browser's own audio element.

A leaf on purpose: `settings.py` imports the keys and the validator from here, so this
module must never import the settings registry back — the same arrangement as
`karaoke.slots`, `downloads.video_quality` and `join_url`.
"""

MASTER_VOLUME = "sound.master_volume"
MUSIC_VOLUME = "sound.music_volume"
EFFECTS_VOLUME = "sound.effects_volume"

# Every key this module owns. `music.service` refreshes its cache when one of them is
# written, so the TV follows a volume set on the Settings page without a restart.
VOLUME_KEYS: frozenset[str] = frozenset({MASTER_VOLUME, MUSIC_VOLUME, EFFECTS_VOLUME})

MIN_VOLUME = 0
MAX_VOLUME = 100


def validate_volume(value: object) -> None:
    """A percentage. Raises `ValueError` with a sentence that reads as a hint under the
    field, which is what the settings API answers a bad write with."""
    # `bool` is an `int` in Python and the registry would widen it; a checkbox is not a
    # volume, and "True percent" is not a thing to store.
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("a whole number of percent")
    if not MIN_VOLUME <= value <= MAX_VOLUME:
        raise ValueError(f"between {MIN_VOLUME} and {MAX_VOLUME} percent")
