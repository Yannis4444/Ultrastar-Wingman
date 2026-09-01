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
| `score_filter` | Optional `min` / `max` — drops scores outside the range **before** the metric is computed. "Ten scores above 9000" is `number_of_scores >= 10` with `score_filter.min = 9000`. |
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
| An achievement is created, edited, deleted, imported, enabled or disabled | Every player, as a background pass. |
| The global toggle is switched | Every player, as a background pass. |

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
`name`, `description` and `icon` on a hidden achievement the caller has not
earned, unless the caller holds `achievements.manage`. A client that ignored
the flag would otherwise spoil every surprise.

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

## The event

One `achievements.earned` per **sing**, not per player, so the host screen's
choreography cannot race:

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

## Import and export

A `.tar.gz` holding one directory per achievement:

```
score-9000/achievement.json
score-9000/icon.png          (only when the achievement has an uploaded icon)
```

`achievement.json` is the presentation fields plus the definition, in the
shape this document describes. **JSON, not YAML** — a YAML emitter is not a
few lines of code and the project takes no dependency it can avoid
(code-style.md).

* **Export** takes a list of ids and answers with one archive.
* **Import** takes one archive and matches **by id**: a known id is updated in
  place, an unknown one is created. That is what makes export → edit → import
  a round trip, and what lets a built-in be shared between instances.
* Members are read **in memory** with a size cap per member and per archive —
  nothing is ever extracted to a path from the tar.

## Icons

An achievement's icon is either one of the app's own glyphs (`ICON_PATHS`) in
one of the four tag colours, or an uploaded image that replaces it. Uploads go
through the same validation as player avatars (`players/service.py`): a
content-type allowlist, a byte cap and a pixel cap, no image library.

The badge is a medallion: a plate in the achievement's colour with the glyph
centred. Earned draws it in full colour; unearned draws `--color-darkerer` on
`--input-bg`; hidden-and-unearned draws `lock` with "Hidden achievement" where
the name would be.

## The included set

Seeded by a migration as ordinary rows with `built_in = true` and **stable
slug ids** (`builtin-score-9000`), which is what import/export needs to
recognise one. A built-in can be edited and switched off; it cannot be
deleted.
