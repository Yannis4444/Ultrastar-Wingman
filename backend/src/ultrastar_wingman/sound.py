"""How loud Wingman's own sound is, on the screen that makes it.

Four volumes, one shape. `sound.master_volume` scales everything the host screen plays;
the other three are the per-kind trims under it — the background music, the song being
picked, the sound effects — so turning the party down is one number and "the music is
louder than the effects" stays true when you do. The host multiplies them
itself — the backend never works out an effective volume, because the two numbers are what a
reader adjusts and a single product would be a value nobody set.

None of it is about Ultrastar Deluxe. USDX plays a sing through its own mixer and Wingman
does not touch it; these are the background music, the song being picked and the sound
effects, which come out of the host browser's own audio elements and its Web Audio graph.

`sound.effects` is the switch for those effects: the achievements' whoosh and thud on the
host screen (docs/dev/sound-effects.md; the reel's ticks went on 2026-11-09, "too much"). It
rides the music state like the volumes do, so an open host page follows it without a reload.

`sound.reel_preview` is the other switch: whether the host screen plays the song being
picked at all — the reel's, from its landing, and one a selection was opened with, at once,
for as long as the singers are chosen. It was a `music.manage` option behind the player's
gear first; the user moved it to the Settings page (2026-09-12) because it is about the
reel, not about the background music, and its volume sits here. The key kept its name when
it grew to every selection (2026-10-22); the Settings page labels it *Song preview*.

A leaf on purpose: `settings.py` imports the keys and the validator from here, so this
module must never import the settings registry back — the same arrangement as
`karaoke.slots`, `downloads.video_quality` and `join_url`.
"""

MASTER_VOLUME = "sound.master_volume"
MUSIC_VOLUME = "sound.music_volume"
PREVIEW_VOLUME = "sound.preview_volume"
EFFECTS_VOLUME = "sound.effects_volume"
REEL_PREVIEW = "sound.reel_preview"
SOUND_EFFECTS = "sound.effects"

VOLUME_KEYS: frozenset[str] = frozenset(
    {MASTER_VOLUME, MUSIC_VOLUME, PREVIEW_VOLUME, EFFECTS_VOLUME}
)
# Every key this module owns. `music.service` caches all of them and `api.update_setting`
# refreshes that cache when one is written, so the TV follows a volume set on the Settings
# page without a restart, switching the song preview off ends one that is playing, and
# switching the sound effects off silences the next badge.
MUSIC_KEYS: frozenset[str] = VOLUME_KEYS | {REEL_PREVIEW, SOUND_EFFECTS}

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
