import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  PlayerRead,
  SelectionRead,
  SlotCreate,
  SongRead,
  SpinRequest,
} from "../api";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import HostSpin from "./HostSpin";
import { REVEAL_MS } from "./SongReel";

// Same seam as the player selection's tests: the real TanStack wiring runs,
// only the transport is faked.
const {
  listKaraokeSlots,
  listPlayers,
  getMe,
  openPlayerSelection,
  getPlayerSelection,
  spinPlayerSelection,
  pickPlayerSelection,
  setPlayerSelectionSlots,
  startPlayerSelection,
  getDeviceStatus,
} = vi.hoisted(() => ({
  listKaraokeSlots: vi.fn(),
  listPlayers: vi.fn(),
  getMe: vi.fn(),
  openPlayerSelection: vi.fn(),
  getPlayerSelection: vi.fn(),
  spinPlayerSelection: vi.fn(),
  pickPlayerSelection: vi.fn(),
  setPlayerSelectionSlots: vi.fn(),
  startPlayerSelection: vi.fn(),
  getDeviceStatus: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listKaraokeSlots,
  listPlayers,
  getMe,
  openPlayerSelection,
  getPlayerSelection,
  spinPlayerSelection,
  pickPlayerSelection,
  setPlayerSelectionSlots,
  startPlayerSelection,
  getDeviceStatus,
}));

function song(id: string, title: string, artist: string): SongRead {
  return {
    id,
    source: "usdb",
    title,
    artist,
    duration_seconds: 231,
    has_video: true,
    is_duet: false,
    created_at: "2026-01-01T12:00:00Z",
    language: "English",
    genre: "Pop",
    year: 1976,
    edition: null,
    creator: null,
  };
}

const QUEEN = song("usdb:1", "Dancing Queen", "ABBA");
const AFRICA = song("usdb:2", "Africa", "Toto");

function player(id: string, name: string): PlayerRead {
  return { id, name, registered: false, hidden: false, has_avatar: false };
}

const PLAYERS = [player("aaa", "Alice"), player("bbb", "Bob")];

const SLOTS = [
  { name: "blue", hex: "#048BB9" },
  { name: "red", hex: "#D00000" },
];

/** The token the fake backend hands out. It is never drawn, only sent back. */
const TOKEN = "selection-token";

/** When the fake selection was opened: its identity, never its content. */
const OPENED_AT = "2026-09-06T20:00:00.000Z";

/** The line the phone shows while the TV's reel runs. */
const WAITING = "Spinning on the host screen…";

/** Every answer is newer than the last, which is what the modal orders them by. */
let writes = 0;

function stamp(): string {
  writes += 1;
  return new Date(Date.parse(OPENED_AT) + writes * 1000).toISOString();
}

/**
 * A spun selection as the backend answers: the server's pick, the slots as
 * asked for, and the spin stamped *now* on the (faked) clock, which is what
 * the phone's reveal waits on.
 */
function spunSelection(
  winner: SongRead,
  slots: SlotCreate[] = [],
  extra: Partial<SelectionRead> = {},
  spinId = 1,
): SelectionRead {
  const asked = new Map(slots.map((slot) => [slot.color, slot.player_id]));
  return {
    song: winner,
    slots: SLOTS.map((color) => {
      const id = asked.get(color.name) ?? null;
      return {
        color: color.name,
        player: PLAYERS.find((person) => person.id === id) ?? null,
        card_uid: null,
      };
    }),
    opened_at: OPENED_AT,
    updated_at: stamp(),
    auto_start_at: null,
    spin: {
      id: spinId,
      spun_at: new Date(Date.now()).toISOString(),
      scope: "all",
      playlist_id: null,
      origin: "phone",
      revealed: false,
    },
    ...extra,
  };
}

function renderHostSpin(
  spin: SpinRequest = { scope: "all" },
  onClose = vi.fn(),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // The picker it hands over to links to /settings from its setup guide, so
  // the modal needs a router around it — the real app always has one.
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HostSpin spin={spin} onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const fetchMock = vi.fn();

/** Every `DELETE …/selection` so far: Cancel, the unmount and a closing tab
 *  all go through the one hand-written `fetch`. */
function releases(): unknown[][] {
  return fetchMock.mock.calls.filter((args) =>
    String(args[0]).startsWith("/api/v1/karaoke/selection"),
  );
}

function expectRelease(call: unknown[], token = TOKEN): void {
  expect(call[0]).toBe("/api/v1/karaoke/selection");
  expect(call[1]).toMatchObject({
    method: "DELETE",
    keepalive: true,
    headers: { "X-Selection-Token": token },
  });
}

/** The `selection.changed` broadcast, as the backend sends it. */
function broadcast(selection: SelectionRead | null): void {
  act(() => FakeSocket.deliver({ event: "selection.changed", selection }));
}

const spinAgain = () => screen.getByRole("button", { name: "Spin again" });
/** The same die while the TV's reel still runs: the press that shows the song. */
const showIt = () => screen.getByRole("button", { name: "Show it" });
const play = () => screen.getByRole("button", { name: "Play" });

/** The spun selection with its spin taken off: what `/pick` answers. */
function picked(
  winner: SongRead,
  slots: SlotCreate[] = [],
  extra: Partial<SelectionRead> = {},
): SelectionRead {
  return spunSelection(winner, slots, { spin: null, ...extra });
}

/** The modal after the room answered, still waiting on the TV's reel. */
async function opened(): Promise<void> {
  expect(await screen.findByText(WAITING)).toBeInTheDocument();
}

/** The TV's reel lands: `REVEAL_MS` after the spin, on the server's clock. */
function reelLands(): void {
  act(() => vi.advanceTimersByTime(REVEAL_MS));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  window.localStorage.clear();
  writes = 0;
  vi.stubGlobal("WebSocket", FakeSocket);
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error("no network in tests"));
  vi.stubGlobal("fetch", fetchMock);
  listKaraokeSlots.mockResolvedValue({
    data: { slots: SLOTS, player_counts: [1, 2] },
  });
  listPlayers.mockResolvedValue({ data: { players: PLAYERS } });
  getMe.mockRejectedValue(new Error("no /auth/me in this test"));
  openPlayerSelection.mockReset();
  openPlayerSelection.mockImplementation(
    async (options: { body: { slots?: SlotCreate[] } }) => ({
      data: {
        selection: spunSelection(QUEEN, options.body.slots),
        token: TOKEN,
      },
    }),
  );
  spinPlayerSelection.mockReset();
  spinPlayerSelection.mockImplementation(async () => ({
    data: spunSelection(AFRICA, [], {}, 2),
  }));
  pickPlayerSelection.mockReset();
  pickPlayerSelection.mockImplementation(async () => ({
    data: picked(QUEEN),
  }));
  setPlayerSelectionSlots.mockReset();
  startPlayerSelection.mockReset();
  getDeviceStatus.mockResolvedValue({ data: { online: false } });
  getPlayerSelection.mockReset();
  getPlayerSelection.mockResolvedValue({ data: { selection: null } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("it opens the room's selection with a spin and waits for the TV's reel", async () => {
  renderHostSpin({ scope: "wishlist" });
  await opened();

  // The server picks: no song id, the scope instead, and nobody remembered.
  expect(openPlayerSelection.mock.calls[0][0].body).toEqual({
    spin: { scope: "wishlist" },
    slots: [],
  });
  // The pick is not said until the reel on the TV has landed on it. The die
  // is live meanwhile — it is the press that shows the song — and Play waits.
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();
  expect(screen.getByText(WAITING)).toHaveAttribute("role", "status");
  expect(showIt()).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Spin again" })).toBeNull();
  expect(play()).toBeDisabled();

  act(() => vi.advanceTimersByTime(REVEAL_MS - 100));
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();

  act(() => vi.advanceTimersByTime(100));
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.getByText("ABBA")).toBeInTheDocument();
  expect(screen.queryByText(WAITING)).not.toBeInTheDocument();
  expect(spinAgain()).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Show it" })).toBeNull();
  expect(play()).toBeEnabled();
});

test("a press while the TV spins shows the song at once, the same one", async () => {
  renderHostSpin();
  await opened();
  // The server answers the spin it has, revealed, and not another one.
  spinPlayerSelection.mockImplementationOnce(async () => ({
    data: spunSelection(QUEEN, [], {
      spin: {
        id: 1,
        spun_at: new Date(Date.now() - 2000).toISOString(),
        scope: "all",
        playlist_id: null,
        origin: "phone",
        revealed: true,
      },
    }),
  }));

  act(() => vi.advanceTimersByTime(2000));
  fireEvent.click(showIt());

  // The same route as a respin, the token in its header: the server decides
  // what the press means, this phone's clock does not.
  await waitFor(() => expect(spinPlayerSelection).toHaveBeenCalledTimes(1));
  expect(spinPlayerSelection.mock.calls[0][0].headers).toEqual({
    "X-Selection-Token": TOKEN,
  });
  // Revealed on the answer, three and a half seconds before the clock would
  // have got there: the cover, the words, the live region, and the die at rest
  // and named for what it does from here on.
  expect(await screen.findByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.getByText("ABBA")).toBeInTheDocument();
  expect(screen.queryByText(WAITING)).not.toBeInTheDocument();
  const tile = document.querySelector(".host-spin-tile");
  expect(tile?.querySelector(".spinner-cover-logo")).toBeNull();
  expect(tile?.querySelector("img")).toHaveClass("host-spin-cover-revealed");
  expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(
    "Dancing Queen by ABBA",
  );
  expect(spinAgain()).toBeEnabled();
  expect(spinAgain()).not.toHaveClass("spinner-spin-running");
  expect(play()).toBeEnabled();

  // The clock's own moment passing later changes nothing.
  act(() => vi.advanceTimersByTime(REVEAL_MS));
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(spinPlayerSelection).toHaveBeenCalledTimes(1);
});

test("the room's own press that showed the song is read off the broadcast", async () => {
  renderHostSpin();
  await opened();

  // The selector's start button landed the reel: the same spin, revealed.
  broadcast(
    spunSelection(QUEEN, [], {
      spin: {
        id: 1,
        spun_at: new Date(Date.now()).toISOString(),
        scope: "all",
        playlist_id: null,
        origin: "phone",
        revealed: true,
      },
    }),
  );

  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.queryByText(WAITING)).not.toBeInTheDocument();
  expect(spinAgain()).toBeEnabled();
});

test("the reel's empty tile stands in for the cover until the reveal, and the die rolls meanwhile", async () => {
  renderHostSpin();
  await opened();

  // No spoiler: the reel's empty window lies over the tile. The cover is
  // under it, loading, so the reveal never pops from black to artwork.
  const tile = document.querySelector(".host-spin-tile");
  expect(tile).not.toBeNull();
  expect(tile?.querySelector(".spinner-cover-logo")).not.toBeNull();
  expect(tile?.querySelector("img")).not.toHaveClass(
    "host-spin-cover-revealed",
  );
  // The primary is the gradient die, lit and rolling while the TV's reel
  // runs, and live: a press now is the one that shows the song.
  expect(showIt()).toHaveClass("spinner-spin", "spinner-spin-running");
  expect(showIt()).toBeEnabled();
  const die = () => iconNames(showIt())[0];
  expect(die()).toMatch(/^dice(-[1-6])?$/);
  const seen = new Set<string>();
  for (let step = 0; step < 6; step += 1) {
    act(() => vi.advanceTimersByTime(150));
    seen.add(die());
  }
  expect(seen.size).toBeGreaterThan(1);
  // The words are silent about the song, and the live region is there, empty,
  // waiting to be filled.
  const live = document.querySelector('[aria-live="polite"]');
  expect(live).toHaveTextContent("");

  act(() => vi.advanceTimersByTime(REVEAL_MS));

  // The cover takes the tile, the die comes to rest, the region says the song.
  expect(tile?.querySelector(".spinner-cover-logo")).toBeNull();
  expect(tile?.querySelector("img")).toHaveAttribute(
    "src",
    "/api/v1/songs/usdb%3A1/cover",
  );
  expect(spinAgain()).not.toHaveClass("spinner-spin-running");
  expect(spinAgain()).toBeEnabled();
  expect(live).toHaveTextContent("Dancing Queen by ABBA");
  // Largest first, Cancel quiet at the foot.
  const actions = within(
    document.querySelector<HTMLElement>(".host-spin-actions") as HTMLElement,
  ).getAllByRole("button");
  expect(actions.map((button) => button.textContent)).toEqual([
    "Spin again",
    "Play",
    "Cancel",
  ]);
  expect(actions[1]).toHaveClass("button-primary");
});

test("a playlist's reel spins that playlist on the host", async () => {
  renderHostSpin({ scope: "playlist", playlist_id: "p1" });
  await opened();

  expect(openPlayerSelection.mock.calls[0][0].body.spin).toEqual({
    scope: "playlist",
    playlist_id: "p1",
  });
});

test("the remembered group rides along, so Play lands on the same board", async () => {
  window.localStorage.setItem(
    "wingman.playerSlots",
    JSON.stringify({ red: "bbb", green: "aaa" }),
  );
  renderHostSpin();
  await opened();

  // Filtered against the room first: green is not a configured slot.
  expect(openPlayerSelection.mock.calls[0][0].body.slots).toEqual([
    { color: "red", player_id: "bbb" },
  ]);
});

test("a host that already landed is revealed at once", async () => {
  openPlayerSelection.mockImplementation(async () => ({
    data: {
      selection: spunSelection(QUEEN, [], {
        spin: {
          id: 1,
          spun_at: new Date(Date.now() - REVEAL_MS - 1000).toISOString(),
          scope: "all",
          playlist_id: null,
          origin: "phone",
          revealed: false,
        },
      }),
      token: TOKEN,
    },
  }));
  renderHostSpin();

  expect(await screen.findByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.queryByText(WAITING)).not.toBeInTheDocument();
});

test("spin again asks for another song with the token, and waits again", async () => {
  renderHostSpin();
  await opened();
  reelLands();
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();

  fireEvent.click(spinAgain());

  await waitFor(() => expect(spinPlayerSelection).toHaveBeenCalledTimes(1));
  // The token rides in the header, like the DELETE's does.
  expect(spinPlayerSelection.mock.calls[0][0].headers).toEqual({
    "X-Selection-Token": TOKEN,
  });
  // A new spin: the TV's reel runs again, and so does the wait here — with
  // the die back to being the press that shows the song.
  expect(await screen.findByText(WAITING)).toBeInTheDocument();
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();
  expect(showIt()).toBeEnabled();

  reelLands();
  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.getByText("Toto")).toBeInTheDocument();
});

test("a respin from the room restarts the wait too", async () => {
  renderHostSpin();
  await opened();
  reelLands();
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();

  // The selector's start button spun the reel again: the same selection, a
  // new spin on it.
  broadcast(spunSelection(AFRICA, [], {}, 2));

  expect(screen.getByText(WAITING)).toBeInTheDocument();
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();

  reelLands();
  expect(screen.getByText("Africa")).toBeInTheDocument();
});

test("a card that lands is kept for the hand-over", async () => {
  renderHostSpin();
  await opened();
  reelLands();

  // The same spin, landed a while ago: a card changes the slots, not the song.
  const withBob = [
    { color: "blue", player: PLAYERS[1], card_uid: "A1B2C3D4" },
    { color: "red", player: null, card_uid: null },
  ];
  broadcast(
    spunSelection(QUEEN, [], {
      slots: withBob,
      spin: {
        id: 1,
        spun_at: new Date(Date.now() - REVEAL_MS).toISOString(),
        scope: "all",
        playlist_id: null,
        origin: "phone",
        revealed: false,
      },
    }),
  );
  // The server keeps the slots across `/pick` too, and its answer is what the
  // picker is handed.
  pickPlayerSelection.mockImplementationOnce(async () => ({
    data: picked(QUEEN, [], { slots: withBob }),
  }));
  expect(play()).toBeEnabled();
  fireEvent.click(play());

  // The picker opens on the selection as the room has it now: Bob on blue.
  expect(
    await screen.findByRole("button", {
      name: "Slot blue: Bob, held by a card",
    }),
  ).toBeInTheDocument();
});

test("play moves the room on to its singers first, then hands the selection on without giving it back", async () => {
  const onClose = vi.fn();
  renderHostSpin({ scope: "all" }, onClose);
  await opened();
  reelLands();

  fireEvent.click(play());

  // `/pick` with the token: the spin comes off the selection on the server, so
  // the TV shows the picking screen, and the answer is what the picker gets.
  await waitFor(() => expect(pickPlayerSelection).toHaveBeenCalledTimes(1));
  expect(pickPlayerSelection.mock.calls[0][0].headers).toEqual({
    "X-Selection-Token": TOKEN,
  });
  // The picker, over the same song, and no second open: the selection is
  // open already and the token went with it.
  const picker = await screen.findByRole("dialog", {
    name: "Player selection",
  });
  expect(picker).toHaveTextContent("Dancing Queen");
  expect(
    screen.queryByRole("dialog", { name: "Spin on the host screen" }),
  ).not.toBeInTheDocument();
  expect(openPlayerSelection).toHaveBeenCalledTimes(1);
  expect(releases()).toHaveLength(0);

  // From here on the picker owns the token: its Cancel gives the room back,
  // once, and closing it closes the whole thing.
  fireEvent.click(within(picker).getByRole("button", { name: "Cancel" }));

  await waitFor(() => expect(releases()).toHaveLength(1));
  expectRelease(releases()[0]);
  expect(onClose).toHaveBeenCalled();
});

test("the broadcast of /pick overtaking its answer does not put the wait back up", async () => {
  let answer: (value: { data: SelectionRead }) => void = () => {};
  pickPlayerSelection.mockImplementationOnce(
    () =>
      new Promise<{ data: SelectionRead }>((resolve) => {
        answer = resolve;
      }),
  );
  renderHostSpin();
  await opened();
  reelLands();

  fireEvent.click(play());
  await waitFor(() => expect(pickPlayerSelection).toHaveBeenCalledTimes(1));

  // The room hears that the spin came off the selection before this phone's
  // own answer lands. A picked song has nothing left to wait on: the cover
  // and the words stay up, and the die is not the press that shows anything.
  broadcast(picked(QUEEN));

  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.queryByText(WAITING)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Show it" })).toBeNull();
  expect(document.querySelector(".spinner-cover-logo")).toBeNull();
  expect(spinAgain()).toBeDisabled();

  await act(async () => {
    answer({ data: picked(QUEEN) });
  });
  expect(
    await screen.findByRole("dialog", { name: "Player selection" }),
  ).toBeInTheDocument();
  expect(releases()).toHaveLength(0);
});

test.each([
  ["no_selection", "the selection is gone"],
  ["not_the_opener", "the token is not the opener's"],
])(
  "a refused /pick (%s: %s) keeps the phone on the spin view",
  async (detail) => {
    pickPlayerSelection.mockRejectedValueOnce({ detail });
    renderHostSpin();
    await opened();
    reelLands();

    fireEvent.click(play());

    // Lost, in the words the lost state has, and no picker: nothing was handed
    // on, and the dead token is not given back either.
    await waitFor(() => expect(pickPlayerSelection).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText("Somebody else took over the selection."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Player selection" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    expect(screen.getByRole("button", { name: "Spin again" })).toBeEnabled();
    expect(releases()).toHaveLength(0);
  },
);

test("a /pick refused for another reason is a sentence, and the song stays up", async () => {
  pickPlayerSelection.mockRejectedValueOnce({ detail: "not_a_spin" });
  renderHostSpin();
  await opened();
  reelLands();

  fireEvent.click(play());

  expect(await screen.findByRole("alert")).toHaveTextContent("not_a_spin");
  expect(
    screen.queryByRole("dialog", { name: "Player selection" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(play()).toBeEnabled();
});

test("cancel gives the room's selection back, once", async () => {
  const onClose = vi.fn();
  const { unmount } = renderHostSpin({ scope: "all" }, onClose);
  await opened();

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  await waitFor(() => expect(releases()).toHaveLength(1));
  expectRelease(releases()[0]);
  expect(onClose).toHaveBeenCalled();

  unmount();
  expect(releases()).toHaveLength(1);
});

test("a modal that simply goes away gives it back too", async () => {
  const { unmount } = renderHostSpin();
  await opened();

  unmount();

  await waitFor(() => expect(releases()).toHaveLength(1));
  expectRelease(releases()[0]);
});

test("somebody else picking singers is named, and can be taken over", async () => {
  openPlayerSelection.mockRejectedValueOnce({ detail: "selection_open" });
  getPlayerSelection.mockResolvedValue({
    data: { selection: spunSelection(AFRICA) },
  });
  renderHostSpin({ scope: "weighted" });

  expect(
    await screen.findByText(/Somebody is picking singers for/),
  ).toHaveTextContent("Somebody is picking singers for Africa.");
  expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Spin again" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Take over" }));
  const confirm = await screen.findByRole("dialog", {
    name: "Take over the selection",
  });
  expect(confirm).toHaveTextContent("loses their singers");
  fireEvent.click(within(confirm).getByRole("button", { name: "Take over" }));

  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalledTimes(2));
  // The same spin, forced this time.
  expect(openPlayerSelection.mock.calls[1][0].body).toEqual({
    spin: { scope: "weighted" },
    slots: [],
    force: true,
  });
  await opened();
});

test("an empty pool is said in the reel's words, with only Cancel left", async () => {
  openPlayerSelection.mockRejectedValueOnce({ detail: "empty_pool" });
  renderHostSpin({ scope: "wishlist" });

  expect(
    await screen.findByText(
      "The wishlist is empty. The reel has nothing to land on.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Spin again" })).toBeNull();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  // Nothing was opened, so there is nothing to give back.
  expect(releases()).toHaveLength(0);
});

test("a pool that runs dry on a respin keeps the song that is up", async () => {
  spinPlayerSelection.mockRejectedValueOnce({ detail: "empty_pool" });
  renderHostSpin({ scope: "playlist", playlist_id: "p1" });
  await opened();
  reelLands();

  fireEvent.click(spinAgain());

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This playlist is empty. The reel has nothing to land on.",
  );
  // The selection stands with its song, and Play is still the way on.
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(play()).toBeEnabled();
});

test("a selection taken away says so and offers a fresh spin", async () => {
  renderHostSpin();
  await opened();
  reelLands();

  broadcast(null);

  expect(
    screen.getByText("Somebody else took over the selection."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Spin again" }));

  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalledTimes(2));
  expect(openPlayerSelection.mock.calls[1][0].body).toEqual({
    spin: { scope: "all" },
    slots: [],
    force: false,
  });
  await opened();
  // The dead token is never sent back: losing the selection is not closing it.
  expect(releases()).toHaveLength(0);
});

test("a selection replaced by another one is treated as taken away", async () => {
  renderHostSpin();
  await opened();

  // A take-over is a *new* selection, so the broadcast carries one — with
  // another `opened_at`, which is the only thing that tells them apart.
  broadcast(
    spunSelection(AFRICA, [], { opened_at: "2026-09-06T20:05:00.000Z" }),
  );

  expect(
    screen.getByText("Somebody else took over the selection."),
  ).toBeInTheDocument();
  expect(screen.queryByText(WAITING)).not.toBeInTheDocument();
});

test("a spin that lands after cancel is given straight back", async () => {
  let land: (() => void) | null = null;
  openPlayerSelection.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      land = resolve;
    });
    return { data: { selection: spunSelection(QUEEN), token: TOKEN } };
  });
  renderHostSpin();
  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalled());

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await act(async () => {
    land?.();
  });

  await waitFor(() => expect(releases()).toHaveLength(1));
  expectRelease(releases()[0]);
});
