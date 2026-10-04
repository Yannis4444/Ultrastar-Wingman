import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  BuiltInTagRead,
  MeRead,
  PlaylistRead,
  SingRead,
  SongRead,
  TagRead,
} from "../api";
import { shortTime } from "../duration";
import { ANY_VALUE } from "../tags";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import { builtInTagRead, builtInTagReads, tagRead } from "../test/tags";
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
  addPlaylistEntry,
  listCurrentSessionSings,
  listPlayerScores,
  listTags,
  listTagAssignments,
} = vi.hoisted(() => ({
  listSongs: vi.fn(),
  rescanSongs: vi.fn(),
  getMe: vi.fn(),
  listWishlist: vi.fn(),
  listFavorites: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  listPlaylists: vi.fn(),
  addPlaylistEntry: vi.fn(),
  listCurrentSessionSings: vi.fn(),
  listPlayerScores: vi.fn(),
  listTags: vi.fn(),
  listTagAssignments: vi.fn(),
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
  addPlaylistEntry,
  listCurrentSessionSings,
  listPlayerScores,
  listTags,
  listTagAssignments,
}));

/** What the trusted role holds: enough for every button on this page. */
const TRUSTED = [
  "songs.view",
  "songs.rescan",
  "karaoke.sing",
  "usdb.search",
  "players.view",
  "stats.view",
];

/**
 * The eight built-ins with every facet taken out of the filter. A page with
 * *nothing* to filter on needs it: the six facets are offered to everybody by
 * default, so a library alone is enough for a Filter chip.
 */
const NO_FACETS: BuiltInTagRead[] = builtInTagReads().map((row) =>
  row.kind === "mark" ? row : { ...row, show_in_filter: false },
);

function song(overrides: Partial<SongRead> = {}): SongRead {
  return {
    id: "usdb:1",
    source: "usdb",
    title: "Dancing Queen",
    artist: "ABBA",
    duration_seconds: 231,
    has_video: true,
    is_duet: false,
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
      {/* The playlists chip and the source picker's cards are links. */}
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
    addPlaylistEntry,
    listCurrentSessionSings,
    listPlayerScores,
    listTags,
    listTagAssignments,
  ]) {
    mock.mockReset();
  }
  // No tags unless a test seeds them: no row wears a mark and nothing is hidden.
  listTags.mockResolvedValue({ data: { tags: [] } });
  listTagAssignments.mockResolvedValue({ data: { assignments: [] } });
  listWishlist.mockResolvedValue({ data: { wishes: [] } });
  listFavorites.mockResolvedValue({ data: { song_ids: [] } });
  listPlaylists.mockResolvedValue({ data: { playlists: [] } });
  // Nothing sung: the recently-played chip is absent unless a test seeds sings.
  listCurrentSessionSings.mockResolvedValue({ data: { sings: [] } });
  // No history either, so no row wears a microphone unless a test says so.
  listPlayerScores.mockResolvedValue({ data: { scores: [] } });
});

afterEach(() => vi.unstubAllGlobals());

test("songs from the API are listed with artist", async () => {
  renderSongs([
    song(),
    song({
      id: "local:abc",
      title: "Africa",
      artist: "Toto",
      duration_seconds: 295,
      has_video: false,
      is_duet: false,
    }),
  ]);

  expect(await screen.findByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.getByText("ABBA")).toBeInTheDocument();
  // Duration lives in the details modal now, not in the row.
  expect(screen.queryByText("3:51")).not.toBeInTheDocument();
  expect(screen.getByText("2 songs")).toBeInTheDocument();
});

test("the reload button sits next to the song count, not in the toolbar", async () => {
  renderSongs([song()]);

  const count = await screen.findByText("1 song");
  const row = count.parentElement;
  expect(row).not.toBeNull();
  expect(
    within(row as HTMLElement).getByRole("button", { name: "Rescan" }),
  ).toBeInTheDocument();
  // The toolbar is the search field, nothing else.
  const toolbar = screen
    .getByRole("searchbox", { name: "Search songs" })
    .closest(".songs-toolbar") as HTMLElement;
  expect(
    within(toolbar).queryByRole("button", { name: "Rescan" }),
  ).not.toBeInTheDocument();
  expect(
    within(toolbar).queryByRole("button", { name: "Add songs" }),
  ).not.toBeInTheDocument();
});

test("the add button opens the source picker instead of jumping to USDB", async () => {
  renderSongs([song()]);

  const add = await screen.findByRole("button", { name: "Add songs" });
  // It sits with the library's own line, not in the search toolbar.
  expect(add.closest(".songs-count")).not.toBeNull();
  fireEvent.click(add);

  const dialog = await screen.findByRole("dialog", { name: "Add songs" });
  const usdb = within(dialog).getByRole("link", { name: /USDB/ });
  expect(usdb).toHaveAttribute("href", "/usdb");
  // The card explains what the source is, not just its name.
  expect(
    within(dialog).getByText(/Search usdb\.animux\.de/),
  ).toBeInTheDocument();
});

test("a role that may not search a source gets no add button", async () => {
  renderSongs([song()], ["songs.view", "songs.rescan"]);
  await screen.findByText("Dancing Queen");

  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Add songs" }),
    ).not.toBeInTheDocument(),
  );
});

test("a guest with no favorites, no playlists and no facets gets no filter chips", async () => {
  listTags.mockResolvedValue({ data: { tags: [], built_ins: NO_FACETS } });
  renderSongs([song()], TRUSTED);
  await screen.findByText("Dancing Queen");

  expect(
    screen.queryByRole("group", { name: "Filter" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "All" })).not.toBeInTheDocument();
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

test("the X clears the search and only stands while something is typed", async () => {
  renderSongs([
    song(),
    song({ id: "local:abc", title: "Africa", artist: "Toto" }),
  ]);
  await screen.findByText("Dancing Queen");

  // An X on an empty field would be a control that does nothing.
  expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();

  searchFor("toT");
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  const box = screen.getByRole("searchbox", { name: "Search songs" });
  expect(box).toHaveValue("");
  // The whole library is back, and the caret stays where typing goes on.
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(box).toHaveFocus();
  expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
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
  for (const value of ["ABBA", "English", "Pop", "1976", "usdb:1"]) {
    expect(modal).toHaveTextContent(value);
  }

  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("missing metadata shows as unknown in the modal", async () => {
  renderSongs([song({ duration_seconds: null, genre: null, year: null })]);

  fireEvent.click(await screen.findByText("Dancing Queen"));

  const modal = screen.getByRole("dialog", { name: "Dancing Queen" });
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

test("a song somebody deleted leaves the list", async () => {
  renderSongs([song(), song({ id: "usdb:2", title: "Waterloo" })]);
  await screen.findByText("Waterloo");

  listSongs.mockResolvedValue({ data: { songs: [song()] } });
  // What the backend broadcasts once a `songs.delete` holder removed one.
  FakeSocket.deliver({ event: "songs.deleted", song_id: "usdb:2" });

  await waitFor(() =>
    expect(screen.queryByText("Waterloo")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
});

test("a song somebody corrected shows its new title", async () => {
  renderSongs([song(), song({ id: "usdb:2", title: "Watrloo" })]);
  await screen.findByText("Watrloo");

  listSongs.mockResolvedValue({
    data: { songs: [song(), song({ id: "usdb:2", title: "Waterloo" })] },
  });
  // What the backend broadcasts once a `songs.edit` holder fixed the metadata.
  // The row carries the title, the artist and every facet the filter reads, so
  // the list is fetched again exactly as after a delete.
  FakeSocket.deliver({
    event: "songs.updated",
    song: song({ id: "usdb:2", title: "Waterloo" }),
  });

  expect(await screen.findByText("Waterloo")).toBeInTheDocument();
  expect(screen.queryByText("Watrloo")).not.toBeInTheDocument();
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
    screen.queryByRole("button", { name: "Add songs" }),
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

  // Favorites are set in the song's details; the row only shows the mark.
  fireEvent.click(await screen.findByText("Dancing Queen"));
  fireEvent.click(
    await screen.findByRole("button", { name: "Add to favorites" }),
  );

  // Optimistic: the modal button flips and the row mark appears in flight.
  expect(
    await screen.findByRole("button", { name: "Remove from favorites" }),
  ).toBeInTheDocument();
  expect(screen.getByTitle("In your favorites")).toBeInTheDocument();
  expect(addFavorite.mock.calls[0][0].path).toEqual({ song_id: "usdb:1" });

  // Rolled back once the backend said no.
  refuse(new Error("boom"));
  expect(
    await screen.findByRole("button", { name: "Add to favorites" }),
  ).toBeInTheDocument();
  expect(screen.queryByTitle("In your favorites")).not.toBeInTheDocument();
});

test("the favorites chip shows only the favorites", async () => {
  listFavorites.mockResolvedValue({ data: { song_ids: ["local:abc"] } });
  renderSongs([QUEEN, AFRICA], LIBRARY, ACCOUNT);
  await screen.findByText("Dancing Queen");

  fireEvent.click(await screen.findByRole("button", { name: "Favorites" }));

  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();
  expect(screen.getByText("1 song")).toBeInTheDocument();
});

test("an anonymous browser gets no hearts and no favorites chip", async () => {
  renderSongs([QUEEN], TRUSTED);
  await screen.findByText("Dancing Queen");

  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Favorites" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("button", { name: /favorites$/ }),
  ).not.toBeInTheDocument();
  expect(listFavorites).not.toHaveBeenCalled();
});

test("playlists are one link into their own view, never a chip per playlist", async () => {
  listPlaylists.mockResolvedValue({
    data: {
      playlists: [
        playlist(),
        playlist({
          id: "p2",
          name: "Bobs mix",
          is_global: true,
          my_access: null,
          followed: false,
          can_edit: false,
          can_manage: false,
        }),
      ],
    },
  });
  renderSongs([QUEEN, AFRICA], LIBRARY, ACCOUNT);
  await screen.findByText("Dancing Queen");

  expect(
    await screen.findByRole("link", { name: "Playlists" }),
  ).toHaveAttribute("href", "/songs/playlists");
  expect(
    screen.queryByRole("button", { name: "Party" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Bobs mix/ }),
  ).not.toBeInTheDocument();
  // It leaves the page instead of filtering it, so it is not part of the group
  // the two filter chips form.
  expect(
    within(screen.getByRole("group", { name: "Filter" })).queryByRole("link"),
  ).not.toBeInTheDocument();
});

test("a role without playlists.view gets no playlists link", async () => {
  renderSongs([QUEEN], TRUSTED, ACCOUNT);
  await screen.findByText("Dancing Queen");

  // Favorites need an account, so the chip row itself is there.
  await screen.findByRole("button", { name: "Favorites" });
  expect(
    screen.queryByRole("link", { name: "Playlists" }),
  ).not.toBeInTheDocument();
});

test("the song details add a song to one of my playlists", async () => {
  listPlaylists.mockResolvedValue({ data: { playlists: [playlist()] } });
  renderSongs([QUEEN], LIBRARY, ACCOUNT);
  fireEvent.click(await screen.findByText("Dancing Queen"));

  fireEvent.click(
    await screen.findByRole("button", { name: "Add to playlist" }),
  );
  addPlaylistEntry.mockRejectedValue({ detail: "duplicate_entry" });
  const picker = screen.getByRole("dialog", { name: "Add to playlist" });
  // The listing is only asked for once the picker opens, so the row arrives.
  fireEvent.click(await within(picker).findByRole("button", { name: /Party/ }));

  await waitFor(() =>
    expect(addPlaylistEntry.mock.calls[0][0]).toMatchObject({
      path: { playlist_id: "p1" },
      body: { song_id: "usdb:1" },
    }),
  );
  // A song that is already in the playlist is not an error worth shouting
  // about: the row just shows the check.
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
});

test("adding a song refreshes the playlist song count", async () => {
  listPlaylists.mockResolvedValue({
    data: { playlists: [playlist({ song_count: 0 })] },
  });
  renderSongs([QUEEN], LIBRARY, ACCOUNT);
  fireEvent.click(await screen.findByText("Dancing Queen"));

  fireEvent.click(
    await screen.findByRole("button", { name: "Add to playlist" }),
  );
  addPlaylistEntry.mockResolvedValue({ data: { entries: [] } });
  const picker = screen.getByRole("dialog", { name: "Add to playlist" });
  const row = await within(picker).findByRole("button", { name: /Party/ });
  listPlaylists.mockResolvedValue({
    data: { playlists: [playlist({ song_count: 1 })] },
  });
  // Only the fetches the click causes count; the mount and the picker already
  // had theirs.
  listPlaylists.mockClear();
  fireEvent.click(row);

  // `song_count` lives on the list, not on the detail, so adding a song has to
  // invalidate the list too — otherwise the playlist dialog shows a stale count.
  await waitFor(() => expect(listPlaylists).toHaveBeenCalled());
});

const AT_QUEEN = "2026-08-26T20:40:00Z";
const AT_AFRICA = "2026-08-26T20:10:00Z";

function sing(overrides: Partial<SingRead> = {}): SingRead {
  return {
    sing_id: "sing-1",
    song_id: QUEEN.id,
    song: QUEEN,
    started_at: AT_QUEEN,
    ...overrides,
  };
}

/** The backend already orders and deduplicates; the page shows what it sends. */
function playedQueenThenAfrica() {
  listCurrentSessionSings.mockResolvedValue({
    data: {
      sings: [
        sing(),
        sing({
          sing_id: "sing-2",
          song_id: AFRICA.id,
          song: AFRICA,
          started_at: AT_AFRICA,
        }),
      ],
    },
  });
}

test("the recently played tab lists this session's songs with the time they started", async () => {
  playedQueenThenAfrica();
  const THIRD = song({
    id: "local:zzz",
    title: "Never Sung",
    artist: "Nobody",
  });
  // The library order is the reverse of the play order, so the assertion below
  // can only pass if the tab follows the endpoint and not the library.
  renderSongs([AFRICA, QUEEN, THIRD]);
  await screen.findByText("Dancing Queen");

  fireEvent.click(await screen.findByRole("button", { name: "Recent" }));

  // Newest first, exactly the order the endpoint sent — and only what was sung.
  const rows = screen.getAllByRole("button", {
    name: /Dancing Queen|Africa|Never Sung/,
  });
  expect(rows.map((row) => row.textContent)).toEqual([
    expect.stringContaining("Dancing Queen"),
    expect.stringContaining("Africa"),
  ]);
  expect(screen.queryByText("Never Sung")).not.toBeInTheDocument();
  // The clock time, not a "3 minutes ago" that would need a ticking timer.
  expect(screen.getByText(shortTime(AT_QUEEN))).toBeInTheDocument();
  expect(screen.getByText(shortTime(AT_AFRICA))).toBeInTheDocument();
  expect(screen.getByText("2 songs")).toBeInTheDocument();
});

test("only the recently played tab shows a time next to the row", async () => {
  playedQueenThenAfrica();
  renderSongs([QUEEN, AFRICA]);
  await screen.findByText("Dancing Queen");

  expect(screen.queryByText(shortTime(AT_QUEEN))).not.toBeInTheDocument();
});

test("a song whose file left the library is left out of the recently played tab", async () => {
  listCurrentSessionSings.mockResolvedValue({
    data: {
      sings: [
        sing({ sing_id: "sing-gone", song_id: "usdb:gone", song: null }),
        sing({
          sing_id: "sing-2",
          song_id: AFRICA.id,
          song: AFRICA,
          started_at: AT_AFRICA,
        }),
      ],
    },
  });
  renderSongs([AFRICA]);
  await screen.findByText("Africa");

  fireEvent.click(await screen.findByRole("button", { name: "Recent" }));

  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.getByText("1 song")).toBeInTheDocument();
});

test("the search box filters inside the recently played tab", async () => {
  playedQueenThenAfrica();
  renderSongs([QUEEN, AFRICA]);
  await screen.findByText("Dancing Queen");
  fireEvent.click(await screen.findByRole("button", { name: "Recent" }));

  searchFor("toT");

  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();

  searchFor("nothing matches this");
  expect(
    screen.getByText('No song matches "nothing matches this".'),
  ).toBeInTheDocument();
});

test("nothing sung yet means no recently played chip at all", async () => {
  renderSongs([QUEEN, AFRICA], LIBRARY, ACCOUNT);
  await screen.findByText("Dancing Queen");

  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Recent" }),
    ).not.toBeInTheDocument(),
  );
});

test("the tab a reader is standing on stays, and says the party is empty", async () => {
  playedQueenThenAfrica();
  renderSongs([QUEEN, AFRICA]);
  await screen.findByText("Dancing Queen");
  fireEvent.click(await screen.findByRole("button", { name: "Recent" }));

  // The party ended between two refetches: the list empties under the finger.
  listCurrentSessionSings.mockResolvedValue({ data: { sings: [] } });
  FakeSocket.deliver({
    event: "karaoke.ended",
    sing_id: "s",
    song_id: "usdb:1",
  });

  expect(
    await screen.findByText("Nothing has been sung yet."),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Recent" })).toBeInTheDocument();
});

test("a song starting refetches what was recently played", async () => {
  playedQueenThenAfrica();
  renderSongs([QUEEN, AFRICA]);
  await screen.findByRole("button", { name: "Recent" });
  listCurrentSessionSings.mockClear();

  FakeSocket.deliver({ event: "karaoke.started" });

  await waitFor(() => expect(listCurrentSessionSings).toHaveBeenCalled());
});

test("a role without stats.view never asks what was played", async () => {
  playedQueenThenAfrica();
  renderSongs([QUEEN], ["songs.view"]);
  await screen.findByText("Dancing Queen");

  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Recent" }),
    ).not.toBeInTheDocument(),
  );
  expect(listCurrentSessionSings).not.toHaveBeenCalled();
});

// --- sung before -------------------------------------------------------------

/** One score of the reader's own on `song`, which is what "sung" is made of. */
function score(song: SongRead) {
  return {
    id: 1,
    sing_id: "sing-1",
    player_id: "aaa",
    player_name: "Alice",
    score: 8000,
    difficulty: 1,
    recorded_at: "2026-08-27T20:00:00Z",
    song,
    sing_started_at: "2026-08-27T19:57:00Z",
  };
}

test("a song the reader sang before wears a microphone", async () => {
  listPlayerScores.mockResolvedValue({ data: { scores: [score(AFRICA)] } });
  renderSongs([QUEEN, AFRICA], LIBRARY, ACCOUNT);
  await screen.findByText("Dancing Queen");

  const mark = await screen.findByTitle("You sang this");
  expect(mark.closest("button")).toHaveTextContent("Africa");
  expect(listPlayerScores.mock.calls[0][0].path).toEqual({ player_id: "aaa" });
  // The wishlist check mark the row used to carry is gone.
  expect(screen.queryByTitle("On your wishlist")).not.toBeInTheDocument();
});

test("the sung chip shows only what the reader sang", async () => {
  listPlayerScores.mockResolvedValue({ data: { scores: [score(AFRICA)] } });
  renderSongs([QUEEN, AFRICA], LIBRARY, ACCOUNT);
  await screen.findByText("Dancing Queen");

  fireEvent.click(await screen.findByRole("button", { name: "Sung" }));

  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();
  expect(screen.getByText("1 song")).toBeInTheDocument();
});

test("a fresh score of the reader's own refetches the sung songs", async () => {
  renderSongs([QUEEN], LIBRARY, ACCOUNT);
  await screen.findByRole("button", { name: "Sung" });
  listPlayerScores.mockClear();

  FakeSocket.deliver({ event: "scores.recorded", sing_id: "sing-1" });

  await waitFor(() => expect(listPlayerScores).toHaveBeenCalled());
});

test("an account with no player behind it gets no sung chip", async () => {
  renderSongs([QUEEN], LIBRARY, {
    user: userRead({ player_id: null }),
    role: "user",
  });
  await screen.findByText("Dancing Queen");

  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Sung" }),
    ).not.toBeInTheDocument(),
  );
  expect(listPlayerScores).not.toHaveBeenCalled();
});

test("only the pressed filter wears its label, the rest are their glyph", async () => {
  renderSongs([QUEEN], LIBRARY, ACCOUNT);
  await screen.findByText("Dancing Queen");

  // "All" is pressed and has no glyph of its own, so it is the only word.
  const favorites = await screen.findByRole("button", { name: "Favorites" });
  const sung = screen.getByRole("button", { name: "Sung" });
  // Exactly, not `toHaveTextContent("")` — that one passes for any element.
  // The glyph is an SVG, so an icon-only chip holds no text at all.
  expect(screen.getByRole("button", { name: "All" }).textContent).toBe("All");
  expect(favorites.textContent).toBe("");
  expect(sung.textContent).toBe("");

  // Pressing one hands it the label and takes "All" nothing away — it has no
  // icon to shrink to.
  fireEvent.click(sung);
  expect(sung.textContent).toBe("Sung");
  expect(favorites.textContent).toBe("");
  expect(screen.getByRole("button", { name: "All" }).textContent).toBe("All");
});

/** Seed the two tag listings the page reads through `useTags`. */
function withTags(
  tags: TagRead[],
  assignments: { tag_id: string; song_ids: string[] }[] = [],
  builtIns: BuiltInTagRead[] = builtInTagReads(),
) {
  listTags.mockResolvedValue({ data: { tags, built_ins: builtIns } });
  listTagAssignments.mockResolvedValue({ data: { assignments } });
}

test("a hidden-by-default tag keeps its songs out of the list and the count", async () => {
  withTags(
    [tagRead({ id: "t-archive", hide_by_default: true })],
    [{ tag_id: "t-archive", song_ids: ["local:abc"] }],
  );
  renderSongs([QUEEN, AFRICA]);

  expect(await screen.findByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.queryByText("Africa")).not.toBeInTheDocument();
  expect(screen.getByText("1 song")).toBeInTheDocument();
});

test("a hidden-by-default tag hides its songs from the other filters too", async () => {
  withTags(
    [tagRead({ id: "t-archive", hide_by_default: true })],
    [{ tag_id: "t-archive", song_ids: ["local:abc"] }],
  );
  listFavorites.mockResolvedValue({ data: { song_ids: ["local:abc"] } });
  renderSongs([QUEEN, AFRICA], LIBRARY, ACCOUNT);

  fireEvent.click(await screen.findByRole("button", { name: "Favorites" }));

  // The one favorite is archived, so the tab is empty — and says why, rather
  // than claiming nothing has been favorited.
  expect(
    await screen.findByText(
      "Every song here carries a tag that keeps it out of the list.",
    ),
  ).toBeInTheDocument();
});

test("a tag the reader may not view hides nothing: the server decides that", async () => {
  // What a `tags.manage` holder is handed for a tag they took their own "See
  // tag" away from. Its songs are only missing if the *backend* left them out.
  withTags(
    [
      tagRead({
        id: "t-secret",
        name: "scratch",
        can_view: false,
        hide_by_default: true,
        show_in_list: true,
      }),
    ],
    [{ tag_id: "t-secret", song_ids: ["local:abc"] }],
  );
  renderSongs([QUEEN, AFRICA]);

  expect(await screen.findByText("Africa")).toBeInTheDocument();
  expect(screen.getByText("2 songs")).toBeInTheDocument();
  expect(iconNames(screen.getByText("Africa").parentElement!)).toEqual([]);
});

test("a show-in-list tag rides on the row it belongs to", async () => {
  withTags(
    [
      tagRead({
        id: "t-broken",
        name: "broken",
        icon: "alert",
        color: "gold",
        show_in_list: true,
      }),
      tagRead({ id: "t-quiet", name: "quiet", icon: "music" }),
    ],
    [
      { tag_id: "t-broken", song_ids: ["local:abc"] },
      { tag_id: "t-quiet", song_ids: ["local:abc"] },
    ],
  );
  renderSongs([QUEEN, AFRICA]);

  const africa = await screen.findByText("Africa");
  // Only the tag that asked for the row, and nothing on the untagged song.
  expect(iconNames(africa.parentElement!)).toEqual(["alert"]);
  expect(iconNames(screen.getByText("Dancing Queen").parentElement!)).toEqual(
    [],
  );
});

// --- the filter chip and its panel -------------------------------------------

const ARCHIVE = tagRead({
  id: "t-archive",
  name: "archive",
  hide_by_default: true,
});
const PARTY = tagRead({
  id: "t-party",
  name: "party",
  icon: "users",
  color: "blue",
});

/** Open the Filter panel and hand back the dialog. */
async function openFilter() {
  fireEvent.click(await screen.findByRole("button", { name: "Filter" }));
  return screen.getByRole("dialog", { name: "Filter" });
}

/** The panel's cycling chip for one criterion, whatever state it is in: its
 *  name is the criterion's followed by *Any*, *Yes* or *No*. */
function filterChip(dialog: HTMLElement, criterion: string) {
  return within(dialog).getByRole("button", {
    name: (name) =>
      [" Any", " Yes", " No"].some((state) => name === criterion + state),
  });
}

/** Whether the panel offers a cycling chip for this criterion at all. */
function hasFilterChip(dialog: HTMLElement, criterion: string) {
  return (
    within(dialog).queryByRole("button", {
      name: (name) =>
        [" Any", " Yes", " No"].some((state) => name === criterion + state),
    }) !== null
  );
}

/** Set one criterion the way a reader does: tap its chip round until it says
 *  what we want — three taps at most, Any → Yes → No → Any. */
function setCriterion(dialog: HTMLElement, criterion: string, state: string) {
  for (let tap = 0; tap < 3; tap++) {
    const chip = filterChip(dialog, criterion);
    if (chip.textContent === `${criterion} ${state}`) return;
    fireEvent.click(chip);
  }
  expect(filterChip(dialog, criterion).textContent).toBe(
    `${criterion} ${state}`,
  );
}

test("the filter panel lists the marks, the facets and every tag the reader may see", async () => {
  withTags([
    ARCHIVE,
    PARTY,
    tagRead({ id: "t-secret", name: "scratch", can_view: false }),
  ]);
  renderSongs([QUEEN, AFRICA], LIBRARY, ACCOUNT);
  await screen.findByText("Dancing Queen");

  const dialog = await openFilter();

  // §7's order: the two marks and the facets in Built-in order in the first
  // cloud, the tags in the second — and nothing the reader may not view.
  expect(
    within(dialog)
      .getAllByRole("group")
      .map((group) => group.getAttribute("aria-label")),
  ).toEqual(["Built-in", "Tags"]);
  const builtIn = within(dialog).getByRole("group", { name: "Built-in" });
  expect(
    within(builtIn)
      .getAllByRole("button")
      .map((chip) => chip.textContent),
  ).toEqual(["Favorites Any", "Sung Any", "Duet Any", "Video Any"]);
  // A valued facet is the select chip, not a cycling one.
  expect(
    within(builtIn)
      .getAllByRole("combobox")
      .map((select) => select.getAttribute("aria-label")),
  ).toEqual(["Genre", "Language", "Edition", "Decade"]);

  // A hide-by-default tag opens on No, everything else on Any.
  expect(
    within(within(dialog).getByRole("group", { name: "Tags" }))
      .getAllByRole("button")
      .map((chip) => chip.textContent),
  ).toEqual(["archive No", "party Any"]);
  expect(hasFilterChip(dialog, "scratch")).toBe(false);
});

test("a browser with no account gets the tags but neither mark chip", async () => {
  withTags([PARTY]);
  renderSongs([QUEEN], TRUSTED);
  await screen.findByText("Dancing Queen");

  const dialog = await openFilter();

  expect(hasFilterChip(dialog, "party")).toBe(true);
  expect(hasFilterChip(dialog, "Favorites")).toBe(false);
  expect(hasFilterChip(dialog, "Sung")).toBe(false);
});

test("nothing to filter on means no Filter chip at all", async () => {
  // No account, no tags — and a party that took every facet out of the filter.
  listTags.mockResolvedValue({ data: { tags: [], built_ins: NO_FACETS } });
  renderSongs([QUEEN], TRUSTED);
  await screen.findByText("Dancing Queen");

  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Filter" }),
    ).not.toBeInTheDocument(),
  );
});

test("a cycling chip narrows the list, the count and the chip's label", async () => {
  withTags([PARTY], [{ tag_id: "t-party", song_ids: ["local:abc"] }]);
  renderSongs([QUEEN, AFRICA]);
  await screen.findByText("Dancing Queen");
  // Nothing is off Any yet, so All is the pressed chip and Filter is a glyph.
  expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "Filter" }).textContent).toBe("");

  const dialog = await openFilter();
  setCriterion(dialog, "party", "Yes");

  // The list behind the panel follows straight away — no Done to press first.
  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();
  expect(screen.getByText("1 song")).toBeInTheDocument();
  const filter = screen.getByRole("button", { name: "Filter" });
  expect(filter).toHaveAttribute("aria-pressed", "true");
  expect(filter.textContent).toBe("Filter · 1");
  expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  setCriterion(dialog, "party", "No");
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.queryByText("Africa")).not.toBeInTheDocument();

  // Back on its own default, so the state is the All preset again.
  setCriterion(dialog, "party", "Any");
  expect(screen.getByText("2 songs")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a tag nobody here may set filters like any other", async () => {
  // The Filter panel asks about the tags a reader may *view* (§7): whether they
  // could put this one on a song is a different right and no business of a row.
  const locked = tagRead({ ...PARTY, can_assign: false });
  withTags([locked], [{ tag_id: "t-party", song_ids: ["local:abc"] }]);
  renderSongs([QUEEN, AFRICA]);
  await screen.findByText("Dancing Queen");

  const dialog = await openFilter();
  setCriterion(dialog, "party", "Yes");

  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Filter" }).textContent).toBe(
    "Filter · 1",
  );
});

test("the Filter chip counts the hiding nobody had to ask for", async () => {
  withTags(
    [ARCHIVE, PARTY],
    [{ tag_id: "t-archive", song_ids: ["local:abc"] }],
  );
  renderSongs([QUEEN, AFRICA]);
  await screen.findByText("Dancing Queen");

  const dialog = await openFilter();
  setCriterion(dialog, "party", "Yes");

  // Two criteria are narrowing the list: the party Yes and the archive No that
  // was there before anybody opened the panel.
  expect(screen.getByRole("button", { name: "Filter" }).textContent).toBe(
    "Filter · 2",
  );

  // Asking for the archived songs takes the count back down.
  setCriterion(dialog, "archive", "Any");
  expect(screen.getByRole("button", { name: "Filter" }).textContent).toBe(
    "Filter · 1",
  );
});

test("Reset puts every criterion back, the hidden-by-default ones included", async () => {
  withTags(
    [ARCHIVE, PARTY],
    [{ tag_id: "t-archive", song_ids: ["local:abc"] }],
  );
  renderSongs([QUEEN, AFRICA], LIBRARY, ACCOUNT);
  await screen.findByText("Dancing Queen");

  const dialog = await openFilter();
  setCriterion(dialog, "archive", "Any");
  setCriterion(dialog, "party", "No");
  expect(screen.getByText("2 songs")).toBeInTheDocument();

  fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));

  expect(filterChip(dialog, "archive").textContent).toBe("archive No");
  expect(filterChip(dialog, "party").textContent).toBe("party Any");
  expect(screen.getByText("1 song")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("Done only closes: the criteria were applied while the panel was open", async () => {
  withTags([PARTY], [{ tag_id: "t-party", song_ids: ["local:abc"] }]);
  renderSongs([QUEEN, AFRICA]);
  await screen.findByText("Dancing Queen");

  const dialog = await openFilter();
  setCriterion(dialog, "party", "Yes");
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

  expect(
    screen.queryByRole("dialog", { name: "Filter" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.getByText("1 song")).toBeInTheDocument();
});

test("a preset chip replaces whatever the panel was set to", async () => {
  withTags([PARTY], [{ tag_id: "t-party", song_ids: [QUEEN.id] }]);
  listFavorites.mockResolvedValue({ data: { song_ids: ["local:abc"] } });
  renderSongs([QUEEN, AFRICA], LIBRARY, ACCOUNT);
  await screen.findByText("Dancing Queen");

  const dialog = await openFilter();
  setCriterion(dialog, "party", "Yes");
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

  // Favorites is exactly its own criterion and nothing else, so the party Yes
  // goes rather than being added to.
  fireEvent.click(screen.getByRole("button", { name: "Favorites" }));

  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Filter" }).textContent).toBe("");
  expect(filterChip(await openFilter(), "party").textContent).toBe("party Any");
});

test("the criteria still apply inside the recently played tab", async () => {
  playedQueenThenAfrica();
  withTags([ARCHIVE], [{ tag_id: "t-archive", song_ids: ["local:abc"] }]);
  renderSongs([QUEEN, AFRICA]);
  await screen.findByText("Dancing Queen");

  fireEvent.click(await screen.findByRole("button", { name: "Recent" }));

  // Africa was played, but it is archived: the tab is another order of the
  // library, not a way around the criteria.
  expect(screen.queryByText("Africa")).not.toBeInTheDocument();
  expect(screen.getByText("1 song")).toBeInTheDocument();

  const dialog = await openFilter();
  setCriterion(dialog, "archive", "Any");

  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.getByText("2 songs")).toBeInTheDocument();
  // Recent is a mode of its own, so it stays the pressed chip throughout.
  expect(screen.getByRole("button", { name: "Recent" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a preset chip leaves the recently played tab", async () => {
  playedQueenThenAfrica();
  renderSongs([QUEEN, AFRICA], LIBRARY, ACCOUNT);
  await screen.findByText("Dancing Queen");
  fireEvent.click(await screen.findByRole("button", { name: "Recent" }));

  fireEvent.click(screen.getByRole("button", { name: "All" }));

  expect(screen.getByRole("button", { name: "Recent" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(screen.queryByText(shortTime(AT_QUEEN))).not.toBeInTheDocument();
});

test("a filtered-down recent tab does not claim the party is empty", async () => {
  playedQueenThenAfrica();
  withTags([PARTY]);
  renderSongs([QUEEN, AFRICA]);
  await screen.findByText("Dancing Queen");
  fireEvent.click(await screen.findByRole("button", { name: "Recent" }));

  const dialog = await openFilter();
  setCriterion(dialog, "party", "Yes");

  expect(screen.getByText("No song matches the filter.")).toBeInTheDocument();
});

test("a hidden-by-default tag comes back on the first tap of its chip", async () => {
  withTags(
    [ARCHIVE, PARTY],
    [{ tag_id: "t-archive", song_ids: ["local:abc"] }],
  );
  renderSongs([QUEEN, AFRICA]);
  await screen.findByText("Dancing Queen");
  expect(screen.queryByText("Africa")).not.toBeInTheDocument();

  const dialog = await openFilter();
  // It opens on No, and one tap is Any — not Yes, which would show the
  // archived songs alone.
  fireEvent.click(filterChip(dialog, "archive"));

  expect(filterChip(dialog, "archive").textContent).toBe("archive Any");
  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.getByText("2 songs")).toBeInTheDocument();
});

test("one tap moves a chip one state on, Any to Yes to No and round", async () => {
  withTags([PARTY], [{ tag_id: "t-party", song_ids: ["local:abc"] }]);
  renderSongs([QUEEN, AFRICA]);
  await screen.findByText("Dancing Queen");

  const dialog = await openFilter();

  fireEvent.click(filterChip(dialog, "party"));
  expect(filterChip(dialog, "party").textContent).toBe("party Yes");
  expect(screen.getByText("1 song")).toBeInTheDocument();
  expect(screen.getByText("Africa")).toBeInTheDocument();

  fireEvent.click(filterChip(dialog, "party"));
  expect(filterChip(dialog, "party").textContent).toBe("party No");
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.queryByText("Africa")).not.toBeInTheDocument();

  fireEvent.click(filterChip(dialog, "party"));
  expect(filterChip(dialog, "party").textContent).toBe("party Any");
  expect(screen.getByText("2 songs")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("the Filter chip is its glyph until it is the pressed one", async () => {
  withTags([PARTY]);
  renderSongs([QUEEN], LIBRARY, ACCOUNT);
  await screen.findByText("Dancing Queen");

  const filter = await screen.findByRole("button", { name: "Filter" });
  expect(filter.textContent).toBe("");
  expect(iconNames(filter)).toEqual(["filter"]);
  // The one chip that opens a dialog instead of switching the list.
  expect(filter).toHaveAttribute("aria-haspopup", "dialog");
  expect(screen.getByRole("button", { name: "Favorites" })).not.toHaveAttribute(
    "aria-haspopup",
  );

  const dialog = await openFilter();
  setCriterion(dialog, "party", "Yes");

  // Two labels at most: "All", which owns no glyph, and the pressed chip.
  expect(filter.textContent).toBe("Filter · 1");
  expect(screen.getByRole("button", { name: "Favorites" }).textContent).toBe(
    "",
  );
  expect(screen.getByRole("button", { name: "Sung" }).textContent).toBe("");
  expect(screen.getByRole("button", { name: "All" }).textContent).toBe("All");
});

// --- the built-in marks -------------------------------------------------------

test("the chips, the filter rows and the marks follow the built-ins' colours", async () => {
  withTags(
    [],
    [],
    [
      builtInTagRead({ color: "gold" }),
      builtInTagRead({ id: "sung", color: "neutral" }),
    ],
  );
  listFavorites.mockResolvedValue({ data: { song_ids: ["local:abc"] } });
  const { container } = renderSongs([QUEEN, AFRICA], LIBRARY, ACCOUNT);
  await screen.findByText("Africa");

  // The chip glyph…
  expect(
    screen.getByRole("button", { name: "Favorites" }).querySelector("svg"),
  ).toHaveClass("tag-color-gold");
  expect(
    screen.getByRole("button", { name: "Sung" }).querySelector("svg"),
  ).toHaveClass("tag-color-neutral");
  // …the row mark…
  expect(container.querySelector(".song-mark-favorite")).toHaveClass(
    "tag-color-gold",
  );
  // …and the Filter panel's chip, which reads like a tag's.
  const dialog = await openFilter();
  const glyphs = dialog.querySelectorAll(".filter-chip-glyph");
  expect(glyphs[0]).toHaveClass("tag-color-gold");
  expect(glyphs[1]).toHaveClass("tag-color-neutral");
});

test("a built-in that is off the song list keeps its chip and its filter row", async () => {
  withTags(
    [],
    [],
    [
      builtInTagRead({ show_in_list: false }),
      builtInTagRead({ id: "sung", color: "blue" }),
    ],
  );
  listFavorites.mockResolvedValue({ data: { song_ids: ["local:abc"] } });
  const { container } = renderSongs([QUEEN, AFRICA], LIBRARY, ACCOUNT);
  await screen.findByText("Africa");

  // The mark is gone from the row…
  expect(container.querySelector(".song-mark-favorite")).toBeNull();
  // …but Favorites is still a list you can ask for.
  fireEvent.click(screen.getByRole("button", { name: "Favorites" }));
  await waitFor(() =>
    expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("Africa")).toBeInTheDocument();
});

// --- the six facets ---------------------------------------------------------

/** Two songs the facets have something to say about: a 70s English pop duet
 *  with a video, and an 80s German rock song with neither. */
const DUET_SONG = song({
  id: "usdb:2",
  title: "Summer Nights",
  artist: "Grease",
  is_duet: true,
  has_video: true,
  genre: "Pop",
  language: "English",
  year: 1978,
});
const ROCK_SONG = song({
  id: "local:rock",
  title: "Rock Me Amadeus",
  artist: "Falco",
  is_duet: false,
  has_video: false,
  genre: "Rock",
  language: "German",
  year: 1985,
});

/** Pick a value in a valued facet's select. */
function setValue(dialog: HTMLElement, name: string, value: string) {
  fireEvent.change(within(dialog).getByRole("combobox", { name }), {
    target: { value },
  });
}

test("a boolean facet narrows the list and counts towards the chip", async () => {
  withTags([]);
  renderSongs([DUET_SONG, ROCK_SONG]);
  await screen.findByText("Summer Nights");

  const dialog = await openFilter();
  setCriterion(dialog, "Duet", "Yes");

  await waitFor(() =>
    expect(screen.queryByText("Rock Me Amadeus")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("Summer Nights")).toBeInTheDocument();
  expect(screen.getByText("1 song")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Filter" }).textContent).toBe(
    "Filter · 1",
  );

  // No, and the other song is the one that is left.
  setCriterion(dialog, "Duet", "No");
  await waitFor(() =>
    expect(screen.getByText("Rock Me Amadeus")).toBeInTheDocument(),
  );
  expect(screen.queryByText("Summer Nights")).not.toBeInTheDocument();
});

test("a valued facet offers what the library holds and filters by it", async () => {
  withTags([]);
  // A song the file says nothing about: it is in no genre and no decade, so it
  // adds no option and matches Any alone.
  const unknown = song({
    id: "local:mystery",
    title: "Mystery",
    genre: null,
    year: null,
  });
  renderSongs([DUET_SONG, ROCK_SONG, unknown]);
  await screen.findByText("Summer Nights");

  const dialog = await openFilter();
  expect(
    within(within(dialog).getByRole("combobox", { name: "Genre" }))
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["Genre", "Pop", "Rock"]);
  // Chronological, and no bucket for the song with no year.
  expect(
    within(within(dialog).getByRole("combobox", { name: "Decade" }))
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["Decade", "1970s", "1980s"]);

  setValue(dialog, "Genre", "Rock");

  await waitFor(() =>
    expect(screen.queryByText("Summer Nights")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("Rock Me Amadeus")).toBeInTheDocument();
  expect(screen.queryByText("Mystery")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Filter" }).textContent).toBe(
    "Filter · 1",
  );
  // The chip is pressed and says the value in place of the facet's name.
  const genre = within(dialog)
    .getByRole("combobox", { name: "Genre" })
    .closest(".chip");
  expect(genre).toHaveClass("chip-on");
  expect(genre?.querySelector(".chip-name")?.textContent).toBe("Rock");

  // Two facets narrow together, and the decade of the other song empties it.
  setValue(dialog, "Decade", "1970s");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Filter" }).textContent).toBe(
      "Filter · 2",
    ),
  );
  expect(screen.getByText("No song matches the filter.")).toBeInTheDocument();
});

test("the select's options stay the whole library while the list narrows", async () => {
  withTags([]);
  renderSongs([DUET_SONG, ROCK_SONG]);
  await screen.findByText("Summer Nights");

  const dialog = await openFilter();
  setValue(dialog, "Genre", "Rock");
  await waitFor(() =>
    expect(screen.queryByText("Summer Nights")).not.toBeInTheDocument(),
  );

  // Pop is still on offer: options that vanished as the reader narrowed would
  // take away the way back.
  expect(
    within(within(dialog).getByRole("combobox", { name: "Genre" }))
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["Genre", "Pop", "Rock"]);
});

test("a facet that is not shown in the filter is not a criterion at all", async () => {
  withTags(
    [],
    [],
    builtInTagReads().map((row) =>
      row.id === "genre" || row.id === "duet"
        ? { ...row, show_in_filter: false }
        : row,
    ),
  );
  renderSongs([DUET_SONG, ROCK_SONG]);
  await screen.findByText("Summer Nights");

  const dialog = await openFilter();

  // No chip, nothing to count — and both songs are still listed.
  expect(
    within(dialog).queryByRole("combobox", { name: "Genre" }),
  ).not.toBeInTheDocument();
  expect(hasFilterChip(dialog, "Duet")).toBe(false);
  expect(hasFilterChip(dialog, "Video")).toBe(true);
  expect(screen.getByText("2 songs")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Filter" }).textContent).toBe("");
});

test("a facet is a filter for a browser with no account at all", async () => {
  // No favorites, no sung, no tags: the facets alone are worth a Filter chip.
  withTags([]);
  renderSongs([DUET_SONG, ROCK_SONG], TRUSTED);
  await screen.findByText("Summer Nights");

  const dialog = await openFilter();
  expect(hasFilterChip(dialog, "Favorites")).toBe(false);
  setCriterion(dialog, "Video", "No");

  await waitFor(() =>
    expect(screen.queryByText("Summer Nights")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("Rock Me Amadeus")).toBeInTheDocument();
});

test("All throws a facet away with the rest of the filter", async () => {
  withTags([]);
  renderSongs([DUET_SONG, ROCK_SONG]);
  await screen.findByText("Summer Nights");

  const dialog = await openFilter();
  setValue(dialog, "Language", "German");
  await waitFor(() =>
    expect(screen.queryByText("Summer Nights")).not.toBeInTheDocument(),
  );
  // The Filter chip is the pressed one while a facet is set.
  expect(screen.getByRole("button", { name: "Filter" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));

  await waitFor(() => expect(screen.getByText("2 songs")).toBeInTheDocument());
  expect(
    within(dialog).getByRole("combobox", { name: "Language" }),
  ).toHaveValue(ANY_VALUE);
});

test("a facet put back on Any is the All chip again, both kinds", async () => {
  // The two kinds spell their default differently — the cycling chip's is the word
  // *Any*, the select's is `ANY_VALUE` — so each has to drop out of the
  // overrides on its own terms or the page would stay on a Filter chip
  // counting nothing.
  withTags([]);
  renderSongs([DUET_SONG, ROCK_SONG]);
  await screen.findByText("Summer Nights");

  const dialog = await openFilter();

  setCriterion(dialog, "Duet", "Yes");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Filter" })).toHaveAttribute(
      "aria-pressed",
      "true",
    ),
  );
  setCriterion(dialog, "Duet", "Any");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    ),
  );

  setValue(dialog, "Genre", "Rock");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Filter" })).toHaveAttribute(
      "aria-pressed",
      "true",
    ),
  );
  setValue(dialog, "Genre", ANY_VALUE);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "true",
    ),
  );
  expect(screen.getByText("2 songs")).toBeInTheDocument();
});

test("a genre spelled like the sentinel filters like any other value", async () => {
  // `#GENRE:any` is a genre, not "no filter": it has an option of its own and
  // picking it narrows the list and counts towards the chip.
  withTags([]);
  const literal = song({
    id: "local:literal",
    title: "Any Genre",
    genre: "any",
    year: 1995,
  });
  renderSongs([DUET_SONG, ROCK_SONG, literal]);
  await screen.findByText("Any Genre");

  const dialog = await openFilter();
  setValue(dialog, "Genre", "any");

  await waitFor(() => expect(screen.getByText("1 song")).toBeInTheDocument());
  expect(screen.getByText("Any Genre")).toBeInTheDocument();
  expect(screen.queryByText("Rock Me Amadeus")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Filter" }).textContent).toBe(
    "Filter · 1",
  );
});
