import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import Home from "./Home";

const {
  health,
  getMe,
  usdxStatus,
  getCurrentSing,
  listKaraokeColors,
  listSongs,
  listWishlist,
} = vi.hoisted(() => ({
  health: vi.fn(),
  getMe: vi.fn(),
  usdxStatus: vi.fn(),
  getCurrentSing: vi.fn(),
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
  listKaraokeColors,
  listSongs,
  listWishlist,
}));

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  health.mockResolvedValue({
    data: { name: "Ultrastar Wingman", version: "2.1.0" },
  });
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  usdxStatus.mockResolvedValue({ data: { configured: true, problems: [] } });
  getCurrentSing.mockResolvedValue({ data: { sing: null } });
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

test("the header shows the logo and the running version", async () => {
  renderHome();

  expect(
    screen.getByRole("img", { name: "Ultrastar Wingman" }),
  ).toHaveAttribute("src", "/logo.png");
  expect(await screen.findByText("Version 2.1.0")).toBeInTheDocument();
});

test("the spinner is an entry to its own page, not a reel on Home", async () => {
  renderHome();

  expect(
    await screen.findByRole("link", { name: "Random song" }),
  ).toHaveAttribute("href", "/spinner");
  expect(
    screen.queryByRole("button", { name: "Spin" }),
  ).not.toBeInTheDocument();
});
