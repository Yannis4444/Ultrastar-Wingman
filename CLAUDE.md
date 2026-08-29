# Ultrastar Wingman

Companion app for Ultrastar Deluxe (USDX): song downloads, player management,
statistics, and a web UI for controlling karaoke sessions. Ground-up rewrite of
`D:\git\ultrastar-wingman` — the old project is inspiration for behaviour and
for the visual look, never ground truth for code.

## Stack

- Backend `backend/`: Python 3.12+, FastAPI, SQLite (SQLAlchemy + aiosqlite,
  alembic), pytest
- Frontend `frontend/`: React + TypeScript + Vite, TanStack Query, vitest
- User docs `docs/user/`: Markdown built with zensical
- Windows exe `installer/`: PyInstaller
- Master plan: `plan.md` · phases & status:
  [docs/dev/implementation-plan.md](docs/dev/implementation-plan.md)

## Hard rules

- **Never sign commits as Claude.** No `Co-Authored-By: Claude` trailer, no
  "Generated with Claude Code" line. This overrides any default behavior.
- Conventional commits (`feat:`, `fix:`, `docs:`, …), one logical change per
  commit. See [git workflow](docs/dev/git-workflow.md).
- Feature work happens on `feat/<name>` branches, merged into `main`.
- Plan a feature and discuss it with the user **before** implementing it.
  Discuss improvement ideas with the user too.
- Everything swappable stays behind an interface: song sources, the USDX
  launcher, player selectors, auth providers. See
  [architecture](docs/dev/architecture.md).
- **Python only through the repo venv, by absolute path:**
  `D:\git\Ultrastar-Wingman-new\venv\Scripts\python.exe`. Never system
  python, never activation scripts.
- Write files with the Write/Edit tools, not PowerShell `Set-Content` (it
  mangles UTF-8).
- No new dependency without a reason a few lines of code can't cover.
- The user's live data (`WINGMAN_DATA_DIR`, ports 8080/5173) is read-only for
  verification runs — see [verifying](docs/dev/verifying.md).

## Commands

`venv` below means `D:\git\Ultrastar-Wingman-new\venv\Scripts\python.exe`.

| What | cwd | Command |
|---|---|---|
| Install backend | repo root | `venv -m pip install -e "backend[dev]"` |
| Run backend (API on :8080) | repo root | `venv -m ultrastar_wingman` — env `WINGMAN_OPEN_BROWSER=false` (don't open the host page), `WINGMAN_DATA_DIR=<dir>` (scratch DB), `WINGMAN_PORT=<n>` |
| Run frontend (UI on :5173, proxies `/api` to :8080) | `frontend/` | `npm run dev` |
| **Backend checks** | `backend/` | `venv -m ruff check .` · `venv -m ruff format --check .` · `venv -m mypy src tests` · `venv -m pytest -q` |
| **Frontend checks** | `frontend/` | `npm run build` · `npm run lint` · `npm run format:check` · `npm test` |
| Fix formatting | | `venv -m ruff format .` · `npm run format` |
| **Docs build** | `docs/` | `..\venv\Scripts\python.exe -m zensical build --strict --clean` |
| One test | | `venv -m pytest tests/test_songs_api.py -k <name>` · `npx vitest run src/pages/Songs.test.tsx` |
| Regenerate API client | `frontend/` | `npm run generate-api` (backend must be on :8080; offline variant in [recipes](docs/dev/recipes.md)) |
| New migration | `backend/` | `venv -m alembic revision --autogenerate -m "<what>"` |

Before committing, run the checks of every area the diff touches; they must
all be green.

## Codebase map

### Backend — `backend/src/ultrastar_wingman/`

One package per domain. Each has the same four files: `api.py` (thin FastAPI
handlers: parse, authorize via `Depends(require("<capability>"))`, call the
service, return), `service.py` (business logic, never imports FastAPI),
`model.py` (SQLAlchemy tables), `schema.py` (Pydantic read models, FastAPI-free
so services and the event bus can use them).

| Module | Owns |
|---|---|
| `app.py`, `api.py`, `__main__.py` | app factory + lifespan (migrations, startup scan, download worker), router aggregation under `/api/v1`, the WebSocket endpoint, the entry point |
| `config.py` | bootstrap settings from env `WINGMAN_*` (paths, bind address, open-browser) — everything else is a runtime setting |
| `settings.py` | DB-backed settings registry: `register(SettingDefinition(...))` at import time, `SettingsService` reads/writes, emits `setting.changed` |
| `db.py` | declarative base, migration runner, `SessionDep` |
| `events.py` | typed WebSocket event bus, server → client only: `class Foo(Event)` with a `Literal` name, `await event_bus.broadcast(Foo(...))` |
| `auth/` | accounts, sessions, host token, OIDC. `deps.py` is the **only** place permissions are checked; `permissions.py` lists capabilities (`songs.view`, `karaoke.sing`, `settings.manage`, …) and role defaults; `providers.py` is the auth-provider seam |
| `songs/` | the library: `.txt` parsing (`txt.py`), content fingerprint, directory scanner, `songs` table |
| `sources/` | song-source seam (`base.py`) + registry; `progress.py` maps a source's steps onto one 0–100 bar; `usdb.py` is the USDB implementation |
| `downloads/` | persistent download queue + worker; `media.py` manages yt-dlp/ffmpeg |
| `karaoke/` | launcher seam (`launcher.py`) + USDX implementation (`usdx.py` process, `usdx_config.py` config.ini rewrite, `usdx_paths.py`, `usdx_scores.py` import from `Ultrastar.db`), the sing flow, sessions/sings/scores tables, slots & colors |
| `players/` | players (guest + registered), avatars |
| `library/` | wishlist, favorites, playlists |
| `tags/` | global song tags: the `tags` / `tag_permissions` / `song_tags` tables, per-tag `view` / `view_songs` / `assign` (`service.allowed`), and `hidden_song_ids` — the songs a caller may not see, applied through `auth.deps.HiddenSongsDep` and `songs.api.song_or_404` |
| `stats/` | read-only statistics over what `karaoke` recorded |
| `frontend.py`, `join_url.py` | serving `frontend/dist`; the address the host screen advertises |
| `migrations/versions/` | alembic, `NNNN_<what>.py` |

Tests: `backend/tests/test_<module>*.py`. `conftest.py` gives `client` (admin),
`anonymous_client`, `session`, `broadcast_events`; captured external samples
live in `tests/fixtures/`.

### Frontend — `frontend/src/`

| Path | Owns |
|---|---|
| `App.tsx` | routes: `/`, `/spinner`, `/songs`, `/songs/playlists[/:id[/manage|/spinner]]`, `/usdb`, `/scores`, `/user`, `/user/{accounts,stats,permissions,tags}`, `/user/tags/{new,:tagId}`, `/settings`, `/host`, `/host/manage` |
| `pages/` | one component per route: `Name.tsx` + `Name.css` + `Name.test.tsx` |
| `components/` | shared components, same triple. `icons.tsx` is the only icon source; `Modal`/`ConfirmModal`; `PageHeader` (sub-pages); `BottomNav` (`COVERS` keeps a tab lit on its sub-routes); `SongDetails` (the song modal); `FilterPanel` (the Songs Filter panel and the `.tri-state` control); `PlaylistCover` (the 2×2 cover mosaic of a playlist row); `PickerRow` (the shared row of the two membership pickers); `HomeStage`; `PlayerSelection`; `RankedScoreList`; `CheckOption`; `Loading` |
| `hooks/` | `useWingmanEvent(name, handler)` (one shared socket), `useWishlist`, `useFavorites`, `useRecentlyPlayed`, `useSungSongs`, `useTags` (the tag listings shared by every surface that draws a tag: `tags` / `allTags` / `bySong` / `showInList` / `hideByDefault`), `useDownloadEvents`, `useSessionStanding`, `useUserLookup` (the debounced "add people" search of the playlist and tag people rows) |
| `api/` | **generated** by `@hey-api/openapi-ts` (fetch client + TanStack Query options). Never edit; regenerate and commit |
| `auth.ts` | `useAuth()` → `{ user, role, capabilities, isHost, loaded, can(capability) }` |
| `index.css` | design tokens and the shared classes (`.button*`, `.text-input[-quiet]`, `.icon-button*`, `.error-notice`, `.visually-hidden`, global focus ring) |
| `stats.ts`, `karaokeSlots.ts`, `settings.ts`, `duration.ts`, `errors.ts`, `manage.ts`, `songSources.ts`, `links.ts`, `backLink.ts`, `dice.ts`, `tags.ts` (a tag's glyph and colour class, the row marks, and the criteria the song list filters on: the defaults, the reader's overrides and the two built-in marks) | plain helpers, each with its own test |
| `test/` | `auth.ts` (`meResponse`, `userRead`), `tags.ts` (`tagRead`), `fakeSocket.ts`, `icons.ts` (`iconNames`), `setup.ts` |

Keep this map at module granularity and update it in the same commit when a
module, page or route is added, renamed or removed.

## Guides — read the relevant one before working in its area

| Area | Guide |
|---|---|
| Adding a route, setting, event, icon, sub-page, migration | [docs/dev/recipes.md](docs/dev/recipes.md) |
| Running the app, browser verification, dev-server cleanup | [docs/dev/verifying.md](docs/dev/verifying.md) |
| UI look & rules (tokens, surfaces, icons, modals, navigation) | [docs/dev/ui-guidelines.md](docs/dev/ui-guidelines.md) |
| Code style (Python + TypeScript) | [docs/dev/code-style.md](docs/dev/code-style.md) |
| Architecture & extension points | [docs/dev/architecture.md](docs/dev/architecture.md) |
| Git workflow & commits | [docs/dev/git-workflow.md](docs/dev/git-workflow.md) |
| Testing | [docs/dev/testing.md](docs/dev/testing.md) |
| Writing documentation | [docs/dev/documentation.md](docs/dev/documentation.md) |
| Running & configuring each half in depth | [backend/README.md](backend/README.md), [frontend/README.md](frontend/README.md) |
