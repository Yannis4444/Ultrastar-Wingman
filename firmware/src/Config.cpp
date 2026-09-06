#include "Config.h"

#include <Preferences.h>

namespace {

// NVS namespace names are limited to 15 characters.
constexpr char kNamespace[] = "wingman";
constexpr char kKeySsid[] = "ssid";
constexpr char kKeyPassword[] = "password";
constexpr char kKeyServerUrl[] = "server_url";
constexpr char kKeyToken[] = "token";

} // namespace

void Config::load() {
    Preferences preferences;
    if (!preferences.begin(kNamespace, true)) {
        return;
    }
    ssid_ = preferences.getString(kKeySsid, "");
    password_ = preferences.getString(kKeyPassword, "");
    serverUrl_ = preferences.getString(kKeyServerUrl, "");
    token_ = preferences.getString(kKeyToken, "");
    preferences.end();
}

bool Config::save(const String &ssid, const String &password, const String &serverUrl,
                  const String &token) {
    Preferences preferences;
    if (!preferences.begin(kNamespace, false)) {
        return false;
    }
    // putString answers with the number of bytes it stored, which is 0 for an empty value
    // as well as for a refusal — comparing against the length tells the two apart.
    const bool ok = preferences.putString(kKeySsid, ssid) == ssid.length() &&
                    preferences.putString(kKeyPassword, password) == password.length() &&
                    preferences.putString(kKeyServerUrl, serverUrl) == serverUrl.length() &&
                    preferences.putString(kKeyToken, token) == token.length();
    preferences.end();
    if (!ok) {
        return false;
    }

    ssid_ = ssid;
    password_ = password;
    serverUrl_ = serverUrl;
    token_ = token;
    return true;
}

bool Config::configured() const {
    // The password is the one value that may be empty: an open network has none, and §5's
    // `scan` answer offers those with `secure: false`. The other three have to be there, or
    // the device has nothing to connect to and nothing to report with.
    return ssid_.length() > 0 && serverUrl_.length() > 0 && token_.length() > 0;
}
