import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import { FakeSocket } from "./test/fakeSocket";

// Home asks for the running song, the library, the wishlist and the version;
// this test only looks at the shell, so every one of them answers empty.
vi.mock("./api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api/sdk.gen")>()),
  health: vi.fn(async () => ({
    data: { name: "Ultrastar Wingman", version: "0.0.0" },
  })),
  getCurrentSing: vi.fn(async () => ({ data: { sing: null } })),
  listKaraokeColors: vi.fn(async () => ({ data: { colors: [] } })),
  listSongs: vi.fn(async () => ({ data: { songs: [] } })),
  listWishlist: vi.fn(async () => ({ data: { wishes: [] } })),
  getMe: vi.fn(async () => ({
    data: { user: null, role: "guest", capabilities: [], is_host: false },
  })),
  // The USDB page asks for these while /auth/me is still in flight.
  usdbStatus: vi.fn(async () => ({ data: { logged_in: false } })),
  listDownloads: vi.fn(async () => ({ data: { downloads: [] } })),
  listPlaylists: vi.fn(async () => ({ data: { playlists: [] } })),
}));

function renderApp(entry: string | { pathname: string; state?: unknown }) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[entry]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  // jsdom has no scrollTo; the USDB page calls it on page changes.
  vi.stubGlobal("scrollTo", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

test("the app shell shows all four navigation tabs", () => {
  renderApp("/");

  for (const label of ["Home", "Songs", "Scores", "User"]) {
    expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
  }
});

test("the user tab covers the settings page", () => {
  renderApp("/settings");

  expect(screen.getByRole("link", { name: "User" })).toHaveClass("active");
  expect(screen.getByRole("link", { name: "Home" })).not.toHaveClass("active");
});

test("a settings page nobody linked to is still the phone's own", async () => {
  renderApp("/settings");

  // The host view names its way back in the router state; a typed or shared URL
  // carries none, so the page keeps its own parent and its tab bar.
  expect(await screen.findByRole("link", { name: "Back" })).toHaveAttribute(
    "href",
    "/user",
  );
  expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
});

test("the songs tab covers the USDB explorer", () => {
  renderApp("/usdb");

  expect(screen.getByRole("link", { name: "Songs" })).toHaveClass("active");
});

test("the playlists view has a page of its own under the songs tab", async () => {
  renderApp("/songs/playlists");

  expect(
    await screen.findByRole("heading", { name: "Playlists" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Songs" })).toHaveClass("active");
});

test("the spinner has a page of its own under the home tab", () => {
  renderApp("/spinner");

  expect(
    screen.getByRole("heading", { name: "Random song" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Home" })).toHaveClass("active");
});

test("the host screen has no bottom navigation", () => {
  renderApp("/host");

  expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
  expect(screen.getByText("Scan to join")).toBeInTheDocument();
});

test("the host's manage view is a host page, so it has no tab bar", () => {
  renderApp("/host/manage");

  expect(screen.getByRole("heading", { name: "Manage" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
});

test("a page opened from the host view keeps the phone chrome away", async () => {
  renderApp({ pathname: "/settings", state: { back: "/host/manage" } });

  expect(await screen.findByRole("link", { name: "Back" })).toHaveAttribute(
    "href",
    "/host/manage",
  );
  expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
});
