# Ultrastar Wingman — backend

FastAPI + async SQLAlchemy backend. API lives under `/api/v1`, WebSocket events
under `/api/v1/ws`.

## Install

From the repo root, using the project venv (`venv\Scripts\python.exe`):

```powershell
venv\Scripts\python.exe -m pip install -e "backend[dev]"
```

## Run

```powershell
venv\Scripts\python.exe -m ultrastar_wingman
```

Serves on `http://0.0.0.0:8080`: Swagger UI at `/docs`, the schema at
`/api/v1/openapi.json` (the URL the frontend's client generator reads — keep it
versioned with the rest of the API). The SQLite database is created at
`<data_dir>/wingman.db` and migrated to head on startup.

### Bootstrap configuration

Only paths and the bind address are configured outside the database — via
environment variables (prefix `WINGMAN_`) or a `.env` file in the working
directory:

| Variable | Default |
|---|---|
| `WINGMAN_DATA_DIR` | platform app-data dir for "Ultrastar Wingman" |
| `WINGMAN_HOST` | `0.0.0.0` |
| `WINGMAN_PORT` | `8080` |
| `WINGMAN_FRONTEND_DIR` | the PyInstaller bundle when frozen, else `frontend/dist` |

Everything else is a runtime setting: definitions live in
`src/ultrastar_wingman/settings.py`, values in the `settings` table, exposed via
`GET /api/v1/settings` and `PATCH /api/v1/settings/{key}`.

### Serving the frontend

When a built frontend is found, everything outside `/api` is served from it:
files as themselves, any other path as `index.html` so client-side routes
survive a reload. `WINGMAN_FRONTEND_DIR` is used alone — no fallback — so it can
also point at nothing on purpose. With no build anywhere the backend logs one
line and serves the API only, which is how `npm run dev` runs (vite serves the
UI and proxies `/api` here).

### Song library

`songs.directory` (the USDX songs dir) and `songs.additional_directories` (one
path per line) are the roots Wingman scans; every direct subdirectory holding a
`.txt` is one song. The library is scanned once at startup in the background and
on `POST /api/v1/songs/rescan` (202, or 409 while a scan runs) — progress arrives
as `songs.scan_started` / `songs.scan_finished` websocket events. Scanning is
read-only: nothing is ever written into a song directory.

## Checks

Run from `backend/`:

```powershell
..\venv\Scripts\python.exe -m ruff check .
..\venv\Scripts\python.exe -m ruff format --check .
..\venv\Scripts\python.exe -m mypy src tests
..\venv\Scripts\python.exe -m pytest
```

## Migrations

Autogenerate against the models (the app itself upgrades to head on startup):

```powershell
..\venv\Scripts\python.exe -m alembic revision --autogenerate -m "add x"
```
