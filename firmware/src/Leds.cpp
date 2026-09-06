#include "Leds.h"

namespace {

// A pulse at 50 frames a second is smooth to the eye and leaves loop() alone the rest of
// the time.
constexpr uint32_t kFrameMs = 20;

uint8_t scale(uint8_t channel, uint8_t level) {
    return static_cast<uint8_t>((static_cast<uint16_t>(channel) * level) / 255);
}

} // namespace

void Leds::begin() {
    strip_.begin();
    strip_.clear();
    strip_.show();
}

void Leds::apply(const ResponseState &response) {
    for (uint8_t i = 0; i < kReaderCount; ++i) {
        targets_[i] = response.leds[i];
    }
}

void Leds::tick(uint32_t nowMs) {
    if (everShown_ && nowMs - lastTickMs_ < kFrameMs) {
        return;
    }
    lastTickMs_ = nowMs;

    bool changed = !everShown_;
    for (uint8_t i = 0; i < kReaderCount; ++i) {
        const uint8_t level = ledLevel(targets_[i].mode, nowMs);
        const uint8_t rgb[3] = {scale(targets_[i].r, level), scale(targets_[i].g, level),
                                scale(targets_[i].b, level)};
        if (rgb[0] != shown_[i][0] || rgb[1] != shown_[i][1] || rgb[2] != shown_[i][2]) {
            shown_[i][0] = rgb[0];
            shown_[i][1] = rgb[1];
            shown_[i][2] = rgb[2];
            changed = true;
        }
        strip_.setPixelColor(i, strip_.Color(rgb[0], rgb[1], rgb[2]));
    }

    if (changed) {
        strip_.show();
        everShown_ = true;
    }
}
