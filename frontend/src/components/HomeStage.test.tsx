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
import HomeStage from "./HomeStage";

const {
  getCurrentSing,
  getMe,
  listFavorites,
  listKaraokeColors,
  listSongScores,
  listWishlist,
  stopSinging,
} = vi.hoisted(() => ({
  getCurrentSing: vi.fn(),
  getMe: vi.fn(),
  listFavorites: vi.fn(),
  listKaraokeColors: vi.fn(),
  listSongScores: vi.fn(),
  listWishlist: vi.fn(),
  stopSinging: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getCurrentSing,
  getMe,
  listFavorites,
  listKaraokeColors,
  listSongScores,
  listWishlist,
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
  ],
};

function renderStage() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <HomeStage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.clearAllMocks();
  getCurrentSing.mockResolvedValue({ data: { sing: null } });
  getMe.mockResolvedValue(
    meResponse(["karaoke.stop", "wishlist.add", "wishlist.view"], {
      user: userRead(),
      role: "user",
    }),
  );
  listKaraokeColors.mockResolvedValue({
    data: { colors: [{ name: "blue", hex: "#048BB9" }] },
  });
  listFavorites.mockResolvedValue({ data: { song_ids: [] } });
  listSongScores.mockResolvedValue({ data: { scores: [] } });
  listWishlist.mockResolvedValue({ data: { wishes: [] } });
  stopSinging.mockResolvedValue({ data: undefined });
});

afterEach(() => vi.unstubAllGlobals());

test("while nothing plays the stage is the app's identity", async () => {
  const { container } = renderStage();

  await waitFor(() => expect(getCurrentSing).toHaveBeenCalled());
  const idle = container.querySelector(".home-stage-idle");
  expect(idle).not.toHaveClass("home-stage-hidden");
  expect(idle).toHaveAttribute("aria-hidden", "false");
  expect(
    screen.getByRole("heading", { name: "Ultrastar Wingman" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Now playing" }),
  ).not.toBeInTheDocument();
});

test("a running song takes the stage and the identity steps aside", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  const { container } = renderStage();

  const block = await screen.findByRole("region", { name: "Now playing" });
  expect(block).toHaveClass("currently-playing-stage");
  expect(block).toHaveTextContent("Dancing Queen");
  expect(block).toHaveTextContent("Alice");

  // Still mounted — it is what holds the tile's height — but invisible and
  // untappable.
  const idle = container.querySelector(".home-stage-idle");
  expect(idle).toHaveClass("home-stage-hidden");
  expect(idle).toHaveAttribute("aria-hidden", "true");
  // One tile, one cell: both states are children of the same stage.
  expect(idle?.parentElement).toHaveClass("home-stage");
  expect(block.closest(".home-stage")).toBe(idle?.parentElement);
});

test("the switch is driven by the event, without a second request", async () => {
  renderStage();
  await waitFor(() => expect(getCurrentSing).toHaveBeenCalledTimes(1));

  FakeSocket.deliver({ event: "karaoke.started", sing: SING });

  await screen.findByRole("region", { name: "Now playing" });
  expect(getCurrentSing).toHaveBeenCalledTimes(1);

  FakeSocket.deliver({
    event: "karaoke.ended",
    sing_id: "sing-1",
    song_id: "usdb:1",
  });

  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Now playing" }),
    ).not.toBeInTheDocument(),
  );
  expect(getCurrentSing).toHaveBeenCalledTimes(1);
});

test("the stage carries the song modal's three controls", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  renderStage();

  await screen.findByRole("region", { name: "Now playing" });
  expect(screen.getByRole("button", { name: "Add to favorites" })).toHaveClass(
    "song-control",
  );
  expect(screen.getByRole("button", { name: "Wish" })).toHaveClass(
    "song-control",
  );
  expect(screen.getByRole("button", { name: "Stop" })).toHaveClass(
    "song-control-lead",
  );
});

test("stopping from the stage asks first, then calls the backend", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  renderStage();

  fireEvent.click(await screen.findByRole("button", { name: "Stop" }));

  const confirm = screen.getByRole("dialog", { name: "Stop the song" });
  expect(confirm).toHaveTextContent("Dancing Queen");
  expect(stopSinging).not.toHaveBeenCalled();

  fireEvent.click(within(confirm).getByRole("button", { name: "Stop" }));

  await waitFor(() => expect(stopSinging).toHaveBeenCalledTimes(1));
  // Back to the identity, in the same tile.
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "Ultrastar Wingman" }),
    ).toBeInTheDocument(),
  );
});

test("the song modal outlives the sing that opened it", async () => {
  // The modal renders inside the stage's playing cell, which is why that cell
  // must never carry an opacity of its own.
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  renderStage();

  fireEvent.click(
    await screen.findByRole("button", { name: "Details for Dancing Queen" }),
  );
  await screen.findByRole("dialog", { name: "Dancing Queen" });

  FakeSocket.deliver({
    event: "karaoke.ended",
    sing_id: "sing-1",
    song_id: "usdb:1",
  });

  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Now playing" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("dialog", { name: "Dancing Queen" }),
  ).toBeInTheDocument();
});

test("the page keeps exactly one heading across the switch", async () => {
  renderStage();
  await waitFor(() => expect(getCurrentSing).toHaveBeenCalled());

  // Idle: the app's own name is the page heading.
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Ultrastar Wingman",
  );

  FakeSocket.deliver({ event: "karaoke.started", sing: SING });
  await screen.findByRole("region", { name: "Now playing" });

  // The identity heading is aria-hidden now, so without a replacement the page
  // would expose none at all — and never two.
  const playing = screen.getAllByRole("heading", { level: 1 });
  expect(playing).toHaveLength(1);
  expect(playing[0]).toHaveTextContent("Now playing");

  FakeSocket.deliver({
    event: "karaoke.ended",
    sing_id: "sing-1",
    song_id: "usdb:1",
  });
  await waitFor(() =>
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Ultrastar Wingman",
    ),
  );
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
});
