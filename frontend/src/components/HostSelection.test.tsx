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
import { REVEAL_MS } from "./SongReel";

const {
  getMe,
  getPlayerSelection,
  getCurrentSing,
  listKaraokeColors,
  listSongs,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  getPlayerSelection: vi.fn(),
  getCurrentSing: vi.fn(),
  listKaraokeColors: vi.fn(),
  listSongs: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  getPlayerSelection,
  getCurrentSing,
  listKaraokeColors,
  listSongs,
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

const AFRICA: SongRead = {
  ...SONG,
  id: "usdb:2",
  title: "Africa",
  artist: "Toto",
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

/** The cards in the host's order: who stands on each slot. */
function rows(): string[] {
  return cards().map(
    (card) => card.querySelector(".host-selection-name")?.textContent ?? "",
  );
}

/** The card elements themselves, for the state each one is drawn in. */
function cards(): HTMLElement[] {
  const stage = screen.getByLabelText("Picking singers");
  return within(stage).getAllByRole("listitem");
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  getPlayerSelection.mockResolvedValue({ data: { selection: null } });
  getCurrentSing.mockResolvedValue({ data: { sing: null } });
  listSongs.mockResolvedValue({ data: { songs: [SONG, AFRICA] } });
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

test("a card carries its slot color, and an unfilled one is drawn dark", async () => {
  getPlayerSelection.mockResolvedValue({ data: { selection: selection() } });
  renderStage();
  await screen.findByText("Dancing Queen");

  const [alice, empty, unknown] = cards();
  // The whole card — outline, fill, placeholder — is mixed from this one value.
  expect(alice.style.getPropertyValue("--slot")).toBe("#048BB9");
  expect(empty.style.getPropertyValue("--slot")).toBe("#D00000");
  expect(unknown.style.getPropertyValue("--slot")).toBe("#00AC00");

  // Somebody is on the first one, so it keeps the page behind it; the other two
  // are filled with their own color taken down towards the background.
  expect(alice).not.toHaveClass("host-selection-slot-empty");
  expect(empty).toHaveClass("host-selection-slot-empty");
  expect(unknown).toHaveClass("host-selection-slot-empty");

  // The avatar above the name is the person on a filled card and the
  // placeholder on the two that nobody is on, a card nobody owns included.
  expect(alice.querySelector(".player-avatar-letter")).not.toBeNull();
  // A slot nobody has taken is the short box: no face, no placeholder. An
  // unknown card is taken by something, so it stands full height with the
  // placeholder where the face would be.
  expect(empty.querySelector(".player-avatar")).toBeNull();
  expect(empty.querySelector(".host-selection-card")).toHaveClass(
    "host-selection-card-empty",
  );
  expect(unknown.querySelector(".player-avatar-empty")).not.toBeNull();
  expect(unknown.querySelector(".host-selection-card")).not.toHaveClass(
    "host-selection-card-empty",
  );
});

test("the head is one column: the cover over the words, the title in its reserved box", async () => {
  getPlayerSelection.mockResolvedValue({ data: { selection: selection() } });
  renderStage();
  const title = await screen.findByRole("heading", { name: "Dancing Queen" });

  const song = document.querySelector(".host-selection-song");
  expect(song).not.toBeNull();
  // Cover first, then the text block, in one block — the stylesheet stacks them.
  const children = [...(song?.children ?? [])];
  expect(children.map((child) => child.className)).toEqual([
    "song-cover host-selection-cover",
    "host-selection-text",
  ]);
  // The title stands in a box that reserves its two lines, so a short one and a
  // long one leave the artist, the line and the cover where they are.
  expect(title.parentElement).toHaveClass("host-selection-title-box");
  expect(title.parentElement?.parentElement).toHaveClass("host-selection-text");
  // The cards are still along the foot: a plain selection shows them.
  expect(screen.getByLabelText("Picking singers")).not.toHaveClass(
    "host-selection-solo",
  );
  expect(rows()).toEqual(["Alice", "empty", "Unknown card"]);
});

test("the head alone, centred, for a spin a phone started", async () => {
  getPlayerSelection.mockResolvedValue({
    data: {
      selection: spun(1, Date.now() - REVEAL_MS - 1000, {
        spin: {
          id: 1,
          spun_at: new Date(Date.now() - REVEAL_MS - 1000).toISOString(),
          scope: "all",
          playlist_id: null,
          origin: "phone",
          revealed: false,
        },
      }),
    },
  });
  renderStage();

  const stage = await screen.findByLabelText("Picking singers");
  expect(stage).toHaveClass("host-selection-solo");
  // The same head — the reel, title, artist, the line — and no row of cards
  // at all, not a hidden one: the slots are the picker's screen, the one the
  // phone's Play opens.
  expect(screen.getByRole("heading", { name: "Dancing Queen" })).toBeVisible();
  expect(screen.getByText("ABBA")).toBeInTheDocument();
  expect(screen.getByText("Picking singers")).toBeInTheDocument();
  expect(document.querySelector(".host-selection-reel")).not.toBeNull();
  expect(within(stage).queryByRole("list")).toBeNull();
  expect(document.querySelector(".host-selection-slots")).toBeNull();

  // The phone moved on to its singers: the spin is off the selection, and the
  // ordinary picking screen with the cards takes the stage.
  broadcast(selection({ spin: null, updated_at: "2026-09-06T20:00:09.000Z" }));
  await waitFor(() =>
    expect(rows()).toEqual(["Alice", "empty", "Unknown card"]),
  );
  expect(screen.getByLabelText("Picking singers")).not.toHaveClass(
    "host-selection-solo",
  );
  expect(document.querySelector(".host-selection-reel")).toBeNull();
  expect(document.querySelector(".host-selection-cover")).not.toBeNull();
});

test("the selector's spin keeps the cards along the foot", async () => {
  getPlayerSelection.mockResolvedValue({
    data: { selection: spun(1, Date.now() - REVEAL_MS - 1000) },
  });
  renderStage();

  const stage = await screen.findByLabelText("Picking singers");
  // The room is standing at the readers, and the next press starts the song:
  // who is on which slot is what the screen is for.
  expect(stage).not.toHaveClass("host-selection-solo");
  expect(rows()).toEqual(["Alice", "empty", "Unknown card"]);
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

  const line = await screen.findByText("Starting in 3…");
  // Under the song, never inside a card: it counts the picking down, not a slot.
  expect(line.closest(".host-selection-head")).not.toBeNull();
  expect(line.closest(".host-selection-slots")).toBeNull();

  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByText("Starting in 1…")).toBeInTheDocument();

  // Past its moment the line stays on one: the song is going up now, and a TV
  // reading "Starting in 0…" says it already went.
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.getByText("Starting in 1…")).toBeInTheDocument();
});

/**
 * A selection the room spun for: the server's pick, and the spin on it. The
 * selector's, unless a test says otherwise: that is the spin the cards stand
 * under, and most of what is checked here is the cards.
 */
function spun(
  id: number,
  spunAt: number,
  extra: Partial<SelectionRead> = {},
  revealed = false,
): SelectionRead {
  return selection({
    spin: {
      id,
      spun_at: new Date(spunAt).toISOString(),
      scope: "all",
      playlist_id: null,
      origin: "device",
      revealed,
    },
    ...extra,
  });
}

/** The cover of every reel entry, top (winner) to bottom. */
function reelSongIds(): string[] {
  return [...document.querySelectorAll<HTMLImageElement>(".spinner-reel img")]
    .map((cover) => cover.getAttribute("src") ?? "")
    .map((source) => decodeURIComponent(source.split("/")[4] ?? ""));
}

const heading = () => screen.queryByRole("heading", { name: "Dancing Queen" });

test("a spun selection puts the reel where the cover is and holds the song back until it lands", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  getPlayerSelection.mockResolvedValue({
    data: { selection: spun(1, Date.now()) },
  });
  renderStage();

  expect(await screen.findByText("Spinning…")).toBeInTheDocument();
  // The reel stands in the cover's place, built from the library's covers and
  // landing on the pick.
  expect(document.querySelector(".host-selection-cover")).toBeNull();
  await waitFor(() => expect(reelSongIds().length).toBeGreaterThan(40));
  expect(reelSongIds()[0]).toBe("usdb:1");
  expect(new Set(reelSongIds())).toEqual(new Set(["usdb:1", "usdb:2"]));
  // The song is held back — out of the accessibility tree, not out of the
  // layout — and the line says what the room is watching.
  expect(heading()).toBeNull();
  expect(screen.getByText("Dancing Queen")).toHaveClass("host-selection-held");
  expect(screen.queryByText("Picking singers")).not.toBeInTheDocument();
  // The cards are along the foot the whole time.
  expect(rows()).toEqual(["Alice", "empty", "Unknown card"]);

  act(() => vi.advanceTimersByTime(REVEAL_MS));

  expect(heading()).not.toBeNull();
  expect(screen.getByText("Dancing Queen")).not.toHaveClass(
    "host-selection-held",
  );
  expect(screen.getByText("ABBA")).toBeInTheDocument();
  expect(screen.getByText("Picking singers")).toBeInTheDocument();
  expect(screen.queryByText("Spinning…")).not.toBeInTheDocument();
  // Landed: one cover, at rest.
  expect(reelSongIds()).toEqual(["usdb:1"]);
});

test("a host that comes in after the reel landed draws it settled", async () => {
  getPlayerSelection.mockResolvedValue({
    data: { selection: spun(1, Date.now() - REVEAL_MS - 1000) },
  });
  renderStage();

  await screen.findByText("Picking singers");
  expect(heading()).not.toBeNull();
  expect(screen.queryByText("Spinning…")).not.toBeInTheDocument();
  // No spin to watch: the winner alone, at rest, in the reel's frame.
  expect(reelSongIds()).toEqual(["usdb:1"]);
  expect(document.querySelector(".host-selection-reel")).not.toBeNull();
});

test("a respin runs the reel again, and so does a fresh selection's first spin", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  getPlayerSelection.mockResolvedValue({
    data: { selection: spun(1, Date.now()) },
  });
  renderStage();
  await screen.findByText("Spinning…");
  act(() => vi.advanceTimersByTime(REVEAL_MS));
  expect(heading()).not.toBeNull();

  // Somebody pressed Spin again: the same selection, spin number two.
  broadcast(
    spun(2, Date.now(), {
      song: AFRICA,
      updated_at: "2026-09-06T20:00:09.000Z",
    }),
  );
  expect(await screen.findByText("Spinning…")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Africa" })).toBeNull();
  act(() => vi.advanceTimersByTime(REVEAL_MS));
  expect(screen.getByRole("heading", { name: "Africa" })).toBeInTheDocument();

  // Later in the evening a new selection is spun. Its first spin is number
  // one again, and it has to run: the block never unmounted in between.
  broadcast(null);
  await waitFor(() =>
    expect(screen.queryByLabelText("Picking singers")).not.toBeInTheDocument(),
  );
  broadcast(
    spun(1, Date.now(), {
      opened_at: "2026-09-06T21:00:00.000Z",
      updated_at: "2026-09-06T21:00:00.000Z",
    }),
  );
  expect(await screen.findByText("Spinning…")).toBeInTheDocument();
  expect(heading()).toBeNull();
});

test("a TV that comes in mid-spin holds the song back until its own reel lands", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // The reel started on the server three seconds ago; this TV's reel starts
  // now and runs the full length from here.
  const spunAt = Date.now() - 3000;
  getPlayerSelection.mockResolvedValue({
    data: { selection: spun(1, spunAt) },
  });
  renderStage();
  await screen.findByText("Spinning…");

  // Past the server's landing moment but short of this reel's, a card lands
  // and redraws the stage. Read live, the clock would say the spin is over and
  // put the title up under a reel that is still turning.
  act(() => vi.advanceTimersByTime(REVEAL_MS - 3000 + 100));
  broadcast(
    spun(1, spunAt, {
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
  expect(heading()).toBeNull();
  expect(screen.getByText("Spinning…")).toBeInTheDocument();

  act(() => vi.advanceTimersByTime(3000));
  expect(heading()).not.toBeNull();
  expect(screen.getByText("Picking singers")).toBeInTheDocument();
});

test("a spin that landed while the stage was somebody else's is drawn settled", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  getPlayerSelection.mockResolvedValue({
    data: { selection: spun(1, Date.now()) },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const stage = (suppressed: boolean) => (
    <QueryClientProvider client={client}>
      <div className="host-page">
        <div className="host-stage">
          <HostSelection suppressed={suppressed} />
        </div>
      </div>
    </QueryClientProvider>
  );
  // The badges of the last song hold the screen while the reel spins.
  const { rerender } = render(stage(true));
  await waitFor(() => expect(getPlayerSelection).toHaveBeenCalled());
  expect(screen.queryByLabelText("Picking singers")).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(REVEAL_MS + 1000));

  rerender(stage(false));

  // Over before it was ever drawn here: the winner at rest, no replay.
  expect(await screen.findByText("Picking singers")).toBeInTheDocument();
  expect(heading()).not.toBeNull();
  expect(screen.queryByText("Spinning…")).not.toBeInTheDocument();
  expect(reelSongIds()).toEqual(["usdb:1"]);
});

test("a press in the room that showed the result cuts the reel short", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const spunAt = Date.now();
  getPlayerSelection.mockResolvedValue({
    data: { selection: spun(1, spunAt) },
  });
  renderStage();
  await screen.findByText("Spinning…");
  await waitFor(() => expect(reelSongIds().length).toBeGreaterThan(40));

  // Two seconds in, somebody pressed again: the server shows the song it has
  // (`revealed`), the same spin and the same song, and says so to the room.
  act(() => vi.advanceTimersByTime(2000));
  broadcast(spun(1, spunAt, { updated_at: "2026-09-06T20:00:09.000Z" }, true));

  // Landed here and now — the winner at rest, the song said — not three and a
  // half seconds later when the clock would have got there.
  await waitFor(() => expect(heading()).not.toBeNull());
  expect(reelSongIds()).toEqual(["usdb:1"]);
  expect(screen.getByText("Picking singers")).toBeInTheDocument();
  expect(screen.queryByText("Spinning…")).not.toBeInTheDocument();
});

test("a TV that comes in on a shown spin draws it settled", async () => {
  getPlayerSelection.mockResolvedValue({
    data: { selection: spun(1, Date.now() - 1000, {}, true) },
  });
  renderStage();

  await screen.findByText("Picking singers");
  expect(heading()).not.toBeNull();
  expect(reelSongIds()).toEqual(["usdb:1"]);
});

test("the countdown on a spun selection waits for the reel to land", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // The selector's spin with the room full: the backend aims the start past
  // the landing, and the TV says nothing about it until the covers stop.
  getPlayerSelection.mockResolvedValue({
    data: {
      selection: spun(1, Date.now(), {
        auto_start_at: new Date(Date.now() + REVEAL_MS + 3000).toISOString(),
      }),
    },
  });
  renderStage();

  await screen.findByText("Spinning…");
  expect(screen.queryByText(/^Starting in/)).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(REVEAL_MS - 100));
  expect(screen.queryByText(/^Starting in/)).not.toBeInTheDocument();

  act(() => vi.advanceTimersByTime(100));

  // The countdown takes the line's place: "Picking singers" is what it says
  // when nothing is counting, never a second line under it.
  expect(screen.queryByText("Spinning…")).not.toBeInTheDocument();
  expect(screen.queryByText("Picking singers")).not.toBeInTheDocument();
  expect(screen.getByText("Starting in 3…")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByText("Starting in 1…")).toBeInTheDocument();
});

test("a shown spin counts down at once, and a landed one too", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const spunAt = Date.now();
  getPlayerSelection.mockResolvedValue({
    data: { selection: spun(1, spunAt) },
  });
  renderStage();
  await screen.findByText("Spinning…");

  // The press that showed the song also started the countdown from now.
  broadcast(
    spun(
      1,
      spunAt,
      {
        auto_start_at: new Date(Date.now() + 3000).toISOString(),
        updated_at: "2026-09-06T20:00:09.000Z",
      },
      true,
    ),
  );

  expect(await screen.findByText("Starting in 3…")).toBeInTheDocument();
  expect(screen.queryByText("Spinning…")).not.toBeInTheDocument();

  // A respin takes it back to the reel, countdown and all, until that lands.
  broadcast(
    spun(2, Date.now(), {
      song: AFRICA,
      auto_start_at: new Date(Date.now() + REVEAL_MS + 3000).toISOString(),
      updated_at: "2026-09-06T20:00:12.000Z",
    }),
  );
  expect(await screen.findByText("Spinning…")).toBeInTheDocument();
  expect(screen.queryByText(/^Starting in/)).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(REVEAL_MS));
  expect(screen.getByText("Starting in 3…")).toBeInTheDocument();
});
