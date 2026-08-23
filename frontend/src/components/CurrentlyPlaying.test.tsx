import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { CurrentSing } from "../api";
import { FakeSocket } from "../test/fakeSocket";
import CurrentlyPlaying from "./CurrentlyPlaying";

const { getCurrentSing, listKaraokeColors, stopSinging } = vi.hoisted(() => ({
  getCurrentSing: vi.fn(),
  listKaraokeColors: vi.fn(),
  stopSinging: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getCurrentSing,
  listKaraokeColors,
  stopSinging,
}));

const SING: CurrentSing = {
  sing_id: "sing-1",
  started_at: "2026-08-23T20:00:00+00:00",
  song: {
    id: "usdb:1",
    source: "usdb",
    title: "Dancing Queen",
    artist: "ABBA",
    duration_seconds: 231,
    has_video: true,
    language: null,
    genre: null,
    year: null,
    edition: null,
    creator: null,
  },
  slots: [
    {
      color: "blue",
      player: {
        id: "aaa",
        name: "Alice",
        registered: false,
        has_avatar: false,
      },
    },
    { color: "red", player: null },
  ],
};

function renderTile() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CurrentlyPlaying />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  getCurrentSing.mockReset();
  listKaraokeColors.mockReset();
  listKaraokeColors.mockResolvedValue({
    data: { colors: [{ name: "blue", hex: "#048BB9" }] },
  });
  stopSinging.mockReset();
  stopSinging.mockResolvedValue({ data: undefined });
});

afterEach(() => vi.unstubAllGlobals());

test("nothing is rendered while USDX is idle", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: null } });
  const { container } = renderTile();

  await waitFor(() => expect(getCurrentSing).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test("the running song is shown with its players and elapsed time", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  renderTile();

  const tile = await screen.findByRole("region", { name: "Now playing" });
  expect(tile).toHaveTextContent("Dancing Queen");
  expect(tile).toHaveTextContent("ABBA");
  expect(tile).toHaveTextContent("Alice");
  // The total comes from the song, so an elapsed time is always paired with it.
  expect(tile).toHaveTextContent("/ 3:51");
  // Empty slots carry no player and must not show up as one.
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
});

test("a karaoke.started event brings the tile up without a refetch", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: null } });
  renderTile();
  await waitFor(() => expect(getCurrentSing).toHaveBeenCalledTimes(1));

  FakeSocket.deliver({ event: "karaoke.started", sing: SING });

  expect(await screen.findByText("Dancing Queen")).toBeInTheDocument();
  expect(getCurrentSing).toHaveBeenCalledTimes(1);
});

test("a karaoke.ended event takes the tile away again", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  renderTile();
  await screen.findByText("Dancing Queen");

  FakeSocket.deliver({
    event: "karaoke.ended",
    sing_id: "sing-1",
    song_id: "usdb:1",
  });

  await waitFor(() =>
    expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument(),
  );
});

test("stopping asks first and then calls the backend", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  renderTile();

  fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
  const confirm = screen.getByRole("dialog", { name: "Stop the song" });
  expect(confirm).toHaveTextContent("Dancing Queen");
  expect(stopSinging).not.toHaveBeenCalled();

  // The tile has a Stop button too, so scope to the prompt.
  fireEvent.click(within(confirm).getByRole("button", { name: "Stop" }));

  await waitFor(() => expect(stopSinging).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument(),
  );
});
