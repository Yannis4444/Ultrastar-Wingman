# Prompt templates for `improvements-run`

Paste these into the workflow script as JS constants. Everything in `<angle
brackets>` is filled by the orchestrator. Project facts live in the repo —
`CLAUDE.md` (rules, commands, codebase map) and `docs/dev/` — not here; the
preamble points agents at them instead of restating them, so this file never
drifts from the guides. Use straight quotes inside prompt strings: the scripts
are template literals and a literal backtick is a parse error.

## §PRE — shared preamble for every agent

```
## Project context (read before anything else)
- Repo: D:\git\Ultrastar-Wingman-new (Windows), branch <feat/branch>.
  READ CLAUDE.md FIRST: it has the hard rules, the exact check commands and the
  codebase map. Then read docs/dev/ui-guidelines.md (binding for any UI work),
  docs/dev/recipes.md (how to add routes/settings/events/pages) and
  docs/dev/verifying.md (running the app, browser checks, cleanup). Follow
  docs/dev/code-style.md and docs/dev/testing.md; update docs/user/ when
  user-facing behaviour changes.
- The old app D:\git\ultrastar-wingman is design ground truth for LOOK only.
- HARD RULES: NEVER run git commit or git add. NEVER modify <improvements-file>.
  No new dependencies. NEVER type real credentials or create external accounts.
  Python only via the venv absolute path in CLAUDE.md. Files via Write/Edit.
- Before you finish, ALL checks in CLAUDE.md for every area you touched must pass.
- The user's live data dir and ports 8080/5173 are READ-ONLY for you (verifying.md).
- API changed? Regenerate the frontend client per recipes.md (offline variant
  when no backend is on :8080) and include the generated files in your change.
- Precedence: the improvements bullet (the user's words) beats the guidelines;
  the guidelines beat anything this task text implies about layout or order —
  when the task text and a guideline disagree, follow the guideline and say so.
- Report format: what you investigated/found, what you changed per bullet, files
  changed (absolute paths), API surface added, check results (each command),
  DECISIONS THE USER MAY VETO (flag every judgment call), COLLATERAL (changes
  outside the bundle and why they were unavoidable), things noticed but
  deliberately not changed, and what you could NOT verify.
```

## §BROWSER — recipe for browser-verify agents

```
## Browser verification (docs/dev/verifying.md is the reference — follow it)
- Scratch WINGMAN_DATA_DIR, backend on :<alt-port> with WINGMAN_OPEN_BROWSER=false,
  vite on :<alt-port> through a temp config under a FRESH file name you delete
  afterwards. Record every PID you start.
- Be admin via the hostToken URL; never type credentials. Logged-in-account UI:
  verify via unit tests or an intercepted /auth/me and say what stayed unverified.
- Chrome: claude-in-chrome MCP tools via ToolSearch — load tabs_context_mcp,
  navigate, computer, read_page, tabs_create_mcp, tabs_close_mcp in ONE call.
  Phone viewport 390x844 (iframe trick or headless CDP), host page at 1280x720+.
- Do not start a real sing.
- Cleanup: kill ONLY by the PIDs you recorded (taskkill //PID <pid> //T //F) —
  never //IM, //FI or Stop-Process -Name; ports <user-ports> are not yours even
  if something on them looks stale — list it instead. Delete temp configs and the
  scratch data dir, close your tabs, remove test data you created.
```

## §IMPLEMENT — task body skeleton

```
## Task — <bundle name>
<improvements-file section> says:
<bullets verbatim, numbered>

For each numbered item: <what "done" means; where to look (real file names);
question-items: investigate first, fix at the source, document the exact cause>.
Layout, order and sizing come from docs/dev/ui-guidelines.md — this text does
not restate them. Keep <existing contracts> working. Update tests.

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
- ui-guidelines.md violations (tokens, tile whitelist, icon families, bespoke CSS
  where a shared class exists, duplicated markup that will drift) — but a change
  the improvements bullet explicitly asked for is not a violation: leave it, note it,
- layout at 390px (no sideways scroll: documentElement.scrollWidth == clientWidth)
  and, for host surfaces, readability at 1280x720+,
- tests: gaps for the new behaviour; empty/loading/error states,
- docs/user/ and the CLAUDE.md codebase map still true after the change.
FIX every real problem directly. Then re-run all checks and make them pass.
<§BROWSER if tagged>

Implementer's report:
${impl}

Return: problems found (severity), fixes applied, what you could NOT verify and
why, final check results (each command), decisions the user may veto, and a
one-line conventional commit message covering the whole working-tree diff.
```

## §GUIDELINES — first-bundle agent (only when the batch needs new prescriptions)

```
You are extending docs/dev/ui-guidelines.md for a batch of UI improvements so
that later agents, one bundle at a time, build consistent views. Change no app
code. Read the improvements file, the current guidelines, the current frontend
(index.css, the components/pages the batch touches) and the old app's
equivalent views. Add ONLY what the batch needs and the document does not have:
new icon names with drawing notes, new shared components/classes, per-view
prescriptions for views the batch redesigns (put them in §7 "Page conventions",
one paragraph per view, present tense — describe the target state, not the
change). Do not restate existing rules, do not add batch names or dates, do not
mark anything "superseded" — replace the old sentence. Keep the document under
300 lines. Return the diff summary and any conflicts you found between the
improvements file and the existing rules.
```

## §DOCS-SWEEP — final-workflow docs agent

```
## Task — documentation sweep for the <batch> batch
The batch is complete on this branch. Establish what changed: git log main..HEAD
--oneline ; git diff main...HEAD --stat ; skim the diffs of frontend/src/pages and
backend/src/*/api.py for renamed views, routes, buttons, tabs, settings, capabilities
and behaviours. Then read every page under docs/user/, the codebase map in
CLAUDE.md, and docs/dev/ui-guidelines.md, and find statements the batch made
stale (a button that moved, a tab that no longer exists, a new setting, route or
endpoint not described, a lifecycle that changed). Update text minimally, in the
existing voice; add a short section for each genuinely new user-facing feature.
Do not document internals in docs/user/. Build the docs site per CLAUDE.md.
Return: each doc change with the code change that motivated it, doc claims you could
not verify against the code, and the build result.
```

## §CHECKS — orchestrator re-run before every commit

The commands are the ones in `CLAUDE.md` → Commands: backend checks (cwd
`backend/`), frontend checks (cwd `frontend/`), docs build (cwd `docs/`).
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
