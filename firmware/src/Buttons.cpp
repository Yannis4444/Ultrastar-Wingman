#include "Buttons.h"

void Buttons::update(uint8_t button, bool level, uint32_t nowMs) {
    if (button >= kButtonCount) {
        return;
    }

    if (level != rawLevel_[button]) {
        rawLevel_[button] = level;
        lastEdgeMs_[button] = nowMs;
        return;
    }
    if (level == stableLevel_[button]) {
        return;
    }
    if (nowMs - lastEdgeMs_[button] < kDebounceMs) {
        return;
    }

    stableLevel_[button] = level;
    // High to low: the button was pressed. Releasing it counts for nothing.
    if (!level) {
        ++presses_[button];
        changed_ = true;
    }
}

uint32_t Buttons::presses(uint8_t button) const {
    if (button >= kButtonCount) {
        return 0;
    }
    return presses_[button];
}

#ifdef ARDUINO

#include <Arduino.h>

void setupButtonPins() {
    for (uint8_t i = 0; i < kButtonCount; ++i) {
        pinMode(kButtonPins[i], INPUT_PULLUP);
    }
}

void readButtons(Buttons &buttons, uint32_t nowMs) {
    for (uint8_t i = 0; i < kButtonCount; ++i) {
        buttons.update(i, digitalRead(kButtonPins[i]) == HIGH, nowMs);
    }
}

#endif
