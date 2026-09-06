#include "Net.h"

#include <WiFi.h>

namespace {

// A report is a snapshot: it is worth a few seconds and no more.
constexpr uint16_t kHttpTimeoutMs = 3000;
constexpr uint32_t kBackoffStartMs = 1000;
constexpr uint32_t kBackoffMaxMs = 30000;

} // namespace

void Net::begin() {
    // Station mode even without a configuration: the wizard's `scan` needs the radio.
    WiFi.mode(WIFI_STA);
    // Modem sleep costs up to a few hundred milliseconds per report, which the room notices.
    WiFi.setSleep(false);
    WiFi.setAutoReconnect(true);

    WiFi.onEvent([this](arduino_event_id_t, arduino_event_info_t) { gotConnected_ = true; },
                 ARDUINO_EVENT_WIFI_STA_GOT_IP);
    WiFi.onEvent(
        [this](arduino_event_id_t, arduino_event_info_t info) {
            disconnectReason_ = static_cast<uint8_t>(info.wifi_sta_disconnected.reason);
            gotDisconnected_ = true;
        },
        ARDUINO_EVENT_WIFI_STA_DISCONNECTED);

    http_.setReuse(true);
    http_.setTimeout(kHttpTimeoutMs);
    http_.setConnectTimeout(kHttpTimeoutMs);
}

void Net::connect(const String &ssid, const String &password) {
    NetStatus status;
    status.kind = NetStatus::Kind::WifiConnecting;
    push(status);
    WiFi.begin(ssid.c_str(), password.c_str());
}

void Net::setServer(const String &serverUrl, const String &token) {
    // A trailing slash on the configured address would double up on the path.
    String base = serverUrl;
    while (base.endsWith("/")) {
        base.remove(base.length() - 1);
    }
    snprintf(reportUrl_, sizeof(reportUrl_), "%s/api/v1/devices/report", base.c_str());
    snprintf(authHeader_, sizeof(authHeader_), "Bearer %s", token.c_str());
}

void Net::loop(uint32_t) {
    if (gotConnected_) {
        gotConnected_ = false;
        NetStatus status;
        status.kind = NetStatus::Kind::WifiConnected;
        snprintf(status.ip, sizeof(status.ip), "%s", WiFi.localIP().toString().c_str());
        push(status);
    }
    if (gotDisconnected_) {
        gotDisconnected_ = false;
        pushWifiFailed(disconnectReason_);
    }
}

bool Net::connected() const { return WiFi.status() == WL_CONNECTED; }

int32_t Net::rssi() const { return connected() ? WiFi.RSSI() : 0; }

bool Net::readyToPost(uint32_t nowMs) const {
    if (reportUrl_[0] == '\0') {
        return false;
    }
    if (!backoffActive_) {
        return true;
    }
    // `now >= nextPost` written so the 49-day wrap of millis() cannot hold a device back.
    return nowMs - nextPostMs_ < 0x80000000U;
}

bool Net::readBody() {
    responseBody_[0] = '\0';
    const int length = http_.getSize();
    if (length == 0) {
        // A `Content-Length: 0` answer: there is nothing on the socket to take off it.
        return true;
    }
    // Content-Length or nothing: a chunked or unknown-length answer is not one of ours, and
    // reading until the connection drops would hold up loop() for the whole timeout.
    if (length < 0 || static_cast<size_t>(length) >= sizeof(responseBody_)) {
        return false;
    }
    NetworkClient *stream = http_.getStreamPtr();
    if (stream == nullptr) {
        return false;
    }
    // HTTPClient::connect() hands _tcpTimeout (kHttpTimeoutMs, set in begin()) to the
    // client's Stream::setTimeout, which counts milliseconds — so this read is bounded by
    // the same three seconds the request is.
    const size_t read = stream->readBytes(responseBody_, static_cast<size_t>(length));
    responseBody_[read] = '\0';
    if (read != static_cast<size_t>(length)) {
        // Half an answer is not one, and the other half is still on its way.
        responseBody_[0] = '\0';
        return false;
    }
    return true;
}

PostResult Net::postReport(const char *body, uint32_t nowMs, ResponseState &response) {
    http_.begin(reportUrl_);
    http_.addHeader("Content-Type", "application/json");
    http_.addHeader("Authorization", authHeader_);
    const int code =
        http_.POST(reinterpret_cast<uint8_t *>(const_cast<char *>(body)), strlen(body));

    if (code <= 0) {
        // No answer at all: drop the connection and try again later, further out each time.
        http_.end();
        backoffMs_ = backoffMs_ == 0 ? kBackoffStartMs : backoffMs_ * 2;
        if (backoffMs_ > kBackoffMaxMs) {
            backoffMs_ = kBackoffMaxMs;
        }
        nextPostMs_ = nowMs + backoffMs_;
        backoffActive_ = true;
        if (!everPosted_ || !lastPostFailed_ || lastHttp_ != code) {
            NetStatus status;
            status.kind = NetStatus::Kind::ServerFailed;
            status.http = code;
            snprintf(status.reason, sizeof(status.reason), "no_answer");
            push(status);
        }
        everPosted_ = true;
        lastPostFailed_ = true;
        lastHttp_ = code;
        return PostResult::Failed;
    }

    const bool ok = code >= 200 && code < 300;
    responseBody_[0] = '\0';
    // Whether the whole answer came off the socket. A 401 or a 426 carries a body this
    // device has no use for, and it is still counted: what matters is that nothing of it is
    // left behind.
    const bool drained = ok ? readBody() : http_.getSize() == 0;
    if (responseBody_[0] != '\0') {
        // A body that is not JSON is not an error worth a status line: the next report asks
        // again in a second or five.
        parseResponse(responseBody_, response);
    }
    if (!drained) {
        // end() drops what has arrived but cannot drop what is still on its way, and with
        // setReuse those bytes would be the next report's status line — a device that then
        // talks to its server through half a sentence forever. One handshake is cheaper.
        http_.setReuse(false);
    }
    // end() drops whatever is left of the answer and, with setReuse, keeps the connection
    // open for the next report.
    http_.end();
    http_.setReuse(true);
    backoffMs_ = 0;
    backoffActive_ = false;

    const bool failed = !ok;
    if (!everPosted_ || failed != lastPostFailed_ || lastHttp_ != code) {
        NetStatus status;
        status.kind = failed ? NetStatus::Kind::ServerFailed : NetStatus::Kind::ServerOk;
        status.http = code;
        push(status);
    }
    everPosted_ = true;
    lastPostFailed_ = failed;
    lastHttp_ = code;
    return PostResult::Delivered;
}

void Net::beginScan() { WiFi.scanNetworks(true); }

int16_t Net::scanState() const { return WiFi.scanComplete(); }

void Net::endScan() { WiFi.scanDelete(); }

bool Net::takeStatus(NetStatus &status) {
    if (count_ == 0) {
        return false;
    }
    status = statuses_[head_];
    head_ = static_cast<uint8_t>((head_ + 1) % kStatusSlots);
    --count_;
    return true;
}

void Net::push(const NetStatus &status) {
    if (count_ == kStatusSlots) {
        // The wizard is not listening; the newest line is the one worth keeping.
        head_ = static_cast<uint8_t>((head_ + 1) % kStatusSlots);
        --count_;
    }
    statuses_[(head_ + count_) % kStatusSlots] = status;
    ++count_;
}

void Net::pushWifiFailed(uint8_t reason) {
    NetStatus status;
    status.kind = NetStatus::Kind::WifiFailed;
    // The wizard turns the two it can act on into words; the rest is a number for the log.
    switch (reason) {
    case WIFI_REASON_AUTH_FAIL:
    case WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT:
        snprintf(status.reason, sizeof(status.reason), "auth_failed");
        break;
    case WIFI_REASON_NO_AP_FOUND:
        snprintf(status.reason, sizeof(status.reason), "not_found");
        break;
    default:
        snprintf(status.reason, sizeof(status.reason), "reason_%u", static_cast<unsigned>(reason));
        break;
    }
    push(status);
}
