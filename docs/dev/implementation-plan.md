# Implementation Plan

Ground-up rewrite of Ultrastar Wingman (old project: `D:\git\ultrastar-wingman`,
treated as inspiration only). Phases are vertical slices: each ships backend +
frontend + tests + user docs and leaves `main` working. Per plan.md, each
phase still gets its own short design that is discussed with the user before
implementation — this document fixes scope, order, and the cross-cutting
decisions everything depends on.

Status legend: ⬜ not started · 🟨 in progress · ✅ done

## Cross-cutting decisions (fixed here, apply everywhere)

### Song identity

The old scheme is broken: `id or f"USDB-{usdb_id}" or uuid4().hex` — the
f-string is always truthy, so every non-USDB song gets the literal ID
`USDB-None` and collides. New scheme:

- Canonical ID: `<source>:<source_id>` — `usdb:1234` for USDB songs,
  `local:<uuid4>` for songs with no known source. Stable, persisted, opaque
  to the frontend.
- Content fingerprint: normalized artist + title (lowercased, feat./duet
  markers stripped, non-alphanumerics removed) stored alongside, used to
  detect "same song from a different source" — never as the primary key.
- Migration: on first scan of an existing library, old `wingman.json` ids of
  the form `USDB-<n>` map to `usdb:<n>`; `USDB-None` and raw-number ids are
  discarded and regenerated.

### Score capture (the key design improvement over the old app)

USDX stores scores in its own `Ultrastar.db` with no usable song identifier;
the old app matched them back by exact artist/title and player-name strings.
We do it differently: **Wingman launched the song and configured the
players**, so it knows exactly which song and which players a run belongs to.
After the USDX process exits, new rows in `Ultrastar.db` (snapshot of max
date taken before launch) are imported into Wingman's own statistics DB,
attributed by our song ID and player IDs by position/name. `Ultrastar.db`
stays read-only and is only an ingestion source; Wingman's DB is the source
of truth. This is why score capture ships in the same phase as the USDX
launcher — every song sung before capture exists is lost statistics data.

### Host UI trust

The old localhost check trusted the client-supplied `X-Forwarded-For` header
(spoofable). New design: when the server opens the host browser itself, the
URL carries a one-time token that establishes a persistent trusted admin
session. No header-based trust anywhere.

### Known-load-bearing USDX workarounds (keep, don't "clean up")

- `-SongPath <dir> -SingleSong` per song, one process per song, kill to stop.
- Songs outside the USDX songs dir (or with unsanitized dir names) must be
  copied into it before launch — `-SongPath` otherwise still loads the
  default dir.
- `CREATE_NO_WINDOW` creationflag on Windows — process exit detection breaks
  without it.
- Player names/colors/avatars are set by rewriting USDX's `config.ini` before
  launch; avatars are matched by MD5 of the image file. Improvement: parse
  the ini properly (add missing keys, keep a backup) instead of regex
  replace-only; the 16-color list becomes a single backend constant exposed
  via the API (the old app duplicated it in the frontend).

### Decisions confirmed with the user (2026-08-23)

- **Auth**: custom session-cookie auth (username + properly hashed password,
  ~small and fully owned) behind the `AuthProvider` seam; OIDC/Keycloak via
  **authlib**. Not fastapi-users — the old project fought its email-centric
  model (username-in-email hack, hardcoded JWT secret, token in
  localStorage).
- **yt-dlp**: managed standalone binary, auto-updated by Wingman (check on
  start and on download errors). Invoked as a subprocess with progress
  parsing — this also gives real download-progress events. No pip pin.
- **Guest identity**: anonymous persistent cookie ID per browser; guests get
  wishlists without accounts, and logging in merges the anonymous wishlist
  into the account. Replaces the old IP-keyed wishlists.

### Persistence

Everything the old app kept in memory (song library, wishlists, temporary
players, permission overrides, download queue state, latest scores) is
persisted in Wingman's SQLite DB. Restart loses nothing but a running
download.

## Phases

### Phase 0 — Foundation ✅

Repo skeleton: `backend/` (Python package, pyproject with ruff/mypy/pytest
config), `frontend/` (Vite + React + TS + ESLint/Prettier, generated API
client, TanStack Query), `docs/` (zensical). SQLite via async SQLAlchemy +
Alembic migrations, DB in the platform app-data dir. Config split: a minimal
bootstrap file (paths, port) validated with pydantic-settings; everything
else lives in a DB-backed settings registry (feeds the settings UI in phase
7). Typed WebSocket event bus. API mounted under `/api/v1`. CI running lint,
type check, and tests.

*Done when:* server starts with an empty library, frontend shell (dark theme
tokens carried over from the old design) loads, CI green.

### Phase 1 — Song library & song list ✅

Song domain model with the new ID scheme, txt metadata parsing
(fixture-tested against real files, including encoding detection), async
library scan into the DB with a rescan endpoint, `wingman.json` migration.
Song list UI: search, song details, covers.

*Done when:* an existing USDX library shows correctly in the UI, unique IDs
for every song, rescan works without restart.

### Phase 2 — USDX integration: play a song ✅

`KaraokeLauncher` interface + USDX adapter (launch, config rewriting, copy
workaround, process monitor, kill). Player model (registered later; temporary
players persisted now), avatar handling, player selector API + UI (colors
from the backend). Currently-playing state over WebSocket. **Score ingestion
into Wingman's statistics DB** (attributed run data: song ID, player IDs,
scores, timestamp, difficulty). Basic host UI page (QR code, now playing).

*Done when:* pick players → start song → USDX runs it → scores appear in
Wingman's DB attributed to the right song and players.

### Phase 3 — USDB source & downloads ✅

`SongSource` interface + USDB implementation: session handling with re-login
on expiry (no blocking console prompt — bad credentials surface in the UI),
search with corrected column parsing, download pipeline (txt fetch, cover via
httpx, yt-dlp video, ffmpeg audio extraction, `#BACKGROUND` handled).
Persistent download queue with per-item state and progress events. yt-dlp
auto-update. USDB search/download UI.

*Done when:* search USDB, queue downloads, watch progress, sing the result;
yt-dlp updates itself without a Wingman release.

### Phase 4 — Accounts & permissions ✅

`AuthProvider` seam with local accounts first (username-based, proper
password hashing, first user is admin); OIDC (Keycloak) as the second
provider — landed after phase 8 (authlib, PKCE, state binding).
Capability-based permissions, persisted, editable via API, enforced on every
route and on the WebSocket. Host-UI one-time-token trust. Registered players
link to accounts; temporary players remain for guests.

*Done when:* register/login works, permission changes survive restart, an
unauthorized request to every privileged route gets 403, host UI is admin
without being spoofable.

### Phase 5 — Wishlist, favorites, playlists & randomizer ✅

Wishlist (anonymous-cookie guest identity, merged into the account on
login), favorites (real,
persisted, per user — the old ones were UI-only), personal and shared
playlists. The casino spinner wheel on the home page (scopes: all songs /
wishlist / wishlist weighted).

*Done when:* wishes survive restart, favorites/playlists are per-user, the
wheel spins and starts songs.

### Phase 6 — Statistics UI ✅

Sessions recorded explicitly in the DB (stable IDs — the old app inferred
them from 6-hour gaps at startup). Stats views in the style of the old app
(session charts, per-player/per-song breakdowns) on top of the phase-2 data.

*Done when:* stats pages show live data from Wingman's own DB.

### Phase 7 — Settings UI ✅

UI section over the settings registry: grouped, typed inputs, live
validation, USDB credentials managed here. Adding a future setting = one
registry entry, zero UI code.

### Phase 8 — Packaging & docs site ✅

Windows installer (PyInstaller — verify yt-dlp/ffmpeg actually bundle; the
old build shipped without yt-dlp), zensical docs site with user guides per
feature, release workflow.

## Landed after phase 8

- USDX setup guidance (karaoke/status endpoint + guided UI).
- OIDC login (authlib, PKCE, state-cookie binding; settings group "Auth").
- Managed ffmpeg auto-download on Windows (like yt-dlp; no update checks).
- UI polish: tile background reserved for primary cards (the Home tile at the
  top of the page, auth/profile cards, modals, stats chart/summary, host
  blocks); list rows, form fields and the Home wishlist block are flat; old
  logo + favicons adopted; no VIDEO badge in the song list.

- UI/UX rework across every screen (2026-08-24, reviewed screen-by-screen
  against phone screenshots): song rows slimmed to cover/title/artist with
  details in the modal; song details rebuilt around a large cover, an audio
  preview (new `GET /songs/{id}/audio`), icon controls and a collapsible
  icon detail list; songs toolbar de-bloated to search + two icon buttons;
  USDB rows use icon download states (progress ring, check, alert) with the
  downloads list behind a header button in a modal; scores page rebuilt
  (one summary tile, segmented group-by, gated chart, worded rankings);
  user page split into an identity card plus `/user/accounts` and
  `/user/permissions` (one matrix, a column per role); host view is
  a TV stage with an idle-timer overlay (cursor + gear hide when the mouse
  rests) and a QR that encodes the LAN address (new `GET /join`); shared
  `components/icons.tsx` (inline SVG) and `.icon-button` classes carry the
  icon language; global `:focus-visible` ring.

- UI batch 3 (2026-08-26): USDX is now launched from inside its **own** songs
  directory (new `usdx.songs_dir`, derived from `usdx.base_path`) — pointing
  `-SongPath` anywhere else made USDX load the whole library next to the song
  (reasoning from USDX's sources is in `karaoke/usdx.py`'s docstring); the QR
  code's address is overridable with `host.join_url` (validated, normalised,
  new settings group "Host") and `GET /join` answers with it; new
  `GET /stats/sessions/current/sings` behind the Songs page's "Recently
  played" chip; own score history on `/user/stats` plus an About block on the
  user page; host view split into a one-job stage (song / results / brand) and
  a rail (QR, session standing, wishes); Home's header became a tile that
  swaps identity for the running song; scores page controls reduced to two
  quiet selects with a numbers-only summary row; playlists view rebuilt
  (header plus, inline rename); shared `EmptyState` and `RankedScoreList`;
  wishlist and playlist glyphs split into two icon families.

## Known gaps / follow-ups (as of 2026-08-24)

- **USDB column mapping is unvalidated against the live logged-in site** —
  the list page is login-gated, so verification needs one manual search
  after entering real credentials in Settings. The parser degrades to empty
  results (never crashes) if the real table differs from the fixtures.
- **CI has never run on GitHub** — written for ubuntu-latest while the suite
  has only ever run on Windows; the first push may surface a POSIX-path
  issue (the workflow has a comment about adding a Windows matrix entry).
- **Sing 400 error leaks raw filesystem paths to guests** — the
  `usdx_not_configured` detail carries the raw `problems` list to anyone
  with `karaoke.sing`, while GET `/karaoke/status` strips it without
  `settings.view`. The UI maps known patterns to path-free prose, so only
  unrecognized strings leak. Decide whether to filter the sing error the
  same way.
- **USDB `edition`/`golden` live only in a hover title** — the slim rows
  dropped them; they return once a USDB details view exists.
- **zensical is at 0.0.57** — very early; its config format may change.
- OIDC state store is in-memory, single-process (documented in
  `auth/oidc.py`); rate limiting is the noted upgrade path.

## Explicitly out of scope

- Spotify integration (dropped — API no longer feasible).
- UltraSinger (revisit later; `SongSource` seam keeps the door open).
- NFC player selector device (later; enabled by the versioned REST API and
  the player selector seam — nothing in phases 2/4 may assume selection only
  happens in the web UI).
