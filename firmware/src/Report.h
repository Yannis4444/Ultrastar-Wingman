// The report body (docs/dev/player-selector.md §4) and the decision when one is due. Pure:
// fixed buffers, snprintf, and time passed in as a number.
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "pins.h"

// What the boot probe made of a reader position — ReaderBus writes it, the report prints
// it. NotWired is 0 so a default-constructed ReportState reads as an empty device.
enum class ReaderState : uint8_t {
    NotWired = 0, // VersionReg reads 0x00 or 0xFF: nothing on that chip select
    Wired = 1,    // a known version byte
    Fault = 2,    // an unknown byte, or two readings that disagree — a clone holding MISO
};

// One snapshot of what the device has to say. `uids` holds nullptr for a reader with
// nothing on it; `versions` is the VersionReg byte the boot probe read (0x00 when the
// position is not wired) and `states` its verdict on that byte, which is what tells a
// faulted reader from a wired one when the byte alone cannot.
struct ReportState {
    const char *uids[kReaderCount] = {};
    uint8_t versions[kReaderCount] = {};
    ReaderState states[kReaderCount] = {};
    uint32_t presses[kButtonCount] = {};
};

// Worst case: six faulted readers with 20 hex digits each and four saturated counters, plus
// the header — 658 bytes, measured by the native test. The rest is room for the JSON to
// grow a field without a new number here.
constexpr size_t kReportBufferSize = 768;

// Writes the report into `out` and returns its length, or 0 when it did not fit.
size_t buildReport(char *out, size_t size, const ReportState &state, const char *firmware,
                   uint32_t uptimeSeconds, int32_t rssi);

// Holds the last state that reached the server, and answers whether the current one has to
// go out now: immediately when anything changed, else once every heartbeat.
class ReportScheduler {
  public:
    // `heartbeatMs` is what the server last asked for (Response.h), the device's own
    // constant when it has asked for nothing.
    bool due(const ReportState &state, uint32_t nowMs, uint32_t heartbeatMs = kHeartbeatMs) const;

    // Called once a report has been delivered — with any HTTP status, since a 401 or a 426
    // is an answer and re-sending the same body would only ask the same question again.
    void sent(const ReportState &state, uint32_t nowMs);

  private:
    char uids_[kReaderCount][kUidHexSize] = {};
    uint32_t presses_[kButtonCount] = {};
    uint32_t lastSentMs_ = 0;
    bool everSent_ = false;
};
