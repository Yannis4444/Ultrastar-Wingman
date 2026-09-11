# Background music

*Design, 2026-09-11. Branch `feat/background-music`. The user's decisions are in §1; everything
else is the plan the implementation builds from. Where this document and the code disagree
after the round, the code is right and this document is updated: §7 is what shipped and where
it departs from §§2–6.*

Wingman is silent between songs. A party has long gaps — somebody is picking a singer, scores
are being read, nobody has pressed Play yet — and the room goes quiet. This round plays random
songs out of the library while nobody is singing, gives the Home page's stage a **compact
player** with three modes, and puts the volumes on the Settings page in the shape sound effects
will want later.

## 1. Decisions

Made by the user, 2026-09-11:

1. **The sound comes out of the host screen browser.** One `<audio>` element on the TV's
   browser follows backend state. No server-side audio and no new dependency.
2. After a sing, the music comes back **after a configurable pause** (default 10 s), with a
   **fresh random song from the beginning**. A song interrupted by a sing is never resumed.
3. The pools are **all songs, the wishlist, the wishlist weighted, one playlist** — the reel's
   own scopes minus *favorites*, which needs an account the music does not have.
4. The Home stage becomes **one compact player**: the art on the left at 88 px, the text
   beside it, the controls underneath, and **the same height in all three modes** — a sing, the
   background song, and idle. Idle fills the art square with the Wingman logo.
5. The host TV **keeps its brand and its QR rail** and gains one quiet line naming the
   background song. Nothing else about the idle screen changes.
6. Three capabilities: **`music.view`** (guest and up), **`music.control`** — play, pause,
   skip, volume — (account and up), **`music.manage`** — turn it on, the pool, the playlist,
   the pause — (trusted and up).
7. The **three volumes are ordinary Settings-page settings** (master, background music, sound
   effects); **everything else lives on the player itself**, behind a gear.
8. A **progress line for the background song only**. A running sing still shows no time on
   phones, as it does today.

Assumptions made here, to veto — they are also listed in §7:

- The audio file plays **from byte 0**; `#START` and `#END` are karaoke marks and are ignored.
- A song with no audio file is never picked, rather than picked and skipped.
- The picker avoids the song that just played whenever the pool has another candidate.
- Only USDX takes the speakers. Music keeps playing while the room picks singers and while the
  reel spins on the TV.
- **Pause is global and survives a sing:** a room somebody silenced stays silent afterwards.
- An empty pool — a deleted playlist, every wish granted — **says so and retries**, rather than
  falling back to the whole library the way the selector's start button does.
- Changing the pool lets the current song finish; the new pool decides the next pick.
- No countdown on the phones during the pause after a sing, only a line saying it comes back.
- The progress bar does not seek, and there is no mute button: §1.6 reads play, pause, skip,
  volume.

## 2. The model

The backend owns two things: a **track** (a song, and where in it we are) and a **sink lease**
(which host tab is making the sound).

**Nothing advances a track on a timer.** `Song.duration_seconds` is `scanner.played_seconds`,
narrowed by `#START` / `#END`, so it is *not* the audio file's length and cannot drive a clock.
Only the sink's own `ended` report advances a track. Everything else in the module is a
deadline plus a one-second tick, the `devices` watchdog shape, so a test moves `_now()` and
calls `tick()` rather than sleeping.

There is **no new table**. The playing state is module state — there is one pair of speakers,
exactly as there is one `karaoke.service._running` — and the options are rows in the existing
`settings` table.

### 2.1 Import direction

The one order that works, and the reason it is worth writing down:

```
karaoke.service  ->  music.service  ->  karaoke.reel  ->  {library, songs, tags}
```

`karaoke/service.py` imports `music.service` at module level, the way it already imports
`achievements.service`. `music/service.py` imports **only the leaves** `karaoke.reel` and
`karaoke.schema` — never `karaoke.service`, and never `karaoke.selection`, which does import
`service` and would close the cycle. `karaoke/__init__.py` is a docstring, so importing `reel`
executes nothing else.

`selection._GUEST` therefore cannot be reused where it stands. It is promoted to
`tags.service.GUEST_VIEWER` and both modules read it, rather than keeping a second copy of a
constant that decides what a stranger may see.

## 3. Backend

```
sound.py                 the three volume keys and their validator (a leaf, the join_url.py rule:
                         a validator may not import settings.py back)
music/__init__.py        docstring only
music/schema.py          the read models (FastAPI-free, so events.py may import them)
music/settings.py        the private definitions (the devices/settings.py pattern)
music/service.py         the state machine, the sink lease, the tick, the four karaoke hooks
music/api.py             the ten routes
```

### 3.1 State

Module globals plus one `asyncio.Lock` and a `_now()` the tests move: `_track`, `_sink`,
`_sink_generation`, `_paused`, `_sing_running`, `_usdx_open`, `_resume_at`, `_retry_at`,
`_options`, `_volumes`.

```python
@dataclass
class _Track:
    id: str                   # the token every sink report carries
    song: SongRead            # a snapshot, like CurrentSing.song
    song_id: str
    started_at: datetime
    position_s: float         # the last known position
    position_at: datetime     # when position_s was true
    duration_s: float | None  # the real file length, once the sink says
```

One `_evaluate()` runs after every mutation and every tick and settles the status in this
order:

| status | when |
|---|---|
| `off` | `music.enabled` is false |
| `blocked` | a sing is running, or USDX stands open in its own menus (`blocked_by`) |
| `waiting` | the pause after a sing has not run out |
| `empty` | nothing to pick, and the retry deadline has not come |
| `paused` | somebody pressed pause |
| `playing` | otherwise |

The position is **extrapolated only while a sink is online and playing**. When the sink goes
away the extrapolated value is written back into `position_s` and the track **freezes** — it
must not march past its own end on a clock nobody is listening to. The track is kept, not
dropped, so `playing` with `sink_online == false` is exactly the state the phone turns into
*No screen is playing the music*.

### 3.2 Picking

`reel.pick_song(session, scope, tags.GUEST_VIEWER, playlist_id=...)`, up to three attempts,
rejecting the song that just played and any song whose `audio_file` is null. `pick_song` grows
two optional keyword arguments that default to today's behaviour:

```python
async def pick_song(session, scope, viewer, *, playlist_id=None,
                    exclude=frozenset(), require_audio=False) -> Song | None
```

The **guest viewer** is not a detail: `music.changed` rides the anonymous WebSocket, so a song
a tag hides from guests must never be in it.

An empty pool sets `_retry_at` 30 s out and reports `empty`. A playlist that was deleted is
the same thing and **does not fall back to the whole library** — a one-off button press falling
back is a kindness, an hour of music out of the pool the host excluded is not.

### 3.3 The four hooks

`karaoke/service.py` calls, with no arguments and no database:

| where | call |
|---|---|
| `start_sing`, after `_running = running` and before the `KaraokeStarted` broadcast | `music.sing_started()` |
| `_finish`'s `finally`, after the `KaraokeEnded` broadcast | `music.sing_ended()` |
| `open_usdx`, after `_standalone = standalone` | `music.usdx_opened()` |
| `_standalone_exited`, after `_standalone = None` | `music.usdx_closed()` |

They **never raise** — each guards its own body and logs — because two of them run on the
launcher's exit path and music must not be able to swallow the end of a song, for the reason
`_award_achievements` already states. One guard inside music beats four `try` blocks in
karaoke.

A **forced** start runs `_stop_and_wait -> _finish -> sing_ended` (which sets the countdown)
and only then reaches `sing_started` (which clears it). That sequence is pinned by a test.

### 3.4 The sink protocol

| step | call |
|---|---|
| the host has unlocked audio and registers | `POST /music/sink` -> `{sink_id, heartbeat_interval_s, music}` |
| every 5 s | `POST /music/sink/report {sink_id, track_id, event: "progress", position_s, duration_s?}` |
| the element fired `ended` | the same route, `event: "ended"` |
| the element fired `error`, or the file 404s | the same route, `event: "error", detail` |
| `pagehide` | `POST /music/sink/release {sink_id}` -> 204, always |

All three take **`music.manage`**, not `music.control`: any phone could otherwise register
itself as the sink and pull the audio off the TV. The host session is an administrator, so this
costs it nothing.

The rules, each covering a race:

- **Every report carries the `track_id`.** A report for a track that is no longer current is
  *ignored* — 200 with the current state, never an error. That makes a retried `ended`, and an
  `ended` for a track a phone has just skipped past, harmless.
- **A report never broadcasts.** Phones extrapolate the position themselves; a WebSocket message
  per sink per five seconds is the "busy TV for nothing" `devices.changed` already refuses. The
  one exception is the first report that turns `duration_s` from null into a number, because
  that is what lets a progress bar be drawn at all.
- **Newest registration wins**, unconditionally. A host page that reloaded must not wait out a
  timeout in silence. `_sink_generation` rises, the old tab silences itself on the broadcast,
  and a 409 `not_the_sink` on its next report catches it otherwise. Releasing a stale id is a
  204 no-op — the tab is going away, an error helps nobody.
- **No report for 15 s** ends the lease. The position freezes, `sink_online` goes false, the
  track stays.
- The host registers **only once its element can actually play**, so `sink_online` is the app's
  promise that sound comes out.
- An `error` counts as `ended` and advances; five in a row back off for a minute, so a library
  of broken files cannot spin at request speed.

### 3.5 Routes

| method | path | capability |
|---|---|---|
| GET | `/music` | `music.view` |
| POST | `/music/play` · `/music/pause` · `/music/skip` | `music.control` |
| PUT | `/music/volume` | `music.control` |
| GET · PATCH | `/music/settings` | `music.manage` |
| POST | `/music/sink` · `/music/sink/report` · `/music/sink/release` | `music.manage` |

`play` clears the pause **and** the countdown, because play means now. `pause` works in every
state, including during the countdown ("do not come back on"), and is idempotent. `skip` takes
a new track at position 0 and **keeps the paused state**. All three answer 409
`music_disabled` / `music_blocked` / `empty_pool` rather than succeeding silently: the phone
has to be able to say why nothing happened.

The two write bodies follow `devices/api.py` exactly — `model_fields_set`, then
`SettingTypeError` / `SettingValueError` mapped to 422 with the registry's own sentence.

### 3.6 Schema and the event

```python
MusicStatus = Literal["off", "blocked", "waiting", "empty", "playing", "paused"]

class MusicTrackRead:   id, song, started_at, position_s, position_at, duration_s
class MusicVolumeRead:  master, music, effects
class MusicRead:        status, track, blocked_by, resume_at, retry_at,
                        sink_online, sink_generation, volume, scope
class MusicSettings:    enabled, scope, playlist, resume_delay_s    # music.manage only
```

`music.changed` carries the whole `MusicRead`, the `selection.changed` reasoning: the host
drives its element from it and a phone that reloaded catches up without asking.

Nothing in it is guest-secret. The song was picked as a guest; the `sink_id` is only ever
returned to the tab that registered; and **`playlist_id` is deliberately left out** — an id on
an open bus could name a private list. It lives in `MusicSettings`, behind `music.manage`.

### 3.7 Settings

Registered in `settings.py`, group **Sound**, so the Settings page renders them with no new
code:

| key | type | default | says |
|---|---|---|---|
| `sound.master_volume` | int 0–100 | 100 | everything Wingman plays on the host screen |
| `sound.music_volume` | int 0–100 | 60 | the background music, quieter than the singing on purpose |
| `sound.effects_volume` | int 0–100 | 80 | the sound effects — nothing uses it yet, and the description says so |

Private in `music/settings.py`, behind `music.manage`:

| key | type | default |
|---|---|---|
| `music.enabled` | bool | **false** |
| `music.scope` | str | `all` |
| `music.playlist` | str | `""` |
| `music.resume_delay_s` | int 0–120 | 10 |

`MUSIC_SCOPES` is the same four as `devices.settings.RANDOM_SCOPES` but declared here: the two
are free to diverge, and importing `devices` from `music` is a coupling neither needs.

`PUT /music/volume` writes the `sound.*` keys through `SettingsService` — which is how a
`music.control` holder moves a registry value without holding `settings.manage` — and emits one
`setting.changed` per key so an open Settings page stays in step. The root
`PATCH /settings/{key}` calls `music.apply_settings` for a `sound.*` key, so a volume set there
reaches the TV at once rather than at the next restart.

### 3.8 Permissions, migration, lifespan

`music.view` / `music.control` / `music.manage` go into `CAPABILITIES` and into
`_GUEST_`, `_USER_` and `_TRUSTED_CAPABILITIES` respectively. Seeing the player is a guest's,
because it is the room's own soundtrack; pausing it or turning it down is an account's, because
it silences the room for everybody; turning it on and choosing the pool is a decision about the
evening.

Migration **0034** seeds `role_permissions` per role on `0032`'s insert-if-absent pattern —
required, because `test_permissions` proves the table matches the module defaults — and creates
no table, which its docstring explains.

`app.py`'s lifespan starts the watchdog after the devices one and stops it **before
`karaoke.shutdown()`**, which kills the running song and would otherwise fire `sing_ended` into
closing sockets.

### 3.9 Tests

`conftest.py` gets an autouse `fresh_music_state`, the `fresh_devices_state` reasoning.
`test_music_state.py` drives the machine with `_now()` monkeypatched and explicit `tick()`
calls, never a sleep: a sing drops the track at once; the countdown comes due and a *different*
track starts at position 0; the forced-sing sequence clears the countdown; a second `ended` for
the same track changes nothing; a sink that stops reporting freezes the position; an empty pool
retries on its own deadline and not every tick; a song with no audio file is never picked; a
song a tag hides from guests never appears; hooks after `stop_watchdog()` are no-ops.
`test_music_api.py` covers the routes, the 409s, the two sink generations, and that a progress
report broadcasts nothing while the first `duration_s` does.

## 4. Frontend

### 4.1 The compact player

`components/HomeStage.tsx` and its stylesheet are rewritten in place. The file keeps its name
and its `.home-stage` class, so ui-guidelines §1.2's `--tile-bg` whitelist is untouched.
`CurrentlyPlaying.tsx` loses its `"stage"` variant and everything stage-only and becomes what
its name says: the TV's block.

```
+--------------------------------------+  16px padding
| +------+  Background music           |  88px art | four declared text rows
| | art  |  Bohemian Rhapsody          |
| | 88px |  Queen                      |
| +------+  --o------------------ 1:12 |
|    (heart)     ( PLAY )     (wish)   |  72px control row, SongControls.css untouched
|  [gear] [||] [>>]  (o)----------o--- |  40px transport row
+--------------------------------------+
```

**264 px, in every mode** (16 + 104 + 8 + 72 + 8 + 40 + 16), against today's 327. One DOM
shape, slots filled per mode, every row a **fixed grid track**, so an absent child leaves an
empty track and no mode can change the height. Every reserved line carries a **declared px
`line-height`**, never `normal`: §4's own warning applies — the same caption is 16 px tall in
Segoe UI and 14 px in Roboto, and a height that measured itself would differ between the
developer's Windows and every phone in the room.

| slot | singing | background music | idle |
|---|---|---|---|
| art, 88 px | `SongCover` in a button opening the song modal | the same | `LogoTile` from `SongReel.tsx` |
| eyebrow (the page's `h1`) | *Now playing* | *Background music* | *Ultrastar Wingman* |
| title, 2 clamped lines | the song's | the song's | *Nothing is playing* |
| artist | the song's | the song's | *Pick a song to start the party.* |
| progress | — | the bar and the elapsed time | — |
| lead control | pink Stop (`karaoke.stop`) | blue **Sing** — `PlayerSelection` for that song (`karaoke.sing`) | — |
| flanks | favorite / wish | favorite / wish, on the background song | — |
| transport | the gear | gear, pause, skip, volume | the gear |

A reader **without `music.view`** gets *Ultrastar Wingman* on the title line instead of
*Nothing is playing*: that reader cannot know whether music is playing, so the tile must not
claim it is not.

The **gear is drawn in every mode** — a host who switched the music off must have a way back
in — and the transport's 40 px are reserved even where nothing is drawn in them.

The elapsed time ticks through a `useNow(active)` hook lifted out of `CurrentlyPlaying`'s
private `useElapsedSeconds`, so the host's sing clock and the player's music clock are one
implementation. It is **not** a live region: a per-second `role="status"` is a screen-reader
denial of service.

At 360 px: 296 px of content, less 88 art and a 12 gap, leaves 196 for the text column and 168
for the slider. Nothing wraps and nothing scrolls sideways.

### 4.2 The sink

`components/MusicSink.tsx`, mounted once in **`App.tsx`**, outside `<Routes>`, for
`auth.loaded && auth.isHost`.

**Not on the host page.** `/host/manage` is a sibling route and the host walks from it into
`/settings` and `/user/*`; a sink under any page unmounts and the music stops mid-song.
`isHost` is precisely "the host screen browser" — the flag the one-time `?hostToken=` exchange
sets — and an administrator session, so it holds the `music.manage` the sink routes want.

- **Autoplay first, registration second.** `play()` rejecting sets `blocked` in a small module
  store (`hooks/useMusicSink.ts`, the `useWingmanEvents.ts` idiom) that `Host.tsx` reads. While
  blocked the sink also installs a one-shot document `pointerdown` / `keydown` that calls
  `play()` **synchronously** — an `await` before the call spends the gesture — so any click on
  the karaoke PC unblocks it. The explicit button exists because a TV gets no clicks.
- The `sink_id` is **minted by the server**, so the page needs no random of its own
  (`crypto.randomUUID` is undefined on the plain `http://` LAN origin a host page is opened at).
  A `navigator.locks` exclusive lock named `wingman-music-sink` keeps a second tab of the same
  browser from claiming at all; across machines the newest claim wins and the loser silences
  itself when `sink_generation` moves.
- A new `track.id` sets `src` and seeks — but **only when the gap is over ~1.5 s**, so a
  heartbeat's own round trip never nudges a playing element. A host page reloaded mid-song
  comes back in the right place.
- `volume = master / 100 * music / 100`, one line in `music.ts` with its own test. A linear
  product, not a perceptual curve: any gamma makes the printed number a lie in the other
  direction, and both controls are trimmed by ear anyway.
- The fade keys on the **state's own `playing` going true -> false**, not on `karaoke.started`:
  one code path for a sing starting, a pause, and a lost sink. ~600 ms down with
  `requestAnimationFrame`, ~300 ms back up, cancelling any running ramp. **No reduced-motion
  branch** — §1.9 governs visual animation, and cutting a volume ramp makes the room's
  experience worse rather than calmer. The comment says so, so a reviewer does not "fix" it.

### 4.3 The rest

- `hooks/useMusic.ts` — one shared `GET /music`, gated on `auth.loaded && can("music.view")`,
  patched from `music.changed` and never refetched.
- `music.ts` — `playerMode`, `musicPosition` (skew-safe and clamped), `effectiveVolume`,
  `progressPercent`, `seekIfDrifted`, so the player's branching is tested without rendering it.
- `components/MusicSettingsPanel.tsx` — the gear's §5 panel modal, not an inline block: a
  fixed-height tile has no room, and §7 says complex settings get their own surface. Four rows:
  on/off, *Pick songs from*, *Playlist* (that scope only), *Wait before the music comes back*.
- `components/PrivateSettingRow.tsx` — `DeviceSettingRow` and `SecondsInput` lifted out of
  `pages/Devices.tsx` verbatim, because this is their third caller. `Devices.test.tsx` passing
  unchanged is what proves the extraction.
- `pages/Settings.tsx` — `GROUP_ORDER` gains `Sound` after `Host`, `GROUP_ICONS.Sound =
  "volume"`, and `CUSTOM_FIELDS` points all three volume keys at one `VolumeField`.
- `pages/Host.tsx` — one quiet line in `HostBrand` under the scan hint, drawn only where `scan`
  is true so the between-singers beat stays bare. It is content, not a control, so it is not
  wrapped in the reveal-on-move overlay and adds no second idle timer. *Turn on sound* goes in
  `.host-rail` after the QR card for the same reason: `.host-controls` is invisible the moment
  the mouse stops moving, which on a TV is always.
- `icons.tsx` — `pause`, `skip`, `volume`. No mute, so no `volume-off`. Control glyphs, so none
  joins `PICKER_ICON_NAMES`.
- `index.css` — one shared `.range-input`; there is no slider in the app today and §1.7 forbids
  a second bespoke rule per page.

## 5. Documentation

`docs/user/party/music.md` under *At the party*; a `## Sound` section in
`settings/reference.md`; a *Background music* paragraph in `people/roles.md`; the *Turn on
sound* press and the song line in `host-screen/index.md`; the new event and routes in
`integrate/events.md` and `rest-api.md`. `ui-guidelines.md` §7's *Home* and *Host* bullets and
§3's glyph table; `documentation.md`'s terminology table gains *background music*. The
CLAUDE.md map gains the module and the new frontend entries. The Home tile and the idle host
screen are both redrawn, so their screenshots are recaptured.

## 6. Order of work

1. This document.
2. Capabilities, migration 0034, the Sound settings group.
3. The `music/` module, the four hooks, the two `pick_song` arguments, the `GUEST_VIEWER`
   promotion, the lifespan wiring, and the backend tests.
4. Regenerate the API client.
5. The icons, `.range-input`, `music.ts`, `useNow`, `useMusic`, `useMusicSink`.
6. `MusicSink` and its mount — before the UI, because it is the risky half and it proves the
   contract.
7. `PrivateSettingRow`, `MusicSettingsPanel`, `VolumeField`, the Settings group.
8. `HomeStage` rewritten, `CurrentlyPlaying` stripped to the host, and the tests that break.
9. The host's quiet line and *Turn on sound*; `RolePermissions`.
10. The documentation, the map, the ADR, the docs build, the screenshots.

## 7. What shipped, and where it departs from the plan

All of §§2 to 5, with these differences, every one of them found while building it:

1. **`GET /music` picks nothing.** The plan had it settling the state, which would have been
   a song picked and never broadcast: the host screen would not have heard about it, and the
   next tick would see nothing changed and stay quiet. Picking out of nowhere is the tick's
   job alone; every other pick is somebody pressing something, and the route that served the
   press broadcasts it.
2. **The four hooks broadcast only on a visible change.** With the music switched off, which
   is the default, a sing changed nothing in `MusicRead` and still sent two `music.changed`
   messages to every phone in the room. `_changed` now guards them, the same rule the report
   path already had.
3. **`_freeze` exists, and is called *before* whatever stops the music.** Pausing and losing
   the sink both worked the position out *after* flipping the flag, and `_position` reads the
   current status, so both stored a standstill. Three call sites, one helper, and the
   docstring says which side of the change it belongs on.
4. **`_learn_duration` runs before the payload is built.** It was evaluated inside the same
   tuple as `_read()`, so the one report worth broadcasting announced the null it had just
   replaced.
5. **`_last_song_id`.** Every path to the next song clears the track first, so the picker had
   nothing to avoid repeating and `skip` could land on the song it just left.
6. **The error counter is not cleared by picking.** Every failure advances, so forgiving the
   run on each advance pinned the counter at one and a library where nothing plays would have
   spun at request speed. Playing is what forgives it.
7. **`tags.GUEST_VIEWER`** rather than a second copy in `music`: `karaoke.selection` imports
   `karaoke.service`, so its `_GUEST` could not be reached from here without closing the
   cycle §2.1 describes.

### Verified in a browser, 2026-09-12

Against a scratch instance on :8081 with three generated songs, driven in headless Chrome
over CDP (the extension was not connected):

- The host screen's `<audio>` really plays: `readyState` 4, `paused` false, `currentTime`
  advancing, `volume` 0.6 for the default 100 × 60, and the file's own duration reported back
  to the server, which is not the stored `duration_seconds`.
- Songs advance on their own: the browser played each to the end, reported `ended`, and the
  server picked another.
- `GET /songs/{id}/audio` answers `206` to a `Range` request, so seeking works.
- The player measures **264px in every mode**, draws its three grid rows in all of them, and
  scrolls nothing sideways at 390px.
- With `--autoplay-policy=document-user-activation-required` the element stays paused and the
  host screen offers **Turn on sound**; a trusted click starts it and the button goes.
- A guest was refused `PATCH /music/settings` with `missing_permission:music.manage`.

A live sing was **not** run: it starts the real Ultrastar Deluxe. The transition is covered by
`test_music_state.py` instead (the speakers go, the countdown runs, a *different* track starts
at position 0), and it stays the one thing only a real party can prove.
