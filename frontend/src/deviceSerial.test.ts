import {
  buildCommand,
  errorSentence,
  HELLO_TIMEOUT_MS,
  HelloHandshake,
  LineFramer,
  parseLine,
  statusSentence,
} from "./deviceSerial";

const HELLO =
  '{"type":"hello","firmware":"0.1.0","protocol":1,"chip":"ESP32","mac":"AA:BB:CC:DD:EE:FF","configured":false,"build":"0.1.0-2-gabc"}';

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

test("a chunk that ends mid-line keeps the tail for the next one", () => {
  const framer = new LineFramer();

  expect(framer.push(bytes('{"type":"o'))).toEqual([]);
  expect(framer.push(bytes('k"}\n{"type":"e'))).toEqual(['{"type":"ok"}']);
  expect(framer.push(bytes('rror","error":"bad_json"}\n'))).toEqual([
    '{"type":"error","error":"bad_json"}',
  ]);
});

test("one chunk can carry several lines, and empty ones are dropped", () => {
  const framer = new LineFramer();

  expect(framer.push(bytes("one\r\n\ntwo\n"))).toEqual(["one", "two"]);
});

test("a character split across two chunks survives", () => {
  const framer = new LineFramer();
  const split = bytes('{"ssid":"Café"}\n');

  // 13 is the middle of the two bytes "é" is written as.
  expect(framer.push(split.slice(0, 13))).toEqual([]);
  expect(framer.push(split.slice(13))).toEqual(['{"ssid":"Café"}']);
});

test("boot-loader noise is not a message", () => {
  expect(parseLine("rst:0x1 (POWERON_RESET),boot:0x13")).toBeNull();
  expect(parseLine("")).toBeNull();
  expect(parseLine("[]")).toBeNull();
  expect(parseLine("null")).toBeNull();
  expect(parseLine('{"firmware":"0.1.0"}')).toBeNull();
  expect(parseLine('{"type":42}')).toBeNull();
  // A type this frontend has no screen for is the same answer as noise.
  expect(parseLine('{"type":"telemetry"}')).toBeNull();
});

test("a hello line comes back whole, build field and all", () => {
  const message = parseLine(HELLO);

  expect(message).toEqual({
    type: "hello",
    firmware: "0.1.0",
    protocol: 1,
    chip: "ESP32",
    mac: "AA:BB:CC:DD:EE:FF",
    configured: false,
    build: "0.1.0-2-gabc",
  });
});

test("a password with quotes and backslashes goes out as one legal line", () => {
  const line = buildCommand("configure", {
    ssid: 'The "Back" Room',
    password: 'a"b\\c\nd',
    server_url: "http://192.168.0.5:8080",
    token: "wd_abc",
  });

  expect(line.endsWith("\n")).toBe(true);
  expect(line.indexOf("\n")).toBe(line.length - 1);
  expect(JSON.parse(line)).toEqual({
    cmd: "configure",
    ssid: 'The "Back" Room',
    password: 'a"b\\c\nd',
    server_url: "http://192.168.0.5:8080",
    token: "wd_abc",
  });
});

test("a command with no fields is the command alone", () => {
  expect(buildCommand("hello")).toBe('{"cmd":"hello"}\n');
});

test("every status the firmware sends reads as a sentence", () => {
  expect(statusSentence({ type: "status", state: "wifi_connecting" })).toBe(
    "Connecting to Wi-Fi…",
  );
  expect(
    statusSentence({
      type: "status",
      state: "wifi_connected",
      ip: "192.168.0.23",
    }),
  ).toBe("Connected, address 192.168.0.23.");
  expect(statusSentence({ type: "status", state: "wifi_connected" })).toBe(
    "Connected to Wi-Fi.",
  );
  expect(
    statusSentence({
      type: "status",
      state: "wifi_failed",
      reason: "auth_fail",
    }),
  ).toBe("Could not join the network (auth_fail).");
  expect(
    statusSentence({ type: "status", state: "server_ok", http: 200 }),
  ).toBe("Reached Wingman.");
  expect(
    statusSentence({ type: "status", state: "server_failed", http: 401 }),
  ).toBe("Wingman answered 401.");
  expect(
    statusSentence({ type: "status", state: "server_failed", http: 0 }),
  ).toBe("Wingman did not answer.");
  // `HTTPClient` answers a request that never landed with its own negative
  // code, which is not a status a server ever sent.
  expect(
    statusSentence({ type: "status", state: "server_failed", http: -1 }),
  ).toBe("Wingman did not answer.");
  // A firmware newer than this page still gets a line rather than silence.
  expect(statusSentence({ type: "status", state: "reticulating" })).toBe(
    "The device says reticulating.",
  );
});

test("a refused line says so", () => {
  expect(errorSentence({ type: "error", error: "store_failed" })).toBe(
    "The device could not save the settings.",
  );
  expect(errorSentence({ type: "error", error: "bad_json" })).toBe(
    "The device did not understand that (bad_json).",
  );
});

test("the handshake asks once a second and stops when the device answers", () => {
  const handshake = new HelloHandshake();

  expect(handshake.tick(0)).toBe(true);
  expect(handshake.tick(400)).toBe(false);
  expect(handshake.tick(999)).toBe(false);
  expect(handshake.tick(1000)).toBe(true);

  expect(handshake.receive("rst:0x1 (POWERON_RESET)")).toBe(false);
  expect(handshake.receive(HELLO)).toBe(true);
  expect(handshake.hello?.firmware).toBe("0.1.0");

  expect(handshake.tick(2000)).toBe(false);
  expect(handshake.timedOut(HELLO_TIMEOUT_MS + 1000)).toBe(false);
});

test("the handshake gives up after ten seconds of silence", () => {
  const handshake = new HelloHandshake();

  // Nothing has been asked yet, so nothing has run out.
  expect(handshake.timedOut(1_000_000)).toBe(false);

  handshake.tick(0);
  expect(handshake.timedOut(HELLO_TIMEOUT_MS - 1)).toBe(false);
  expect(handshake.timedOut(HELLO_TIMEOUT_MS)).toBe(true);
  expect(handshake.tick(HELLO_TIMEOUT_MS)).toBe(false);
});
