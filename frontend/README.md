# Ultrastar Wingman — Frontend

React + TypeScript + Vite. Talks only to the backend's REST API under
`/api/v1` and its WebSocket at `/api/v1/ws`.

## Commands

| Command                                   | What it does                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `npm install`                             | Install dependencies.                                                                                                   |
| `npm run dev`                             | Dev server on <http://localhost:5173>, proxying `/api` (HTTP **and** the WebSocket upgrade) to `http://localhost:8080`. |
| `npm run build`                           | Type-check (`tsc -b`) and build to `dist/`.                                                                             |
| `npm test`                                | Run the vitest suite once.                                                                                              |
| `npm run lint`                            | ESLint.                                                                                                                 |
| `npm run format` / `npm run format:check` | Prettier write / check.                                                                                                 |
| `npm run generate-api`                    | Regenerate the API client into `src/api/`.                                                                              |

## Generating the API client

`npm run generate-api` reads
`http://localhost:8080/api/v1/openapi.json`, so **the backend must be
running**. Config lives in `openapi-ts.config.ts`. Never hand-write request or
response types — regenerate them.

The output in `src/api/` is committed, so `npm run build` and CI work without a
live backend; regenerate and commit whenever the API changes. The client is
generated with `baseUrl: false`, so requests are same-origin — in dev the vite
proxy forwards them to port 8080; the packaged build will serve bundle and API
from the same origin.

## Pinned versions

`vite@6` and `jsdom@26` are deliberate: Vite 7 and jsdom 27+ require Node
`>=20.19`, and this project is developed on Node 20.12. Once the dev Node is
bumped, both can move to latest.

## Layout

- `src/pages/` — one component per route (`/`, `/songs`, `/scores`, `/user`).
- `src/components/` — shared components, each with its own plain `.css` file.
- `src/hooks/useWingmanEvents.ts` — `useWingmanEvent(name, handler)`
  subscribes to a backend event. One shared socket, opened on the first
  subscription, reconnected with exponential backoff (1s → 30s).
- `src/api/` — generated client, not hand-edited.

The theme is dark-only; the design tokens (`--bg`, `--tile-bg`, the
`--highlight-*` pairs, …) live in `src/index.css`.

### WebSocket message contract

Server to client only. Each message is flat JSON with an `event` discriminator
and its payload fields alongside — `{"event": "server.ready", "version": "…"}`
on connect, `{"event": "setting.changed", "key": …, "value": …}` on a settings
change. The handler receives the whole message and narrows it by event name.
Anything a client sends is dropped by the backend.
