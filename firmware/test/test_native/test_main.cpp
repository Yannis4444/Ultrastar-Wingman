// The Unity runner of the host tests. Nothing in this suite touches SPI, Wi-Fi or the
// serial port: `pio test -e native` builds the pure modules only.
#include <unity.h>

void run_card_tracker_tests();
void run_buttons_tests();
void run_report_tests();
void run_response_tests();

void setUp() {}

void tearDown() {}

int main() {
    UNITY_BEGIN();
    run_card_tracker_tests();
    run_buttons_tests();
    run_report_tests();
    run_response_tests();
    return UNITY_END();
}
