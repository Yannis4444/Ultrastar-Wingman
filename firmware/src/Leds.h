// The optional WS2812 strip: one LED per reader position, data on kPinLeds. What each one
// shows is the server's to decide (docs/dev/player-selector.md §11.2); this file only
// renders the targets the last response left behind. A build without a strip runs the same
// code and drives a pin nothing is listening on.
#pragma once

#include <Adafruit_NeoPixel.h>

#include <stdint.h>

#include "Response.h"
#include "pins.h"

class Leds {
  public:
    // Allocates the pixel buffer (setup-time, like the Wi-Fi stack) and blanks the strip.
    void begin();

    // Takes the targets of the last response. Renders nothing by itself.
    void apply(const ResponseState &response);

    // Renders the targets at this moment; call every pass of loop(). It writes the strip
    // only when a pixel actually changed — show() holds interrupts for about 180 µs per six
    // pixels, which is cheap once but not worth doing at the speed of loop().
    void tick(uint32_t nowMs);

  private:
    Adafruit_NeoPixel strip_{kReaderCount, kPinLeds, NEO_GRB + NEO_KHZ800};
    LedTarget targets_[kReaderCount] = {};
    uint8_t shown_[kReaderCount][3] = {};
    uint32_t lastTickMs_ = 0;
    bool everShown_ = false;
};
