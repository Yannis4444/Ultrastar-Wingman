"""Auth read models."""

from pydantic import BaseModel

from .model import User
from .providers import LOCAL


class UserRead(BaseModel):
    id: str
    username: str
    # The groups the account was put in, as ids, in the one order groups are listed in
    # (permission-groups.md §2.5) — never `user`, which every account is in without a row.
    # Empty for a plain account.
    groups: list[str]
    # The player this account sings as. Always set for accounts registered through the API,
    # nullable because an account whose player was deleted must still be listable.
    player_id: str | None
    # How the account logs in: `local` (a password here) or `oidc` (single sign-on, the
    # provider answering for it). Always sent; the default only keeps the field optional in
    # the generated client, the `avatar_version` precedent, so a test's hand-written account
    # need not spell it out.
    auth_provider: str = LOCAL


class UserList(BaseModel):
    users: list[UserRead]


class UserLookupRead(BaseModel):
    """An account as somebody looking for a person to share with sees it: enough to pick
    the right one, and nothing about what that account may do."""

    id: str
    username: str
    player_id: str | None
    # Cache buster for the player's picture, `None` when there is none — same meaning as
    # on `PlayerRead`, so the same avatar URL works.
    avatar_version: int | None


class UserLookupList(BaseModel):
    users: list[UserLookupRead]


class GroupRef(BaseModel):
    """A group by name, for a reader who only has to say which groups somebody is in."""

    id: str
    name: str


class MeRead(BaseModel):
    """Everything the frontend needs to render itself. Works for anonymous callers too:
    `user` is then null and `groups` is Guest alone."""

    user: UserRead | None
    # The caller's groups in the one order (§2.5): `[Guest]` without an account, `[User, …]`
    # with one, `[Admin]` for the host screen.
    groups: list[GroupRef]
    # The host screen, or an account in Admin: every capability, and the two rules of §5
    # never bind.
    is_admin: bool
    capabilities: list[str]
    is_host: bool


class GroupRead(BaseModel):
    """One group as the groups page, the accounts page's panel and the tag editor see it."""

    id: str
    name: str
    built_in: bool
    # Accounts in it. `None` for Guest, which is about callers without one; every account for
    # User; the rows whose account exists for the rest. The host screen is never counted.
    member_count: int | None
    # Only for a `permissions.manage` caller, `None` otherwise (the `TagRead.permissions`
    # precedent). Admin's is the whole catalogue, by rule.
    capabilities: list[str] | None
    # How many rights it gives, for every reader: Guest's and User's own count, for any other
    # group the ones it holds beyond User's, `None` for Admin (every right).
    right_count: int | None
    # Whether this caller may put somebody in it (§5): an administrator always; anybody else
    # never for Admin, and for another group only while they hold all it carries. Always
    # `False` for Guest and User, which nobody is put in.
    can_assign: bool


class GroupList(BaseModel):
    # In the one order (§2.5): Guest, User, the others by name, Admin.
    groups: list[GroupRead]
    # The capability catalogue, in its own order, for a `permissions.manage` caller; `None`
    # for everybody else.
    capabilities: list[str] | None


def read_user(user: User, player_id: str | None, groups: list[str]) -> UserRead:
    return UserRead(
        id=user.id,
        username=user.username,
        groups=groups,
        player_id=player_id,
        auth_provider=user.auth_provider,
    )
