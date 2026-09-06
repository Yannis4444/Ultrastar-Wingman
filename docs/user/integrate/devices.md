# Player selector devices

A player selector tells Wingman what lies on its readers and how often each
button was pressed. Wingman turns that into the singers of the next song. The
device decides nothing: it holds no players, no slot colors, and no song. Build
your own, or bridge one you already have, by sending the same report.

## The token

Create the device on **User** > **Player selector**. Wingman answers with a
bearer token, `wd_` and 40 hex characters, and that answer is the only time the
token is readable. Send it as a header on every report:

```text
Authorization: Bearer wd_0123456789abcdef0123456789abcdef01234567
```

The token stands for the device, not for an account. It carries no capability
and reaches no other endpoint. A device that loses its token gets another one.

## The report

`POST` the whole state to `http://localhost:8080/api/v1/devices/report`, on the
address and the port that serve the app:

```json
{
  "protocol": 1, "firmware": "0.1.0", "uptime_s": 1234, "rssi": -61,
  "readers": [
    {"index": 0, "state": "wired", "version": "92", "uid": "A1B2C3D4"},
    {"index": 1, "state": "wired", "version": "92", "uid": null},
    {"index": 2, "state": "none", "version": "00", "uid": null},
    {"index": 3, "state": "fault", "version": "3a", "uid": null},
    {"index": 4, "state": "none", "version": "00", "uid": null},
    {"index": 5, "state": "none", "version": "00", "uid": null}
  ],
  "buttons": [{"index": 0, "presses": 3}, {"index": 1, "presses": 0}, {"index": 2, "presses": 0}, {"index": 3, "presses": 0}]
}
```

| Field | Holds |
|---|---|
| `protocol` | The version of this report format. `1` today |
| `firmware` | The device's own version string, shown on its page |
| `uptime_s` | Seconds since the device started |
| `rssi` | Wi-Fi signal in dBm, a negative number |
| `readers` | One entry per reader position, wired or not. The Wingman device sends six |
| `buttons` | One entry per button, wired or not. The Wingman device sends four |

A reader entry carries four fields. `state` is `wired`, `none` for a position
nothing answered on, or `fault` for one that answered with something unreadable.
`version` is the chip's version byte as two lowercase hex characters, and `"00"`
whenever the state is `none`. `uid` is the number of the card lying on that
reader, as 8 to 20 uppercase hex characters without separators, or `null` for an
empty reader. Wingman refuses a slot color on a reader that is not `wired`. The
indexes start at zero, so reader 1 on
[Build the device](../selector/build.md) is `index` 0 here.

A button entry carries its index and `presses`, a counter that grows over the
life of the device. Wingman compares it with the last report and acts only when
the number grew. A number smaller than the last one is a device that rebooted.
Wingman takes that number as the new count and acts on the next press.

Let the counter run for as long as the device does. A bridge that sends `1` for
every press and `0` in between never presses anything: only the step up counts,
and the step back down is read as a reboot.

## When to send one

Send a report as soon as anything in it changes: a card arrived, a card left, a
card changed, or a counter grew. Send one every 5 seconds even when nothing
changed. That heartbeat is what keeps the device online, and Wingman calls a
device offline once its last report is more than 15 seconds old.

## The answers

| Status | Body | Means |
|---|---|---|
| `200` | The answer below | Taken |
| `401` | `{"detail": "unknown_device"}` | The token is wrong, or the device was deleted |
| `426` | `{"detail": "protocol_unsupported", "supported": 1}` | Wingman speaks another version of this format |

A device that gets `426` still stands in the list, marked as needing an update.
Wingman keeps the last report of each device and compares the next one against
it. A report is a snapshot, so nothing is queued and nothing is lost. A request
that never arrives heals on the following one, which carries the whole state
again. Send what is true now and forget what failed.

### What a `200` says back

```json
{
  "ok": true, "protocol": 1, "interval_s": 1,
  "leds": [
    {"index": 0, "rgb": "048bb9", "mode": "on"},
    {"index": 1, "rgb": "d00000", "mode": "dim"},
    {"index": 2, "rgb": "ffffff", "mode": "pulse"}
  ],
  "update": {"file": "wingman-esp32-ota.bin", "version": "0.3.0"}
}
```

| Field | Holds |
|---|---|
| `interval_s` | The heartbeat Wingman wants, in seconds. `1` while somebody is picking singers, `5` the rest of the time |
| `leds` | What each light shows until the next answer, one entry per reader position in the report |
| `update` | The firmware to fetch and flash. Absent, or `null`, whenever there is nothing to fetch |

Ignore any field you have no hardware for. A device with no lights and no
updater reads `interval_s` and nothing else.

**The lights.** Wingman assumes one light per reader position, so `index` 0 is
the light beside reader 1. `rgb` is six lowercase hex digits without a `#`.
`mode` is one of `off`, `dim`, `on`, `blink`, and `pulse`. A slot reader shows
its microphone color: `dim` with nothing on it, `on` under a card Wingman knows,
`blink` under a card nobody has claimed, and `pulse` for every slot while the
song is about to start by itself. A reader everybody scans in turn shows white,
pulsing while singers are being picked. Everything else is `off`, and so is the
whole strip while a song plays. Turn off any position the list leaves out. It
has nothing to show, and a light still on for a selection that ended says
something untrue about the room.

**The update.** Ask for one on the device's page in Wingman, under **Update over
Wi-Fi**. The offer then rides on the answer to the next few reports. `file` is a
file name to fetch from `GET /api/v1/devices/firmware/<file>` with the same
bearer token, and `version` is what the device runs once it has flashed it.
Report the new version to say the update landed: that is what takes the offer
away. An offer nobody fetches expires after 10 minutes, so the host can ask
again. Wait at least 10 minutes before retrying a flash that failed.

!!! example "One report from a bridge"
    Two readers, a card on the first one, no button pressed.

    ```bash
    curl -X POST http://localhost:8080/api/v1/devices/report \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer wd_0123456789abcdef0123456789abcdef01234567" \
      -d '{"protocol": 1, "firmware": "1.0.0", "uptime_s": 12, "rssi": -55, "readers": [{"index": 0, "state": "wired", "version": "92", "uid": "A1B2C3D4"}, {"index": 1, "state": "wired", "version": "92", "uid": null}, {"index": 2, "state": "none", "version": "00", "uid": null}, {"index": 3, "state": "none", "version": "00", "uid": null}, {"index": 4, "state": "none", "version": "00", "uid": null}, {"index": 5, "state": "none", "version": "00", "uid": null}], "buttons": [{"index": 0, "presses": 0}, {"index": 1, "presses": 0}, {"index": 2, "presses": 0}, {"index": 3, "presses": 0}]}'
    ```

## The cards

The card table is the host's, on **User** > **Player selector**. Four routes are
open to anybody signed in, because the card in somebody's hand is their own.
They take a session cookie and not a device token, and the answers are the card
rows Wingman keeps.

| Route | Does |
|---|---|
| `GET /api/v1/devices/cards/unknown` | The cards lying on the readers of an online device that belong to nobody: `{"uids": ["A1B2C3D4"]}` |
| `POST /api/v1/devices/cards/{uid}/claim` | Says the card is yours. Your own again is the same answer, somebody else's is `409 {"detail": "card_taken"}` |
| `GET /api/v1/devices/cards/mine` | Your own cards: `{"cards": [{"uid": "…", "player": {…}, "created_at": "…"}]}` |
| `DELETE /api/v1/devices/cards/{uid}` | Gives a card back. Your own, or anybody's with the `devices.manage` capability |

A uid is 8 to 20 hex characters and Wingman stores it in uppercase. Send it
either way. An account that sings as no player answers `404 no_player` on a
claim, and a caller signed in as nobody answers `401` on the first three. On the
delete, a caller without `devices.manage` gets `403` for a card that is not
their own and for one that does not exist, so the answer never says which.

Claiming a card that is lying on a slot reader puts you on that slot at once.
The card has not moved, so nothing else could say so.

## The serial console

The Wingman firmware is configured over USB, and the setup pages talk to it over
Web Serial. A device of your own may be configured any way you like. This is
what the bundled firmware speaks, for whoever writes their own flasher: one JSON
object per line at 115200 baud, in both directions, and nothing else on that
port. The device sends `hello` unasked at boot. Opening the port can reset the
board, so ask for `hello` once a second for up to 10 seconds before giving up.

| Line in | Line out |
|---|---|
| `{"cmd":"hello"}` | `{"type":"hello","firmware":"0.1.0","protocol":1,"chip":"ESP32","mac":"…","configured":false,"build":"…"}` |
| `{"cmd":"scan"}` | `{"type":"networks","networks":[{"ssid":"…","rssi":-50,"secure":true}]}` |
| `{"cmd":"configure","ssid":"…","password":"…","server_url":"http://192.168.0.5:8080","token":"wd_…"}` | `{"type":"ok"}`, then the device connects |
| `{"cmd":"status"}` | The status line below for what the device is doing now |
| (unasked) | `{"type":"status","state":"<state>"}`, where `<state>` is `wifi_connecting`, `wifi_connected` with an `ip` field, `wifi_failed` with a `reason`, or `server_ok` and `server_failed` with the `http` status of the last report |
| (anything it refuses) | `{"type":"error","error":"bad_json"}`, and the same shape for `bad_command`, `unknown_command`, `missing_field`, `empty_field`, `store_failed`, and `line_too_long` |

`configure` stores all four fields and answers `ok` before it connects. The
password may be empty, for an open network. The other three may not.

The firmware counts any HTTP answer as delivered, a `401` and a `426` included.
It waits for the next change or the next heartbeat rather than asking again. A
request that gets no answer at all is retried with a backoff that starts at 1
second and doubles to 30.
