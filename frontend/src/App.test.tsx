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
}));

function renderApp(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.stubGlobal("WebSocket", FakeSocket));
afterEach(() => vi.unstubAllGlobals());

test("the app shell shows all four navigation tabs", () => {
  renderApp("/");

  for (const label of ["Home", "Songs", "Scores", "User"]) {
    expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
  }
});

test("the host screen has no bottom navigation", () => {
  renderApp("/host");

  expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
  expect(screen.getByText("Scan to join")).toBeInTheDocument();
});
