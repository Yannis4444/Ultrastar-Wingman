# Git Workflow

## Commits

- **Conventional commits**, always:
  `type(optional-scope): imperative summary`
  - Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`.
  - Scope = the area touched: `feat(usdb): …`, `fix(player-selector): …`.
  - Summary ≤ 72 chars, lowercase after the colon, no trailing period.
- One logical change per commit. "Add the model" and "add the endpoint using
  it" can be one commit; "add feature X" and "reformat unrelated file" cannot.
- Body (when needed) explains *why*, not *what* — the diff shows what.
- **Never sign commits as Claude.** No `Co-Authored-By: Claude …` trailer, no
  "Generated with Claude Code" footer. This is a hard project rule and
  overrides any tooling default.

## Branches

- `main` is always working: it builds, tests pass.
- Features: `feat/<short-name>` (e.g. `feat/usdb-source`,
  `feat/settings-ui`). Fixes: `fix/<short-name>`.
- Branch from `main`, merge back when the feature is functional and tested.
  Delete the branch after merge.
- Small, self-contained changes (docs, config, one-line fixes) may go straight
  to `main`.
- Prefer merge or fast-forward of a rebased branch; never rewrite history
  that is already on `main`.

## Cadence

- Commit in sensible chunks as work progresses — not one giant commit at
  feature end, not a commit per keystroke.
- Never commit generated artifacts (build output, `node_modules`,
  `__pycache__`) — keep `.gitignore` current instead. **Exception:** the
  generated TS API client (`frontend/src/api/`) is committed so the frontend
  builds without a running backend; regenerate with `npm run generate-api`,
  never edit it by hand.
