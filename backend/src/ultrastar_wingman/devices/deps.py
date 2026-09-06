"""Who is reporting. The device half of `auth/deps.py`, deliberately kept apart from it.

A device is not a browser: it has no session, no cookie and no role, and it never becomes a
`Principal`. It carries one bearer token, which resolves to exactly one row or to 401. There
is no `WWW-Authenticate` header and no login to send it to — the token is written to the
device's flash by the setup wizard, and a device that lost it is reconfigured, not prompted.

One route reads both ways: the firmware image, which a device downloads to update itself
over Wi-Fi and the host's browser downloads to flash over the cable. `device_or_manager` is
that route's door, and it is the only place in Wingman where a token and a session meet.
"""

import logging
import re
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select

from ..auth.deps import PrincipalDep, missing_permission
from ..auth.service import token_hash
from ..db import SessionDep
from .model import TOKEN_BYTES, TOKEN_PREFIX, Device

logger = logging.getLogger(__name__)

# Exactly what `service.new_token` mints. Checked before the value is hashed, so a header
# full of anything at all costs one regular expression and not a database round trip.
_TOKEN = re.compile(f"{TOKEN_PREFIX}[0-9a-f]{{{TOKEN_BYTES * 2}}}")


def bearer_token(request: Request) -> str | None:
    """The `Authorization: Bearer wd_…` value, or None when there is nothing shaped like
    one. A non-ASCII header never reaches the hash: it cannot match, so it is simply not a
    token — the same reasoning as the session cookie's shape check."""
    header = request.headers.get("Authorization", "")
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "bearer":
        return None
    candidate = value.strip()
    return candidate if _TOKEN.fullmatch(candidate) else None


async def current_device(request: Request, session: SessionDep) -> Device:
    """The device this token belongs to. 401 `unknown_device` for everything else.

    Looked up by hash, exactly like a session token: what Wingman stores can be read out of
    the database without becoming a key to it.
    """
    raw_token = bearer_token(request)
    device = (
        None
        if raw_token is None
        else await session.scalar(select(Device).where(Device.token_hash == token_hash(raw_token)))
    )
    if device is None:
        # No detail about which half was wrong: a device probing tokens learns nothing.
        raise HTTPException(status_code=401, detail="unknown_device")
    return device


DeviceDep = Annotated[Device, Depends(current_device)]


def _offers_a_bearer(request: Request) -> bool:
    """Whether this caller is speaking as a device at all. The scheme and not the shape:
    a bearer token that is malformed is a device with the wrong token, and telling it 403
    for a capability it will never hold would be a lie."""
    scheme, _, _ = request.headers.get("Authorization", "").partition(" ")
    return scheme.lower() == "bearer"


async def device_or_manager(request: Request, session: SessionDep, principal: PrincipalDep) -> None:
    """Two callers, one route: the firmware image is fetched by a device updating itself
    over Wi-Fi and by the flasher in the host's browser.

    The bearer comes first, because a request that carries one is a device: it is answered
    401 when the token is wrong rather than 403 for a capability no device holds. Everything
    else is a browser and needs `devices.manage`, exactly as the manifest beside it does.
    """
    if _offers_a_bearer(request):
        await current_device(request, session)
        return
    if "devices.manage" not in principal.capabilities:
        raise missing_permission("devices.manage")
