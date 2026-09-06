#include "Response.h"

#include <ArduinoJson.h>

#include <stdio.h>
#include <string.h>

namespace {

// `dim` is a quarter of the working brightness: enough to say "this slot is here", not
// enough to be read as "a card lies on it".
constexpr uint8_t kDimLevel = kLedBrightness / 4;

LedMode modeFromName(const char *name) {
    if (name == nullptr) {
        return LedMode::Off;
    }
    if (strcmp(name, "dim") == 0) {
        return LedMode::Dim;
    }
    if (strcmp(name, "on") == 0) {
        return LedMode::On;
    }
    if (strcmp(name, "blink") == 0) {
        return LedMode::Blink;
    }
    if (strcmp(name, "pulse") == 0) {
        return LedMode::Pulse;
    }
    // "off" and everything this firmware has never heard of.
    return LedMode::Off;
}

int hexDigit(char c) {
    if (c >= '0' && c <= '9') {
        return c - '0';
    }
    if (c >= 'a' && c <= 'f') {
        return c - 'a' + 10;
    }
    if (c >= 'A' && c <= 'F') {
        return c - 'A' + 10;
    }
    return -1;
}

// "0090c0" → three bytes. Anything else leaves the color black rather than guessing.
bool parseRgb(const char *hex, LedTarget &target) {
    if (hex == nullptr || strlen(hex) != 6) {
        return false;
    }
    uint8_t bytes[3] = {};
    for (uint8_t i = 0; i < 3; ++i) {
        const int high = hexDigit(hex[i * 2]);
        const int low = hexDigit(hex[i * 2 + 1]);
        if (high < 0 || low < 0) {
            return false;
        }
        bytes[i] = static_cast<uint8_t>(high * 16 + low);
    }
    target.r = bytes[0];
    target.g = bytes[1];
    target.b = bytes[2];
    return true;
}

// The name goes into a URL, so it is one path segment of harmless characters or it is not
// taken at all — a server that has been tampered with cannot walk out of the route.
bool safeFileName(const char *name) {
    if (name == nullptr || name[0] == '\0' || strlen(name) >= kUpdateFileSize) {
        return false;
    }
    for (const char *c = name; *c != '\0'; ++c) {
        const bool allowed = (*c >= 'a' && *c <= 'z') || (*c >= 'A' && *c <= 'Z') ||
                             (*c >= '0' && *c <= '9') || *c == '.' || *c == '-' || *c == '_';
        if (!allowed) {
            return false;
        }
    }
    return strstr(name, "..") == nullptr;
}

} // namespace

bool parseResponse(const char *body, ResponseState &state) {
    if (body == nullptr || body[0] == '\0') {
        return false;
    }

    // One document per report, freed before this returns: the state below is the fixed part.
    JsonDocument document;
    if (deserializeJson(document, body) != DeserializationError::Ok) {
        return false;
    }
    JsonObjectConst root = document.as<JsonObjectConst>();
    if (root.isNull()) {
        return false;
    }

    uint32_t interval = kDefaultIntervalS;
    if (root["interval_s"].is<uint32_t>()) {
        interval = root["interval_s"].as<uint32_t>();
        if (interval < kMinIntervalS) {
            interval = kMinIntervalS;
        } else if (interval > kMaxIntervalS) {
            interval = kMaxIntervalS;
        }
    }
    state.intervalS = interval;

    // Every position starts dark. What the list names it shows; what the list leaves out —
    // and every position when there is no list at all — goes dark rather than holding a
    // stale color. An answer that is not JSON never reaches here, so this is a list the
    // server chose not to send, and a slot still lit for a selection that ended says
    // something untrue about the room.
    for (uint8_t i = 0; i < kReaderCount; ++i) {
        state.leds[i] = LedTarget();
    }
    for (JsonObjectConst led : root["leds"].as<JsonArrayConst>()) {
        if (!led["index"].is<uint8_t>()) {
            continue;
        }
        const uint8_t index = led["index"].as<uint8_t>();
        if (index >= kReaderCount) {
            // A strip has one LED per reader position; a seventh entry is not ours.
            continue;
        }
        LedTarget target;
        target.mode = modeFromName(led["mode"].as<const char *>());
        parseRgb(led["rgb"].as<const char *>(), target);
        state.leds[index] = target;
    }

    state.hasUpdate = false;
    state.updateFile[0] = '\0';
    state.updateVersion[0] = '\0';
    JsonObjectConst update = root["update"].as<JsonObjectConst>();
    if (!update.isNull()) {
        const char *file = update["file"].as<const char *>();
        const char *version = update["version"].as<const char *>();
        if (safeFileName(file) && version != nullptr && version[0] != '\0' &&
            strlen(version) < kUpdateVersionSize) {
            snprintf(state.updateFile, sizeof(state.updateFile), "%s", file);
            snprintf(state.updateVersion, sizeof(state.updateVersion), "%s", version);
            state.hasUpdate = true;
        }
    }

    return true;
}

uint32_t heartbeatMs(const ResponseState &state) {
    const uint32_t asked = state.intervalS * 1000;
    return asked < kHeartbeatMs ? asked : kHeartbeatMs;
}

uint8_t ledLevel(LedMode mode, uint32_t nowMs) {
    switch (mode) {
    case LedMode::Off:
        break;
    case LedMode::Dim:
        return kDimLevel;
    case LedMode::On:
        return kLedBrightness;
    case LedMode::Blink:
        return (nowMs / (kBlinkPeriodMs / 2)) % 2 == 0 ? kLedBrightness : 0;
    case LedMode::Pulse: {
        const uint32_t phase = nowMs % kPulsePeriodMs;
        const uint32_t half = kPulsePeriodMs / 2;
        const uint32_t rising = phase < half ? phase : kPulsePeriodMs - phase;
        const uint32_t span = kLedBrightness - kDimLevel;
        return static_cast<uint8_t>(kDimLevel + (span * rising) / half);
    }
    }
    return 0;
}
