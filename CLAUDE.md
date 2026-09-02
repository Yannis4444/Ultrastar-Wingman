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
| `songs/` | the library: `.txt` parsing (`txt.py`, `is_duet` included — singer-switch body lines or both duet-singer headers), content fingerprint, directory scanner (every scan re-parses every txt, so a column added to the parser fills itself on the next start), `songs` table. `SongRead` carries what the built-in facets filter on — `is_duet`, `has_video`, `genre`, `language`, `edition`, `year` — on every row of every listing. `txt.py` also writes: `load_song_txt` proves the file's bytes round-trip before anything may touch it, `rewrite_headers` sets or removes named headers and leaves every other byte (BOM, line endings, unknown headers, body) alone. `service.py` is the two library changes that are not a scan — deleting a song (`songs.delete`): the folder off the disk under the scanner's lock, then the row, then the wishes — every other referencing row survives as an orphan its listing already skips, so a re-download under the same id finds its history again — and editing its metadata (`songs.edit`, `PATCH /songs/{id}`): the six `SongMetadata` headers into the txt, then the row (and its `fingerprint`) from the file as written, so the next scan is a no-op; the request carries the `expected` values the editor was opened on and a file that has moved on since is a 409 |
| `sources/` | song-source seam (`base.py`) + registry; `progress.py` maps a source's steps onto one 0–100 bar; `usdb.py` is the USDB implementation |
| `downloads/` | persistent download queue + worker; `media.py` manages yt-dlp/ffmpeg |
| `karaoke/` | launcher seam (`launcher.py`) + USDX implementation (`usdx.py` process, `usdx_config.py` config.ini rewrite, `usdx_paths.py`, `usdx_scores.py` import from `Ultrastar.db`), the sing flow, sessions/sings/scores tables, slots & colors |
| `players/` | players (guest + registered), avatars, and `hidden` — the flag `PATCH /players/{id}` (`players.manage`) sets to take somebody out of the singer picker and out of nothing else; `auth.service.start_session` clears it for the player of whoever logs in |
| `library/` | wishlist, favorites, playlists |
| `tags/` | global song tags: the `tags` / `tag_permissions` / `song_tags` tables, per-tag `view` / `view_songs` / `assign` (`service.allowed`), and `hidden_song_ids` — the songs a caller may not see, applied through `auth.deps.HiddenSongsDep` and `songs.api.song_or_404`. `builtin.py` is the eight built-ins as one table (`BUILT_INS`) — the marks `favorites` / `sung` (`color` + `show_in_list`), the boolean facets `duet` / `video` (those two + `show_in_filter`) and the valued facets `genre` / `language` / `edition` / `decade` (`show_in_filter`): `KIND_OPTIONS` says which options a kind has, and drives both the settings keys and the 422 on an option a kind lacks. Stored as settings under a private definitions dict (so the settings API never sees them), read by everybody on `GET /tags`, written on `PATCH /tags/built-in/{id}` (`tags.manage`). No SQL and no values endpoint behind a facet — the filtering and the value lists are the client's, over `SongRead` |
| `comments/` | what people say about a song: the `song_comments` table, `comments.write` to add one and `comments.moderate` to delete somebody else's (your own is always yours) |
| `stats/` | statistics over what `karaoke` recorded. Which parties a caller may open is `visible_session_ids` in `api.py`: the one still going (`stats.view`), the ones a signed-in account sang at (a `scores.player_id` of their player — identity, not a capability), and every one of them with `stats.history`; `GET /stats/scores` is those same parties added up ("All sessions" / "All my scores"), its own route rather than a reserved session id. Read-only apart from naming a session (`stats.manage`) and the two corrections `stats.moderate` may make to a recorded score — `PATCH /stats/scores/{id}` puts it on another player (the number, the song, the sing and the party stay), `DELETE` takes the score alone off the record and leaves the sing standing. Both broadcast `scores.changed` |
| `achievements/` | what a player earns by singing ([the design](docs/dev/achievements.md)). `model.py` is the two tables — the catalogue, and one `player_achievements` row per (enabled achievement, player who has a score), `earned_at` NULL while it carries progress only. `schema.py` is the condition language (`Condition`: scope, metric, comparator, value, the score/song filters) and is the only way a stored `definition` is read — an unreadable one is "never satisfied", never an exception; `read_achievement` is also where the `hidden` masking is applied. `evaluate.py` is the pure engine over one player's `ScoreRow`s: all conditions hold, the session-scoped ones inside one and the same party, progress is the least complete condition. `service.py` is the one query that feeds it, the pass that writes the rows (recomputation, so revoking works; a module lock serialises passes and the global toggle is checked inside them) and the catalogue's own writes. `builtin.py` is the seventeen Wingman ships, as data — migration 0023 seeds them as ordinary rows with slug ids and `built_in = True`, whose only privilege is that `DELETE` on one is a 409. `settings.py` is the three private settings (`enabled`, the two host-screen second counts), the `tags/builtin.py` pattern. `api.py` is the catalogue, its icons (uploaded through the shared `images.py`), `PATCH /achievements/settings` and `GET /players/{id}/achievements`; reading takes no capability, writing takes `achievements.manage` — and so does `GET /achievements?manage=true`, the one unmasked answer there is: holding the capability unmasks nothing, because the administrator and the host screen read this same catalogue on the user page and on the TV, so a `hidden` achievement is blank for them too until their own player earns it (a player's record is masked over its *subject* for every reader alike, definition included). Two events: `achievements.earned` (per sing, from `karaoke.service._finish`) and `achievements.changed` — no payload, the `tags.changed` precedent, from every write that changes what `GET /achievements` answers (create, edit, delete, both icon routes, the settings PATCH), because the masking is per caller. Re-evaluated from four places: `_finish`, the two `stats.moderate` corrections, and every catalogue write — that last one as a tracked background pass |
| `images.py` | the rules every uploaded picture follows — the content-type allowlist the bytes have to agree with, the byte cap, the pixel cap read out of the file's own header, and storing one file per subject. Used by the player avatars and the achievement icons; no image library, header parsing only |
| `frontend.py`, `join_url.py` | serving `frontend/dist`; the address the host screen advertises |
| `migrations/versions/` | alembic, `NNNN_<what>.py` |

Tests: `backend/tests/test_<module>*.py`. `conftest.py` gives `client` (admin),
`anonymous_client`, `session`, `broadcast_events`; captured external samples
live in `tests/fixtures/`.

### Frontend — `frontend/src/`

| Path | Owns |
|---|---|
| `App.tsx` | routes: `/`, `/spinner`, `/songs`, `/songs/playlists[/:id[/manage|/spinner]]`, `/usdb`, `/scores`, `/user`, `/user/{accounts,stats,permissions,tags,achievements}`, `/user/tags/{new,:tagId}`, `/user/achievements/{new,:achievementId}`, `/settings`, `/host`, `/host/manage` |
| `pages/` | one component per route: `Name.tsx` + `Name.css` + `Name.test.tsx`. `Achievements` is the admin page: the three private settings, the party's own achievements over the seventeen included ones, and at the foot *Import and export* — one file input posting an archive to `POST /achievements/import` and saying in words what it created and updated (`importSummary`, the refusal's own sentence verbatim), and an *Export…* panel of `PickerRow`s over both lists whose primary posts the chosen ids to `POST /achievements/export` and hands the answer to the browser as a blob URL on a synthetic link. `AchievementEditor` serves both achievement routes the way `TagEditor` serves both tag ones, and in the same order: name, description, the icon picker *or* an uploaded picture (never both — an upload needs a saved achievement), colour, *Hidden until earned* and *Enabled* with their explaining lines, the `ConditionBuilder`, one primary Save gated on `conditionProblem`, and a danger Delete a built-in swaps for the line saying it can be switched off but not deleted |
| `components/` | shared components, same triple. `icons.tsx` is the only icon source; `Modal`/`ConfirmModal`; `PageHeader` (sub-pages); `BottomNav` (`COVERS` keeps a tab lit on its sub-routes); `SongDetails` (the song modal, its sub-views and the metadata editor); `FilterPanel` (the Songs Filter panel: the `.tri-state` control and, for a valued facet, the quiet select in its place); `PlaylistCover` (the 2×2 cover mosaic of a playlist row); `PickerRow` (the shared row of the two membership pickers); `ScoreActions` (the `stats.moderate` pencil and trash a score row carries: the player picker and both confirmations); `AchievementBadge` (the one place a badge is drawn — the medallion, in the achievement's colour when earned, `--input-bg` under a `--color-darkerer` glyph when not, `lock` when masked; sized by the parent's `font-size`, never by a prop); `UserAchievements` (the singer's own badges on the user page, between the scores and *Manage*: a `<details>` whose summary is the earned medallions in a wrapping strip with "7 of 17" beside them, and behind it every achievement as a row — earned first (newest first), the rest in the off state, a masked one as `lock` over the stand-in words and no bar, a progress bar wherever there is a target. The catalogue is the spine, so a singer who has never been scored — no rows at all — still gets "0 of 17" and an invitation; nothing at all is drawn while the feature is off); `ConditionBuilder` (the achievement editor's conditions: one flat block per `Condition` — scope pills, the metric and its comparator, the optional score filter, and *All songs* / *Chosen songs* (a search over the library into `PickerRow`s) / *Songs matching* (the flat clause list), the three mutually exclusive the way `songs` and `match` are — each block headed by `conditionSentence`'s plain-language summary; controlled, holding nothing but in-progress typing); `HomeStage`; `HostAchievements` (the host stage's `achievements.earned` choreography: one singer at a time, four badges to a row, each row's time from the two `host_seconds` settings, badges thrown in and landing one by one; it plays *before* the results, and its `onPhase` is what puts `HostResults` on `suppressed` until it is done); `PlayerSelection`; `RankedScoreList`; `CheckOption`; `Loading`; the hand-drawn SVG charts of the stats pages — `ScoreStrip` (every score of a session — or of a whole record: /user/stats and the song modal's Best scores — on one staggered strip, gold best, median line; `named`/`surface`/`dated` adapt it to its page), `EveningTimeline` (score over wall-clock time, the five CVD-safe singer hues of `chartTheme.categorical`, grey past them), `SpreadRows` (per-group spread: Tukey box + raw grey dots for a player with ≥ 5 scores, staggered marks below that, initial-chip swarms for songs under 8 scores, top 8 groups), `ScoreHistogram` (the 20-bucket bars) — all wrapping their marks' hover/tap answers in `ChartTip` |
| `hooks/` | `useWingmanEvent(name, handler)` (one shared socket), `useWishlist`, `useFavorites`, `useRecentlyPlayed`, `useSungSongs`, `useTags` (the tag listings shared by every surface that draws a tag: `tags` / `allTags` / `bySong` / `showInList` / `hideByDefault`, plus `builtIns` — all eight built-ins as configured; `useBuiltInTags` is `builtIns` alone, for a surface that draws no tag), `useAchievements` (the catalogue and the three settings, one ungated and always-masked `GET /achievements` for every surface that draws a badge, refetched on `achievements.changed`; the two management pages keep their own gated `MANAGE_CATALOGUE` query instead), `useDownloadEvents`, `useSessionStanding`, `useUserLookup` (the debounced "add people" search of the playlist and tag people rows), `useMeasuredWidth` (an element's rendered width, for the SVG charts that draw at real pixel sizes), `useChartTip` (one chart's tooltip state: per-mark hover for mice; taps resolve on the SVG surface to the nearest mark within ~28px for fingers) |
| `api/` | **generated** by `@hey-api/openapi-ts` (fetch client + TanStack Query options). Never edit; regenerate and commit |
| `auth.ts` | `useAuth()` → `{ user, role, capabilities, isHost, loaded, can(capability) }` |
| `index.css` | design tokens and the shared classes (`.button*`, `.text-input[-quiet]`, `.icon-button*`, `.error-notice`, `.section-note`, `.visually-hidden`, global focus ring) |
| `stats.ts`, `chartLayout.ts` (the geometry behind the SVG charts: the shared 0–10k ticks, the beeswarm stagger that keeps near-ties apart, wall-clock ticks, deterministic dot jitter), `karaokeSlots.ts`, `settings.ts`, `duration.ts`, `errors.ts`, `manage.ts`, `songSources.ts`, `links.ts`, `backLink.ts`, `dice.ts`, `avatars.ts` (a player's picture: the cache-busted URL, and `asPlayer` for the people who are not player rows — a comment's author, a playlist's members), `tags.ts` (a tag's glyph and colour class, the row marks; the eight built-ins — their fixed glyph/name/`kind`, `KIND_OPTIONS` mirroring the backend, and `builtInTags` normalising the `built_ins` rows so no option is ever null; one extractor per facet over `SongRead` plus `decadeLabel` and `facetValues`; and the criteria the song list filters on — `SongCriteria` (marks, `booleans`, `values`, tags), the reader's `CriteriaOverrides` and `effectiveCriteria`, which drops a facet whose `show_in_filter` is off), `achievements.ts` (a badge's icon URL at the row's own `icon_version`, glyph and colour class — the tags' four, not a second vocabulary; `isMasked` and the stand-in name and sentence of a masked row; `MANAGE_CATALOGUE`, the `?manage=true` the two management pages — and nothing else — ask the catalogue with, its own cache entry beside the masked one everybody reads; the progress fraction and its `"7 / 10"`; and the editor's vocabulary declared once — metrics, comparators, scopes, the selector's fields, operators and kinds, `conditionTarget` mirroring the backend's progress rule, `songMode` reading the three song modes off `songs`/`match`, `conditionProblem` making the models' refusals sayable before Save, and `conditionSentence` turning one condition into the plain sentence its editor block is headed by; and `importSummary`, which turns an import's two lists of ids into the sentence the admin page answers with) | plain helpers, each with its own test |
| `test/` | `auth.ts` (`meResponse`, `userRead`), `tags.ts` (`tagRead`, `builtInTagRead`, `builtInTagReads` — all eight built-ins at their defaults), `achievements.ts` (`condition`, `achievementRead`, `maskedAchievementRead`, `achievementSettings`, `builtInAchievementReads` — the seventeen as `builtin.py` seeds them, `playerAchievementRead`), `fakeSocket.ts`, `icons.ts` (`iconNames`), `setup.ts` |

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
| Architecture decision records (the *why* behind the structure) | codebase-memory MCP: `manage_adr(mode='get', project='D-git-Ultrastar-Wingman-new')` — when a recorded decision changes, update the ADR alongside the code (`mode='update'` replaces the whole document) |
