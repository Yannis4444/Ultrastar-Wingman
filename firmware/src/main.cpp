// The player selector device. It reports what lies on its readers and how often each button
// was pressed; every decision about players, slots and songs is the host's.
#include <Arduino.h>

#include "Buttons.h"
#include "CardTracker.h"
#include "Config.h"
#include "Net.h"
#include "ReaderBus.h"
#include "Report.h"
#include "SerialConsole.h"
#include "pins.h"

// The only translation unit that reads the compiled-in version, so a version bump touches
// one object file. scripts/version.py defines both.
#ifndef FIRMWARE_VERSION
#define FIRMWARE_VERSION "0.0.0"
#endif
#ifndef FIRMWARE_GIT
#define FIRMWARE_GIT "unknown"
#endif

namespace {

Config config;
Net net;
SerialConsole console(config, net, FIRMWARE_VERSION, FIRMWARE_GIT);
ReaderBus readers;
CardTracker tracker;
Buttons buttons;
ReportScheduler scheduler;

uint32_t lastReaderTickMs = 0;
// One reader is polled per tick, so the tick is the round divided by the readers in it —
// the three misses a card is allowed have to be three misses of *that* reader, ≈ 300 ms.
// The floor is the RC522's own timeout: an empty reader answers in about 25 ms.
uint32_t readerTickMs = kReaderTickMs;
uint8_t nextReader = 0;
char reportBody[kReportBufferSize];

// Fills the snapshot the report is built from and the scheduler compares against.
ReportState currentState() {
    ReportState state;
    for (uint8_t i = 0; i < kReaderCount; ++i) {
        state.uids[i] = tracker.uid(i);
        state.versions[i] = readers.version(i);
        state.states[i] = readers.state(i);
    }
    for (uint8_t i = 0; i < kButtonCount; ++i) {
        state.presses[i] = buttons.presses(i);
    }
    return state;
}

// One reader per tick, round-robin over the wired positions.
void tickReaders() {
    for (uint8_t attempt = 0; attempt < kReaderCount; ++attempt) {
        const uint8_t index = nextReader;
        nextReader = static_cast<uint8_t>((nextReader + 1) % kReaderCount);
        if (!readers.wired(index)) {
            continue;
        }
        uint8_t uid[10] = {};
        uint8_t uidLength = 0;
        const PollResult result = readers.poll(index, uid, uidLength);
        tracker.update(index, result, uid, uidLength);
        return;
    }
}

} // namespace

void setup() {
    // The config first: the boot `hello` says whether the device is configured.
    config.load();
    console.begin();
    setupButtonPins();
    readers.begin();
    const uint8_t wired = readers.wiredCount();
    readerTickMs = wired > 1 ? kReaderTickMs / wired : kReaderTickMs;
    net.begin();
    if (config.configured()) {
        net.setServer(config.serverUrl(), config.token());
        net.connect(config.ssid(), config.password());
    }
}

void loop() {
    const uint32_t now = millis();

    console.loop();
    if (console.takeConfigured()) {
        // A reconfiguration reaches a device that may already be on another network.
        net.setServer(config.serverUrl(), config.token());
        net.connect(config.ssid(), config.password());
    }
    net.loop(now);

    readButtons(buttons, now);

    if (now - lastReaderTickMs >= readerTickMs) {
        lastReaderTickMs = now;
        tickReaders();
    }

    if (!config.configured() || !net.connected() || !net.readyToPost(now)) {
        return;
    }

    const ReportState state = currentState();
    if (!scheduler.due(state, now)) {
        return;
    }
    if (buildReport(reportBody, sizeof(reportBody), state, FIRMWARE_VERSION, now / 1000,
                    net.rssi()) == 0) {
        return;
    }
    if (net.postReport(reportBody, now) == PostResult::Delivered) {
        // The next report carries the current state anyway, so nothing is queued and a
        // change that happened while the POST ran goes out on the next pass.
        scheduler.sent(state, now);
        tracker.clearChanged();
        buttons.clearChanged();
    }
}
