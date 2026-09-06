# Firmware guidelines — `firmware/`

The rules for the ESP32 code of the player selector device. [code-style.md](code-style.md)
applies where it can (comments, names, boring over clever); this file is what is different
about C++ on a microcontroller. The design the code implements is
[player-selector.md](player-selector.md); the pin map and the two protocols are fixed there,
not here.

## Toolchain

- **PlatformIO**, Arduino framework on **core 3.x** through the pioarduino platform, pinned
  by its release-zip URL in `platformio.ini` (the registry's `espressif32` platform stopped
  at core 2.x). Every dependency is pinned: platform by URL, libraries by version or git tag.
- **C++17**, warnings on (`-Wall -Wextra`), no exceptions, no RTTI-dependent code.
- Run PlatformIO through the repo venv, like everything else Python:
  `D:\git\Ultrastar-Wingman-new\venv\Scripts\python.exe -m platformio <command>` from
  `firmware/`. Never a globally installed `pio`. Both tools are pinned in
  `firmware/requirements.txt` — PlatformIO and the `clang-format` wheel, which ships the
  binary so nothing has to be installed system-wide.
- Run them **from PowerShell, not from a Git Bash shell**: pioarduino installs its toolchain
  through `idf_tools.py`, which refuses an MSYS environment ("MSys/Mingw is not supported")
  and leaves the build without a compiler.

| What | Command (cwd `firmware/`) |
|---|---|
| Install the tools | `venv -m pip install -r firmware/requirements.txt` (cwd repo root) |
| Build the image | `venv -m platformio run -e esp32dev` |
| Unit tests (no hardware) | `venv -m platformio test -e native` |
| Static check | `venv -m platformio check -e esp32dev --skip-packages` (CI adds `--fail-on-defect=high`; the low-severity style notes are not gating) |
| Format check | `..\venv\Scripts\clang-format.exe --dry-run -Werror src/*.cpp src/*.h test/test_native/*.cpp` (clang-format expands the wildcards itself, so this is the same command in PowerShell and in CI's bash) |
| Build and bundle into the backend | `venv firmware/build.py` (cwd repo root) |
| Flash from the command line (dev only) | `venv -m platformio run -e esp32dev -t upload` |

The CI `firmware` job runs the build, the tests, the static check and the format check;
`installer/build.ps1` runs the build alone, through `build.py`. All four must be green
before a firmware change is committed.

## Layout and boundaries

- `src/` holds the firmware, `test/test_native/` the Unity tests, `scripts/` the PlatformIO
  pre/post build scripts, `build.py` the bundler. One class or one concern per `.h`/`.cpp`
  pair, named `PascalCase` like the type inside.
- **Logic is separated from hardware so it can run on the host.** `CardTracker`, `Buttons`'
  debouncer, `Report` and `Response` take plain values (a uid, a level, a response body, a
  timestamp in milliseconds) and return plain values; they include no Arduino header.
  `ReaderBus`, `Net`, `SerialConsole`, `Leds`, `Updater` and `main.cpp` are the glue and are
  verified on the device. A new piece of logic goes into the first group with a test, and
  the glue stays thin — `Response` holds the LED brightness math the strip only renders.
- The firmware is **dumb on purpose**: it reports state and executes the serial commands.
  No decision about players, slots or songs is made on the device. If a feature seems to
  need one, it belongs in `backend/src/ultrastar_wingman/devices/`.

## Runtime rules

- **No blocking in `loop()`.** No `delay()` beyond the 4 ms the RC522 reset needs at boot,
  no busy waits; everything is a state machine ticked from `loop()` with `millis()`.
  Network calls are the exception the HTTP client forces, and they carry a timeout. The
  over-the-air update is the second exception and the larger one — it holds the board for
  the length of a download and then reboots into the new image, which is the end of that
  boot's life. Nothing else may take that liberty; the strip in particular renders from
  `millis()` and returns.
- **No heap in the steady state.** Fixed-size `char` buffers and `snprintf` for the JSON the
  device produces; arrays sized by the pin map's constants (`kReaderCount`, `kButtonCount`).
  Arduino `String` is allowed only in setup-time code (Wi-Fi credentials from NVS) and never
  in the report path. Two allocations are allowed against that rule and no more: the
  `JsonDocument` the report's *answer* is parsed with, which is freed before `parseResponse`
  returns and fills a fixed `ResponseState`, and the pixel buffer the NeoPixel library takes
  once when the strip starts.
- **Parsing needs a parser.** The serial `configure` command carries a password that can hold
  any character, so incoming JSON is parsed with ArduinoJson (v7, pinned), never by hand.
  Outgoing JSON is `snprintf` — the shapes are fixed and small.
- **Timestamps are `uint32_t` milliseconds** and compared by subtraction
  (`now - since >= interval`), so the 49-day wrap is harmless.
- **Wi-Fi event callbacks set flags only.** They run on another task; the work happens in
  `loop()`.
- **Secrets never leave the device.** The Wi-Fi password and the server token are written to
  NVS and never printed, not even in a `log` line, not even truncated.
- **The USB serial port speaks JSON lines and nothing else** once `setup()` has run: no
  `Serial.println("booting")`, no library debug output (`CORE_DEBUG_LEVEL=0`). The browser
  wizard reads that port, and a stray line is a parse error it has to skip.

## Versioning

- `firmware/VERSION` is the firmware's semver. Bump it in the same commit as the change it
  describes: patch for a fix the server cannot tell apart, minor for a visible change (a new
  status line, a new command), major together with `PROTOCOL_VERSION`.
- `PROTOCOL_VERSION` (in `src/pins.h`, beside the map it describes) changes only when the
  report body or the serial console changes in a way an older server or wizard could not
  read. The server's `devices.protocol.SUPPORTED` moves with it in the same commit.
- `PROTOCOL_VERSION` is a header constant; the version and the commit come from
  `scripts/version.py` as `-D` flags and are read in exactly one translation unit
  (`main.cpp`), so nothing but that file knows what version it is. A `-D` is part of every
  compiler command line, so bumping the version does rebuild the tree — a few seconds, and
  the price of not writing the version into a file the build tracks.

## Tests

- **Unity, native environment** (`pio test -e native`), for every pure module: the tracker's
  state machine (placed, still there, swapped, three misses, a collision keeps the card),
  the debouncer (a bounce under 40 ms is nothing, a clean press is one count), the report
  builder (the exact JSON, the "changed" detection) and the response parser (the answer's
  fields and the bounds they are held to, the LED brightness at a phase).
- Nothing in the suite touches SPI, Wi-Fi or the serial port. The glue is verified by hand
  on the device, and the wizard's own tests cover the browser half of the serial protocol.
- Deterministic: tests pass time in as a number, never read a clock.

## Style

- `.clang-format` at `firmware/` (LLVM base, 4-space indent, 100 columns) and the format
  check in CI. Don't argue with the formatter.
- `kConstantCase` for constants, `PascalCase` types, `camelCase` functions and members,
  a trailing underscore on private members.
- Comments explain what the hardware forces ("the RC522 needs 4 ms after reset before
  `VersionReg` reads true", "opening the port asserts DTR on Windows and may reboot the
  board") — never what the code does.
- Commits touching this directory carry the `firmware` scope: `feat(firmware): …`.
