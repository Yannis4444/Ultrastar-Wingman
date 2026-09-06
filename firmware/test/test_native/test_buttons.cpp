#include <unity.h>

#include "Buttons.h"

namespace {

// The pin is high while the button is released and low while it is held.
constexpr bool kReleased = true;
constexpr bool kPressed = false;

} // namespace

void test_nothing_pressed_is_no_press() {
    Buttons buttons;
    for (uint32_t now = 0; now < 500; now += 10) {
        buttons.update(0, kReleased, now);
    }

    TEST_ASSERT_EQUAL_UINT32(0, buttons.presses(0));
    TEST_ASSERT_FALSE(buttons.changed());
}

void test_a_bounce_under_forty_milliseconds_is_nothing() {
    Buttons buttons;
    buttons.update(0, kPressed, 1000);
    buttons.update(0, kPressed, 1010);
    buttons.update(0, kReleased, 1020);
    buttons.update(0, kReleased, 1100);

    TEST_ASSERT_EQUAL_UINT32(0, buttons.presses(0));
}

void test_a_clean_press_counts_once() {
    Buttons buttons;
    buttons.update(0, kPressed, 1000);
    buttons.update(0, kPressed, 1050);

    TEST_ASSERT_EQUAL_UINT32(1, buttons.presses(0));
    TEST_ASSERT_TRUE(buttons.changed());
}

void test_holding_the_button_still_counts_once() {
    Buttons buttons;
    for (uint32_t now = 1000; now < 5000; now += 10) {
        buttons.update(0, kPressed, now);
    }

    TEST_ASSERT_EQUAL_UINT32(1, buttons.presses(0));
}

void test_releasing_counts_for_nothing() {
    Buttons buttons;
    buttons.update(0, kPressed, 1000);
    buttons.update(0, kPressed, 1050);
    buttons.update(0, kReleased, 1100);
    buttons.update(0, kReleased, 1200);

    TEST_ASSERT_EQUAL_UINT32(1, buttons.presses(0));
}

void test_two_presses_count_twice() {
    Buttons buttons;
    buttons.update(0, kPressed, 1000);
    buttons.update(0, kPressed, 1050);
    buttons.update(0, kReleased, 1100);
    buttons.update(0, kReleased, 1200);
    buttons.update(0, kPressed, 1300);
    buttons.update(0, kPressed, 1400);

    TEST_ASSERT_EQUAL_UINT32(2, buttons.presses(0));
}

void test_buttons_are_counted_apart() {
    Buttons buttons;
    buttons.update(1, kPressed, 1000);
    buttons.update(1, kPressed, 1050);

    TEST_ASSERT_EQUAL_UINT32(0, buttons.presses(0));
    TEST_ASSERT_EQUAL_UINT32(1, buttons.presses(1));
    TEST_ASSERT_EQUAL_UINT32(0, buttons.presses(2));
}

void test_timestamps_may_wrap() {
    Buttons buttons;
    // millis() wraps after 49 days; a press across the wrap is still one press.
    const uint32_t before = 0xFFFFFFF0u;
    buttons.update(0, kPressed, before);
    buttons.update(0, kPressed, before + 60); // wrapped past zero, 60 ms later

    TEST_ASSERT_EQUAL_UINT32(1, buttons.presses(0));
}

void test_a_button_out_of_range_is_ignored() {
    Buttons buttons;
    buttons.update(kButtonCount, kPressed, 1000);
    buttons.update(kButtonCount, kPressed, 1050);

    TEST_ASSERT_EQUAL_UINT32(0, buttons.presses(kButtonCount));
    TEST_ASSERT_FALSE(buttons.changed());
}

void run_buttons_tests() {
    RUN_TEST(test_nothing_pressed_is_no_press);
    RUN_TEST(test_a_bounce_under_forty_milliseconds_is_nothing);
    RUN_TEST(test_a_clean_press_counts_once);
    RUN_TEST(test_holding_the_button_still_counts_once);
    RUN_TEST(test_releasing_counts_for_nothing);
    RUN_TEST(test_two_presses_count_twice);
    RUN_TEST(test_buttons_are_counted_apart);
    RUN_TEST(test_timestamps_may_wrap);
    RUN_TEST(test_a_button_out_of_range_is_ignored);
}
