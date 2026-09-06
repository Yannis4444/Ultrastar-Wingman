/**
 * The browser half of the device's serial console: JSON lines at 115200 over
 * the same USB cable the firmware was flashed with (player-selector.md §5).
 *
 * Everything here is pure. The port, the reader loop and the clock live in the
 * wizard; what is left is framing bytes into lines, reading a line, writing a
 * command, saying a status in words, and the handshake that waits for the
 * device to say hello. That is the part hardware cannot be borrowed to test.
 */

/** The console runs at this rate in both directions. */
export const CONSOLE_BAUD_RATE = 115200;

/** One `hello` a second, for ten seconds. Opening the port asserts DTR and RTS
 *  on Windows, so the board may be rebooting when the first one goes out. */
export const HELLO_INTERVAL_MS = 1000;
export const HELLO_TIMEOUT_MS = 10000;

/* ------------------------------------------------------------- the messages */

/** What the device says about itself, at boot and whenever it is asked.
 *  `build` is beyond §5's table: `git describe` of the tree the image came
 *  from, which `SerialConsole.cpp` sends and the wizard shows. */
export interface HelloMessage {
  type: "hello";
  firmware: string;
  protocol: number;
  chip: string;
  mac: string;
  configured: boolean;
  build?: string;
}

/** One network the device can see. */
export interface Network {
  ssid: string;
  rssi: number;
  secure: boolean;
}

export interface NetworksMessage {
  type: "networks";
  networks: Network[];
}

/** The configuration was stored. The device connects right after. */
export interface OkMessage {
  type: "ok";
}

/** Where the device has got to. The extras are per state: `ip` on
 *  `wifi_connected`, `reason` on `wifi_failed`, `http` on the two server ones. */
export interface StatusMessage {
  type: "status";
  state: string;
  ip?: string;
  reason?: string;
  http?: number;
}

/** A line the device refused, by slug. */
export interface ErrorMessage {
  type: "error";
  error: string;
}

export type DeviceMessage =
  HelloMessage | NetworksMessage | OkMessage | StatusMessage | ErrorMessage;

/* -------------------------------------------------------------- the framing */

/**
 * Bytes to lines, keeping whatever the last chunk ended in the middle of.
 *
 * A serial read hands over whatever has arrived, which cuts lines anywhere —
 * and, on a boot-loader burst, several lines at once. The decoder is held
 * across chunks too, a multi-byte character being just as splittable as a line.
 */
export class LineFramer {
  private partial = "";
  private readonly decoder = new TextDecoder();

  /** The lines this chunk completed, empty ones dropped. */
  push(chunk: Uint8Array): string[] {
    this.partial += this.decoder.decode(chunk, { stream: true });
    const parts = this.partial.split("\n");
    // The tail is whatever came after the last newline, which may be nothing.
    this.partial = parts.pop() ?? "";
    return parts
      .map((line) => line.replace(/\r$/, "").trim())
      .filter((line) => line !== "");
  }
}

/**
 * One line as a message, or `null`.
 *
 * A device that has just been reset prints boot-loader noise on the same pins,
 * and a firmware this frontend does not know may say something it has no
 * screen for. Both are the same answer: nothing to show.
 */
export function parseLine(line: string): DeviceMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const message = parsed as { type?: unknown };
  if (typeof message.type !== "string") return null;
  switch (message.type) {
    case "hello":
    case "networks":
    case "ok":
    case "status":
    case "error":
      return parsed as DeviceMessage;
    default:
      return null;
  }
}

/**
 * One command as the line to write.
 *
 * `JSON.stringify` and not a template: a Wi-Fi password may hold a quote, a
 * backslash or a newline, and the device parses the line rather than scanning
 * it. The trailing newline is what ends a command over there.
 */
export function buildCommand(
  cmd: string,
  fields: Record<string, string> = {},
): string {
  return `${JSON.stringify({ cmd, ...fields })}\n`;
}

/* ------------------------------------------------------------- the sentences */

/** What a status line says, in words the host can act on. An unknown state is
 *  named rather than swallowed: a newer firmware still gets a line. */
export function statusSentence(message: StatusMessage): string {
  switch (message.state) {
    case "wifi_connecting":
      return "Connecting to Wi-Fi…";
    case "wifi_connected":
      return message.ip === undefined
        ? "Connected to Wi-Fi."
        : `Connected, address ${message.ip}.`;
    case "wifi_failed":
      return message.reason === undefined
        ? "Could not join the network."
        : `Could not join the network (${message.reason}).`;
    case "server_ok":
      return "Reached Wingman.";
    case "server_failed":
      // The firmware sends the HTTP client's own code, which is zero or
      // negative when the request never got an answer at all: only a real
      // status code is worth printing back.
      return message.http === undefined || message.http <= 0
        ? "Wingman did not answer."
        : `Wingman answered ${message.http}.`;
    default:
      return `The device says ${message.state}.`;
  }
}

/** What a refused line says. The slugs are `SerialConsole.cpp`'s own. */
export function errorSentence(message: ErrorMessage): string {
  if (message.error === "store_failed")
    return "The device could not save the settings.";
  return `The device did not understand that (${message.error}).`;
}

/* ------------------------------------------------------------- the handshake */

/**
 * Waiting for the device to say hello.
 *
 * The clock is passed in rather than read, so the ten seconds are tested
 * without a timer: `tick(now)` answers whether a `hello` should go out at this
 * moment, `receive(line)` takes every line that arrives, and `timedOut(now)`
 * is the giving up. The device also prints its hello at boot, so an answer can
 * land before the first command is even sent.
 */
export class HelloHandshake {
  /** What the device answered, once it has. */
  hello: HelloMessage | null = null;

  private startedAt: number | null = null;
  private lastSentAt: number | null = null;

  /** Whether a `hello` should be written now. The first call starts the clock,
   *  so the wizard's own start is whenever it first ticks. */
  tick(now: number): boolean {
    if (this.startedAt === null) this.startedAt = now;
    if (this.hello !== null || this.timedOut(now)) return false;
    if (this.lastSentAt !== null && now - this.lastSentAt < HELLO_INTERVAL_MS)
      return false;
    this.lastSentAt = now;
    return true;
  }

  /** One line off the port. `true` once the handshake is done, so the caller
   *  can stop ticking; every other line is simply not the answer. */
  receive(line: string): boolean {
    const message = parseLine(line);
    if (message !== null && message.type === "hello") this.hello = message;
    return this.hello !== null;
  }

  /** Ten seconds without an answer. Never true before the first tick, and
   *  never true again once the device has spoken. */
  timedOut(now: number): boolean {
    return (
      this.hello === null &&
      this.startedAt !== null &&
      now - this.startedAt >= HELLO_TIMEOUT_MS
    );
  }
}
