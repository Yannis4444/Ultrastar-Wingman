import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MeRead, PlaylistRead, SingRead, SongRead } from "../api";
import { shortTime } from "../duration";
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
  addPlaylistEntry,
  listCurrentSessionSings,
  listPlayerScores,
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
  ]) {
    mock.mockReset();
  }
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
    .closest("div") as HTMLElement;
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

test("a guest with no favorites and no playlists gets no filter chips", async () => {
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
  fireEvent.click(within(picker).getByRole("button", { name: /Party/ }));

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
  listPlaylists.mockResolvedValue({
    data: { playlists: [playlist({ song_count: 1 })] },
  });
  // Only the fetches the click causes count; the two mounts already had theirs.
  listPlaylists.mockClear();
  const picker = screen.getByRole("dialog", { name: "Add to playlist" });
  fireEvent.click(within(picker).getByRole("button", { name: /Party/ }));

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
