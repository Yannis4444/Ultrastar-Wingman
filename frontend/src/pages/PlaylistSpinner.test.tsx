import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { MeRead, PlaylistDetail, SongRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import PlaylistSpinner from "./PlaylistSpinner";

const { getMe, getPlaylist, listSongs, listWishlist } = vi.hoisted(() => ({
  getMe: vi.fn(),
  getPlaylist: vi.fn(),
  listSongs: vi.fn(),
  listWishlist: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  getPlaylist,
  listSongs,
  listWishlist,
}));

const LIBRARY = ["songs.view", "playlists.view", "wishlist.view"];
const ACCOUNT: Partial<MeRead> = { user: userRead(), role: "user" };

function song(overrides: Partial<SongRead> = {}): SongRead {
  return {
    id: "local:abc",
    source: "local",
    title: "Africa",
    artist: "Toto",
    duration_seconds: 295,
    has_video: false,
    language: "English",
    genre: "Pop",
    year: 1982,
    edition: null,
    creator: null,
    ...overrides,
  };
}

function detail(overrides: Partial<PlaylistDetail> = {}): PlaylistDetail {
  return {
    id: "p1",
    name: "Party",
    shared: false,
    owner_username: "Alice",
    song_count: 2,
    mine: true,
    entries: [
      { song: song(), position: 0 },
      { song: song({ id: "local:def", title: "Hey Jude" }), position: 1 },
    ],
    ...overrides,
  };
}

function renderPage(
  data: PlaylistDetail | Error = detail(),
  capabilities = LIBRARY,
  me: Partial<MeRead> = ACCOUNT,
) {
  getMe.mockResolvedValue(meResponse(capabilities, me));
  getPlaylist.mockImplementation(async () => {
    if (data instanceof Error) throw data;
    return { data };
  });
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/songs/playlists/p1/spinner"]}>
        <Routes>
          <Route
            path="/songs/playlists/:playlistId/spinner"
            element={<PlaylistSpinner />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("WebSocket", FakeSocket);
  listSongs.mockResolvedValue({ data: { songs: [] } });
  listWishlist.mockResolvedValue({ data: { wishes: [] } });
});

afterEach(() => vi.unstubAllGlobals());

test("the playlist names the page and the reel can spin it", async () => {
  renderPage();

  expect(
    await screen.findByRole("heading", { name: "Party" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
    "href",
    "/songs/playlists/p1",
  );
  expect(screen.getByText("2 songs")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Spin" })).toBeEnabled();
});

test("the playlist is the scope, so no scope is offered", async () => {
  renderPage();

  await screen.findByRole("button", { name: "Spin" });
  expect(screen.queryByLabelText("All songs")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Wishlist")).not.toBeInTheDocument();
  // The songs came with the playlist — the library is never asked for.
  expect(listSongs).not.toHaveBeenCalled();
});

test("a deleted playlist points back at the list", async () => {
  renderPage(new Error("gone"));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This playlist is gone.",
  );
  expect(
    screen.getByRole("link", { name: "Back to the playlists" }),
  ).toBeInTheDocument();
});

test("a role without playlists.view is told who may look", async () => {
  renderPage(detail(), ["songs.view"], { user: null, role: "guest" });

  expect(
    await screen.findByText(/Playlists are not open to your role/),
  ).toBeInTheDocument();
  expect(getPlaylist).not.toHaveBeenCalled();
});
