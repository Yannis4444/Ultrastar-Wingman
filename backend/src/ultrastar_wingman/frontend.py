"""Serving the built frontend (`frontend/dist`) from the backend.

The packaged exe is one origin: API under `/api/v1`, the React bundle
everywhere else. In dev the vite dev server serves the frontend instead and
proxies `/api` here, so nothing is mounted when no build is found.
"""

import logging
import mimetypes
import sys
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

logger = logging.getLogger(__name__)

# Windows takes MIME types from the registry, where .js is often text/plain — and browsers
# hard-refuse a module script served as text/plain, which is exactly how vite loads the app.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")


def resolve_frontend_dir(configured: Path | None = None) -> Path | None:
    """Locate the built frontend, or `None` when there is none to serve.

    A configured directory (`WINGMAN_FRONTEND_DIR`) is used *alone*: an explicit
    override must never fall back to a stale bundle somewhere else. Otherwise:
    the PyInstaller bundle when frozen, then the repo's `frontend/dist` for
    convenience when running from a checkout.
    """
    if configured is not None:
        return configured if _is_built(configured) else None
    bundle_dir = getattr(sys, "_MEIPASS", None)
    if bundle_dir is not None:
        candidate = Path(bundle_dir) / "frontend"
        return candidate if _is_built(candidate) else None
    # backend/src/ultrastar_wingman/frontend.py -> repo root
    candidate = Path(__file__).parents[3] / "frontend" / "dist"
    return candidate if _is_built(candidate) else None


def _is_built(directory: Path) -> bool:
    return (directory / "index.html").is_file()


def mount_frontend(app: FastAPI, directory: Path) -> None:
    """Serve `directory` as a single-page app: real files as themselves, anything
    else as `index.html` so client-side routes survive a page reload."""
    root = directory.resolve()
    index = root / "index.html"

    @app.get("/{path:path}", include_in_schema=False, response_class=FileResponse)
    async def spa(path: str) -> FileResponse:
        # Registered after the API router, so it would otherwise turn every unknown
        # API path into an HTML page.
        if path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        target = (root / path).resolve()
        if path and target.is_file() and target.is_relative_to(root) and target != index:
            return FileResponse(target)
        # No-cache on the entry point only: asset filenames are content-hashed, index.html
        # is not, and a cached one would keep pointing at the previous version's assets.
        return FileResponse(index, headers={"cache-control": "no-cache"})
