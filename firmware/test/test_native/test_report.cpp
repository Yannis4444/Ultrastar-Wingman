#include <unity.h>

#include <string.h>

#include "Report.h"

namespace {

// One card on reader 1, a second reader wired and empty, the rest unwired, and three
// presses on button 1 — the state of docs/dev/player-selector.md §4.
ReportState knownState() {
    ReportState state;
    state.uids[0] = "A1B2C3D4";
    state.versions[0] = 0x92;
    state.versions[1] = 0x92;
    state.states[0] = ReaderState::Wired;
    state.states[1] = ReaderState::Wired;
    return state;
}

const char kKnownReport[] =
    "{\"protocol\":1,\"firmware\":\"0.1.0\",\"uptime_s\":1234,\"rssi\":-61,\"readers\":["
    "{\"index\":0,\"state\":\"wired\",\"version\":\"92\",\"uid\":\"A1B2C3D4\"},"
    "{\"index\":1,\"state\":\"wired\",\"version\":\"92\",\"uid\":null},"
    "{\"index\":2,\"state\":\"none\",\"version\":\"00\",\"uid\":null},"
    "{\"index\":3,\"state\":\"none\",\"version\":\"00\",\"uid\":null},"
    "{\"index\":4,\"state\":\"none\",\"version\":\"00\",\"uid\":null},"
    "{\"index\":5,\"state\":\"none\",\"version\":\"00\",\"uid\":null}],\"buttons\":["
    "{\"index\":0,\"presses\":3},"
    "{\"index\":1,\"presses\":0},"
    "{\"index\":2,\"presses\":0},"
    "{\"index\":3,\"presses\":0}]}";

} // namespace

void test_the_report_of_a_known_state() {
    ReportState state = knownState();
    state.presses[0] = 3;

    char body[kReportBufferSize] = {};
    const size_t length = buildReport(body, sizeof(body), state, "0.1.0", 1234, -61);

    TEST_ASSERT_EQUAL_STRING(kKnownReport, body);
    TEST_ASSERT_EQUAL_UINT32(static_cast<uint32_t>(strlen(kKnownReport)),
                             static_cast<uint32_t>(length));
}

void test_every_reader_and_button_is_in_the_report() {
    ReportState state;
    char body[kReportBufferSize] = {};
    buildReport(body, sizeof(body), state, "0.1.0", 0, 0);

    TEST_ASSERT_NOT_NULL(
        strstr(body, "{\"index\":5,\"state\":\"none\",\"version\":\"00\",\"uid\":null}"));
    TEST_ASSERT_NOT_NULL(strstr(body, "{\"index\":3,\"presses\":0}"));
}

// A faulted reader is the reason `state` exists: 0x3a is not a version the probe knows, and
// without the field the server would read the byte as a wired reader it may hand a role to.
void test_a_faulted_reader_and_an_unwired_one_say_so() {
    ReportState state = knownState();
    state.states[3] = ReaderState::Fault;
    state.versions[3] = 0x3a;

    char body[kReportBufferSize] = {};
    buildReport(body, sizeof(body), state, "0.1.0", 1234, -61);

    TEST_ASSERT_NOT_NULL(
        strstr(body, "{\"index\":3,\"state\":\"fault\",\"version\":\"3a\",\"uid\":null}"));
    TEST_ASSERT_NOT_NULL(
        strstr(body, "{\"index\":4,\"state\":\"none\",\"version\":\"00\",\"uid\":null}"));
}

void test_a_full_length_uid_and_a_saturated_counter_still_fit() {
    ReportState state;
    for (uint8_t i = 0; i < kReaderCount; ++i) {
        state.uids[i] = "04AABBCCDDEEFF112233";
        state.versions[i] = 0xFF;
        // "fault" is the longest of the three state words, so this is the worst case
        // kReportBufferSize is sized for.
        state.states[i] = ReaderState::Fault;
    }
    for (uint8_t i = 0; i < kButtonCount; ++i) {
        state.presses[i] = 4294967295u;
    }

    char body[kReportBufferSize] = {};
    const size_t length = buildReport(body, sizeof(body), state, "10.10.10", 4294967295u, -127);

    TEST_ASSERT_TRUE(length > 0);
    TEST_ASSERT_EQUAL_UINT32(static_cast<uint32_t>(strlen(body)), static_cast<uint32_t>(length));
    // The number the comment on kReportBufferSize names; a field added to a reader entry
    // moves it, and this is where that is noticed.
    TEST_ASSERT_EQUAL_UINT32(658, static_cast<uint32_t>(length));
}

void test_a_buffer_too_small_writes_nothing() {
    ReportState state = knownState();
    char body[32] = {};

    TEST_ASSERT_EQUAL_UINT32(
        0, static_cast<uint32_t>(buildReport(body, sizeof(body), state, "0.1.0", 1, -1)));
    TEST_ASSERT_EQUAL_STRING("", body);
}

void test_the_first_report_is_due_at_once() {
    ReportScheduler scheduler;
    const ReportState state = knownState();

    TEST_ASSERT_TRUE(scheduler.due(state, 0));
}

void test_an_unchanged_state_waits_for_the_heartbeat() {
    ReportScheduler scheduler;
    const ReportState state = knownState();
    scheduler.sent(state, 1000);

    TEST_ASSERT_FALSE(scheduler.due(state, 1000));
    TEST_ASSERT_FALSE(scheduler.due(state, 5999));
    TEST_ASSERT_TRUE(scheduler.due(state, 6000));
}

void test_a_card_placed_is_due_at_once() {
    ReportScheduler scheduler;
    ReportState state = knownState();
    scheduler.sent(state, 1000);

    state.uids[1] = "041F2E3D";
    TEST_ASSERT_TRUE(scheduler.due(state, 1001));
}

void test_a_card_taken_away_is_due_at_once() {
    ReportScheduler scheduler;
    ReportState state = knownState();
    scheduler.sent(state, 1000);

    state.uids[0] = nullptr;
    TEST_ASSERT_TRUE(scheduler.due(state, 1001));
}

void test_a_button_press_is_due_at_once() {
    ReportScheduler scheduler;
    ReportState state = knownState();
    scheduler.sent(state, 1000);

    state.presses[2] = 1;
    TEST_ASSERT_TRUE(scheduler.due(state, 1001));
}

void test_the_heartbeat_survives_the_wrap() {
    ReportScheduler scheduler;
    const ReportState state = knownState();
    scheduler.sent(state, 0xFFFFF000u);

    TEST_ASSERT_FALSE(scheduler.due(state, 0xFFFFF001u));
    // 0xFFFFF000 + 5000 wraps past zero; the report still goes out on time.
    TEST_ASSERT_TRUE(scheduler.due(state, 0xFFFFF000u + 5000u));
}

void run_report_tests() {
    RUN_TEST(test_the_report_of_a_known_state);
    RUN_TEST(test_every_reader_and_button_is_in_the_report);
    RUN_TEST(test_a_faulted_reader_and_an_unwired_one_say_so);
    RUN_TEST(test_a_full_length_uid_and_a_saturated_counter_still_fit);
    RUN_TEST(test_a_buffer_too_small_writes_nothing);
    RUN_TEST(test_the_first_report_is_due_at_once);
    RUN_TEST(test_an_unchanged_state_waits_for_the_heartbeat);
    RUN_TEST(test_a_card_placed_is_due_at_once);
    RUN_TEST(test_a_card_taken_away_is_due_at_once);
    RUN_TEST(test_a_button_press_is_due_at_once);
    RUN_TEST(test_the_heartbeat_survives_the_wrap);
}
