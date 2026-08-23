"""Source specific endpoints.

Only `download()` is part of the `SongSource` seam, so everything else a source can do is
its own route: USDB's login state and its search live under `/sources/usdb`. Downloading
a search result goes through `POST /downloads` like any other download.
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from ..auth.deps import require
from ..db import SessionDep
from . import usdb
from .usdb import UsdbDirection, UsdbError, UsdbOrder, UsdbSearchResult, UsdbStatus

logger = logging.getLogger(__name__)

router = APIRouter(tags=["sources"])

_UNREACHABLE: dict[int | str, dict[str, Any]] = {
    502: {"description": "USDB is unreachable or rejected the login."}
}


@router.get(
    "/sources/usdb/status",
    response_model=UsdbStatus,
    dependencies=[Depends(require("usdb.search"))],
)
async def usdb_status(session: SessionDep, refresh: bool = False) -> UsdbStatus:
    """Whether Wingman can use USDB. Cached; `refresh=true` asks the site again."""
    return await usdb.status(session, refresh)


@router.get(
    "/sources/usdb/search",
    response_model=UsdbSearchResult,
    dependencies=[Depends(require("usdb.search"))],
    responses=_UNREACHABLE,
)
async def usdb_search(
    session: SessionDep,
    artist: str | None = None,
    title: str | None = None,
    order: UsdbOrder | None = None,
    ud: UsdbDirection | None = None,
    page: int = 1,
    limit: int = usdb.DEFAULT_LIMIT,
) -> UsdbSearchResult:
    try:
        return await usdb.search(
            session,
            artist=artist,
            title=title,
            order=order,
            direction=ud,
            page=page,
            limit=limit,
        )
    except UsdbError as error:
        # Not 401/403: nothing is wrong with *this* request, USDB is the failing upstream.
        raise HTTPException(status_code=502, detail=error.code) from error
