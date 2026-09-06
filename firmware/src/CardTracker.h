// Per-reader card state machine (docs/dev/player-selector.md §3.1). Pure: it takes what one
// poll saw and returns what lies on the reader. No Arduino header, no clock.
#pragma once

#include <stdint.h>

#include "pins.h"

// What one poll of one reader saw.
enum class PollResult : uint8_t {
    None,      // no answer at all
    Uid,       // a card answered and was selected
    Collision, // something answered but no single uid could be read
};

class CardTracker {
  public:
    // `uid` and `uidLength` are read only for PollResult::Uid.
    void update(uint8_t reader, PollResult result, const uint8_t *uid = nullptr,
                uint8_t uidLength = 0);

    // The uid lying on the reader as uppercase hex, or nullptr while it is absent.
    const char *uid(uint8_t reader) const;

    bool changed() const { return changed_; }
    void clearChanged() { changed_ = false; }

  private:
    void setUid(uint8_t reader, const uint8_t *uid, uint8_t uidLength);

    char uids_[kReaderCount][kUidHexSize] = {};
    uint8_t misses_[kReaderCount] = {};
    bool present_[kReaderCount] = {};
    bool changed_ = false;
};
