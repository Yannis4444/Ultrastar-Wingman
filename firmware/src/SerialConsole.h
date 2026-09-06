// The browser's half of the setup (docs/dev/player-selector.md §5): one JSON object per
// line, in both directions, at 115200. Nothing else is ever printed on this port — the
// wizard reads every line as JSON — and no secret is printed at all.
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include "Config.h"
#include "Net.h"

class SerialConsole {
  public:
    // `firmware` and `build` are the compiled-in version and `git describe`; keeping them
    // parameters is what holds the macros to the one translation unit that reads them.
    SerialConsole(Config &config, Net &net, const char *firmware, const char *build)
        : config_(config), net_(net), firmware_(firmware), build_(build) {}

    // Opens the port and prints the boot `hello`.
    void begin();

    // Reads what arrived, answers it, and prints the network's queued status lines.
    void loop();

    // The line the device sends unasked, and at boot.
    void sendHello();
    void sendStatus(const NetStatus &status);

    // The two lines an over-the-air update says about itself. Beyond §5's table: a wizard
    // that does not know them skips them like any other status it cannot read.
    void sendUpdating(const char *version);
    void sendUpdateFailed(const char *error);

    // True once a `configure` command stored new credentials, so main can reconnect.
    bool takeConfigured();

  private:
    void handleLine(const char *line);
    void handleConfigure(const JsonDocument &document);
    void pumpScan();

    Config &config_;
    Net &net_;
    const char *firmware_;
    const char *build_;

    // Long enough for a `configure` line: two 63-character Wi-Fi fields, an address and a
    // token, with room for escapes.
    static constexpr size_t kLineSize = 512;
    char line_[kLineSize] = {};
    size_t length_ = 0;
    bool overflowed_ = false;

    bool scanning_ = false;
    bool configured_ = false;
};
