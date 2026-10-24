# The reel on the host screen

*Design, 2026-09-06. Branch `feat/host-spinner`. The user's decisions are in §1; everything
else is the plan the agents build from. Where this document and the code disagree after the
round, the code is right and this document is updated: §6 is what shipped and where it
departs from §§2–4, §7.1 the same for the third round of §7, and §8 what the round of
2026-10-24 changed. §3.2 and §3.5 describe the page and its tests as they are now.*

The Random song page picks a song on one phone. This round lets the room watch the pick on
the TV: a phone (or the player selector's start button) spins the reel **on the host
screen**, the song lands there, and the room presses again until it likes what it sees. It
reuses the player-selection screen the host already has: the reel stands where the cover
stands, the slot cards line the foot, and the same lock says who is picking.

## 1. Decisions

Made by the user, 2026-09-06:

1. A host spin is one more way of **opening the room's one player selection**. The lock,
   the takeover (anybody with `karaoke.sing`, after confirming), the idle expiry and the
   card-held slots all apply unchanged.
2. **The server picks the song**, once, for the phone and for the device alike. The phone's
   own reel (the animation on the Random song page) stays local and is not changed.
3. The phone that spun the reel shows nothing but **title, artist and Play** (plus *Spin
   again* and *Cancel*). Play goes on to the ordinary player selection over the same
   selection. The reel animation is the host's alone.
4. The selector's start button, with nothing open and `start_without_selection` set to
   `random`, **spins even with no card on any reader**. The next press **starts** the song
   if anybody stands on a slot and **respins** otherwise. `top_wish` is unchanged: one
   press, a card required.
5. **The automatic start never runs on a spun selection.** Pressing until the song is right
   must not race a countdown; the second press, or Play on the phone, is the confirmation.
6. The phone shows the song **when the host reel lands**, about five and a half seconds
   after the spin, and *Spinning on the host screen…* until then.
7. The device's random scope offers **all songs, wishlist, wishlist (weighted), one
   playlist**. Favorites need an account and are the phone's alone.

Assumptions made here, to veto: the playlist reel gets the same button with its scope fixed
to that playlist; a device setting naming a playlist that no longer exists falls back to
*all songs* with a log line rather than refusing the press; a spun selection idles out like
any other (a respin touches it); the host's *Picking singers* line reads *Spinning…* while
the reel runs.

## 2. Backend

### 2.1 The spin on the selection

`karaoke/selection.py`: `_Selection` gains `spin: _Spin | None`.

```python
@dataclass
class _Spin:
    id: int                 # 1 on open, +1 on every respin: the host animates on a new id
    spun_at: datetime
    scope: str              # all | favorites | wishlist | weighted | playlist
    playlist_id: str | None
    viewer: tags.Viewer     # whose hidden tags and (for favorites) whose hearts
```

`schema.SelectionRead` gains `spin: SpinRead | None` with `id`, `spun_at`, `scope`,
`playlist_id` — never the viewer. `selection.changed` carries it like everything else.

### 2.2 One picker

New module `karaoke/reel.py` (FastAPI-free): `pick_song(session, scope, viewer, *,
playlist_id=None) -> Song | None`. It grows out of `selection._song_for_button`, which
moves here (`top_wish` included, as its own function):

- `all`: every song id minus `tags.hidden_song_ids(viewer)`.
- `favorites`: `library.service.favorite_song_ids(viewer.user_id)`; `None` for a viewer
  without an account. Not filtered by hidden tags (the reader hearted them on purpose, the
  phone's rule).
- `wishlist`: the songs of `library.service.wishlist(...)`, each once. `weighted`: each as
  many times as its count. Not filtered by tags either, the phone's rule.
- `playlist`: the entries of the playlist, `None` when the playlist does not exist or is
  empty. Not filtered.
- Always: candidates sorted, then `random.choice`, so a seeded generator reproduces a pick.

A song hidden from the viewer altogether (`view` denied) can win in no scope — the same
rule the phone's reel documents. Check what `hidden_song_ids` covers and apply the stricter
set where the phone does.

### 2.3 Routes (`karaoke/api.py`, `karaoke/schema.py`)

- `POST /karaoke/selection`: `SelectionCreate.song_id` becomes optional, and `spin:
  SpinRequest | None` (`scope`, `playlist_id`) is added. Exactly one of the two, else 422.
  With `spin`, the server picks the song, opens the selection with `spin.id = 1`, and
  answers `SelectionOpened` as before. An empty pool is 409 `empty_pool`; `favorites`
  from a caller without an account is the same 409. Everything else (`force`, the device
  slots seeding, the prefill rule while a selector is online) is unchanged.
- New `POST /karaoke/selection/spin` (`karaoke.sing`, token in `X-Selection-Token`):
  respin. Picks again in the stored scope for the stored viewer, replaces the song, keeps
  the slots, `spin.id += 1`, `spun_at = now`, touches `updated_at`, broadcasts. 404
  `no_selection`, 409 `not_the_opener` for a stale token (what the other token routes answer), 409
  `not_a_spin` on a selection opened with a song, 409 `empty_pool`.
- `POST /karaoke/selection/start` is unchanged: Play after a spin is the ordinary start.

The five existing selection routes keep their shape; the client is regenerated once at the
end of the backend work (`npm run generate-api` against a scratch backend), never edited.

### 2.4 The selector's start button (`selection.button_pressed`)

Two new private settings in `devices/settings.py` (the `achievements/settings.py`
pattern), on `GET/PATCH /devices/settings` and in `DeviceSettings`:

- `devices.random_scope`: `all | wishlist | weighted | playlist`, default `all`.
- `devices.random_playlist`: a playlist id or `""`, default `""`.

`StartWithoutSelection` carries both. The rules, in `_start_without_selection_locked`
and the open-selection branch of `button_pressed`:

- `nothing`: as today.
- `top_wish`: as today — a card on a slot reader required, the song starts on the press.
- `random`, nothing open: open a **spun** selection (`_Spin` with the guest viewer, scope
  and playlist from the settings, a playlist that is gone → `all` and one log line), the
  cards on the slot readers seeded as `open_selection` seeds them, a token nobody is
  handed, **no auto-start**. The song does not start. A press with no card down spins too.
  An empty pool is a log line and nothing else.
- Any `start` press while a selection is open and **spun**: if no slot holds a player,
  respin (the stored scope and viewer, so a device press respins a phone's spin in the
  phone's scope); otherwise start, as today. A press on an open selection that is not a
  spin behaves as today.

### 2.5 No countdown on a spin

`_refresh_auto_start` (all three call sites) schedules nothing while `selection.spin` is
not `None`, and cancels a running one if a spin somehow has one. `auto_start_at` stays
`None` on a spun selection.

### 2.6 Tests

`tests/test_karaoke_selection*.py` / `test_devices_api.py` as they are organised today:
open by spin in every scope, the two 409s, respin keeps slots and bumps the id, respin on
a plain selection is 409, token rules, the device rules of §2.4 (spin with no cards, second
press starts vs respins, `top_wish` untouched, missing playlist falls back), no auto-start
on a spin even when the cards fill the room, `selection.changed` carries `spin`. Seed
`random` in the tests the way `_song_for_button`'s tests do.

## 3. Frontend

### 3.1 The reel as a component

Extract the animation out of `components/SongSpinner.tsx` into
`components/SongReel.tsx` (+ `.css` + test): the window, the reel element, the fillers,
`SPIN_MS` / `REVEAL_MS` / the easing, the reduced-motion path, and the die's roll as a
hook or a prop callback. `SongSpinner` keeps the *Pick from* select, the pool caption, the
result, the SPIN button and the song modal, and renders `SongReel`. The reel is sized by
`--spinner-cover`, so a caller sets the variable and gets a bigger reel. No visual change on
the Random song page: compare before and after in the browser.

### 3.2 The phone: the Random song page in *Host screen* mode

The target is ui-guidelines §7, Random song; how the page came to replace the modal the
first rounds built is §8. There is no second view. The Random song page and a playlist's reel
(`components/SongSpinner.tsx`) draw one layout for both places the reel runs: §4's pills
*This screen* · *Host screen* (`tv` before the word) as the column's first row, drawn only
for `karaoke.sing` and only where the server has a pool to spin (the library's scopes, or a
playlist's id); *Pick from* and the pool caption; the reel's window; the result slot; one
action row of SPIN and *Play*. The choice is kept per device (`spinTarget.ts`), and a kept
*Host screen* opens nothing on entry: the room's selection is taken by the first SPIN.

*Host screen* is `hooks/useHostSpin.ts` over `useSelectionLock`, six phases: `idle` (nothing
held), `opening`, `spun`, `blocked`, `empty` and `lost`:

- SPIN reads *Spin*: `POST /karaoke/selection` with `spin` (the select's scope, or the
  playlist's id) and the remembered slots out of `playerSlots.ts`, the die tumbling while
  the answer is out. The window stands on the reel's empty tile (`SongReel` with no spin,
  remounted for every wait) and the result slot reads *Spinning on the host screen…*
  (`role="status"`) until `spun_at + REVEAL_MS` — capped at `REVEAL_MS` from the answer —
  or `spin.revealed`; then the cover settled in the window and the title over the artist,
  both opening the song modal, whose Sing is handed `onSing` while this phone holds the
  spin so it never races its own lock (ui-guidelines §7, *Random song*).
- SPIN reads *Show it* while the TV spins and *Spin again* after: both are `POST …/spin`,
  and the server decides which (the same song `revealed`, or a respin).
- *Play* stays off until the reveal; it is `/pick`, then `PlayerSelection` adopts the
  selection and its token (`lock.forget()`, nothing given back). Once the picker closes the
  page holds nothing: the words stay, SPIN reads *Spin*, Play is off.
- A pool changed under a held selection leaves the TV on it until the next press, which
  gives it back (`lock.close()`, a promise of the DELETE's answer) and opens anew only
  once the room has answered — sent together, the open could find the phone's own
  selection still there and be refused with `selection_open`.
- *Somebody is picking singers for <title>.* (Play's place a *Take over* through a danger
  `ConfirmModal`, which re-opens with `force`), `emptyPoolLine`'s sentence per scope, and
  *Somebody else took over the selection.* (a `null` or a replaced `selection.changed`, or
  `not_the_opener` / `no_selection` on a respin or a Play) are one sentence in the result
  slot, SPIN reading *Spin*. Any other refusal is an `.error-notice` over the action row.
- No close and no Cancel: the pills back on *This screen*, leaving the page and closing the
  tab give the room back through the lock's one `keepalive` DELETE. Because the page stays
  mounted across selections, the lock has `begin()` / `isCurrent(ticket)` and takes a ticket
  on `hold`: an open answered after the pills came back gives its token straight back even
  when the next SPIN has already taken the room again.

*This screen* is the phone's own reel, its SPIN reading *Show it* while the reel runs —
held (lit, `aria-disabled`, still focused) for its first `SHOW_IT_DELAY_MS`, so a double tap
is one spin (ui-guidelines §7); the TV's spin is held only by the open's round trip, which on
a fast network is shorter than a double tap — and its *Play* opens the player
selection over the landed song — the song modal's Sing by another door, so both modes
share one action row.

### 3.3 The host: the reel where the cover is

`components/HostSelection.tsx`: when `selection.spin` is set, `SongReel` stands where
`SongCover` stands, at the cover's size (`--spinner-cover` on the block). A new `spin.id`
starts a spin landing on `selection.song`; the fillers are random covers out of
`listSongs` (the host holds `songs.view`). A host that loads after `spun_at + REVEAL_MS`
draws the settled reel. Reduced motion lands at once. While the reel runs the title and the
artist are held back and the line reads *Spinning…*; after it lands they appear and the
line is *Picking singers* again. No countdown ever shows on a spun selection (§2.5).

### 3.4 The Devices admin page

`pages/Devices.tsx`: under the start-button select, when it stands on *Start a random
song*, two more quiet controls: the scope (*All songs*, *Wishlist*, *Wishlist (weighted)*,
*A playlist*) and, on *A playlist*, a select over `listPlaylists` (the manager's visible
playlists). Each writes one PATCH like the settings above it.

### 3.5 Tests

`SongReel.test.tsx`; `SongSpinner.test.tsx`, which holds both modes of §3.2 — the pills and
their memory, the reveal wait and its cap, *Show it* / *Spin again*, Play and the hand-over,
the takeover, the empty pool, a selection lost, and the room given back once on the pills,
on leaving the page and for a spin that lands after the pills came back; `spinTarget.test.ts`;
`useSelectionLock.test.tsx` (the tickets); `PlayerSelection` adopt mode; `HostSelection` with
a spin (reel present, title held back, no countdown); `Devices` settings controls. Browser
check per `docs/dev/verifying.md` on a scratch backend: phone spin → TV reel → Play →
picker; device rules through the report route.

## 4. Documentation

- `docs/user/party/reel.md`: a section *Spin on the host screen* — the button, what the
  phone shows, Spin again, Play, Cancel, the lock (somebody else picking), the reveal wait.
- `docs/user/host-screen/index.md`: the picking screen now also shows the reel.
- `docs/user/selector/cards.md` (*When the start button is pressed with nothing open*) and
  the two sentences in `docs/user/selector/index.md`: the two new scope controls and the
  new random rules (spins without a card, second press starts or respins, no automatic
  start).
- `docs/user/integrate/devices.md` only if it lists the settings keys (it is already over
  the length ceiling — add nothing there without need).
- Screenshots (`docs/screenshots/capture.py` rows + the manifest in
  `docs/dev/screenshots.md`): `host-reel` (the TV with the reel landed and the cards along
  the foot), `reel-host-spin` (the phone's spin view after the reveal). The reel row needs
  the seed to open a spun selection through the API.
- `CLAUDE.md` map rows: `karaoke/` (reel.py, the spin), `components/` (SongReel, HostSpin,
  the HostSelection reel), `pages/` (Devices controls). ADR-013's selection paragraph gains
  one sentence on the spin. `docs/dev/ui-guidelines.md`'s *Random song* bullet gains the
  quiet host button.

## 5. Order of work

1. Backend (§2) and the API-free frontend parts (§3.1, the `adopt` mode of §3.2) in
   parallel — disjoint files. The backend agent regenerates the client last.
2. The API-bound frontend (§3.2 modal, §3.3, §3.4) once the client is regenerated.
3. Documentation and screenshots (§4), then reviews: backend, frontend, docs.

## 6. What shipped, and where it departs from the plan

Commits e42fa7d, 89e2b83, 7abf67b, fb12e85, e57b51c, 80393ce and the documentation round.
Everything in §1 holds. The plan was silent on, or wrong about, the following.

### Backend

- A stale token on `POST /karaoke/selection/spin` is 409 `not_the_opener`, what the other
  token routes answer — §2.3 first said 403 (corrected in fb12e85).
- `SpinRequest` validates its own shape: `playlist_id` goes with the `playlist` scope and
  only there, either way round a 422. A playlist the phone may not see is 404
  (`playlist_or_404`), like on its own route.
- A respin may land on the same song. The pool is `random.choice` over the sorted candidates
  and nothing is excluded; on a one-song wishlist that is every respin.
- A respin that runs dry raises **before** anything is written (fb12e85): the selection,
  its song and its `updated_at` stand exactly as they were, so a phone told *nothing to pick
  from* has not touched the room and the TV's idea of it stays in step. The device's press
  on a dry respin is a log line and a `_touch` — the press still counts as the room being
  busy.
- The device's fallback to `all` covers more than §2.4 said: a playlist that is **gone or
  empty** (the pick over it came back with nothing), a `playlist` scope with **no id set**,
  and a stored scope that is not one (`reel.parse_scope` raising). Each is a log line, and
  the selection says `all`, so a respin picks out of the same everything.
- `RANDOM_SCOPES` is the phone's scopes minus `favorites`; `random_playlist` is bounded
  (`MAX_PLAYLIST_ID_LENGTH = 64`) and never checked against the playlists table.
- The fold rule of §2.2 was built as a new `tags.folded_song_ids` beside
  `hidden_song_ids`: every scope drops the hidden set, `all` alone drops the folded one, and
  fb12e85 proves it for the guest viewer the button picks as.
- `_start_without_selection_locked` keeps `top_wish` as it was and hands `random` to
  `_spin_without_selection_locked`; `reel.top_wish` moved out of `selection.py` with it.

### Frontend

- `useSelectionLock` (e42fa7d) is the shared lock lifecycle §3.2 asked for, lifted out of
  `PlayerSelection`: token, `hold` / `forget` / `close`, the one `keepalive` DELETE,
  `selection.changed` into `onChanged` / `onLost`, and `adopt`. e57b51c made an adopted
  selection survive StrictMode's double effect — the second run of the mount effect must not
  take the room's lock off the first.
- `playerSlots.ts` is the remembered assignment, extracted so `HostSpin` can send it: the
  host spin **does** send the remembered slots on open (§3.2 said nothing about slots), the
  way the player selection does, filtered against the live player and slot lists first so a
  player who left cannot 404 the request. The player selection alone writes it, on Play.
- `HostSpin` had five phases: `opening`, `spun`, `blocked`, `empty`, `lost`. The lost state
  (taken over, expired, or a `not_the_opener` / `no_selection` on a respin) offers **Spin
  again**, which re-opens with the same spin — not *Pick again*. The blocked head names the
  other selection's song (one `GET /karaoke/selection` while blocked). *Spin again* and
  *Play* are off until the reveal, so a respin never starts a second reel over the first.
  The reveal is `spun_at + REVEAL_MS` on the server's clock, capped at `REVEAL_MS` from when
  the timestamp arrived, and keyed on the timestamp rather than a flag so a respin never
  paints the new song for a frame. The empty-pool sentence is per scope.
- `useDieRoll` is the die on the SPIN button, its own hook out of the old `SongSpinner`.
- `HostSelection` keys the landed reel on `opened_at:spin.id`, because the block stays
  mounted across selections and every fresh selection's first spin is number one again.
  The title and artist are held back with a class that keeps them in the layout, so the
  landing moves nothing. The countdown is guarded on the client too.
- The Devices page's start-button line changed with the feature: *The most wished song
  needs a card on a reader and starts at once. A random song spins the reel on the host
  screen first.* The scope row's line carries the two-press rule, and the playlist row's
  line turns into *The saved playlist no longer exists, so the reel spins over all songs.
  Choose another one.* once the playlist list has answered without the saved id.

### Documentation and screenshots

- `host-screen/index.md` gained a section *While singers are picked* rather than one
  paragraph: the page had no section for the picking screen at all (the route table hands
  the cards' stage to `selector/index.md`), and `host-reel` belongs there. `reel-host-spin`
  sits on `party/reel.md`.
- `capture.py` emulates reduced motion, so the TV's reel in `host-reel` lands the moment it
  is drawn and the row is a check, not a wait; the phone's reveal in `reel-host-spin` waits
  `REVEAL_MS` regardless, so that row waits about six seconds in a step. The row presses
  **Cancel** after the shot (`Row.after`) because closing a headless tab is not the
  `pagehide` that gives the lock back. Which song either picture lands on is the server's.
- `integrate/`: only the `selection.changed` payload cell in `events.md` mentions `spin`.
  `devices.md` lists no settings keys and `rest-api.md`'s `/karaoke` row never named the
  selection routes, so neither was touched.

## 7. Third round (2026-09-06, after the user tested it)

The user's five requests, verbatim in spirit, and how each is built. Rulings 1–7 of §1 stand.

**R1. The TV shows the slot cards only for a spin the selector started.** A phone's spin
shows the reel and its result alone; the slots belong to the next screen, the picker.

- Backend: `_Spin.origin: "phone" | "device"`, on `SpinRead`. Set at open (`POST
  /karaoke/selection` with `spin` → `phone`; `_spin_without_selection_locked` → `device`).
- Backend: new token route `POST /karaoke/selection/pick` — the phone moving on from the
  reel to picking singers. It clears `spin` (the selection is an ordinary one from here:
  no respin, the device's press starts or refuses as before), touches `updated_at`,
  broadcasts. 404 `no_selection`, 409 `not_the_opener`, 409 `not_a_spin`.
- Frontend: `HostSpin`'s Play calls `/pick` first (then `forget()` and the adopted picker;
  a failed `/pick` shows the sentence and does not move on). `HostSelection` hides the slot
  row while `selection.spin?.origin === "phone"`, and centres the head in the freed space.

**R2. The reel must not move with the title's length; the text goes under the cover.** The
head of the picking screen becomes one column, centred: the cover (or the reel) on top,
then the title, the artist and the line, each centred and wrapping inside a bounded width
(`max-width` on the text block, `-webkit-line-clamp` 2 for the title). Same layout with and
without the slot cards. The `host-picking` and `host-reel` screenshots change.

**R3. Descenders of the title are cut off.** `.host-selection-title` clamps with
`overflow: hidden` on `line-height: 1.05`; the fix is a line-height that holds the glyphs
(≥ 1.15) with the clamp kept, and no other rule that clips vertically. Check the phone's
`.host-spin-title` too.

**R4. A press while the reel still runs skips the animation.** Both the selector's start
button and the phone's *Spin again* — one rule, in the backend:

- `_Spin.revealed: bool` (false on every spin and respin), on `SpinRead`. `REVEAL_SECONDS
  = 5.5` in `selection.py`, the same figure as the frontend's `REVEAL_MS`; the design says
  so in both places.
- A press on a spun selection — `POST /karaoke/selection/spin` from the phone, or the
  device's `start` press — first checks `not spin.revealed and now < spun_at +
  REVEAL_SECONDS`: if so, it sets `revealed = True`, touches, broadcasts and returns the
  selection (200) — no respin, nothing else. Otherwise the existing rules run (respin;
  for the device: respin if nobody stands on a slot, else start).
- Frontend: `settled` on both clients is `spin.revealed || now >= spun_at + REVEAL_MS`.
  `SongReel` learns to cut a running spin short when `settled` turns true mid-spin: the
  transition is removed, the transform set to the end, `onSettled` fires at once. The
  phone's *Spin again* is **enabled while the TV spins** (it is the skip), and reads
  *Show it* or stays *Spin again* — pick the clearer, say which. The die on it rolls while
  the TV spins (`useDieRoll`).

**R5. The phone's spin view is redesigned.** It reads as the reel page's sibling, not an
empty sheet:

- The song's cover, large (the picker's takeover size or the reel window's size), centred
  in the upper half. While the TV spins, the reel's empty-window logo tile stands in its
  place (no spoiler), and swaps to the cover on the reveal with the result's rise-in.
- Title (wrapping, two lines) and artist under it, centred.
- **Spin again** as the big gradient die button (`.spinner-spin`'s look, with the rolling
  die), the primary of the view; **Play** as the next largest; **Cancel** quiet at the foot.
  No button label wraps at 360 px.
- Waiting line *Spinning on the host screen…* stays, under the tile, as `role="status"`;
  the reveal gets a live region too (reviewer finding 4).

Tests, docs and screenshots follow the existing rows: `reel.md` (skip, the new view),
`host-screen/index.md` (the column head; a phone's spin shows no cards until Play),
`selector/cards.md` (a press during the reel shows the result), the three screenshots
recaptured, this section trimmed to what shipped afterwards.

**R6. The countdown on a selector's spin** (added while the round ran). Ruling 5 of §1 is
narrowed: it stays for a **phone's** spin (no cards on the TV, the phone has Play), and is
lifted for a spin the **selector** started. With `devices.auto_start` on and every slot
holding a known player, the TV counts down *Starting in 3, 2, 1…* as it does on the picking
screen — but never before the reel has landed:

- Backend: `_refresh_auto_start` schedules on a spun selection when `spin.origin ==
  "device"`; the target is `max(now, reveal) + delay_s`, where `reveal` is `spun_at +
  REVEAL_SECONDS`, or `now` when the spin was skipped (`revealed` set by a press). A respin
  cancels the countdown and, with the room still full, schedules it again from the new
  reveal. A skip while a countdown is pending recomputes it from now. A press with players
  on the slots after the reveal starts at once, as before.
- Frontend: `HostSelection` shows the countdown on a spun selection once the reel has
  landed (`settled`), never while the covers fly. The phone's picker is not involved.

### 7.1 What shipped, and where it departs from R1–R6

Commits 1a8763c, def5133, 0b82595, 05e604a, 1a5c834, b934c4b and the documentation round.
R1–R6 hold, with these departures and details the plan left open:

- **The die's label** (R4 left it open): *Show it* while the TV's reel runs and *Spin
  again* once it has landed. The button is `SpinButton`, the gradient die lifted out of
  `SongSpinner` with `useDieRoll` inside it, so the Random song page's SPIN, the playlist
  reel's SPIN and the spin view's die are one component; it stays live and lit while the
  TV spins (busy, not off) and is off only while a respin or Play is on the wire.
- **The countdown takes the line's place** (05e604a) rather than standing under it as R6
  read: the head's height is budgeted to one line, and a line added while the room counted
  down pushed the card row off the stage. The one line reads *Spinning…*, *Picking singers*
  or *Starting in N…*.
- **The head is a height budget** for 1280×720 (R2, R3): the cover — or the reel — at
  `min(28vh, 24vw)`, two lines always reserved for the title (`-webkit-line-clamp: 2` on
  `line-height` 1.3, which is what keeps a descender whole under the clamp), the artist and
  the line inside a text block bounded to `64vw`, and the cards capped at 26vh wide. Same
  head with and without the row; a phone's spin centres it in the stage
  (`.host-selection-solo`) and draws no row at all, not a hidden one.
- **`/pick` starts the countdown a card-filled room is due** (b934c4b, after the round's
  test pass). `pick_singers` first shipped starting no countdown; now the selection is
  ordinary from there in that respect too, so when the selector's cards hold a slot and the
  room is full of known players, `auto_start` counts down from the moment Play is pressed —
  the people were standing at the selector the whole time the reel ran. A room the phone
  filled from memory still starts nothing.
- **The countdown's aim** (R6): `_refresh_auto_start` on the selector's spin targets
  `max(now, spun_at + REVEAL_SECONDS) + delay_s`, `now` once `revealed`; a respin and a
  skip go through `_reschedule_auto_start` (cancel, then schedule again), because
  `_refresh_auto_start` leaves a running countdown alone by design.
- **The TV reads `revealed` live but the clock once per spin**: `over` is a `useMemo` on
  `spun_at`, so a re-render mid-spin (a card landing) never puts the title up early, while
  the broadcast carrying `revealed` cuts the running reel short at once. The phone treats a
  selection whose spin is gone as revealed, because the `/pick` broadcast can arrive before
  the answer to it.
- **A press inside the window changes nothing else**: `POST /karaoke/selection/spin`
  answers 200 with the same song and `revealed: true`, and the selector's `start` press does
  the same and returns, whoever stands on the slots. The window is `REVEAL_SECONDS = 5.5`
  in `selection.py`, the frontend's `REVEAL_MS`, and both files say they must agree.
- **Screenshots**: `host-reel` is the selector's spin now, since a phone's shows no cards.
  `capture.py` presses the seeded device's start button through its report
  (`press_start`, the counter 0 → 1 in the heartbeat's body) with
  `devices.start_without_selection` held at `random` for the row (`hold_settings` grew a
  `devices.` branch), and the host closes the selection with a token-less `DELETE`. No
  countdown in the picture: the seeded room has four slots, one known card, one unknown
  card and two empty slots, so it can never be full, and making it full would rewire the
  seeded device and change `selector-device`'s picture. No separate picture of a phone's
  spin on the TV: `host-screen/index.md` already carries three, and that state is the
  same head without the row, which one sentence covers.

## 8. One page, the modal retired (2026-10-24)

Commit 68ea84f on `feat/design-feedback-round-3`. Until then the phone's side of a host spin
was a separate fullscreen modal, `components/HostSpin.tsx`, opened by a `tv` square beside
SPIN: planned (91b9fe9) in the idiom of `PlayerSelection`, the one fullscreen modal that
holds the room's lock and the screen it hands over to. It carried that modal's header close,
and the R5 redesign (§7) added a **Cancel** at its foot — two ways out of one view. The user
asked for one way out and for one page, ui-guidelines §7's Random song; §3.2 is that page.

- `HostSpin.tsx`, its stylesheet and `HostSpin.test.tsx` are gone. The five phases of §6
  moved into `hooks/useHostSpin.ts` with an `idle` phase in front of them, and the modal's
  tests into `SongSpinner.test.tsx`.
- The *This screen* · *Host screen* pills replace the `tv` square, kept per device in
  `spinTarget.ts`.
- `useSelectionLock` grew `begin()` / `isCurrent(ticket)` and a ticket on `hold`, because
  the page stays mounted across selections, and `close()` became a promise of the DELETE's
  answer.
- `capture.py`'s `reel-host-spin` row gives the room back with the *This screen* pill after
  the shot instead of **Cancel**: the pill is the page's one way out.
