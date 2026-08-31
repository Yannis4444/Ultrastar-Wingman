import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import Spinner from "./Spinner";

const { getMe, listSongs, listWishlist } = vi.hoisted(() => ({
  getMe: vi.fn(),
  listSongs: vi.fn(),
  listWishlist: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listSongs,
  listWishlist,
}));

function renderPage() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/spinner"]}>
        <Spinner />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("WebSocket", FakeSocket);
  getMe.mockResolvedValue(meResponse(["songs.view", "wishlist.view"]));
  listSongs.mockResolvedValue({ data: { songs: [] } });
  listWishlist.mockResolvedValue({ data: { wishes: [] } });
});

afterEach(() => vi.unstubAllGlobals());

test("the page carries the reel and a back link to home", async () => {
  renderPage();

  expect(
    screen.getByRole("heading", { name: "Random song" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
    "href",
    "/",
  );
  expect(await screen.findByRole("button", { name: "Spin" })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "Pick from" })).toHaveValue(
    "all",
  );
});

test("without songs.view the page says so and asks for nothing", async () => {
  getMe.mockResolvedValue(meResponse(["wishlist.view"]));
  renderPage();

  expect(
    await screen.findByText(/The song library is not open to your role/),
  ).toBeInTheDocument();
  expect(listSongs).not.toHaveBeenCalled();
});
