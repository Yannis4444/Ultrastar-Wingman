import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import Home from "./Home";

const {
  health,
  getMe,
  usdxStatus,
  getCurrentSing,
  getMusic,
  listKaraokeColors,
  listSongs,
  listWishlist,
} = vi.hoisted(() => ({
  health: vi.fn(),
  getMe: vi.fn(),
  usdxStatus: vi.fn(),
  getCurrentSing: vi.fn(),
  getMusic: vi.fn(),
  listKaraokeColors: vi.fn(),
  listSongs: vi.fn(),
  listWishlist: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  health,
  getMe,
  usdxStatus,
  getCurrentSing,
  getMusic,
  listKaraokeColors,
  listSongs,
  listWishlist,
}));

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  health.mockResolvedValue({
    data: { name: "Ultrastar Wingman", version: "2.1.0" },
  });
  getMe.mockResolvedValue(meResponse(["songs.view", "wishlist.view"]));
  usdxStatus.mockResolvedValue({ data: { configured: true, problems: [] } });
  getCurrentSing.mockResolvedValue({ data: { sing: null } });
  // This browser holds no `music.view`, so the player never asks — mocked all
  // the same, so a capability added to the list above cannot reach real fetch.
  getMusic.mockResolvedValue({
    data: {
      status: "off",
      track: null,
      blocked_by: null,
      resume_at: null,
      retry_at: null,
      sink_online: false,
      sink_generation: 0,
      volume: { master: 100, music: 60, effects: 80 },
      scope: "all",
    },
  });
  listKaraokeColors.mockResolvedValue({ data: { colors: [] } });
  listSongs.mockResolvedValue({ data: { songs: [] } });
  listWishlist.mockResolvedValue({ data: { wishes: [] } });
});

afterEach(() => vi.unstubAllGlobals());

function renderHome() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("the stage shows the app's identity while nothing plays", async () => {
  renderHome();

  expect(
    await screen.findByRole("heading", { name: "Ultrastar Wingman" }),
  ).toBeInTheDocument();
  // Version and repository moved to the About block on the User page — one
  // place each, not two.
  expect(screen.queryByText(/^Version /)).not.toBeInTheDocument();
});

test("the running song takes the stage in the identity's place", async () => {
  getCurrentSing.mockResolvedValue({
    data: {
      sing: {
        sing_id: "sing-1",
        started_at: new Date(Date.now() - 60_000).toISOString(),
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
        slots: [],
      },
    },
  });
  renderHome();

  await screen.findByRole("region", { name: "Now playing" });
  // The one heading is the player's own eyebrow, so it says what the block is
  // showing rather than the app's name.
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Now playing",
  );
});

test("the spinner is an entry to its own page, not a reel on Home", async () => {
  renderHome();

  const entry = await screen.findByRole("link", { name: "Random song" });
  expect(entry).toHaveAttribute("href", "/spinner");
  expect(entry).toHaveClass("home-random");
  expect(
    screen.queryByRole("button", { name: "Spin" }),
  ).not.toBeInTheDocument();
});

test("the die on the random song entry shows a face rolled on load", async () => {
  // Math.random at 0 rolls the first face, at the top end the last.
  const random = vi.spyOn(Math, "random").mockReturnValue(0);
  const first = renderHome();
  const entry = await screen.findByRole("link", { name: "Random song" });
  expect(iconNames(entry)).toEqual(["dice-1"]);
  first.unmount();

  random.mockReturnValue(0.99);
  renderHome();
  expect(
    iconNames(await screen.findByRole("link", { name: "Random song" })),
  ).toEqual(["dice-6"]);
  random.mockRestore();
});

test("the random song entry comes before the wishlist", async () => {
  renderHome();

  const entry = await screen.findByRole("link", { name: "Random song" });
  const wishlist = await screen.findByRole("heading", { name: "Wishlist" });

  expect(
    entry.compareDocumentPosition(wishlist) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
