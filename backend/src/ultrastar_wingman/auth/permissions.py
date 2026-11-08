"""Capabilities, groups and the runtime-editable mapping between them.

Permission checks are named by capability, never by group (architecture.md): a group is a
bundle of capabilities, stored in `group_capabilities` and editable through the API, and
what a caller holds is the union of the bundles of the groups they are in
(docs/dev/permission-groups.md §3.2). The group → capabilities mapping is cached in this
module because every single request reads it; who is in which group is not cached, it is
read with the session on every request (§4).
"""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .model import Group, GroupCapability

logger = logging.getLogger(__name__)

# Every capability Wingman knows. Adding one means adding a `require(...)` somewhere and
# granting it to a group — a seed migration (permission-groups.md §8.4) puts it into the
# tables of a database that already exists.
CAPABILITIES: tuple[str, ...] = (
    "songs.view",
    "songs.rescan",
    "songs.edit",
    "songs.delete",
    "karaoke.sing",
    "karaoke.stop",
    "music.view",
    "music.control",
    "music.manage",
    "players.view",
    "players.avatar",
    "players.manage",
    "wishlist.view",
    "wishlist.add",
    "wishlist.manage",
    "playlists.view",
    "playlists.manage",
    "playlists.moderate",
    "tags.manage",
    "comments.write",
    "comments.moderate",
    "downloads.view",
    "downloads.manage",
    "usdb.search",
    "stats.view",
    "stats.history",
    "stats.manage",
    "stats.moderate",
    "stats.hide",
    "achievements.manage",
    "devices.manage",
    "settings.view",
    "settings.manage",
    "users.view",
    "users.manage",
    "permissions.manage",
)

ALL_CAPABILITIES = frozenset(CAPABILITIES)

# The three built-in groups. Their ids are words, which a group the host makes (a
# `uuid4().hex`) can never be; whether a group is built in is read off its id, never stored.
#
# * `guest` — every caller without an account, and nobody else.
# * `user` — every account, without a row in `user_groups`.
# * `admin` — the accounts with a row in it, and the host screen without one. Its members
#   hold every capability by rule, whatever `group_capabilities` says.
GUEST = "guest"
USER = "user"
ADMIN = "admin"

BUILT_IN_GROUPS: tuple[str, ...] = (GUEST, USER, ADMIN)

# The party's helpers. Created by migration 0039 with this exact id so the migration, the
# tag editor's default and the tests can name it — the `tags.model.BROKEN_TAG_ID`
# precedent — and otherwise an ordinary group: the host may rename, change or delete it.
TRUSTED_GROUP_ID = "7a1c4e9b2d6f48a3b5e0c8d1f2a3b4c5"

# The longest a group name may get — the tag name's bound.
MAX_GROUP_NAME_LENGTH = 32

# A party guest browses, wishes, sings and looks at the scoreboard — wishing is the whole
# point of the guest cookie.
_GUEST_CAPABILITIES = frozenset(
    {
        "songs.view",
        "players.view",
        "karaoke.sing",
        "wishlist.view",
        "wishlist.add",
        "playlists.view",
        "stats.view",
        # The background music is the room's own soundtrack, so what is playing is
        # something a party guest may simply see — like the scoreboard and the wishlist.
        "music.view",
    }
)
# Every account. An account does not inherit Guest's bundle (permission-groups.md §3.2), so
# User spells everything a guest may do out again. Only an account can own a playlist, so
# only an account may manage one. Reading the archive of past parties is an account's right
# too: `stats.view` is tonight's scoreboard, which a guest phone is welcome to, and
# `stats.history` is every party before it. Saying something about a song is an account's
# right too: a comment carries a name and a picture, and an anonymous phone has neither — it
# may read the conversation, not join it.
_USER_CAPABILITIES = _GUEST_CAPABILITIES | {
    "karaoke.stop",
    "playlists.manage",
    "stats.history",
    "comments.write",
    # Pausing the music, skipping the song or turning it down changes what the whole room
    # hears, which is exactly the weight `karaoke.stop` already carries: enough to want a
    # name behind it, not enough to be the host's alone.
    "music.control",
}
# The party's helpers (Trusted): naming a session, the download queue — and the rights over
# other people. Adding and deleting players used to be every account's right, which let
# anybody with an account delete anybody else's; changing your own picture never needed it
# (that is identity, like favorites), so nothing a plain account does is lost by moving it
# here. Spelled out with User's rights included, as the role it was: a member holds User's
# bundle anyway, and keeping Trusted's rows a superset of User's is what made migration 0039
# keep every helper's rights exactly.
_TRUSTED_CAPABILITIES = _USER_CAPABILITIES | {
    "players.manage",
    "players.avatar",
    "wishlist.manage",
    "users.view",
    "downloads.view",
    "downloads.manage",
    "usdb.search",
    "songs.rescan",
    # Fixing a wrong title or a missing year. It rewrites the song's txt, which is the file
    # USDX reads — but only its headers, and nothing it does is a deletion: the lyrics, the
    # media and the song's whole history are out of its reach. A helper who may add songs
    # to the library may as well correct the ones that came in wrong.
    "songs.edit",
    "stats.manage",
    # Tidying up the party's global playlists is a helper's job, not only the host's. It
    # never reaches a list the holder cannot already see, so it opens no private one.
    "playlists.moderate",
    # Creating a tag and saying who it is for. Not the right to *use* a tag: what one
    # person may put on a song is a `tag_permissions` row, granted per tag.
    "tags.manage",
    # Deleting somebody else's comment. Taking your own back needs no right at all — it is
    # your own words, like your favorites.
    "comments.moderate",
    # Switching the background music on, choosing what it plays from and how long the room
    # stays quiet after a song: a decision about the evening rather than about this song,
    # and the same weight as naming a party or making a tag.
    "music.manage",
}

# Nobody but an administrator: `songs.delete` erases a song folder from the disk, which no
# group below the host can undo — so it is in `CAPABILITIES` and in no bundle above. An
# administrator holds it because Admin is `ALL_CAPABILITIES` by rule, not because a set
# names it; the host can still hand it to Trusted in the group editor like any other right.
# `stats.moderate` is the second one: rewriting a recorded score's singer, or deleting the
# score outright, edits the party's own record after the fact. Renaming a party
# (`stats.manage`) changes a label; this changes what happened, so it starts with nobody.
# `achievements.manage` is the third: an achievement is written once and earned by everybody
# who ever sings, so editing one rewrites what the whole room has — a definition changed
# mid-party revokes badges from people who did nothing wrong, and a `hidden` one only stays a
# surprise while the few who may read it keep it. Reading the catalogue and a player's badges
# needs no capability at all: the host screen and every guest phone draw them.
# `stats.hide` is the fourth: it takes a party out of the Scores page's picker for *everybody*
# — a guest's phone included — so, like renaming, it is a decision about the party's shelf
# rather than about one reader's view. It is fully reversible and reaches that one list (see
# `stats.service.set_session_hidden`), so Trusted is a defensible home for it; it starts
# with the administrator all the same, because deciding which evenings the room still gets to
# look at is the host's call, and handing it to Trusted is one tick in its group editor.
# `devices.manage` is the fifth: a player selector device is trusted to say who sings. Its
# token is a standing key to the report endpoint, and the reader mapping decides which card
# puts which person on the TV, so whoever holds this capability can hand out a device that
# selects singers by itself. That is the host's own machine, not a helper's job.
# `users.manage` and `permissions.manage` start with Admin alone too; a helper given either
# is still held to the two rules of permission-groups.md §5 (`auth.groups`).

# What migrations 0006 to 0034 seeded per role, and 0039 copied into groups. Kept here as
# well so a test can prove the two never drift. No entry for Admin: it is a rule, not rows.
DEFAULT_GROUP_CAPABILITIES: dict[str, frozenset[str]] = {
    GUEST: _GUEST_CAPABILITIES,
    USER: _USER_CAPABILITIES,
    TRUSTED_GROUP_ID: _TRUSTED_CAPABILITIES,
}


class UnknownGroupError(LookupError):
    def __init__(self, group_id: str) -> None:
        super().__init__(f"unknown group '{group_id}'")
        self.group_id = group_id


class NotAssignableError(ValueError):
    """A group that exists but cannot be named here: User and Guest for a membership (every
    account is in User, nobody with one in Guest), Admin on a tag row (it sees every tag by
    rule, so a row for it would mean nothing)."""

    def __init__(self, group_id: str) -> None:
        super().__init__(f"the group '{group_id}' cannot be assigned here")
        self.group_id = group_id


class UnknownCapabilityError(LookupError):
    def __init__(self, capability: str) -> None:
        super().__init__(f"unknown capability '{capability}'")
        self.capability = capability


class AdminNotEditableError(ValueError):
    def __init__(self) -> None:
        super().__init__("Admin always holds every capability and cannot be changed")


class BuiltInGroupError(ValueError):
    def __init__(self, group_id: str) -> None:
        super().__init__(f"the built-in group '{group_id}' can be neither renamed nor deleted")
        self.group_id = group_id


# group id -> its capabilities, every group in the table and Admin set by rule. Read on every
# request; invalidated by every write that changes it (`auth.groups`). `None` means "not
# loaded".
_cache: dict[str, frozenset[str]] | None = None
# Moved by every invalidation. A load reads the tables across two awaits, and a write can
# commit and invalidate while it is suspended in them: a load that began before the
# invalidation answers its own caller but is never kept, or the rights from before the
# write — a capability just taken away included — would stand until the next write.
_generation = 0


def invalidate_cache() -> None:
    global _cache, _generation
    _cache = None
    _generation += 1


async def all_group_capabilities(session: AsyncSession) -> dict[str, frozenset[str]]:
    """The full mapping, one query per process until it is invalidated."""
    global _cache
    if _cache is None:
        generation = _generation
        loaded: dict[str, set[str]] = {
            group_id: set() for group_id in await session.scalars(select(Group.id))
        }
        for row in await session.scalars(select(GroupCapability)):
            # A capability that was dropped from the code stays in the table until the row
            # is rewritten; ignoring it keeps an old database usable. A row naming a group
            # that is gone (no foreign keys) gives nothing to anybody.
            if row.capability in ALL_CAPABILITIES and row.group_id in loaded:
                loaded[row.group_id].add(row.capability)
        # Admin is not data: a wrong row (or a hand-edited database) must never be able to
        # lock every administrator out of the app.
        loaded[ADMIN] = set(ALL_CAPABILITIES)
        mapping = {group_id: frozenset(capabilities) for group_id, capabilities in loaded.items()}
        if generation == _generation:
            _cache = mapping
        return mapping
    return _cache


async def capabilities_for_groups(session: AsyncSession, groups: frozenset[str]) -> frozenset[str]:
    """What a caller in `groups` holds: the union of their bundles, every capability the
    moment Admin is among them. A stale group id contributes nothing rather than raising —
    a hand-edited row must not turn into a 500."""
    if ADMIN in groups:
        return ALL_CAPABILITIES
    mapping = await all_group_capabilities(session)
    held: set[str] = set()
    for group_id in groups:
        held |= mapping.get(group_id, frozenset())
    return frozenset(held)
