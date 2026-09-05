// Wi-Fi and server credentials in NVS. Setup-time code, so Arduino String is allowed here
// and nowhere in the report path. Nothing in here is ever printed.
#pragma once

#include <Arduino.h>

class Config {
  public:
    void load();
    // Stores all four values and keeps them in memory; answers false when NVS refused.
    bool save(const String &ssid, const String &password, const String &serverUrl,
              const String &token);

    bool configured() const;

    const String &ssid() const { return ssid_; }
    const String &password() const { return password_; }
    const String &serverUrl() const { return serverUrl_; }
    const String &token() const { return token_; }

  private:
    String ssid_;
    String password_;
    String serverUrl_;
    String token_;
};
