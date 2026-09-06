// The report's answer (docs/dev/player-selector.md §11.2) and what the device makes of it:
// how often the server wants to hear from it, what each LED shows until the next answer,
// and whether a firmware image is waiting. Pure — fixed buffers, no Arduino header — so the
// host tests read the same bodies the server sends.
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "pins.h"

// What one LED does until the next response says otherwise. A mode the server names and
// this firmware does not know is `Off`: a light nobody can explain is worse than a dark one.
enum class LedMode : uint8_t {
    Off = 0,
    Dim,
    On,
    Blink,
    Pulse,
};

struct LedTarget {
    uint8_t r = 0;
    uint8_t g = 0;
    uint8_t b = 0;
    LedMode mode = LedMode::Off;
};

// A file name out of `update`, and the version it carries. Both are bounded: the name goes
// into a URL and the version is only ever compared.
constexpr size_t kUpdateFileSize = 48;
constexpr size_t kUpdateVersionSize = 24;

// The server never sends more than a few hundred bytes; anything larger is not an answer
// this firmware understands and is dropped unread.
constexpr size_t kResponseBufferSize = 1536;

// The bounds a server's `interval_s` is held to before anything reads it.
constexpr uint32_t kMinIntervalS = 1;
constexpr uint32_t kMaxIntervalS = 60;
// Without an `interval_s` the device keeps its own heartbeat.
constexpr uint32_t kDefaultIntervalS = kHeartbeatMs / 1000;

// What the last readable response left behind. It survives every unreadable one, so a
// server that stops answering does not blank the strip.
struct ResponseState {
    uint32_t intervalS = kDefaultIntervalS;
    LedTarget leds[kReaderCount] = {};
    bool hasUpdate = false;
    char updateFile[kUpdateFileSize] = {};
    char updateVersion[kUpdateVersionSize] = {};
};

// Reads one response body into `state` and answers whether it was JSON at all. Per field:
//   * `interval_s` absent → the default; present → clamped to kMinIntervalS…kMaxIntervalS.
//   * `leds` absent → the previous targets stand (a server without lights must not blank a
//     strip); present → every position starts at off and the listed entries are applied,
//     so an index the server left out goes dark instead of holding a stale color.
//   * `update` absent → none is pending; the server drops the field once it is done.
// A body that is not JSON changes nothing at all: `state` is written only after the parse
// succeeded.
bool parseResponse(const char *body, ResponseState &state);

// The heartbeat the device follows: what the server asked for, but never longer than the
// device's own — the server marks a device offline after 15 s and a longer silence than
// kHeartbeatMs would make it flap.
uint32_t heartbeatMs(const ResponseState &state);

// `blink` is half a period on and half off; `pulse` walks up and back down once a period.
constexpr uint32_t kBlinkPeriodMs = 800;
constexpr uint32_t kPulsePeriodMs = 1500;

// The brightness one mode has at one moment, 0…kLedBrightness. `blink` is on and off in
// turn, `pulse` a triangle between dim and on; both read the clock and nothing else, so a
// strip needs no state of its own to render them.
uint8_t ledLevel(LedMode mode, uint32_t nowMs);
