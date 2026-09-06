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
  SelectionSlotRead,
  SlotCreate,
  SongRead,
} from "../api";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import PlayerSelection from "./PlayerSelection";
import SongDetails from "./SongDetails";

// Same seam as the songs tests: the real TanStack wiring runs, only the
// transport is faked.
const {
  listKaraokeSlots,
  listPlayers,
  createPlayer,
  getMe,
  openPlayerSelection,
  getPlayerSelection,
  setPlayerSelectionSlots,
  startPlayerSelection,
  getDeviceStatus,
} = vi.hoisted(() => ({
  listKaraokeSlots: vi.fn(),
  listPlayers: vi.fn(),
  createPlayer: vi.fn(),
  getMe: vi.fn(),
  openPlayerSelection: vi.fn(),
  getPlayerSelection: vi.fn(),
  setPlayerSelectionSlots: vi.fn(),
  startPlayerSelection: vi.fn(),
  getDeviceStatus: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listKaraokeSlots,
  listPlayers,
  createPlayer,
  getMe,
  openPlayerSelection,
  getPlayerSelection,
  setPlayerSelectionSlots,
  startPlayerSelection,
  getDeviceStatus,
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

function player(id: string, name: string, hidden = false): PlayerRead {
  return { id, name, registered: false, hidden, has_avatar: false };
}

const PLAYERS = [player("aaa", "Alice"), player("bbb", "Bob")];

/** The line a tap on a slot a card holds is answered with. */
const HELD = "That slot is held by a card on the player selector.";

/** The token the fake backend hands out. It is never drawn, only sent back. */
const TOKEN = "selection-token";

/** When the fake selection was opened: its identity, never its content. */
const OPENED_AT = "2026-09-06T20:00:00.000Z";

/**
 * A roster long enough to trip the filter threshold, with the two traps a
 * substring filter has to survive: a shared prefix and a match that is not at
 * the start of the name.
 */
function manyPlayers(count: number): PlayerRead[] {
  const named = [
    player("p1", "Anna"),
    player("p2", "Annalena"),
    player("p3", "Hannah"),
    player("p4", "Bob"),
  ];
  const filler = Array.from({ length: count - named.length }, (_, index) =>
    player(`f${index}`, `Filler ${index}`),
  );
  return [...named, ...filler];
}

/** The roster grid — the region that scrolls, so every button must be in it. */
function grid(): HTMLElement {
  const element = document.querySelector(".player-selection-players");
  if (element === null) throw new Error("no roster grid");
  return element as HTMLElement;
}

// Three configured slots: the component must render whatever the backend's
// slot configuration says, in that order, and never a hardcoded list.
const SLOTS = [
  { name: "blue", hex: "#048BB9" },
  { name: "red", hex: "#D00000" },
  { name: "green", hex: "#00AC00" },
];

/** Whoever `listPlayers` is answering with right now, so the fake can look ids up. */
let roster: PlayerRead[] = PLAYERS;

function setRoster(players: PlayerRead[]): void {
  roster = players;
  listPlayers.mockResolvedValue({ data: { players } });
}

/** Every answer is newer than the last, which is what the modal orders them by. */
let writes = 0;

function stamp(): string {
  writes += 1;
  return new Date(Date.parse(OPENED_AT) + writes * 1000).toISOString();
}

/**
 * The backend's answer to a body: the host's configured slots with whoever was
 * asked for on them. An echo, so a test asserts on what the modal drew rather
 * than on what it hoped the modal remembered.
 */
function selectionFrom(
  slots: SlotCreate[] | undefined,
  extra: Partial<SelectionRead> = {},
): SelectionRead {
  const asked = new Map(
    (slots ?? []).map((slot) => [slot.color, slot.player_id]),
  );
  return {
    song: SONG,
    slots: SLOTS.map((color): SelectionSlotRead => {
      const id = asked.get(color.name) ?? null;
      return {
        color: color.name,
        player: roster.find((person) => person.id === id) ?? null,
        card_uid: null,
      };
    }),
    opened_at: OPENED_AT,
    updated_at: stamp(),
    auto_start_at: null,
    ...extra,
  };
}

/** A selection the way the event bus carries it: the read model, no token. */
function selectionWith(
  slots: SelectionSlotRead[],
  extra: Partial<SelectionRead> = {},
): SelectionRead {
  return {
    song: SONG,
    slots,
    opened_at: OPENED_AT,
    updated_at: stamp(),
    auto_start_at: null,
    ...extra,
  };
}

function renderSelection(onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // The setup guide links to /settings, so the selection needs a router around
  // it — the real app always has one.
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PlayerSelection song={SONG} onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The token the host spin hands on with its selection. */
const ADOPTED_TOKEN = "handed-on-token";

/**
 * The picker over a selection somebody else opened — the host spin's, once its
 * song is picked: no request opens anything, the token came with the props.
 */
function renderAdopted(selection: SelectionRead, onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PlayerSelection
          song={selection.song}
          onClose={onClose}
          adopt={{ selection, token: ADOPTED_TOKEN }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function slot(color: string) {
  return screen.getByRole("button", { name: new RegExp(`^Slot ${color}:`) });
}

/** The body of the nth `PUT …/slots`, as colors and player ids. */
function putBody(index: number): SlotCreate[] {
  return setPlayerSelectionSlots.mock.calls[index][0].body.slots;
}

const fetchMock = vi.fn();

/** Every `DELETE …/selection` this modal has made so far. Cancel, the unmount
 *  and a closing tab all go through the one hand-written `fetch`. */
function releases(): unknown[][] {
  return fetchMock.mock.calls.filter((args) =>
    String(args[0]).startsWith("/api/v1/karaoke/selection"),
  );
}

/** What every close has to look like: the token in the header and nowhere else. */
function expectRelease(call: unknown[], token = TOKEN): void {
  // No query at all: a token in the URL lands in an access log.
  expect(call[0]).toBe("/api/v1/karaoke/selection");
  expect(call[1]).toMatchObject({
    method: "DELETE",
    keepalive: true,
    headers: { "X-Selection-Token": token },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  writes = 0;
  // The song details subscribe to wishlist events: no test opens a real socket.
  vi.stubGlobal("WebSocket", FakeSocket);
  // The unmount close is a plain `fetch`; nothing in a test may reach a network.
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error("no network in tests"));
  vi.stubGlobal("fetch", fetchMock);
  listKaraokeSlots.mockResolvedValue({
    data: { slots: SLOTS, player_counts: [1, 2, 3, 4, 6] },
  });
  setRoster(PLAYERS);
  // Unanswered by default, which is what `useAuth` reads as "allow": every test
  // that does not care about a right sees the same component the host does.
  getMe.mockRejectedValue(new Error("no /auth/me in this test"));
  openPlayerSelection.mockReset();
  openPlayerSelection.mockImplementation(
    async (options: { body: { slots?: SlotCreate[] } }) => ({
      data: { selection: selectionFrom(options.body.slots), token: TOKEN },
    }),
  );
  setPlayerSelectionSlots.mockReset();
  setPlayerSelectionSlots.mockImplementation(
    async (options: { body: { slots?: SlotCreate[] } }) => ({
      data: selectionFrom(options.body.slots),
    }),
  );
  startPlayerSelection.mockReset();
  startPlayerSelection.mockResolvedValue({ data: {} });
  // No player selector in the room unless a test puts one there.
  getDeviceStatus.mockReset();
  getDeviceStatus.mockResolvedValue({ data: { online: false } });
  getPlayerSelection.mockReset();
  getPlayerSelection.mockResolvedValue({ data: { selection: null } });
  createPlayer.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

/** The `selection.changed` broadcast, as the backend sends it. */
function broadcast(selection: SelectionRead | null): void {
  act(() => FakeSocket.deliver({ event: "selection.changed", selection }));
}

test("one slot per configured color, in the backend's order", async () => {
  renderSelection();

  const slots = await screen.findAllByRole("button", { name: /^Slot / });
  expect(slots.map((element) => element.getAttribute("aria-label"))).toEqual([
    "Slot blue: empty",
    "Slot red: empty",
    "Slot green: empty",
  ]);
  expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
  // Nothing was remembered, so the room's selection opens empty.
  expect(openPlayerSelection.mock.calls[0][0].body).toEqual({
    song_id: "usdb:1",
    slots: [],
  });
});

test("the remembered assignment opens the selection", async () => {
  window.localStorage.setItem(
    "wingman.playerSlots",
    JSON.stringify({ red: "bbb" }),
  );
  renderSelection();

  await waitFor(() =>
    expect(openPlayerSelection.mock.calls[0][0].body.slots).toEqual([
      { color: "red", player_id: "bbb" },
    ]),
  );
  // And what is drawn is the answer, not the request.
  expect(
    await screen.findByRole("button", { name: "Slot red: Bob" }),
  ).toBeInTheDocument();
});

test("tapping a slot and then a player writes it and draws the answer", async () => {
  renderSelection();
  await screen.findByRole("button", { name: "Slot red: empty" });

  fireEvent.click(slot("red"));
  fireEvent.click(screen.getByRole("button", { name: "Bob" }));

  await waitFor(() => expect(setPlayerSelectionSlots).toHaveBeenCalledTimes(1));
  expect(setPlayerSelectionSlots.mock.calls[0][0].body.token).toBe(TOKEN);
  expect(putBody(0)).toEqual([{ color: "red", player_id: "bbb" }]);
  expect(slot("red")).toHaveAccessibleName("Slot red: Bob");
  expect(slot("blue")).toHaveAccessibleName("Slot blue: empty");
  expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();

  // Tapping the slot's clear button frees it again.
  fireEvent.click(screen.getByRole("button", { name: "Clear slot red" }));
  await waitFor(() =>
    expect(slot("red")).toHaveAccessibleName("Slot red: empty"),
  );
  expect(putBody(1)).toEqual([]);
});

test("without an active slot a player lands on the first free one", async () => {
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  await waitFor(() =>
    expect(slot("blue")).toHaveAccessibleName("Slot blue: Alice"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Bob" }));
  await waitFor(() =>
    expect(slot("red")).toHaveAccessibleName("Slot red: Bob"),
  );
});

test("two taps inside one round trip are sent in order, and both land", async () => {
  let release: (() => void) | null = null;
  setPlayerSelectionSlots.mockImplementationOnce(
    async (options: { body: { slots?: SlotCreate[] } }) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { data: selectionFrom(options.body.slots) };
    },
  );
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  await waitFor(() => expect(setPlayerSelectionSlots).toHaveBeenCalledTimes(1));
  // The second tap has nowhere to go yet: one write is in flight.
  fireEvent.click(screen.getByRole("button", { name: "Bob" }));
  expect(setPlayerSelectionSlots).toHaveBeenCalledTimes(1);

  await act(async () => {
    release?.();
  });

  await waitFor(() => expect(setPlayerSelectionSlots).toHaveBeenCalledTimes(2));
  // Composed, not overwritten: Bob is added to Alice rather than replacing her.
  expect(putBody(1)).toEqual([
    { color: "blue", player_id: "aaa" },
    { color: "red", player_id: "bbb" },
  ]);
});

test("a slot the device filled redraws without a tap", async () => {
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  broadcast(
    selectionWith([
      { color: "blue", player: null, card_uid: null },
      { color: "red", player: PLAYERS[1], card_uid: "A1B2C3D4" },
      { color: "green", player: null, card_uid: null },
    ]),
  );

  // The card that put him there is said as well as drawn, and the slot the
  // card holds has no clear button.
  expect(slot("red")).toHaveAccessibleName("Slot red: Bob, held by a card");
  expect(
    screen.queryByRole("button", { name: "Clear slot red" }),
  ).not.toBeInTheDocument();
  expect(setPlayerSelectionSlots).not.toHaveBeenCalled();
});

test("a card nobody owns says so on its slot", async () => {
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  broadcast(
    selectionWith([
      { color: "blue", player: null, card_uid: "A1B2C3D4" },
      { color: "red", player: null, card_uid: null },
      { color: "green", player: null, card_uid: null },
    ]),
  );

  expect(slot("blue")).toHaveAccessibleName("Slot blue: Unknown card");
  // Nobody stands on it, so it is not somebody the song can be played with.
  expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Clear slot blue" }),
  ).not.toBeInTheDocument();
});

/** A selection with one card lying on the blue slot's reader. */
function withCardOnBlue(player: PlayerRead | null): SelectionRead {
  return selectionWith([
    { color: "blue", player, card_uid: "A1B2C3D4" },
    { color: "red", player: null, card_uid: null },
    { color: "green", player: null, card_uid: null },
  ]);
}

test("a slot a card holds cannot be cleared or picked", async () => {
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  broadcast(withCardOnBlue(PLAYERS[1]));

  // The card decides who stands there, so there is nothing to clear and nothing
  // to point somewhere else.
  expect(
    screen.queryByRole("button", { name: "Clear slot blue" }),
  ).not.toBeInTheDocument();
  expect(slot("blue")).toHaveAttribute("aria-disabled", "true");

  fireEvent.click(slot("blue"));

  expect(slot("blue")).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByText(HELD)).toBeInTheDocument();
  // Said, not only drawn: the slot list is above the roster and out of view.
  expect(screen.getByText(HELD)).toHaveAttribute("role", "status");

  // The next tap that does something puts the ordinary line back.
  fireEvent.click(slot("red"));
  expect(screen.queryByText(HELD)).not.toBeInTheDocument();
});

test("a tap on a player skips the slot a card holds", async () => {
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  // An unknown card on blue: nobody stands there, and the next free slot is
  // still not blue.
  broadcast(withCardOnBlue(null));
  fireEvent.click(screen.getByRole("button", { name: "Alice" }));

  await waitFor(() => expect(setPlayerSelectionSlots).toHaveBeenCalledTimes(1));
  expect(putBody(0)).toEqual([{ color: "red", player_id: "aaa" }]);
});

test("the slot a card holds is sent back unchanged", async () => {
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  broadcast(withCardOnBlue(PLAYERS[1]));
  fireEvent.click(screen.getByRole("button", { name: "Alice" }));

  // Bob rides along in the body: the backend keeps the card on a slot the phone
  // sends back as his, and drops it the moment the phone leaves him out.
  await waitFor(() => expect(setPlayerSelectionSlots).toHaveBeenCalledTimes(1));
  expect(putBody(0)).toEqual([
    { color: "blue", player_id: "bbb" },
    { color: "red", player_id: "aaa" },
  ]);
});

test("a card that lands mid-write rides along in the tap that follows", async () => {
  setRoster([...PLAYERS, player("ccc", "Cara")]);
  let release: (() => void) | null = null;
  setPlayerSelectionSlots.mockImplementationOnce(
    async (options: { body: { slots?: SlotCreate[] } }) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { data: selectionFrom(options.body.slots) };
    },
  );
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  await waitFor(() => expect(setPlayerSelectionSlots).toHaveBeenCalledTimes(1));

  // A card lands on red while that write is still in flight. The next tap is
  // computed from what this phone asked for last, which knows nothing of it.
  broadcast(
    selectionWith([
      { color: "blue", player: PLAYERS[0], card_uid: null },
      { color: "red", player: PLAYERS[1], card_uid: "A1B2C3D4" },
      { color: "green", player: null, card_uid: null },
    ]),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cara" }));

  await act(async () => {
    release?.();
  });

  // Bob is in the body: a slot left out of one is how the backend is told the
  // card is gone, and the room would lose the singer their card put there.
  await waitFor(() => expect(setPlayerSelectionSlots).toHaveBeenCalledTimes(2));
  expect(putBody(1)).toEqual([
    { color: "blue", player_id: "aaa" },
    { color: "red", player_id: "bbb" },
    { color: "green", player_id: "ccc" },
  ]);
});

test("a singer their card put on a slot is not taken off by a tap", async () => {
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  broadcast(withCardOnBlue(PLAYERS[1]));
  fireEvent.click(screen.getByRole("button", { name: "Bob" }));

  expect(screen.getByText(HELD)).toBeInTheDocument();
  expect(setPlayerSelectionSlots).not.toHaveBeenCalled();
  expect(slot("blue")).toHaveAccessibleName("Slot blue: Bob, held by a card");
});

test("an older broadcast never overwrites a newer answer", async () => {
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  const stale = selectionWith([
    { color: "blue", player: null, card_uid: null },
    { color: "red", player: null, card_uid: null },
    { color: "green", player: null, card_uid: null },
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  await waitFor(() =>
    expect(slot("blue")).toHaveAccessibleName("Slot blue: Alice"),
  );

  broadcast(stale);

  expect(slot("blue")).toHaveAccessibleName("Slot blue: Alice");
});

test("play starts the selection with its token and remembers the group", async () => {
  const onClose = vi.fn();
  renderSelection(onClose);
  await screen.findByRole("button", { name: "Slot green: empty" });

  fireEvent.click(slot("green"));
  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  await waitFor(() =>
    expect(slot("green")).toHaveAccessibleName("Slot green: Alice"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Play" }));

  await waitFor(() => expect(startPlayerSelection).toHaveBeenCalledTimes(1));
  expect(startPlayerSelection.mock.calls[0][0].body).toEqual({
    token: TOKEN,
    force: false,
  });
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(
    JSON.parse(window.localStorage.getItem("wingman.playerSlots") ?? "{}"),
  ).toEqual({ green: "aaa" });
});

test("a song already playing is replaced only after confirmation", async () => {
  startPlayerSelection.mockRejectedValueOnce({ detail: "already_playing" });
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  await waitFor(() =>
    expect(slot("blue")).toHaveAccessibleName("Slot blue: Alice"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Play" }));

  const confirm = await screen.findByRole("dialog", {
    name: "Already playing",
  });
  expect(confirm).toHaveTextContent("Another song is playing");
  expect(startPlayerSelection).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: "Replace" }));

  await waitFor(() => expect(startPlayerSelection).toHaveBeenCalledTimes(2));
  expect(startPlayerSelection.mock.calls[1][0].body).toEqual({
    token: TOKEN,
    force: true,
  });
});

test("cancelling the replace prompt does not start the song", async () => {
  startPlayerSelection.mockRejectedValueOnce({ detail: "already_playing" });
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  await waitFor(() =>
    expect(slot("blue")).toHaveAccessibleName("Slot blue: Alice"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  // The selection itself also has a Cancel button, so scope to the prompt.
  const confirm = await screen.findByRole("dialog", {
    name: "Already playing",
  });
  fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

  expect(
    screen.queryByRole("dialog", { name: "Already playing" }),
  ).not.toBeInTheDocument();
  expect(startPlayerSelection).toHaveBeenCalledTimes(1);
});

test("an unconfigured USDX opens the setup guide instead of an error", async () => {
  startPlayerSelection.mockRejectedValueOnce({
    detail: {
      error: "usdx_not_configured",
      problems: ["'songs.directory' is not set"],
    },
  });
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  await waitFor(() =>
    expect(slot("blue")).toHaveAccessibleName("Slot blue: Alice"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Play" }));

  const guide = await screen.findByRole("dialog", {
    name: "Ultrastar Deluxe is not set up",
  });
  expect(guide).toHaveTextContent(/does not know where your songs are/);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("any other failure is still a plain notice", async () => {
  startPlayerSelection.mockRejectedValueOnce({ detail: "launch_failed" });
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  await waitFor(() =>
    expect(slot("blue")).toHaveAccessibleName("Slot blue: Alice"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Play" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("launch_failed");
  expect(
    screen.queryByRole("dialog", { name: "Ultrastar Deluxe is not set up" }),
  ).not.toBeInTheDocument();
});

test("the automatic start counts down under the slots", async () => {
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  broadcast(
    selectionWith(
      [
        { color: "blue", player: PLAYERS[0], card_uid: "A1B2C3D4" },
        { color: "red", player: null, card_uid: null },
        { color: "green", player: null, card_uid: null },
      ],
      { auto_start_at: new Date(Date.now() + 3000).toISOString() },
    ),
  );

  expect(await screen.findByText(/^Starting in \d…$/)).toBeInTheDocument();

  // The countdown ends with the selection it belongs to.
  broadcast(
    selectionWith([
      { color: "blue", player: PLAYERS[0], card_uid: "A1B2C3D4" },
      { color: "red", player: null, card_uid: null },
      { color: "green", player: null, card_uid: null },
    ]),
  );
  expect(screen.queryByText(/^Starting in/)).not.toBeInTheDocument();
});

test("somebody else picking singers is named, and can be taken over", async () => {
  openPlayerSelection.mockRejectedValueOnce({ detail: "selection_open" });
  getPlayerSelection.mockResolvedValue({
    data: {
      selection: selectionWith([
        { color: "blue", player: PLAYERS[1], card_uid: null },
      ]),
    },
  });
  renderSelection();

  expect(
    await screen.findByText(/Somebody is picking singers for/),
  ).toHaveTextContent("Somebody is picking singers for Dancing Queen.");
  // Nothing to tap until the room's selection is this phone's.
  expect(screen.queryByRole("button", { name: "Alice" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Play" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Take over" }));
  const confirm = await screen.findByRole("dialog", {
    name: "Take over the selection",
  });
  expect(confirm).toHaveTextContent("loses their singers");
  fireEvent.click(within(confirm).getByRole("button", { name: "Take over" }));

  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalledTimes(2));
  expect(openPlayerSelection.mock.calls[1][0].body.force).toBe(true);
  expect(
    await screen.findByRole("button", { name: "Slot blue: empty" }),
  ).toBeInTheDocument();
});

test("a selection taken away says so and offers a fresh one", async () => {
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  await waitFor(() =>
    expect(slot("blue")).toHaveAccessibleName("Slot blue: Alice"),
  );

  broadcast(null);

  expect(
    screen.getByText("Somebody else took over the selection."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Play" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Pick again" }));

  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalledTimes(2));
  // The people already on the board come back with it.
  expect(openPlayerSelection.mock.calls[1][0].body.slots).toEqual([
    { color: "blue", player_id: "aaa" },
  ]);
  expect(
    await screen.findByRole("button", { name: "Slot blue: Alice" }),
  ).toBeInTheDocument();
});

test("a selection replaced by another one is treated as taken away", async () => {
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  // A take-over is a *new* selection, so the broadcast carries one — with
  // another `opened_at`, which is the only thing that tells them apart.
  broadcast(
    selectionWith([{ color: "blue", player: PLAYERS[1], card_uid: null }], {
      opened_at: "2026-09-06T20:05:00.000Z",
    }),
  );

  expect(
    screen.getByText("Somebody else took over the selection."),
  ).toBeInTheDocument();
});

test("cancel gives the room's selection back", async () => {
  const onClose = vi.fn();
  renderSelection(onClose);
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  await waitFor(() => expect(releases()).toHaveLength(1));
  expectRelease(releases()[0]);
  expect(onClose).toHaveBeenCalled();
});

test("a selection that opens after cancel is given straight back", async () => {
  let land: (() => void) | null = null;
  openPlayerSelection.mockImplementationOnce(
    async (options: { body: { slots?: SlotCreate[] } }) => {
      await new Promise<void>((resolve) => {
        land = resolve;
      });
      return {
        data: { selection: selectionFrom(options.body.slots), token: TOKEN },
      };
    },
  );
  renderSelection();
  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalled());

  // Cancelled before the room answered: there is no token to send yet, and the
  // one that lands a moment later would otherwise lock the room for two minutes
  // over a song nobody is picking.
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await act(async () => {
    land?.();
  });

  await waitFor(() => expect(releases()).toHaveLength(1));
  expectRelease(releases()[0]);
});

test("a modal that simply goes away gives it back too", async () => {
  const { unmount } = renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  unmount();

  // The page may be going away with the request, so it has to outlive it.
  expect(releases()).toHaveLength(1);
  expectRelease(releases()[0]);
});

/** A page ending, the way a closing tab or a navigation away announces it. */
function pageHide(persisted: boolean): void {
  const event = new Event("pagehide");
  Object.defineProperty(event, "persisted", { value: persisted });
  act(() => {
    window.dispatchEvent(event);
  });
}

test("a tab that closes gives the room's selection back", async () => {
  const { unmount } = renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  // No effect cleanup runs on a closing tab, so the room would stay locked for
  // the two minutes the selection takes to expire.
  pageHide(false);

  expect(releases()).toHaveLength(1);
  expectRelease(releases()[0]);

  // The unmount that follows finds the token gone: the room is given back once.
  unmount();
  expect(releases()).toHaveLength(1);
});

test("a page put in the back/forward cache keeps its token", async () => {
  const { unmount } = renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  // This page can come back with the modal still on it, and a modal whose token
  // was given away can no longer move a single slot.
  pageHide(true);
  expect(releases()).toHaveLength(0);

  unmount();
  expect(releases()).toHaveLength(1);
});

test("the countdown never reads zero", async () => {
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  // The moment the selector starts the song, and the second before it: the line
  // is still on the screen, so it may not say the countdown is over.
  broadcast(
    selectionWith(
      [
        { color: "blue", player: PLAYERS[0], card_uid: null },
        { color: "red", player: PLAYERS[1], card_uid: null },
        { color: "green", player: null, card_uid: null },
      ],
      { auto_start_at: new Date(Date.now() - 500).toISOString() },
    ),
  );

  expect(await screen.findByText("Starting in 1…")).toBeInTheDocument();
});

test("the selection this phone starts is not read as a take-over", async () => {
  let land: (() => void) | null = null;
  startPlayerSelection.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      land = resolve;
    });
    return { data: {} };
  });
  const onClose = vi.fn();
  renderSelection(onClose);
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  await waitFor(() =>
    expect(slot("blue")).toHaveAccessibleName("Slot blue: Alice"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await waitFor(() => expect(startPlayerSelection).toHaveBeenCalled());

  // Starting the song closes the selection, and the room hears that before the
  // phone that asked for it does. Reading it as somebody else's take-over would
  // put "Pick again" on the screen for the whole time USDX takes to come up.
  broadcast(null);
  expect(
    screen.queryByText("Somebody else took over the selection."),
  ).not.toBeInTheDocument();

  await act(async () => {
    land?.();
  });
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

test("the last configuration comes back preselected", async () => {
  renderSelection();
  await screen.findByRole("button", { name: "Slot red: empty" });
  fireEvent.click(slot("red"));
  fireEvent.click(screen.getByRole("button", { name: "Bob" }));
  await waitFor(() =>
    expect(slot("red")).toHaveAccessibleName("Slot red: Bob"),
  );
  // The group is remembered when it sings, not when it is picked: a selection
  // somebody gave up says nothing about who is standing at the microphones.
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await waitFor(() => expect(startPlayerSelection).toHaveBeenCalled());

  renderSelection();

  await waitFor(() =>
    expect(
      screen.getAllByRole("button", { name: "Slot red: Bob" }),
    ).toHaveLength(2),
  );
});

test("a deleted player is not restored from the stored configuration", async () => {
  window.localStorage.setItem(
    "wingman.playerSlots",
    JSON.stringify({ blue: "gone", red: "bbb" }),
  );
  renderSelection();

  // Filtered before the request, not after the answer: an unknown player is a
  // 404 from the backend, and the room's selection would never open at all.
  await waitFor(() =>
    expect(openPlayerSelection.mock.calls[0][0].body.slots).toEqual([
      { color: "red", player_id: "bbb" },
    ]),
  );
  expect(
    await screen.findByRole("button", { name: "Slot red: Bob" }),
  ).toBeInTheDocument();
  expect(slot("blue")).toHaveAccessibleName("Slot blue: empty");
});

test("a hidden player is not offered", async () => {
  setRoster([player("aaa", "Alice"), player("bbb", "Bob", true)]);
  renderSelection();

  expect(await screen.findByRole("button", { name: "Alice" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Bob" })).toBeNull();
});

test("a hidden player is not restored from the stored configuration either", async () => {
  // The same trap a deleted player is: the assignment outlives the roster.
  window.localStorage.setItem(
    "wingman.playerSlots",
    JSON.stringify({ blue: "bbb", red: "aaa" }),
  );
  setRoster([player("aaa", "Alice"), player("bbb", "Bob", true)]);
  renderSelection();

  await waitFor(() =>
    expect(openPlayerSelection.mock.calls[0][0].body.slots).toEqual([
      { color: "red", player_id: "aaa" },
    ]),
  );
  expect(
    await screen.findByRole("button", { name: "Slot red: Alice" }),
  ).toBeInTheDocument();
  expect(slot("blue")).toHaveAccessibleName("Slot blue: empty");
});

test("a roster that is entirely hidden says so, not 'no players yet'", async () => {
  setRoster([player("aaa", "Alice", true)]);
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  expect(
    await screen.findByText(/Everybody is hidden. Show somebody/),
  ).toBeInTheDocument();
});

test("somebody who cannot reach the players page is not sent to it", async () => {
  // The page is shut under `players.manage`, so both empty lines have to split
  // on that right — "show somebody there" would be an errand this reader cannot
  // run.
  getMe.mockResolvedValue(meResponse(["players.view", "karaoke.sing"]));
  setRoster([player("aaa", "Alice", true)]);
  renderSelection();

  expect(
    await screen.findByText(/Everybody is hidden. Ask the host/),
  ).toBeInTheDocument();
});

test("a new player is created and put straight on the active slot", async () => {
  createPlayer.mockResolvedValue({ data: player("ccc", "Chris") });
  roster = [...PLAYERS, player("ccc", "Chris")];
  listPlayers
    .mockResolvedValueOnce({ data: { players: PLAYERS } })
    .mockResolvedValue({ data: { players: roster } });
  renderSelection();
  await screen.findByRole("button", { name: "Slot green: empty" });

  fireEvent.click(slot("green"));
  fireEvent.change(screen.getByLabelText("New player name"), {
    target: { value: "  Chris  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() =>
    expect(createPlayer.mock.calls[0][0].body).toEqual({ name: "Chris" }),
  );
  await waitFor(() =>
    expect(slot("green")).toHaveAccessibleName("Slot green: Chris"),
  );
});

test("with a slot picked an already assigned player moves instead of dropping out", async () => {
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  await waitFor(() =>
    expect(slot("blue")).toHaveAccessibleName("Slot blue: Alice"),
  );

  // Picking green first makes the tap mean "stand here", not "step off".
  fireEvent.click(slot("green"));
  fireEvent.click(screen.getByRole("button", { name: "Alice" }));

  await waitFor(() =>
    expect(slot("green")).toHaveAccessibleName("Slot green: Alice"),
  );
  expect(slot("blue")).toHaveAccessibleName("Slot blue: empty");
});

test("the hint says what a tap does, including on a full board", async () => {
  listKaraokeSlots.mockResolvedValue({
    data: { slots: [SLOTS[0]], player_counts: [1, 2] },
  });
  openPlayerSelection.mockImplementation(
    async (options: { body: { slots?: SlotCreate[] } }) => ({
      data: {
        selection: {
          ...selectionFrom(options.body.slots),
          slots: selectionFrom(options.body.slots).slots.slice(0, 1),
        },
        token: TOKEN,
      },
    }),
  );
  setPlayerSelectionSlots.mockImplementation(
    async (options: { body: { slots?: SlotCreate[] } }) => ({
      data: {
        ...selectionFrom(options.body.slots),
        slots: selectionFrom(options.body.slots).slots.slice(0, 1),
      },
    }),
  );
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  expect(screen.getByText(/Tap a player to fill/)).toBeInTheDocument();

  fireEvent.click(slot("blue"));
  expect(screen.getByText(/Pick a player for the outlined slot/)).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  expect(await screen.findByText(/All slots are full/)).toBeVisible();
});

test("an empty roster says so instead of showing a void", async () => {
  setRoster([]);
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  expect(await screen.findByText(/No players yet/)).toBeInTheDocument();
});

test("a long roster stays whole and still leaves the actions in reach", async () => {
  setRoster(manyPlayers(40));
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  // Every player renders, and all of them inside the one region that scrolls —
  // nothing is dropped, and nothing lands next to the pinned actions.
  const players = within(grid()).getAllByRole("button");
  expect(players).toHaveLength(40);
  expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  // The add form stays reachable next to them, however long the roster is.
  expect(screen.getByLabelText("New player name")).toBeInTheDocument();
  // Backend order, untouched: a roster that re-sorts itself is how the wrong
  // person gets picked.
  expect(players[0]).toHaveAccessibleName("Anna");
  expect(players[3]).toHaveAccessibleName("Bob");
});

test("the roster filter narrows the grid and gives it all back", async () => {
  setRoster(manyPlayers(40));
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  const filter = screen.getByLabelText("Filter players");
  // Case-insensitive substring: "Hannah" matches on the middle of the name.
  fireEvent.change(filter, { target: { value: "AnN" } });
  const matches = within(grid()).getAllByRole("button");
  expect(
    matches.map(
      (button) => button.querySelector("span:last-child")?.textContent,
    ),
  ).toEqual(["Anna", "Annalena", "Hannah"]);

  fireEvent.change(filter, { target: { value: "" } });
  expect(within(grid()).getAllByRole("button")).toHaveLength(40);
});

test("filtering hides players, it never unassigns them", async () => {
  setRoster(manyPlayers(40));
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.click(screen.getByRole("button", { name: "Anna" }));
  await waitFor(() =>
    expect(slot("blue")).toHaveAccessibleName("Slot blue: Anna"),
  );

  fireEvent.change(screen.getByLabelText("Filter players"), {
    target: { value: "bob" },
  });
  expect(within(grid()).getAllByRole("button")).toHaveLength(1);
  // Still standing on the slot, out of sight.
  expect(slot("blue")).toHaveAccessibleName("Slot blue: Anna");
  expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
});

test("a filter that matches nobody says so and still offers the add form", async () => {
  setRoster(manyPlayers(40));
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.change(screen.getByLabelText("Filter players"), {
    target: { value: "nobody" },
  });

  // Spoken, not just drawn: the reader is in the field with the grid out of
  // view, so the one thing that changed has to reach a screen reader.
  expect(screen.getByText("No player matches that.")).toHaveAttribute(
    "role",
    "status",
  );
  expect(document.querySelector(".player-selection-players")).toBeNull();
  // Adding is exactly what an empty result invites, so the form stays.
  expect(screen.getByLabelText("New player name")).toBeInTheDocument();
  expect(screen.getByLabelText("Filter players")).toHaveValue("nobody");
});

test("a roster that never arrives is not reported as a failed search", async () => {
  // Pending forever: not the reader having mistyped a name, so it may not claim
  // nobody matched — and with no roster there is nothing to open a selection
  // with either.
  listPlayers.mockReturnValue(new Promise(() => {}));
  renderSelection();

  expect(await screen.findByRole("status", { name: "Loading" })).toBeVisible();
  expect(screen.queryByText("No player matches that.")).not.toBeInTheDocument();
  expect(openPlayerSelection).not.toHaveBeenCalled();
});

test("a short roster is offered no filter", async () => {
  setRoster(manyPlayers(12));
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  expect(within(grid()).getAllByRole("button")).toHaveLength(12);
  expect(screen.queryByLabelText("Filter players")).not.toBeInTheDocument();
});

test("the sing button in the song details opens the player selection", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SongDetails song={SONG} onClose={vi.fn()} />
    </QueryClientProvider>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Sing" }));

  expect(
    await screen.findByRole("dialog", { name: "Player selection" }),
  ).toHaveTextContent("Dancing Queen");
});

/** The line that says the room is picking with cards. */
const SELECTOR_LINE = /A player selector is connected/;

test("a connected selector is said out loud under the slots", async () => {
  getDeviceStatus.mockResolvedValue({ data: { online: true } });
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  expect(await screen.findByText(SELECTOR_LINE)).toHaveTextContent(
    "You can still change it here.",
  );
});

test("no selector in the room, nothing about one", async () => {
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  expect(screen.queryByText(SELECTOR_LINE)).not.toBeInTheDocument();
});

/** The selection the host spin hands on: its song, Bob already on red. */
function adopted(): SelectionRead {
  return selectionWith([
    { color: "blue", player: null, card_uid: null },
    { color: "red", player: PLAYERS[1], card_uid: null },
    { color: "green", player: null, card_uid: null },
  ]);
}

test("an adopted selection is drawn as it came, and nothing is opened", async () => {
  // Remembered slots would be what a fresh open sends; an adopted selection
  // already has its slots, and they are the room's, not this phone's memory.
  window.localStorage.setItem(
    "wingman.playerSlots",
    JSON.stringify({ blue: "aaa" }),
  );
  renderAdopted(adopted());

  expect(
    await screen.findByRole("button", { name: "Slot red: Bob" }),
  ).toBeInTheDocument();
  expect(slot("blue")).toHaveAccessibleName("Slot blue: empty");
  // Straight to picking: no request, no spinner, and Play is live on Bob.
  expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
  expect(openPlayerSelection).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("status", { name: "Loading" }),
  ).not.toBeInTheDocument();
});

test("an adopted selection is written to with the token it came with", async () => {
  renderAdopted(adopted());
  // The slots are on the screen before the roster arrives — the selection came
  // with the props — so it is the roster that has to be waited for.
  fireEvent.click(await screen.findByRole("button", { name: "Alice" }));

  await waitFor(() => expect(setPlayerSelectionSlots).toHaveBeenCalledTimes(1));
  expect(setPlayerSelectionSlots.mock.calls[0][0].body.token).toBe(
    ADOPTED_TOKEN,
  );
  // Composed on what came in: Alice joins Bob rather than replacing him.
  expect(putBody(0)).toEqual([
    { color: "blue", player_id: "aaa" },
    { color: "red", player_id: "bbb" },
  ]);
});

test("play on an adopted selection starts it with that token", async () => {
  const onClose = vi.fn();
  renderAdopted(adopted(), onClose);
  await screen.findByRole("button", { name: "Slot red: Bob" });

  fireEvent.click(screen.getByRole("button", { name: "Play" }));

  await waitFor(() => expect(startPlayerSelection).toHaveBeenCalledTimes(1));
  expect(startPlayerSelection.mock.calls[0][0].body).toEqual({
    token: ADOPTED_TOKEN,
    force: false,
  });
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  // Started, so nothing is given back — and the group is remembered as usual.
  expect(releases()).toHaveLength(0);
  expect(
    JSON.parse(window.localStorage.getItem("wingman.playerSlots") ?? "{}"),
  ).toEqual({ red: "bbb" });
});

test("cancelling an adopted selection gives it back with its token", async () => {
  const onClose = vi.fn();
  renderAdopted(adopted(), onClose);
  await screen.findByRole("button", { name: "Slot red: Bob" });

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  await waitFor(() => expect(releases()).toHaveLength(1));
  expectRelease(releases()[0], ADOPTED_TOKEN);
  expect(onClose).toHaveBeenCalled();
});

test("an adopted selection that simply goes away is given back too", async () => {
  const { unmount } = renderAdopted(adopted());
  await screen.findByRole("button", { name: "Slot red: Bob" });

  unmount();

  expect(releases()).toHaveLength(1);
  expectRelease(releases()[0], ADOPTED_TOKEN);
});

test("an adopted selection taken over offers a fresh one on its song", async () => {
  renderAdopted(adopted());
  await screen.findByRole("button", { name: "Slot red: Bob" });

  // Another `opened_at`: a take-over, and the handed-on token died with it.
  broadcast(
    selectionWith([{ color: "blue", player: PLAYERS[0], card_uid: null }], {
      opened_at: "2026-09-06T20:05:00.000Z",
    }),
  );

  expect(
    screen.getByText("Somebody else took over the selection."),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Pick again" }));

  // The adopted song and the slots as they stood, the ordinary way in.
  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalledTimes(1));
  expect(openPlayerSelection.mock.calls[0][0].body).toEqual({
    song_id: "usdb:1",
    slots: [{ color: "red", player_id: "bbb" }],
    force: false,
  });
  expect(
    await screen.findByRole("button", { name: "Slot red: Bob" }),
  ).toBeInTheDocument();
  // And the token is the new one from then on.
  fireEvent.click(await screen.findByRole("button", { name: "Alice" }));
  await waitFor(() => expect(setPlayerSelectionSlots).toHaveBeenCalledTimes(1));
  expect(setPlayerSelectionSlots.mock.calls[0][0].body.token).toBe(TOKEN);
});
