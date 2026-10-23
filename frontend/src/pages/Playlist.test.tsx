import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { MeRead, PlaylistDetail, SongRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import { builtInTagRead, tagRead } from "../test/tags";
import Playlist from "./Playlist";

const {
  getMe,
  getPlaylist,
  addPlaylistEntry,
  removePlaylistEntry,
  reorderPlaylistEntries,
  followPlaylist,
  unfollowPlaylist,
  copyPlaylist,
  listPlaylists,
  listSongs,
  listFavorites,
  listWishlist,
  listSongScores,
  listPlayerScores,
  listTags,
  listTagAssignments,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  getPlaylist: vi.fn(),
  addPlaylistEntry: vi.fn(),
  removePlaylistEntry: vi.fn(),
  reorderPlaylistEntries: vi.fn(),
  followPlaylist: vi.fn(),
  unfollowPlaylist: vi.fn(),
  copyPlaylist: vi.fn(),
  listPlaylists: vi.fn(),
  listSongs: vi.fn(),
  listFavorites: vi.fn(),
  listWishlist: vi.fn(),
  listSongScores: vi.fn(),
  listPlayerScores: vi.fn(),
  listTags: vi.fn(),
  listTagAssignments: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  getPlaylist,
  addPlaylistEntry,
  removePlaylistEntry,
  reorderPlaylistEntries,
  followPlaylist,
  unfollowPlaylist,
  copyPlaylist,
  listPlaylists,
  listSongs,
  listFavorites,
  listWishlist,
  listSongScores,
  listPlayerScores,
  listTags,
  listTagAssignments,
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

const HEY = song({ id: "local:def", title: "Hey Jude", artist: "The Beatles" });

function detail(overrides: Partial<PlaylistDetail> = {}): PlaylistDetail {
  return {
    id: "p1",
    name: "Party",
    description: null,
    is_global: false,
    owner_username: "Alice",
    owner_player_id: null,
    song_count: 1,
    duration_seconds: 0,
    cover_song_ids: ["local:abc"],
    my_access: "owner",
    followed: true,
    can_edit: true,
    can_manage: true,
    contains: null,
    entries: [{ song: song(), position: 0 }],
    ...overrides,
  };
}

/** Two songs, so there is an order to change. */
function pair(overrides: Partial<PlaylistDetail> = {}): PlaylistDetail {
  return detail({
    song_count: 2,
    entries: [
      { song: song(), position: 0 },
      { song: HEY, position: 1 },
    ],
    ...overrides,
  });
}

/** Three songs, so a row can be moved without running out of arrows. */
function trio(overrides: Partial<PlaylistDetail> = {}): PlaylistDetail {
  return detail({
    song_count: 3,
    entries: [
      { song: song(), position: 0 },
      { song: HEY, position: 1 },
      { song: song({ id: "local:ghi", title: "Yesterday" }), position: 2 },
    ],
    ...overrides,
  });
}

/** Bob's list, shared with the reader — a member row, not ownership. */
const MEMBER: Partial<PlaylistDetail> = {
  my_access: "write",
  followed: true,
  can_edit: true,
  can_manage: false,
  owner_username: "Bob",
};

/** Bob's list, shared for reading only — a member row that changes nothing. */
const READER: Partial<PlaylistDetail> = {
  my_access: "read",
  followed: true,
  can_edit: false,
  can_manage: false,
  owner_username: "Bob",
};

/** Somebody else's global list: everybody may look, nobody else may change. */
const THEIRS: Partial<PlaylistDetail> = {
  is_global: true,
  my_access: null,
  followed: false,
  can_edit: false,
  can_manage: false,
  owner_username: "Bob",
};

function Probe() {
  return <p>at {useLocation().pathname}</p>;
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
          <Route path="*" element={<p>elsewhere</p>} />
        </Routes>
        <Probe />
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
    addPlaylistEntry,
    removePlaylistEntry,
    reorderPlaylistEntries,
    followPlaylist,
    unfollowPlaylist,
    copyPlaylist,
    listPlaylists,
    listSongs,
    listFavorites,
    listWishlist,
    listSongScores,
    listPlayerScores,
    listTags,
    listTagAssignments,
  ]) {
    mock.mockReset();
  }
  // No tags unless a test seeds them.
  listTags.mockResolvedValue({ data: { tags: [] } });
  listTagAssignments.mockResolvedValue({ data: { assignments: [] } });
  listPlaylists.mockResolvedValue({ data: { playlists: [] } });
  listSongs.mockResolvedValue({ data: { songs: [song(), HEY] } });
  listFavorites.mockResolvedValue({ data: { song_ids: [] } });
  listWishlist.mockResolvedValue({ data: { wishes: [] } });
  listSongScores.mockResolvedValue({ data: { scores: [] } });
  listPlayerScores.mockResolvedValue({ data: { scores: [] } });
});

afterEach(() => vi.unstubAllGlobals());

test("the playlist's songs are listed under its name", async () => {
  renderPlaylist(detail());

  expect(
    await screen.findByRole("heading", { name: "Party" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.getByText("Toto")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
    "href",
    "/songs/playlists",
  );
  expect(getPlaylist.mock.calls[0][0].path).toEqual({ playlist_id: "p1" });
});

test("the summary line says what the header cannot", async () => {
  renderPlaylist(
    pair({
      ...MEMBER,
      is_global: true,
      duration_seconds: 2880,
      description: "The good ones",
    }),
  );

  expect(await screen.findByText("The good ones")).toBeInTheDocument();
  expect(
    screen.getByText(
      "2 songs · 48 min · Global · shared by Bob · write access",
    ),
  ).toBeInTheDocument();
});

test("the header offers the reel with this playlist as its pool", async () => {
  renderPlaylist(detail());

  const spin = await screen.findByRole("link", {
    name: "Random song from this playlist",
  });
  expect(spin).toHaveAttribute("href", "/songs/playlists/p1/spinner");
  expect(iconNames(spin)).toEqual(["dice"]);
});

test("an empty playlist offers no reel: there would be nothing to pick", async () => {
  renderPlaylist(detail({ entries: [], song_count: 0 }));

  await screen.findByRole("heading", { name: "No songs yet" });
  expect(
    screen.queryByRole("link", { name: "Random song from this playlist" }),
  ).not.toBeInTheDocument();
  // Nor an Edit button: there is nothing to put in an order. Add songs stays.
  expect(
    screen.queryByRole("button", { name: "Edit" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add songs" })).toBeInTheDocument();
});

test("the gear leads to the manage page, and only for who may manage", async () => {
  renderPlaylist(detail());

  expect(
    await screen.findByRole("link", { name: "Manage playlist" }),
  ).toHaveAttribute("href", "/songs/playlists/p1/manage");
});

test("a global list nobody named the reader on has no gear and no action row", async () => {
  renderPlaylist(detail(THEIRS));

  await screen.findByText("Africa");
  expect(
    screen.queryByRole("link", { name: "Manage playlist" }),
  ).not.toBeInTheDocument();
  for (const name of ["Add songs", "Edit", "Follow", "Unfollow"]) {
    expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  }
});

test("read access is a way out of the list, not a way into it", async () => {
  // The one member row that may change nothing: it still gets Unfollow, which
  // is the whole point of being able to hide somebody else's list.
  renderPlaylist(detail(READER));

  expect(
    await screen.findByRole("button", { name: "Unfollow" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Manage playlist" }),
  ).not.toBeInTheDocument();
  for (const name of ["Add songs", "Edit"]) {
    expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  }
  expect(screen.getByText(/read access/)).toBeInTheDocument();
});

test("a write member edits the songs but does not manage the list", async () => {
  renderPlaylist(detail(MEMBER));

  expect(
    await screen.findByRole("button", { name: "Add songs" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Manage playlist" }),
  ).not.toBeInTheDocument();
});

test("tapping a song opens the details modal", async () => {
  renderPlaylist(detail());

  fireEvent.click(await screen.findByText("Africa"));

  expect(screen.getByRole("dialog", { name: "Africa" })).toBeInTheDocument();
});

test("edit mode turns every song into a reorder row", async () => {
  renderPlaylist(pair());

  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

  const done = screen.getByRole("button", { name: "Done" });
  expect(done).toHaveAttribute("aria-pressed", "true");
  // The grip for the pointer, the two arrows for the keyboard, the x to drop it.
  expect(
    screen.getByRole("button", { name: "Move Africa down" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Move Hey Jude up" }),
  ).toBeInTheDocument();
  // The first row cannot go up and the last cannot go down.
  expect(screen.getByRole("button", { name: "Move Africa up" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Move Hey Jude down" }),
  ).toBeDisabled();

  fireEvent.click(done);
  expect(
    screen.queryByRole("button", { name: "Move Africa down" }),
  ).not.toBeInTheDocument();
});

test("a reorder row is the song row it was, grip and controls apart", async () => {
  // The same `SongListItem` as outside edit mode, so a song does not lose its
  // marks — or move — the moment the reader starts sorting.
  listFavorites.mockResolvedValue({ data: { song_ids: ["local:abc"] } });
  renderPlaylist(pair());

  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

  expect(screen.getByTitle("In your favorites")).toBeInTheDocument();
  // And the row is still the way into the song.
  fireEvent.click(screen.getByText("Africa"));
  expect(screen.getByRole("dialog", { name: "Africa" })).toBeInTheDocument();
});

test("the arrows save the whole new order", async () => {
  reorderPlaylistEntries.mockResolvedValue({ data: pair() });
  renderPlaylist(pair());

  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Move Africa down" }));

  await waitFor(() =>
    expect(reorderPlaylistEntries.mock.calls[0][0]).toMatchObject({
      path: { playlist_id: "p1" },
      // The full permutation, which is what the endpoint takes.
      body: { song_ids: ["local:def", "local:abc"] },
    }),
  );
  // And the rows swapped under the reader's hands, not only on the server.
  const rows = screen.getAllByRole("button", { name: /^Move / });
  expect(rows[0]).toHaveAccessibleName("Move Hey Jude up");
});

test("keeps the keyboard on the arrow a move was made with", async () => {
  const rows = trio();
  reorderPlaylistEntries.mockResolvedValue({ data: rows });
  renderPlaylist(rows);

  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  const down = screen.getByRole("button", { name: "Move Africa down" });
  down.focus();
  fireEvent.click(down);

  // The row's own node moves and both its arrows are disabled while the order
  // is saved, and neither a moved nor a disabled control keeps the focus — so
  // without putting it back, a reader arranging by keyboard is dropped at the
  // top of the page after every press.
  await waitFor(() => expect(reorderPlaylistEntries).toHaveBeenCalled());
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Move Africa down" }),
    ).toBeEnabled(),
  );
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Move Africa down" }),
  );
});

test("leaves the focus where the reader took it while a move was saving", async () => {
  const rows = trio();
  reorderPlaylistEntries.mockResolvedValue({ data: rows });
  renderPlaylist(rows);

  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  const down = screen.getByRole("button", { name: "Move Africa down" });
  down.focus();
  fireEvent.click(down);
  // Somewhere else, by hand, before the answer lands.
  const done = screen.getByRole("button", { name: "Done" });
  done.focus();

  await waitFor(() => expect(reorderPlaylistEntries).toHaveBeenCalled());
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Move Africa down" }),
    ).toBeEnabled(),
  );
  expect(document.activeElement).toBe(done);
});

test("hands the keyboard the other arrow when a move uses one up", async () => {
  reorderPlaylistEntries.mockResolvedValue({ data: pair() });
  renderPlaylist(pair());

  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  const down = screen.getByRole("button", { name: "Move Africa down" });
  down.focus();
  fireEvent.click(down);

  // It now ends the list, so the arrow that got it there is disabled for good.
  // The focus goes to the row's other one rather than nowhere.
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Move Africa down" }),
    ).toBeDisabled(),
  );
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Move Africa up" }),
  );
});

test("an order the server refuses goes back where it was", async () => {
  reorderPlaylistEntries.mockRejectedValue({
    detail: "missing_permission:playlists.manage",
  });
  renderPlaylist(pair());

  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Move Africa down" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your role may not do this (playlists.manage)",
  );
  // Not left claiming an order the server never took.
  const moves = screen.getAllByRole("button", { name: /^Move / });
  expect(moves[0]).toHaveAccessibleName("Move Africa up");
});

test("a song the server would not drop comes back", async () => {
  removePlaylistEntry.mockRejectedValue({ detail: "not_found" });
  renderPlaylist(pair());

  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Remove Africa from the playlist" }),
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not remove the song.",
  );
  expect(screen.getByText("Africa")).toBeInTheDocument();
});

test("the x takes a song out of the list", async () => {
  removePlaylistEntry.mockResolvedValue({ data: undefined });
  renderPlaylist(pair());

  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Remove Africa from the playlist" }),
  );

  await waitFor(() =>
    expect(removePlaylistEntry.mock.calls[0][0].path).toEqual({
      playlist_id: "p1",
      song_id: "local:abc",
    }),
  );
  expect(screen.queryByText("Africa")).not.toBeInTheDocument();
});

test("outside edit mode a song row is a way into the song, not a control", async () => {
  renderPlaylist(pair());

  await screen.findByText("Africa");
  expect(
    screen.queryByRole("button", { name: "Remove Africa from the playlist" }),
  ).not.toBeInTheDocument();
});

test("Add songs searches the library and toggles membership", async () => {
  addPlaylistEntry.mockResolvedValue({ data: detail() });
  renderPlaylist(detail());

  fireEvent.click(await screen.findByRole("button", { name: "Add songs" }));
  const view = within(await screen.findByRole("dialog", { name: "Add songs" }));
  await view.findByRole("button", { name: /Hey Jude/ });

  // The song already on the list is pressed; the other one is not.
  const africa = view.getByRole("button", { name: /Africa/ });
  expect(africa).toHaveAttribute("aria-pressed", "true");
  expect(iconNames(africa)).toEqual(["list-check"]);
  expect(view.getByRole("button", { name: /Hey Jude/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  fireEvent.change(screen.getByLabelText("Search songs"), {
    target: { value: "beatles" },
  });
  expect(view.queryByText("Africa")).not.toBeInTheDocument();

  fireEvent.click(view.getByRole("button", { name: /Hey Jude/ }));
  await waitFor(() =>
    expect(addPlaylistEntry.mock.calls[0][0]).toMatchObject({
      path: { playlist_id: "p1" },
      body: { song_id: "local:def" },
    }),
  );
  // The sub-view stays open: adding a second song is one tap away.
  expect(screen.getByRole("dialog", { name: "Add songs" })).toBeInTheDocument();
});

test("Add songs lists the whole library, however big it is", async () => {
  // No cap and no "type to narrow it down": the songs page draws its own list
  // the same way, and a song held back is a song nobody can put on the list.
  const many = Array.from({ length: 120 }, (_, index) =>
    song({ id: `local:${index}`, title: `Song ${index}`, artist: "Nobody" }),
  );
  listSongs.mockResolvedValue({ data: { songs: many } });
  renderPlaylist(detail());

  fireEvent.click(await screen.findByRole("button", { name: "Add songs" }));
  const view = within(await screen.findByRole("dialog", { name: "Add songs" }));

  expect(
    await view.findByRole("button", { name: /Song 0/ }),
  ).toBeInTheDocument();
  expect(view.getByRole("button", { name: /Song 119/ })).toBeInTheDocument();
  expect(view.getAllByRole("button", { pressed: false })).toHaveLength(120);
  expect(screen.queryByText(/are shown/)).not.toBeInTheDocument();
});

test("Add songs says the library is empty rather than blaming a search", async () => {
  listSongs.mockResolvedValue({ data: { songs: [] } });
  renderPlaylist(detail());

  fireEvent.click(await screen.findByRole("button", { name: "Add songs" }));
  const view = within(await screen.findByRole("dialog", { name: "Add songs" }));

  expect(
    await view.findByText("The library is empty. There is nothing to add yet."),
  ).toBeInTheDocument();
  expect(view.queryByText("No song matches that.")).not.toBeInTheDocument();
});

test("Add songs blames the search once the library holds songs", async () => {
  renderPlaylist(detail());

  fireEvent.click(await screen.findByRole("button", { name: "Add songs" }));
  const view = within(await screen.findByRole("dialog", { name: "Add songs" }));
  await view.findByRole("button", { name: /Hey Jude/ });

  fireEvent.change(screen.getByLabelText("Search songs"), {
    target: { value: "nothing like this" },
  });

  expect(view.getByText("No song matches that.")).toBeInTheDocument();
  expect(view.queryByText(/The library is empty/)).not.toBeInTheDocument();
});

test("one song being added does not lock the rest of the library", async () => {
  // Filling a playlist is a run of taps: only the row waiting for its answer
  // goes quiet.
  addPlaylistEntry.mockReturnValue(new Promise(() => {}));
  renderPlaylist(detail());

  fireEvent.click(await screen.findByRole("button", { name: "Add songs" }));
  const view = within(await screen.findByRole("dialog", { name: "Add songs" }));
  fireEvent.click(await view.findByRole("button", { name: /Hey Jude/ }));

  await waitFor(() =>
    expect(view.getByRole("button", { name: /Hey Jude/ })).toBeDisabled(),
  );
  expect(view.getByRole("button", { name: /Africa/ })).toBeEnabled();
});

test("tapping a song that is already on the list takes it off", async () => {
  removePlaylistEntry.mockResolvedValue({ data: undefined });
  renderPlaylist(detail());

  fireEvent.click(await screen.findByRole("button", { name: "Add songs" }));
  const view = within(await screen.findByRole("dialog", { name: "Add songs" }));
  fireEvent.click(await view.findByRole("button", { name: /Africa/ }));

  await waitFor(() =>
    expect(removePlaylistEntry.mock.calls[0][0].path).toEqual({
      playlist_id: "p1",
      song_id: "local:abc",
    }),
  );
});

test("a member can drop a shared list out of their own listing", async () => {
  unfollowPlaylist.mockResolvedValue({ data: undefined });
  renderPlaylist(detail(MEMBER));

  const unfollow = await screen.findByRole("button", { name: "Unfollow" });
  expect(iconNames(unfollow)).toEqual(["bookmark-off"]);
  fireEvent.click(unfollow);

  await waitFor(() =>
    expect(unfollowPlaylist.mock.calls[0][0].path).toEqual({
      playlist_id: "p1",
    }),
  );
});

test("and take it back from wherever they hid it", async () => {
  followPlaylist.mockResolvedValue({ data: undefined });
  renderPlaylist(detail({ ...MEMBER, followed: false }));

  const follow = await screen.findByRole("button", { name: "Follow" });
  expect(iconNames(follow)).toEqual(["bookmark"]);
  fireEvent.click(follow);

  await waitFor(() =>
    expect(followPlaylist.mock.calls[0][0].path).toEqual({ playlist_id: "p1" }),
  );
});

test("the owner is not offered a follow button: there is no member row to flip", async () => {
  renderPlaylist(detail());

  await screen.findByText("Africa");
  expect(
    screen.queryByRole("button", { name: /^(Un)?[Ff]ollow$/ }),
  ).not.toBeInTheDocument();
});

test("Save a copy makes the copy the reader's own and opens it", async () => {
  copyPlaylist.mockResolvedValue({ data: detail({ id: "p7" }) });
  renderPlaylist(detail(THEIRS));

  fireEvent.click(await screen.findByRole("button", { name: "Save a copy" }));

  await waitFor(() =>
    expect(copyPlaylist.mock.calls[0][0]).toMatchObject({
      path: { playlist_id: "p1" },
    }),
  );
  // Nothing to say beyond the id: the copy keeps the default name.
  expect(copyPlaylist.mock.calls[0][0].body).toBeUndefined();
  expect(await screen.findByText("at /songs/playlists/p7")).toBeInTheDocument();
});

test("the copy opens as a list of its own, not as the one being edited", async () => {
  // The page stays mounted across the two ids, so edit mode has to end with the
  // list it belonged to: another list's order would draw this one half empty.
  copyPlaylist.mockResolvedValue({
    data: detail({ id: "p2", name: "Party 2" }),
  });
  renderPlaylist(pair());

  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: "Save a copy" }));

  expect(await screen.findByText("at /songs/playlists/p2")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Move Africa down" }),
  ).not.toBeInTheDocument();
});

test("without an account there is nothing to save a copy to", async () => {
  renderPlaylist(detail(THEIRS), LIBRARY, {
    user: null,
    role: "admin",
    is_host: true,
  });

  await screen.findByText("Africa");
  expect(
    screen.queryByRole("button", { name: "Save a copy" }),
  ).not.toBeInTheDocument();
});

test("an empty playlist says where songs come from", async () => {
  renderPlaylist(detail({ entries: [], song_count: 0 }));

  expect(
    await screen.findByRole("heading", { name: "No songs yet" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Add songs here/)).toBeInTheDocument();
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

test("a playlist song the reader sang before wears a microphone", async () => {
  listPlayerScores.mockResolvedValue({
    data: {
      scores: [
        {
          id: 1,
          sing_id: "sing-1",
          player_id: "aaa",
          player_name: "Alice",
          score: 8000,
          difficulty: 1,
          recorded_at: "2026-08-27T20:00:00Z",
          song: song(),
          sing_started_at: "2026-08-27T19:57:00Z",
        },
      ],
    },
  });
  renderPlaylist(detail(), [...LIBRARY, "stats.view"]);

  expect(await screen.findByTitle("You sang this")).toBeInTheDocument();
  // The wishlist check mark the row used to carry is gone.
  expect(screen.queryByTitle("On your wishlist")).not.toBeInTheDocument();
});

test("a change to this playlist somewhere else refetches it", async () => {
  renderPlaylist(detail());
  await screen.findByText("Africa");
  expect(getPlaylist).toHaveBeenCalledTimes(1);

  // Another list changing leaves this page's own query alone.
  FakeSocket.deliver({ event: "playlists.changed", playlist_id: "p2" });
  FakeSocket.deliver({ event: "playlists.changed", playlist_id: "p1" });
  await waitFor(() => expect(getPlaylist).toHaveBeenCalledTimes(2));

  // A null id means several lists changed at once, this one possibly among them.
  FakeSocket.deliver({ event: "playlists.changed", playlist_id: null });
  await waitFor(() => expect(getPlaylist).toHaveBeenCalledTimes(3));
});

test("a playlist keeps a hidden-by-default song and still marks it", async () => {
  listTags.mockResolvedValue({
    data: {
      tags: [
        tagRead({
          id: "t-archive",
          hide_by_default: true,
          show_in_list: true,
        }),
      ],
    },
  });
  listTagAssignments.mockResolvedValue({
    data: { assignments: [{ tag_id: "t-archive", song_ids: ["local:abc"] }] },
  });
  renderPlaylist(detail());

  // Somebody put it on this list on purpose, so the list shows it — the tag
  // only keeps songs out of the library's own list and the reel.
  const title = await screen.findByText("Africa");
  expect(iconNames(title.parentElement!)).toEqual(["archive"]);
});

test("a playlist row wears the built-in marks the party configured", async () => {
  listTags.mockResolvedValue({
    data: {
      tags: [],
      built_ins: [
        builtInTagRead({ color: "gold" }),
        builtInTagRead({ id: "sung", show_in_list: false }),
      ],
    },
  });
  listFavorites.mockResolvedValue({ data: { song_ids: ["local:abc"] } });
  const { container } = renderPlaylist(detail());

  await screen.findByText("Africa");
  expect(container.querySelector(".song-mark-favorite")).toHaveClass(
    "tag-color-gold",
  );
  // Sung is off the rows, so no microphone even where there would be one.
  expect(container.querySelector(".song-mark-sung")).toBeNull();
});
