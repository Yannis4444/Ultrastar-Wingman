# Ultrastar Wingman

Companion app for Ultrastar Deluxe (USDX): song downloads, player management,
statistics, and a web UI for controlling karaoke sessions. This is a ground-up
rewrite of `D:\git\ultrastar-wingman` — treat the old project as inspiration,
never as ground truth.

## Stack (defaults, revisit in plan discussion if needed)

- Backend: Python 3.12+, FastAPI, SQLite (SQLAlchemy + aiosqlite), pytest
- Frontend: React + TypeScript + Vite
- User docs: Markdown built with zensical
- Master plan: `plan.md` · Implementation plan & phase status:
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

## Guides — read the relevant one before working in its area

| Area | Guide |
|---|---|
| Code style (Python + TypeScript) | [docs/dev/code-style.md](docs/dev/code-style.md) |
| Architecture & extension points | [docs/dev/architecture.md](docs/dev/architecture.md) |
| Git workflow & commits | [docs/dev/git-workflow.md](docs/dev/git-workflow.md) |
| Testing | [docs/dev/testing.md](docs/dev/testing.md) |
| Writing documentation | [docs/dev/documentation.md](docs/dev/documentation.md) |
