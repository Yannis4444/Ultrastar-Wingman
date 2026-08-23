"""Content-level song identity: "is this the same song from a different source?".

The fingerprint is a normalized `artists|title` string, never a primary key
(that is the `<source>:<source_id>` song id). Format:

    "bruno&markronson|uptownfunk"

Artists are normalized individually, deduplicated and sorted, so
`Mark Ronson feat. Bruno Mars` and `Bruno Mars & Mark Ronson` collide on
purpose. Titles lose featured artists, trailing `(...)`/`[...]` groups and
trailing variant markers (`- Radio Edit`), so the same song from USDB and from
a local folder ends up with one fingerprint.
"""

import re
import unicodedata

# ',' / '&' always separate; ' x ' and ' + ' only with surrounding spaces (artists like
# "Xzibit" or "+44" must survive). Featured artists count as artists here — the title
# drops them instead, so "A feat. B - Song" and "B & A - Song" match.
_ARTIST_SEPARATORS = re.compile(r",|&|\s\+\s|\sx\s|\bfeat\b\.?|\bft\b\.?|\bfeaturing\b")
_FEATURE_MARKER = re.compile(r"\bfeat\b\.?|\bft\b\.?|\bfeaturing\b")
_TRAILING_GROUP = re.compile(r"[(\[][^()\[\]]*[)\]]\s*$")
_WORD = re.compile(r"\w+")

# A trailing " - <tail>" is only cut when the tail reads like a variant marker: real titles
# use the dash too ("Stone Cold - Sober" must not become "stonecold").
_VARIANT_MARKERS = frozenset(
    {
        "acoustic",
        "album",
        "club",
        "cover",
        "demo",
        "duet",
        "edit",
        "edition",
        "extended",
        "instrumental",
        "karaoke",
        "live",
        "mix",
        "original",
        "radio",
        "remaster",
        "remastered",
        "remix",
        "reprise",
        "single",
        "unplugged",
        "version",
    }
)


def fingerprint(artist: str, title: str) -> str:
    """Normalized `artists|title` identity of a song. Never empty-safe-guarded: two songs
    with unusable metadata legitimately share a fingerprint."""
    artists = {_alphanumeric(part) for part in _ARTIST_SEPARATORS.split(_prepare(artist))}
    return f"{'&'.join(sorted(artists - {''}))}|{_alphanumeric(_title_core(title))}"


def _prepare(value: str) -> str:
    # NFKC first: "Björk" and "Björk" are the same artist, as are full-width forms.
    return unicodedata.normalize("NFKC", value).casefold().strip()


def _title_core(title: str) -> str:
    without_groups = _strip_trailing_groups(_prepare(title))
    core = _FEATURE_MARKER.split(without_groups)[0]
    head, separator, tail = core.rpartition(" - ")
    if separator and _looks_like_variant(tail):
        return head
    return core


def _strip_trailing_groups(value: str) -> str:
    while True:
        stripped = _TRAILING_GROUP.sub("", value).strip()
        if stripped == value:
            return value
        value = stripped


def _looks_like_variant(tail: str) -> bool:
    return any(word in _VARIANT_MARKERS for word in _WORD.findall(tail))


def _alphanumeric(value: str) -> str:
    return "".join(character for character in value if character.isalnum())
