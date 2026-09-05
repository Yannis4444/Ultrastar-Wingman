# Firmware — the player selector device

An ESP32 with up to six RC522 readers and four buttons. It reports what lies on its
readers and how often each button was pressed; every decision is the host's.

`venv` is `..\venv\Scripts\python.exe`; run PlatformIO through it, never a global `pio`, and
from PowerShell — pioarduino's installer refuses an MSYS shell.

| What | Command (cwd `firmware/`) |
|---|---|
| Install the tools | `venv -m pip install -r requirements.txt` |
| Build the image | `venv -m platformio run -e esp32dev` |
| Unit tests (no hardware) | `venv -m platformio test -e native` |
| Static check | `venv -m platformio check -e esp32dev --skip-packages` |
| Format check | `..\venv\Scripts\clang-format.exe --dry-run -Werror src/*.cpp src/*.h test/test_native/*.cpp` |
| Build and bundle into the backend | `venv firmware/build.py` (cwd repo root) |

The rules for this code are [docs/dev/firmware.md](../docs/dev/firmware.md); the design it
implements — pin map, report protocol, serial console — is
[docs/dev/player-selector.md](../docs/dev/player-selector.md).
