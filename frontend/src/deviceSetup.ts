/**
 * What the setup wizard works out on its own: the order cards land on the
 * readers, the order buttons are first pressed, the mapping those two orders
 * propose, and the two addresses the host would otherwise have to know.
 *
 * Pure, because it is the part of the wizard that can be checked without a
 * board on the desk. The steps themselves are in `pages/DeviceSetup.tsx`.
 */

import type { ButtonRead, ReaderRead } from "./api";
import { SEQUENTIAL, slotRole, UNUSED } from "./devices";

/** A mapping keyed by the position as a string, the shape a PATCH carries. */
export type Mapping = Record<string, string>;

/** What a button does when nothing has been pressed on it. */
const NO_ACTION = "none";

/** The actions the discovery step hands out, in the order buttons are pressed:
 *  the one everybody reaches for first starts the song. */
const PROPOSED_ACTIONS = ["start", "clear", "cancel"];

/** Six readers is the pin map's maximum, so the list ends where it ends. */
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth"];

/** Which card is lying on a reader, or nothing. A reader that is not wired
 *  never carries one, and a device that is offline reports none at all. */
function cardOf(reader: ReaderRead): string | null {
  return reader.uid === undefined || reader.uid === null ? null : reader.uid;
}

/**
 * The discovery order after one report: every reader whose card has just
 * landed, appended in reader order.
 *
 * A reader keeps its place once it has one. Taking the card off again and
 * putting it back would otherwise move it to the end, and the host is putting
 * cards down in the order of their slots, not holding them there.
 *
 * The first call of a discovery pass is `previous = []`, which counts whatever
 * is already lying on the box: those cards were put down too.
 */
export function discoveredOrder(
  order: number[],
  previous: ReaderRead[],
  current: ReaderRead[],
): number[] {
  const before = new Map(
    previous.map((reader) => [reader.index, cardOf(reader)]),
  );
  const appeared = current
    .filter((reader) => cardOf(reader) !== null)
    .filter((reader) => (before.get(reader.index) ?? null) === null)
    .map((reader) => reader.index)
    .filter((index) => !order.includes(index));
  return [...order, ...appeared];
}

/**
 * The press order after one report: every button whose counter has moved past
 * what it stood at when the step opened.
 *
 * The counter and not an event, because that is all the device sends (§4): it
 * says how often each button was pressed since it booted, and the step asks
 * for one press each.
 */
export function pressedOrder(
  order: number[],
  baseline: Record<string, number>,
  buttons: ButtonRead[],
): number[] {
  const pressed = buttons
    .filter((button) => button.presses > (baseline[String(button.index)] ?? 0))
    .map((button) => button.index)
    .filter((index) => !order.includes(index));
  return [...order, ...pressed];
}

/** The counters as they stand, to measure the next presses against. */
export function pressBaseline(buttons: ButtonRead[]): Record<string, number> {
  return Object.fromEntries(
    buttons.map((button) => [String(button.index), button.presses]),
  );
}

/**
 * The roles the discovered order proposes.
 *
 * One reader is the layout where everybody scans in turn: there is no slot to
 * give it, and a single reader wired to blue would leave every other singer
 * with nowhere to put a card. Several readers take the slots in the host's own
 * order, one each, and anything past the last slot is left alone.
 *
 * Only the readers that were found are named. What the rest carry is the
 * device's business, and the wizard's Map step draws them as they stand.
 */
export function proposeRoles(order: number[], slotColors: string[]): Mapping {
  if (order.length === 1) return { [String(order[0])]: SEQUENTIAL };
  return Object.fromEntries(
    order.map((index, position) => [
      String(index),
      position < slotColors.length
        ? slotRole(slotColors[position])
        : // More readers than slots: the extra ones do nothing until the host
          // gives them something, which is better than two on one color.
          UNUSED,
    ]),
  );
}

/** The actions the press order proposes: start, clear, cancel, then nothing. */
export function proposeActions(seenButtons: number[]): Mapping {
  return Object.fromEntries(
    seenButtons.map((index, position) => [
      String(index),
      PROPOSED_ACTIONS[position] ?? NO_ACTION,
    ]),
  );
}

/** Where a reader came in the discovery, as a word: "found second". */
export function foundLabel(position: number): string {
  const ordinal = ORDINALS[position];
  return ordinal === undefined ? `found ${position + 1}` : `found ${ordinal}`;
}

/**
 * The address to open this page at on the karaoke PC.
 *
 * Web Serial needs a secure context, and `http://192.168.0.5:8080` is not one
 * while `http://localhost:8080` is. The port is the one this page is served
 * from, so a Wingman on another port still names itself correctly; a page on
 * the default port carries none.
 */
export function localhostSetupUrl(port: string): string {
  const authority = port === "" ? "localhost" : `localhost:${port}`;
  return `http://${authority}/user/devices/new`;
}

/** The names this browser has for the computer it runs on. A device across the
 *  room reaches none of them. */
const OWN_NAMES = ["localhost", "127.0.0.1", "[::1]"];

/**
 * The address to write to the device, out of the join URL the phones use.
 *
 * Never localhost: that is this browser's word for the karaoke PC, and a
 * device across the room reaches nothing at it. Wingman answering with one
 * means it has not worked out its own address on the network, and then the
 * host types it. So does an answer that is not a URL at all.
 */
export function serverAddress(joinUrl: string | null | undefined): string {
  if (joinUrl === undefined || joinUrl === null) return "";
  let parsed: URL;
  try {
    parsed = new URL(joinUrl);
  } catch {
    return "";
  }
  if (OWN_NAMES.includes(parsed.hostname.toLowerCase())) return "";
  return parsed.origin;
}

/** What is wrong with the address the host typed, or `null`. An empty field is
 *  not wrong yet, only unfinished: the step disables Send for that on its own.
 *
 *  Checked here rather than after the fact, because sending it is what mints a
 *  token and writes it to the device: an address the device cannot reach costs
 *  the whole connect step and a second configuration to undo. */
export function serverAddressProblem(address: string): string | null {
  const typed = address.trim();
  if (typed === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(typed);
  } catch {
    return SERVER_ADDRESS_SHAPE;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    return SERVER_ADDRESS_SHAPE;
  if (OWN_NAMES.includes(parsed.hostname.toLowerCase()))
    return SERVER_ADDRESS_LOCAL;
  return null;
}

/** Why an address only this browser understands will not do. */
export const SERVER_ADDRESS_LOCAL =
  "localhost is this computer's own name, and the device cannot reach it. Type the address the phones use, such as http://192.168.0.5:8080.";

/** Why half an address will not do. */
export const SERVER_ADDRESS_SHAPE =
  "Type the whole address, such as http://192.168.0.5:8080.";

/** Why the address field can be empty, and what to put in it. */
export const SERVER_ADDRESS_NOTE =
  "Wingman does not know an address the device can reach. Type the one the phones use, such as http://192.168.0.5:8080.";
