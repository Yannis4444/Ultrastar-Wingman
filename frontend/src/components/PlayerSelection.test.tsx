import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { PlayerRead, SongRead } from "../api";
import { FakeSocket } from "../test/fakeSocket";
import PlayerSelection from "./PlayerSelection";
import SongDetails from "./SongDetails";

// Same seam as the songs tests: the real TanStack wiring runs, only the
// transport is faked.
const { listKaraokeColors, listPlayers, singSong, createPlayer } = vi.hoisted(
  () => ({
    listKaraokeColors: vi.fn(),
    listPlayers: vi.fn(),
    singSong: vi.fn(),
    createPlayer: vi.fn(),
  }),
);

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listKaraokeColors,
  listPlayers,
  singSong,
  createPlayer,
}));

const SONG: SongRead = {
  id: "usdb:1",
  source: "usdb",
  title: "Dancing Queen",
  artist: "ABBA",
  duration_seconds: 231,
  has_video: true,
  language: "English",
  genre: "Pop",
  year: 1976,
  edition: null,
  creator: null,
};

function player(id: string, name: string): PlayerRead {
  return { id, name, registered: false, has_avatar: false };
}

const PLAYERS = [player("aaa", "Alice"), player("bbb", "Bob")];

// Three of USDX's sixteen colors: the component must render whatever the
// backend sends, in that order, and never a hardcoded list.
const COLORS = [
  { name: "blue", hex: "#048BB9" },
  { name: "red", hex: "#D00000" },
  { name: "green", hex: "#00AC00" },
];

function renderSelection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PlayerSelection song={SONG} onClose={vi.fn()} />
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
  listKaraokeColors.mockResolvedValue({ data: { colors: COLORS } });
  listPlayers.mockResolvedValue({ data: { players: PLAYERS } });
  singSong.mockReset();
  createPlayer.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

test("one slot per backend color, in the backend's order", async () => {
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

test("play sends every color with the assigned players", async () => {
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
