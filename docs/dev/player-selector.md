# The player selector device

Design of the external player selector: an ESP32 with RFID readers standing in the room,
where singers put their card on a colored slot and the app selects them. Discussed with
the user on 2026-09-05 (the open decisions are the last section); this file is the
reference the implementation is checked against. Behaviour that ships is documented on the
site (`docs/user/`), never here.

## 1. Goal and scope

**In v1**

- One or more devices, each an ESP32 with up to six RC522 readers and up to four buttons,
  wired to a **fixed pin map** so one firmware image fits every build.
- Two reader layouts, chosen per device in the UI: **one reader per singer slot** (a card
  lying on reader 2 *is* the singer on the blue slot) and **one reader, singers in turn**
  (every scan fills the next free slot).
- The logic lives on the host. The device only says what lies on its readers and how often
  each button was pressed; the server turns that into a player selection.
- A **player selection** with a lock: while somebody is picking singers for a song, on a
  phone or at the device, nobody else may start one. The host screen shows the song and
  the colored slots filling up.
- Cards belong to players (`player_cards`), several cards per player, assigned on the
  admin page where the cards lying on the device right now are listed.
- A guided setup in the browser: build instructions, flashing the firmware over USB, Wi-Fi
  and server configuration over the same USB cable, a connection test, a discovery step
  (put a card on every reader, press every button) and the mapping.
- Firmware versioned and protocol versioned; the admin page says when a device needs the
  bundled firmware.
- One new capability, `devices.manage`, for everything above that is configuration.

**Not in v1** (kept possible): a display or a buzzer on the device, a WebSocket to the
device, network discovery (mDNS), ESP32-S3 / C3 builds, assigning a card from the phone's
selection modal, a device that picks songs. LEDs and the update over Wi-Fi were v1
exclusions too; the second round (§11) added both, through the report's response body.

## 2. Hardware

Target board **v1: ESP32 DevKitC (ESP32-WROOM-32, 30 or 38 pins, CP2102 USB bridge)** —
the most common board, UART bridge with auto-reset that esptool-js handles, one flash
offset table. Readers: the AZ-Delivery / generic **RC522** breakout (MFRC522, SPI, **3.3 V
only**, 13–26 mA each). Cards: the kit's MIFARE Classic 1K card and fob (4-byte UIDs); any
ISO 14443A tag works (7-byte UIDs included).

### Pin map (fixed, `firmware/src/pins.h`)

| Signal | GPIO | Note |
|---|---|---|
| SCK / MISO / MOSI (all readers) | 18 / 19 / 23 | VSPI defaults |
| Reader 1…6 SDA (chip select) | 5, 17, 16, 4, 21, 22 | 5 is a strapping pin but safe as a CS; 16/17 are free on WROOM (not on WROVER) |
| Reader RST (all) | 3.3 V | the library resets in software; no GPIO |
| Reader IRQ | unconnected | polling is what detects a card *leaving* |
| Button 1…4 | 32, 33, 25, 26 | to GND, internal pull-ups |
| Power | 5 V on VIN from a ≥ 1 A supply | six readers plus Wi-Fi peaks ≈ 400 mA on 3.3 V |

Readers are numbered by their chip-select pin, buttons by theirs. A build wires as many as
it wants, starting at 1; the firmware probes every position at boot.

### Known hardware trouble, and where it is handled

- **Clone MISO.** Many cheap RC522 clones do not release MISO when deselected, so readers
  that work alone fail together (garbage in `VersionReg`). The firmware reports every
  reader's version byte in every report; the discovery step says "reader 3 answers with
  garbage" instead of silently missing it, and the build page documents the fix (a 74HC125
  buffer per MISO, or modules that answer 0x91/0x92).
- **Two cards in one field** look like a collision; the tracker treats a collision as
  "something is there", never as "removed".
- **UIDs are not unique** (NXP reuses 4-byte ids, "magic" cards rewrite theirs), and a
  phone cannot emulate a fixed MIFARE UID. Documented as a caveat; irrelevant at party
  scale.

## 3. Firmware — `firmware/`

A PlatformIO project, Arduino framework on core 3.x (the pioarduino platform, pinned by
release URL; the registry's `espressif32` stopped at core 2.x). C++17. Library:
**MFRC522v2** (`OSSLibraries/Arduino_MFRC522v2`, pinned by git tag) — one SPI driver object
per chip select, software reset, LGPL. The rules for this code are
[firmware.md](firmware.md).

```
firmware/
  platformio.ini        envs: esp32dev (the target), native (unit tests)
  src/
    main.cpp            setup/loop: probe readers, tick tracker + buttons, report, serial console
    pins.h              the pin map above, and PROTOCOL_VERSION
    Config.{h,cpp}      Wi-Fi, server URL, token in NVS (Preferences)
    SerialConsole.*     the JSON-lines protocol over USB (§5)
    ReaderBus.*         MFRC522v2 glue: probe, poll one reader → uid | none | collision
    CardTracker.*       pure: per-reader state machine (§3.1)
    Buttons.*           pure debounce + the pin glue
    Report.*            pure: the report JSON (§4), the change detection that triggers one
    Net.*               Wi-Fi events, HTTP POST with keep-alive, backoff; hands the
                        response body to Response
    Response.*          pure: the report response (§11.2) — interval, LED targets, update
    Leds.*              the optional NeoPixel strip on GPIO 13, one LED per reader
    Updater.*           the optional update over Wi-Fi (HTTPUpdate with the bearer token)
  test/test_native/     Unity tests for CardTracker, Buttons, Report, Response
  scripts/
    version.py          pre-build: -DFIRMWARE_VERSION from firmware/VERSION (+ git describe)
    merge_bin.py        post-build: one image (bootloader 0x1000, partitions 0x8000,
                        boot_app0 0xE000, app 0x10000) → wingman-esp32.bin
  build.py              pio run + copy image and manifest.json into the backend package
  VERSION               semver of the firmware, bumped by hand
  .clang-format
```

### 3.1 Behaviour

- **Boot.** `SPI.begin(18, 19, 23)`, then every reader position: reset, wait 4 ms, read
  `VersionReg` twice. Known values (0x88, 0x89, 0x90, 0x91, 0x92, 0xB2, 0x12) → wired;
  0x00 / 0xFF → not wired; anything else or two different readings → `fault`. Kept per
  reader, sent in every report.
- **Card tracking**, every 100 ms round-robin over the wired readers. Per reader:
  `absent` —WUPA answers, anticollision+select gives a uid, HaltA→ `present(uid)`;
  `present(uid)` —same uid→ stay (misses = 0); other uid → present(new); collision → stay;
  no answer → misses += 1, three misses (≈ 300 ms) → `absent`. The device never sends
  "placed" / "removed": it sends the state.
- **Buttons**: sampled every tick, a level counts after 40 ms stable, a falling edge
  increments the button's press counter (uint32, since boot).
- **Reporting**: `POST <server_url>/api/v1/devices/report` immediately when the state
  changed (a reader's uid, a counter), else every 5 s (the heartbeat). Keep-alive HTTP,
  `WiFi.setSleep(false)` for latency. A failed POST is retried on the next tick with
  backoff (1 s → 30 s); the next report always carries the *current* state, so nothing is
  queued and nothing is lost.
- **Wi-Fi**: station mode, auto-reconnect, event callbacks set flags only. Without a
  configuration the device idles on the serial console.

### 3.2 Versioning and compatibility

`firmware/VERSION` is the firmware's semver; `PROTOCOL_VERSION` (an integer, in `pins.h`
next to the map it describes) changes only when the report or the serial protocol changes
incompatibly. The server has `devices.protocol.SUPPORTED = 1`; a device reporting another
protocol is recorded (so it appears as "needs update") and answered 426.

### 3.3 Building and bundling

The image is a **generated artifact**: never committed. `firmware/build.py` writes
`wingman-esp32.bin` (merged, for the USB wizard), `wingman-esp32-ota.bin` (the bare app,
for the update over Wi-Fi) and a `manifest.json` (`{"version", "protocol", "builds":
[{"chip": "ESP32", "file", "size", "ota_file", "ota_size"}]}`) into
`backend/src/ultrastar_wingman/devices/firmware/`
(gitignored). PlatformIO and the `clang-format` wheel are pinned in
`firmware/requirements.txt` (installed into the venv, run from PowerShell — see
[firmware.md](firmware.md)); `installer/build.ps1` installs them and runs `build.py` before
PyInstaller, and the spec lists the directory in `datas`. CI gets a `firmware` job (`pio run`, `pio test -e native`,
`pio check`, `clang-format --dry-run -Werror`) and uploads the image as an artifact. A dev
checkout without a build answers `GET /devices/firmware` with 404 `no_firmware`, and the
wizard says how to build one.

## 4. Device → server protocol (REST, snapshot reports)

The device authenticates with a **bearer token** minted when the device is created
(`Authorization: Bearer wd_<40 hex>`), stored hashed like a session token. Device routes
never build a `Principal`; `devices.deps.DeviceDep` resolves the token to its row or answers
401 `unknown_device`.

```
POST /api/v1/devices/report
{
  "protocol": 1, "firmware": "0.1.0", "uptime_s": 1234, "rssi": -61,
  "readers": [ {"index": 0, "state": "wired", "version": "92", "uid": "A1B2C3D4"},
               {"index": 1, "state": "wired", "version": "92", "uid": null},
               {"index": 2, "state": "none",  "version": "00", "uid": null},
               {"index": 3, "state": "fault", "version": "3a", "uid": null}, ... 6 entries ],
  "buttons": [ {"index": 0, "presses": 3}, ... 4 entries ]
}
200 {"ok": true, "protocol": 1, "interval_s": 5}     ← reserved for feedback later
401 {"detail": "unknown_device"}
426 {"detail": "protocol_unsupported", "supported": 1}
```

`state` is the boot probe's verdict (§3.1): `wired`, `none` (nothing answered: `version`
is `"00"`), or `fault` (two different or unknown version bytes: `version` is the raw first
byte, and the reader is never polled). The server shows a fault as such and refuses a role
on a reader that is not `wired`; the version byte alone cannot tell a fault from a clone.

The server keeps the last report per device in memory (`devices.service`), diffs it against
the previous one (a uid appeared / vanished / changed; a counter grew) and hands those
changes to the selection (§6.2). Any report is a heartbeat: `last_seen_at` on the row,
`online = last report < 15 s ago`. A watchdog task (started in the lifespan like the
download worker) marks devices offline and broadcasts `devices.changed` on that transition
only — the report path broadcasts on every state change.

## 5. Browser → device: the serial console (JSON lines, 115200)

Used by the wizard after flashing and whenever a device is reconfigured, over the same
`SerialPort` the flash used. One JSON object per line in both directions; the device
prints nothing else on that port (boot-loader noise is discarded by the client).

| Browser sends | Device answers |
|---|---|
| `{"cmd":"hello"}` | `{"type":"hello","firmware":"0.2.0","build":"<git describe>","protocol":1,"chip":"ESP32","mac":"…","configured":false}` |
| `{"cmd":"scan"}` | `{"type":"networks","networks":[{"ssid":"…","rssi":-50,"secure":true}]}` |
| `{"cmd":"configure","ssid":"…","password":"…","server_url":"http://192.168.0.5:8080","token":"wd_…"}` | `{"type":"ok"}` (blank `ssid`, `server_url` or `token` → `error`), then it connects |
| `{"cmd":"status"}` | the current `status` line (`wifi_failed` with `reason: "not_configured"` on a blank device) |
| (any time) | `{"type":"status","state":"wifi_connecting" \| "wifi_connected" \| "wifi_failed" \| "server_ok" \| "server_failed", …}` — `ip` on `wifi_connected`, `reason` on `wifi_failed`, `http` on the two server states |
| (bad input) | `{"type":"error","error":"bad_json" \| "bad_command" \| "unknown_command" \| "missing_field" \| "empty_field" \| "store_failed" \| "line_too_long"}` — lines are capped at 512 bytes |

The device prints its `hello` line at boot as well. The browser sends `hello` once a second
for up to 10 s before giving up: opening the port asserts DTR/RTS on Windows and may reset
the board. The line protocol and the handshake live in a pure helper
(`frontend/src/deviceSerial.ts`) with vitest coverage; the hardware path is verified by
hand.

## 6. Backend

### 6.1 `devices/` — the four files plus `deps.py`, `firmware.py`, `settings.py`

**Tables** (one migration, plus the seed of `devices.manage` for `admin`):

- `devices`: `id` (uuid hex), `name`, `token_hash`, `created_at`, `last_seen_at`,
  `firmware_version`, `protocol`, `reader_roles` JSON (`{"0": "slot:blue", "1":
  "sequential", "2": "unused"}`), `button_actions` JSON (`{"0": "start", "1": "clear"}`).
  What lies on the readers is live state, not a column.
- `player_cards`: `uid` (uppercase hex, PK), `player_id` → `players.id` (cascade),
  `created_at`.

**Endpoints** (`devices.manage` unless noted):

| Route | Does |
|---|---|
| `GET /devices` | every device with its live state: online, last seen, versions, `compatible`, readers (index, wired/fault, uid, the card's player or "unknown card"), button counters, roles and actions |
| `POST /devices {name}` | creates the row, answers `{device, token}` — the only time the token is readable; the wizard writes it to the device |
| `PATCH /devices/{id} {name?, reader_roles?, button_actions?}` | the mapping; a role on an unwired reader is a 422 |
| `POST /devices/{id}/token` | a new token (reconfiguring a device whose token is lost) |
| `DELETE /devices/{id}` | forgets the device; the cards stay |
| `GET /devices/cards` · `PUT /devices/cards/{uid} {player_id}` · `DELETE /devices/cards/{uid}` | the card ↔ player table |
| `GET /devices/settings` · `PATCH /devices/settings` | the seven private definitions (the `achievements/settings.py` pattern): `auto_start` (bool, default off), `auto_start_delay_s` (int, default 3, 0–30), `rescan_removes` (bool, default on: scanning a card again on a singers-in-turn reader takes that singer off their slot), `selection_idle_s` (int, default 120, 30–900, §11), `start_without_selection` (`nothing` / `top_wish` / `random`, §11), and for `random` the scope `random_scope` (`all` / `wishlist` / `weighted` / `playlist`) with `random_playlist` (a playlist id or `""`) — see [host-reel.md](host-reel.md) |
| `GET /devices/firmware` · `GET /devices/firmware/{file}` | the bundled manifest and image, 404 `no_firmware` without a build |
| `POST /devices/report` | **bearer token**, §4 |

**Events**: `devices.changed` (no payload: online state, a report that changed a reader
or a counter, a row written, a card assigned — every listener refetches `GET /devices`,
which is one admin page and the wizard).

### 6.2 `karaoke/selection.py` — the player selection and its lock

Module state, like the running sing: at most one open selection.

```
Selection: song (SongRead), slots [SlotState(color, player | None, card_uid | None)],
           opened_at, updated_at, token (opener's secret, never in an event)
```

| Route | Does |
|---|---|
| `POST /karaoke/selection {song_id, slots?, force?}` (`karaoke.sing`) | opens one; `slots` is the phone's remembered assignment, and a card lying on a `slot:<color>` reader wins over it — but while **any device is online** the remembered assignment is dropped altogether (`devices.service.device_online`): the cards are how that room picks its singers, and slots pre-filled from the last song get in the way of them, whichever way the readers are mapped (the user's decision, 2026-09-06). 409 `selection_open` while another is open, unless `force` — which needs nothing beyond `karaoke.sing`: anybody may take over, the UI asks first (the user's decision, 2026-09-05) |
| `GET /karaoke/selection` (`songs.view`) | `{selection \| null}` without the token — the host screen, and a phone that reloaded |
| `PUT /karaoke/selection/slots {token, slots}` | the opener moves people around; a wrong token is 409 `not_the_opener` |
| `POST /karaoke/selection/start {token, force?}` | `start_sing` with the selection's slots, then the selection is gone; the same errors as `/karaoke/sing`, `force` needing `karaoke.stop` |
| `DELETE /karaoke/selection?token=…` | the opener gives up; without a token it takes `karaoke.stop` (the host screen's cancel) |

- **Expiry**: a selection untouched for 2 minutes is dropped (lazily on the next call, and
  by the devices watchdog so the TV clears). The modal refreshes it by any write and
  closes it on unmount (`fetch` with `keepalive`).
- **`POST /karaoke/sing` honours the lock**: 409 `selection_open` while one is open, unless
  `force` — so a script cannot play over the room's selection either.
- **Device input** (from `devices.service`, no token):
  - `slot:<color>` reader: uid appears → that slot gets the card's player (or the unknown
    card, with `player = None`); uid vanishes → the slot is emptied if it still holds that
    card's player. No selection open → nothing (the card is simply lying there, and the next
    selection opens with it).
  - `sequential` reader: uid appears → the card's player takes the first free slot; if they
    already stand on one, `rescan_removes` decides: on, they leave it; off, nothing happens.
    An unknown card takes the first free slot as an unknown card. Removal does nothing. No
    selection open → ignored.
  - Naming a card on the admin page (`PUT /devices/cards/{uid}`) reaches the open selection
    too: every slot showing that uid as an unknown card gets the player (`card_identified`),
    and forgetting a card turns such a slot back into the unknown card (`card_forgotten`) —
    the device will not report a card that has not moved, so this is the only moment the
    room can be told.
  - Buttons: `start` = the selection's start (nothing open → nothing); `clear` = every slot
    emptied; `cancel` = the selection closed.
  - **Auto-start**: with `devices.auto_start` on, a report that leaves every slot filled
    by a *known* player starts the song after `auto_start_delay_s` seconds if the slots are
    still full then (the delay is the moment to take a wrong card away).
- A **hidden** player's card still selects them: hiding is about the picker, and the person
  standing at the device is not being picked from a list.
- **Event**: `selection.changed {selection | null}` (the read shape, no token) on every
  change.

### 6.3 Capability

`devices.manage` — admin only by default (`CAPABILITIES`, `ROUTES` in
`test_permissions.py`, a seed migration for `admin` so
`test_the_migration_seeds_the_module_defaults` holds, a line in `people/roles.md`, an icon
for the `devices` group in `RolePermissions.tsx`). Opening and driving a selection is
`karaoke.sing` / `karaoke.stop`, which exist.

## 7. Frontend

- **`PlayerSelection`** works on the shared selection instead of a local assignment: it
  opens one on mount (seeding it with the remembered slots), redraws from
  `selection.changed`, writes every tap as `PUT …/slots`, Play is `POST …/start`, Cancel
  and unmount `DELETE` it. A 409 `selection_open` shows what is being picked ("Somebody is
  picking singers for *Song*") with *Take over* through a `ConfirmModal` — open to every
  `karaoke.sing` holder. A slot with an unknown card says so. The roster and the two-step
  tap stay as they are.
- **Host stage**: `HostSelection` in `.host-stage`, following `HostAchievements`'s
  `onPhase` / `fallback` / `suppressed` contract: while a selection is open and nothing
  plays it **takes the whole screen** like the badges do (no rail, no QR code — the user's
  decision, 2026-09-06): the song at the top (cover, title, artist, "Picking singers", and
  the auto-start countdown line under it), and at the bottom one **card per slot in a row**
  — a colored outline in the slot's hex over the same color darkened towards `--bg`, the
  avatar at the top, the bold name below, taller than wide (3:4) once somebody has taken
  the slot; a slot nobody has taken is a **short box** along the foot of the row (the color
  and the word "empty") that grows into the card when somebody takes it, so the free slots
  are told apart at a glance. An unknown card counts as taken and reads *Unknown card* over
  the placeholder. The cards are the one sanctioned departure from the flat rule, by request.
- **Admin page** `/user/devices` (`ManageMenu` entry *Player selector*, `devices.manage`,
  a new `card` glyph): the three settings of §6.1, then one row per device (name, online dot in
  words, "firmware 0.1.0 · needs update" when the bundled one is newer or the protocol is
  off, a chevron), *Set up a device* (`plus` in the header → `/user/devices/new`), then
  *Cards*: the cards lying on a device right now with their player or *Unknown card*, a tap
  opening the player picker (`PickerRow`s) that writes `PUT /devices/cards/{uid}`, and under
  it every known card with a remove control.
- **Device page** `/user/devices/:id`: name, status (last seen, firmware, protocol, signal),
  the readers as rows (wired / not wired / fault, what lies on it, a role select: a slot
  color, *singers in turn*, *unused*), the buttons as rows (an action select), Save,
  *Change Wi-Fi or server* and *Update firmware* (both re-enter the wizard at the right
  step, on a device that already exists), Delete.
- **Wizard** `/user/devices/new` — six steps, one screen each, a step list at the top:
  1. **Build**: the parts, the pin table, a link to the build page on the site.
  2. **Flash**: needs `isSecureContext` and `navigator.serial`; otherwise the step says to
     open this page on the karaoke PC at `http://localhost:<port>/…`. Pick the port, flash
     the bundled image with a progress bar (esptool-js, lazily imported so a phone never
     loads it), the hold-BOOT hint on failure.
  3. **Configure**: name the device (this is `POST /devices`), Wi-Fi network (a *Scan*
     over serial fills a select) and password, server address prefilled from the join URL,
     never localhost. Sent as one `configure` line; the status lines are shown as they
     arrive.
  4. **Connect**: waits for the device's first report (`devices.changed` → the device is
     online), showing the serial status alongside; on a timeout, the troubleshooting list
     (wrong password, server address, firewall on the port, 2.4 GHz only).
  5. **Discover**: "Put a card on each reader, in the order of your slots", the readers
     lighting up in the order the cards land (live state from `GET /devices`), then "Press
     every button" the same way. Readers answering with a fault are called out here.
  6. **Map**: the proposed roles in the discovered order, the button actions, Save → the
     device page.
  A device can be reflashed and reconfigured from its page through steps 2–4 alone.
- **Dependencies**: `esptool-js` (Apache-2.0, ~30 kB gzipped plus pako) — the ESP flashing
  protocol is not a few lines. Web Serial's types are a hand-written `serial.d.ts`.

## 8. Documentation

Site (needs the user's agreement, documentation.md §2): a new **Host** tab section
`selector/` — *Player selector* — with `index.md` (what it is, how the evening goes with
it), `build.md` (parts, wiring table, the clone caveat), `setup.md` (the six steps and the
troubleshooting) and `cards.md` (assigning cards, several per person, unknown cards). Plus
`integrate/devices.md` for the report protocol (anybody may build another device), a
paragraph in `party/sing.md` (the lock, the TV), and `people/roles.md`. Dev side: this file,
[firmware.md](firmware.md), the codebase map in `CLAUDE.md`, an ADR.

## 9. Work packages

Each is implemented by a subagent, reviewed by another, and committed on this branch in
conventional commits; the whole branch is merged into `main` at the end.

1. **Backend devices core** — module, tables, migration, capability, token auth, report
   endpoint with diffing and online watchdog, cards routes, settings, firmware routes,
   events, tests (permission matrix, 401 on a bad token, 426, diffing, watchdog).
2. **Selection and lock** — `karaoke/selection.py`, routes, the lock on `/karaoke/sing`,
   device input rules, auto-start, expiry, events, tests over the fake launcher.
3. **Firmware** — the PlatformIO project, native tests, build scripts, `build.py`, CI job,
   installer bundling.
4. **Phone and TV** — `PlayerSelection` over the selection, `HostSelection`, tests.
5. **Admin page and device page** — routes, `ManageMenu` entry, glyph, permissions group.
6. **Wizard** — `deviceSerial.ts`, the flasher, the six steps, tests of the pure parts.
7. **Docs and wrap-up** — the site pages, screenshots manifest rows, `CLAUDE.md`, the ADR,
   a browser verification of the phone and host views against a scratch instance.

## 10. Decisions taken with the user (2026-09-05)

| Question | Decision |
|---|---|
| Board | ESP32 DevKitC / WROOM-32 is the only v1 target; S3 / C3 later |
| Transport | REST snapshot reports (§4); no WebSocket, no edge events |
| What a card belongs to | a **player**, guests included (`player_cards.player_id`) |
| Site pages | a new *Player selector* section under the Host tab (§8) plus `integrate/devices.md` |
| The firmware image | built by `installer/build.ps1` and CI, never committed (§3.3) |
| Taking over a selection | anybody with `karaoke.sing`, after a confirmation; idle selections expire after 2 minutes |
| Scanning a card again (singers in turn) | a setting, `rescan_removes`, on by default |

Decided by the agent and open to veto: esptool-js as the one new frontend dependency, the
JSON-lines serial console instead of Improv (Improv cannot carry a URL or a token), MFRC522v2
and the pioarduino platform, the fixed pin map, a hidden player's card still selecting them,
the report's response body reserved for feedback, `devices.manage` admin-only by default.

## 11. The second round (2026-09-06, after the first evening on real hardware)

The user tested a device: it works. This round is the list of fixes and additions agreed on
2026-09-06, "the complete run, LEDs and the like optional". Everything a device does not
have is harmless to it: a strip that is not wired receives colors nobody sees, an update
nobody requested never arrives.

### 11.1 Fixes

- **A card assigned while it lies on a slot moves the slot to the new holder.**
  `selection.card_identified` fills every slot showing that uid — with no player *or with
  another player* — so reassigning Alice's card to Bob mid-selection puts Bob there.
- **A slot a card holds is not the phone's to clear.** `SelectionSlotRead.card_uid` set →
  the phone draws the `card` glyph on the slot, hides its clear button and refuses to
  repoint it (the button is `aria-disabled`, a hint says "held by a card"). The backend
  already keeps the card; this stops the phone from pretending otherwise.
- **One color, one reader, across devices.** `PATCH /devices/{id}` refuses a `slot:<color>`
  another device already maps (422 `slot_taken_elsewhere`); deleting a device frees its colors.
- **The wizard re-proposes after going back to Discover** (`proposedRef` resets when the
  step is left).
- **The protocol is read before the body is validated.** `POST /devices/report` parses the
  raw JSON's `protocol` first; an unsupported one is recorded (`last_seen_at`, `protocol`,
  `firmware` when readable) and answered 426 whatever the rest of the body looks like — a
  future device whose report grew a field still shows as "needs update" instead of 422.
- **The selection token leaves the URL.** `DELETE /karaoke/selection` reads the token from
  the `X-Selection-Token` header (the phone's keepalive `fetch` sets it); `?token=` is gone,
  so it never lands in the access log. PUT and start keep the token in the body.

### 11.2 Additions

- **Claim your own card.** Identity, not a capability: an account with a player may
  `POST /devices/cards/{uid}/claim` for a card that belongs to nobody (409 `card_taken`
  otherwise, 401 without an account), and `DELETE /devices/cards/{uid}` for a card that is
  their own. `GET /devices/cards/unknown` (authenticated) lists the uids lying on any online
  reader right now that belong to nobody; `GET /devices/cards/mine` the caller's own. Every
  `CardRead` carries `on_reader` — the same rule, `service.uids_on_readers()`: the uid lies on
  any reader of a device online right now. The user page gets **My cards** between the record
  and *Manage* (signed in only): the unknown cards on the readers as rows with a *This is
  mine* button, then the caller's cards with a remove control — the card glyph lit in
  `--highlight-blue-light` on the square's unchanged `--input-bg` (the tag square's idiom, a
  mark and not a control), *on the player selector* in the row's name, while `on_reader` —
  one sentence when nothing is there ("Put a card on the player selector to
  claim it.").
- **A selector online is said out loud.** `GET /devices/status` (`players.view`) →
  `{"online": true|false}` (any compatible device online), refetched on `devices.changed`. The
  phone picker shows one quiet line while true ("A player selector is connected. The cards
  decide who sings. You can still change it here."), which is also why it opened empty. The
  host rail shows "Player selector offline" in the rail's meta style once a device has been
  online during this page's life and no longer is.
- **The start button with nothing open** (`devices.start_without_selection`: `"nothing"` |
  `"top_wish"` | `"random"`, default `"nothing"`): a `start` press while no selection is open
  opens one for the most-wished song (`library.service`'s wish ordering, the guest's view of
  the library so a hidden song is never picked), seeded from the cards, and starts it at
  once. No card on any slot reader → nothing happens (logged). `"random"` no longer starts
  anything: since the reel on the host screen (`host-reel.md` §2.4 and §6) it opens a
  **spun** selection over the cards — card or none — out of `devices.random_scope` /
  `devices.random_playlist`, and the next press starts the song if anybody stands on a slot
  and respins otherwise; the automatic start never runs on it. The selection either mode
  opens has no opener token; a phone may take it over like any other.
- **The idle expiry is a setting**: `devices.selection_idle_s` (int, default 120, 30–900),
  read by the devices watchdog into `selection.set_idle_ttl(seconds)` at startup and on every
  PATCH.
- **LEDs, optional.** A WS2812 (NeoPixel) strip, **one LED per reader position** (LED *i*
  is reader *i*), data on **GPIO 13**, 5 V, common ground. The report's response carries what
  each LED shows until the next response:
  `"leds": [{"index": 0, "rgb": "0090c0", "mode": "off" | "dim" | "on" | "blink" | "pulse"}]`,
  and `"interval_s"` drops to 1 while a selection is open (so the strip follows the phone
  within a second) and is 5 otherwise. The rules live in `devices/service.py`
  (`led_states`): a reader mapped to a slot shows its slot color — `dim` while nothing lies
  on it, `on` while a known card does, `blink` for an unknown card, `pulse` for every slot
  while the auto-start counts down, `off` while a song plays; a singers-in-turn reader shows
  white — `pulse` while a selection is open ("scan now"), `dim` otherwise, `off` while a song
  plays; an unmapped or faulted reader is `off`. The firmware applies the list with the
  Adafruit NeoPixel library (pinned) at a fixed `kLedBrightness` and does nothing at all
  when the response has no `leds`. No strip wired → no harm.
- **Firmware update over Wi-Fi, optional.** `POST /devices/{id}/update` (`devices.manage`)
  sets `update_requested_at` on the row; while it is set and the bundled manifest's version
  differs from the device's, the report's response carries
  `"update": {"file": "wingman-esp32-ota.bin", "version": "0.3.0"}` — the **bare app
  image**, not the merged one the USB wizard flashes: `HTTPUpdate` checks for the `0xE9`
  magic at byte 0 and the merged image starts with the bootloader's padding. `build.py`
  therefore bundles both and the manifest's build entry names them apart (`file`/`size` for
  the wizard, `ota_file`/`ota_size` for the update); `image_path` serves either. The device
  fetches `GET /devices/firmware/{file}` with its bearer token (that route accepts a device
  or a `devices.manage` session), flashes it with the Arduino `HTTPUpdate` onto the other OTA
  slot and reboots; its next report, carrying the new version, clears the flag (and so does
  a ten-minute timeout, so a failed attempt can be repeated; the device itself retries no
  sooner than ten minutes after a failure). The device page shows *Update
  over Wi-Fi* beside *Update firmware* (the cable) while the bundled version differs, and
  "Update requested" while the flag stands. The USB wizard stays the fallback.

### 11.3 Documentation and screenshots

`build.md` gains an optional *Lights* section (the strip, GPIO 13, one LED per reader);
`setup.md` the Wi-Fi update and what the lights mean; `cards.md` claiming your own card;
`integrate/devices.md` the response fields and the claim routes; `party/sing.md` the picker's
new line. Screenshots at last: `docs/screenshots/seed.py` creates a device through the API and
posts one report with two cards (one known, one unknown), so `capture.py` can take
`selector-admin` (`/user/devices`), `selector-device` (`/user/devices/:id`) and
`host-picking` (`/host` with a selection open) — the rows go into the manifest table of
`documentation.md` per `screenshots.md`.

### 11.4 Versions

The response gained fields the firmware now reads, so the firmware is **0.3.0**;
`PROTOCOL_VERSION` stays 1 — a 0.2.0 device ignores the new fields and keeps working.
