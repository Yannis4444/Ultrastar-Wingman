import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  CardRead,
  DeviceRead,
  DeviceSettings,
  MeRead,
  PlayerRead,
  ReaderRead,
} from "../api";
import { shortDate, shortTime } from "../duration";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import Devices from "./Devices";

const {
  getMe,
  listDevices,
  listCards,
  getDeviceSettings,
  updateDeviceSettings,
  getFirmwareManifest,
  listPlayers,
  assignCard,
  forgetCard,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  listDevices: vi.fn(),
  listCards: vi.fn(),
  getDeviceSettings: vi.fn(),
  updateDeviceSettings: vi.fn(),
  getFirmwareManifest: vi.fn(),
  listPlayers: vi.fn(),
  assignCard: vi.fn(),
  forgetCard: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listDevices,
  listCards,
  getDeviceSettings,
  updateDeviceSettings,
  getFirmwareManifest,
  listPlayers,
  assignCard,
  forgetCard,
}));

const MANAGER = ["devices.manage", "players.view"];
const ACCOUNT: Partial<MeRead> = { user: userRead(), role: "admin" };
const SEEN = "2026-08-12T14:03:00Z";

const SETTINGS: DeviceSettings = {
  auto_start: false,
  auto_start_delay_s: 3,
  rescan_removes: true,
  selection_idle_s: 120,
  start_without_selection: "nothing",
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

function card(overrides: Partial<CardRead> = {}): CardRead {
  return {
    uid: "A1B2C3D4",
    player: player(),
    created_at: "2026-08-02T10:00:00Z",
    ...overrides,
  };
}

interface World {
  devices?: DeviceRead[];
  cards?: CardRead[];
  settings?: DeviceSettings;
  firmware?: { version: string; protocol: number; builds: [] } | null;
  players?: PlayerRead[];
  capabilities?: string[];
}

function renderDevices({
  devices = [],
  cards = [],
  settings = SETTINGS,
  firmware = null,
  players = [player()],
  capabilities = MANAGER,
}: World = {}) {
  getMe.mockResolvedValue(meResponse(capabilities, ACCOUNT));
  listDevices.mockResolvedValue({ data: { devices } });
  listCards.mockResolvedValue({ data: { cards } });
  getDeviceSettings.mockResolvedValue({ data: settings });
  updateDeviceSettings.mockImplementation(
    async ({ body }: { body: Partial<DeviceSettings> }) => ({
      data: { ...settings, ...body },
    }),
  );
  getFirmwareManifest.mockImplementation(async () => {
    if (firmware === null) throw { detail: "no_firmware" };
    return { data: firmware };
  });
  listPlayers.mockResolvedValue({ data: { players } });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/user/devices"]}>
        <Devices />
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
    listCards,
    getDeviceSettings,
    updateDeviceSettings,
    getFirmwareManifest,
    listPlayers,
    assignCard,
    forgetCard,
  ])
    mock.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

test("a role that may not manage devices is told who does", async () => {
  renderDevices({ capabilities: ["songs.view"] });

  expect(
    await screen.findByText(/The player selector is set up by the host/),
  ).toBeInTheDocument();
  expect(listDevices).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Set up a device")).not.toBeInTheDocument();
});

test("the four options are drawn from the settings and each one saves itself", async () => {
  renderDevices();

  const start = await screen.findByLabelText("Start the song on its own");
  expect(start).not.toBeChecked();
  expect(
    await screen.findByLabelText("Delay before the song starts"),
  ).toHaveValue(3);
  expect(
    screen.getByLabelText("Scanning a card again removes the singer"),
  ).toBeChecked();
  expect(
    screen.getByLabelText("Time before an idle selection closes"),
  ).toHaveValue(120);

  fireEvent.click(start);

  await waitFor(() =>
    expect(updateDeviceSettings).toHaveBeenCalledWith(
      expect.objectContaining({ body: { auto_start: true } }),
    ),
  );
  expect(await screen.findByText("Saved")).toBeInTheDocument();
});

test("a changed delay is written when the field is left", async () => {
  renderDevices();

  const delay = await screen.findByLabelText("Delay before the song starts");
  fireEvent.change(delay, { target: { value: "10" } });
  fireEvent.blur(delay);

  await waitFor(() =>
    expect(updateDeviceSettings).toHaveBeenCalledWith(
      expect.objectContaining({ body: { auto_start_delay_s: 10 } }),
    ),
  );
});

test("the idle expiry is written the same way, and alone", async () => {
  renderDevices();

  const idle = await screen.findByLabelText(
    "Time before an idle selection closes",
  );
  expect(idle).toHaveAttribute("min", "30");
  expect(idle).toHaveAttribute("max", "900");
  fireEvent.change(idle, { target: { value: "300" } });
  fireEvent.blur(idle);

  // The two number rows share one input component, so the field that was left
  // must be the only one in the body.
  await waitFor(() =>
    expect(updateDeviceSettings).toHaveBeenCalledWith(
      expect.objectContaining({ body: { selection_idle_s: 300 } }),
    ),
  );
});

test("a device row says whether it is here, what it runs, and nothing else", async () => {
  renderDevices({ devices: [device()] });

  const row = await screen.findByRole("link", { name: /The box/ });
  expect(row).toHaveAttribute("href", "/user/devices/d-1");
  expect(within(row).getByText("online · firmware 0.2.0")).toBeInTheDocument();
});

test("an offline device says when it was last heard from", async () => {
  renderDevices({ devices: [device({ online: false })] });

  expect(
    await screen.findByText(
      `offline · last seen ${shortDate(SEEN)} ${shortTime(SEEN)} · firmware 0.2.0`,
    ),
  ).toBeInTheDocument();
});

test("a device that never reported says so instead of a date", async () => {
  renderDevices({
    devices: [
      device({
        online: false,
        last_seen_at: null,
        firmware_version: null,
        protocol: null,
        compatible: null,
      }),
    ],
  });

  expect(await screen.findByText("never connected")).toBeInTheDocument();
});

test("a newer bundled firmware puts 'needs update' on the row", async () => {
  renderDevices({
    devices: [device()],
    firmware: { version: "0.3.0", protocol: 1, builds: [] },
  });

  expect(
    await screen.findByText("online · firmware 0.2.0 · needs update"),
  ).toBeInTheDocument();
});

test("a device speaking another protocol needs an update without a manifest", async () => {
  renderDevices({ devices: [device({ compatible: false })] });

  expect(
    await screen.findByText("online · firmware 0.2.0 · needs update"),
  ).toBeInTheDocument();
});

test("no device at all says where one comes from", async () => {
  renderDevices();

  expect(
    await screen.findByText("No device yet. Set one up with the plus above."),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Set up a device")).toHaveAttribute(
    "href",
    "/user/devices/new",
  );
});

test("a card nobody claimed opens the picker, and a tap gives it a singer", async () => {
  assignCard.mockResolvedValue({
    data: { uid: "A1B2C3D4", player: player(), created_at: "x" },
  });
  renderDevices({
    devices: [device({ readers: [reader({ uid: "A1B2C3D4" })] })],
  });

  fireEvent.click(await screen.findByText("Unknown card"));

  expect(
    await screen.findByRole("heading", { name: "Who holds this card?" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Card A1B2C3D4/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /Alice/ }));

  await waitFor(() =>
    expect(assignCard).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { uid: "A1B2C3D4" },
        body: { player_id: "p-1" },
      }),
    ),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Who holds this card?" }),
    ).toBeNull(),
  );
});

test("a card on a device that is away is not lying on anything", async () => {
  renderDevices({
    devices: [
      device({
        online: false,
        readers: [reader({ uid: "A1B2C3D4", player: player() })],
      }),
    ],
  });

  expect(
    await screen.findByText("Nothing is lying on a reader."),
  ).toBeInTheDocument();
  // The name is the *All cards* row's, not a placed one: nothing is reporting,
  // so nothing is known about what lies on that reader.
  expect(screen.queryByRole("button", { name: /Alice/ })).toBeNull();
});

test("a card that has a singer is drawn with their name", async () => {
  renderDevices({
    devices: [
      device({ readers: [reader({ uid: "A1B2C3D4", player: player() })] }),
    ],
  });

  const placed = await screen.findByRole("button", { name: /Alice/ });
  expect(within(placed).getByText("A1B2C3D4")).toBeInTheDocument();
  expect(screen.queryByText("Unknown card")).toBeNull();
});

test("a card is forgotten through the confirmation that names the singer", async () => {
  forgetCard.mockResolvedValue({ data: undefined });
  renderDevices({ cards: [card()] });

  fireEvent.click(await screen.findByLabelText("Forget card"));

  expect(
    await screen.findByText(/Card A1B2C3D4 stops being Alice/),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Forget" }));

  await waitFor(() =>
    expect(forgetCard).toHaveBeenCalledWith(
      expect.objectContaining({ path: { uid: "A1B2C3D4" } }),
    ),
  );
});

test("no card yet says how one gets a name", async () => {
  renderDevices({ devices: [device()] });

  expect(
    await screen.findByText(
      "No card has a singer yet. Put a card on a reader and tap it to say whose it is.",
    ),
  ).toBeInTheDocument();
});

test("a devices.changed asks for the devices and the cards again", async () => {
  renderDevices({ devices: [device()] });

  await screen.findByText("online · firmware 0.2.0");
  expect(listDevices).toHaveBeenCalledTimes(1);
  expect(listCards).toHaveBeenCalledTimes(1);

  FakeSocket.deliver({ event: "devices.changed" });

  await waitFor(() => expect(listDevices).toHaveBeenCalledTimes(2));
  expect(listCards).toHaveBeenCalledTimes(2);
});
