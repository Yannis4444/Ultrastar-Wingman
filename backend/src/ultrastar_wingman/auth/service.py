"""Accounts, sessions and the host token. Knows nothing about FastAPI."""

import hashlib
import logging
import secrets
from collections.abc import Sequence
from datetime import timedelta
from typing import Annotated

from pydantic import StringConstraints
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..comments import service as comments
from ..library import service as library
from ..players import service as players
from ..players.model import Player
from ..tags import service as tags
from .groups import AdminRequiredError, LastAdminError, admin_count, groups_of
from .model import User, UserGroup, UserSession, as_utc, utcnow
from .permissions import ADMIN
from .providers import LOCAL, OIDC, find_by_username, hash_password
from .schema import UserRead, read_user

logger = logging.getLogger(__name__)

# A karaoke party host should not have to log in again next weekend.
SESSION_TTL = timedelta(days=90)

# The sliding expiry is refreshed at most this often: every request would otherwise write
# to the database just to read.
TOUCH_INTERVAL = timedelta(hours=1)

MIN_PASSWORD_LENGTH = 8

# Same bounds as a player name. Every name somebody types is held to them; a name derived
# from an OIDC token is cut to fit rather than refused, because nobody typed it.
MIN_USERNAME_LENGTH = 3
MAX_USERNAME_LENGTH = 32

# The one rule for a name a person chose, wherever they chose it: registering, and naming
# the account an OIDC login is about to create. It lives here, with the bounds it wraps,
# because `auth/api.py` and `auth/oidc.py` both need it and the second cannot import the
# first (the first is what mounts the second's router).
Username = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=MIN_USERNAME_LENGTH,
        max_length=MAX_USERNAME_LENGTH,
    ),
]

# Shortest prefix `find_users_by_prefix` answers, and the most matches it returns. One
# letter would hand back most of the party for nothing.
MIN_LOOKUP_LENGTH = 2
LOOKUP_LIMIT = 20


class DuplicateUsernameError(ValueError):
    def __init__(self, username: str) -> None:
        super().__init__(f"'{username}' is taken")
        self.username = username


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(raw_token: str) -> str:
    """Sessions are looked up by hash, so the raw cookie value is never stored. Plain
    sha256 is enough: the token is 256 bits of randomness, not a guessable password."""
    return hashlib.sha256(raw_token.encode()).hexdigest()


class HostToken:
    """The one-time token that turns the browser Wingman opened into a trusted admin.

    Lives in memory only (a restart mints a new one) and is consumed by the first
    successful exchange, so the URL in the log or the shell history is worthless afterwards.
    """

    def __init__(self) -> None:
        self._token: str | None = new_token()

    @property
    def unused(self) -> str | None:
        return self._token

    def consume(self, candidate: str) -> bool:
        if self._token is None:
            logger.info("The host link was opened again: it works only once")
            return False
        # compare_digest: the token is a secret, so no early-exit comparison. Encoded first
        # because compare_digest raises TypeError on a non-ASCII str — a client sending
        # {"token": "ö"} would get a 500 instead of a 401.
        if not secrets.compare_digest(self._token.encode(), candidate.encode()):
            logger.info("A host link with a wrong token was refused")
            return False
        self._token = None
        logger.info("The host link was used: that browser is the host screen now")
        return True


def host_url(port: int, token: str) -> str:
    """Where the host UI has to be opened for the token to be exchanged. Always localhost:
    the point of the token is that it reaches the machine USDX runs on."""
    return f"http://localhost:{port}/host?hostToken={token}"


async def start_session(
    session: AsyncSession, user_id: str | None = None, is_host: bool = False
) -> str:
    """Create a session and return its raw token — the only time it exists in clear."""
    if user_id is not None:
        # Every way into an account ends here — registering, logging in locally, coming back
        # from the identity provider — so this is the one place "if a player logs in, unhide
        # them" has to live. The host token creates a session with no account and no player,
        # and hides nothing.
        await players.unhide_player_of_user(session, user_id)
    raw_token = new_token()
    now = utcnow()
    session.add(
        UserSession(
            token_hash=token_hash(raw_token),
            user_id=user_id,
            is_host=is_host,
            created_at=now,
            last_seen_at=now,
            expires_at=now + SESSION_TTL,
        )
    )
    await session.commit()
    return raw_token


async def lookup_session(session: AsyncSession, raw_token: str) -> UserSession | None:
    """The session behind a cookie value, or None when it is unknown or expired. An expired
    row is dropped on the way past, which is the only cleanup sessions need."""
    row = await session.get(UserSession, token_hash(raw_token))
    if row is None:
        return None
    if as_utc(row.expires_at) <= utcnow():
        await session.delete(row)
        await session.commit()
        return None
    return row


async def touch_session(session: AsyncSession, row: UserSession) -> None:
    """Slide the expiry forward, at most once per `TOUCH_INTERVAL`."""
    now = utcnow()
    if now - as_utc(row.last_seen_at) < TOUCH_INTERVAL:
        return
    row.last_seen_at = now
    row.expires_at = now + SESSION_TTL
    await session.commit()


async def end_session(session: AsyncSession, raw_token: str) -> bool:
    row = await session.get(UserSession, token_hash(raw_token))
    if row is None:
        return False
    user = None if row.user_id is None else await session.get(User, row.user_id)
    # Read before the commit: the row is gone afterwards.
    who = f"'{user.username}'" if user is not None else "A host browser" if row.is_host else None
    await session.delete(row)
    await session.commit()
    if who is not None:
        logger.info("%s logged out", who)
    return True


async def register_user(session: AsyncSession, username: str, password: str) -> User:
    """Create an account and the player it sings as.

    The very first account is the administrator — there is nobody who could grant it.
    Raises `DuplicateUsernameError`.
    """
    username = username.strip()
    if await find_by_username(session, username) is not None:
        raise DuplicateUsernameError(username)

    first = await _is_first_account(session)
    user = User(
        username=username,
        password_hash=hash_password(password),
        auth_provider=LOCAL,
    )
    session.add(user)
    try:
        # The whole write, not the commit alone: the account row goes in at the `flush`
        # below, so `lower(username)` refuses a name taken since the check above *there*,
        # while the player row goes in at the commit and `lower(name)` refuses it there.
        await session.flush()
        _groups_for_new_user(session, user, first)
        await _attach_player(session, user)
        await session.commit()
    except IntegrityError as error:
        # The unique indexes on lower(username) / lower(name) are the authority, so two
        # simultaneous registrations cannot both win. The loser reads the refusal the
        # check above would have given it a moment earlier.
        await session.rollback()
        raise DuplicateUsernameError(username) from error
    logger.info("'%s' registered an account%s", user.username, _first_tail(first))
    # A new player, or a guest's one turned into the account's.
    await players.announce_players()
    return user


async def upsert_oidc_user(session: AsyncSession, subject: str, username: str) -> User:
    """The account behind an OIDC subject, created under the name its singer chose.

    The subject is the identity, never the username: a provider may rename somebody, or
    hand the same name to a new person, and this account's scores and playlists must not
    follow. So an account that already exists is returned untouched, whatever `username`
    says — a singer who chose a name while a second callback created their account is
    logged into that account rather than refused.

    For a subject with no account, `username` is taken exactly as it stands: it is what
    somebody typed into the form, so a name already in use is `DuplicateUsernameError` —
    the form says so — and never a silently suffixed one.
    """
    existing = await find_by_oidc_subject(session, subject)
    if existing is not None:
        return existing

    username = username.strip()
    if await find_by_username(session, username) is not None:
        raise DuplicateUsernameError(username)

    first = await _is_first_account(session)
    user = User(
        username=username,
        # No password: there is nothing to check locally, ever.
        password_hash=None,
        auth_provider=OIDC,
        oidc_subject=subject,
    )
    session.add(user)
    try:
        # The whole write, not the commit alone: the account row goes in at this `flush`,
        # so the two indexes on it — oidc_subject and lower(username) — refuse it here,
        # and only the player's lower(name) is left to refuse it at the commit. Nothing in
        # the ID token is read for groups: the account lands in User alone (bar the first).
        await session.flush()
        _groups_for_new_user(session, user, first)
        await _attach_player(session, user)
        await session.commit()
    except IntegrityError as error:
        # One of the three indexes refused the row, so something landed between the two
        # checks above and this write, and which index it was is what that means. The
        # subject is the identity: an account carrying it is this very singer's own, so
        # they are logged into it and the name they typed names nothing — the same answer
        # the first check gives a second callback. Anything else is the name being taken,
        # by an account (lower(username)) or by the player it would sing as (lower(name)),
        # which is the second check's own refusal a moment later. So: look the subject up
        # once more, and everything that is not an account for it is a taken name.
        await session.rollback()
        existing = await find_by_oidc_subject(session, subject)
        if existing is None:
            raise DuplicateUsernameError(username) from error
        return existing
    logger.info(
        "'%s' registered an account through single sign-on%s", user.username, _first_tail(first)
    )
    await players.announce_players()
    return user


async def find_by_oidc_subject(session: AsyncSession, subject: str) -> User | None:
    result = await session.scalars(
        select(User).where(User.auth_provider == OIDC, User.oidc_subject == subject)
    )
    return result.first()


async def free_username(session: AsyncSession, wanted: str) -> str:
    """`wanted`, or `wanted-2`, `wanted-3`, … once it is taken.

    A provider knows nothing about the names already in Wingman, so a collision with a
    local account is normal. This is what the choose-a-name form opens on, so the name it
    proposes is one that would go through. Raises `DuplicateUsernameError` when even the
    suffixes are gone.
    """
    if await find_by_username(session, wanted) is None:
        return wanted
    for suffix in range(2, 100):
        # Cut so the suffixed name still respects the username bounds.
        candidate = f"{wanted[: MAX_USERNAME_LENGTH - len(str(suffix)) - 1]}-{suffix}"
        if await find_by_username(session, candidate) is None:
            return candidate
    # 98 accounts wanting the same name is not a collision any more.
    raise DuplicateUsernameError(wanted)


async def _is_first_account(session: AsyncSession) -> bool:
    return not await session.scalar(select(func.count()).select_from(User))


def _groups_for_new_user(session: AsyncSession, user: User, first: bool) -> None:
    """The very first account is the administrator — there is nobody who could put it in
    Admin. Every later one gets no row and is in User alone. Called after the account's
    flush, so its id exists, and before the commit that writes both."""
    if first:
        session.add(UserGroup(user_id=user.id, group_id=ADMIN))


def _first_tail(first: bool) -> str:
    return " (administrator)" if first else ""


async def _attach_player(session: AsyncSession, user: User) -> Player:
    """Link the temporary player of that name if there is one, otherwise create the player.

    Somebody who sang all evening as a guest keeps their scores when they finally register.
    """
    existing = await player_by_name(session, user.username)
    if existing is not None:
        if existing.user_id is not None:
            raise DuplicateUsernameError(user.username)
        existing.user_id = user.id
        existing.registered = True
        return existing
    player = Player(name=user.username, user_id=user.id, registered=True)
    session.add(player)
    return player


async def player_by_name(session: AsyncSession, name: str) -> Player | None:
    result = await session.scalars(
        select(Player).where(func.lower(Player.name) == name.strip().lower())
    )
    return result.first()


async def read_user_with_player(session: AsyncSession, user: User) -> UserRead:
    """An account as the API answers with it, player and all. Every way into an account
    answers with this, the OIDC ones included, so there is one shape to read."""
    player = await player_for_user(session, user.id)
    return read_user(user, None if player is None else player.id, await groups_of(session, user.id))


async def player_for_user(session: AsyncSession, user_id: str) -> Player | None:
    result = await session.scalars(select(Player).where(Player.user_id == user_id))
    return result.first()


async def player_ids_by_user(session: AsyncSession) -> dict[str, str]:
    """user id -> player id, for listing users without a query per row."""
    rows = await session.execute(
        select(Player.user_id, Player.id).where(Player.user_id.is_not(None))
    )
    return {user_id: player_id for user_id, player_id in rows if user_id is not None}


async def find_users_by_prefix(
    session: AsyncSession, prefix: str
) -> list[tuple[User, Player | None]]:
    """Accounts whose username starts with `prefix`, case-insensitively, with the player
    each of them sings as. Bounded: picking somebody to share with needs a shortlist, not
    the whole party."""
    rows = await session.execute(
        select(User, Player)
        .join(Player, Player.user_id == User.id, isouter=True)
        # `autoescape` because a `%` or `_` typed into the box is a character somebody's
        # name may contain, never a wildcard.
        .where(func.lower(User.username).startswith(prefix.lower(), autoescape=True))
        .order_by(func.lower(User.username), User.id)
        .limit(LOOKUP_LIMIT)
    )
    return [(user, player) for user, player in rows]


async def list_users(session: AsyncSession) -> Sequence[User]:
    result = await session.scalars(select(User).order_by(func.lower(User.username), User.id))
    return result.all()


async def delete_user(session: AsyncSession, user: User, by_admin: bool) -> None:
    """Delete the account. Its player survives as a temporary one so the statistics it
    already collected keep their owner.

    An account in Admin is an administrator's to delete (permission-groups.md §5, rule 1:
    `AdminRequiredError` for anybody else), and never the last one (`LastAdminError`).
    Deleting any other account takes rights away and gives none, so `users.manage` is enough.
    """
    in_admin = await session.get(UserGroup, (user.id, ADMIN)) is not None
    if in_admin and not by_admin:
        raise AdminRequiredError
    if in_admin and await admin_count(session) <= 1:
        raise LastAdminError
    player = await player_for_user(session, user.id)
    if player is not None:
        player.user_id = None
        player.registered = False
    # In the same transaction as the delete: a live cookie must not outlive its account, and
    # neither may its memberships. No `groups.changed`: an account leaving moves only a member
    # count, and `players.changed` below already reaches the pages that draw one.
    await session.execute(delete(UserSession).where(UserSession.user_id == user.id))
    await session.execute(delete(UserGroup).where(UserGroup.user_id == user.id))
    # Statistics belong to the player and survive; wishes, favorites and playlists belong
    # to the account and go with it.
    await library.delete_user_data(session, user.id)
    # Its tag permissions go too; the `song_tags` rows it left behind stay as attribution.
    await tags.delete_user_data(session, user.id)
    # A comment carries the account's name and its words, so it is not attribution that can
    # outlive the account the way a score's player does — it leaves with it.
    await comments.delete_user_data(session, user.id)
    await session.delete(user)
    await session.commit()
    logger.info("Account '%s' deleted", user.username)
    # After the commit, and with no id: an account leaving takes some playlists with it and
    # hands the rest to a new owner, so every open listing has to be fetched again.
    await library.announce_playlists()
    if player is not None:
        # Its player is a temporary one now.
        await players.announce_players()
