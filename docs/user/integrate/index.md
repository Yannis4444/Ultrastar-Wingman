---
icon: wingman/database
---

# Integrate

This section is for people building something around Wingman: a Discord bot, a
stream overlay, a bulk importer. It assumes you know HTTP and JSON, and that
you can read an OpenAPI document. The rest of the site is written for the
people at the party, and this section is not.

Wingman is one program on the karaoke PC, and it opens itself to programs
outside it. It serves a REST API under `/api/v1`, described by an
OpenAPI document it serves itself. It pushes live events over one WebSocket, so
an overlay never has to poll. It keeps everything it remembers in a plain
SQLite file. It reads songs out of plain folders on disk, and it takes a few
environment variables when it starts.

## What this section promises

Every fact on these pages comes from the code that runs. Endpoints are named
the way the app registers them. Payload fields are named the way the app
spells them.

None of it is a promise about tomorrow. The API moves with the app, and so does
the database. The OpenAPI document the running app serves is the contract, and
it is right about the build in front of you. Read it there rather than trusting
a copy.

The database is the app's own store. Outside tools read it. Nothing outside
Wingman writes to it, and its tables change whenever the app needs them to.

## What it does not cover

This section describes what you can build on. It does not describe how Wingman
is built, and it is not a tour of the source code.

## The pages in this section

- [The REST API](rest-api.md): the base path, the OpenAPI document, the shape
  of a request and of an error, and what each family of endpoints holds.
- [Authenticate a script](authentication.md): logging in, keeping the session
  cookie, and what your account is then allowed to do.
- [Live events](events.md): the WebSocket endpoint and every event it sends.
- [Files and configuration](files.md): the data directory, the database, the
  song folders, and the environment variables.
