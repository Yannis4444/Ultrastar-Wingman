# Testing

Test what breaks silently and what others depend on. Don't chase coverage
numbers.

## Tools

- Backend: **pytest** + `pytest-asyncio`, `httpx.AsyncClient` against the
  FastAPI app for API tests. Test DB = fresh SQLite (in-memory or tmp file)
  per test session.
- Frontend: **vitest** + React Testing Library. Test behavior ("clicking spin
  selects a song"), not implementation (state variable names, DOM structure).

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
  new fixture.
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
- Fast: the backend suite should run in seconds. A slow suite stops being run.
- CI (when set up) runs ruff, mypy, pytest, eslint, tsc, vitest on every push;
  `main` must be green.
