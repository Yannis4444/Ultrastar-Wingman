import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { CommentRead, ScoreWithContext, SongRead, TagRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
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
  listSongComments,
  addSongComment,
  deleteSongComment,
  deleteSong,
  editSong,
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
  listSongComments: vi.fn(),
  addSongComment: vi.fn(),
  deleteSongComment: vi.fn(),
  deleteSong: vi.fn(),
  editSong: vi.fn(),
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
  listSongComments,
  addSongComment,
  deleteSongComment,
  deleteSong,
  editSong,
}));

const song: SongRead = {
  id: "usdb:1",
  artist: "Queen",
  title: "Bohemian Rhapsody",
  duration_seconds: 355,
  has_video: true,
  is_duet: false,
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

function renderDetails(onClose: () => void = () => {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SongDetails song={song} onClose={onClose} />
    </QueryClientProvider>,
  );
}

/** What the composer's `scrollIntoView` was replaced with for one test. */
let scrollComposerIntoView: ReturnType<
  typeof vi.fn<HTMLElement["scrollIntoView"]>
>;

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  // jsdom has no layout and so no `scrollIntoView`; the composer follows the
  // list down after a post. Same treatment `scrollTo` gets on the USDB page.
  scrollComposerIntoView = vi.fn<HTMLElement["scrollIntoView"]>();
  HTMLElement.prototype.scrollIntoView = scrollComposerIntoView;
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
  for (const mock of [listSongComments, addSongComment, deleteSongComment])
    mock.mockReset();
  deleteSong.mockReset();
  deleteSong.mockResolvedValue({ data: undefined });
  editSong.mockReset();
  editSong.mockResolvedValue({ data: song });
  // The count query runs as the modal opens, so every test needs an answer.
  listSongComments.mockResolvedValue({ data: { comments: [] } });
  deleteSongComment.mockResolvedValue({ data: undefined });
});

test("the strip's trophy carries the top score and opens the ranked view", async () => {
  renderDetails();

  const row = await screen.findByRole("button", { name: /Best scores/ });
  expect(row).toHaveTextContent("9500");
  // A glyph over its number, and no chevron: the strip is not a row (§5).
  expect(iconNames(row)).toEqual(["trophy"]);
  expect(row.closest(".song-summary")).not.toBeNull();

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

test("a song nobody has sung carries no trophy", async () => {
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

test("the rows hold the content and the actions, the strip the numbers", async () => {
  withPlaylist(false);
  // Everything the modal can offer at once, so the order is the whole order.
  getMe.mockResolvedValue(
    meResponse(["songs.view", "playlists.manage", "stats.history"], {
      user: userRead(),
      role: "user",
    }),
  );
  withTags([BROKEN], ["t-broken"]);
  listSongComments.mockResolvedValue({
    data: { comments: [comment(1, "Bob", "Banger.")] },
  });
  renderDetails();

  // Details first, Add to playlist second — the order §5 prescribes, with the
  // places after it reserved for Edit details and Delete song.
  await screen.findByRole("button", { name: "Add to playlist" });
  expect(
    [...document.querySelectorAll(".song-option .song-option-label")].map(
      (label) => label.textContent,
    ),
  ).toEqual(["Details", "Add to playlist"]);

  // Everything with a number to show sits in the strip instead, in one order.
  const strip = document.querySelector(".song-summary") as HTMLElement;
  await waitFor(() =>
    expect(iconNames(strip)).toEqual(["trophy", "tag", "comment"]),
  );
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

test("the language row wears the flag, the glyph the Language facet wears", async () => {
  renderDetails();

  fireEvent.click(await screen.findByRole("button", { name: "Details" }));
  // Not `globe`: that one means global sharing (a public playlist, USDB).
  expect(iconNames(screen.getByTitle("Language"))).toEqual(["flag"]);
});

test("there is no tag button when the reader may not view a single tag", async () => {
  renderDetails();

  await screen.findByRole("button", { name: "Details" });
  expect(
    screen.queryByRole("button", { name: /Tags/ }),
  ).not.toBeInTheDocument();
});

test("the strip counts the song's tags and opens the sub-view", async () => {
  const many = [1, 2, 3, 4].map((n) =>
    tagRead({ id: `t${n}`, name: `tag ${n}`, icon: "music" }),
  );
  withTags([...many, ARCHIVE], [...many.map((tag) => tag.id), "t-archive"]);
  renderDetails();

  const button = await screen.findByRole("button", { name: /Tags/ });
  // The feature's glyph and how many the song wears — never the tags' own
  // glyphs, which stopped being recognisable past three of them.
  await waitFor(() => expect(button).toHaveTextContent("5"));
  expect(iconNames(button)).toEqual(["tag"]);

  fireEvent.click(button);
  const dialog = screen.getByRole("dialog", { name: "Tags" });
  expect(within(dialog).getByText("tag 1")).toBeInTheDocument();
  expect(within(dialog).getByText("archive")).toBeInTheDocument();
});

test("a song wearing no tag still gets the button, standing at zero", async () => {
  withTags([BROKEN]);
  renderDetails();

  // Putting the first tag on a song is exactly what the button leads to (§5).
  const button = await screen.findByRole("button", { name: /Tags/ });
  await waitFor(() => expect(button).toHaveTextContent("0"));

  fireEvent.click(button);
  expect(
    within(screen.getByRole("dialog", { name: "Tags" })).getByText("broken"),
  ).toBeInTheDocument();
});

test("a tag count still in flight is a dash, never a zero", async () => {
  listTags.mockResolvedValue({ data: { tags: [BROKEN] } });
  // The two listings answer separately; this is the window between them.
  listTagAssignments.mockReturnValue(new Promise(() => {}));
  renderDetails();

  const button = await screen.findByRole("button", { name: /Tags/ });
  expect(button).toHaveTextContent("—");
  expect(button).not.toHaveTextContent("0");
});

test("a tag count nobody could fetch is a dash too, never a zero", async () => {
  listTags.mockResolvedValue({ data: { tags: [BROKEN] } });
  // The tags themselves arrived, so the button is there; what is *on* this
  // song is what nobody could look up, and "0" would answer for it anyway.
  listTagAssignments.mockRejectedValue({ detail: "boom" });
  renderDetails();

  const button = await screen.findByRole("button", { name: /Tags/ });
  await waitFor(() => expect(button).toHaveTextContent("—"));
  expect(button).not.toHaveTextContent("0");
});

test("a tag set from the sub-view moves the strip's count", async () => {
  withTags([BROKEN]);
  renderDetails();

  const button = await screen.findByRole("button", { name: /Tags/ });
  await waitFor(() => expect(button).toHaveTextContent("0"));

  fireEvent.click(button);
  // The refetched assignments are what the count is read off, so the listing
  // answers with the tag on before the row is pressed.
  withTags([BROKEN], ["t-broken"]);
  fireEvent.click(screen.getByRole("button", { name: /broken/ }));
  await waitFor(() => expect(assignTag).toHaveBeenCalled());

  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Tags/ })).toHaveTextContent("1"),
  );
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

test("every padlock says the same thing: somebody else sets this one", async () => {
  const duets = tagRead({
    id: "t-duets",
    name: "duets",
    icon: "music",
    can_assign: false,
  });
  withTags([ARCHIVE, duets], ["t-duets"]);
  renderDetails();

  fireEvent.click(await screen.findByRole("button", { name: /Tags/ }));
  const dialog = screen.getByRole("dialog", { name: "Tags" });
  // A tag is what people put on songs, so a locked row is always about a right
  // somebody else holds — there is no second reason a row can be locked.
  await waitFor(() =>
    expect(
      within(dialog).getAllByTitle("You may see this tag but not set it"),
    ).toHaveLength(2),
  );
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

/** A comment as the backend hands it over. Times are built off `Date.now()`
 *  rather than frozen: `timeAgo` reads the real clock, and fake timers fight
 *  both `waitFor` and react-query. */
function comment(
  id: number,
  username: string | null,
  body: string,
  overrides: Partial<CommentRead> = {},
): CommentRead {
  return {
    id,
    song_id: song.id,
    body,
    created_at: new Date(Date.now() - 5 * 60000).toISOString(),
    author:
      username === null
        ? null
        : {
            user_id: `u-${id}`,
            username,
            player_id: null,
            avatar_version: null,
          },
    mine: false,
    can_delete: false,
    ...overrides,
  };
}

/** A browser holding an account, with the capabilities the test names. */
function asAccount(capabilities: string[]) {
  getMe.mockResolvedValue(
    meResponse(["songs.view", ...capabilities], {
      user: userRead(),
      role: "user",
    }),
  );
}

/** Opens the modal's Comments sub-view and hands back its dialog. */
async function openComments(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: /Comments/ }));
  return screen.getByRole("dialog", { name: "Comments" });
}

test("the strip counts what was said and opens the sub-view", async () => {
  listSongComments.mockResolvedValue({
    data: {
      comments: [comment(1, "Bob", "Banger."), comment(2, "Cara", "No")],
    },
  });
  renderDetails();

  const row = await screen.findByRole("button", { name: /Comments/ });
  await waitFor(() => expect(row).toHaveTextContent("2"));
  expect(iconNames(row)).toEqual(["comment"]);
  expect(listSongComments.mock.calls[0][0]).toMatchObject({
    path: { song_id: "usdb:1" },
  });

  fireEvent.click(row);
  expect(screen.getByRole("dialog", { name: "Comments" })).toBeInTheDocument();
});

test("a song nobody has commented on stands at zero, not without a number", async () => {
  renderDetails();

  const row = await screen.findByRole("button", { name: /Comments/ });
  // Being the first to say something is what the zero leads to (§5).
  await waitFor(() => expect(row).toHaveTextContent("0"));

  fireEvent.click(row);
  expect(
    await screen.findByText("Nobody has said anything about this song yet."),
  ).toBeInTheDocument();
});

test("a comment count nobody has yet is a dash, never a zero", async () => {
  // Never answers: the state the strip is in for as long as the request runs.
  listSongComments.mockReturnValue(new Promise(() => {}));
  renderDetails();

  const button = await screen.findByRole("button", { name: /Comments/ });
  await waitFor(() => expect(listSongComments).toHaveBeenCalled());
  expect(button).toHaveTextContent("—");
  expect(button).not.toHaveTextContent("0");
});

test("a comment listing that failed stays a dash rather than settling on zero", async () => {
  listSongComments.mockRejectedValue({ detail: "nope" });
  renderDetails();

  const button = await screen.findByRole("button", { name: /Comments/ });
  await waitFor(() => expect(listSongComments).toHaveBeenCalled());
  // "0 comments" about a list that never arrived is a claim nobody checked.
  expect(button).toHaveTextContent("—");
  expect(button).not.toHaveTextContent("0");
});

test("a comment posted from the sub-view moves the strip's count", async () => {
  asAccount(["comments.write"]);
  addSongComment.mockResolvedValue({ data: {} });
  renderDetails();

  const button = await screen.findByRole("button", { name: /Comments/ });
  await waitFor(() => expect(button).toHaveTextContent("0"));

  const dialog = await openComments();
  fireEvent.change(
    within(dialog).getByRole("textbox", {
      name: "Say something about this song",
    }),
    { target: { value: "Banger" } },
  );
  // What the refetch after the post finds.
  listSongComments.mockResolvedValue({
    data: { comments: [comment(1, "Alice", "Banger", { mine: true })] },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));
  await waitFor(() => expect(addSongComment).toHaveBeenCalled());

  // Back on the song, the strip counts what was just said.
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Comments/ })).toHaveTextContent(
      "1",
    ),
  );
});

test("a listing that will not load says so rather than reading as empty", async () => {
  listSongComments.mockRejectedValue({ detail: "nope" });
  renderDetails();

  const dialog = await openComments();
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Could not load the comments.",
  );
  // "Nobody has said anything" would be a lie about a list that never arrived.
  expect(
    within(dialog).queryByText("Nobody has said anything about this song yet."),
  ).not.toBeInTheDocument();
});

test("a comment row carries the avatar, the name, the time and the body", async () => {
  listSongComments.mockResolvedValue({
    data: {
      comments: [
        comment(1, "Bob", "Sung it twice already", {
          author: {
            user_id: "u-1",
            username: "Bob",
            player_id: "p-bob",
            avatar_version: 3,
          },
        }),
        comment(2, "Cara", "Needs\ntwo lines"),
        // The account behind this one is gone; the row still reads.
        comment(3, null, "Said long ago"),
      ],
    },
  });
  renderDetails();

  const dialog = await openComments();
  const rows = within(dialog).getAllByRole("listitem");
  expect(rows).toHaveLength(3);

  // A player with a picture gets it, cache-busted with the version.
  expect(rows[0].querySelector("img.player-avatar")).toHaveAttribute(
    "src",
    "/api/v1/players/p-bob/avatar?v=3",
  );
  expect(rows[0]).toHaveTextContent("Bob");
  expect(rows[0]).toHaveTextContent("5 min ago");
  expect(rows[0]).toHaveTextContent("Sung it twice already");

  // No player behind the account: the initial, and no request that would 404.
  expect(rows[1].querySelector(".player-avatar-letter")).toHaveTextContent("C");
  // A deleted account has no name to take an initial from.
  expect(rows[2]).toHaveTextContent("Former member");
  expect(rows[2].querySelector(".player-avatar-empty")).not.toBeNull();
});

test("a guest is told that commenting takes an account", async () => {
  listSongComments.mockResolvedValue({
    data: { comments: [comment(1, "Bob", "Banger.")] },
  });
  renderDetails();

  const dialog = await openComments();
  expect(
    within(dialog).getByText(/writing one takes an account/),
  ).toBeInTheDocument();
  expect(
    within(dialog).queryByRole("button", { name: "Send" }),
  ).not.toBeInTheDocument();
});

test("an account whose role may not comment is told so, not shown a field", async () => {
  asAccount([]);
  renderDetails();

  const dialog = await openComments();
  expect(
    within(dialog).getByText(
      "Your role may not comment. Ask the host for access.",
    ),
  ).toBeInTheDocument();
});

test("the host screen is an administrator without a name to sign with", async () => {
  // Every right, no account — exactly what the host token grants.
  getMe.mockResolvedValue(
    meResponse(["songs.view", "comments.write", "comments.moderate"], {
      role: "admin",
      is_host: true,
    }),
  );
  renderDetails();

  const dialog = await openComments();
  expect(
    within(dialog).getByText(/no name to sign a comment with/),
  ).toBeInTheDocument();
  expect(
    within(dialog).queryByRole("textbox", {
      name: "Say something about this song",
    }),
  ).not.toBeInTheDocument();
});

test("the composer posts what was typed, then clears and keeps the focus", async () => {
  asAccount(["comments.write"]);
  addSongComment.mockResolvedValue({ data: {} });
  renderDetails();

  const dialog = await openComments();
  const field = within(dialog).getByRole("textbox", {
    name: "Say something about this song",
  });
  const send = within(dialog).getByRole("button", { name: "Send" });

  // Nothing to say yet, so there is nothing to press.
  expect(send).toBeDisabled();
  expect(iconNames(send)).toEqual(["send"]);
  expect(field).toHaveAttribute("maxlength", "1000");

  fireEvent.change(field, { target: { value: "  What a song  " } });
  expect(send).toBeEnabled();
  fireEvent.click(send);

  await waitFor(() =>
    expect(addSongComment).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { song_id: "usdb:1" },
        body: { body: "What a song" },
      }),
    ),
  );
  await waitFor(() => expect(field).toHaveValue(""));
  expect(field).toHaveFocus();
});

test("Enter is a newline and Ctrl+Enter sends", async () => {
  asAccount(["comments.write"]);
  addSongComment.mockResolvedValue({ data: {} });
  renderDetails();

  const dialog = await openComments();
  const field = within(dialog).getByRole("textbox", {
    name: "Say something about this song",
  });
  fireEvent.change(field, { target: { value: "First line" } });

  // A bare Enter is the browser's own newline: nothing is sent.
  fireEvent.keyDown(field, { key: "Enter" });
  expect(addSongComment).not.toHaveBeenCalled();

  fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(addSongComment).toHaveBeenCalledTimes(1));
});

test("a refused comment says so instead of vanishing", async () => {
  asAccount(["comments.write"]);
  addSongComment.mockRejectedValue({
    detail: "missing_permission:comments.write",
  });
  renderDetails();

  const dialog = await openComments();
  fireEvent.change(
    within(dialog).getByRole("textbox", {
      name: "Say something about this song",
    }),
    { target: { value: "Anyway" } },
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your role may not do this (comments.write).",
  );
});

test("your own comment is yours to take back, after a confirmation", async () => {
  asAccount(["comments.write"]);
  listSongComments.mockResolvedValue({
    data: {
      comments: [
        comment(7, "Alice", "Mine", { mine: true, can_delete: true }),
        comment(8, "Bob", "His"),
      ],
    },
  });
  renderDetails();

  const dialog = await openComments();
  // Only the row that may go carries the bin.
  const bins = within(dialog).getAllByRole("button", { name: /Delete/ });
  expect(bins).toHaveLength(1);
  expect(bins[0]).toHaveAccessibleName("Delete Alice's comment");
  expect(iconNames(bins[0])).toEqual(["trash"]);

  fireEvent.click(bins[0]);
  const confirm = screen.getByRole("dialog", { name: "Delete comment" });
  expect(confirm).toHaveTextContent("there is no undo");
  fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));

  await waitFor(() =>
    expect(deleteSongComment).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { song_id: "usdb:1", comment_id: 7 },
      }),
    ),
  );
});

test("backing out of the confirmation leaves the comment where it was", async () => {
  asAccount(["comments.write"]);
  listSongComments.mockResolvedValue({
    data: {
      comments: [comment(7, "Alice", "Mine", { mine: true, can_delete: true })],
    },
  });
  renderDetails();

  const dialog = await openComments();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Delete Alice's comment" }),
  );
  const confirm = screen.getByRole("dialog", { name: "Delete comment" });
  fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

  expect(
    screen.queryByRole("dialog", { name: "Delete comment" }),
  ).not.toBeInTheDocument();
  expect(deleteSongComment).not.toHaveBeenCalled();
  expect(within(dialog).getByText("Mine")).toBeInTheDocument();
});

test("the composer follows the list down when a comment lands under it", async () => {
  asAccount(["comments.write"]);
  addSongComment.mockResolvedValue({ data: {} });
  renderDetails();

  const dialog = await openComments();
  const field = within(dialog).getByRole("textbox", {
    name: "Say something about this song",
  });
  // Reading the list must not drag anybody's view around; only the writer
  // whose thought is still in the field is followed down.
  expect(scrollComposerIntoView).not.toHaveBeenCalled();

  fireEvent.change(field, { target: { value: "One more" } });
  // The list grows above the composer, which would otherwise be pushed below
  // the fold of a phone-sized modal.
  listSongComments.mockResolvedValue({
    data: { comments: [comment(1, "Alice", "One more", { mine: true })] },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));

  await waitFor(() => expect(scrollComposerIntoView).toHaveBeenCalled());
  expect(field).toHaveFocus();
});

test("a moderator may take anybody's comment away", async () => {
  asAccount(["comments.write", "comments.moderate"]);
  listSongComments.mockResolvedValue({
    data: { comments: [comment(9, "Bob", "His", { can_delete: true })] },
  });
  renderDetails();

  const dialog = await openComments();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Delete Bob's comment" }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Delete comment" })).getByRole(
      "button",
      { name: "Delete" },
    ),
  );

  await waitFor(() =>
    expect(deleteSongComment).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { song_id: "usdb:1", comment_id: 9 },
      }),
    ),
  );
});

test("a delete the backend refuses says which right is missing", async () => {
  asAccount(["comments.write"]);
  listSongComments.mockResolvedValue({
    data: { comments: [comment(9, "Bob", "His", { can_delete: true })] },
  });
  deleteSongComment.mockRejectedValue({
    detail: "missing_permission:comments.moderate",
  });
  renderDetails();

  const dialog = await openComments();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Delete Bob's comment" }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Delete comment" })).getByRole(
      "button",
      { name: "Delete" },
    ),
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your role may not do this (comments.moderate).",
  );
});

test("somebody else commenting refetches this song's list, and only this song's", async () => {
  renderDetails();

  await screen.findByRole("button", { name: /Comments/ });
  await waitFor(() => expect(listSongComments).toHaveBeenCalledTimes(1));

  // Another song's conversation is none of this modal's business.
  FakeSocket.deliver({
    event: "comments.changed",
    song_id: "usdb:2",
    count: 1,
  });
  FakeSocket.deliver({
    event: "comments.changed",
    song_id: "usdb:1",
    count: 1,
  });
  await waitFor(() => expect(listSongComments).toHaveBeenCalledTimes(2));
});

test("no Delete song row without the right", async () => {
  renderDetails();

  // The trophy waits for `/auth/me`, so by the time it is here the row has had
  // its answer too — and the answer is no.
  await screen.findByRole("button", { name: /Best scores/ });
  expect(
    screen.queryByRole("button", { name: "Delete song" }),
  ).not.toBeInTheDocument();
});

test("Delete song is the last row and looks like every other one", async () => {
  asAccount(["songs.delete"]);
  renderDetails();

  const row = await screen.findByRole("button", { name: "Delete song" });
  // A row, not a red button: the weight is in the confirmation (§1.6, §5).
  expect(row.className).toBe("song-option");
  expect(iconNames(row)).toEqual(["trash", "chevron-right"]);
  const rows = Array.from(
    row.closest(".song-options")?.querySelectorAll(".song-option") ?? [],
  );
  expect(rows[rows.length - 1]).toBe(row);
});

test("deleting asks first, names the song and says the files go", async () => {
  asAccount(["songs.delete"]);
  const onClose = vi.fn();
  renderDetails(onClose);

  fireEvent.click(await screen.findByRole("button", { name: "Delete song" }));
  const confirm = screen.getByRole("dialog", { name: "Delete song" });
  expect(confirm).toHaveTextContent("Bohemian Rhapsody");
  expect(confirm).toHaveTextContent("Queen");
  expect(confirm).toHaveTextContent(/folder is deleted from the disk/);
  // Nothing has happened yet — the question is the whole point of the dialog.
  expect(deleteSong).not.toHaveBeenCalled();

  fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));

  await waitFor(() =>
    expect(deleteSong).toHaveBeenCalledWith(
      expect.objectContaining({ path: { song_id: "usdb:1" } }),
    ),
  );
  // The song it was about is gone, so the modal closes behind it.
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

test("backing out of the confirmation leaves the song alone", async () => {
  asAccount(["songs.delete"]);
  const onClose = vi.fn();
  renderDetails(onClose);

  fireEvent.click(await screen.findByRole("button", { name: "Delete song" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Delete song" })).getByRole(
      "button",
      { name: "Cancel" },
    ),
  );

  expect(deleteSong).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(
    screen.getByRole("dialog", { name: "Bohemian Rhapsody" }),
  ).toBeInTheDocument();
});

test("a song that is playing cannot be deleted, and the modal says why", async () => {
  asAccount(["songs.delete"]);
  deleteSong.mockRejectedValue({ detail: "song_is_playing" });
  const onClose = vi.fn();
  renderDetails(onClose);

  fireEvent.click(await screen.findByRole("button", { name: "Delete song" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Delete song" })).getByRole(
      "button",
      { name: "Delete" },
    ),
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "That song is playing right now. Stop it first.",
  );
  // The song is still there, so the modal stays open on it.
  expect(onClose).not.toHaveBeenCalled();
});

test("no Edit details row without the right", async () => {
  renderDetails();

  // The trophy waits for `/auth/me`, so by the time it is here the row has had
  // its answer too — and the answer is no.
  await screen.findByRole("button", { name: /Best scores/ });
  expect(
    screen.queryByRole("button", { name: "Edit details" }),
  ).not.toBeInTheDocument();
});

test("Edit details sits between the playlist row and the delete", async () => {
  asAccount(["playlists.manage", "songs.edit", "songs.delete"]);
  renderDetails();

  const row = await screen.findByRole("button", { name: "Edit details" });
  // An ordinary row with the pencil (§3), like the three around it.
  expect(row.className).toBe("song-option");
  expect(iconNames(row)).toEqual(["pencil", "chevron-right"]);
  expect(
    [...document.querySelectorAll(".song-option .song-option-label")].map(
      (label) => label.textContent,
    ),
  ).toEqual(["Details", "Add to playlist", "Edit details", "Delete song"]);
});

/** Opens the editor and hands back its dialog. */
async function openEditor(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: "Edit details" }));
  return screen.getByRole("dialog", { name: "Edit details" });
}

test("the editor opens on what the song says, in the order §5 fixes", async () => {
  asAccount(["songs.edit"]);
  renderDetails();

  const dialog = await openEditor();

  expect(
    within(dialog)
      .getAllByRole("textbox")
      .concat(within(dialog).getAllByRole("spinbutton"))
      .map((field) => (field as HTMLInputElement).value),
  ).toEqual(["Bohemian Rhapsody", "Queen", "English", "", "", "1975"]);
  expect(
    [...dialog.querySelectorAll(".song-edit-field > span")].map(
      (caption) => caption.textContent,
    ),
  ).toEqual(["Title", "Artist", "Language", "Genre", "Year", "Edition"]);
});

test("saving sends the new values and what they were based on", async () => {
  asAccount(["songs.edit"]);
  editSong.mockResolvedValue({ data: { ...song, genre: "Rock", year: 1976 } });
  renderDetails();

  const dialog = await openEditor();
  fireEvent.change(within(dialog).getByLabelText("Genre"), {
    target: { value: "Rock" },
  });
  fireEvent.change(within(dialog).getByLabelText("Year"), {
    target: { value: "1976" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(editSong).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { song_id: "usdb:1" },
        body: {
          values: {
            title: "Bohemian Rhapsody",
            artist: "Queen",
            language: "English",
            genre: "Rock",
            year: 1976,
            edition: null,
          },
          // What the form was filled from: the backend refuses the save if the
          // file has moved on from it.
          expected: {
            title: "Bohemian Rhapsody",
            artist: "Queen",
            language: "English",
            genre: null,
            year: 1975,
            edition: null,
          },
        },
      }),
    ),
  );
  // Back on the song, showing what was just saved rather than the row the
  // listing behind the modal still holds.
  const song_modal = await screen.findByRole("dialog", {
    name: "Bohemian Rhapsody",
  });
  fireEvent.click(within(song_modal).getByRole("button", { name: "Details" }));
  expect(within(song_modal).getByText("Rock")).toBeVisible();
});

test("an emptied field is saved as no value at all", async () => {
  asAccount(["songs.edit"]);
  renderDetails();

  const dialog = await openEditor();
  fireEvent.change(within(dialog).getByLabelText("Language"), {
    target: { value: "   " },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(editSong).toHaveBeenCalledWith(
      expect.objectContaining({
        // Not an empty string: in a song txt "no language" is no header at all.
        body: expect.objectContaining({
          values: expect.objectContaining({ language: null }),
        }),
      }),
    ),
  );
});

test("a song cannot be saved without a title or an artist", async () => {
  asAccount(["songs.edit"]);
  renderDetails();

  const dialog = await openEditor();
  fireEvent.change(within(dialog).getByLabelText("Title"), {
    target: { value: "  " },
  });

  expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText("Title"), {
    target: { value: "Bohemian Rhapsody" },
  });
  fireEvent.change(within(dialog).getByLabelText("Artist"), {
    target: { value: "" },
  });
  expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  expect(editSong).not.toHaveBeenCalled();
});

test("a file that moved on under the editor says so and keeps the form", async () => {
  asAccount(["songs.edit"]);
  editSong.mockRejectedValue({ detail: "song_file_changed" });
  renderDetails();

  const dialog = await openEditor();
  fireEvent.change(within(dialog).getByLabelText("Genre"), {
    target: { value: "Rock" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    /changed while the editor was open/,
  );
  // Still in the editor, with what was typed: the reader has to decide what to
  // do about it, and retyping it first would be the wrong ask.
  expect(
    (within(dialog).getByLabelText("Genre") as HTMLInputElement).value,
  ).toBe("Rock");
});

test("a file Wingman cannot write back says which of its problems it is", async () => {
  asAccount(["songs.edit"]);
  editSong.mockRejectedValue({ detail: "value_not_encodable" });
  renderDetails();

  const dialog = await openEditor();
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    /cannot spell one of those values/,
  );
});
