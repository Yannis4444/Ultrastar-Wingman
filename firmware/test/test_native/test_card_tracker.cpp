#include <unity.h>

#include "CardTracker.h"

namespace {

const uint8_t kCardA[4] = {0xA1, 0xB2, 0xC3, 0xD4};
const uint8_t kCardB[4] = {0x04, 0x1F, 0x2E, 0x3D};
const uint8_t kLongCard[7] = {0x04, 0x1F, 0x2E, 0x3D, 0x50, 0x61, 0x72};

void place(CardTracker &tracker, uint8_t reader, const uint8_t *uid, uint8_t length) {
    tracker.update(reader, PollResult::Uid, uid, length);
}

} // namespace

void test_a_card_placed_is_present_as_uppercase_hex() {
    CardTracker tracker;
    place(tracker, 0, kCardA, sizeof(kCardA));

    TEST_ASSERT_EQUAL_STRING("A1B2C3D4", tracker.uid(0));
    TEST_ASSERT_TRUE(tracker.changed());
}

void test_a_seven_byte_uid_fits() {
    CardTracker tracker;
    place(tracker, 3, kLongCard, sizeof(kLongCard));

    TEST_ASSERT_EQUAL_STRING("041F2E3D506172", tracker.uid(3));
}

void test_an_empty_reader_holds_nothing() {
    CardTracker tracker;
    tracker.update(1, PollResult::None);

    TEST_ASSERT_NULL(tracker.uid(1));
    TEST_ASSERT_FALSE(tracker.changed());
}

void test_the_same_card_seen_again_is_no_change() {
    CardTracker tracker;
    place(tracker, 0, kCardA, sizeof(kCardA));
    tracker.clearChanged();

    place(tracker, 0, kCardA, sizeof(kCardA));

    TEST_ASSERT_EQUAL_STRING("A1B2C3D4", tracker.uid(0));
    TEST_ASSERT_FALSE(tracker.changed());
}

void test_another_card_replaces_the_first_without_a_gap() {
    CardTracker tracker;
    place(tracker, 0, kCardA, sizeof(kCardA));
    tracker.clearChanged();

    place(tracker, 0, kCardB, sizeof(kCardB));

    TEST_ASSERT_EQUAL_STRING("041F2E3D", tracker.uid(0));
    TEST_ASSERT_TRUE(tracker.changed());
}

void test_three_misses_take_the_card_away() {
    CardTracker tracker;
    place(tracker, 2, kCardA, sizeof(kCardA));
    tracker.clearChanged();

    tracker.update(2, PollResult::None);
    tracker.update(2, PollResult::None);
    TEST_ASSERT_EQUAL_STRING("A1B2C3D4", tracker.uid(2));
    TEST_ASSERT_FALSE(tracker.changed());

    tracker.update(2, PollResult::None);
    TEST_ASSERT_NULL(tracker.uid(2));
    TEST_ASSERT_TRUE(tracker.changed());
}

void test_two_misses_and_the_card_answers_again() {
    CardTracker tracker;
    place(tracker, 2, kCardA, sizeof(kCardA));
    tracker.clearChanged();

    tracker.update(2, PollResult::None);
    tracker.update(2, PollResult::None);
    place(tracker, 2, kCardA, sizeof(kCardA));
    tracker.update(2, PollResult::None);
    tracker.update(2, PollResult::None);

    TEST_ASSERT_EQUAL_STRING("A1B2C3D4", tracker.uid(2));
    TEST_ASSERT_FALSE(tracker.changed());
}

void test_a_card_swapped_during_a_miss_streak_replaces_the_first() {
    CardTracker tracker;
    place(tracker, 1, kCardA, sizeof(kCardA));
    tracker.clearChanged();

    // One card lifted and another put down between two polls: the misses so far count for
    // nothing and the new card is there at once, not after the streak has run out.
    tracker.update(1, PollResult::None);
    tracker.update(1, PollResult::None);
    place(tracker, 1, kCardB, sizeof(kCardB));

    TEST_ASSERT_EQUAL_STRING("041F2E3D", tracker.uid(1));
    TEST_ASSERT_TRUE(tracker.changed());

    // And the fresh card gets three misses of its own before it counts as gone.
    tracker.clearChanged();
    tracker.update(1, PollResult::None);
    tracker.update(1, PollResult::None);
    TEST_ASSERT_EQUAL_STRING("041F2E3D", tracker.uid(1));
    tracker.update(1, PollResult::None);
    TEST_ASSERT_NULL(tracker.uid(1));
    TEST_ASSERT_TRUE(tracker.changed());
}

void test_a_collision_keeps_the_card() {
    CardTracker tracker;
    place(tracker, 0, kCardA, sizeof(kCardA));
    tracker.clearChanged();

    // Two cards in one field answer at once; something is lying there.
    tracker.update(0, PollResult::Collision);
    tracker.update(0, PollResult::Collision);
    tracker.update(0, PollResult::Collision);
    tracker.update(0, PollResult::Collision);

    TEST_ASSERT_EQUAL_STRING("A1B2C3D4", tracker.uid(0));
    TEST_ASSERT_FALSE(tracker.changed());
}

void test_a_collision_resets_the_misses() {
    CardTracker tracker;
    place(tracker, 0, kCardA, sizeof(kCardA));
    tracker.update(0, PollResult::None);
    tracker.update(0, PollResult::None);
    tracker.update(0, PollResult::Collision);
    tracker.update(0, PollResult::None);
    tracker.update(0, PollResult::None);

    TEST_ASSERT_EQUAL_STRING("A1B2C3D4", tracker.uid(0));
}

void test_readers_do_not_touch_each_other() {
    CardTracker tracker;
    place(tracker, 0, kCardA, sizeof(kCardA));
    place(tracker, 5, kCardB, sizeof(kCardB));

    tracker.update(0, PollResult::None);
    tracker.update(0, PollResult::None);
    tracker.update(0, PollResult::None);

    TEST_ASSERT_NULL(tracker.uid(0));
    TEST_ASSERT_EQUAL_STRING("041F2E3D", tracker.uid(5));
}

void test_a_reader_out_of_range_is_ignored() {
    CardTracker tracker;
    place(tracker, kReaderCount, kCardA, sizeof(kCardA));

    TEST_ASSERT_NULL(tracker.uid(kReaderCount));
    TEST_ASSERT_FALSE(tracker.changed());
}

void run_card_tracker_tests() {
    RUN_TEST(test_a_card_placed_is_present_as_uppercase_hex);
    RUN_TEST(test_a_seven_byte_uid_fits);
    RUN_TEST(test_an_empty_reader_holds_nothing);
    RUN_TEST(test_the_same_card_seen_again_is_no_change);
    RUN_TEST(test_another_card_replaces_the_first_without_a_gap);
    RUN_TEST(test_a_card_swapped_during_a_miss_streak_replaces_the_first);
    RUN_TEST(test_three_misses_take_the_card_away);
    RUN_TEST(test_two_misses_and_the_card_answers_again);
    RUN_TEST(test_a_collision_keeps_the_card);
    RUN_TEST(test_a_collision_resets_the_misses);
    RUN_TEST(test_readers_do_not_touch_each_other);
    RUN_TEST(test_a_reader_out_of_range_is_ignored);
}
