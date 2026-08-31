import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PlayerRead, SongRead } from "../api";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import PlayerSelection from "./PlayerSelection";
import SongDetails from "./SongDetails";

// Same seam as the songs tests: the real TanStack wiring runs, only the
// transport is faked.
const { listKaraokeSlots, listPlayers, singSong, createPlayer, getMe } =
  vi.hoisted(() => ({
    listKaraokeSlots: vi.fn(),
    listPlayers: vi.fn(),
    singSong: vi.fn(),
    createPlayer: vi.fn(),
    getMe: vi.fn(),
  }));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listKaraokeSlots,
  listPlayers,
  singSong,
  createPlayer,
  getMe,
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

function renderSelection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // The setup guide links to /settings, so the selection needs a router around
  // it — the real app always has one.
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PlayerSelection song={SONG} onClose={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function slot(color: string) {
  return screen.getByRole("button", { name: new RegExp(`^Slot ${color}:`) });
}

beforeEach(() => {
  window.localStorage.clear();
  // The song details subscribe to wishlist events: no test opens a real socket.
  vi.stubGlobal("WebSocket", FakeSocket);
  listKaraokeSlots.mockResolvedValue({
    data: { slots: SLOTS, player_counts: [1, 2, 3, 4, 6] },
  });
  listPlayers.mockResolvedValue({ data: { players: PLAYERS } });
  // Unanswered by default, which is what `useAuth` reads as "allow": every test
  // that does not care about a right sees the same component the host does.
  getMe.mockRejectedValue(new Error("no /auth/me in this test"));
  singSong.mockReset();
  createPlayer.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

test("one slot per configured color, in the backend's order", async () => {
  renderSelection();

  const slots = await screen.findAllByRole("button", { name: /^Slot / });
  expect(slots.map((element) => element.getAttribute("aria-label"))).toEqual([
    "Slot blue: empty",
    "Slot red: empty",
    "Slot green: empty",
  ]);
  expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
});

test("tapping a slot and then a player puts that player on the slot", async () => {
  renderSelection();
  await screen.findByRole("button", { name: "Slot red: empty" });

  fireEvent.click(slot("red"));
  fireEvent.click(screen.getByRole("button", { name: "Bob" }));

  expect(slot("red")).toHaveAccessibleName("Slot red: Bob");
  expect(slot("blue")).toHaveAccessibleName("Slot blue: empty");
  expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();

  // Tapping the slot's clear button frees it again.
  fireEvent.click(screen.getByRole("button", { name: "Clear slot red" }));
  expect(slot("red")).toHaveAccessibleName("Slot red: empty");
});

test("without an active slot a player lands on the first free one", async () => {
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  fireEvent.click(screen.getByRole("button", { name: "Bob" }));

  expect(slot("blue")).toHaveAccessibleName("Slot blue: Alice");
  expect(slot("red")).toHaveAccessibleName("Slot red: Bob");
});

test("play sends every configured slot with the assigned players", async () => {
  singSong.mockResolvedValue({ data: {} });
  renderSelection();
  await screen.findByRole("button", { name: "Slot green: empty" });

  fireEvent.click(slot("green"));
  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  fireEvent.click(screen.getByRole("button", { name: "Play" }));

  await waitFor(() => expect(singSong).toHaveBeenCalledTimes(1));
  expect(singSong.mock.calls[0][0].body).toEqual({
    song_id: "usdb:1",
    force: false,
    slots: [
      { color: "blue", player_id: null },
      { color: "red", player_id: null },
      { color: "green", player_id: "aaa" },
    ],
  });
});

test("a song already playing is replaced only after confirmation", async () => {
  singSong.mockRejectedValueOnce({ detail: "already_playing" });
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  fireEvent.click(screen.getByRole("button", { name: "Play" }));

  const confirm = await screen.findByRole("dialog", {
    name: "Already playing",
  });
  expect(confirm).toHaveTextContent("Another song is playing");
  expect(singSong).toHaveBeenCalledTimes(1);

  singSong.mockResolvedValue({ data: {} });
  fireEvent.click(screen.getByRole("button", { name: "Replace" }));

  await waitFor(() => expect(singSong).toHaveBeenCalledTimes(2));
  expect(singSong.mock.calls[1][0].body.force).toBe(true);
  expect(singSong.mock.calls[1][0].body.slots[0].player_id).toBe("aaa");
});

test("cancelling the replace prompt does not start the song", async () => {
  singSong.mockRejectedValueOnce({ detail: "already_playing" });
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  // The selection itself also has a Cancel button, so scope to the prompt.
  const confirm = await screen.findByRole("dialog", {
    name: "Already playing",
  });
  fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

  expect(
    screen.queryByRole("dialog", { name: "Already playing" }),
  ).not.toBeInTheDocument();
  expect(singSong).toHaveBeenCalledTimes(1);
});

test("an unconfigured USDX opens the setup guide instead of an error", async () => {
  singSong.mockRejectedValueOnce({
    detail: {
      error: "usdx_not_configured",
      problems: ["'songs.directory' is not set"],
    },
  });
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  fireEvent.click(screen.getByRole("button", { name: "Play" }));

  const guide = await screen.findByRole("dialog", {
    name: "Ultrastar Deluxe is not set up",
  });
  expect(guide).toHaveTextContent(/does not know where your songs are/);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("any other failure is still a plain notice", async () => {
  singSong.mockRejectedValueOnce({ detail: "launch_failed" });
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  fireEvent.click(screen.getByRole("button", { name: "Play" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("launch_failed");
  expect(
    screen.queryByRole("dialog", { name: "Ultrastar Deluxe is not set up" }),
  ).not.toBeInTheDocument();
});

test("the last configuration comes back preselected", async () => {
  renderSelection();
  await screen.findByRole("button", { name: "Slot red: empty" });
  fireEvent.click(slot("red"));
  fireEvent.click(screen.getByRole("button", { name: "Bob" }));

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

  expect(
    await screen.findByRole("button", { name: "Slot red: Bob" }),
  ).toBeInTheDocument();
  expect(slot("blue")).toHaveAccessibleName("Slot blue: empty");
});

test("a hidden player is not offered", async () => {
  listPlayers.mockResolvedValue({
    data: { players: [player("aaa", "Alice"), player("bbb", "Bob", true)] },
  });
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
  listPlayers.mockResolvedValue({
    data: { players: [player("aaa", "Alice"), player("bbb", "Bob", true)] },
  });
  renderSelection();

  expect(
    await screen.findByRole("button", { name: "Slot red: Alice" }),
  ).toBeInTheDocument();
  expect(slot("blue")).toHaveAccessibleName("Slot blue: empty");
});

test("a roster that is entirely hidden says so, not 'no players yet'", async () => {
  listPlayers.mockResolvedValue({
    data: { players: [player("aaa", "Alice", true)] },
  });
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  expect(
    await screen.findByText(/Everybody is hidden — show somebody/),
  ).toBeInTheDocument();
});

test("somebody who cannot reach the players page is not sent to it", async () => {
  // The page is shut under `players.manage`, so both empty lines have to split
  // on that right — "show somebody there" would be an errand this reader cannot
  // run.
  getMe.mockResolvedValue(meResponse(["players.view", "karaoke.sing"]));
  listPlayers.mockResolvedValue({
    data: { players: [player("aaa", "Alice", true)] },
  });
  renderSelection();

  expect(
    await screen.findByText(/Everybody is hidden — ask the host/),
  ).toBeInTheDocument();
});

test("a new player is created and put straight on the active slot", async () => {
  createPlayer.mockResolvedValue({ data: player("ccc", "Chris") });
  listPlayers
    .mockResolvedValueOnce({ data: { players: PLAYERS } })
    .mockResolvedValue({
      data: { players: [...PLAYERS, player("ccc", "Chris")] },
    });
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
  expect(slot("blue")).toHaveAccessibleName("Slot blue: Alice");

  // Picking green first makes the tap mean "stand here", not "step off".
  fireEvent.click(slot("green"));
  fireEvent.click(screen.getByRole("button", { name: "Alice" }));

  expect(slot("green")).toHaveAccessibleName("Slot green: Alice");
  expect(slot("blue")).toHaveAccessibleName("Slot blue: empty");
});

test("the hint says what a tap does, including on a full board", async () => {
  listKaraokeSlots.mockResolvedValue({
    data: { slots: [SLOTS[0]], player_counts: [1, 2] },
  });
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  expect(screen.getByText(/Tap a player to fill/)).toBeInTheDocument();

  fireEvent.click(slot("blue"));
  expect(screen.getByText(/Pick a player for the outlined slot/)).toBeVisible();

  fireEvent.click(screen.getByRole("button", { name: "Alice" }));
  expect(screen.getByText(/All slots are full/)).toBeVisible();
});

test("an empty roster says so instead of showing a void", async () => {
  listPlayers.mockResolvedValue({ data: { players: [] } });
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  expect(await screen.findByText(/No players yet/)).toBeInTheDocument();
});

test("a long roster stays whole and still leaves the actions in reach", async () => {
  listPlayers.mockResolvedValue({ data: { players: manyPlayers(40) } });
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
  listPlayers.mockResolvedValue({ data: { players: manyPlayers(40) } });
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
  listPlayers.mockResolvedValue({ data: { players: manyPlayers(40) } });
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.click(screen.getByRole("button", { name: "Anna" }));
  expect(slot("blue")).toHaveAccessibleName("Slot blue: Anna");

  fireEvent.change(screen.getByLabelText("Filter players"), {
    target: { value: "bob" },
  });
  expect(within(grid()).getAllByRole("button")).toHaveLength(1);
  // Still standing on the slot, out of sight.
  expect(slot("blue")).toHaveAccessibleName("Slot blue: Anna");
  expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
});

test("a filter that matches nobody says so and still offers the add form", async () => {
  listPlayers.mockResolvedValue({ data: { players: manyPlayers(40) } });
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });

  fireEvent.change(screen.getByLabelText("Filter players"), {
    target: { value: "nobody" },
  });

  // Spoken, not just drawn: the reader is in the field with the grid out of
  // view, so the one thing that changed has to reach a screen reader.
  expect(screen.getByRole("status")).toHaveTextContent(
    "No player matches that.",
  );
  expect(document.querySelector(".player-selection-players")).toBeNull();
  // Adding is exactly what an empty result invites, so the form stays.
  expect(screen.getByLabelText("New player name")).toBeInTheDocument();
  expect(screen.getByLabelText("Filter players")).toHaveValue("nobody");
});

test("a roster that never arrives is not reported as a failed search", async () => {
  // Pending forever, and then failing: neither is the reader having mistyped a
  // name, so neither may claim nobody matched.
  listPlayers.mockReturnValue(new Promise(() => {}));
  renderSelection();
  await screen.findByRole("button", { name: "Slot blue: empty" });
  expect(screen.queryByText("No player matches that.")).not.toBeInTheDocument();

  listPlayers.mockRejectedValue(new Error("offline"));
  renderSelection();
  await waitFor(() =>
    expect(
      screen.getAllByRole("button", { name: "Slot blue: empty" }),
    ).toHaveLength(2),
  );
  expect(screen.queryByText("No player matches that.")).not.toBeInTheDocument();
});

test("a short roster is offered no filter", async () => {
  listPlayers.mockResolvedValue({ data: { players: manyPlayers(12) } });
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
    await screen.findByRole("dialog", { name: "Player Selection" }),
  ).toHaveTextContent("Dancing Queen");
});
