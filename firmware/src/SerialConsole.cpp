#include "SerialConsole.h"

#include <WiFi.h>
#include <esp_mac.h>

#include "pins.h"

namespace {

// The manifest names the build "ESP32" and the wizard matches on it; this is the family the
// image is for, not the exact silicon `ESP.getChipModel()` would name.
constexpr char kChip[] = "ESP32";
constexpr uint8_t kMaxNetworks = 20;

// Writes a JSON string body (without the quotes) with the two escapes a Wi-Fi SSID can
// carry, plus the control characters JSON forbids raw.
void printEscaped(const char *value) {
    for (const char *c = value; *c != '\0'; ++c) {
        switch (*c) {
        case '"':
            Serial.print("\\\"");
            break;
        case '\\':
            Serial.print("\\\\");
            break;
        default:
            if (static_cast<unsigned char>(*c) < 0x20) {
                char escape[7];
                snprintf(escape, sizeof(escape), "\\u%04x", static_cast<unsigned>(*c));
                Serial.print(escape);
            } else {
                Serial.write(*c);
            }
            break;
        }
    }
}

void printError(const char *error) {
    char line[64];
    snprintf(line, sizeof(line), "{\"type\":\"error\",\"error\":\"%s\"}", error);
    Serial.println(line);
}

} // namespace

void SerialConsole::begin() {
    Serial.begin(115200);
    sendHello();
}

void SerialConsole::sendHello() {
    uint8_t mac[6] = {};
    // Read off the chip, not off the interface: `WiFi.macAddress` answers nothing until the
    // station netif exists, and the boot hello goes out before the radio is up.
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char line[256];
    // `build` is beyond §5's table: `git describe` of the tree the image was built from, so
    // a device in the room can be traced back to a commit.
    snprintf(line, sizeof(line),
             "{\"type\":\"hello\",\"firmware\":\"%s\",\"protocol\":%d,\"chip\":\"%s\","
             "\"mac\":\"%02X:%02X:%02X:%02X:%02X:%02X\",\"configured\":%s,\"build\":\"%s\"}",
             firmware_, PROTOCOL_VERSION, kChip, mac[0], mac[1], mac[2], mac[3], mac[4], mac[5],
             config_.configured() ? "true" : "false", build_);
    Serial.println(line);
}

void SerialConsole::sendStatus(const NetStatus &status) {
    char line[96];
    switch (status.kind) {
    case NetStatus::Kind::WifiConnecting:
        snprintf(line, sizeof(line), "{\"type\":\"status\",\"state\":\"wifi_connecting\"}");
        break;
    case NetStatus::Kind::WifiConnected:
        snprintf(line, sizeof(line),
                 "{\"type\":\"status\",\"state\":\"wifi_connected\",\"ip\":\"%s\"}", status.ip);
        break;
    case NetStatus::Kind::WifiFailed:
        snprintf(line, sizeof(line),
                 "{\"type\":\"status\",\"state\":\"wifi_failed\",\"reason\":\"%s\"}",
                 status.reason);
        break;
    case NetStatus::Kind::ServerOk:
        snprintf(line, sizeof(line), "{\"type\":\"status\",\"state\":\"server_ok\",\"http\":%d}",
                 status.http);
        break;
    case NetStatus::Kind::ServerFailed:
        snprintf(line, sizeof(line),
                 "{\"type\":\"status\",\"state\":\"server_failed\",\"http\":%d}", status.http);
        break;
    }
    Serial.println(line);
}

void SerialConsole::sendUpdating(const char *version) {
    Serial.print("{\"type\":\"status\",\"state\":\"updating\",\"version\":\"");
    printEscaped(version == nullptr ? "" : version);
    Serial.println("\"}");
}

void SerialConsole::sendUpdateFailed(const char *error) {
    // HTTPUpdate's own sentence, escaped: it is free text and must not break the line.
    Serial.print("{\"type\":\"status\",\"state\":\"update_failed\",\"error\":\"");
    printEscaped(error == nullptr ? "" : error);
    Serial.println("\"}");
}

bool SerialConsole::takeConfigured() {
    const bool configured = configured_;
    configured_ = false;
    return configured;
}

void SerialConsole::loop() {
    while (Serial.available() > 0) {
        const int read = Serial.read();
        if (read < 0) {
            break;
        }
        const char c = static_cast<char>(read);
        if (c == '\r') {
            continue;
        }
        if (c != '\n') {
            if (length_ + 1 < kLineSize) {
                line_[length_++] = c;
            } else {
                overflowed_ = true;
            }
            continue;
        }

        line_[length_] = '\0';
        if (overflowed_) {
            printError("line_too_long");
        } else if (length_ > 0) {
            handleLine(line_);
        }
        length_ = 0;
        overflowed_ = false;
    }

    pumpScan();

    NetStatus status;
    while (net_.takeStatus(status)) {
        sendStatus(status);
    }
}

void SerialConsole::handleLine(const char *line) {
    // The password can hold any character, so the incoming line is parsed, never scanned.
    JsonDocument document;
    if (deserializeJson(document, line) != DeserializationError::Ok) {
        printError("bad_json");
        return;
    }
    const char *command = document["cmd"];
    if (command == nullptr) {
        printError("bad_command");
        return;
    }

    if (strcmp(command, "hello") == 0) {
        sendHello();
        return;
    }
    if (strcmp(command, "scan") == 0) {
        if (!scanning_) {
            scanning_ = true;
            net_.beginScan();
        }
        return;
    }
    if (strcmp(command, "configure") == 0) {
        handleConfigure(document);
        return;
    }
    if (strcmp(command, "status") == 0) {
        NetStatus status;
        if (!config_.configured()) {
            status.kind = NetStatus::Kind::WifiFailed;
            snprintf(status.reason, sizeof(status.reason), "not_configured");
        } else if (net_.connected()) {
            status.kind = NetStatus::Kind::WifiConnected;
            snprintf(status.ip, sizeof(status.ip), "%s", WiFi.localIP().toString().c_str());
        } else {
            status.kind = NetStatus::Kind::WifiConnecting;
        }
        sendStatus(status);
        return;
    }
    printError("unknown_command");
}

void SerialConsole::handleConfigure(const JsonDocument &document) {
    const char *ssid = document["ssid"];
    const char *password = document["password"];
    const char *serverUrl = document["server_url"];
    const char *token = document["token"];
    if (ssid == nullptr || password == nullptr || serverUrl == nullptr || token == nullptr) {
        printError("missing_field");
        return;
    }
    // The password may be empty — an open network has none — but the other three may not, or
    // the `ok` below would promise a connection the device can never try.
    if (*ssid == '\0' || *serverUrl == '\0' || *token == '\0') {
        printError("empty_field");
        return;
    }
    if (!config_.save(ssid, password, serverUrl, token)) {
        printError("store_failed");
        return;
    }
    Serial.println("{\"type\":\"ok\"}");
    configured_ = true;
}

void SerialConsole::pumpScan() {
    if (!scanning_) {
        return;
    }
    const int16_t found = net_.scanState();
    // WIFI_SCAN_RUNNING; anything else is a result, an empty one included.
    if (found == -1) {
        return;
    }
    scanning_ = false;

    Serial.print("{\"type\":\"networks\",\"networks\":[");
    const int16_t count = found < 0 ? 0 : found;
    for (int16_t i = 0; i < count && i < kMaxNetworks; ++i) {
        if (i > 0) {
            Serial.print(",");
        }
        Serial.print("{\"ssid\":\"");
        printEscaped(WiFi.SSID(i).c_str());
        char tail[48];
        snprintf(tail, sizeof(tail), "\",\"rssi\":%d,\"secure\":%s}",
                 static_cast<int>(WiFi.RSSI(i)),
                 WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "false" : "true");
        Serial.print(tail);
    }
    Serial.println("]}");
    net_.endScan();
}
