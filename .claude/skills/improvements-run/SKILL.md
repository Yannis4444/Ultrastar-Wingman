---
name: improvements-run
description: Work through a file of improvements, suggestions, wishes or bug notes autonomously — structure and order them into bundles, then implement one bundle at a time with Opus subagents (implement → adversarial review / browser verify), committing per bundle on a feature branch and merging into main at the end. Use when the user hands over a list of changes and wants the whole batch done without babysitting.
argument-hint: <path-to-improvements-file> [--plan-only] [--confirm-plan] [--no-merge] [--annotate] [--model opus|sonnet]
---

# Improvements run

You are the **orchestrator**. You never implement anything yourself. Every code, CSS,
doc and test change is made by a subagent launched through the `Workflow` tool. The
subagents are **Opus** (`model: 'opus'`, `effort: 'high'` on every `agent()` call)
unless the user passes `--model`; never downgrade a model to save cost or time —
the whole point of the run is quality without supervision. You: read, plan, launch
workflows, re-run the check suites, commit, keep the progress log, and report.
Invoking this skill is the user's explicit opt-in to multi-agent orchestration.

Input: `$ARGUMENTS` — the first token is the improvements file (free-form markdown:
headings per area, bullets per wish/complaint/question). Flags:

- `--plan-only` — do phases 0–1 (structure, order, overview) and stop.
- `--confirm-plan` — present the overview and WAIT for the user before building.
  Default is to present and proceed without waiting.
- `--no-merge` — leave the feature branch unmerged at the end.
- `--annotate` — tick finished bullets in the improvements file (`- [x]`) as
  bundles land. Default: the file is never touched.
- `--no-browser` — Chrome is unavailable: browser-verify bundles degrade to
  adversarial code review + unit tests, and the final report lists every layout
  claim as *unverified visually*.
- `--model X` — model for the subagents (default `opus`).

## Cost & pacing (so the user can decide the scale)

Today's reference run (improvements.md, 16 bundles + polish, 33 Opus agents):
~5.6M subagent tokens, ~12 h wall clock, 25–55 min per bundle (browser-verify
bundles are the slow ones). Each bundle is one workflow of 2–3 agents; the loop is
strictly sequential, so wall clock ≈ sum of bundles. State these expectations in
the overview (`N bundles ≈ N × 35 min`). If the user set a `+Nk` token target,
honour it via the workflow `budget` API and park the tail bundles as needs-user
rather than shrinking the review stage — never trade verification for coverage.

Read `templates.md` next to this file for the agent prompt templates before
launching anything.

## Hard rules (repeat them in every agent prompt)

- The improvements file is **never** committed or staged, and never modified
  unless `--annotate` is set.
- Agents **never** run `git add`/`git commit`. The orchestrator commits, one
  conventional commit per bundle, **no Claude trailer / "Generated with" line**
  (project rule — overrides harness defaults).
- Every agent must leave all check suites green before finishing; the orchestrator
  re-runs them anyway before committing. Agents use `Write`/`Edit` for files
  (PowerShell `Set-Content` mangles UTF-8). No new dependencies unless a bundle
  explicitly needs one — then the agent must justify it in its report.
- Agents never type real credentials; browser checks use the password-free host
  token flow. Agents must not leave downloads queued, settings changed, or test data
  behind — and the orchestrator does not trust their cleanup claims (see Finalize).
- One bundle at a time: workflows run sequentially. Inside a workflow at most 2–3
  agents (implement → verify, optionally a fix agent).
- **The user's live data is read-only for agents.** Anything that writes (settings
  toggles, players, playlists, downloads, sings) runs against a scratch data dir
  (`WINGMAN_DATA_DIR`) on alternate ports. Today's run left stray `Sing` rows in the
  real stats because this was only a recipe hint, not a rule.
- **Collateral changes are declared, not smuggled.** An agent may touch files
  outside its bundle only when the bundle cannot land without it (a shared component
  it must extract, a rename forced by a new page). Every such change goes under a
  `Collateral` heading in the report so the orchestrator can judge it — and split
  the commit if it is really a second logical change.

## Phase 0 — Intake

1. Read: the improvements file, `CLAUDE.md`, the dev guides it points to, and the
   auto-memory index (design preferences, conventions, testing tricks, pending user
   actions). Do a quick `ls` of the frontend/backend layout so bundle prompts can
   name real files. Do **not** read deeply — that is the agents' job.
2. Check `git status` is clean apart from the improvements file; note the current
   branch. Create `feat/<batch-slug>` from `main`.
3. **Pre-flight the environment** (five minutes that save an evening):
   - Run every check suite once and record the baseline in `run-plan.md`. A red
     baseline is reported to the user before anything starts; it also stops agents
     from waving real failures through as "pre-existing".
   - Sweep ports/processes for leftovers from earlier sessions (same commands as
     the Finalize sweep) so agents don't build their alternate-port workarounds on
     top of zombies, and so the user's own instance is identified and left alone.
   - If any bundle is browser-verify: confirm the Chrome extension answers
     (`tabs_context_mcp`) and note the user's live data dir so the scratch-dir rule
     can be stated concretely. No Chrome → tell the user and continue as
     `--no-browser`.
4. Call `advisor` once with the intended bundling before launching anything.

## Phase 1 — Structure & order

Turn the flat wish list into **bundles** (one workflow each). Rules of thumb:

- One bundle ≈ one view or one coherent mechanism; small enough that a single
  agent can implement + self-check it in one context. Split anything with more
  than ~5 bullets or with both a UI rework and a lifecycle/backend rework.
- **Order by dependency, not by file order**: settings/data model before the views
  that render from them; shared components (modal, icon set, checkbox, cover) before
  their consumers; small self-contained polish early (it de-risks the shared
  pieces); cross-cutting TV/host surfaces last; a final **polish** bundle for the
  punch list (see below) is always the last one.
- Tag each bullet as **spec** (do it), **question** ("what is X?", "doesn't look
  right") → the agent must *investigate, fix at the source, and report the cause*,
  or **needs-user** (cannot be done without a decision/credential) → park it.
- Tag each bundle **browser-verify** when a bullet says "layout is broken", "looks
  off", "restructure", "make it nicer", or touches a TV/phone surface — build
  output cannot judge those. Otherwise the verify agent does an adversarial code
  review + runs the suites.
- The binding design doc is `docs/dev/ui-guidelines.md` in the repo. If the batch
  contains design work the existing rules do not cover (new icons, a redesigned
  view), the first bundle is a **guidelines** agent (templates.md §GUIDELINES) that
  *extends* that file — committed as `docs(dev): …` before any pixel work. Every
  later prompt points at the file, never at a scratchpad or memory copy.

### How to approach design work

Design bullets are usually vague ("looks broken", "make it nicer", "a bit all over
the place"). The approach that produces consistent results:

- **Guidelines before pixels.** Nothing visual is built until the guidelines doc
  exists: real token names, an icon inventory with names *reserved* for this batch
  (so two agents never invent two glyphs for one meaning), the surface whitelist,
  and a per-view prescription for every area the batch names. Agents follow it and
  must *name every deviation* in their report with the reason.
- **Ground truth is the old app's look, not its code.** For anything the user asks
  to bring "back" (checkboxes, sorting, stats, host stats), the agent reads the old
  app's actual CSS/values and recreates them, then says what it found.
- **Restraint by default.** Flat surfaces, hairline separators, tiles only on the
  whitelist; icons + structure over words; never repeat a datum the surrounding view
  already shows; no per-row badges for near-universal attributes; one selection
  idiom per view (don't mix pills and radios on one page).
- **Reuse before inventing.** Shared components and classes first (`CheckOption`,
  `IconStat`, `CoverImage`, `PageHeader`, `ManageMenu`, `.icon-button*`); a second
  copy of a row/menu/CSS block is a drift bug, not a shortcut.
- **Define "done" before touching code.** For a vague bullet the implementer writes
  the concrete acceptance criteria into its report first (e.g. "no sideways scroll
  at 390px, actions pinned above the nav, slot rows 48px with hairlines") — the
  verify agent judges against those *and* the guidelines, harshly: "not broken" is
  not the bar, "clean and intentional" is.
- **Verify at the sizes people use**: 390px phone (iframe trick) and desktop for
  phone-first pages; 1280x720 and larger for the host/TV page; keyboard focus rings
  and reduced-motion for anything animated.
- **Honesty over decoration**: a number that can't be trusted is dropped rather than
  shown (e.g. the total time once elapsed overtakes it); a locked control looks
  locked and says why; empty/loading states are designed, not defaulted.

Write the plan to `<scratchpad>/run-plan.md` — numbered bundles with status boxes,
the shared preamble facts, a **Findings** list (answers to question-items), a
**Vetoable decisions** register, a **Needs user** list, and a **Punch list**. This
file is the resume point: on a fresh session, read it first and continue from the
first unchecked bundle.

Then post the **overview** to the user in this shape:

```
## Plan — N bundles on feat/<slug>
1. <name> — <bullets covered>           [browser-verify] [has questions]
2. ...
Order rationale: <2–3 lines>
Parked (needs you): <items or "none">
```

Stop here for `--plan-only`; wait here for `--confirm-plan`; otherwise continue.

## Phase 2 — Bundle loop

For each bundle, in order, launch one `Workflow`:

- `meta.name`: `improvements-NN-<slug>`; phases `Implement` + `Review` (or
  `Visual verify`); agent labels `impl:<slug>` / `verify:<slug>`.
- Implement agent: preamble (templates.md §PRE) + the bundle's bullets verbatim,
  plus guidance on where to look and what "done" means. Ask for a **report**: what
  it found, what it changed, files, check results, decisions the user may veto,
  things noticed but not changed.
- Verify agent: preamble + browser recipe if tagged (templates.md §BROWSER) + the
  implementer's report interpolated + an explicit adversarial checklist (correctness,
  permissions/gating, guideline violations, tests, empty states, 390px overflow /
  TV readability). It **fixes** what it finds, re-runs the suites, and returns a
  one-line conventional commit message.
- The workflow returns `{impl, verify}`; it runs in the background — end your turn
  and continue on the completion notification. Never fabricate a pending result.

On completion:

1. Read the tail of the report (`tasks/<id>.output`; use a UTF-8-safe reader —
   Windows `python -c` needs `sys.stdout.reconfigure(encoding='utf-8')`).
2. **Re-run every check suite the diff touches yourself** (commands in
   templates.md §CHECKS). If red → launch a small fix workflow; do not fix by hand.
3. `git status` — stage only the intended paths (`git add backend docs frontend/src`
   style; never `-A`, never the improvements file, never temp vite configs), commit
   with the agent's message (edit it if it only describes the reviewer's fixes).
4. Update `run-plan.md`: tick the bundle, append findings / vetoable decisions /
   punch-list nits / needs-user items harvested from the reports. With
   `--annotate`, tick the bundle's bullets in the improvements file.
5. Post a **progress report**:

```
**Progress: k/N committed.** <bundle name> → `<hash>`
- Headline: <the one thing worth knowing — a root cause, a real bug the reviewer caught>
- Decisions to veto: <or "none">
▶ Now running: <next bundle> (<browser-verify?>)
```

Empty or null agent results: read `<transcriptDir>/journal.jsonl` before
diagnosing; resume with `resumeFromRunId` after editing the script file.

## Phase 3 — Polish, docs sweep & finalize

1. Launch the **polish** workflow with two sequential agents:
   - **Polish** — the accumulated punch list (nits reviewers flagged outside their
     bundle, glyphs that read wrong, spacing mismatches between views).
   - **Docs sweep** — an agent that reads the full batch diff (`git diff main...HEAD
     --stat` and the commit list), then hunts `docs/user/` and `docs/dev/` for
     statements the batch made stale: renamed/moved views and routes, relocated
     buttons, removed tabs/chips, new settings, changed behaviours (retention,
     deletion steps), new capabilities. It updates text minimally in the handbook's
     own voice, adds a section for genuinely new features, leaves dated phase logs
     alone except for now-false parentheticals, and runs the strict docs build. It
     reports what it changed and any doc claims it could not verify.
   Then a review agent checks both (templates.md §VERIFY) and runs all suites.
2. Full sweep: all backend + frontend suites + docs build (templates.md §CHECKS).
3. Audits — all must be empty:
   `git log main..HEAD --format=%B | grep -i claude`
   `git log HEAD --format= --name-only | grep <improvements-file>`
   `git log HEAD..main --oneline` (main has not moved)
4. Call `advisor` before the merge.
5. `git checkout main && git merge --no-ff feat/<slug> -m "<type>: merge the <batch> — <3-word gist>"`
   (mirror the message style of previous merge commits: `git log --merges -3`),
   delete the branch, run a build+test smoke on main. Do **not** push.
6. **Port/process sweep** — agents' "servers killed" claims are unreliable:
   `netstat -ano | grep -iE ":(8080|8081|8087|8099|5173|5188|5189|5194)\s" | grep -i listen`
   plus `Get-Process node,python | select Id,StartTime,CommandLine`; identify the
   command line and parent process before killing anything; kill only
   Claude-started vite/backend processes (temp `vite.*.config.ts`, started during
   the run). Delete leftover temp configs and scratch data dirs.
7. Update memory — see "What to write down" below.

## What to write down (memory) — and what not to

Save at the end of the run (and immediately for anything a session restart would
lose):

- **Vetoable decisions** — one project memory per run (`improvements-run-<date>`)
  listing every agent judgment call the user hasn't reviewed, so a future "why does
  X do this?" gets "an agent decided, here's why" instead of a shrug — and reversing
  one is never treated as a regression.
- **Pending user actions** — update the existing memory: restarts needed, residue
  in live data (stray rows, changed settings), credentials to rotate, manual checks
  only the user can do, items parked as needs-user. Remove items that got resolved.
- **Durable lessons** (feedback type, with *why* and *how to apply*): anything the
  run got wrong and future runs must not — leaked servers, a check that lied, a
  convention agents kept breaking, a tool quirk (UTF-8 readers, heredoc limits).
- **Artifacts that live only in the scratchpad** — anything agents must reuse and
  that is not repo material goes into the memory dir with a one-line index entry;
  the scratchpad dies with the session. Design rules, testing tricks and commands
  are repo material: they belong in `docs/dev/` (ui-guidelines, verifying,
  recipes) and `CLAUDE.md`, where subagents can read them — memory is invisible
  to them.
- **Extend, don't duplicate**: check the memory index for an existing file on the
  topic first; update it; delete memories the run proved wrong.

Do **not** save what the repo already records: code structure, what each commit
changed, test counts, the bundle list (git log has it), or anything only relevant
to this conversation. If tempted, ask what was *non-obvious* about it and save that.

## Final report

```
## Done — <N> bundles merged into main (<merge hash>, <k> commits)
Checks: <backend counts> · <frontend counts> · docs build
### Answers to your questions
- <question item> — <root cause and what changed>
### Notable catches by the reviewers
- ...
### Decisions made in your absence — veto anything you dislike
1. ...
### On your machine
- restarts needed, residue in live data, files left untracked, anything parked as needs-user
```

## Failure & edge handling

- A bundle needs credentials, an external account, or a product decision → park it
  under **Needs user**, keep going, surface it in the final report.
- A verify agent could not test something (no login possible, USDX would launch) →
  it must say so explicitly; carry that into the report as "unverified".
- Agents starting real processes (USDX, downloads) must stop them and prove it
  (`tasklist`); the orchestrator still sweeps at the end.
- Context gets summarized mid-run: `run-plan.md` + `git log` are the source of
  truth; re-read them and continue from the first unchecked bundle.
- If the user appears mid-run with a correction, apply it to remaining bundles
  (update the preamble facts in `run-plan.md`) — do not redo finished ones unless
  asked.
