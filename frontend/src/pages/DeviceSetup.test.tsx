import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ButtonRead, DeviceRead, MeRead, ReaderRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import DeviceSetup from "./DeviceSetup";

const {
  getMe,
  listDevices,
  listKaraokeSlots,
  getJoinInfo,
  getFirmwareManifest,
  getFirmwareImage,
  createDevice,
  rotateDeviceToken,
  updateDevice,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  listDevices: vi.fn(),
  listKaraokeSlots: vi.fn(),
  getJoinInfo: vi.fn(),
  getFirmwareManifest: vi.fn(),
  getFirmwareImage: vi.fn(),
  createDevice: vi.fn(),
  rotateDeviceToken: vi.fn(),
  updateDevice: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listDevices,
  listKaraokeSlots,
  getJoinInfo,
  getFirmwareManifest,
  getFirmwareImage,
  createDevice,
  rotateDeviceToken,
  updateDevice,
}));

/** The flasher, without a board: it connects, reports two steps of progress
 *  and resets. `CHIP_NAME` is what the chip check reads. */
const flashed = vi.hoisted(() => ({ calls: [] as { address: number }[] }));

vi.mock("esptool-js", () => ({
  ESPLoader: class {
    chip = { CHIP_NAME: "ESP32" };
    main(): Promise<string> {
      return Promise.resolve("ESP32-D0WD-V3");
    }
    writeFlash(options: {
      fileArray: { address: number }[];
      reportProgress?: (file: number, done: number, total: number) => void;
    }): Promise<void> {
      flashed.calls.push(...options.fileArray);
      options.reportProgress?.(0, 512, 1024);
      options.reportProgress?.(0, 1024, 1024);
      return Promise.resolve();
    }
    after(): Promise<void> {
      return Promise.resolve();
    }
  },
  Transport: class {
    disconnect(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

const MANAGER = ["devices.manage"];
const ACCOUNT: Partial<MeRead> = { user: userRead(), role: "admin" };
const HELLO =
  '{"type":"hello","firmware":"0.1.0","protocol":1,"chip":"ESP32","mac":"AA:BB:CC:DD:EE:FF","configured":false,"build":"0.1.0-2-gabc"}';
const TOKEN = "wd_0123456789";

const SLOTS = {
  slots: [
    { name: "blue", hex: "#048BB9" },
    { name: "red", hex: "#D00000" },
  ],
  player_counts: [1, 2],
};

/**
 * A cable with nothing on the end of it. `readable` and `writable` are the two
 * shapes the wizard uses and nothing more, so no stream implementation is
 * needed; `say` is how a test plays a line the device printed.
 */
class FakePort {
  opens = 0;
  closes = 0;
  written: string[] = [];
  /** Whether opening the port makes the board print its boot hello. */
  greets = true;

  private queued: Uint8Array[] = [];
  private waiting:
    ((result: { value?: Uint8Array; done: boolean }) => void) | null = null;
  private finished = false;

  readable = {
    getReader: () => ({
      read: (): Promise<{ value?: Uint8Array; done: boolean }> => {
        const next = this.queued.shift();
        if (next !== undefined)
          return Promise.resolve({ value: next, done: false });
        if (this.finished) return Promise.resolve({ done: true });
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
      cancel: (): Promise<void> => {
        this.finished = true;
        const waiting = this.waiting;
        this.waiting = null;
        waiting?.({ done: true });
        return Promise.resolve();
      },
      releaseLock: (): void => {},
    }),
  };

  writable = {
    getWriter: () => ({
      write: (chunk: Uint8Array): Promise<void> => {
        this.written.push(new TextDecoder().decode(chunk));
        return Promise.resolve();
      },
      releaseLock: (): void => {},
    }),
  };

  open(): Promise<void> {
    this.opens += 1;
    if (this.greets) this.say(HELLO);
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closes += 1;
    return Promise.resolve();
  }

  getInfo(): Record<string, never> {
    return {};
  }

  /** One line off the device, newline and all. */
  say(line: string): void {
    const bytes = new TextEncoder().encode(`${line}\n`);
    const waiting = this.waiting;
    this.waiting = null;
    if (waiting !== null) waiting({ value: bytes, done: false });
    else this.queued.push(bytes);
  }

  /** The last `configure` line, parsed. */
  configured(): Record<string, string> | null {
    const line = this.written.find((sent) => sent.includes('"configure"'));
    if (line === undefined) return null;
    return JSON.parse(line) as Record<string, string>;
  }
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
    online: false,
    readers: [reader({ index: 0 }), reader({ index: 1 })],
    buttons: [button({ index: 0 })],
    ...overrides,
  };
}

/** What `GET /devices` answers right now, and how a test changes it. */
let listing: DeviceRead[] = [];

function setListing(devices: DeviceRead[]): void {
  listing = devices;
  FakeSocket.deliver({ event: "devices.changed" });
}

interface World {
  capabilities?: string[];
  serial?: FakePort | null;
  secure?: boolean;
  firmware?: boolean;
  entry?: string;
}

function renderWizard({
  capabilities = MANAGER,
  serial = new FakePort(),
  secure = true,
  firmware = true,
  entry = "/user/devices/new",
}: World = {}): FakePort | null {
  getMe.mockResolvedValue(meResponse(capabilities, ACCOUNT));
  listDevices.mockImplementation(() =>
    Promise.resolve({ data: { devices: listing } }),
  );
  listKaraokeSlots.mockResolvedValue({ data: SLOTS });
  getJoinInfo.mockResolvedValue({ data: { url: "http://192.168.0.5:8080" } });
  getFirmwareManifest.mockImplementation(() => {
    if (!firmware) throw { detail: "no_firmware" };
    return Promise.resolve({
      data: {
        version: "0.2.0",
        protocol: 1,
        builds: [{ chip: "ESP32", file: "wingman-esp32.bin", size: 900000 }],
      },
    });
  });
  getFirmwareImage.mockResolvedValue({ data: new ArrayBuffer(64) });

  Object.defineProperty(window, "isSecureContext", {
    value: secure,
    configurable: true,
  });
  if (serial !== null)
    Object.defineProperty(navigator, "serial", {
      value: { requestPort: () => Promise.resolve(serial) },
      configurable: true,
    });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/user/devices" element={<p>The device list</p>} />
          <Route path="/user/devices/new" element={<DeviceSetup />} />
          <Route
            path="/user/devices/:deviceId"
            element={<p>The device page</p>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return serial;
}

function next(): void {
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
}

beforeEach(() => {
  listing = [];
  flashed.calls = [];
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  for (const mock of [
    getMe,
    listDevices,
    listKaraokeSlots,
    getJoinInfo,
    getFirmwareManifest,
    getFirmwareImage,
    createDevice,
    rotateDeviceToken,
    updateDevice,
  ])
    mock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serial");
});

test("a role that may not manage devices is told who does", async () => {
  renderWizard({ capabilities: ["songs.view"] });

  expect(
    await screen.findByText(/The player selector is set up by the host/),
  ).toBeInTheDocument();
  expect(screen.queryByText("Build the box")).toBeNull();
});

test("the build step says what to wire where", async () => {
  renderWizard();

  expect(await screen.findByText("Build the box")).toBeInTheDocument();
  expect(
    screen.getByText("Reader 1 to 6 SDA (chip select)"),
  ).toBeInTheDocument();
  expect(screen.getByText("5, 17, 16, 4, 21, 22")).toBeInTheDocument();
  expect(screen.getByText("32, 33, 25, 26")).toBeInTheDocument();
});

test("a browser with no serial port is sent to the localhost address", async () => {
  renderWizard({ serial: null, secure: false });

  expect(await screen.findByText("Build the box")).toBeInTheDocument();
  next();

  expect(
    await screen.findByText(
      `http://localhost:${window.location.port}/user/devices/new`,
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Connect and flash" }),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
});

test("a Wingman with no firmware image says so, and still lets a flashed board through", async () => {
  const port = renderWizard({ firmware: false });

  expect(await screen.findByText("Build the box")).toBeInTheDocument();
  next();

  expect(
    await screen.findByText(/carries no firmware image/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Connect and flash" }),
  ).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Skip flashing" }));
  await waitFor(() => expect(port?.opens).toBe(1));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled(),
  );
});

test("a board that says nothing at boot is asked over the cable", async () => {
  const silent = new FakePort();
  // Opening the port resets the board on Windows, so the boot hello can be
  // missed entirely. The wizard asks for one.
  silent.greets = false;
  renderWizard({ serial: silent });

  expect(await screen.findByText("Build the box")).toBeInTheDocument();
  next();
  fireEvent.click(await screen.findByRole("button", { name: "Skip flashing" }));

  await waitFor(() =>
    expect(silent.written.some((line) => line.includes('"hello"'))).toBe(true),
  );
  silent.say(HELLO);
  expect(await screen.findByText(/build 0.1.0-2-gabc/)).toBeInTheDocument();
});

test("the whole wizard: flash, configure, connect, discover, map", async () => {
  const port = renderWizard();
  expect(port).not.toBeNull();

  /* ---- step 1, the build ------------------------------------------------ */
  expect(await screen.findByText("Build the box")).toBeInTheDocument();
  next();

  /* ---- step 2, the flash ------------------------------------------------ */
  expect(
    await screen.findByText(/Firmware 0.2.0 for ESP32 boards/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Connect and flash" }));

  // The image goes to address 0 as one file, and the console is reopened on
  // the same cable at the console's own rate.
  await waitFor(() =>
    expect(flashed.calls.map((file) => file.address)).toEqual([0]),
  );
  await waitFor(() => expect(port?.opens).toBe(1));

  // The board's boot hello is the handshake's answer, and it names what runs.
  expect(
    await screen.findByText(/Firmware 0.1.0 · protocol 1 · ESP32/),
  ).toBeInTheDocument();

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled(),
  );
  next();

  /* ---- step 3, the settings --------------------------------------------- */
  createDevice.mockResolvedValue({
    data: { device: device(), token: TOKEN },
  });

  const address = await screen.findByLabelText("Wingman address");
  // Never localhost: the join URL is what a phone in the room reaches.
  expect(address).toHaveValue("http://192.168.0.5:8080");

  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "The box by the TV" },
  });

  // The scan goes out over the same cable, and the answer fills the select.
  fireEvent.click(screen.getByRole("button", { name: "Scan" }));
  await waitFor(() =>
    expect(port?.written.some((line) => line.includes('"scan"'))).toBe(true),
  );
  port?.say(
    '{"type":"networks","networks":[{"ssid":"Weak","rssi":-80,"secure":false},{"ssid":"Party","rssi":-40,"secure":true}]}',
  );
  const picker = await screen.findByLabelText("Networks the device can see");
  await waitFor(() =>
    expect(
      [...(picker as HTMLSelectElement).options].map((option) => option.text),
    ).toEqual(["Pick a network", "Party (secured)", "Weak (open)"]),
  );
  fireEvent.change(picker, { target: { value: "Party" } });

  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: 'a"b\\c' },
  });

  fireEvent.click(screen.getByRole("button", { name: "Send to the device" }));

  await waitFor(() => expect(createDevice).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(port?.configured()).not.toBeNull());
  expect(port?.configured()).toEqual({
    cmd: "configure",
    ssid: "Party",
    password: 'a"b\\c',
    server_url: "http://192.168.0.5:8080",
    token: TOKEN,
  });
  // The token is written to the device and never to the screen.
  expect(screen.queryByText(new RegExp(TOKEN))).toBeNull();

  port?.say('{"type":"ok"}');
  port?.say('{"type":"status","state":"wifi_connecting"}');
  port?.say('{"type":"status","state":"wifi_connected","ip":"192.168.0.23"}');

  expect(await screen.findByText("Connecting to Wi-Fi…")).toBeInTheDocument();
  expect(
    screen.getByText("Connected, address 192.168.0.23."),
  ).toBeInTheDocument();

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled(),
  );
  next();

  /* ---- step 4, the first report ----------------------------------------- */
  expect(
    await screen.findByText(/joining the network and saying hello/),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

  setListing([device({ online: true })]);
  expect(
    await screen.findByText("The device reached Wingman."),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled(),
  );
  next();

  /* ---- step 5, the discovery -------------------------------------------- */
  expect(await screen.findByText("Find the readers")).toBeInTheDocument();
  expect(screen.getAllByText("waiting for a card")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

  // The second reader takes a card first, so it is the first slot.
  setListing([
    device({
      online: true,
      readers: [reader({ index: 0 }), reader({ index: 1, uid: "AAAA" })],
    }),
  ]);
  expect(await screen.findByText("found first")).toBeInTheDocument();

  setListing([
    device({
      online: true,
      readers: [
        reader({ index: 0, uid: "BBBB" }),
        reader({ index: 1, uid: "AAAA" }),
      ],
      buttons: [button({ index: 0, presses: 2 })],
    }),
  ]);
  expect(await screen.findByText("found second")).toBeInTheDocument();

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled(),
  );
  next();

  /* ---- step 6, the mapping ---------------------------------------------- */
  updateDevice.mockResolvedValue({ data: device({ online: true }) });

  expect(await screen.findByText("What everything does")).toBeInTheDocument();
  // Reader 2 was first, so it takes the first slot; reader 1 takes the second.
  expect(screen.getByLabelText("Reader 2 role")).toHaveValue("slot:blue");
  expect(screen.getByLabelText("Reader 1 role")).toHaveValue("slot:red");
  expect(screen.getByLabelText("Button 1 action")).toHaveValue("start");

  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(updateDevice).toHaveBeenCalledTimes(1));
  expect(updateDevice.mock.calls[0][0].body).toEqual({
    reader_roles: { "0": "slot:red", "1": "slot:blue" },
    button_actions: { "0": "start" },
  });
  expect(await screen.findByText("The device page")).toBeInTheDocument();
});

test("re-entering for an existing device mints a new token and asks for no name", async () => {
  listing = [device({ online: true })];
  const port = renderWizard({
    entry: "/user/devices/new?device=d-1&step=configure",
  });
  rotateDeviceToken.mockResolvedValue({
    data: { device: device(), token: TOKEN },
  });

  fireEvent.click(
    await screen.findByRole("button", { name: "Connect the device" }),
  );
  await waitFor(() => expect(port?.opens).toBe(1));

  expect(await screen.findByLabelText("Network")).toBeInTheDocument();
  expect(screen.queryByLabelText("Name")).toBeNull();

  fireEvent.change(screen.getByLabelText("Network"), {
    target: { value: "Party" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send to the device" }));

  await waitFor(() => expect(rotateDeviceToken).toHaveBeenCalledTimes(1));
  expect(createDevice).not.toHaveBeenCalled();
  await waitFor(() => expect(port?.configured()?.token).toBe(TOKEN));
});

test("the console is let go before the same board is picked again", async () => {
  const port = renderWizard();

  expect(await screen.findByText("Build the box")).toBeInTheDocument();
  next();
  fireEvent.click(await screen.findByRole("button", { name: "Skip flashing" }));
  await waitFor(() => expect(port?.opens).toBe(1));

  // The flasher opens the port itself, and the browser hands out the same port
  // for the same board: the console has to be closed first.
  fireEvent.click(screen.getByRole("button", { name: "Connect and flash" }));
  await waitFor(() => expect(port?.opens).toBe(2));
  expect(port?.closes).toBe(1);
});

test("an address the device cannot reach is refused before a token is minted", async () => {
  listing = [device({ online: true })];
  renderWizard({ entry: "/user/devices/new?device=d-1&step=configure" });

  fireEvent.click(
    await screen.findByRole("button", { name: "Connect the device" }),
  );
  fireEvent.change(await screen.findByLabelText("Network"), {
    target: { value: "Party" },
  });
  const send = screen.getByRole("button", { name: "Send to the device" });
  await waitFor(() => expect(send).toBeEnabled());

  fireEvent.change(screen.getByLabelText("Wingman address"), {
    target: { value: "http://localhost:8081" },
  });
  expect(
    await screen.findByText(/is this computer's own name/),
  ).toBeInTheDocument();
  expect(send).toBeDisabled();

  fireEvent.change(screen.getByLabelText("Wingman address"), {
    target: { value: "192.168.0.5:8080" },
  });
  expect(await screen.findByText(/Type the whole address/)).toBeInTheDocument();
  expect(send).toBeDisabled();
  expect(rotateDeviceToken).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("Wingman address"), {
    target: { value: "http://192.168.0.5:8080" },
  });
  await waitFor(() => expect(send).toBeEnabled());
});
