// Button debouncing (docs/dev/player-selector.md §3.1). The debouncer is pure — it takes a
// pin level and a millisecond timestamp — and the pin reading is a thin glue function that
// only exists on the device.
#pragma once

#include <stdint.h>

#include "pins.h"

class Buttons {
  public:
    // `level` is the raw pin: true while the button is released (the internal pull-up holds
    // it high), false while it is pressed. Timestamps are compared by subtraction, so the
    // 49-day wrap of millis() is harmless.
    void update(uint8_t button, bool level, uint32_t nowMs);

    // Presses since boot; the server only ever looks at how much it grew.
    uint32_t presses(uint8_t button) const;

    bool changed() const { return changed_; }
    void clearChanged() { changed_ = false; }

  private:
    uint32_t presses_[kButtonCount] = {};
    uint32_t lastEdgeMs_[kButtonCount] = {};
    // Released is the resting state of a pin held high by its pull-up.
    bool rawLevel_[kButtonCount] = {true, true, true, true};
    bool stableLevel_[kButtonCount] = {true, true, true, true};
    bool changed_ = false;
};

#ifdef ARDUINO
// The glue: puts every button pin on its internal pull-up, and feeds one sample of every
// pin into the debouncer. Kept beside the debouncer it feeds, out of the host build.
void setupButtonPins();
void readButtons(Buttons &buttons, uint32_t nowMs);
#endif
