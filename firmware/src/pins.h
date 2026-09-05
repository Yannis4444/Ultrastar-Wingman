// The fixed pin map of the player selector device (docs/dev/player-selector.md §2), the
// protocol version it speaks, and the timings the hardware forces. One firmware image fits
// every build: a build wires as many readers and buttons as it wants, starting at 1, and
// the firmware probes every position at boot.
#pragma once

#include <stdint.h>

// Bumped only when the report body or the serial console changes in a way an older server
// or wizard could not read. The server's `devices.protocol.SUPPORTED` moves with it.
#define PROTOCOL_VERSION 1

constexpr uint8_t kReaderCount = 6;
constexpr uint8_t kButtonCount = 4;

// VSPI defaults, shared by every reader.
constexpr uint8_t kPinSck = 18;
constexpr uint8_t kPinMiso = 19;
constexpr uint8_t kPinMosi = 23;

// Chip select per reader; readers are numbered by their pin's place in this list. GPIO 5 is
// a strapping pin but safe as a chip select, and 16/17 are free on WROOM (not on WROVER).
constexpr uint8_t kReaderCsPins[kReaderCount] = {5, 17, 16, 4, 21, 22};

// Buttons to GND, internal pull-ups: a pressed button reads low.
constexpr uint8_t kButtonPins[kButtonCount] = {32, 33, 25, 26};

// One reader is polled every tick, round-robin over the wired ones.
constexpr uint32_t kReaderTickMs = 100;
// A level counts once it has been stable this long.
constexpr uint32_t kDebounceMs = 40;
// Three polls without an answer (~300 ms) before a card counts as gone.
constexpr uint8_t kMissesUntilAbsent = 3;
// Without a change, the report goes out this often — it is the device's heartbeat.
constexpr uint32_t kHeartbeatMs = 5000;
// The RC522 needs this long after a reset before VersionReg reads true.
constexpr uint32_t kResetSettleMs = 4;

// A UID is at most 10 bytes (ISO 14443-3), written as uppercase hex without separators.
constexpr uint8_t kUidHexSize = 10 * 2 + 1;
