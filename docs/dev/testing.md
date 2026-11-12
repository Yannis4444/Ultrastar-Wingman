# Testing

Test what breaks silently and what others depend on. Don't chase coverage
numbers.

## Tools

- Backend: **pytest** + `pytest-asyncio`, `httpx.AsyncClient` against the
  FastAPI app for API tests. Every test that takes `bootstrap_settings` (and
  so `client`, `anonymous_client`, `session`) gets a SQLite file of its own in
  its `tmp_path`, already at head — see [the test database](#the-test-database).
- Frontend: **vitest** + React Testing Library. Test behavior ("clicking spin
  selects a song"), not implementation (state variable names, DOM structure).

## The test database

Alembic walking every revision on an empty file used to be most of a test's
cost — about 0.55 s of the 0.75 s each one took, the suite eighteen minutes.
`conftest.py` now does that walk **once per session** and hands every test a
copy, and the whole suite runs in about two and a half minutes:

- `migrated_database` (session scope) runs `run_migrations` into a template
  file. Its result depends on nothing but the revision chain — a revision that
  imports live code (0023's `seed_rows()`) reads the same code all session.
- `bootstrap_settings` copies the template into the test's own `tmp_path`
  before anything starts, so every test still begins from a fresh, fully
  migrated database that no other test can see. The lifespan still runs
  `run_migrations` over it and finds it at head.
- The seed revisions stamp `created_at` with the time they ran: in a test that
  is the session's start, not the test's. Never assert on a seeded row's
  `created_at` against the clock.
- A test that needs an **empty** data directory, or the database at an older
  revision, does not take `bootstrap_settings`: it builds its own
  `BootstrapSettings` or alembic URL in `tmp_path`, like the `*_migrations`
  tests and `test_usdx_bundled` do. Those still migrate from nothing, which
  keeps the lifespan's own first-start path covered.
- Every SQLAlchemy engine in the test process runs with
  `PRAGMA synchronous = OFF` and `journal_mode = MEMORY` (a `connect` listener
  in `conftest.py`, never in the app): a test database needs no protection
  from a power cut, and the journal file every commit created, synced and
  deleted cost more than the statements. Neither pragma changes what a
  statement does or is stored in the file; a plain `sqlite3.connect` is not
  affected.
- Module state (the scan lock, the selection, the devices, the music…) is
  reset by the autouse `fresh_*` fixtures, because every test has its own
  event loop — a new piece of module state gets one too.

## Must be tested

- **Every extension-point implementation against its interface contract** —
  song sources, launcher, player selector, auth. One shared contract-test
  suite per interface, run against each implementation, so a new source can't
  quietly violate the contract.
- **Identity logic**: song ID parsing/formatting, matching downloaded folders
  to source songs, normalization of artist/title. This is the foundation of
  stats and playlists — it gets edge-case tests (unicode, weird USDB titles,
  duplicates).
- **Parsers of external data**: USDB HTML/responses, USDX song `.txt`
  metadata, config files. Fixture-based: check a real captured sample into
  `tests/fixtures/` and parse it. When the external format changes, capture a
  new fixture. The root `.gitattributes` marks that directory `-text`, so a
  fixture's bytes, line endings included, are the same on every checkout.
- **API endpoints**: happy path + authorization (a non-privileged user gets
  403) for every route. Permission checks are the one thing that must never
  regress silently.
- **Statistics writes**: a finished song produces exactly the expected rows.

## Doesn't need tests

- Trivial CRUD glue, one-line delegations, UI layout/styling.
- Live external services. Never call usdb.animux.de, YouTube, or a real USDX
  process in tests — that's what the interfaces and fixtures are for. Adapter
  code that only forwards to an external process is covered by manual testing
  and its contract tests against a fake.

## Rules

- A bug fix ships with the regression test that would have caught it.
- Tests are deterministic: no sleeps for synchronization, no dependence on
  wall-clock time or test order.
- Fast: a test pays for what it checks and nothing else. Setup every test
  shares, like a migration walk, is done once (see
  [the test database](#the-test-database)). A slow suite stops being run.
- CI (when set up) runs ruff, mypy, pytest, eslint, tsc, vitest on every push;
  `main` must be green.
