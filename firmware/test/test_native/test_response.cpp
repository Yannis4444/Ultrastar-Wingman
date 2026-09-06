#include <unity.h>

#include <string.h>

#include "Response.h"

namespace {

// The answer of docs/dev/player-selector.md §11.2 with a selection open: one second between
// reports, one slot lit for the card lying on it, one waiting, one white reader asking to be
// scanned, and an image waiting.
const char kFullResponse[] =
    "{\"ok\":true,\"protocol\":1,\"interval_s\":1,\"leds\":["
    "{\"index\":0,\"rgb\":\"0090c0\",\"mode\":\"on\"},"
    "{\"index\":1,\"rgb\":\"c04000\",\"mode\":\"dim\"},"
    "{\"index\":2,\"rgb\":\"ffffff\",\"mode\":\"pulse\"},"
    "{\"index\":3,\"rgb\":\"00c000\",\"mode\":\"blink\"}],"
    "\"update\":{\"file\":\"wingman-esp32-ota.bin\",\"version\":\"0.4.0\"}}";

} // namespace

void test_the_full_response() {
    ResponseState state;

    TEST_ASSERT_TRUE(parseResponse(kFullResponse, state));

    TEST_ASSERT_EQUAL_UINT32(1, state.intervalS);
    TEST_ASSERT_EQUAL_UINT8(0x00, state.leds[0].r);
    TEST_ASSERT_EQUAL_UINT8(0x90, state.leds[0].g);
    TEST_ASSERT_EQUAL_UINT8(0xc0, state.leds[0].b);
    TEST_ASSERT_TRUE(state.leds[0].mode == LedMode::On);
    TEST_ASSERT_TRUE(state.leds[1].mode == LedMode::Dim);
    TEST_ASSERT_TRUE(state.leds[2].mode == LedMode::Pulse);
    TEST_ASSERT_TRUE(state.leds[3].mode == LedMode::Blink);
    // Everything the list left out is dark, not whatever it showed a second ago.
    TEST_ASSERT_TRUE(state.leds[4].mode == LedMode::Off);
    TEST_ASSERT_TRUE(state.leds[5].mode == LedMode::Off);
    TEST_ASSERT_TRUE(state.hasUpdate);
    TEST_ASSERT_EQUAL_STRING("wingman-esp32-ota.bin", state.updateFile);
    TEST_ASSERT_EQUAL_STRING("0.4.0", state.updateVersion);
}

void test_an_answer_without_leds_leaves_the_strip_alone() {
    ResponseState state;
    TEST_ASSERT_TRUE(parseResponse(kFullResponse, state));

    // What a server that knows nothing about lights answers.
    TEST_ASSERT_TRUE(parseResponse("{\"ok\":true,\"protocol\":1,\"interval_s\":5}", state));

    TEST_ASSERT_EQUAL_UINT32(5, state.intervalS);
    TEST_ASSERT_TRUE(state.leds[0].mode == LedMode::On);
    TEST_ASSERT_EQUAL_UINT8(0xc0, state.leds[0].b);
    // The update is the other way round: the server drops the field once it is done.
    TEST_ASSERT_FALSE(state.hasUpdate);
}

void test_a_mode_this_firmware_does_not_know_is_off() {
    ResponseState state;

    TEST_ASSERT_TRUE(
        parseResponse("{\"leds\":[{\"index\":0,\"rgb\":\"ff0000\",\"mode\":\"strobe\"}]}", state));

    TEST_ASSERT_TRUE(state.leds[0].mode == LedMode::Off);
    // The color is still read: only the mode was unreadable.
    TEST_ASSERT_EQUAL_UINT8(0xff, state.leds[0].r);
}

void test_a_seventh_entry_is_ignored() {
    ResponseState state;

    TEST_ASSERT_TRUE(parseResponse("{\"leds\":["
                                   "{\"index\":5,\"rgb\":\"ffffff\",\"mode\":\"on\"},"
                                   "{\"index\":6,\"rgb\":\"ff0000\",\"mode\":\"on\"}]}",
                                   state));

    TEST_ASSERT_TRUE(state.leds[5].mode == LedMode::On);
}

void test_a_body_that_is_not_json_changes_nothing() {
    ResponseState state;
    TEST_ASSERT_TRUE(parseResponse(kFullResponse, state));

    TEST_ASSERT_FALSE(parseResponse("<html>502 Bad Gateway</html>", state));
    TEST_ASSERT_FALSE(parseResponse("", state));

    TEST_ASSERT_EQUAL_UINT32(1, state.intervalS);
    TEST_ASSERT_TRUE(state.leds[0].mode == LedMode::On);
    TEST_ASSERT_TRUE(state.hasUpdate);
}

void test_the_interval_is_held_to_its_bounds() {
    ResponseState state;

    TEST_ASSERT_TRUE(parseResponse("{\"interval_s\":0}", state));
    TEST_ASSERT_EQUAL_UINT32(kMinIntervalS, state.intervalS);

    TEST_ASSERT_TRUE(parseResponse("{\"interval_s\":3600}", state));
    TEST_ASSERT_EQUAL_UINT32(kMaxIntervalS, state.intervalS);

    // No `interval_s` at all is the device's own heartbeat.
    TEST_ASSERT_TRUE(parseResponse("{\"ok\":true}", state));
    TEST_ASSERT_EQUAL_UINT32(kDefaultIntervalS, state.intervalS);
}

void test_the_heartbeat_never_grows_past_the_device_s_own() {
    ResponseState state;

    TEST_ASSERT_TRUE(parseResponse("{\"interval_s\":1}", state));
    TEST_ASSERT_EQUAL_UINT32(1000, heartbeatMs(state));

    // 60 s is a legal answer and still not one the device may go silent for: the server
    // calls it offline after 15.
    TEST_ASSERT_TRUE(parseResponse("{\"interval_s\":60}", state));
    TEST_ASSERT_EQUAL_UINT32(kHeartbeatMs, heartbeatMs(state));
}

void test_an_update_the_url_could_not_carry_is_refused() {
    ResponseState state;

    TEST_ASSERT_TRUE(
        parseResponse("{\"update\":{\"file\":\"../../etc/passwd\",\"version\":\"9.9.9\"}}", state));
    TEST_ASSERT_FALSE(state.hasUpdate);

    TEST_ASSERT_TRUE(parseResponse("{\"update\":{\"file\":\"image.bin\"}}", state));
    TEST_ASSERT_FALSE(state.hasUpdate);
}

void test_the_led_levels_of_the_five_modes() {
    TEST_ASSERT_EQUAL_UINT8(0, ledLevel(LedMode::Off, 0));
    TEST_ASSERT_EQUAL_UINT8(kLedBrightness / 4, ledLevel(LedMode::Dim, 12345));
    TEST_ASSERT_EQUAL_UINT8(kLedBrightness, ledLevel(LedMode::On, 12345));

    // Blink: the first half of the period lit, the second dark, and back.
    TEST_ASSERT_EQUAL_UINT8(kLedBrightness, ledLevel(LedMode::Blink, 0));
    TEST_ASSERT_EQUAL_UINT8(kLedBrightness, ledLevel(LedMode::Blink, kBlinkPeriodMs / 2 - 1));
    TEST_ASSERT_EQUAL_UINT8(0, ledLevel(LedMode::Blink, kBlinkPeriodMs / 2));
    TEST_ASSERT_EQUAL_UINT8(0, ledLevel(LedMode::Blink, kBlinkPeriodMs - 1));
    TEST_ASSERT_EQUAL_UINT8(kLedBrightness, ledLevel(LedMode::Blink, kBlinkPeriodMs));

    // Pulse: dim at the ends of the period, full in the middle, and never outside those.
    TEST_ASSERT_EQUAL_UINT8(kLedBrightness / 4, ledLevel(LedMode::Pulse, 0));
    TEST_ASSERT_EQUAL_UINT8(kLedBrightness, ledLevel(LedMode::Pulse, kPulsePeriodMs / 2));
    TEST_ASSERT_EQUAL_UINT8(kLedBrightness / 4, ledLevel(LedMode::Pulse, kPulsePeriodMs));
    for (uint32_t phase = 0; phase < kPulsePeriodMs; ++phase) {
        const uint8_t level = ledLevel(LedMode::Pulse, phase);
        TEST_ASSERT_TRUE(level >= kLedBrightness / 4 && level <= kLedBrightness);
    }
    // It rises to the middle and falls back, symmetrically.
    TEST_ASSERT_EQUAL_UINT8(ledLevel(LedMode::Pulse, 300),
                            ledLevel(LedMode::Pulse, kPulsePeriodMs - 300));
    TEST_ASSERT_TRUE(ledLevel(LedMode::Pulse, 600) > ledLevel(LedMode::Pulse, 300));
}

void run_response_tests() {
    RUN_TEST(test_the_full_response);
    RUN_TEST(test_an_answer_without_leds_leaves_the_strip_alone);
    RUN_TEST(test_a_mode_this_firmware_does_not_know_is_off);
    RUN_TEST(test_a_seventh_entry_is_ignored);
    RUN_TEST(test_a_body_that_is_not_json_changes_nothing);
    RUN_TEST(test_the_interval_is_held_to_its_bounds);
    RUN_TEST(test_the_heartbeat_never_grows_past_the_device_s_own);
    RUN_TEST(test_an_update_the_url_could_not_carry_is_refused);
    RUN_TEST(test_the_led_levels_of_the_five_modes);
}
