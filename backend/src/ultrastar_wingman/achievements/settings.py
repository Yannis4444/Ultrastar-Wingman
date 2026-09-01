"""The three knobs achievements have, and where they live.

Not on the Settings page, and not in the registry: a module-private `DEFINITIONS` read
through a `SettingsService` built on it, exactly like `tags/builtin.py`. Two reasons, the
same two:

* `settings.manage` would be the wrong gate. It is an administrator's right over the whole
  instance, while these three belong to whoever looks after the badges — one capability,
  `achievements.manage`, opens the catalogue and its options together;
* every reader needs them. `achievements.enabled` decides whether a phone draws a badge at
  all and the two second counts are what the host screen times its sequence by, so they
  ride along on `GET /achievements`, which is open to a guest phone. A registered
  definition would be behind `settings.view`, which no guest holds.

Storage is still the ordinary `settings` table, so a value survives a restart and a reader
of that table can tell what a stored key was for.
"""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from ..settings import SettingDefinition, SettingsService, SettingValue

logger = logging.getLogger(__name__)

ENABLED = "achievements.enabled"
HOST_SECONDS_BASE = "achievements.host_seconds_base"
HOST_SECONDS_PER_BADGE = "achievements.host_seconds_per_badge"

# A row of badges is an interruption of the TV, so the two counts are bounded on both ends.
# A typo that parks the host screen for an hour is worse than a refusal, and there is no way
# back out of it from a phone while it lasts.
MAX_HOST_SECONDS = 60


def _validate_seconds(value: SettingValue) -> None:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError("a whole number of seconds")
    if value < 0 or value > MAX_HOST_SECONDS:
        raise ValueError(f"between 0 and {MAX_HOST_SECONDS} seconds")


# Not `settings.register`-ed on purpose — see the module docstring. `group` and
# `description` are filled in all the same: they are part of a definition.
DEFINITIONS: dict[str, SettingDefinition] = {
    ENABLED: SettingDefinition(
        key=ENABLED,
        value_type=bool,
        default=True,
        group="Achievements",
        description=(
            "Achievements for the whole instance. Off: nothing is evaluated and nothing is drawn."
        ),
    ),
    HOST_SECONDS_BASE: SettingDefinition(
        key=HOST_SECONDS_BASE,
        value_type=int,
        default=4,
        group="Achievements",
        description="How long a row of badges stays on the host screen.",
        validate=_validate_seconds,
    ),
    HOST_SECONDS_PER_BADGE: SettingDefinition(
        key=HOST_SECONDS_PER_BADGE,
        value_type=int,
        default=2,
        group="Achievements",
        description="Added to that for each badge in the row.",
        validate=_validate_seconds,
    ),
}


def service(session: AsyncSession) -> SettingsService:
    return SettingsService(session, DEFINITIONS)


async def enabled(session: AsyncSession) -> bool:
    """The global toggle. Read inside every pass rather than at the call sites: a trigger
    that forgot to ask would keep writing rows nobody draws."""
    return bool(await service(session).get(ENABLED))


async def read_all(session: AsyncSession) -> dict[str, SettingValue]:
    """All three, one query — what `GET /achievements` hands every reader."""
    return await service(session).all()
