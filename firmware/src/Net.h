// Wi-Fi and the report POST. The Wi-Fi event callbacks run on another task and only set
// flags; everything else happens in loop(). Status lines are queued here and printed by
// SerialConsole, so this file never touches the port.
#pragma once

#include <Arduino.h>
#include <HTTPClient.h>

#include <stdint.h>

// One line for the wizard: what the device is doing about the network or the server.
struct NetStatus {
    enum class Kind : uint8_t {
        WifiConnecting,
        WifiConnected,
        WifiFailed,
        ServerOk,
        ServerFailed,
    };

    Kind kind = Kind::WifiConnecting;
    char ip[16] = {};
    char reason[24] = {};
    int http = 0;
};

enum class PostResult : uint8_t {
    Delivered, // the server answered — with any status; the body is not read
    Failed,    // the request never got an answer; the backoff grew
};

class Net {
  public:
    // Station mode and the event handlers; called once from setup(), configured or not
    // (a Wi-Fi scan over the console needs the radio up as well).
    void begin();

    // (Re)connects with these credentials. Safe to call again after a reconfiguration.
    void connect(const String &ssid, const String &password);

    // Turns the flags the callbacks set into status lines; call every pass of loop().
    void loop(uint32_t nowMs);

    bool connected() const;
    int32_t rssi() const;

    // The report address and the bearer header, built once so the report path allocates
    // nothing of its own (what HTTPClient does inside is its business).
    void setServer(const String &serverUrl, const String &token);

    // False while the backoff after a failed POST has not run out.
    bool readyToPost(uint32_t nowMs) const;
    PostResult postReport(const char *body, uint32_t nowMs);

    // The asynchronous scan the console's `scan` command drives.
    void beginScan();
    // -1 while it runs, -2 when it failed or none was started, else the number of networks.
    int16_t scanState() const;
    void endScan();

    // Takes the oldest queued status line, oldest first; false when there is none.
    bool takeStatus(NetStatus &status);

  private:
    void push(const NetStatus &status);
    void pushWifiFailed(uint8_t reason);

    static constexpr uint8_t kStatusSlots = 8;
    NetStatus statuses_[kStatusSlots] = {};
    uint8_t head_ = 0;
    uint8_t count_ = 0;

    // Written by the Wi-Fi event callbacks, read by loop().
    volatile bool gotConnected_ = false;
    volatile bool gotDisconnected_ = false;
    volatile uint8_t disconnectReason_ = 0;

    HTTPClient http_;
    char reportUrl_[192] = {};
    char authHeader_[80] = {};

    uint32_t nextPostMs_ = 0;
    uint32_t backoffMs_ = 0;
    bool backoffActive_ = false;
    // Only a change is worth a line: the report goes out every five seconds and the wizard
    // would drown in `server_ok`.
    bool lastPostFailed_ = false;
    int lastHttp_ = 0;
    bool everPosted_ = false;
};
