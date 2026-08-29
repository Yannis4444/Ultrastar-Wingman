import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ScoreWithContext, SongRead, TagRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import { iconNames } from "../test/icons";
import { tagRead } from "../test/tags";
import SongDetails from "./SongDetails";

const {
  getMe,
  listSongScores,
  listWishlist,
  listPlaylists,
  listPlayers,
  getPlaylist,
  addPlaylistEntry,
  removePlaylistEntry,
  createPlaylist,
  listTags,
  listTagAssignments,
  assignTag,
  unassignTag,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  listSongScores: vi.fn(),
  listWishlist: vi.fn(),
  listPlaylists: vi.fn(),
  listPlayers: vi.fn(),
  getPlaylist: vi.fn(),
  addPlaylistEntry: vi.fn(),
  removePlaylistEntry: vi.fn(),
  createPlaylist: vi.fn(),
  listTags: vi.fn(),
  listTagAssignments: vi.fn(),
  assignTag: vi.fn(),
  unassignTag: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listSongScores,
  listWishlist,
  listPlaylists,
  listPlayers,
  getPlaylist,
  addPlaylistEntry,
  removePlaylistEntry,
  createPlaylist,
  listTags,
  listTagAssignments,
  assignTag,
  unassignTag,
}));

const song: SongRead = {
  id: "usdb:1",
  artist: "Queen",
  title: "Bohemian Rhapsody",
  duration_seconds: 355,
  has_video: true,
  language: "English",
  genre: null,
  year: 1975,
  edition: null,
  creator: null,
  source: "usdb",
};

function score(
  id: number,
  playerName: string,
  value: number,
  playerId: string | null = null,
): ScoreWithContext {
  return {
    id,
    sing_id: `sing-${id}`,
    player_id: playerId,
    player_name: playerName,
    score: value,
    difficulty: 2,
    recorded_at: "2026-08-23T20:00:00Z",
    song,
    sing_started_at: "2026-08-23T19:55:00Z",
  };
}

/** The parts of one ranked row a test cares about, per row. */
function rankedRows(list: HTMLElement, part: string): (string | undefined)[] {
  return within(list)
    .getAllByRole("listitem")
    .map((row) => row.querySelector(part)?.textContent ?? undefined);
}

// Newest first, as every stats route answers — never in score order.
const history = [
  score(6, "Frank", 1000),
  score(5, "Erin", 2000),
  score(4, "Dan", 3000),
  score(3, "Chris", 4000),
  score(2, "Bob", 5000),
  score(1, "Alice", 9500),
];

function renderDetails() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SongDetails song={song} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMe.mockReset();
  listSongScores.mockReset();
  listPlayers.mockReset();
  listPlaylists.mockReset();
  getPlaylist.mockReset();
  createPlaylist.mockReset();
  addPlaylistEntry.mockReset();
  removePlaylistEntry.mockReset();
  for (const mock of [listTags, listTagAssignments, assignTag, unassignTag])
    mock.mockReset();
  // No tag the reader may see, so the Tags row is absent unless a test says so.
  listTags.mockResolvedValue({ data: { tags: [] } });
  listTagAssignments.mockResolvedValue({ data: { assignments: [] } });
  assignTag.mockResolvedValue({ data: undefined });
  unassignTag.mockResolvedValue({ data: undefined });
  // The best-scores view reaches over every party, so it is `stats.history`.
  getMe.mockResolvedValue(meResponse(["songs.view", "stats.history"]));
  listSongScores.mockResolvedValue({ data: { scores: history } });
  listWishlist.mockResolvedValue({ data: { wishes: [] } });
  listPlaylists.mockResolvedValue({ data: { playlists: [] } });
  listPlayers.mockResolvedValue({ data: { players: [] } });
});

test("the best-scores row carries the top score and opens the ranked view", async () => {
  renderDetails();

  const row = await screen.findByRole("button", { name: /Best scores/ });
  expect(row).toHaveTextContent("9500");

  fireEvent.click(row);
  const dialog = screen.getByRole("dialog", { name: "Best scores" });
  const list = within(dialog).getByRole("list", { name: "Best scores" });

  expect(rankedRows(list, ".ranked-score-rank")).toEqual([
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
  ]);
  expect(rankedRows(list, ".ranked-score-name")).toEqual([
    "Alice",
    "Bob",
    "Chris",
    "Dan",
    "Erin",
    "Frank",
  ]);
  expect(rankedRows(list, ".ranked-score-value")).toEqual([
    "9500",
    "5000",
    "4000",
    "3000",
    "2000",
    "1000",
  ]);
  // Difficulty and a date — the exact date format is the platform's locale.
  expect(rankedRows(list, ".ranked-score-caption")[0]).toMatch(/^Hard · \S/);

  // Closing the ranking returns to the song, not to the list behind it.
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(
    screen.getByRole("dialog", { name: "Bohemian Rhapsody" }),
  ).toBeInTheDocument();
});

test("the ranking summarises the song's whole history above the rows", async () => {
  renderDetails();

  fireEvent.click(await screen.findByRole("button", { name: /Best scores/ }));
  const dialog = screen.getByRole("dialog", { name: "Best scores" });

  // Six sings, and the average over every score — not over the listed ten.
  expect(dialog.querySelector(".song-scores-stats")).toHaveTextContent(
    "Times sung6Best9500Worst1000Average4083",
  );
});

test("a singer with a player record gets their avatar, a guest their initial", async () => {
  getMe.mockResolvedValue(
    meResponse(["songs.view", "stats.history", "players.view"]),
  );
  listSongScores.mockResolvedValue({
    data: { scores: [score(1, "Alice", 9500, "p-1"), score(2, "Bob", 5000)] },
  });
  listPlayers.mockResolvedValue({
    data: {
      players: [
        { id: "p-1", name: "Alice", registered: true, has_avatar: true },
      ],
    },
  });
  renderDetails();

  fireEvent.click(await screen.findByRole("button", { name: /Best scores/ }));
  const list = await screen.findByRole("list", { name: "Best scores" });
  await waitFor(() =>
    expect(list.querySelector("img.ranked-score-avatar")).toHaveAttribute(
      "src",
      expect.stringContaining("p-1"),
    ),
  );
  // Bob has no player record; the stand-in is drawn as his initial.
  expect(list.querySelectorAll(".player-avatar-letter")[0]).toHaveTextContent(
    "B",
  );
});

test("without players.view the ranking still draws initials", async () => {
  renderDetails();

  fireEvent.click(await screen.findByRole("button", { name: /Best scores/ }));
  const list = await screen.findByRole("list", { name: "Best scores" });
  expect(listPlayers).not.toHaveBeenCalled();
  expect(
    [...list.querySelectorAll(".player-avatar-letter")].map(
      (mark) => mark.textContent,
    ),
  ).toEqual(["A", "B", "C", "D", "E", "F"]);
});

test("a song nobody has sung shows no scores section", async () => {
  listSongScores.mockResolvedValue({ data: { scores: [] } });
  renderDetails();

  await waitFor(() => expect(listSongScores).toHaveBeenCalled());
  expect(screen.queryByText("Best scores")).not.toBeInTheDocument();
});

test("without stats.history the scores are not even requested", async () => {
  // Tonight's scoreboard alone is not enough: this list is the whole archive.
  getMe.mockResolvedValue(meResponse(["songs.view", "stats.view"]));
  renderDetails();

  await waitFor(() => expect(getMe).toHaveBeenCalled());
  expect(screen.queryByText("Best scores")).not.toBeInTheDocument();
  expect(listSongScores).not.toHaveBeenCalled();
});

test("the details section starts collapsed and toggles open", async () => {
  renderDetails();

  const toggle = await screen.findByRole("button", { name: "Details" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  // Collapsed means hidden, not gone: the values stay in the DOM.
  expect(screen.getByRole("dialog")).toHaveTextContent("English");

  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("English")).toBeVisible();

  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("the collapsed details row points right and only turns down when open", async () => {
  renderDetails();

  const toggle = await screen.findByRole("button", { name: "Details" });
  // Row icon then chevron; every collapsed option row points the same way.
  expect(iconNames(toggle)).toEqual(["info", "chevron-right"]);

  fireEvent.click(toggle);
  expect(iconNames(toggle)).toEqual(["info", "chevron-down"]);
  // The rotation trick is gone: it pointed the arrow up.
  expect(toggle.querySelector(".song-chevron-open")).toBeNull();
});

test("the wish control wears the three-bar wishlist glyphs", async () => {
  getMe.mockResolvedValue(
    meResponse(["songs.view", "wishlist.view", "wishlist.add"]),
  );
  renderDetails();

  // Off: the plus says what tapping it does. The bare bars are used nowhere.
  expect(
    iconNames(await screen.findByRole("button", { name: "Wish" })),
  ).toEqual(["playlist-plus"]);

  listWishlist.mockResolvedValue({
    data: {
      wishes: [{ song, count: 1, mine: true, latest: "2026-08-23T20:00:00Z" }],
    },
  });
  renderDetails();
  expect(
    iconNames(await screen.findByRole("button", { name: "Remove wish" })),
  ).toEqual(["playlist-check"]);
});

/** A logged-in playlist owner with one playlist; `contains` is what the picker
 *  reads the check mark off. */
function withPlaylist(
  contains: boolean,
  extra: Record<string, unknown>[] = [],
) {
  getMe.mockResolvedValue(
    meResponse(["songs.view", "playlists.manage"], {
      user: userRead(),
      role: "user",
    }),
  );
  listPlaylists.mockResolvedValue({
    data: {
      playlists: [
        {
          id: "pl-1",
          name: "Warm-up",
          description: null,
          is_global: false,
          owner_username: null,
          owner_player_id: null,
          song_count: contains ? 1 : 0,
          duration_seconds: 0,
          // A cover, so the mosaic is images and the only glyph on the row is
          // the membership mark the assertions are about.
          cover_song_ids: ["local:a"],
          my_access: "owner",
          followed: true,
          can_edit: true,
          can_manage: true,
          contains,
        },
        ...extra,
      ],
    },
  });
}

test("the playlist row and picker wear the bulleted-list glyphs", async () => {
  withPlaylist(false);
  renderDetails();

  const option = await screen.findByRole("button", { name: "Add to playlist" });
  expect(iconNames(option)).toEqual(["list-plus", "chevron-right"]);

  fireEvent.click(option);
  const dialog = screen.getByRole("dialog", { name: "Add to playlist" });
  const row = await within(dialog).findByRole("button", { name: /Warm-up/ });
  expect(iconNames(row)).toEqual(["list"]);
});

test("the picker asks for the listing once, with the song, and never per row", async () => {
  withPlaylist(false);
  renderDetails();

  fireEvent.click(
    await screen.findByRole("button", { name: "Add to playlist" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Add to playlist" });
  await within(dialog).findByRole("button", { name: /Warm-up/ });

  expect(listPlaylists).toHaveBeenCalledTimes(1);
  expect(listPlaylists.mock.calls[0][0]).toMatchObject({
    query: { song_id: "usdb:1" },
  });
  // The check mark comes off the listing's `contains`, so no playlist is
  // fetched to find out what is in it.
  expect(getPlaylist).not.toHaveBeenCalled();
});

test("a playlist owner adds the song from the playlist picker", async () => {
  withPlaylist(false);
  addPlaylistEntry.mockResolvedValue({ data: {} });
  renderDetails();

  fireEvent.click(
    await screen.findByRole("button", { name: "Add to playlist" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Add to playlist" });
  const row = await within(dialog).findByRole("button", { name: /Warm-up/ });
  expect(row).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(row);

  await waitFor(() =>
    expect(addPlaylistEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { playlist_id: "pl-1" },
        body: { song_id: "usdb:1" },
      }),
    ),
  );
});

test("a playlist that already holds the song shows the check and removes on tap", async () => {
  withPlaylist(true);
  removePlaylistEntry.mockResolvedValue({ data: undefined });
  renderDetails();

  fireEvent.click(
    await screen.findByRole("button", { name: "Add to playlist" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Add to playlist" });
  const row = await within(dialog).findByRole("button", {
    name: /Warm-up/,
  });
  expect(row).toHaveAttribute("aria-pressed", "true");
  // Same bulleted family as the empty row, with the check the wishlist's
  // "already on it" glyph carries.
  expect(iconNames(row)).toEqual(["list-check"]);
  fireEvent.click(row);

  await waitFor(() =>
    expect(removePlaylistEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { playlist_id: "pl-1", song_id: "usdb:1" },
      }),
    ),
  );
});

test("the picker offers itself with no playlist at all, and makes a private one", async () => {
  getMe.mockResolvedValue(
    meResponse(["songs.view", "playlists.manage"], {
      user: userRead(),
      role: "user",
    }),
  );
  listPlaylists.mockResolvedValue({ data: { playlists: [] } });
  createPlaylist.mockResolvedValue({ data: { id: "pl-new" } });
  addPlaylistEntry.mockResolvedValue({ data: {} });
  renderDetails();

  // The row is offered on the right alone: somebody with no list yet is
  // exactly who "New playlist…" is for.
  fireEvent.click(
    await screen.findByRole("button", { name: "Add to playlist" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Add to playlist" });
  fireEvent.click(
    await within(dialog).findByRole("button", { name: /New playlist/ }),
  );

  const field = within(dialog).getByRole("textbox", {
    name: "New playlist name",
  });
  fireEvent.change(field, { target: { value: "  Late shift  " } });
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Create the playlist and add the song",
    }),
  );

  await waitFor(() =>
    expect(createPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { name: "Late shift", is_global: false },
      }),
    ),
  );
  await waitFor(() =>
    expect(addPlaylistEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { playlist_id: "pl-new" },
        body: { song_id: "usdb:1" },
      }),
    ),
  );
});

test("a list the reader may only look at is not in the picker", async () => {
  withPlaylist(false, [
    {
      id: "pl-2",
      name: "Bobs mix",
      description: null,
      is_global: true,
      owner_username: "Bob",
      owner_player_id: null,
      song_count: 3,
      duration_seconds: 0,
      cover_song_ids: [],
      my_access: null,
      followed: false,
      can_edit: false,
      can_manage: false,
      contains: false,
    },
  ]);
  renderDetails();

  fireEvent.click(
    await screen.findByRole("button", { name: "Add to playlist" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Add to playlist" });
  await within(dialog).findByRole("button", { name: /Warm-up/ });
  expect(
    within(dialog).queryByRole("button", { name: /Bobs mix/ }),
  ).not.toBeInTheDocument();
});

test("a failing audio preview removes itself", async () => {
  const { container } = renderDetails();

  const preview = container.querySelector("audio.song-preview");
  expect(preview).not.toBeNull();
  expect(preview).toHaveAttribute("src", "/api/v1/songs/usdb%3A1/audio");

  // jsdom never loads media; the 404-for-no-audio case arrives as an error
  // event, which is the only signal the backend gives.
  fireEvent.error(preview as Element);
  expect(container.querySelector("audio.song-preview")).toBeNull();
});

/** Seed the two tag listings the modal reads through `useTags`. */
function withTags(tags: TagRead[], carried: string[] = []) {
  listTags.mockResolvedValue({ data: { tags } });
  listTagAssignments.mockResolvedValue({
    data: {
      assignments: tags.map((tag) => ({
        tag_id: tag.id,
        song_ids: carried.includes(tag.id) ? [song.id] : [],
      })),
    },
  });
}

const BROKEN = tagRead({
  id: "t-broken",
  name: "broken",
  icon: "alert",
  color: "gold",
});
const ARCHIVE = tagRead({
  id: "t-archive",
  name: "archive",
  can_assign: false,
});

test("the genre row wears the music glyph, the tags feature keeps its own", async () => {
  renderDetails();

  fireEvent.click(await screen.findByRole("button", { name: "Details" }));
  expect(iconNames(screen.getByTitle("Genre"))).toEqual(["music"]);
});

test("there is no tags row when the reader may not view a single tag", async () => {
  renderDetails();

  await screen.findByRole("button", { name: "Details" });
  expect(
    screen.queryByRole("button", { name: /Tags/ }),
  ).not.toBeInTheDocument();
});

test("the tags row draws the song's tags and opens the sub-view", async () => {
  withTags([BROKEN, ARCHIVE], ["t-broken"]);
  renderDetails();

  const row = await screen.findByRole("button", { name: /Tags/ });
  // The feature's glyph, then the one tag this song wears, then the chevron.
  expect(iconNames(row)).toEqual(["tag", "alert", "chevron-right"]);

  fireEvent.click(row);
  const dialog = screen.getByRole("dialog", { name: "Tags" });
  expect(within(dialog).getByText("broken")).toBeInTheDocument();
  expect(within(dialog).getByText("archive")).toBeInTheDocument();
});

test("past three tags the row counts them instead", async () => {
  const many = [1, 2, 3, 4].map((n) =>
    tagRead({ id: `t${n}`, name: `tag ${n}`, icon: "music" }),
  );
  withTags(
    many,
    many.map((tag) => tag.id),
  );
  renderDetails();

  const row = await screen.findByRole("button", { name: /Tags/ });
  expect(row).toHaveTextContent("4 tags");
  expect(iconNames(row)).toEqual(["tag", "chevron-right"]);
});

test("a tag the reader may set toggles on and off", async () => {
  withTags([BROKEN]);
  renderDetails();

  fireEvent.click(await screen.findByRole("button", { name: /Tags/ }));
  const toggle = screen.getByRole("button", { name: /broken/ });
  expect(toggle).toHaveAttribute("aria-pressed", "false");

  // The refetched assignments are what flips the row, not the click — so the
  // listing answers with the tag on before the toggle is pressed.
  withTags([BROKEN], ["t-broken"]);
  fireEvent.click(toggle);

  await waitFor(() => expect(assignTag).toHaveBeenCalled());
  expect(assignTag.mock.calls[0][0].path).toEqual({
    song_id: song.id,
    tag_id: "t-broken",
  });
  await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));

  fireEvent.click(toggle);
  await waitFor(() => expect(unassignTag).toHaveBeenCalled());
  expect(unassignTag.mock.calls[0][0].path).toEqual({
    song_id: song.id,
    tag_id: "t-broken",
  });
});

test("a tag the reader may see but not set is a padlock row", async () => {
  withTags([ARCHIVE], ["t-archive"]);
  renderDetails();

  fireEvent.click(await screen.findByRole("button", { name: /Tags/ }));
  const dialog = screen.getByRole("dialog", { name: "Tags" });
  expect(
    within(dialog).queryByRole("button", { name: /archive/ }),
  ).not.toBeInTheDocument();
  const row = within(dialog).getByText("archive").closest(".picker-row");
  expect(iconNames(row as HTMLElement)).toEqual(["archive", "lock"]);
});

test("a refused tag says so instead of failing silently", async () => {
  withTags([BROKEN]);
  assignTag.mockRejectedValue({ detail: "missing_tag_permission:assign" });
  renderDetails();

  fireEvent.click(await screen.findByRole("button", { name: /Tags/ }));
  fireEvent.click(screen.getByRole("button", { name: /broken/ }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "That tag is not yours to set.",
  );
});

test("nothing to set and nothing set is one sentence, not a list of locks", async () => {
  withTags([ARCHIVE]);
  renderDetails();

  fireEvent.click(await screen.findByRole("button", { name: /Tags/ }));
  const dialog = screen.getByRole("dialog", { name: "Tags" });
  expect(
    within(dialog).getByText(
      "No tags on this song, and none of them is yours to set.",
    ),
  ).toBeInTheDocument();
  expect(within(dialog).queryByText("archive")).not.toBeInTheDocument();
});
