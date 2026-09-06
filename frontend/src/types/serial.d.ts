/**
 * The Web Serial API, by hand.
 *
 * `lib.dom` does not declare it and the only package that does is a `@types`
 * dependency for four interfaces nothing else in the app touches (§1.8 of the
 * UI guidelines, and the dependency rule in code-style.md). What is here is
 * exactly what the setup wizard uses, plus the two string unions and
 * `setSignals` that esptool-js reaches for: its own typings say
 * `/// <reference types="w3c-web-serial" />`, so the names below are what its
 * `Transport` resolves against.
 *
 * A global script file, so it carries no import and no export.
 */

/** The parity of a serial frame. */
type ParityType = "none" | "even" | "odd";

/** Whether the two flow-control lines are used. */
type FlowControlType = "none" | "hardware";

interface SerialOptions {
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: ParityType;
  /** The size of the read and write buffers, in bytes. */
  bufferSize?: number;
  flowControl?: FlowControlType;
}

/** What the browser knows about the USB bridge behind the port. */
interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

/** The two output lines. Opening a port asserts both on Windows, which is
 *  what reboots an ESP32 DevKitC when the console is opened. */
interface SerialOutputSignals {
  dataTerminalReady?: boolean;
  requestToSend?: boolean;
  break?: boolean;
}

interface SerialInputSignals {
  dataCarrierDetect: boolean;
  clearToSend: boolean;
  ringIndicator: boolean;
  dataSetReady: boolean;
}

interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
  setSignals(signals?: SerialOutputSignals): Promise<void>;
  getSignals(): Promise<SerialInputSignals>;
  forget(): Promise<void>;
}

interface SerialPortFilter {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPortRequestOptions {
  filters?: SerialPortFilter[];
}

interface Serial extends EventTarget {
  /** Opens the browser's own port picker. Needs a user gesture. */
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  /** The ports this origin has already been given. */
  getPorts(): Promise<SerialPort[]>;
}

interface Navigator {
  readonly serial: Serial;
}
