# The reel on the host screen

*Design, 2026-09-06. Branch `feat/host-spinner`. The user's decisions are in §1; everything
else is the plan the agents build from. Where this document and the code disagree after the
round, the code is right and this document is updated.*

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
  `no_selection`, 403 for a stale token (whatever the other token routes answer), 409
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

### 3.2 The phone: *Spin on the host screen*

Under the SPIN button on the Random song page and on a playlist's reel, a **quiet** button
*Spin on the host screen* (a plain `.button`, never the gradient), drawn only for
`karaoke.sing`. Terminology: the user pages call the feature *the reel* and the button
*Spin*; the new button's words are as written here.

Pressing it opens `components/HostSpin.tsx`: a fullscreen modal in `PlayerSelection`'s
idiom. On mount it `POST /karaoke/selection` with `spin` (the select's scope, or the
playlist's id) and holds the token in a ref. Then:

- *Spinning on the host screen…* until `spun_at + REVEAL_MS`, then the title and the
  artist (the phone's reveal waits for the TV's, decision 6).
- **Spin again** (`POST …/spin`, disabled until the reveal), **Play**, **Cancel**.
- Play hands the selection and the token to `PlayerSelection`, which gains an
  `adopt?: { selection, token }` prop: with it the picker opens nothing on mount and
  carries on with the token it was given. `HostSpin` unmounts *without* its DELETE in that
  case. Everything else `PlayerSelection` does — the one hand-written `keepalive` DELETE
  on Cancel/unmount/`pagehide`, the 409 `selection_open` takeover confirm, *Pick again*
  when the selection goes out from under it — `HostSpin` does the same way. Do not write a
  second lock lifecycle; lift the shared parts out of `PlayerSelection` if that is what it
  takes.
- A 409 `empty_pool` is a sentence in the modal, not a crash.

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

`SongReel.test.tsx`, the existing `SongSpinner.test.tsx` kept green, `HostSpin.test.tsx`
(the reveal wait, the three buttons, the takeover, the empty pool), `PlayerSelection`
adopt mode, `HostSelection` with a spin (reel present, title held back, no countdown),
`Devices` settings controls. Browser check per `docs/dev/verifying.md` on a scratch
backend: phone spin → TV reel → Play → picker; device rules through the report route.

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
