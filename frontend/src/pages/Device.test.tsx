import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  ButtonRead,
  DeviceRead,
  FirmwareManifest,
  MeRead,
  PlayerRead,
  ReaderRead,
} from "../api";
import { shortDate, shortTime } from "../duration";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import Device from "./Device";

const {
  getMe,
  listDevices,
  listKaraokeSlots,
  getFirmwareManifest,
  updateDevice,
  deleteDevice,
  requestDeviceUpdate,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  listDevices: vi.fn(),
  listKaraokeSlots: vi.fn(),
  getFirmwareManifest: vi.fn(),
  updateDevice: vi.fn(),
  deleteDevice: vi.fn(),
  requestDeviceUpdate: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listDevices,
  listKaraokeSlots,
  getFirmwareManifest,
  updateDevice,
  deleteDevice,
  requestDeviceUpdate,
}));

const MANAGER = ["devices.manage"];
const ACCOUNT: Partial<MeRead> = { user: userRead(), role: "admin" };
const SEEN = "2026-08-12T14:03:00Z";

/** A build that carries the bare application image, which is the half of an
 *  update over Wi-Fi this Wingman has to bring. */
const OTA: FirmwareManifest = {
  version: "0.3.0",
  protocol: 1,
  builds: [
    {
      chip: "ESP32",
      file: "wingman-esp32.bin",
      size: 1_400_000,
      ota_file: "wingman-esp32-ota.bin",
      ota_size: 1_100_000,
    },
  ],
};

/** The same build from before the update over Wi-Fi existed: the cable only. */
const CABLE_ONLY: FirmwareManifest = {
  ...OTA,
  builds: [{ chip: "ESP32", file: "wingman-esp32.bin", size: 1_400_000 }],
};

const SLOTS = {
  slots: [
    { name: "blue", hex: "#048BB9" },
    { name: "red", hex: "#D00000" },
  ],
  player_counts: [1, 2],
};

function player(overrides: Partial<PlayerRead> = {}): PlayerRead {
  return {
    id: "p-1",
    name: "Alice",
    registered: true,
    hidden: false,
    has_avatar: false,
    ...overrides,
  };
}

function reader(overrides: Partial<ReaderRead> = {}): ReaderRead {
  return { index: 0, state: "wired", role: "unused", ...overrides };
}

function button(overrides: Partial<ButtonRead> = {}): ButtonRead {
  return { index: 0, presses: 0, action: "none", ...overrides };
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
    rssi: -55,
    readers: [reader()],
    buttons: [button()],
    ...overrides,
  };
}

interface World {
  devices?: DeviceRead[];
  firmware?: FirmwareManifest | null;
  capabilities?: string[];
  id?: string;
}

function renderDevice({
  devices = [device()],
  firmware = null,
  capabilities = MANAGER,
  id = "d-1",
}: World = {}) {
  getMe.mockResolvedValue(meResponse(capabilities, ACCOUNT));
  listDevices.mockResolvedValue({ data: { devices } });
  listKaraokeSlots.mockResolvedValue({ data: SLOTS });
  getFirmwareManifest.mockImplementation(async () => {
    if (firmware === null) throw { detail: "no_firmware" };
    return { data: firmware };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/user/devices/${id}`]}>
        <Routes>
          <Route path="/user/devices" element={<p>The device list</p>} />
          <Route path="/user/devices/:deviceId" element={<Device />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  for (const mock of [
    getMe,
    listDevices,
    listKaraokeSlots,
    getFirmwareManifest,
    updateDevice,
    deleteDevice,
    requestDeviceUpdate,
  ])
    mock.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

test("a role that may not manage devices is told who does", async () => {
  renderDevice({ capabilities: ["songs.view"] });

  expect(
    await screen.findByText(/The player selector is set up by the host/),
  ).toBeInTheDocument();
  expect(listDevices).not.toHaveBeenCalled();
});

test("an id no device has is a sentence, not a redirect", async () => {
  renderDevice({ id: "d-nope" });

  expect(
    await screen.findByText(/There is no such device/),
  ).toBeInTheDocument();
  expect(screen.queryByText("The device list")).toBeNull();
});

test("the status says where the device is, what it runs and how well it hears", async () => {
  renderDevice({ firmware: { version: "0.3.0", protocol: 1, builds: [] } });

  expect(await screen.findByText("Online")).toBeInTheDocument();
  expect(screen.getByText("Firmware 0.2.0 · protocol 1")).toBeInTheDocument();
  expect(screen.getByText("Update available: 0.3.0")).toBeInTheDocument();
  expect(screen.getByText("Signal: good")).toBeInTheDocument();
});

test("an offline device says when it was last heard from, and nothing about its signal", async () => {
  renderDevice({
    devices: [device({ online: false, rssi: null, compatible: false })],
  });

  expect(
    await screen.findByText(
      `Offline, last seen ${shortDate(SEEN)} ${shortTime(SEEN)}`,
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText("This device needs a newer firmware."),
  ).toBeInTheDocument();
  expect(screen.queryByText(/^Signal:/)).toBeNull();
  // A wired reader is not "empty" while the device is away: nothing is
  // reporting, so nothing is known about what lies on it.
  expect(screen.queryByText("empty")).toBeNull();
});

test("a reader row says what lies on it, whatever state it is in", async () => {
  renderDevice({
    devices: [
      device({
        readers: [
          reader({ index: 0, player: player(), uid: "A1B2C3D4" }),
          reader({ index: 1, uid: "DEADBEEF" }),
          reader({ index: 2 }),
          reader({ index: 3, state: "none" }),
          reader({ index: 4, state: "fault", version: "3a" }),
        ],
      }),
    ],
  });

  expect(await screen.findByText("Reader 1")).toBeInTheDocument();
  expect(screen.getByText("Alice")).toBeInTheDocument();
  expect(screen.getByText(/Unknown card/)).toBeInTheDocument();
  expect(screen.getByText("DEADBEEF")).toBeInTheDocument();
  expect(screen.getByText("empty")).toBeInTheDocument();
  expect(screen.getByText("not wired")).toBeInTheDocument();
  expect(screen.getByText(/Answers with garbage/)).toBeInTheDocument();
  expect(screen.getByText(/\(0x3a\)/)).toBeInTheDocument();

  // A reader that never answered the probe and carries no role has nothing to
  // set; one that is wired does.
  expect(screen.getByLabelText("Reader 4 role")).toBeDisabled();
  expect(screen.getByLabelText("Reader 1 role")).toBeEnabled();
});

test("a reader that came loose while carrying a role stays clearable", async () => {
  renderDevice({
    devices: [
      device({
        readers: [reader({ index: 0, state: "none", role: "slot:blue" })],
      }),
    ],
  });

  const select = await screen.findByLabelText("Reader 1 role");
  expect(select).toBeEnabled();

  // And it stays that way once *Not used* is picked: what is stored decides
  // whether the select is dead, never what is drawn, or the change would
  // disable the control under the hand that made it and before it was saved.
  fireEvent.change(select, { target: { value: "unused" } });
  expect(select).toBeEnabled();
  expect(select).toHaveValue("unused");
});

test("changing a role saves the whole mapping in one PATCH", async () => {
  updateDevice.mockImplementation(async () => ({
    data: device({ readers: [reader({ role: "slot:blue" })] }),
  }));
  renderDevice({
    devices: [
      device({
        readers: [reader({ index: 0 }), reader({ index: 1 })],
        buttons: [button({ index: 0, action: "start" })],
      }),
    ],
  });

  const save = await screen.findByRole("button", { name: "Save" });
  expect(save).toBeDisabled();
  expect(screen.getByText("Nothing has changed yet.")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Reader 1 role"), {
    target: { value: "slot:blue" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(updateDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { device_id: "d-1" },
        body: {
          name: "The box",
          // Every position, not only the one that moved: the backend replaces
          // the stored mapping with what it is given.
          reader_roles: { "0": "slot:blue", "1": "unused" },
          button_actions: { "0": "start" },
        },
      }),
    ),
  );
  expect(await screen.findByText("Saved")).toBeInTheDocument();
});

test("a mapping the device cannot have says which reader is wrong, and what to do", async () => {
  updateDevice.mockRejectedValue({ detail: "reader_not_wired" });
  // The reachable case: reader 2 was wired when it was given its color and has
  // come loose since. Its role rides along in every PATCH the page sends, so
  // nothing here saves until it is set to Not used, which is what the sentence
  // has to say.
  renderDevice({
    devices: [
      device({
        readers: [
          reader({ index: 0 }),
          reader({ index: 1, state: "none", role: "slot:blue" }),
        ],
      }),
    ],
  });

  fireEvent.change(await screen.findByLabelText("Reader 1 role"), {
    target: { value: "slot:red" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(
    await screen.findByText("Reader 2 is not wired. Set it to Not used."),
  ).toBeInTheDocument();
});

test("a button row counts its presses and maps to one action", async () => {
  updateDevice.mockImplementation(async () => ({ data: device() }));
  renderDevice({
    devices: [
      device({ readers: [], buttons: [button({ index: 0, presses: 3 })] }),
    ],
  });

  expect(await screen.findByText("Button 1")).toBeInTheDocument();
  expect(screen.getByText("3 presses")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Button 1 action"), {
    target: { value: "start" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(updateDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ button_actions: { "0": "start" } }),
      }),
    ),
  );
});

test("deleting says the cards stay, and lands back on the list", async () => {
  deleteDevice.mockResolvedValue({ data: undefined });
  renderDevice();

  fireEvent.click(await screen.findByRole("button", { name: "Delete device" }));

  expect(
    await screen.findByText("Delete The box? The cards stay."),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  await waitFor(() =>
    expect(deleteDevice).toHaveBeenCalledWith(
      expect.objectContaining({ path: { device_id: "d-1" } }),
    ),
  );
  expect(await screen.findByText("The device list")).toBeInTheDocument();
});

test("a device deleted somewhere else takes the page back to the list", async () => {
  renderDevice();

  await screen.findByText("Online");
  listDevices.mockResolvedValue({ data: { devices: [] } });
  FakeSocket.deliver({ event: "devices.changed" });

  expect(await screen.findByText("The device list")).toBeInTheDocument();
});

test("the readers select the configured slot colors, in turn and not used", async () => {
  renderDevice();

  const select = await screen.findByLabelText("Reader 1 role");
  expect(
    within(select)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["blue", "red", "Everybody in turn", "Not used"]);
});

const OVER_THE_AIR = { name: "Update over Wi-Fi" };
const REQUESTED = /Update requested\. The device fetches it/;

test("the update over Wi-Fi is offered only with an image for it", async () => {
  renderDevice({ firmware: OTA });

  expect(await screen.findByRole("button", OVER_THE_AIR)).toBeInTheDocument();
  // The cable never goes away: it is what is left when this fails.
  expect(
    screen.getByRole("link", { name: "Update firmware" }),
  ).toBeInTheDocument();
});

test("a build with no image for it leaves the cable standing alone", async () => {
  renderDevice({ firmware: CABLE_ONLY });

  expect(
    await screen.findByRole("link", { name: "Update firmware" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", OVER_THE_AIR)).toBeNull();
  expect(screen.queryByText(/Connect the device/)).toBeNull();
});

test("a device on the bundled version is offered nothing at all", async () => {
  renderDevice({
    devices: [device({ firmware_version: "0.3.0" })],
    firmware: OTA,
  });

  await screen.findByText("Online");
  expect(screen.queryByRole("button", OVER_THE_AIR)).toBeNull();
});

test("a device that is away is said so instead of being offered the button", async () => {
  renderDevice({
    devices: [device({ online: false, rssi: null })],
    firmware: OTA,
  });

  expect(
    await screen.findByText("Connect the device to update it over Wi-Fi."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", OVER_THE_AIR)).toBeNull();
});

test("a device that has never reported is sent to the cable, not to the network", async () => {
  renderDevice({
    devices: [
      device({
        online: false,
        last_seen_at: null,
        firmware_version: null,
        protocol: null,
        compatible: null,
        rssi: null,
      }),
    ],
    firmware: OTA,
  });

  await screen.findByText("Never connected");
  expect(screen.queryByRole("button", OVER_THE_AIR)).toBeNull();
  // It has run no firmware of ours, so "connect it and it updates itself" is
  // the wrong sentence: the cable link beside it is the only way onto it.
  expect(screen.queryByText(/Connect the device/)).toBeNull();
});

test("asking for the update says the device will fetch it on its next report", async () => {
  requestDeviceUpdate.mockResolvedValue({ data: undefined });
  renderDevice({ firmware: OTA });

  fireEvent.click(await screen.findByRole("button", OVER_THE_AIR));

  await waitFor(() =>
    expect(requestDeviceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ path: { device_id: "d-1" } }),
    ),
  );
  expect(await screen.findByText(REQUESTED)).toBeInTheDocument();
  // The ask stands, so there is nothing to press again.
  expect(screen.queryByRole("button", OVER_THE_AIR)).toBeNull();
});

test("each way the update can be refused has its own sentence", async () => {
  renderDevice({ firmware: OTA });
  const button = await screen.findByRole("button", OVER_THE_AIR);

  for (const [detail, sentence] of [
    ["no_firmware", "This Wingman has no firmware image."],
    [
      "no_ota_image",
      "The bundled firmware has no image for an update over Wi-Fi. Use the cable.",
    ],
    ["already_current", "The device already runs this version."],
  ]) {
    requestDeviceUpdate.mockRejectedValueOnce({ detail });
    fireEvent.click(button);
    expect(await screen.findByText(sentence)).toBeInTheDocument();
  }
});

test("an ask made before this page was opened is on it, and goes when it is over", async () => {
  renderDevice({
    devices: [device({ update_requested_at: "2026-08-12T14:04:00Z" })],
    firmware: OTA,
  });

  expect(await screen.findByText(REQUESTED)).toBeInTheDocument();
  expect(screen.queryByRole("button", OVER_THE_AIR)).toBeNull();

  // The device reported the new version, so the backend dropped the flag.
  listDevices.mockResolvedValue({
    data: { devices: [device({ firmware_version: "0.3.0" })] },
  });
  FakeSocket.deliver({ event: "devices.changed" });

  await waitFor(() => expect(screen.queryByText(REQUESTED)).toBeNull());
});

test("both ways back into the wizard carry the device and the step", async () => {
  renderDevice();

  expect(
    await screen.findByRole("link", { name: "Update firmware" }),
  ).toHaveAttribute("href", "/user/devices/new?device=d-1&step=flash");
  expect(
    screen.getByRole("link", { name: "Change Wi-Fi or server" }),
  ).toHaveAttribute("href", "/user/devices/new?device=d-1&step=configure");
});
