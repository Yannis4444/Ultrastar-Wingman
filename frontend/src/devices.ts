/**
 * The player selector's vocabulary, said once: what a reader's role and a
 * button's action are called, what a device's state reads as in a line of
 * words, and which of two firmware versions is the newer one.
 *
 * The admin page and the device page both need all of it, and a sentence a
 * test can check is easier to check here than through a rendered row.
 */

import type { DeviceRead, FirmwareManifest, ReaderRead } from "./api";
import { shortDate, shortTime } from "./duration";
import { errorDetail, errorMessage } from "./errors";

/** A reader mapped to one singing slot is `slot:<color>` — the shape
 *  `devices/service.py` stores and checks. The other two roles are words. */
const SLOT_PREFIX = "slot:";

/** One reader everybody scans on in turn: a scan fills the next free slot. */
export const SEQUENTIAL = "sequential";

/** No role at all. The absence of one, so it is allowed on a reader that has
 *  come loose since it was mapped: taking a role away has to work. */
export const UNUSED = "unused";

/** The color a role puts a card on, or `null` for the two word roles. */
export function slotColor(role: string): string | null {
  return role.startsWith(SLOT_PREFIX) ? role.slice(SLOT_PREFIX.length) : null;
}

/** The role that puts a card on `color`. */
export function slotRole(color: string): string {
  return `${SLOT_PREFIX}${color}`;
}

/** A slot color as a word. The names come from Ultrastar Deluxe, where the
 *  tenth is `dark_blue`; the settings page reads them the same way. */
export function colorLabel(name: string): string {
  return name.replace("_", " ");
}

/** What a button does when it is pressed, in the order the select offers it:
 *  the three actions the selection understands, then nothing. */
export const BUTTON_ACTIONS: { value: string; label: string }[] = [
  { value: "start", label: "Start the song" },
  { value: "clear", label: "Clear the slots" },
  { value: "cancel", label: "Cancel the selection" },
  { value: "none", label: "Nothing" },
];

/** A version as numbers. A part that is not one counts as zero, so a firmware
 *  built from a working tree ("0.2.0-dirty") still compares by its numbers. */
function versionParts(version: string): number[] {
  return version
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isNaN(part) ? 0 : part));
}

/** Whether `candidate` is a later version than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  const left = versionParts(candidate);
  const right = versionParts(current);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

/**
 * Whether the device should be flashed again. Two reasons, and they are not the
 * same one: it speaks a report protocol this Wingman does not (`compatible` is
 * false, and nothing it says is being read), or the bundled image is simply
 * newer than what it runs. A checkout with no build has no manifest, and then
 * only the first reason can fire.
 */
export function needsUpdate(
  device: DeviceRead,
  manifest?: FirmwareManifest | null,
): boolean {
  if (device.compatible === false) return true;
  const bundled = manifest?.version;
  const running = device.firmware_version;
  return (
    bundled !== undefined &&
    bundled !== null &&
    running !== undefined &&
    running !== null &&
    isNewer(bundled, running)
  );
}

/** When the device last said anything, as a phrase. */
export function lastSeen(device: DeviceRead): string {
  const at = device.last_seen_at;
  return at === undefined || at === null
    ? "never connected"
    : `last seen ${shortDate(at)} ${shortTime(at)}`;
}

/**
 * The line under a device's name in the list: only what is unusual about it,
 * the way a tag's row is built. Online is one word; offline says when it was
 * last heard from, because that is what tells a device that is switched off
 * from one that never reached the network.
 */
export function deviceMeta(
  device: DeviceRead,
  manifest?: FirmwareManifest | null,
): string {
  const parts: string[] = [];
  if (device.online) parts.push("online");
  else if (device.last_seen_at === undefined || device.last_seen_at === null)
    parts.push("never connected");
  else parts.push("offline", lastSeen(device));
  if (device.firmware_version !== undefined && device.firmware_version !== null)
    parts.push(`firmware ${device.firmware_version}`);
  if (needsUpdate(device, manifest)) parts.push("needs update");
  return parts.join(" · ");
}

/** The first line of the device page: where the device is right now. */
export function statusLine(device: DeviceRead): string {
  if (device.online) return "Online";
  if (device.last_seen_at === undefined || device.last_seen_at === null)
    return "Never connected";
  return `Offline, ${lastSeen(device)}`;
}

/** What it runs, or nothing at all before its first report. */
export function firmwareLine(device: DeviceRead): string | null {
  const parts: string[] = [];
  if (device.firmware_version !== undefined && device.firmware_version !== null)
    parts.push(`Firmware ${device.firmware_version}`);
  if (device.protocol !== undefined && device.protocol !== null)
    parts.push(`protocol ${device.protocol}`);
  return parts.length === 0 ? null : parts.join(" · ");
}

/** Why it should be flashed again, in words, or nothing when it should not. */
export function updateLine(
  device: DeviceRead,
  manifest?: FirmwareManifest | null,
): string | null {
  if (device.compatible === false) return "This device needs a newer firmware.";
  const bundled = manifest?.version;
  return bundled !== undefined && needsUpdate(device, manifest)
    ? `Update available: ${bundled}`
    : null;
}

/**
 * How well the device hears the network. Three words rather than a number in
 * dBm: the host is deciding where to put the box, not tuning an antenna.
 * Nothing at all without a reading, which is every device that is offline.
 */
export function signalLabel(rssi: number | null | undefined): string | null {
  if (rssi === undefined || rssi === null) return null;
  if (rssi >= -60) return "good";
  if (rssi >= -75) return "fair";
  return "weak";
}

/** The one refusal whose `detail` is an object rather than a slug: another
 *  device already reads that color, and which color and which device is what
 *  the sentence needs. `errorDetail` is string-only by contract (`errors.ts`),
 *  so the shape is read here, where it is known. */
function takenElsewhere(
  cause: unknown,
): { color: string; device: string } | null {
  const detail = (cause as { detail?: unknown } | null | undefined)?.detail;
  if (typeof detail !== "object" || detail === null) return null;
  const { error, color, device } = detail as {
    error?: unknown;
    color?: unknown;
    device?: unknown;
  };
  return error === "slot_taken_elsewhere" &&
    typeof color === "string" &&
    typeof device === "string"
    ? { color, device }
    : null;
}

/**
 * What a refused mapping says. The backend answers a slug, which is right for a
 * machine and useless on a form, and `reader_not_wired` does not say *which*
 * reader: the answer to that is in the mapping the page just sent, so it is
 * worked out here from the readers that carry a role and did not answer the
 * boot probe.
 */
export function mappingRefusal(
  cause: unknown,
  readers: ReaderRead[],
  roleOf: (reader: ReaderRead) => string,
): string {
  const detail = errorDetail(cause);
  if (detail === "reader_not_wired") {
    const wrong = readers
      .filter((reader) => reader.state !== "wired" && roleOf(reader) !== UNUSED)
      .map((reader) => reader.index + 1);
    // The remedy belongs on both branches: a reader that came loose carries
    // its role into every PATCH the page sends, so until it is set to Not used
    // nothing on this page saves at all.
    if (wrong.length === 1)
      return `Reader ${wrong[0]} is not wired. Set it to Not used.`;
    if (wrong.length > 1)
      return `Readers ${wrong.join(", ")} are not wired. Set them to Not used.`;
    return "One of the readers is not wired. Set it to Not used.";
  }
  if (detail === "duplicate_slot") return "Two readers have the same color.";
  // Which of the two changes is the way out is the host's to decide: this box
  // may be the one that should keep the color.
  const elsewhere = takenElsewhere(cause);
  if (elsewhere !== null)
    return `The ${colorLabel(elsewhere.color)} slot is already read by ${elsewhere.device}. Give one of them another color.`;
  if (detail === "unknown_color")
    return "One of the readers is on a color Ultrastar Deluxe has no microphone for.";
  return errorMessage(cause, "Could not save the device.");
}
