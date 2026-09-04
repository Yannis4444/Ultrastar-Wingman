# The REST API

Everything Wingman's own web app does, it does over this API. Your script gets
the same one.

## Base path and schema

Every endpoint sits under `/api/v1`, on the address and port that serve the
app. On the karaoke PC that is:

```text
http://localhost:8080/api/v1
```

The app serves its own OpenAPI document, and two pages that render it. The
document sits under the base path, and the two pages sit at the root:

```text
http://localhost:8080/api/v1/openapi.json
http://localhost:8080/docs
http://localhost:8080/redoc
```

`/docs` is the interactive one. It lists every endpoint, its parameters, its
payloads, and it sends a real request when you ask it to. That is the
per-endpoint reference, and this page does not repeat it.

## How the API is shaped

- A resource is a plural noun: `/songs`, `/players`, `/playlists`, `/tags`.
- A verb appears only for an action that is not a resource: `/songs/rescan`,
  `/karaoke/sing`, `/karaoke/stop`.
- `GET` reads, `POST` creates or acts, `PATCH` changes part of a row, `PUT`
  sets or replaces one, `DELETE` removes one.
- Requests and responses are JSON. Files are the exception: pictures, covers,
  audio, and the achievement archives are sent and served as files.
- A response says `201` for something created, `202` for something started that
  finishes on its own, and `204` when there is nothing to return.
- Wingman answers as whoever your cookie says you are. A caller with no cookie
  is the `guest` role rather than a rejected request. See
  [Authenticate a script](authentication.md).

## What an error looks like

An error is an HTTP status plus a JSON body with one `detail` field. For
everything your script has to branch on, `detail` is a short machine-readable
string:

```json
{"detail": "missing_permission:settings.view"}
```

- `401` with `not_authenticated`: the route wants an account and you have none.
- `403` with `missing_permission:<capability>`: you are somebody, and that
  somebody may not do this. The capability after the colon is the exact one.
- `404`: unknown id. A song that a tag hides from you answers `404` as well, so
  the id itself gives nothing away.
- `409`: the request conflicts with what is already there, as in
  `already_wished` or `song_file_changed`.
- `422`: the body itself is wrong. This one comes from the validation layer, so
  `detail` is a list of objects naming the field, not a string.

## The families of endpoints

Every row is a family. The capability column names what the reads take, then
what the writes take. Reads and writes that take no capability say so.

| Path | What it holds | Capability |
|---|---|---|
| `/songs` | The library, one row per song, plus each song's cover and audio | `songs.view`, then `songs.rescan`, `songs.edit`, `songs.delete` |
| `/songs/{song_id}/comments` | What people said about a song | `songs.view`, then `comments.write` and `comments.moderate` |
| `/songs/{song_id}/tags/{tag_id}` | Putting a tag on a song, and taking it off | `songs.view`, plus the right to set that one tag |
| `/tags` | Tags, who they are for, and the built-in marks and facets | `songs.view`, then `tags.manage` |
| `/wishlist` | What the party wants to sing tonight | `wishlist.view`, then `wishlist.add` and `wishlist.manage` |
| `/favorites` | The caller's own favorites | None, but an account is required |
| `/playlists` | Playlists, their songs, and the people they are shared with | `playlists.view`, then `playlists.manage` and `playlists.moderate` |
| `/players` | The people a score is filed under, and their pictures | `players.view`, then `players.manage` and `players.avatar` |
| `/karaoke` | The running song: `sing`, `stop`, `current`, slots and colors | `songs.view` and `players.view` to read, then `karaoke.sing` and `karaoke.stop` |
| `/downloads` | The download queue and what it is doing | `downloads.view`, then `downloads.manage` |
| `/sources` | Searching USDB, the source those downloads come from | `usdb.search` |
| `/stats` | Parties and their scores, and the two corrections to one | `stats.view` and `stats.history`, then `stats.manage`, `stats.hide` and `stats.moderate` |
| `/achievements` | The catalog of achievements, and what a player earned | None to read, `achievements.manage` to write |
| `/settings` | Every setting the app has | `settings.view`, then `settings.manage` |
| `/auth`, `/users`, `/permissions` | Accounts, logging in, roles, and what a role may do | None for `/auth`, then `users.view`, `users.manage`, `permissions.manage` |
| `/join` | The address the QR code on the TV carries | None |
| `/health` | The name and version of the running app | None |

The OpenAPI document does not carry these capabilities. A refused request does.
Its `403` body names the exact one the endpoint wanted, which is the fastest
way to find out.

One name in the paths does not match the word the rest of the site uses. What
the site calls a party is a `session`, in `/stats/sessions` and in every
`session_id` field. One run of one song is a `sing` on both sides, and a score
points at a `sing_id`.

`GET /stats/sessions` leaves out the parties somebody took off the list on the
Scores tab. `?include_hidden=true` asks for them too, and is answered only for a
caller who holds `stats.hide`; anybody else gets the short list whatever they
ask. `session_count` and `score_count` next to the rows count every party the
caller may open, the ones off the list included, because `GET /stats/scores`
adds all of them up. Taking a party off the list reaches that one listing and
nothing else.

In Windows PowerShell, `curl` is the name of a different command. Write
`curl.exe` there.

!!! example "List the songs, then wish for one"
    Ask for the library, then put the first song on the wishlist. By default
    wishing takes no account, so this works with no cookie at all.

    ```bash
    curl http://localhost:8080/api/v1/songs

    curl -X POST http://localhost:8080/api/v1/wishlist \
      -H "Content-Type: application/json" \
      -d '{"song_id": "local:10ffd97ea6024b4caf6af5c907cd42c1"}'
    ```

    The second call answers `201` and the wish as the party sees it:

    ```json
    {"song": {"id": "local:10ffd97ea6024b4caf6af5c907cd42c1", "source": "local", "title": "Sandstorm", "artist": "Darude", "duration_seconds": null, "has_video": false, "is_duet": false, "language": "English", "genre": "Dance", "year": 1999, "edition": null, "creator": null}, "count": 1, "latest": "2026-09-03T03:05:44.281549Z", "mine": true}
    ```
