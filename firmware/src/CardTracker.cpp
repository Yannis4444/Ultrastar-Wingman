#include "CardTracker.h"

#include <stdio.h>
#include <string.h>

namespace {

// The library's Uid buffer is 10 bytes; anything longer is not a UID we can carry.
constexpr uint8_t kMaxUidBytes = (kUidHexSize - 1) / 2;

} // namespace

void CardTracker::setUid(uint8_t reader, const uint8_t *uid, uint8_t uidLength) {
    char text[kUidHexSize] = {};
    if (uid != nullptr && uidLength > 0 && uidLength <= kMaxUidBytes) {
        for (uint8_t i = 0; i < uidLength; ++i) {
            snprintf(&text[i * 2], 3, "%02X", uid[i]);
        }
    }
    if (strcmp(uids_[reader], text) != 0) {
        memcpy(uids_[reader], text, sizeof(text));
        changed_ = true;
    }
}

void CardTracker::update(uint8_t reader, PollResult result, const uint8_t *uid, uint8_t uidLength) {
    if (reader >= kReaderCount) {
        return;
    }

    switch (result) {
    case PollResult::Uid:
        misses_[reader] = 0;
        if (!present_[reader]) {
            present_[reader] = true;
            changed_ = true;
        }
        // A different card on the same reader is a change without a gap in between.
        setUid(reader, uid, uidLength);
        break;

    case PollResult::Collision:
        // Two cards in one field answer at once. Something is lying there, so the card we
        // know about stays — a collision is never a removal.
        misses_[reader] = 0;
        break;

    case PollResult::None:
        if (!present_[reader]) {
            break;
        }
        if (misses_[reader] < kMissesUntilAbsent) {
            ++misses_[reader];
        }
        if (misses_[reader] >= kMissesUntilAbsent) {
            present_[reader] = false;
            uids_[reader][0] = '\0';
            changed_ = true;
        }
        break;
    }
}

const char *CardTracker::uid(uint8_t reader) const {
    if (reader >= kReaderCount || !present_[reader] || uids_[reader][0] == '\0') {
        return nullptr;
    }
    return uids_[reader];
}
