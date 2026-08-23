"""Auth read models."""

from pydantic import BaseModel

from .model import User


class UserRead(BaseModel):
    id: str
    username: str
    role: str
    # The player this account sings as. Always set for accounts registered through the API,
    # nullable because an account whose player was deleted must still be listable.
    player_id: str | None


class UserList(BaseModel):
    users: list[UserRead]


class MeRead(BaseModel):
    """Everything the frontend needs to render itself. Works for anonymous callers too:
    `user` is then null and `role` is `guest`."""

    user: UserRead | None
    role: str
    capabilities: list[str]
    is_host: bool


class PermissionsRead(BaseModel):
    """role -> capabilities, for the permission editor."""

    roles: dict[str, list[str]]


def read_user(user: User, player_id: str | None) -> UserRead:
    return UserRead(id=user.id, username=user.username, role=user.role, player_id=player_id)
