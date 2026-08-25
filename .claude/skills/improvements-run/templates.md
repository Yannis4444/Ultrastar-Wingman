# Prompt templates for `improvements-run`

Paste these into the workflow script as JS constants. Everything in `<angle
brackets>` is filled by the orchestrator. Keep the project facts block current —
it is the only place project specifics live.

## §PRE — shared preamble for every agent

```
## Project context (read before anything else)
- Repo: D:\git\Ultrastar-Wingman-new (Windows). Frontend: frontend/src (React+TS+Vite).
  Backend: backend/ (FastAPI, SQLAlchemy+aiosqlite, layered per docs/dev/architecture.md;
  song sources, USDX launcher, player selectors and auth providers sit behind interfaces).
  You are on branch <feat/branch>.
- FIRST read the design guidelines doc: <path> — it is binding (tokens, icon rules,
  surface whitelist, sub-view pattern, per-view prescriptions). Old app
  D:\git\ultrastar-wingman is design ground truth for LOOK only, never for code.
- Use the Write/Edit tools for file changes (PowerShell Set-Content mangles UTF-8).
  Follow docs/dev/code-style.md; add/update tests per docs/dev/testing.md; update
  docs/user/ when user-facing behaviour changes.
- HARD RULES: NEVER run git commit or git add. NEVER modify <improvements-file>.
  No new dependencies. NEVER type real credentials or create external accounts.
- Python ONLY via the venv absolute path D:\git\Ultrastar-Wingman-new\venv\Scripts\python.exe
  (never system python, never activate scripts).
- Before you finish, ALL checks must pass. Frontend (cwd frontend/): npm run build ;
  npm run lint ; npm run format:check ; npm test -- --run. Backend, if touched
  (cwd backend/): venv python -m ruff check . ; -m ruff format --check . ;
  -m mypy src tests ; -m pytest. Docs, if touched (cwd docs/):
  ..\venv\Scripts\python.exe -m zensical build --strict --clean.
- The user's live data dir is READ-ONLY for you. Anything that writes runs against
  a scratch WINGMAN_DATA_DIR on alternate ports; never start a real sing against the
  live DB.
- If you change the backend API, regenerate the frontend client without a live
  server on :8080: dump `create_app().openapi()` with an isolated WINGMAN_DATA_DIR
  to the scratchpad and run `npx openapi-ts --input <dump>` (same output as
  `npm run generate-api`); revert any config you pointed at the dump. The generated
  `frontend/src/api/*.gen.ts` files are committed.
- Report format: what you investigated/found, what you changed per bullet, files
  changed (absolute paths), API surface added, check results (each command),
  DECISIONS THE USER MAY VETO (flag every judgment call), COLLATERAL (changes
  outside the bundle and why they were unavoidable), things noticed but
  deliberately not changed, and what you could NOT verify.
```

Design-rule reminders worth inlining when the guidelines doc is not yet written:
flat surfaces with hairline separators (`--input-border-color`); `--tile-bg` only for
page-level cards, modals and the Home header; passive row marks (pink heart / blue
check) never toggle buttons in rows; compact icon-structured modals; icons only from
`components/icons.tsx` (single 24×24 path, `Icon({name, className})`); extend
`.icon-button*` classes, no bespoke icon-button CSS; `--highlight-red-light` is
fill/border only. Reusable pieces that exist: `CheckOption` (old-app checkbox/radio),
`IconStat`, `CoverImage`/`SongCover`, `PageHeader` (with state-provided back target),
`ManageMenu`, `ConfirmModal`, `PlayerAvatar`.

## §BROWSER — recipe for browser-verify agents

```
## Browser testing recipe (established for this repo — reuse verbatim)
- Start the vite dev server in the background (cwd frontend/, npm run dev) and the
  backend with env WINGMAN_OPEN_BROWSER=false (venv python only). Ports 8080/5173 may
  belong to the user — use free alternates (backend :8081, vite :5189 via a temp
  proxy config under a FRESH filename you delete afterwards) and leave others'
  servers untouched. Use an isolated scratch WINGMAN_DATA_DIR whenever you mutate
  players, settings, downloads or scores; the live DB is read-only for you.
- Grep the backend log for "hostToken=", open
  http://localhost:<vite-port>/host?hostToken=<token> in Chrome (claude-in-chrome MCP
  tools via ToolSearch — load tabs_context_mcp, navigate, computer, read_page,
  tabs_create_mcp, tabs_close_mcp in ONE call). The exchange sets a trusted-admin
  cookie (no account). Token is single-use per backend start. You cannot log into an
  account — verify logged-in-only UI via unit tests or by intercepting /auth/me in a
  harness, and say explicitly what stayed unverified.
- Phone viewport (a maximized Chrome ignores resize): inject a 390x844 iframe scaled
  1.5x into a blank same-origin page, drive it via contentDocument (React selects
  need the native value setter + a bubbling change event), capture with the
  computer tool zoom region [0, 0, 357, 772]. TV surfaces (host page): verify at
  1280x720 and larger.
- CAUTION: Play/Sing launches real Ultrastar Deluxe. If you must, do it once,
  finish via POST /api/v1/karaoke/stop, and prove no ultrastardx process survives.
- Cleanup before you finish: close your tabs, kill your servers (prove ports are
  free with netstat), delete temp configs and the scratch data dir, delete test
  players/playlists you created, revert settings you changed.
```

## §IMPLEMENT — task body skeleton

```
## Task — <bundle name>
<improvements-file section> says:
<bullets verbatim, numbered>

For each numbered item: <what "done" means; where to look (real file names);
question-items: investigate first, fix at the source, document the exact cause>.
Keep <existing contracts> working. Update tests.

Return the report in the format the preamble prescribes.
```

## §VERIFY — adversarial review skeleton

```
## Task — adversarial review of <bundle name>
An agent just implemented this bundle (report below). Review the UNCOMMITTED
working-tree diff (git diff; git status) and try hard to find real problems:
- correctness (edge cases, races, stale state, event bubbling, unit/units traps),
- permissions/gating (what does a guest / an accountless admin / a user with only
  one capability see? nothing broken, nothing leaked),
- guideline violations (tokens, tile whitelist, icon rules, bespoke CSS where a
  shared class exists, duplicated markup that will drift),
- layout at 390px (no sideways scroll: documentElement.scrollWidth == clientWidth)
  and, for host surfaces, readability at 1280x720+,
- tests: gaps for the new behaviour; empty/loading/error states.
FIX every real problem directly. Then re-run all checks and make them pass.
<§BROWSER if tagged>

Implementer's report:
${impl}

Return: problems found (severity), fixes applied, what you could NOT verify and
why, final check results (each command), decisions the user may veto, and a
one-line conventional commit message covering the whole working-tree diff.
```

## §GUIDELINES — first-bundle agent (only when the batch has design work)

```
You are preparing/extending the DESIGN GUIDELINES document for a batch of UI
improvements. Later agents implement bundles one at a time; your document keeps
them consistent. Write the document only — change no app code.
Read the improvements file, the existing guidelines (<memory path, if any>), the
current frontend (index.css tokens, components/pages touched by the batch) and the
old app's equivalent views. Produce/extend: token + spacing + typography recap with
real variable names; surface rules with examples from this batch; icon inventory +
NEW names reserved for this batch and how to draw them; controls (buttons,
checkbox style described precisely from the old app); modal and sub-view patterns;
per-view prescriptions for every area the batch names; cover treatment. Write it
with the Write tool to <scratchpad>/design-guidelines.md and return the full text.
```

## §DOCS-SWEEP — final-workflow docs agent

```
## Task — documentation sweep for the <batch> batch
The batch is complete on this branch. Establish what changed: git log main..HEAD
--oneline ; git diff main...HEAD --stat ; skim the diffs of frontend/src/pages and
backend/src/*/api.py for renamed views, routes, buttons, tabs, settings, capabilities
and behaviours. Then read every page under docs/user/ and the non-log parts of
docs/dev/ and find statements the batch made stale (a button that moved, a tab that
no longer exists, a chip row replaced by a view, a new setting or endpoint not
described, a lifecycle that changed — retention, deletion steps, gating).
Update text minimally, in the handbook's existing voice; add a short section for
each genuinely new user-facing feature; leave dated phase logs alone except for
parentheticals that are now false. Do not document internals in docs/user/.
Run (cwd docs/): ..\venv\Scripts\python.exe -m zensical build --strict --clean.
Return: each doc change with the code change that motivated it, doc claims you could
not verify against the code, and the build result.
```

## §CHECKS — orchestrator re-run before every commit

```
cd backend  && <venv>/python.exe -m ruff check . && <venv>/python.exe -m ruff format --check . && <venv>/python.exe -m mypy src tests && <venv>/python.exe -m pytest -q
cd frontend && npm run build && npm run lint && npm run format:check && npm test -- --run
cd docs     && ../venv/Scripts/python.exe -m zensical build --strict --clean
```

Backend/docs only when the diff touches them; frontend always.

## §WORKFLOW — script skeleton

```js
export const meta = {
  name: 'improvements-NN-<slug>',
  description: '<one line>',
  phases: [
    { title: 'Implement', detail: '<who does what>' },
    { title: 'Review', detail: '<adversarial review | visual verify>' },
  ],
}
const PRE = `...§PRE...`
const BROWSER = `...§BROWSER...`   // only for browser-verify bundles
phase('Implement')
const impl = await agent(`${PRE}\n\n...§IMPLEMENT...`, { label: 'impl:<slug>', model: '<model>', effort: 'high' })
phase('Review')
const review = await agent(`${PRE}\n\n${BROWSER}\n\n...§VERIFY...`, { label: 'verify:<slug>', model: '<model>', effort: 'high' })
return { impl, review }
```
