import type { DeviceRead, FirmwareBuild, ReaderRead } from "./api";
import {
  deviceMeta,
  firmwareLine,
  isNewer,
  mappingRefusal,
  needsUpdate,
  otaAvailable,
  signalLabel,
  slotColor,
  slotRole,
  statusLine,
  UNUSED,
  updateLine,
  updateRefusal,
} from "./devices";
import { shortDate, shortTime } from "./duration";

const SEEN = "2026-08-12T14:03:00Z";

function reader(overrides: Partial<ReaderRead> = {}): ReaderRead {
  return { index: 0, state: "wired", role: UNUSED, ...overrides };
}

function device(overrides: Partial<DeviceRead> = {}): DeviceRead {
  return {
    id: "d-1",
    name: "The box",
    created_at: "2026-08-01T10:00:00Z",
    last_seen_at: SEEN,
    online: true,
    firmware_version: "0.2.0",
    protocol: 1,
    compatible: true,
    readers: [],
    buttons: [],
    ...overrides,
  };
}

test("a role names the slot it puts a card on, or nothing", () => {
  expect(slotColor("slot:dark_blue")).toBe("dark_blue");
  expect(slotColor("sequential")).toBeNull();
  expect(slotColor(UNUSED)).toBeNull();
  expect(slotRole("blue")).toBe("slot:blue");
});

test("versions compare by their numbers, however many there are", () => {
  expect(isNewer("0.3.0", "0.2.9")).toBe(true);
  expect(isNewer("0.2.0", "0.2.0")).toBe(false);
  expect(isNewer("0.2.0", "0.10.0")).toBe(false);
  expect(isNewer("1.0", "0.9.9")).toBe(true);
  // A firmware built from a working tree still compares by its numbers.
  expect(isNewer("0.3.0", "0.3.0-dirty")).toBe(false);
});

test("a device needs an update when it is behind, or speaks another protocol", () => {
  const manifest = { version: "0.3.0", protocol: 1, builds: [] };
  expect(needsUpdate(device(), manifest)).toBe(true);
  expect(needsUpdate(device({ firmware_version: "0.3.0" }), manifest)).toBe(
    false,
  );
  // No build in this checkout: the version half cannot fire at all.
  expect(needsUpdate(device(), null)).toBe(false);
  expect(needsUpdate(device({ compatible: false }), null)).toBe(true);
});

test("the meta line says only what is unusual about the device", () => {
  expect(deviceMeta(device(), null)).toBe("online · firmware 0.2.0");
  expect(deviceMeta(device({ online: false }), null)).toBe(
    `offline · last seen ${shortDate(SEEN)} ${shortTime(SEEN)} · firmware 0.2.0`,
  );
  expect(
    deviceMeta(
      device({
        online: false,
        last_seen_at: null,
        firmware_version: null,
        protocol: null,
        compatible: null,
      }),
      null,
    ),
  ).toBe("never connected");
  expect(
    deviceMeta(device(), { version: "0.3.0", protocol: 1, builds: [] }),
  ).toBe("online · firmware 0.2.0 · needs update");
  expect(deviceMeta(device({ compatible: false }), null)).toBe(
    "online · firmware 0.2.0 · needs update",
  );
});

test("the status lines say where the device is and what it runs", () => {
  expect(statusLine(device())).toBe("Online");
  expect(statusLine(device({ online: false }))).toBe(
    `Offline, last seen ${shortDate(SEEN)} ${shortTime(SEEN)}`,
  );
  expect(statusLine(device({ online: false, last_seen_at: null }))).toBe(
    "Never connected",
  );
  expect(firmwareLine(device())).toBe("Firmware 0.2.0 · protocol 1");
  expect(
    firmwareLine(device({ firmware_version: null, protocol: null })),
  ).toBeNull();
});

test("the update line names the newer firmware, or says the protocol is wrong", () => {
  expect(
    updateLine(device(), { version: "0.3.0", protocol: 1, builds: [] }),
  ).toBe("Update available: 0.3.0");
  expect(updateLine(device({ compatible: false }), null)).toBe(
    "This device needs a newer firmware.",
  );
  expect(updateLine(device(), null)).toBeNull();
});

function build(overrides: Partial<FirmwareBuild> = {}): FirmwareBuild {
  return {
    chip: "ESP32",
    file: "wingman-esp32.bin",
    size: 1_400_000,
    ota_file: "wingman-esp32-ota.bin",
    ota_size: 1_100_000,
    ...overrides,
  };
}

test("an update over Wi-Fi needs an image for it, and another version", () => {
  const manifest = { version: "0.3.0", protocol: 1, builds: [build()] };
  expect(otaAvailable(device(), manifest)).toBe(true);
  expect(otaAvailable(device({ firmware_version: "0.3.0" }), manifest)).toBe(
    false,
  );
  // A build from before the update over Wi-Fi existed carries only the merged
  // image, which the device would refuse at its first byte.
  expect(
    otaAvailable(device(), {
      version: "0.3.0",
      protocol: 1,
      builds: [build({ ota_file: null, ota_size: null })],
    }),
  ).toBe(false);
  expect(
    otaAvailable(device(), { version: "0.3.0", protocol: 1, builds: [] }),
  ).toBe(false);
  // A device that has never reported has run no firmware of ours: the cable is
  // the only way onto it, and the page says nothing about a network.
  expect(otaAvailable(device({ firmware_version: null }), manifest)).toBe(
    false,
  );
  expect(otaAvailable(device(), null)).toBe(false);
  // Differs, and not newer, which is the backend's own rule: a device that ran
  // ahead of the bundle can be put back on what this Wingman ships.
  expect(otaAvailable(device({ firmware_version: "0.4.0" }), manifest)).toBe(
    true,
  );
});

test("a refused update says which of the three things is in the way", () => {
  expect(updateRefusal({ detail: "no_firmware" })).toBe(
    "This Wingman has no firmware image.",
  );
  expect(updateRefusal({ detail: "no_ota_image" })).toBe(
    "The bundled firmware has no image for an update over Wi-Fi. Use the cable.",
  );
  expect(updateRefusal({ detail: "already_current" })).toBe(
    "The device already runs this version.",
  );
  expect(updateRefusal({ detail: "whatever" })).toBe(
    "Could not ask for the update.",
  );
});

test("the signal is three words, and nothing without a reading", () => {
  expect(signalLabel(-45)).toBe("good");
  expect(signalLabel(-60)).toBe("good");
  expect(signalLabel(-61)).toBe("fair");
  expect(signalLabel(-75)).toBe("fair");
  expect(signalLabel(-76)).toBe("weak");
  expect(signalLabel(null)).toBeNull();
  expect(signalLabel(undefined)).toBeNull();
});

test("a refused mapping names the reader the slug leaves out", () => {
  const readers = [
    reader({ index: 0 }),
    reader({ index: 1, state: "none" }),
    reader({ index: 2, state: "fault" }),
  ];
  const roles: Record<number, string> = { 1: "slot:blue" };
  const roleOf = (row: ReaderRead) => roles[row.index] ?? UNUSED;

  expect(mappingRefusal({ detail: "reader_not_wired" }, readers, roleOf)).toBe(
    "Reader 2 is not wired. Set it to Not used.",
  );
  expect(mappingRefusal({ detail: "duplicate_slot" }, readers, roleOf)).toBe(
    "Two readers have the same color.",
  );
  // Nothing in the mapping to blame: the sentence still says what to do.
  expect(
    mappingRefusal({ detail: "reader_not_wired" }, readers, () => UNUSED),
  ).toBe("One of the readers is not wired. Set it to Not used.");
  expect(mappingRefusal({ detail: "whatever" }, readers, roleOf)).toBe(
    "Could not save the device.",
  );
});

test("a color another device already reads names both of them", () => {
  const roleOf = () => UNUSED;
  // This one refusal answers an object, not a slug — and the color is spelled
  // the way the settings page spells it, `dark_blue` included.
  expect(
    mappingRefusal(
      {
        detail: {
          error: "slot_taken_elsewhere",
          color: "dark_blue",
          device: "Living room",
        },
      },
      [],
      roleOf,
    ),
  ).toBe(
    "The dark blue slot is already read by Living room. Give one of them another color.",
  );
  // An object that is not that refusal falls through to the generic line.
  expect(mappingRefusal({ detail: { error: "other" } }, [], roleOf)).toBe(
    "Could not save the device.",
  );
});
