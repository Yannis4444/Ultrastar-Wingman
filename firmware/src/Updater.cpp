#include "Updater.h"

#include <HTTPUpdate.h>
#include <WiFi.h>

#include <string.h>

namespace {

// A failed attempt is not retried before this: the server keeps asking for ten minutes, and
// a device that cannot flash should not spend the party downloading.
constexpr uint32_t kRetryDelayMs = 10UL * 60UL * 1000UL;

} // namespace

void Updater::setServer(const String &serverUrl, const String &token) {
    String base = serverUrl;
    while (base.endsWith("/")) {
        base.remove(base.length() - 1);
    }
    snprintf(baseUrl_, sizeof(baseUrl_), "%s/api/v1/devices/firmware", base.c_str());
    snprintf(authHeader_, sizeof(authHeader_), "Bearer %s", token.c_str());
}

void Updater::loop(uint32_t nowMs, const ResponseState &response, const char *currentVersion) {
    if (!response.hasUpdate || baseUrl_[0] == '\0' || WiFi.status() != WL_CONNECTED) {
        return;
    }
    if (currentVersion != nullptr && strcmp(response.updateVersion, currentVersion) == 0) {
        // The server is still asking; its next report will carry the new version and stop.
        return;
    }
    // `now >= nextAttempt`, written so the 49-day wrap of millis() cannot hold it back.
    if (waiting_ && nowMs - nextAttemptMs_ >= 0x80000000U) {
        return;
    }

    char url[256];
    snprintf(url, sizeof(url), "%s/%s", baseUrl_, response.updateFile);
    console_.sendUpdating(response.updateVersion);

    // Both of these allocate; they live for the length of the attempt, which either ends in
    // a reboot or in a ten-minute wait, so neither is in the steady state.
    WiFiClient client;
    httpUpdate.rebootOnUpdate(true);
    httpUpdate.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
    // The image is behind the device's own token. HTTPUpdate calls this back after its own
    // headers and before the GET; setAuthorization() is never used, so HTTPClient lets an
    // Authorization header of ours through.
    const t_httpUpdate_return result = httpUpdate.update(client, url, "", [this](HTTPClient *http) {
        http->addHeader("Authorization", authHeader_);
    });

    // Only a failure gets here: a good image reboots inside update().
    if (result == HTTP_UPDATE_NO_UPDATES) {
        console_.sendUpdateFailed("no_updates");
    } else {
        console_.sendUpdateFailed(httpUpdate.getLastErrorString().c_str());
    }
    nextAttemptMs_ = nowMs + kRetryDelayMs;
    waiting_ = true;
}
