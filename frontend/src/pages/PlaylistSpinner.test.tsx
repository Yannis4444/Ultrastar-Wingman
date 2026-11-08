import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { MeRead, PlaylistDetail, SongRead } from "../api";
import { AS, meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import PlaylistSpinner from "./PlaylistSpinner";

const {
  getMe,
  getPlaylist,
  listSongs,
  listWishlist,
  listFavorites,
  listKaraokeSlots,
  listPlayers,
  openPlayerSelection,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  getPlaylist: vi.fn(),
  listSongs: vi.fn(),
  listWishlist: vi.fn(),
  listFavorites: vi.fn(),
  listKaraokeSlots: vi.fn(),
  listPlayers: vi.fn(),
  openPlayerSelection: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  getPlaylist,
  listSongs,
  listWishlist,
  listFavorites,
  listKaraokeSlots,
  listPlayers,
  openPlayerSelection,
}));

const LIBRARY = ["songs.view", "playlists.view", "wishlist.view"];
const ACCOUNT: Partial<MeRead> = { user: userRead(), ...AS.user };

function song(overrides: Partial<SongRead> = {}): SongRead {
  return {
    id: "local:abc",
    source: "local",
    title: "Africa",
    artist: "Toto",
    duration_seconds: 295,
    has_video: false,
    is_duet: false,
    created_at: "2026-01-01T12:00:00Z",
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
    description: null,
    is_global: false,
    owner_username: "Alice",
    owner_player_id: null,
    song_count: 2,
    duration_seconds: 0,
    cover_song_ids: [],
    my_access: "owner",
    followed: true,
    can_edit: true,
    can_manage: true,
    contains: null,
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
  // Where the reel runs is kept per device: every test starts on this screen.
  window.localStorage.clear();
  vi.stubGlobal("WebSocket", FakeSocket);
  listSongs.mockResolvedValue({ data: { songs: [] } });
  listWishlist.mockResolvedValue({ data: { wishes: [] } });
  listFavorites.mockResolvedValue({ data: { song_ids: [] } });
  listKaraokeSlots.mockResolvedValue({
    data: { slots: [{ name: "blue", hex: "#048BB9" }], player_counts: [1] },
  });
  listPlayers.mockResolvedValue({ data: { players: [] } });
  openPlayerSelection.mockReturnValue(new Promise(() => {}));
});

afterEach(() => vi.unstubAllGlobals());

test("on the Host screen SPIN spins this playlist on the TV", async () => {
  renderPage(detail(), [...LIBRARY, "karaoke.sing"]);

  fireEvent.click(await screen.findByRole("radio", { name: "Host screen" }));
  const spin = screen.getByRole("button", { name: "Spin" });
  await waitFor(() => expect(spin).toBeEnabled());
  fireEvent.click(spin);

  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalledTimes(1));
  expect(openPlayerSelection.mock.calls[0][0].body.spin).toEqual({
    scope: "playlist",
    playlist_id: "p1",
  });
});

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
  expect(
    screen.queryByRole("combobox", { name: "Pick from" }),
  ).not.toBeInTheDocument();
  // The songs came with the playlist — neither the library nor the favorites
  // are asked for.
  expect(listSongs).not.toHaveBeenCalled();
  expect(listFavorites).not.toHaveBeenCalled();
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
  renderPage(detail(), ["songs.view"], { user: null, ...AS.guest });

  expect(
    await screen.findByText(/Playlists are not open to your role/),
  ).toBeInTheDocument();
  expect(getPlaylist).not.toHaveBeenCalled();
});
