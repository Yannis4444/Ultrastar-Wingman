import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { MeRead, PlaylistDetail, SongRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import Playlist from "./Playlist";

const {
  getMe,
  getPlaylist,
  removePlaylistEntry,
  listPlaylists,
  listFavorites,
  listWishlist,
  listSongScores,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  getPlaylist: vi.fn(),
  removePlaylistEntry: vi.fn(),
  listPlaylists: vi.fn(),
  listFavorites: vi.fn(),
  listWishlist: vi.fn(),
  listSongScores: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  getPlaylist,
  removePlaylistEntry,
  listPlaylists,
  listFavorites,
  listWishlist,
  listSongScores,
}));

const LIBRARY = [
  "songs.view",
  "playlists.view",
  "playlists.manage",
  "wishlist.view",
];
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
    song_count: 1,
    mine: true,
    entries: [{ song: song(), position: 0 }],
    ...overrides,
  };
}

function renderPlaylist(
  data: PlaylistDetail | Error,
  capabilities = LIBRARY,
  me: Partial<MeRead> = ACCOUNT,
) {
  getMe.mockResolvedValue(meResponse(capabilities, me));
  getPlaylist.mockImplementation(async () => {
    if (data instanceof Error) throw data;
    return { data };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/songs/playlists/p1"]}>
        <Routes>
          <Route path="/songs/playlists/:playlistId" element={<Playlist />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  for (const mock of [
    getMe,
    getPlaylist,
    removePlaylistEntry,
    listPlaylists,
    listFavorites,
    listWishlist,
    listSongScores,
  ]) {
    mock.mockReset();
  }
  listPlaylists.mockResolvedValue({ data: { playlists: [] } });
  listFavorites.mockResolvedValue({ data: { song_ids: [] } });
  listWishlist.mockResolvedValue({ data: { wishes: [] } });
  listSongScores.mockResolvedValue({ data: { scores: [] } });
});

afterEach(() => vi.unstubAllGlobals());

test("the playlist's songs are listed under its name", async () => {
  renderPlaylist(detail());

  expect(
    await screen.findByRole("heading", { name: "Party" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.getByText("Toto")).toBeInTheDocument();
  expect(screen.getByText("1 song")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
    "href",
    "/songs/playlists",
  );
  expect(getPlaylist.mock.calls[0][0].path).toEqual({ playlist_id: "p1" });
});

test("tapping a song opens the details modal", async () => {
  renderPlaylist(detail());

  fireEvent.click(await screen.findByText("Africa"));

  expect(screen.getByRole("dialog", { name: "Africa" })).toBeInTheDocument();
});

test("the owner removes an entry", async () => {
  removePlaylistEntry.mockResolvedValue({ data: undefined });
  renderPlaylist(detail());

  fireEvent.click(
    await screen.findByRole("button", {
      name: "Remove Africa from the playlist",
    }),
  );

  await waitFor(() =>
    expect(removePlaylistEntry.mock.calls[0][0].path).toEqual({
      playlist_id: "p1",
      song_id: "local:abc",
    }),
  );
});

test("somebody else's shared playlist has no remove control", async () => {
  renderPlaylist(detail({ shared: true, mine: false, owner_username: "Bob" }));

  await screen.findByText("Africa");
  expect(
    screen.queryByRole("button", { name: "Remove Africa from the playlist" }),
  ).not.toBeInTheDocument();
});

test("an empty playlist says where songs come from", async () => {
  renderPlaylist(detail({ entries: [], song_count: 0 }));

  expect(await screen.findByText(/This playlist is empty/)).toBeInTheDocument();
  // The sentence already says the playlist is empty; "0 songs" above it would
  // be the same fact twice.
  expect(screen.queryByText("0 songs")).not.toBeInTheDocument();
});

test("a deleted playlist points back at the list", async () => {
  renderPlaylist(new Error("gone"));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This playlist is gone.",
  );
  expect(
    screen.getByRole("link", { name: "Back to the playlists" }),
  ).toBeInTheDocument();
});

test("a role without playlists.view is told who may look", async () => {
  renderPlaylist(detail(), ["songs.view"], { user: null, role: "guest" });

  expect(
    await screen.findByText(/Playlists are not open to your role/),
  ).toBeInTheDocument();
  expect(getPlaylist).not.toHaveBeenCalled();
});
