import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MeRead, PlaylistRead, SongRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import Songs from "./Songs";

// The generated query options call the sdk and read `.data`, so the sdk is the
// seam: the real TanStack wiring runs, only the transport is faked. The rest of
// the module stays real so a new endpoint can't break this mock.
const {
  listSongs,
  rescanSongs,
  getMe,
  listWishlist,
  listFavorites,
  addFavorite,
  removeFavorite,
  listPlaylists,
  getPlaylist,
  createPlaylist,
  addPlaylistEntry,
  removePlaylistEntry,
  reorderPlaylistEntries,
} = vi.hoisted(() => ({
  listSongs: vi.fn(),
  rescanSongs: vi.fn(),
  getMe: vi.fn(),
  listWishlist: vi.fn(),
  listFavorites: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  listPlaylists: vi.fn(),
  getPlaylist: vi.fn(),
  createPlaylist: vi.fn(),
  addPlaylistEntry: vi.fn(),
  removePlaylistEntry: vi.fn(),
  reorderPlaylistEntries: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listSongs,
  rescanSongs,
  getMe,
  listWishlist,
  listFavorites,
  addFavorite,
  removeFavorite,
  listPlaylists,
  getPlaylist,
  createPlaylist,
  addPlaylistEntry,
  removePlaylistEntry,
  reorderPlaylistEntries,
}));

/** What the trusted role holds: enough for every button on this page. */
const TRUSTED = [
  "songs.view",
  "songs.rescan",
  "karaoke.sing",
  "usdb.search",
  "players.view",
];

function song(overrides: Partial<SongRead> = {}): SongRead {
  return {
    id: "usdb:1",
    source: "usdb",
    title: "Dancing Queen",
    artist: "ABBA",
    duration_seconds: 231,
    has_video: true,
    language: "English",
    genre: "Pop",
    year: 1976,
    edition: "SingStar",
    creator: "someone",
    ...overrides,
  };
}

function renderSongs(
  songs: SongRead[] | Error,
  capabilities = TRUSTED,
  me: Partial<MeRead> = {},
) {
  getMe.mockResolvedValue(meResponse(capabilities, me));
  listSongs.mockImplementation(async () => {
    if (songs instanceof Error) throw songs;
    return { data: { songs } };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {/* The "Explore USDB" link needs a router context. */}
      <MemoryRouter>
        <Songs />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function searchFor(text: string) {
  fireEvent.change(screen.getByRole("searchbox", { name: "Search songs" }), {
    target: { value: text },
  });
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  for (const mock of [
    listSongs,
    rescanSongs,
    getMe,
    listWishlist,
    listFavorites,
    addFavorite,
    removeFavorite,
    listPlaylists,
    getPlaylist,
    createPlaylist,
    addPlaylistEntry,
    removePlaylistEntry,
    reorderPlaylistEntries,
  ]) {
    mock.mockReset();
  }
  listWishlist.mockResolvedValue({ data: { wishes: [] } });
  listFavorites.mockResolvedValue({ data: { song_ids: [] } });
  listPlaylists.mockResolvedValue({ data: { playlists: [] } });
});

afterEach(() => vi.unstubAllGlobals());

test("songs from the API are listed with artist and duration", async () => {
  renderSongs([
    song(),
    song({
      id: "local:abc",
      title: "Africa",
      artist: "Toto",
      duration_seconds: 295,
      has_video: false,
    }),
  ]);

  expect(await screen.findByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.getByText("ABBA")).toBeInTheDocument();
  expect(screen.getByText("3:51")).toBeInTheDocument();
  expect(screen.getByText("4:55")).toBeInTheDocument();
  expect(screen.getByText("2 songs")).toBeInTheDocument();
  // Only the song that has one gets the badge.
  expect(screen.getAllByText("VIDEO")).toHaveLength(1);
});

test("the search box filters by title, artist and exact id", async () => {
  renderSongs([
    song(),
    song({ id: "local:abc", title: "Africa", artist: "Toto" }),
  ]);
  await screen.findByText("Dancing Queen");

  searchFor("toT");
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();
  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.getByText("1 song")).toBeInTheDocument();

  searchFor("queen");
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.queryByText("Africa")).not.toBeInTheDocument();

  searchFor("local:abc");
  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();

  searchFor("nothing matches this");
  expect(
    screen.getByText('No song matches "nothing matches this".'),
  ).toBeInTheDocument();
});

test("an empty library says so instead of showing an empty list", async () => {
  renderSongs([]);

  expect(await screen.findByText(/library is empty/)).toBeInTheDocument();
  expect(screen.getByText("0 songs")).toBeInTheDocument();
});

test("clicking a song opens the details modal", async () => {
  renderSongs([song()]);

  fireEvent.click(await screen.findByText("Dancing Queen"));

  const modal = screen.getByRole("dialog", { name: "Dancing Queen" });
  for (const value of ["ABBA", "3:51", "English", "Pop", "1976", "usdb:1"]) {
    expect(modal).toHaveTextContent(value);
  }

  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("missing metadata shows as unknown in the modal", async () => {
  renderSongs([song({ duration_seconds: null, genre: null, year: null })]);

  fireEvent.click(await screen.findByText("Dancing Queen"));

  const modal = screen.getByRole("dialog", { name: "Dancing Queen" });
  expect(modal).toHaveTextContent("--:--");
  expect(modal).toHaveTextContent("unknown");
});

test("escape closes the modal", async () => {
  renderSongs([song()]);

  fireEvent.click(await screen.findByText("Dancing Queen"));
  expect(screen.getByRole("dialog")).toBeInTheDocument();

  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("a failing songs request shows a styled error with a retry", async () => {
  renderSongs(new Error("boom"));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load the song library.",
  );
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
});

test("rescan reports a scan that is already running, then disables itself", async () => {
  renderSongs([song()]);
  await screen.findByText("Dancing Queen");
  rescanSongs.mockRejectedValue({ status: "running" });

  fireEvent.click(screen.getByRole("button", { name: "Rescan" }));

  expect(
    await screen.findByText("A scan is already running."),
  ).toBeInTheDocument();

  rescanSongs.mockResolvedValue({ data: { status: "started" } });
  fireEvent.click(screen.getByRole("button", { name: "Rescan" }));

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled(),
  );
});

test("a finished download refetches the song list", async () => {
  renderSongs([song()]);
  await screen.findByText("Dancing Queen");
  expect(listSongs).toHaveBeenCalledTimes(1);

  listSongs.mockResolvedValue({
    data: { songs: [song(), song({ id: "usdb:2", title: "Waterloo" })] },
  });
  // Still running: the song is not in the library yet, so nothing is refetched.
  FakeSocket.deliver({
    event: "download.updated",
    download: { id: 1, source: "usdb", source_song_id: "2", status: "running" },
  });
  expect(listSongs).toHaveBeenCalledTimes(1);

  FakeSocket.deliver({
    event: "download.updated",
    download: {
      id: 1,
      source: "usdb",
      source_song_id: "2",
      status: "finished",
      song_id: "usdb:2",
    },
  });

  expect(await screen.findByText("Waterloo")).toBeInTheDocument();
});

test("a finished scan refetches the song list", async () => {
  renderSongs([song()]);
  await screen.findByText("Dancing Queen");
  expect(listSongs).toHaveBeenCalledTimes(1);

  listSongs.mockResolvedValue({
    data: { songs: [song(), song({ id: "usdb:2", title: "Waterloo" })] },
  });
  // What the backend broadcasts on the shared socket when a scan completes.
  FakeSocket.deliver({
    event: "songs.scan_finished",
    added: 1,
    removed: 0,
    updated: 0,
    total: 2,
  });

  expect(await screen.findByText("Waterloo")).toBeInTheDocument();
});

test("the privileged buttons are gone for a role without the capability", async () => {
  renderSongs([song()], ["songs.view", "players.view"]);
  await screen.findByText("Dancing Queen");

  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Rescan" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("link", { name: "Explore USDB" }),
  ).not.toBeInTheDocument();

  // The song itself stays browsable — only the actions are gated.
  fireEvent.click(screen.getByText("Dancing Queen"));
  expect(
    screen.queryByRole("button", { name: "Sing" }),
  ).not.toBeInTheDocument();
});

test("a role with the capabilities gets rescan and sing", async () => {
  renderSongs([song()], ["songs.view", "songs.rescan", "karaoke.sing"]);
  await screen.findByText("Dancing Queen");

  expect(
    await screen.findByRole("button", { name: "Rescan" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByText("Dancing Queen"));
  expect(screen.getByRole("button", { name: "Sing" })).toBeInTheDocument();
});

test("a rescan denied by the backend explains the missing capability", async () => {
  renderSongs([song()]);
  await screen.findByText("Dancing Queen");
  rescanSongs.mockRejectedValue({ detail: "missing_permission:songs.rescan" });

  fireEvent.click(screen.getByRole("button", { name: "Rescan" }));

  expect(
    await screen.findByText(/may not do this \(songs\.rescan\)/),
  ).toBeInTheDocument();
});

// --- wishlist / favorites / playlists ----------------------------------------

/** What a logged-in `user` holds: the library features on top of TRUSTED. */
const LIBRARY = [
  ...TRUSTED,
  "wishlist.view",
  "wishlist.add",
  "playlists.view",
  "playlists.manage",
];
const ACCOUNT: Partial<MeRead> = { user: userRead(), role: "user" };

const QUEEN = song();
const AFRICA = song({ id: "local:abc", title: "Africa", artist: "Toto" });

function playlist(overrides: Partial<PlaylistRead> = {}): PlaylistRead {
  return {
    id: "p1",
    name: "Party",
    shared: false,
    owner_username: "Alice",
    song_count: 2,
    mine: true,
    ...overrides,
  };
}

test("the favorite heart flips before the request and back when it fails", async () => {
  renderSongs([QUEEN], LIBRARY, ACCOUNT);
  // Held open, so the optimistic state is observable before the failure.
  let refuse: (error: unknown) => void = () => {};
  addFavorite.mockReturnValue(
    new Promise((_resolve, reject) => {
      refuse = reject;
    }),
  );

  fireEvent.click(
    await screen.findByRole("button", {
      name: "Add Dancing Queen to favorites",
    }),
  );

  // Optimistic: the heart is filled while the request is still in flight.
  expect(
    await screen.findByRole("button", {
      name: "Remove Dancing Queen from favorites",
    }),
  ).toBeInTheDocument();
  expect(addFavorite.mock.calls[0][0].path).toEqual({ song_id: "usdb:1" });

  // Rolled back once the backend said no.
  refuse(new Error("boom"));
  expect(
    await screen.findByRole("button", {
      name: "Add Dancing Queen to favorites",
    }),
  ).toBeInTheDocument();
});

test("the favorites chip shows only the favorites", async () => {
  listFavorites.mockResolvedValue({ data: { song_ids: ["local:abc"] } });
  renderSongs([QUEEN, AFRICA], LIBRARY, ACCOUNT);
  await screen.findByText("Dancing Queen");

  fireEvent.click(await screen.findByRole("button", { name: "♥ Favorites" }));

  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();
  expect(screen.getByText("1 song")).toBeInTheDocument();
});

test("an anonymous browser gets no hearts and no favorites chip", async () => {
  renderSongs([QUEEN], TRUSTED);
  await screen.findByText("Dancing Queen");

  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "♥ Favorites" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("button", { name: /favorites$/ }),
  ).not.toBeInTheDocument();
  expect(listFavorites).not.toHaveBeenCalled();
});

test("a playlist chip filters the list to its entries, shared ones are marked", async () => {
  listPlaylists.mockResolvedValue({
    data: {
      playlists: [
        playlist(),
        playlist({
          id: "p2",
          name: "Bobs mix",
          shared: true,
          mine: false,
          owner_username: "Bob",
          song_count: 1,
        }),
      ],
    },
  });
  getPlaylist.mockResolvedValue({
    data: { ...playlist(), entries: [{ song: AFRICA, position: 0 }] },
  });
  renderSongs([QUEEN, AFRICA], LIBRARY, ACCOUNT);
  await screen.findByText("Dancing Queen");

  expect(
    await screen.findByRole("button", { name: "Bobs mix Bob" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Party" }));

  expect(await screen.findByText("Africa")).toBeInTheDocument();
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();
  expect(screen.getByText("1 song")).toBeInTheDocument();
  expect(getPlaylist.mock.calls[0][0].path).toEqual({ playlist_id: "p1" });
});

test("the move buttons send the reordered ids", async () => {
  const detail = {
    ...playlist(),
    entries: [
      { song: QUEEN, position: 0 },
      { song: AFRICA, position: 1 },
    ],
  };
  listPlaylists.mockResolvedValue({ data: { playlists: [playlist()] } });
  getPlaylist.mockResolvedValue({ data: detail });
  reorderPlaylistEntries.mockResolvedValue({
    data: {
      ...detail,
      entries: [
        { song: AFRICA, position: 0 },
        { song: QUEEN, position: 1 },
      ],
    },
  });
  renderSongs([QUEEN, AFRICA], LIBRARY, ACCOUNT);
  fireEvent.click(await screen.findByRole("button", { name: "Party" }));
  await screen.findByText("Africa");

  // The first row cannot move up, the last cannot move down.
  expect(
    screen.getByRole("button", { name: "Move Dancing Queen up" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Move Africa down" }),
  ).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "Move Africa up" }));

  await waitFor(() =>
    expect(reorderPlaylistEntries.mock.calls[0][0]).toMatchObject({
      path: { playlist_id: "p1" },
      body: { song_ids: ["local:abc", "usdb:1"] },
    }),
  );
});

test("a playlist entry can be removed from the filtered list", async () => {
  listPlaylists.mockResolvedValue({ data: { playlists: [playlist()] } });
  getPlaylist.mockResolvedValue({
    data: { ...playlist(), entries: [{ song: AFRICA, position: 0 }] },
  });
  removePlaylistEntry.mockResolvedValue({ data: undefined });
  renderSongs([QUEEN, AFRICA], LIBRARY, ACCOUNT);
  fireEvent.click(await screen.findByRole("button", { name: "Party" }));

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

test("somebody else's shared playlist has no editing controls", async () => {
  const shared = playlist({
    id: "p2",
    name: "Bobs mix",
    shared: true,
    mine: false,
    owner_username: "Bob",
  });
  listPlaylists.mockResolvedValue({ data: { playlists: [shared] } });
  getPlaylist.mockResolvedValue({
    data: { ...shared, entries: [{ song: AFRICA, position: 0 }] },
  });
  renderSongs([QUEEN, AFRICA], LIBRARY, ACCOUNT);
  fireEvent.click(await screen.findByRole("button", { name: "Bobs mix Bob" }));

  await screen.findByText("Africa");
  expect(
    screen.queryByRole("button", { name: "Move Africa up" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Remove Africa from the playlist" }),
  ).not.toBeInTheDocument();
});

test("the song details add a song to one of my playlists", async () => {
  listPlaylists.mockResolvedValue({ data: { playlists: [playlist()] } });
  renderSongs([QUEEN], LIBRARY, ACCOUNT);
  fireEvent.click(await screen.findByText("Dancing Queen"));

  fireEvent.change(await screen.findByLabelText(/Add to playlist/), {
    target: { value: "p1" },
  });
  addPlaylistEntry.mockRejectedValue({ detail: "duplicate_entry" });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() =>
    expect(addPlaylistEntry.mock.calls[0][0]).toMatchObject({
      path: { playlist_id: "p1" },
      body: { song_id: "usdb:1" },
    }),
  );
  // A song that is already in the playlist is not an error worth shouting about.
  expect(
    await screen.findByText("That playlist already has this song."),
  ).toBeInTheDocument();
});

test("adding a song refreshes the playlist song count", async () => {
  listPlaylists.mockResolvedValue({
    data: { playlists: [playlist({ song_count: 0 })] },
  });
  renderSongs([QUEEN], LIBRARY, ACCOUNT);
  fireEvent.click(await screen.findByText("Dancing Queen"));

  fireEvent.change(await screen.findByLabelText(/Add to playlist/), {
    target: { value: "p1" },
  });
  addPlaylistEntry.mockResolvedValue({ data: { entries: [] } });
  listPlaylists.mockResolvedValue({
    data: { playlists: [playlist({ song_count: 1 })] },
  });
  // Only the fetches the click causes count; the two mounts already had theirs.
  listPlaylists.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  expect(await screen.findByText("Added to the playlist.")).toBeInTheDocument();
  // `song_count` lives on the list, not on the detail, so adding a song has to
  // invalidate the list too — otherwise the playlist dialog shows a stale count.
  await waitFor(() => expect(listPlaylists).toHaveBeenCalled());
});

test("the manage dialog creates a playlist", async () => {
  createPlaylist.mockResolvedValue({ data: playlist({ song_count: 0 }) });
  renderSongs([QUEEN], LIBRARY, ACCOUNT);

  fireEvent.click(await screen.findByRole("button", { name: "Playlists…" }));
  fireEvent.change(screen.getByLabelText("New playlist name"), {
    target: { value: "Party" },
  });
  fireEvent.click(screen.getByLabelText("Shared"));
  fireEvent.click(screen.getByRole("button", { name: "Create" }));

  await waitFor(() =>
    expect(createPlaylist.mock.calls[0][0].body).toEqual({
      name: "Party",
      shared: true,
    }),
  );
});
