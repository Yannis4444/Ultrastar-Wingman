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

void test_an_answer_without_leds_blanks_the_strip() {
    ResponseState state;
    TEST_ASSERT_TRUE(parseResponse(kFullResponse, state));

    // What a server that knows nothing about lights answers. It has no rules for the strip,
    // so the strip shows nothing — a slot lit for the selection before is worse than a dark
    // one. The update is the same way round: the server drops the field once it is done.
    TEST_ASSERT_TRUE(parseResponse("{\"ok\":true,\"protocol\":1,\"interval_s\":5}", state));

    TEST_ASSERT_EQUAL_UINT32(5, state.intervalS);
    for (uint8_t i = 0; i < kReaderCount; ++i) {
        TEST_ASSERT_TRUE(state.leds[i].mode == LedMode::Off);
        TEST_ASSERT_EQUAL_UINT8(0, state.leds[i].b);
    }
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

void test_a_color_the_device_cannot_read_is_black() {
    ResponseState state;

    // Four digits, seven digits, a `#` the server should not send, and a number where a
    // string belongs: the mode is still taken, the color is not guessed at.
    const char *bodies[] = {"{\"leds\":[{\"index\":0,\"rgb\":\"ff00\",\"mode\":\"on\"}]}",
                            "{\"leds\":[{\"index\":0,\"rgb\":\"ff00000\",\"mode\":\"on\"}]}",
                            "{\"leds\":[{\"index\":0,\"rgb\":\"#ff0000\",\"mode\":\"on\"}]}",
                            "{\"leds\":[{\"index\":0,\"rgb\":\"gg0000\",\"mode\":\"on\"}]}",
                            "{\"leds\":[{\"index\":0,\"rgb\":16711680,\"mode\":\"on\"}]}",
                            "{\"leds\":[{\"index\":0,\"mode\":\"on\"}]}"};
    for (const char *body : bodies) {
        TEST_ASSERT_TRUE(parseResponse(body, state));
        TEST_ASSERT_TRUE(state.leds[0].mode == LedMode::On);
        TEST_ASSERT_EQUAL_UINT8(0, state.leds[0].r);
        TEST_ASSERT_EQUAL_UINT8(0, state.leds[0].g);
        TEST_ASSERT_EQUAL_UINT8(0, state.leds[0].b);
    }
}

void test_an_index_outside_the_strip_is_dropped() {
    ResponseState state;

    // A negative index, one past the last reader, and one that is not a whole number at all.
    // None of them may reach a position, and none of them may stop the entry beside it.
    TEST_ASSERT_TRUE(parseResponse("{\"leds\":["
                                   "{\"index\":-1,\"rgb\":\"ff0000\",\"mode\":\"on\"},"
                                   "{\"index\":6,\"rgb\":\"ff0000\",\"mode\":\"on\"},"
                                   "{\"index\":200,\"rgb\":\"ff0000\",\"mode\":\"on\"},"
                                   "{\"index\":\"2\",\"rgb\":\"ff0000\",\"mode\":\"on\"},"
                                   "{\"index\":3,\"rgb\":\"00ff00\",\"mode\":\"on\"}]}",
                                   state));

    for (uint8_t i = 0; i < kReaderCount; ++i) {
        if (i != 3) {
            TEST_ASSERT_TRUE(state.leds[i].mode == LedMode::Off);
            TEST_ASSERT_EQUAL_UINT8(0, state.leds[i].r);
        }
    }
    TEST_ASSERT_TRUE(state.leds[3].mode == LedMode::On);
    TEST_ASSERT_EQUAL_UINT8(0xff, state.leds[3].g);
}

void test_an_empty_list_blanks_the_strip() {
    ResponseState state;
    TEST_ASSERT_TRUE(parseResponse(kFullResponse, state));

    // The list the server sends while a song plays: every reader named, nothing lit — here
    // in its shortest form, which still means "all six off".
    TEST_ASSERT_TRUE(parseResponse("{\"ok\":true,\"leds\":[]}", state));

    for (uint8_t i = 0; i < kReaderCount; ++i) {
        TEST_ASSERT_TRUE(state.leds[i].mode == LedMode::Off);
        TEST_ASSERT_EQUAL_UINT8(0, state.leds[i].b);
    }
}

void test_a_leds_field_that_is_not_a_list_is_no_list_at_all() {
    ResponseState state;

    // Neither §11.2 nor this firmware has a meaning for these; each is read as no list, and
    // no list blanks the strip like an answer that carries none.
    const char *bodies[] = {"{\"leds\":null}", "{\"leds\":{}}", "{\"leds\":5}",
                            "{\"leds\":\"0090c0\"}"};
    for (const char *body : bodies) {
        TEST_ASSERT_TRUE(parseResponse(kFullResponse, state));
        TEST_ASSERT_TRUE(state.leds[0].mode == LedMode::On);

        TEST_ASSERT_TRUE(parseResponse(body, state));
        for (uint8_t i = 0; i < kReaderCount; ++i) {
            TEST_ASSERT_TRUE(state.leds[i].mode == LedMode::Off);
            TEST_ASSERT_EQUAL_UINT8(0, state.leds[i].b);
        }
    }
}

void test_an_interval_that_is_not_a_whole_number_of_seconds_is_the_default() {
    ResponseState state;

    // A string, a fraction and a negative are none of them a number of seconds this device
    // will hold itself to, so it keeps its own heartbeat — the default rather than the
    // minimum, because an answer it cannot read says nothing about how often to report.
    const char *bodies[] = {"{\"interval_s\":\"5\"}", "{\"interval_s\":1.5}", "{\"interval_s\":-5}",
                            "{\"interval_s\":null}", "{\"interval_s\":true}"};
    for (const char *body : bodies) {
        TEST_ASSERT_TRUE(parseResponse("{\"interval_s\":1}", state));
        TEST_ASSERT_EQUAL_UINT32(1, state.intervalS);

        TEST_ASSERT_TRUE(parseResponse(body, state));
        TEST_ASSERT_EQUAL_UINT32(kDefaultIntervalS, state.intervalS);
    }
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

    // A name that would leave the route, one that is not a name, and one longer than the
    // buffer that would carry it. None of them becomes a URL.
    const char *bodies[] = {
        "{\"update\":{\"file\":\"sub/image.bin\",\"version\":\"9.9.9\"}}",
        "{\"update\":{\"file\":\"/etc/passwd\",\"version\":\"9.9.9\"}}",
        "{\"update\":{\"file\":\"image bin\",\"version\":\"9.9.9\"}}",
        "{\"update\":{\"file\":\"..\",\"version\":\"9.9.9\"}}",
        "{\"update\":{\"file\":\"a..b\",\"version\":\"9.9.9\"}}",
        "{\"update\":{\"file\":\"\",\"version\":\"9.9.9\"}}",
        "{\"update\":{\"file\":42,\"version\":\"9.9.9\"}}",
        "{\"update\":{\"file\":\"image.bin\",\"version\":\"\"}}",
        "{\"update\":{\"file\":\"image.bin\",\"version\":42}}",
        "{\"update\":\"wingman-esp32-ota.bin\"}",
        // 48 characters, one more than the name buffer can hold with its terminator.
        "{\"update\":{\"file\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\","
        "\"version\":\"9.9.9\"}}",
        // 24 characters of version, for a buffer that holds 23 and a terminator.
        "{\"update\":{\"file\":\"image.bin\",\"version\":\"999999999999999999999999\"}}"};
    for (const char *body : bodies) {
        TEST_ASSERT_TRUE(parseResponse(body, state));
        TEST_ASSERT_FALSE(state.hasUpdate);
        TEST_ASSERT_EQUAL_STRING("", state.updateFile);
    }

    // The longest name and version that still fit, so the bound is a bound and not a wall
    // one short of what it says.
    TEST_ASSERT_TRUE(parseResponse("{\"update\":{\"file\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                                   "aaaaaaaaaaaaaaa\",\"version\":\"99999999999999999999999\"}}",
                                   state));
    TEST_ASSERT_TRUE(state.hasUpdate);
    TEST_ASSERT_EQUAL_UINT32(kUpdateFileSize - 1, strlen(state.updateFile));
    TEST_ASSERT_EQUAL_UINT32(kUpdateVersionSize - 1, strlen(state.updateVersion));
}

void test_an_answer_as_large_as_the_device_allows_is_still_read_safely() {
    ResponseState state;

    // Net drops a body at kResponseBufferSize before the parser ever sees it; what reaches
    // here is a body just under it, which must still leave the fixed state whole.
    const char head[] = "{\"interval_s\":7,\"note\":\"";
    const char tail[] = "\",\"leds\":[{\"index\":1,\"rgb\":\"0090c0\",\"mode\":\"blink\"}]}";
    char body[kResponseBufferSize] = {};
    strcpy(body, head);
    size_t at = strlen(head);
    while (at < sizeof(body) - sizeof(tail)) {
        body[at++] = 'x';
    }
    strcpy(body + at, tail);

    TEST_ASSERT_TRUE(parseResponse(body, state));
    TEST_ASSERT_EQUAL_UINT32(7, state.intervalS);
    TEST_ASSERT_TRUE(state.leds[1].mode == LedMode::Blink);
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
    RUN_TEST(test_an_answer_without_leds_blanks_the_strip);
    RUN_TEST(test_a_mode_this_firmware_does_not_know_is_off);
    RUN_TEST(test_a_seventh_entry_is_ignored);
    RUN_TEST(test_a_color_the_device_cannot_read_is_black);
    RUN_TEST(test_an_index_outside_the_strip_is_dropped);
    RUN_TEST(test_an_empty_list_blanks_the_strip);
    RUN_TEST(test_a_leds_field_that_is_not_a_list_is_no_list_at_all);
    RUN_TEST(test_an_interval_that_is_not_a_whole_number_of_seconds_is_the_default);
    RUN_TEST(test_a_body_that_is_not_json_changes_nothing);
    RUN_TEST(test_the_interval_is_held_to_its_bounds);
    RUN_TEST(test_the_heartbeat_never_grows_past_the_device_s_own);
    RUN_TEST(test_an_update_the_url_could_not_carry_is_refused);
    RUN_TEST(test_an_answer_as_large_as_the_device_allows_is_still_read_safely);
    RUN_TEST(test_the_led_levels_of_the_five_modes);
}
