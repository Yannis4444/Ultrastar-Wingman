# Achievements

What a player earns by singing. This guide is the design: the data model, the
evaluation engine and when it runs, the progress rules, and the import/export
format. Read it before touching `backend/src/ultrastar_wingman/achievements/`
or any of the frontend surfaces that draw a badge.

## What an achievement is

One row in `achievements`, made of two halves:

* **presentation** — name, description, icon, colour, `hidden`, `enabled`;
* **definition** — a list of *conditions*, all of which must hold, stored as
  one JSON column.

The definition is never queried in SQL. It is evaluated in Python against the
scores a player already has, so a relational table per condition would buy
nothing and cost a migration every time an operator is added. The JSON is
exactly what the export archive carries, which makes export → hand-edit →
import a round trip.

## Conditions

```json
{
  "scope": "session",
  "metric": "any_score",
  "comparator": ">=",
  "value": 9000,
  "score_filter": { "min": 9000, "max": null },
  "songs": { "ids": ["usdb:1234"] },
  "match": { "combine": "all", "clauses": [] }
}
```

| Field | Meaning |
|---|---|
| `scope` | `global` — every score the player ever got. `session` — the condition has to hold inside **one** party; which party is the same for every condition of the achievement (a `GROUP BY session HAVING …`, not one party per condition). |
| `metric` | What is measured over the scores the filters left. See the table below. |
| `comparator` | `>` `>=` `=` `<=` `<` |
| `value` | The number compared against. |
| `score_filter` | Optional `min` / `max` — drops scores outside the range **before** the metric is computed. "Ten scores above 9000" is `number_of_scores >= 10` with `score_filter.min = 9000`. A `min` above the `max` is refused: no score survives it, so the condition could never be satisfied by anybody. |
| `songs` | Optional. An explicit list of song ids the scores must be on. |
| `match` | Optional. A selector over song metadata instead of a list. `songs` and `match` are mutually exclusive — the editor switches between them. |

### Metrics

| Metric | Over the surviving scores |
|---|---|
| `any_score` | The best one for `>` / `>=`, the worst one for `<` / `<=`, and with `=` the question "does some score equal this" — *any* is the word in all three cases. There is no separate "highest"/"lowest" metric: which end is meant is what the comparator already says. |
| `sum_of_scores` | Their total. |
| `average_score` | Their mean, rounded down. Zero scores never satisfy it — an average of nothing is not a number. |
| `number_of_scores` | How many there are. |
| `number_of_sings` | How many distinct sings they belong to. A duet scored twice is one sing. |
| `different_songs` | How many distinct `song_id`s. |
| `different_artists` | How many distinct artists, compared case-insensitively. A song that has left the library carries no artist and counts for nothing. |

### The song selector

```json
{
  "combine": "all",
  "clauses": [
    { "field": "genre", "op": "equals", "value": "Rock" },
    { "field": "title", "op": "contains", "value": "love" }
  ]
}
```

`combine` is `all` or `any` — one flat list, no nesting. Fields are the ones
`SongRead` already carries: `title`, `artist`, `genre`, `language`, `edition`,
`year`, `is_duet`, `has_video`. Operators are `contains`, `equals`,
`starts_with` for text (all case-insensitive), `equals` for the two booleans,
and `=` `>=` `<=` for `year`.

A clause whose field is missing on the song never matches — a song with no
genre is not "genre equals anything".

## Who earns them

**Players**, not accounts: `scores.player_id` is what an achievement is keyed
on, so a guest player who sang tonight earns badges the host screen can show,
and a registered account sees them on its user page through its player.

Two scores earn nothing and this is deliberate:

* a score whose `player_id` is NULL — USDX scored under a name matching no
  launched slot, and Wingman has no idea who that was;
* a score on a song that has left the library, **for a condition that filters
  by song** — the metadata row it would be matched against is gone. Unfiltered
  conditions still count it: it was still a score somebody got.

## When achievements are evaluated

Evaluation is **recomputation from the scores**, never an incremental counter.
For one player it is one query and a pass in memory, and it is what makes the
following correct for free — a counter would drift on every one of them:

* the global toggle being switched off and on again;
* an achievement's definition being edited, or a new one imported;
* `stats.moderate` reassigning a score to another singer, or deleting one.

### The triggers

| When | Who is re-evaluated |
|---|---|
| A sing finishes (`karaoke.service._finish`, right after `scores.recorded`) | Every player scored in that sing. |
| A score is reassigned (`PATCH /stats/scores/{id}`) | The old player **and** the new one. |
| A score is deleted (`DELETE /stats/scores/{id}`) | The player it was on. |
| An achievement is created, edited, imported, reset, enabled or disabled | Every player, as a background pass. |
| The global toggle is switched **on** | Every player, as a background pass. |

Three of those are worth spelling out.

* **Deleting** one starts no pass: its `player_achievements` rows go with it,
  and nothing about anybody else changed.
* **An icon** — uploaded or removed — starts none either. What an achievement
  looks like has nothing to do with who has earned it.
* Switching the toggle **off** starts none: nothing is evaluated while it is
  off, and the badges are kept. Switching it back on is the pass that brings
  them up to date.

The background pass is a tracked `asyncio.Task` per write (`start_full_pass`),
logged on failure and cancelled at shutdown before the engine goes — never
fire-and-forget. A module-level `asyncio.Lock` serialises the write half of
every pass: a finishing sing and a `stats.moderate` correction can otherwise
both find no row for a player and both insert the same composite primary key.

Nothing is broadcast when a pass *finishes*. `achievements.earned` belongs to a
sing, and a pass over the whole record has no sing to name — the write that
started it has already said what a client needs to hear.

### The pass

For each player: one query pulls their scores joined to their sings and to the
songs those sings were on, and the rows are grouped by `session_id` in memory.
Every enabled achievement is then evaluated against that set. A party of four
with a few hundred scores each and fifty achievements is a few hundred
thousand comparisons — microseconds, and no cache to invalidate.

`session`-scoped achievements are satisfied when **any one** session satisfies
every session-scoped condition of that achievement; global conditions in the
same achievement are checked over everything. An achievement mixing both is
legal and means "this much tonight, by somebody who has also done that much
overall".

### Revocation

Recomputation is the truth. An achievement whose conditions no longer hold has
its `earned_at` cleared — the only way a mis-attributed score can be fully
corrected. The row itself stays, because it still carries the progress; and
one that is earned again is stamped with a **fresh** `earned_at`. There is no
memory of the first time: the moment an achievement was earned is not derivable
from the scores, so a date that survived its own revocation would be a claim
the data cannot back.

## Progress

Stored per (achievement, player) so the user page never recalculates.

A condition has a progress fraction only when it is **monotone in the right
direction**: a growing metric (every one but `any_score` with a `<`
comparator) compared with `>` or `>=`. `=`, `<` and `<=` have none — there is
no progressing toward *fewer*, and a bar that fills as you get worse would be
a lie.

* A condition's progress is `min(current, target) / target`.
* An achievement's progress is its **least complete** condition — all of them
  have to hold, so the weakest is the honest number.
* For `session` scope it is the best any **single** session reached, the
  current party included.
* An achievement with no progressible condition stores `NULL` and draws no
  bar.
* A `hidden` achievement draws no bar until it is earned — a bar would leak
  what it is for.

## Hidden achievements

`hidden` is enforced by the API, not by the UI. `GET /achievements` blanks
`name`, `description` and `icon` (and `has_image` / `icon_version`) on a hidden
achievement the caller has not earned. A client that ignored the flag would
otherwise spoil every surprise.

"The caller" is the caller's **own player**, resolved the way `stats/api.py`
resolves one: an account linked to a player. A guest phone and the host screen
have no player and have therefore earned nothing.

That is the answer **everybody** gets, an administrator and the host screen
included. Holding `achievements.manage` is not the same as using it: the same
listing feeds the user page and the TV, and a hidden achievement spelled out
there — on the phone of the one person who is always signed in as an
administrator, or across the room on the projector — is the surprise gone for
the whole party.

Unmasking is therefore something a caller *asks* for:
`GET /achievements?manage=true` answers with every row whole and every row's
`definition`, takes `achievements.manage` (403 without it), and is asked for by
exactly two surfaces — the achievements admin page and its editor
(`achievements.MANAGE_CATALOGUE` in the frontend). It is a separate query, so
the masked listing and the managing one are two cache entries rather than one
overwriting the other.

`GET /players/{id}/achievements` masks over the **subject** instead — it is
that player's record, not the reader's, and a manager reading it is a reader
like any other — and nulls `progress_current` / `progress_target` on a masked
row as well, because a bar that filled would say what the badge is for as
loudly as its name would. It carries no `definition` for anybody: what an
achievement asks for is the management page's business, and that page reads the
catalogue.

`definition` is never in a masked row, and never on the event bus either: the
bus is open to anonymous clients, and what a hidden achievement asks for is the
surprise itself.

`GET /achievements/{id}/icon` is masked as well — a masked row still carries
its id, so "you would have to know the id" protects nothing, and an uploaded
picture gives the surprise away as loudly as the name would. It is the one
place where the rule is "once **anybody** has earned it" rather than "once the
caller has": earning one announces it to every socket, and a phone drawing
somebody else's badges has to be able to draw this one. A kept-back picture is
the same 404 as no picture at all.

It is also the one place where holding `achievements.manage` is still enough on
its own, with no `manage=true` to ask with: an `<img>` src carries no query of
the client's, and the management page has to be able to draw the picture of the
achievement it is editing. Nothing leaks by it — a masked row answers
`has_image: false`, so no singer-facing surface ever builds this URL for a
hidden achievement.

## Settings

The global toggle and the host-screen timing are **not** on the Settings page.
They live in a private `SettingDefinition` dict inside `achievements/`, exactly
like `tags/builtin.py`: read by everybody on `GET /achievements` (the host
screen and every phone need them), written only through `achievements.manage`.

| Key | Default | What |
|---|---|---|
| `achievements.enabled` | `true` | Achievements off for the whole instance: nothing is evaluated, nothing is drawn. |
| `achievements.host_seconds_base` | `4` | Seconds a row of badges stays on the host screen. |
| `achievements.host_seconds_per_badge` | `2` | Added to it for each badge in the row. |

## Permission

One capability, `achievements.manage`, in no role bundle — like
`songs.delete` and `stats.moderate` it starts with nobody but the
administrator. Reading the catalogue and a player's badges needs no capability
at all: the host screen and every guest phone draw them.

It still needs a seeding migration (0024). An administrator holds every
capability because `ADMIN` is `ALL_CAPABILITIES` and not because a row says so,
but `role_permissions` is seeded literally for every role including `admin`
(migrations 0006 to 0020 do the same), and `test_permissions` compares the two.

## The events

Two of them, and they say different things. `achievements.earned` says somebody
*reached* one; `achievements.changed` says the catalogue itself is different now.

### `achievements.earned`

One per **sing**, not per player, so the host screen's choreography cannot race:

```json
{
  "event": "achievements.earned",
  "sing_id": "…",
  "players": [
    { "player": { … }, "achievements": [ { … } ] }
  ]
}
```

Broadcast from `_finish` after `scores.recorded`. It goes to every socket:
earning a hidden achievement reveals it, and the scores it was earned from are
already on the bus.

### `achievements.changed`

```json
{ "event": "achievements.changed" }
```

No payload at all, for the same reason `tags.changed` has none: what a listener
may see of the catalogue is masked **per caller**, and the bus does not know who
is on the other end. A row that is whole for the player who earned it is blank
for the stranger beside them, so there is nothing one payload could carry that
would be right for both. Every client refetches `GET /achievements`, which masks
for whoever asks.

Broadcast from every write that changes what `GET /achievements` answers, and
from nothing else:

| Write | Why it changes the answer |
|---|---|
| `POST /achievements` | A row appeared. |
| `PATCH /achievements/{id}` | Any field of it, the `enabled` flag included. |
| `POST /achievements/{id}/reset` | A built-in is back to what Wingman ships — a new name, a new colour and new conditions in one write. |
| `DELETE /achievements/{id}` | A row went. |
| `PUT /achievements/{id}/icon` | `has_image` flipped, and the picture behind it is a different one. |
| `DELETE /achievements/{id}/icon` | `has_image` flipped back. |
| `PATCH /achievements/settings` | The settings ride along in the same answer — and `enabled` decides whether anything is drawn at all. |

A refused write sends nothing: a 409 on a built-in delete, a 409 on a
`definition` sent to a built-in, a 409 on a reset of something nobody ships, a
422 on a definition the models reject and a 404 on an unknown id all changed no
row. Neither does a settings PATCH that named no field.

## Import and export

A `.tar.gz` holding one directory per achievement:

```
builtin-score-9000/achievement.json
builtin-score-9000/icon.png          (only when the achievement has an uploaded icon)
```

`achievement.json` is the presentation fields plus the definition, in the
shape this document describes. **JSON, not YAML** — a YAML emitter is not a
few lines of code and the project takes no dependency it can avoid
(code-style.md).

The format layer is `achievements/archive.py` and knows nothing of FastAPI, of
the database or of the filesystem: it turns rows into bytes and a stranger's
bytes back into achievements. `service.export_archive` /
`service.import_archive` are what read the icons off the disk and write the
rows; `POST /achievements/export` and `POST /achievements/import` are the two
routes over them.

### The file

```json
{
  "id": "builtin-score-9000",
  "name": "Golden Voice",
  "description": "Score 9,000 or more in a song.",
  "icon": "trophy",
  "color": "gold",
  "hidden": false,
  "enabled": true,
  "sort_order": 3,
  "definition": [ … ]
}
```

Two spaces of indent, no escaped non-ASCII and a trailing newline: the point
of a directory of small files is that a person opens one, understands it and
edits it. Unknown keys are **refused**, not ignored — a `"colour"` that was
quietly dropped is exactly the mistake a hand-edited file invites, and a
rejection that names the key is one keystroke from a fix. A UTF-8 BOM is read
past rather than refused — a Windows editor writes one in front of what it
saved, and a format meant to be hand-edited cannot fall over it.

The directory name is the id and has to equal the `id` in the file. That is
what stops two directories being the same achievement, and what catches a
directory copied to make a new achievement whose id was never changed with it.

`built_in` is **not a field**. An imported achievement is one of the shipped
set if and only if its *id* is one Wingman ships (`builtin.BY_ID`) — a flag in
a file a stranger wrote would otherwise be a way to mint an undeletable row.
Writing `"built_in"` into the JSON is therefore a rejection like any other
unknown key rather than a field that silently does nothing.

Export is **deterministic**: members sorted by id, no gzip filename, and a
zeroed mtime, owner and mode on every tar header. The same catalogue exported
twice is the same bytes, so two archives are diffable.

### Export

`POST /achievements/export`, `achievements.manage`. The body names the ids
(at least one); an id the catalogue does not hold is a 404 naming it, rather
than an archive quietly missing one of the achievements that were asked for.
The answer is the archive as an attachment.

It needs the *write* capability although it only reads, because an archive
carries the two things `GET /achievements` deliberately keeps back: every
achievement's `definition`, and the unmasked name and description of a
`hidden` one.

An export is a faithful copy of the row, definition column included — one
somebody hand-edited into a shape the condition models refuse comes out as it
stands, so it can be fixed in the archive.

### Import

`POST /achievements/import`, `achievements.manage`, one multipart file.
Matched **by id**: a known id is updated in place, an unknown one is created.
That is what makes export → hand-edit → import a round trip and what lets a
built-in be shared between instances. The answer names what happened —
`{"created": [...], "updated": [...]}` — so the page can say something true
rather than "done".

The one field an archive cannot carry into the catalogue is a **built-in's**
`definition`. It is still in the file — an export is a faithful copy of the row,
and that is what keeps the round trip a fixed point — it simply has no effect on
one of the seventeen shipped ids. See the table.

| What it meets | What it does |
|---|---|
| An existing ordinary row | Updates every presentation field **and** the definition, exactly as `PATCH` would. |
| An existing **built-in** | Updates every presentation field the same way and **leaves its conditions where they are**, `built_in` included: what one of the shipped seventeen asks for is `builtin.py`'s, and an `achievement.json` in a text file would otherwise be the way straight round the 409 `PATCH` gives. The row still counts as updated — it really did change, only not there — and the skipped definition is logged. |
| An unknown id that Wingman ships | Creates it **as a built-in**, with the conditions out of `builtin.py` rather than out of the file. The id is the only thing that may say a row is one of the shipped set, which is what lets a shipped achievement be handed from one instance to another. |
| Any other unknown id | Creates it as an ordinary row. An archive cannot mint an undeletable achievement of its own. |
| An entry with an `icon.<ext>` | Stores it through `images.py` — the same allowlist, byte cap and pixel cap an upload goes through. |
| An entry **without** one | **Clears** whatever picture the row had. The archive is the whole description of the achievement it names, and anything else would make importing the same archive twice mean two different things. |
| `sort_order` left out of the file | A new achievement lands at the end of the list; an existing one keeps the place it has. |

The whole archive is parsed and every picture validated **before a row is
written**, so a broken file changes nothing at all. One
`achievements.changed` for the whole archive, not one per row, and then the
same background re-evaluation pass a create or an edit starts: an imported
achievement that is already true of what somebody sang is earned the moment it
exists.

Icons cannot join that transaction, so they are **staged**: every picture the
archive brought is written to a directory of its own beside the icons *before*
the commit, and moved into place after it. Nothing that is already being
served is touched until the commit has gone through. Writing is the step that
runs out of disk, so it has to be the one that happens while rolling back is
still free — otherwise a full disk on the fifteenth achievement answers
"nothing happened" having already deleted the first fourteen pictures. A
rename that fails *after* the commit leaves a row naming a file that is not
there, which is the state a picture deleted behind Wingman's back already
leaves: the icon endpoint answers 404 and re-importing puts it right. Failing
the request instead would say the import did not happen, which by then would
be untrue.

### Reading a stranger's archive

The upload is a file somebody else wrote, so the reader is the defensive half:

* **nothing is ever extracted to a path from the tar** — members are read in
  memory with `extractfile`, so no member name can become a path on this
  machine;
* a member that is not a regular file — a symlink, a hardlink, a device, a
  fifo — is refused. A *directory* member is skipped, because other tar
  writers emit one per directory;
* a member name that is absolute, that names a drive, that holds a backslash,
  a `..` or a `.`, or that has anything but the two segments this format
  allows, is refused; so is the same member twice;
* an id is checked as strictly as a filename, because it *is* one: it is the
  directory in the archive and the stem of the icon file on disk. Lowercase
  letters, digits and dashes, at most 64 of them, no dots and no separators —
  and not one of the names Windows resolves to a device in every directory
  (`con`, `nul`, `com1`, …), which would send `con.png` to the console rather
  than to the icons directory.

The caps, all in `archive.py` as module attributes:

| Cap | Value | Why |
|---|---|---|
| `MAX_ARCHIVE_BYTES` | 32 MB | The upload. Icons are 5 MB apiece at most, so this is a few dozen of them and every JSON beside them. The route reads one byte past it, so an oversized upload is never buffered whole. |
| `MAX_UNCOMPRESSED_BYTES` | 128 MB | What it may **decompress** to, counted *while* it is read. This is the cap that matters: the ratio between the two is where a gzip bomb lives, and a limit checked afterwards is not a limit. |
| `MAX_MEMBERS` | 512 | Two per achievement plus a directory entry apiece — well past any catalogue somebody hand-maintains. |
| `MAX_JSON_BYTES` | 256 KB | One `achievement.json`. A definition is a few hundred bytes; this only stops one member eating the whole budget. |
| `images.MAX_IMAGE_BYTES` / `MAX_IMAGE_PIXELS` | 5 MB / 50 MP | One icon, through the very same rules an upload goes through. |

Every refusal is a specific exception (`ArchiveTooLargeError` → 413,
everything else under `ArchiveError` → 422) carrying a sentence that names the
member or the achievement it was about. Somebody who exported from one
instance and imported into another has to be told *which* achievement and
*what* was wrong, never "invalid archive".

## Icons

An achievement's icon is either one of the app's own glyphs (`ICON_PATHS`) in
one of the four tag colours, or an uploaded image that replaces it. Uploads go
through the same validation as player avatars — the same code, factored into
`images.py`: a content-type allowlist the bytes have to agree with, a byte cap
and a pixel cap read out of the file's own header, and no image library. One
file per achievement under `<data dir>/achievement_icons`, the previous one
dropped even when it had another extension.

`AchievementRead.icon_version` is the cache buster for
`GET /achievements/{id}/icon`, the same field `PlayerRead.avatar_version` is
for an avatar and out of the same helper (`images.image_version`). Replacing a
picture changes neither the URL nor `has_image`, so without it a browser draws
the copy it already has until that copy goes stale. It is the stored file's
modification time in milliseconds — **derived, not a column**: a column would
have to be moved by hand at every write, and a picture that arrived through an
archive import or a restored data directory would leave it lying. `None` when
there is no picture, when the file behind it is gone, and on a **masked** row:
a version that moved would say a hidden achievement has a picture just as
loudly as `has_image` would.

The badge is a medallion: a plate in the achievement's colour with the glyph
centred. Earned draws it in full colour; unearned draws `--color-darkerer` on
`--input-bg`; hidden-and-unearned draws `lock` with "Hidden achievement" where
the name would be.

## The included set

Seventeen of them, declared as data in `achievements/builtin.py` and seeded by
migration 0023 as ordinary rows with `built_in = true` and **stable slug ids**
(`builtin-score-9000`), which is what import/export needs to recognise one.

`built_in = true` buys exactly three things:

| | |
|---|---|
| `DELETE /achievements/{id}` | A 409. An instance always has the set it ships with; it may switch one off instead. |
| Its **conditions** | `builtin.py`'s, and nothing else's. A `definition` on one is a 409 from `PATCH`, and an import writes every other field of a built-in but leaves its stored conditions alone. *Golden Voice* therefore means the same thing at every party, whatever it has been renamed to. |
| `POST /achievements/{id}/reset` | Only a built-in has one — see below. |

Everything else about one is as editable as any other achievement's: the name,
the description, the glyph, an uploaded picture, the colour, `hidden`, the place
in the list and whether it is on at all.

The migration reads `builtin.py` rather than repeating the list, so the set
exists once — but it names its own columns, and what it seeds is what a
**fresh** database starts with. Adding a built-in later needs its own
revision.

### Reset

`POST /achievements/{achievement_id}/reset`, `achievements.manage`. Puts one of
the shipped seventeen back the way Wingman ships it. Anything else in the
catalogue is a 409: an achievement somebody made here has nothing to be put
back to.

| Field | What a reset does |
|---|---|
| `name`, `description`, `icon`, `color`, `hidden` | Back to `builtin.py`. |
| `definition` | Back to `builtin.py`, written raw exactly as the seed migration writes it — so a reset row and a freshly seeded one are the same row. |
| `sort_order` | Back to the achievement's index in `BUILT_INS`. Nothing in the UI reorders the catalogue, so this only ever undoes an import that moved it. |
| `icon_file` | **Dropped**, file and all. The shipped set has no pictures, and one left standing in front of the restored glyph would make the reset look as though it had done nothing. |
| `enabled` | **Left exactly as it is.** Switching a built-in off is the one thing a party is told it may do to one, and undoing that would be unwelcome. |

Then `achievements.changed` and a background pass over every player, like any
other catalogue write: restored conditions can award a badge and can take one
away.

Because no other write may touch a built-in's conditions, a reset is also the
**only** way an improved definition in `builtin.py` ever reaches a database that
was seeded with the old one — the seed migration runs once. That is a known
limitation of shipping the set as ordinary rows, and reset is what an operator
does about it.
