#include "Report.h"

#include <stdarg.h>
#include <stdio.h>
#include <string.h>

namespace {

// Appends to `out` at `offset`, keeping the offset past the end when the buffer is full so
// the caller sees one failure at the end instead of a truncated body.
bool append(char *out, size_t size, size_t &offset, const char *format, ...)
    __attribute__((format(printf, 4, 5)));

bool append(char *out, size_t size, size_t &offset, const char *format, ...) {
    if (offset >= size) {
        return false;
    }
    va_list args;
    va_start(args, format);
    const int written = vsnprintf(out + offset, size - offset, format, args);
    va_end(args);
    if (written < 0 || static_cast<size_t>(written) >= size - offset) {
        offset = size;
        return false;
    }
    offset += static_cast<size_t>(written);
    return true;
}

// A state the enum does not name is reported as a fault: the server refuses a role on
// anything but `wired`, so the conservative answer is the safe one.
const char *stateName(ReaderState state) {
    switch (state) {
    case ReaderState::NotWired:
        return "none";
    case ReaderState::Wired:
        return "wired";
    case ReaderState::Fault:
        break;
    }
    return "fault";
}

} // namespace

size_t buildReport(char *out, size_t size, const ReportState &state, const char *firmware,
                   uint32_t uptimeSeconds, int32_t rssi) {
    if (out == nullptr || size == 0) {
        return 0;
    }

    size_t offset = 0;
    bool ok = append(out, size, offset,
                     "{\"protocol\":%d,\"firmware\":\"%s\",\"uptime_s\":%lu,\"rssi\":%ld,"
                     "\"readers\":[",
                     PROTOCOL_VERSION, firmware == nullptr ? "" : firmware,
                     static_cast<unsigned long>(uptimeSeconds), static_cast<long>(rssi));

    for (uint8_t i = 0; i < kReaderCount && ok; ++i) {
        ok = append(out, size, offset,
                    "%s{\"index\":%u,\"state\":\"%s\",\"version\":\"%02x\",\"uid\":",
                    i == 0 ? "" : ",", static_cast<unsigned>(i), stateName(state.states[i]),
                    static_cast<unsigned>(state.versions[i]));
        if (!ok) {
            break;
        }
        if (state.uids[i] == nullptr) {
            ok = append(out, size, offset, "null}");
        } else {
            ok = append(out, size, offset, "\"%s\"}", state.uids[i]);
        }
    }

    if (ok) {
        ok = append(out, size, offset, "],\"buttons\":[");
    }
    for (uint8_t i = 0; i < kButtonCount && ok; ++i) {
        ok = append(out, size, offset, "%s{\"index\":%u,\"presses\":%lu}", i == 0 ? "" : ",",
                    static_cast<unsigned>(i), static_cast<unsigned long>(state.presses[i]));
    }
    if (ok) {
        ok = append(out, size, offset, "]}");
    }

    if (!ok) {
        out[0] = '\0';
        return 0;
    }
    return offset;
}

bool ReportScheduler::due(const ReportState &state, uint32_t nowMs) const {
    if (!everSent_) {
        return true;
    }
    for (uint8_t i = 0; i < kReaderCount; ++i) {
        const char *uid = state.uids[i] == nullptr ? "" : state.uids[i];
        if (strcmp(uids_[i], uid) != 0) {
            return true;
        }
    }
    for (uint8_t i = 0; i < kButtonCount; ++i) {
        if (presses_[i] != state.presses[i]) {
            return true;
        }
    }
    return nowMs - lastSentMs_ >= kHeartbeatMs;
}

void ReportScheduler::sent(const ReportState &state, uint32_t nowMs) {
    for (uint8_t i = 0; i < kReaderCount; ++i) {
        const char *uid = state.uids[i] == nullptr ? "" : state.uids[i];
        snprintf(uids_[i], sizeof(uids_[i]), "%s", uid);
    }
    for (uint8_t i = 0; i < kButtonCount; ++i) {
        presses_[i] = state.presses[i];
    }
    lastSentMs_ = nowMs;
    everSent_ = true;
}
