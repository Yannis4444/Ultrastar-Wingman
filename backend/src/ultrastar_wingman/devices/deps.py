"""Who is reporting. The device half of `auth/deps.py`, deliberately kept apart from it.

A device is not a browser: it has no session, no cookie and no role, and it never becomes a
`Principal`. It carries one bearer token, which resolves to exactly one row or to 401. There
is no `WWW-Authenticate` header and no login to send it to — the token is written to the
device's flash by the setup wizard, and a device that lost it is reconfigured, not prompted.
"""

import logging
import re
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select

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
