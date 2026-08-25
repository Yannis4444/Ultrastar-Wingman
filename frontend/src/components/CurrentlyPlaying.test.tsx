import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { CurrentSing } from "../api";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import CurrentlyPlaying from "./CurrentlyPlaying";

const {
  addFavorite,
  getCurrentSing,
  getMe,
  getPlaylist,
  listFavorites,
  listKaraokeColors,
  listPlaylists,
  listSongScores,
  listWishlist,
  removeFavorite,
  stopSinging,
} = vi.hoisted(() => ({
  addFavorite: vi.fn(),
  getCurrentSing: vi.fn(),
  getMe: vi.fn(),
  getPlaylist: vi.fn(),
  listFavorites: vi.fn(),
  listKaraokeColors: vi.fn(),
  listPlaylists: vi.fn(),
  listSongScores: vi.fn(),
  listWishlist: vi.fn(),
  removeFavorite: vi.fn(),
  stopSinging: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  addFavorite,
  getCurrentSing,
  getMe,
  getPlaylist,
  listFavorites,
  listKaraokeColors,
  listPlaylists,
  listSongScores,
  listWishlist,
  removeFavorite,
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

/**
 * The same sing, started `secondsAgo` ago. The elapsed clock runs against the
 * real time, so anything that asserts on it has to place the start relative to
 * now instead of pinning it to a date.
 */
function playing(secondsAgo: number): CurrentSing {
  return {
    ...SING,
    started_at: new Date(Date.now() - secondsAgo * 1000).toISOString(),
  };
}

/** A logged-in account owning one playlist — what the two extra icons need. */
function loggedIn(): void {
  getMe.mockResolvedValue(
    meResponse(["karaoke.stop", "playlists.manage"], {
      user: userRead(),
      role: "user",
    }),
  );
  listPlaylists.mockResolvedValue({
    data: {
      playlists: [
        {
          id: "pl-1",
          name: "Warm-up",
          shared: false,
          owner_username: null,
          song_count: 0,
          mine: true,
        },
      ],
    },
  });
}

function renderTile(props?: { hideControls?: boolean }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CurrentlyPlaying {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.clearAllMocks();
  getCurrentSing.mockResolvedValue({ data: { sing: null } });
  // Anonymous by default: no favorites, no playlists, Stop only.
  getMe.mockResolvedValue(meResponse(["karaoke.stop"]));
  listKaraokeColors.mockResolvedValue({
    data: { colors: [{ name: "blue", hex: "#048BB9" }] },
  });
  listFavorites.mockResolvedValue({ data: { song_ids: [] } });
  listPlaylists.mockResolvedValue({ data: { playlists: [] } });
  listSongScores.mockResolvedValue({ data: { scores: [] } });
  listWishlist.mockResolvedValue({ data: { wishes: [] } });
  addFavorite.mockResolvedValue({ data: undefined });
  removeFavorite.mockResolvedValue({ data: undefined });
  getPlaylist.mockResolvedValue({
    data: { id: "pl-1", name: "Warm-up", entries: [] },
  });
  stopSinging.mockResolvedValue({ data: undefined });
});

afterEach(() => vi.unstubAllGlobals());

test("nothing is rendered while USDX is idle", async () => {
  const { container } = renderTile();

  await waitFor(() => expect(getCurrentSing).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test("the running song is shown with its players and elapsed time", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: playing(60) } });
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

test("the progress bar sits directly under the time, above the players", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: playing(60) } });
  renderTile();

  const tile = await screen.findByRole("region", { name: "Now playing" });
  expect([...tile.children].map((child) => child.className)).toEqual([
    "currently-playing-cover-button",
    "currently-playing-info",
    "currently-playing-bar",
    "currently-playing-players",
    "currently-playing-controls",
  ]);
});

test("a total the elapsed time already passed is dropped, the bar stays full", async () => {
  // USDX boots after Wingman starts the clock, so the elapsed time can overtake
  // the song. A total that is provably wrong is worse than none.
  getCurrentSing.mockResolvedValue({ data: { sing: playing(300) } });
  const { container } = renderTile();

  const tile = await screen.findByRole("region", { name: "Now playing" });
  // A loaded runner may need a second between the mock and the render, so the
  // elapsed value is matched loosely — the missing total is the point.
  expect(tile).toHaveTextContent(/5:0\d/);
  expect(tile).not.toHaveTextContent("/ 3:51");
  const fill = container.querySelector<HTMLElement>(
    ".currently-playing-bar > span",
  );
  expect(fill?.style.width).toBe("100%");
});

test("a song without a known duration shows neither a total nor a bar", async () => {
  const sing = playing(60);
  getCurrentSing.mockResolvedValue({
    data: { sing: { ...sing, song: { ...sing.song, duration_seconds: null } } },
  });
  const { container } = renderTile();

  const tile = await screen.findByRole("region", { name: "Now playing" });
  expect(tile).toHaveTextContent(/1:0\d/);
  expect(tile).not.toHaveTextContent("/");
  expect(container.querySelector(".currently-playing-bar")).toBeNull();
});

test("a karaoke.started event brings the tile up without a refetch", async () => {
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

test("the cover opens the song modal", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  renderTile();

  fireEvent.click(
    await screen.findByRole("button", { name: "Details for Dancing Queen" }),
  );

  expect(
    await screen.findByRole("dialog", { name: "Dancing Queen" }),
  ).toBeInTheDocument();
});

test("the host page owns Stop, so hideControls leaves the whole row out", async () => {
  loggedIn();
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  const { container } = renderTile({ hideControls: true });

  await screen.findByText("Dancing Queen");
  expect(container.querySelector(".currently-playing-controls")).toBeNull();
  // The TV has nothing to tap, so the cover stays a plain image.
  expect(
    screen.queryByRole("button", { name: /^Details for/ }),
  ).not.toBeInTheDocument();
});

test("stopping asks first and then calls the backend", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  renderTile();

  const stopButton = await screen.findByRole("button", { name: "Stop" });
  expect(stopButton).toHaveClass("icon-button", "icon-button-danger");
  fireEvent.click(stopButton);

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

test("an anonymous browser gets Stop alone", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  renderTile();

  await screen.findByRole("button", { name: "Stop" });
  expect(
    screen.queryByRole("button", { name: "Add to favorites" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Add to playlist" }),
  ).not.toBeInTheDocument();
  expect(listFavorites).not.toHaveBeenCalled();
});

test("a guest who may not stop gets no control row", async () => {
  // The shipped guest role: no account and no `karaoke.stop`, so every icon in
  // the row would be one the backend refuses. The block keeps the cover.
  getMe.mockResolvedValue(meResponse(["karaoke.sing", "songs.view"]));
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  const { container } = renderTile();

  await screen.findByRole("button", { name: "Details for Dancing Queen" });
  expect(container.querySelector(".currently-playing-controls")).toBeNull();
});

test("the favorite icon marks the running song", async () => {
  loggedIn();
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  renderTile();

  const heart = await screen.findByRole("button", { name: "Add to favorites" });
  expect(heart).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(heart);

  await waitFor(() =>
    expect(addFavorite).toHaveBeenCalledWith(
      expect.objectContaining({ path: { song_id: "usdb:1" } }),
    ),
  );
  // The toggle is optimistic, so the heart flips before the refetch.
  expect(
    await screen.findByRole("button", { name: "Remove from favorites" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("the playlist icon opens the picker straight away", async () => {
  loggedIn();
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  renderTile();

  fireEvent.click(
    await screen.findByRole("button", { name: "Add to playlist" }),
  );

  const dialog = await screen.findByRole("dialog", { name: "Add to playlist" });
  expect(
    within(dialog).getByRole("button", { name: /Warm-up/ }),
  ).toBeInTheDocument();
});

test("without a playlist of their own the playlist icon stays away", async () => {
  loggedIn();
  listPlaylists.mockResolvedValue({ data: { playlists: [] } });
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  renderTile();

  await screen.findByRole("button", { name: "Add to favorites" });
  expect(
    screen.queryByRole("button", { name: "Add to playlist" }),
  ).not.toBeInTheDocument();
});
