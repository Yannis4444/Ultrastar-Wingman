"""Achievement endpoints: the catalogue, its three options, and one player's badges.

Reading takes no capability at all. The host screen draws a badge on the TV and every guest
phone draws its own on the user page, so `GET /achievements`, the icon behind one and
`GET /players/{id}/achievements` answer anybody — the same reasoning as the tags listing.

Writing is one capability, `achievements.manage`: an achievement is written once and earned
by the whole room, so editing one rewrites what everybody has.

`hidden` is enforced here and nowhere else. A client that ignored the flag would spoil every
surprise, so the blanking happens before the row leaves the server — over the *caller's* own
player in the catalogue, and over the *subject's* on a player's page, because that one is
that player's record and not the reader's.
"""

import logging
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ..auth.deps import Principal, PrincipalDep, require
from ..config import BootstrapSettings
from ..db import SessionDep
from ..events import AchievementsChanged, event_bus
from ..images import (
    IMAGE_MEDIA_TYPES,
    MAX_IMAGE_BYTES,
    ImageTooLargeError,
    ImageTooManyPixelsError,
    ImageTypeError,
)
from ..players import service as players
from ..players.model import Player
from ..settings import SettingTypeError, SettingValue, SettingValueError
from ..tags.schema import TagColor
from . import service
from . import settings as achievement_settings
from .model import Achievement, PlayerAchievement
from .schema import (
    AchievementList,
    AchievementRead,
    AchievementSettings,
    Condition,
    PlayerAchievementList,
    PlayerAchievementRead,
    read_achievement,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["achievements"])

UNKNOWN_ACHIEVEMENT: dict[int | str, dict[str, object]] = {
    404: {"description": "Unknown achievement."}
}

AchievementName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=128)
]
AchievementDescription = Annotated[str, StringConstraints(strip_whitespace=True, max_length=512)]
# The name of an entry in the frontend's `ICON_PATHS`, exactly like `tags.icon`. Only the
# shape is checked: the backend ships no icon list, and one the UI does not know draws nothing.
AchievementIcon = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9-]{0,31}$")]


def get_icons_dir(request: Request) -> Path:
    settings: BootstrapSettings = request.app.state.bootstrap_settings
    return settings.data_dir / "achievement_icons"


IconsDirDep = Annotated[Path, Depends(get_icons_dir)]


def get_session_factory(request: Request) -> async_sessionmaker[AsyncSession]:
    """The factory a background pass opens its own session with — the request's own session
    is closed the moment the response goes out."""
    factory: async_sessionmaker[AsyncSession] = request.app.state.session_factory
    return factory


SessionFactoryDep = Annotated[async_sessionmaker[AsyncSession], Depends(get_session_factory)]


class AchievementCreate(BaseModel):
    """`definition` is parsed by the condition models on the way in, so an achievement that
    could never be satisfied is a 422 here rather than a stored row nobody can earn."""

    name: AchievementName
    description: AchievementDescription = ""
    icon: AchievementIcon | None = None
    color: TagColor = "neutral"
    hidden: bool = False
    enabled: bool = True
    # Left out: at the end of the list. The editor reorders by sending them.
    sort_order: int | None = None
    definition: list[Condition]


class AchievementUpdate(BaseModel):
    """Every field optional: a PATCH only touches what it names. An explicit `"icon": null`
    clears the glyph — leaving the field out keeps it."""

    name: AchievementName | None = None
    description: AchievementDescription | None = None
    icon: AchievementIcon | None = None
    color: TagColor | None = None
    hidden: bool | None = None
    enabled: bool | None = None
    sort_order: int | None = None
    definition: list[Condition] | None = None


class AchievementSettingsUpdate(BaseModel):
    """The three knobs, all optional like every other PATCH here."""

    enabled: bool | None = None
    host_seconds_base: int | None = None
    host_seconds_per_badge: int | None = None


@router.get("/achievements", response_model=AchievementList)
async def list_achievements(session: SessionDep, principal: PrincipalDep) -> AchievementList:
    """The whole catalogue, in `sort_order`, with the three settings beside it.

    No capability: a badge is drawn on the TV and on every phone, and the settings decide
    whether anything is drawn at all — a guest that could not read them could not draw.

    A `hidden` achievement the caller's own player has not earned comes back blank: no name,
    no sentence, no glyph. A caller holding `achievements.manage` sees all of it, plus each
    row's `definition`.
    """
    manages = _manages(principal)
    earned = (
        frozenset()
        if manages
        else await service.earned_ids(session, await _own_player_id(session, principal))
    )
    rows = await service.list_achievements(session)
    return AchievementList(
        achievements=[
            read_achievement(row, definition=manages, mask=_masked(row, manages, row.id in earned))
            for row in rows
        ],
        settings=_settings_read(await achievement_settings.read_all(session)),
    )


@router.patch(
    "/achievements/settings",
    response_model=AchievementSettings,
    dependencies=[Depends(require("achievements.manage"))],
    responses={422: {"description": "A second count outside 0 to 60."}},
)
async def update_achievement_settings(
    body: AchievementSettingsUpdate, session: SessionDep, factory: SessionFactoryDep
) -> AchievementSettings:
    """Switch achievements off for the whole instance, or retime the host screen's row.

    Registered before `PATCH /achievements/{achievement_id}` on purpose: FastAPI matches in
    registration order, and the other way round "settings" would be read as an achievement id.

    Switching the feature back on recomputes everybody in the background — while it was off
    nothing was evaluated, so the rows are as stale as the evening was long. Switching it
    *off* recomputes nothing and deletes nothing: the badges are kept exactly as they were.

    Broadcasts `achievements.changed` when it actually changed something: the toggle decides
    whether a phone draws badges at all, so a client holding the catalogue open has to hear
    about it. A PATCH that named nothing is silent.
    """
    values = await achievement_settings.read_all(session)
    settings = achievement_settings.service(session)
    named = {
        field: value
        for field, value in body.model_dump().items()
        if field in body.model_fields_set and value is not None
    }
    try:
        for field, value in named.items():
            await settings.set(f"achievements.{field}", value)
    except (SettingTypeError, SettingValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    if named:
        await event_bus.broadcast(AchievementsChanged())
    if named.get("enabled") is True and not values[achievement_settings.ENABLED]:
        service.start_full_pass(factory, "achievements were switched on")
    return _settings_read(await achievement_settings.read_all(session))


@router.post(
    "/achievements",
    response_model=AchievementRead,
    status_code=201,
    dependencies=[Depends(require("achievements.manage"))],
    responses={422: {"description": "A definition the condition models refuse."}},
)
async def create_achievement(
    body: AchievementCreate, session: SessionDep, factory: SessionFactoryDep
) -> AchievementRead:
    """Add one. Everybody who ever sang is recomputed against it in the background — an
    achievement that is true of what somebody already did is earned the moment it exists."""
    achievement = await service.create_achievement(
        session,
        name=body.name,
        description=body.description,
        icon=body.icon,
        color=body.color,
        hidden=body.hidden,
        enabled=body.enabled,
        sort_order=body.sort_order,
        definition=body.definition,
    )
    service.start_full_pass(factory, f"achievement '{achievement.id}' was created")
    return read_achievement(achievement, definition=True)


@router.patch(
    "/achievements/{achievement_id}",
    response_model=AchievementRead,
    dependencies=[Depends(require("achievements.manage"))],
    responses={
        **UNKNOWN_ACHIEVEMENT,
        422: {"description": "A definition the condition models refuse."},
    },
)
async def update_achievement(
    achievement_id: str, body: AchievementUpdate, session: SessionDep, factory: SessionFactoryDep
) -> AchievementRead:
    """Change one, a built-in included: they may be edited and switched off like any other.

    Recomputation follows every edit, not only an edited definition — switching one on or off
    changes who holds a row for it just as much as a raised target does.
    """
    achievement = await _achievement_or_404(achievement_id, session)
    await service.update_achievement(
        session,
        achievement,
        name=body.name,
        description=body.description,
        icon=body.icon if "icon" in body.model_fields_set else service.UNSET,
        color=body.color,
        hidden=body.hidden,
        enabled=body.enabled,
        sort_order=body.sort_order,
        definition=body.definition,
    )
    service.start_full_pass(factory, f"achievement '{achievement.id}' was edited")
    return read_achievement(achievement, definition=True)


@router.delete(
    "/achievements/{achievement_id}",
    status_code=204,
    dependencies=[Depends(require("achievements.manage"))],
    responses={
        **UNKNOWN_ACHIEVEMENT,
        409: {"description": "A built-in achievement cannot be deleted."},
    },
)
async def delete_achievement(
    achievement_id: str, session: SessionDep, icons_dir: IconsDirDep
) -> None:
    """Delete one, what everybody reached on it, and its uploaded picture.

    A built-in is a 409: import and export recognise the shipped set by its slug ids, so one
    may be switched off but never taken away. No background pass follows — the rows that
    mentioned it went with it, and nothing about anybody else changed.
    """
    achievement = await _achievement_or_404(achievement_id, session)
    try:
        await service.delete_achievement(session, achievement, icons_dir)
    except service.BuiltInAchievementError as error:
        raise HTTPException(status_code=409, detail="built_in_achievement") from error


@router.put(
    "/achievements/{achievement_id}/icon",
    response_model=AchievementRead,
    dependencies=[Depends(require("achievements.manage"))],
    responses={
        **UNKNOWN_ACHIEVEMENT,
        413: {"description": "The image is larger than 5 MB, or its canvas has too many pixels."},
        415: {"description": "Not a jpeg, png or webp image."},
    },
)
async def set_achievement_icon(
    achievement_id: str,
    session: SessionDep,
    icons_dir: IconsDirDep,
    file: Annotated[UploadFile, File()],
) -> AchievementRead:
    """Upload a picture to draw instead of the glyph (multipart form field `file`).

    The same rules as a player's avatar, out of the same module. No recomputation: what an
    achievement looks like has nothing to do with who has earned it.
    """
    achievement = await _achievement_or_404(achievement_id, session)
    # One byte over the limit is enough to reject, so an oversized upload is never buffered
    # whole.
    data = await file.read(MAX_IMAGE_BYTES + 1)
    try:
        await service.store_icon(session, achievement, icons_dir, file.content_type, data)
    except ImageTooLargeError as error:
        raise HTTPException(status_code=413, detail="icon_too_large") from error
    except ImageTooManyPixelsError as error:
        raise HTTPException(status_code=413, detail="icon_too_many_pixels") from error
    except ImageTypeError as error:
        raise HTTPException(status_code=415, detail="unsupported_icon_type") from error
    return read_achievement(achievement, definition=True)


@router.delete(
    "/achievements/{achievement_id}/icon",
    response_model=AchievementRead,
    dependencies=[Depends(require("achievements.manage"))],
    responses=UNKNOWN_ACHIEVEMENT,
)
async def delete_achievement_icon(
    achievement_id: str, session: SessionDep, icons_dir: IconsDirDep
) -> AchievementRead:
    """Back to the glyph. Idempotent — an achievement that had no picture is already there."""
    achievement = await _achievement_or_404(achievement_id, session)
    await service.remove_icon(session, achievement, icons_dir)
    return read_achievement(achievement, definition=True)


@router.get(
    "/achievements/{achievement_id}/icon",
    response_class=FileResponse,
    responses={
        **UNKNOWN_ACHIEVEMENT,
        200: {"content": {"image/*": {}}, "description": "The uploaded icon image."},
    },
)
async def get_achievement_icon(
    achievement_id: str, session: SessionDep, principal: PrincipalDep
) -> FileResponse:
    """The uploaded picture. Open like the catalogue itself: a badge on the TV is an image
    the TV has to be able to fetch.

    Masked too, because the id of a hidden achievement is in every catalogue answer — the
    locked slot carries it — so "you would have to know the id" protects nothing, and the
    picture is as much of the surprise as the name is. It is revealed once **anybody** has
    earned it rather than once the caller has: earning one announces it to every socket, and
    a phone drawing somebody else's badges has to be able to draw this one.

    A kept-back picture is the same 404 as no picture at all, so a stranger cannot tell the
    two apart.
    """
    achievement = await _achievement_or_404(achievement_id, session)
    missing = HTTPException(status_code=404, detail=f"achievement '{achievement_id}' has no icon")
    if (
        achievement.hidden
        and not _manages(principal)
        and not await service.earned_by_anybody(session, achievement_id)
    ):
        raise missing
    icon = None if achievement.icon_file is None else Path(achievement.icon_file)
    if icon is None or not icon.is_file():
        raise missing
    return FileResponse(icon, media_type=IMAGE_MEDIA_TYPES.get(icon.suffix))


@router.get(
    "/players/{player_id}/achievements",
    response_model=PlayerAchievementList,
    responses={404: {"description": "Unknown player."}},
)
async def list_player_achievements(
    player_id: str, session: SessionDep, principal: PrincipalDep
) -> PlayerAchievementList:
    """What one player has earned and how far along they are on the rest.

    No capability, like the catalogue: this is what the host screen shows beside a singer and
    what a phone shows on the user page. A player who never sang holds no rows at all, which
    is an empty list and not a 404.

    Masked over the **subject**: a hidden achievement *this player* has not earned is blank
    here whoever is reading, and its progress numbers are left out with it — a bar that
    filled would say what the badge is for just as loudly as its name would.
    """
    if await session.get(Player, player_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown player '{player_id}'")
    manages = _manages(principal)
    return PlayerAchievementList(
        achievements=[
            _read_row(row, achievement, manages)
            for row, achievement in await service.rows_of_player(session, player_id)
        ]
    )


def _read_row(
    row: PlayerAchievement, achievement: Achievement, manages: bool
) -> PlayerAchievementRead:
    mask = _masked(achievement, manages, row.earned_at is not None)
    return PlayerAchievementRead(
        achievement_id=row.achievement_id,
        player_id=row.player_id,
        earned_at=row.earned_at,
        session_id=row.session_id,
        progress_current=None if mask else row.progress_current,
        progress_target=None if mask else row.progress_target,
        achievement=read_achievement(achievement, definition=manages, mask=mask),
    )


def _masked(achievement: Achievement, manages: bool, earned: bool) -> bool:
    """A hidden achievement stays a secret until it is earned. A manager sees everything —
    somebody has to be able to write the thing."""
    return achievement.hidden and not manages and not earned


def _manages(principal: Principal) -> bool:
    return service.MANAGE_CAPABILITY in principal.capabilities


async def _own_player_id(session: AsyncSession, principal: Principal) -> str | None:
    """The caller's own player, the way `stats.api` resolves it: an account that is linked to
    one. The host screen and a guest phone have none, and have therefore earned nothing."""
    if principal.user is None:
        return None
    return await players.player_id_of_user(session, principal.user.id)


def _settings_read(values: dict[str, SettingValue]) -> AchievementSettings:
    return AchievementSettings(
        enabled=bool(values[achievement_settings.ENABLED]),
        host_seconds_base=int(values[achievement_settings.HOST_SECONDS_BASE]),
        host_seconds_per_badge=int(values[achievement_settings.HOST_SECONDS_PER_BADGE]),
    )


async def _achievement_or_404(achievement_id: str, session: AsyncSession) -> Achievement:
    achievement = await session.get(Achievement, achievement_id)
    if achievement is None:
        raise HTTPException(status_code=404, detail=f"unknown achievement '{achievement_id}'")
    return achievement
