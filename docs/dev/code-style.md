# Code Style

Enforceable rules only. If a rule can't be checked by a tool or in review, it
doesn't belong here.

## General (both languages)

- Prefer the standard library, then an already-installed dependency, then new
  code. Adding a new dependency needs a reason a few lines of code can't cover.
- No speculative abstractions: no interface with one implementation *unless*
  it is one of the named extension points in
  [architecture.md](architecture.md) (song sources, launcher, player selector,
  auth provider, settings). Those start as interfaces from day one.
- Boring over clever. Deletion over addition. Smallest diff that solves the
  whole problem (root cause, not the symptom).
- Comments explain constraints the code can't show ("USDX writes this file
  with BOM", "API rate-limits at 10/min") — never restate the code.
- Names spell things out: `download_queue`, not `dlq`.

## Python

- Python 3.12+. Full type hints on all public functions, methods, and module
  attributes. Untyped code fails review.
- **ruff** for linting *and* formatting (no black, no isort — ruff does both).
  Config lives in `pyproject.toml`:
  - line length 100
  - rule sets: `E`, `F`, `I`, `UP`, `B`, `SIM`, `ASYNC`
- Type check with **mypy** in strict-ish mode (`disallow_untyped_defs = true`).
- Pydantic models for all API request/response bodies and external data
  (USDB responses, config files). Parse, don't validate by hand.
- `async def` throughout the FastAPI layer; never call blocking I/O
  (`requests`, `subprocess.run`, file reads of large files) in an async path —
  use `httpx.AsyncClient`, `asyncio.create_subprocess_exec`, or
  `anyio.to_thread.run_sync`.
- Logging via the `logging` module, one logger per module
  (`logger = logging.getLogger(__name__)`). Never `print()` outside CLI entry
  points.
- Raise specific exceptions; define domain exceptions where callers need to
  distinguish failure modes (e.g. `SongNotFoundError` vs `DownloadError`).
  Never `except Exception: pass`.
- Paths are `pathlib.Path`, never string concatenation.

## TypeScript / React

- TypeScript strict mode (`"strict": true`), no `any` — use `unknown` and
  narrow.
- ESLint (typescript-eslint recommended) + Prettier defaults. Don't argue with
  the formatter.
- Function components + hooks only. No class components.
- Server state lives in a data-fetching layer generated from the backend's
  OpenAPI schema — never hand-write API request types; regenerate them.
- Component files: one exported component per file, named the same as the
  file, `PascalCase.tsx`.
- Local UI state with `useState`/`useReducer`; reach for a state library only
  when prop-drilling actually hurts, and discuss it first.
- CSS: keep the existing Wingman visual design (see plan.md — the user likes
  it). Prefer plain CSS/CSS modules over a styling framework.

## API design (REST)

- Nouns for resources, plural: `/api/songs`, `/api/playlists/{id}/entries`.
- Verbs only for true actions that aren't CRUD: `POST /api/songs/{id}/sing`.
- Every endpoint declares a `response_model`; errors use FastAPI
  `HTTPException` with a machine-readable `detail`.
- Version the API from the start: everything under `/api/v1/…` — the NFC
  selector and other external devices will depend on it.
- Auth/permission checks are FastAPI dependencies, not inline `if` checks in
  handlers.
