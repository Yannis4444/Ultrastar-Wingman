// The optional over-the-air update (docs/dev/player-selector.md §11.2). The server asks by
// putting an `update` into a report's answer; the device fetches the image with its own
// bearer token, writes it to the other OTA slot and reboots into it. Everything here is the
// end of a boot's life, so it is the one place that is allowed to take its time.
#pragma once

#include <Arduino.h>

#include <stdint.h>

#include "Response.h"
#include "SerialConsole.h"

class Updater {
  public:
    explicit Updater(SerialConsole &console) : console_(console) {}

    // The same address and token the report goes to. Safe to call again after a
    // reconfiguration.
    void setServer(const String &serverUrl, const String &token);

    // Runs an update when the last response asked for one whose version is not the one
    // running. Blocks for as long as the download takes and does not return on success —
    // the board reboots into the new image.
    void loop(uint32_t nowMs, const ResponseState &response, const char *currentVersion);

  private:
    SerialConsole &console_;
    char baseUrl_[192] = {};
    char authHeader_[80] = {};
    uint32_t nextAttemptMs_ = 0;
    bool waiting_ = false;
};
