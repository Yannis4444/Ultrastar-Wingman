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

**Not in v1** (kept possible): feedback on the device (LEDs, a display, a buzzer — the
report's response body is reserved for it), a WebSocket to the device, network discovery
(mDNS), ESP32-S3 / C3 builds, assigning a card from the phone's selection modal, a device
that picks songs.

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
    Net.*               Wi-Fi events, HTTP POST with keep-alive, backoff
  test/test_native/     Unity tests for CardTracker, Buttons, Report
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
`wingman-esp32.bin` and a `manifest.json` (`{"version", "protocol", "builds": [{"chip":
"ESP32", "file", "size"}]}`) into `backend/src/ultrastar_wingman/devices/firmware/`
(gitignored). PlatformIO (`platformio` on pip) is a build-time dependency in the
`packaging` extra; `installer/build.ps1` runs `build.py` before PyInstaller, and the spec
lists the directory in `datas`. CI gets a `firmware` job (`pio run`, `pio test -e native`,
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
| `{"cmd":"hello"}` | `{"type":"hello","firmware":"0.1.0","protocol":1,"chip":"ESP32","mac":"…","configured":false}` |
| `{"cmd":"scan"}` | `{"type":"networks","networks":[{"ssid":"…","rssi":-50,"secure":true}]}` |
| `{"cmd":"configure","ssid":"…","password":"…","server_url":"http://192.168.0.5:8080","token":"wd_…"}` | `{"type":"ok"}`, then it connects |
| (any time) | `{"type":"status","state":"wifi_connecting" \| "wifi_connected" \| "wifi_failed" \| "server_ok" \| "server_failed", …}` with `ip`, `reason` or `http` |

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
| `GET /devices/settings` · `PATCH /devices/settings` | `auto_start` (bool, default off), `auto_start_delay_s` (int, default 3, 0–30), `rescan_removes` (bool, default on: scanning a card again on a singers-in-turn reader takes that singer off their slot): private definitions, the `achievements/settings.py` pattern |
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
| `POST /karaoke/selection {song_id, slots?, force?}` (`karaoke.sing`) | opens one; `slots` is the phone's remembered assignment, and a card lying on a `slot:<color>` reader wins over it. 409 `selection_open` while another is open, unless `force` — which needs nothing beyond `karaoke.sing`: anybody may take over, the UI asks first (the user's decision, 2026-09-05) |
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
  plays, the cover, title and artist over the colored slots filling up (avatar and name, or
  "empty", or "unknown card"), and the auto-start countdown line when it is on.
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
