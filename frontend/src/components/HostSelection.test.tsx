import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import type {
  CurrentSing,
  SelectionRead,
  SelectionSlotRead,
  SongRead,
} from "../api";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import HostSelection, { type HostSelectionPhase } from "./HostSelection";

const { getMe, getPlayerSelection, getCurrentSing, listKaraokeColors } =
  vi.hoisted(() => ({
    getMe: vi.fn(),
    getPlayerSelection: vi.fn(),
    getCurrentSing: vi.fn(),
    listKaraokeColors: vi.fn(),
  }));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  getPlayerSelection,
  getCurrentSing,
  listKaraokeColors,
}));

const SONG: SongRead = {
  id: "usdb:1",
  source: "usdb",
  title: "Dancing Queen",
  artist: "ABBA",
  duration_seconds: 231,
  has_video: true,
  is_duet: false,
  language: "English",
  genre: "Pop",
  year: 1976,
  edition: null,
  creator: null,
};

const ALICE = {
  id: "aaa",
  name: "Alice",
  registered: false,
  hidden: false,
  has_avatar: false,
};

const SLOTS: SelectionSlotRead[] = [
  { color: "blue", player: ALICE, card_uid: null },
  { color: "red", player: null, card_uid: null },
  { color: "green", player: null, card_uid: "A1B2C3D4" },
];

function selection(extra: Partial<SelectionRead> = {}): SelectionRead {
  return {
    song: SONG,
    slots: SLOTS,
    opened_at: "2026-09-06T20:00:00.000Z",
    updated_at: "2026-09-06T20:00:05.000Z",
    auto_start_at: null,
    ...extra,
  };
}

const RUNNING: CurrentSing = {
  sing_id: "sing-1",
  started_at: "2026-09-06T20:10:00.000Z",
  song: SONG,
  slots: [],
};

function renderStage(onPhase?: (phase: HostSelectionPhase) => void) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {/* The page's class is what every host rule is scoped to. */}
      <div className="host-page">
        <div className="host-stage">
          <HostSelection onPhase={onPhase} />
        </div>
      </div>
    </QueryClientProvider>,
  );
}

/**
 * The `selection.changed` broadcast. It lands in the query cache, whose
 * subscribers are notified out of band, so every assertion on it waits.
 */
function broadcast(selection: SelectionRead | null): void {
  act(() => FakeSocket.deliver({ event: "selection.changed", selection }));
}

/** The slots as the room reads them: color first, then who stands there. */
function rows(): string[] {
  const list = screen.getByLabelText("Picking singers");
  return within(list)
    .getAllByRole("listitem")
    .map((row) => row.querySelector(".host-selection-name")?.textContent ?? "");
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  getPlayerSelection.mockResolvedValue({ data: { selection: null } });
  getCurrentSing.mockResolvedValue({ data: { sing: null } });
  listKaraokeColors.mockResolvedValue({
    data: {
      colors: [
        { name: "blue", hex: "#048BB9" },
        { name: "red", hex: "#D00000" },
        { name: "green", hex: "#00AC00" },
      ],
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("nothing is on the stage while nobody is picking", async () => {
  const onPhase = vi.fn();
  renderStage(onPhase);

  await waitFor(() => expect(getPlayerSelection).toHaveBeenCalled());
  expect(screen.queryByLabelText("Picking singers")).not.toBeInTheDocument();
  expect(onPhase).toHaveBeenLastCalledWith("idle");
});

test("the song and every slot are drawn while the room picks", async () => {
  getPlayerSelection.mockResolvedValue({ data: { selection: selection() } });
  const onPhase = vi.fn();
  renderStage(onPhase);

  expect(await screen.findByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.getByText("ABBA")).toBeInTheDocument();
  expect(screen.getByText("Picking singers")).toBeInTheDocument();
  // Every configured slot, empty ones included: the room watches them fill up.
  expect(rows()).toEqual(["Alice", "empty", "Unknown card"]);
  await waitFor(() => expect(onPhase).toHaveBeenLastCalledWith("selecting"));
});

test("a song being sung owns the stage instead", async () => {
  getPlayerSelection.mockResolvedValue({ data: { selection: selection() } });
  getCurrentSing.mockResolvedValue({ data: { sing: RUNNING } });
  const onPhase = vi.fn();
  renderStage(onPhase);

  await waitFor(() => expect(getPlayerSelection).toHaveBeenCalled());
  expect(screen.queryByLabelText("Picking singers")).not.toBeInTheDocument();
  expect(onPhase).toHaveBeenLastCalledWith("idle");
});

test("a slot filled at the device redraws the stage", async () => {
  getPlayerSelection.mockResolvedValue({ data: { selection: selection() } });
  renderStage();
  await screen.findByText("Dancing Queen");

  broadcast(
    selection({
      slots: [
        SLOTS[0],
        {
          color: "red",
          player: { ...ALICE, id: "bbb", name: "Bob" },
          card_uid: "B2",
        },
        SLOTS[2],
      ],
      updated_at: "2026-09-06T20:00:09.000Z",
    }),
  );

  await waitFor(() => expect(rows()).toEqual(["Alice", "Bob", "Unknown card"]));
});

test("a selection that ends takes the stage with it", async () => {
  getPlayerSelection.mockResolvedValue({ data: { selection: selection() } });
  const onPhase = vi.fn();
  renderStage(onPhase);
  await screen.findByText("Dancing Queen");

  broadcast(null);

  await waitFor(() =>
    expect(screen.queryByLabelText("Picking singers")).not.toBeInTheDocument(),
  );
  expect(onPhase).toHaveBeenLastCalledWith("idle");
});

test("the automatic start counts down in words", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  getPlayerSelection.mockResolvedValue({
    data: {
      selection: selection({
        auto_start_at: new Date(Date.now() + 3000).toISOString(),
      }),
    },
  });
  renderStage();

  expect(await screen.findByText("Starting in 3…")).toBeInTheDocument();

  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByText("Starting in 1…")).toBeInTheDocument();

  // Past its moment the line stays on one: the song is going up now, and a TV
  // reading "Starting in 0…" says it already went.
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.getByText("Starting in 1…")).toBeInTheDocument();
});
