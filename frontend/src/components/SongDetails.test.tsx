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
  created_at: "2026-01-01T12:00:00Z",
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
    placement: null,
    field_size: null,
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

function renderDetails(
  onClose: () => void = () => {},
  onSing?: (() => void) | null,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SongDetails song={song} onClose={onClose} onSing={onSing} />
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

test("the action bar's trophy carries the top score and opens the ranked view", async () => {
  renderDetails();

  const row = await screen.findByRole("button", { name: /Best scores/ });
  expect(row).toHaveTextContent("9500");
  // Its name says the number it shows, for a reader and for a pointer alike.
  expect(row).toHaveAccessibleName("Best scores, 9500");
  expect(row).toHaveAttribute("title", "Best scores, 9500");
  // A glyph over its number, and no chevron: the bar is not a row (§5).
  expect(iconNames(row)).toEqual(["trophy"]);
  expect(row).toHaveClass("song-action-count", "song-action-scores");
  expect(row.closest(".song-actions")).not.toBeNull();

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
  // No Songs stat: every score in here is this one song. Best and Worst name
  // the singer who holds them, rank 1 one row below saying it again.
  expect(dialog.querySelector(".song-scores-stats")).toHaveTextContent(
    "6Sings9500Best · Alice4083Average1000Worst · Frank",
  );
});

test("the whole history is drawn as the all-scores strip above the ranking", async () => {
  renderDetails();

  fireEvent.click(await screen.findByRole("button", { name: /Best scores/ }));
  const dialog = screen.getByRole("dialog", { name: "Best scores" });

  const strip = within(dialog).getByRole("img", {
    name: "Every score this song ever got",
  });
  // One dot per score ever, not per listed row.
  expect(within(strip).getAllByTestId("strip-dot")).toHaveLength(6);
  // It sits between the summary line and the ranking, flat on the page.
  expect(strip.closest(".song-scores-strip")).not.toBeNull();
  // The summary right above prints Best and its holder, so the strip's own
  // line says the median and nothing it would repeat.
  const figures = dialog.querySelector(".score-strip-figures") as HTMLElement;
  expect(figures.textContent).toMatch(/^Median \d+$/);
});

test("three scores are no picture, so no strip is drawn", async () => {
  listSongScores.mockResolvedValue({
    data: {
      scores: [
        score(1, "Alice", 9500),
        score(2, "Bob", 5000),
        score(3, "Chris", 4000),
      ],
    },
  });
  renderDetails();

  fireEvent.click(await screen.findByRole("button", { name: /Best scores/ }));
  const dialog = screen.getByRole("dialog", { name: "Best scores" });
  // Wait for the view itself before asserting the strip's absence.
  await within(dialog).findByRole("list", { name: "Best scores" });

  expect(
    within(dialog).queryByRole("img", {
      name: "Every score this song ever got",
    }),
  ).not.toBeInTheDocument();
  // The ranking is drawn either way (§7) — the threshold is the chart's alone.
  expect(
    rankedRows(
      within(dialog).getByRole("list", { name: "Best scores" }),
      ".ranked-score-value",
    ),
  ).toEqual(["9500", "5000", "4000"]);
});

test("the fourth score is where the strip starts", async () => {
  listSongScores.mockResolvedValue({
    data: {
      scores: [
        score(1, "Alice", 9500),
        score(2, "Bob", 5000),
        score(3, "Chris", 4000),
        score(4, "Dan", 3000),
      ],
    },
  });
  renderDetails();

  fireEvent.click(await screen.findByRole("button", { name: /Best scores/ }));
  const dialog = screen.getByRole("dialog", { name: "Best scores" });

  expect(
    within(
      await within(dialog).findByRole("img", {
        name: "Every score this song ever got",
      }),
    ).getAllByTestId("strip-dot"),
  ).toHaveLength(4);
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
  // The bar still stands, with the comments, but no trophy in it.
  await screen.findByRole("button", { name: /Comments/ });
  expect(
    screen.queryByRole("button", { name: /Best scores/ }),
  ).not.toBeInTheDocument();
  expect(
    iconNames(document.querySelector(".song-actions") as Element),
  ).not.toContain("trophy");
});

test("without stats.history the scores are not even requested", async () => {
  // Tonight's scoreboard alone is not enough: this list is the whole archive.
  getMe.mockResolvedValue(meResponse(["songs.view", "stats.view"]));
  renderDetails();

  await waitFor(() => expect(getMe).toHaveBeenCalled());
  expect(
    screen.queryByRole("button", { name: /Best scores/ }),
  ).not.toBeInTheDocument();
  expect(listSongScores).not.toHaveBeenCalled();
});

/** The fact line's facts, as glyph, hidden name and value per fact. */
function factsOf(line: Element): [string, string, string][] {
  return [...line.querySelectorAll(".song-fact")].map((fact) => [
    iconNames(fact as HTMLElement)[0],
    fact.querySelector(".visually-hidden")?.textContent ?? "",
    fact.querySelector(".song-fact-value")?.textContent ?? "",
  ]);
}

/** A song that names everything the fact line and the fine print can say. */
const complete: SongRead = {
  ...song,
  genre: "Rock",
  edition: "SingStar Queen",
  creator: "DrFrank",
};

test("the facts stand under the artist, each glyph only with its value", async () => {
  renderDetails();

  const dialog = await screen.findByRole("dialog", {
    name: "Bohemian Rhapsody",
  });
  const line = dialog.querySelector(".song-facts") as HTMLElement;
  // In the hero, straight under the artist (§5): the details are data now,
  // not a row to unfold.
  expect(line.parentElement).toHaveClass("song-hero");
  expect(line.previousElementSibling).toHaveClass("song-hero-artist");
  // The fixture names a language and a year and nothing else, so the genre's
  // and the edition's glyphs are not drawn either, and "unknown" is not said.
  expect(factsOf(line)).toEqual([
    ["flag", "Language", "English"],
    ["calendar", "Year", "1975"],
  ]);
  expect(dialog).not.toHaveTextContent("unknown");
  // No duration: the preview player shows it (§1.5).
  expect(dialog).not.toHaveTextContent("5:55");
});

test("a song with every fact names all four, in the order §5 fixes", async () => {
  renderSong(complete);

  const dialog = await screen.findByRole("dialog", {
    name: "Bohemian Rhapsody",
  });
  // `flag` the language and `music` the genre: `globe` means global sharing
  // and `tag` is the tags feature's, which has its own button (§3).
  expect(factsOf(dialog.querySelector(".song-facts") as Element)).toEqual([
    ["flag", "Language", "English"],
    ["music", "Genre", "Rock"],
    ["calendar", "Year", "1975"],
    ["disc", "Edition", "SingStar Queen"],
  ]);
  // The name is there for a pointer too, with the whole value: a long one
  // is cut short on screen.
  expect(iconNames(screen.getByTitle("Genre: Rock"))).toEqual(["music"]);
  expect(screen.getByTitle("Edition: SingStar Queen")).toHaveClass("song-fact");
});

test("a song that names nothing draws no fact line for a reader who may not edit", async () => {
  renderSong({ ...song, language: null, year: null });

  // The trophy waits for `/auth/me`, so the answer is in by now.
  await screen.findByRole("button", { name: /Best scores/ });
  // Nothing to say and nothing to press: no empty line under the artist.
  expect(document.querySelector(".song-facts")).toBeNull();
  // And the rest of the modal stands as ever, the fine print included.
  expect(document.querySelector(".song-actions")).not.toBeNull();
  expect(document.querySelector(".song-fine-print")).toHaveTextContent(
    "usdb:1",
  );
});

test("a song that names nothing keeps the pencil alone for the right to delete", async () => {
  asAccount(["songs.delete"]);
  renderSong({ ...song, language: null, year: null });

  // Otherwise the editor, and deleting the song with it, would be out of reach.
  const pencil = await screen.findByRole("button", { name: "Edit details" });
  const line = pencil.closest(".song-facts") as HTMLElement;
  expect(line.querySelectorAll(".song-fact")).toHaveLength(0);
  expect(iconNames(line)).toEqual(["pencil"]);

  fireEvent.click(pencil);
  expect(
    within(screen.getByRole("dialog", { name: "Edit details" })).getByRole(
      "button",
      { name: "Delete song" },
    ),
  ).toBeEnabled();
});

test("the fine print names who made the file and where it came from", async () => {
  renderSong(complete);

  const line = (await screen.findByRole("dialog")).querySelector(
    ".song-fine-print",
  );
  expect(line).toHaveTextContent(/^Made by DrFrank · usdb:1$/);
  // The last thing in the modal, under the action bar.
  expect(line?.previousElementSibling).toHaveClass("song-actions");
});

test("a song without a creator keeps the source alone, without the dot", async () => {
  renderDetails();

  const line = (await screen.findByRole("dialog")).querySelector(
    ".song-fine-print",
  );
  expect(line).toHaveTextContent(/^usdb:1$/);
});

test("a USDB song's fine print is one link to its USDB page", async () => {
  renderSong({ ...complete, id: "usdb:24435" });

  const link = await screen.findByRole("link", {
    name: "Made by DrFrank · usdb:24435",
  });
  expect(link).toHaveAttribute(
    "href",
    "https://usdb.animux.de/index.php?link=detail&id=24435",
  );
  // It leaves Wingman, so a new tab, and nothing of this page goes with it.
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  // The streaming rows' mark for a link that leaves, after the words.
  expect(iconNames(link)).toEqual(["external-link"]);
  // The glyph and the id are one run that cannot wrap apart, so a long
  // creator that wraps the line still ends it in the glyph.
  const end = link.querySelector(".song-fine-print-end") as HTMLElement;
  expect(end).toHaveTextContent(/^usdb:24435$/);
  expect(end.lastElementChild).toHaveClass("icon");
  expect(link.querySelector(".icon")).toBe(end.lastElementChild);
  // The whole line is the link, and still the last thing in the modal.
  expect(link).toHaveClass("song-fine-print");
  expect(link.previousElementSibling).toHaveClass("song-actions");
  expect(document.querySelectorAll(".song-fine-print")).toHaveLength(1);
});

test("any other source's fine print is the plain line", async () => {
  renderSong({
    ...complete,
    id: "local:6f1c0a2e-4b7d-4c1e-9a3f-2d8e5b7c9a10",
    source: "local",
  });

  const dialog = await screen.findByRole("dialog");
  const line = dialog.querySelector(".song-fine-print") as HTMLElement;
  expect(line.tagName).toBe("P");
  expect(line).toHaveTextContent(
    /^Made by DrFrank · local:6f1c0a2e-4b7d-4c1e-9a3f-2d8e5b7c9a10$/,
  );
  expect(within(line).queryByRole("link")).toBeNull();
  expect(iconNames(line)).toEqual([]);
  expect(within(dialog).queryByRole("link", { name: /Made by/ })).toBeNull();
});

test("there is no Details row and no list of rows on the song itself", async () => {
  asAccount(["playlists.manage", "songs.edit", "songs.delete"]);
  renderDetails();

  const dialog = await screen.findByRole("dialog", {
    name: "Bohemian Rhapsody",
  });
  await screen.findByRole("button", { name: "Edit details" });
  // The facts are inline and the fine print carries creator and source, so
  // the row that used to unfold them is gone, and so is every option row.
  expect(
    within(dialog).queryByRole("button", { name: "Details" }),
  ).not.toBeInTheDocument();
  expect(dialog.querySelector(".song-option")).toBeNull();
  expect(dialog.querySelector(".song-options")).toBeNull();
  expect(iconNames(dialog)).not.toContain("info");
  expect(iconNames(dialog)).not.toContain("chevron-right");
});

test("the action bar holds the counts first, then the errands", async () => {
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

  // The counts first, each a glyph over its number, then the two errands as
  // plain icon buttons: the order §5 prescribes.
  await screen.findByRole("button", { name: "Add to playlist" });
  const bar = document.querySelector(".song-actions") as HTMLElement;
  await waitFor(() =>
    expect(iconNames(bar)).toEqual([
      "trophy",
      "tag",
      "comment",
      "list-plus",
      "external-link",
    ]),
  );
  const buttons = within(bar).getAllByRole("button");
  await waitFor(() =>
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Best scores, 9500",
      "Tags, 1",
      "Comments, 1",
      "Add to playlist",
      "Open in a streaming service",
    ]),
  );
  // Every one of them says its name to a pointer too.
  for (const button of buttons)
    expect(button).toHaveAttribute("title", button.getAttribute("aria-label"));
  // Three counts, two errands, each set in its own group.
  expect(
    [...bar.querySelectorAll(".song-actions-counts > button")].map((button) =>
      button.className.includes("song-action-count"),
    ),
  ).toEqual([true, true, true]);
  expect(
    [...bar.querySelectorAll(".song-actions-errands > button")].map(
      (button) => button.className,
    ),
  ).toEqual(["icon-button", "icon-button"]);
  // Under the song controls, and the fine print under it.
  expect(bar.previousElementSibling).toHaveClass("song-details-controls");
});

test("each count opens what it counts, and the close goes back to the song", async () => {
  withTags([BROKEN], ["t-broken"]);
  renderDetails();

  for (const [name, view] of [
    [/Best scores/, "Best scores"],
    [/Tags/, "Tags"],
    [/Comments/, "Comments"],
  ] as const) {
    fireEvent.click(await screen.findByRole("button", { name }));
    const dialog = screen.getByRole("dialog", { name: view });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(
      await screen.findByRole("dialog", { name: "Bohemian Rhapsody" }),
    ).toBeInTheDocument();
  }
});

test("the wish control wears the three-bar wishlist glyphs", async () => {
  getMe.mockResolvedValue(
    meResponse(["songs.view", "wishlist.view", "wishlist.add"]),
  );
  renderDetails();

  // Off: the plus says what tapping it does. The bare bars are used nowhere.
  expect(
    iconNames(await screen.findByRole("button", { name: "Add to wishlist" })),
  ).toEqual(["playlist-plus"]);

  listWishlist.mockResolvedValue({
    data: {
      wishes: [{ song, count: 1, mine: true, latest: "2026-08-23T20:00:00Z" }],
    },
  });
  renderDetails();
  expect(
    iconNames(
      await screen.findByRole("button", { name: "Remove from wishlist" }),
    ),
  ).toEqual(["playlist-check"]);
});

/** The word under one song control, and whether it is out of the name. */
function captionOf(button: HTMLElement): [string, string | null] {
  const caption = button.querySelector(".song-control-caption");
  return [
    caption?.textContent ?? "",
    caption?.getAttribute("aria-hidden") ?? null,
  ];
}

test("the three controls carry their word under the glyph, out of their names", async () => {
  asAccount(["karaoke.sing", "wishlist.view", "wishlist.add"]);
  renderDetails();

  const favorite = await screen.findByRole("button", {
    name: "Add to favorites",
  });
  const sing = screen.getByRole("button", { name: "Sing" });
  const wish = screen.getByRole("button", { name: "Add to wishlist" });
  // Inside each button, after its glyph, hidden from the accessibility tree:
  // the `aria-label` keeps the verb and says the word already.
  expect(captionOf(favorite)).toEqual(["Favorite", "true"]);
  expect(captionOf(sing)).toEqual(["Sing", "true"]);
  expect(captionOf(wish)).toEqual(["Wishlist", "true"]);
  for (const button of [favorite, sing, wish]) {
    expect(button.lastElementChild).toHaveClass("song-control-caption");
    expect(button.firstElementChild).toHaveClass("icon");
  }
  // Three words in the row, in the row's order, and nowhere else in the modal.
  const dialog = screen.getByRole("dialog", { name: "Bohemian Rhapsody" });
  expect(
    Array.from(dialog.querySelectorAll(".song-control-caption")).map(
      (caption) => caption.textContent,
    ),
  ).toEqual(["Favorite", "Sing", "Wishlist"]);
  expect(
    dialog.querySelectorAll(".song-details-controls .song-control-caption"),
  ).toHaveLength(3);
});

test("a caller holding the room's selection takes Sing: the modal closes and hands over", async () => {
  asAccount(["karaoke.sing"]);
  const onClose = vi.fn();
  const onSing = vi.fn();
  renderDetails(onClose, onSing);

  const sing = await screen.findByRole("button", { name: "Sing" });
  expect(sing).toBeEnabled();
  fireEvent.click(sing);

  // Play's own path, the caller's: no player selection of the modal's own.
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onSing).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("dialog", { name: "Player selection" }),
  ).not.toBeInTheDocument();
});

test("a held selection this song cannot be sung through draws Sing disabled", async () => {
  asAccount(["karaoke.sing"]);
  const onClose = vi.fn();
  renderDetails(onClose, null);

  const sing = await screen.findByRole("button", { name: "Sing" });
  expect(sing).toBeDisabled();
  fireEvent.click(sing);
  expect(onClose).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("dialog", { name: "Player selection" }),
  ).not.toBeInTheDocument();
});

test("a caption names the control, not its state", async () => {
  asAccount(["wishlist.view", "wishlist.add"]);
  listWishlist.mockResolvedValue({
    data: {
      wishes: [{ song, count: 1, mine: true, latest: "2026-08-23T20:00:00Z" }],
    },
  });
  renderDetails();

  const wish = await screen.findByRole("button", {
    name: "Remove from wishlist",
  });
  // The glyph says on or off; the word stays the same.
  expect(captionOf(wish)).toEqual(["Wishlist", "true"]);
  // No Sing without the right, and so no caption for it either.
  expect(screen.queryByRole("button", { name: "Sing" })).toBeNull();
  expect(
    Array.from(document.querySelectorAll(".song-control-caption")).map(
      (caption) => caption.textContent,
    ),
  ).toEqual(["Favorite", "Wishlist"]);
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

test("the playlist button and picker wear the bulleted-list glyphs", async () => {
  withPlaylist(false);
  renderDetails();

  const option = await screen.findByRole("button", { name: "Add to playlist" });
  // A 40px icon button in the action bar, the glyph alone (§5).
  expect(option).toHaveClass("icon-button");
  expect(option).toHaveAttribute("title", "Add to playlist");
  expect(iconNames(option)).toEqual(["list-plus"]);
  expect(option.closest(".song-actions-errands")).not.toBeNull();

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

test("the genre fact wears the music glyph, the tags feature keeps its own", async () => {
  withTags([BROKEN]);
  renderSong(complete);

  await screen.findByRole("button", { name: /Tags/ });
  expect(iconNames(screen.getByTitle("Genre: Rock"))).toEqual(["music"]);
  // `tag` is the action bar's, and only there.
  expect(
    iconNames(document.querySelector(".song-facts") as Element),
  ).not.toContain("tag");
});

test("the language fact wears the flag, the glyph the Language facet wears", async () => {
  renderDetails();

  await screen.findByRole("button", { name: /Comments/ });
  // Not `globe`: that one means global sharing (a public playlist, USDB).
  expect(iconNames(screen.getByTitle("Language: English"))).toEqual(["flag"]);
});

test("the host screen gets no playlist errand: a playlist is somebody's", async () => {
  // Every right and no account, exactly what the host token grants.
  getMe.mockResolvedValue(
    meResponse(["songs.view", "playlists.manage", "songs.edit"], {
      role: "admin",
      is_host: true,
    }),
  );
  renderDetails();

  // The pencil waits for `/auth/me`, so the answer has arrived by now.
  await screen.findByRole("button", { name: "Edit details" });
  const errands = document.querySelector(".song-actions-errands") as Element;
  expect(iconNames(errands)).toEqual(["external-link"]);
});

test("an account whose role may not manage playlists gets no playlist errand", async () => {
  asAccount(["songs.edit"]);
  renderDetails();

  await screen.findByRole("button", { name: "Edit details" });
  expect(
    screen.queryByRole("button", { name: "Add to playlist" }),
  ).not.toBeInTheDocument();
});

test("the playlist picker's close goes back to the song", async () => {
  withPlaylist(false);
  renderDetails();

  fireEvent.click(
    await screen.findByRole("button", { name: "Add to playlist" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Add to playlist" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(
    await screen.findByRole("dialog", { name: "Bohemian Rhapsody" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add to playlist" })).toBeVisible();
});

test("there is no tag button when the reader may not view a single tag", async () => {
  renderDetails();

  await screen.findByRole("button", { name: /Comments/ });
  expect(
    screen.queryByRole("button", { name: /Tags/ }),
  ).not.toBeInTheDocument();
});

test("the action bar counts the song's tags and opens the sub-view", async () => {
  const many = [1, 2, 3, 4].map((n) =>
    tagRead({ id: `t${n}`, name: `tag ${n}`, icon: "music" }),
  );
  withTags([...many, ARCHIVE], [...many.map((tag) => tag.id), "t-archive"]);
  renderDetails();

  const button = await screen.findByRole("button", { name: /Tags/ });
  // The feature's glyph and how many the song wears — never the tags' own
  // glyphs, which stopped being recognisable past three of them.
  await waitFor(() => expect(button).toHaveTextContent("5"));
  expect(button).toHaveAccessibleName("Tags, 5");
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
  // The dash is drawn, never read out: the name waits for a number.
  expect(button).toHaveAccessibleName("Tags");
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

test("a tag set from the sub-view moves the action bar's count", async () => {
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

test("the action bar counts what was said and opens the sub-view", async () => {
  listSongComments.mockResolvedValue({
    data: {
      comments: [comment(1, "Bob", "Banger."), comment(2, "Cara", "No")],
    },
  });
  renderDetails();

  const row = await screen.findByRole("button", { name: /Comments/ });
  await waitFor(() => expect(row).toHaveTextContent("2"));
  // "Comments, 3" is the guideline's own example of a count's name (§5).
  expect(row).toHaveAccessibleName("Comments, 2");
  expect(row).toHaveAttribute("title", "Comments, 2");
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
  // Never answers: the state the bar is in for as long as the request runs.
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

test("a comment posted from the sub-view moves the action bar's count", async () => {
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

  // Back on the song, the action bar counts what was just said.
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

test("no Delete inside the editor without the right", async () => {
  asAccount(["songs.edit"]);
  renderDetails();

  const dialog = await openEditor();
  expect(
    within(dialog).queryByRole("button", { name: "Delete song" }),
  ).not.toBeInTheDocument();
  // Nor is there a way in of its own, on the song or anywhere in its bar.
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await screen.findByRole("dialog", { name: "Bohemian Rhapsody" });
  expect(
    screen.queryByRole("button", { name: /Delete/ }),
  ).not.toBeInTheDocument();
});

test("Delete song is the danger button at the foot of the editor", async () => {
  asAccount(["songs.edit", "songs.delete"]);
  renderDetails();

  const dialog = await openEditor();
  const button = within(dialog).getByRole("button", { name: "Delete song" });
  // The one red thing in the whole errand (§1.6): the rows that lead here are
  // ordinary, and the weight is in this button and its confirmation.
  expect(button.className).toBe("button button-danger");
  // Under the primary Save, and the last thing in the form.
  const buttons = [...dialog.querySelectorAll(".song-edit button")];
  expect(buttons.map((each) => each.textContent)).toEqual([
    "Save",
    "Delete song",
  ]);
  expect(buttons[buttons.length - 1]).toBe(button);
});

test("deleting asks first, names the song and says the files go", async () => {
  asAccount(["songs.edit", "songs.delete"]);
  const onClose = vi.fn();
  renderDetails(onClose);

  const editor = await openEditor();
  fireEvent.click(within(editor).getByRole("button", { name: "Delete song" }));
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
  asAccount(["songs.edit", "songs.delete"]);
  const onClose = vi.fn();
  renderDetails(onClose);

  const editor = await openEditor();
  fireEvent.click(within(editor).getByRole("button", { name: "Delete song" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Delete song" })).getByRole(
      "button",
      { name: "Cancel" },
    ),
  );

  expect(deleteSong).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  // Back on the form the reader was looking at, not on the song behind it.
  expect(
    screen.getByRole("dialog", { name: "Edit details" }),
  ).toBeInTheDocument();
});

test("a song that is playing cannot be deleted, and the editor says why", async () => {
  asAccount(["songs.edit", "songs.delete"]);
  deleteSong.mockRejectedValue({ detail: "song_is_playing" });
  const onClose = vi.fn();
  renderDetails(onClose);

  const editor = await openEditor();
  fireEvent.click(within(editor).getByRole("button", { name: "Delete song" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Delete song" })).getByRole(
      "button",
      { name: "Delete" },
    ),
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "That song is playing right now. Stop it first.",
  );
  // The song is still there, so the editor stays open on it.
  expect(onClose).not.toHaveBeenCalled();
  expect(
    screen.getByRole("dialog", { name: "Edit details" }),
  ).toBeInTheDocument();
});

test("a reader who may only delete gets the editor locked around it", async () => {
  asAccount(["songs.delete"]);
  renderDetails();

  const dialog = await openEditor();
  // Every field is the song as it stands, and none of them is typeable.
  for (const field of [
    ...within(dialog).getAllByRole("textbox"),
    ...within(dialog).getAllByRole("spinbutton"),
  ]) {
    expect(field).toBeDisabled();
  }
  // No Save, and a line saying why the form does not offer one.
  expect(
    within(dialog).queryByRole("button", { name: "Save" }),
  ).not.toBeInTheDocument();
  expect(dialog).toHaveTextContent("Your role may not change these values.");
  // The one thing they came for is live.
  expect(
    within(dialog).getByRole("button", { name: "Delete song" }),
  ).toBeEnabled();
});

test("a deletion in flight locks the form it started in", async () => {
  asAccount(["songs.edit", "songs.delete"]);
  // Never answers: the editor is left in the state a slow backend leaves it in.
  deleteSong.mockReturnValue(new Promise(() => {}));
  renderDetails();

  const dialog = await openEditor();
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete song" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Delete song" })).getByRole(
      "button",
      { name: "Delete" },
    ),
  );

  // Saving over a song that is being deleted is a 404 into a closing modal, so
  // the whole form waits for the answer.
  await waitFor(() =>
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled(),
  );
  for (const field of [
    ...within(dialog).getAllByRole("textbox"),
    ...within(dialog).getAllByRole("spinbutton"),
  ]) {
    expect(field).toBeDisabled();
  }
  expect(
    within(dialog).getByRole("button", { name: "Delete song" }),
  ).toBeDisabled();
});

test("no Edit details pencil without either right", async () => {
  renderDetails();

  // The trophy waits for `/auth/me`, so by the time it is here the pencil has
  // had its answer too, and the answer is no. The facts stand alone.
  await screen.findByRole("button", { name: /Best scores/ });
  expect(
    screen.queryByRole("button", { name: "Edit details" }),
  ).not.toBeInTheDocument();
  expect(
    iconNames(document.querySelector(".song-facts") as Element),
  ).not.toContain("pencil");
});

test("the right to delete alone is enough for the Edit details pencil", async () => {
  asAccount(["songs.delete"]);
  renderDetails();

  expect(
    await screen.findByRole("button", { name: "Edit details" }),
  ).toBeInTheDocument();
});

test("Edit details is the pencil that ends the fact line", async () => {
  asAccount(["playlists.manage", "songs.edit", "songs.delete"]);
  renderDetails();

  const pencil = await screen.findByRole("button", { name: "Edit details" });
  // A 40px icon button with the pencil (§3), the details' own way to change
  // them, and the last thing on their line.
  expect(pencil.className).toBe("icon-button song-facts-edit");
  expect(pencil).toHaveAttribute("title", "Edit details");
  expect(iconNames(pencil)).toEqual(["pencil"]);
  const line = pencil.closest(".song-facts") as HTMLElement;
  expect(line.lastElementChild).toBe(pencil);
  // Not in the action bar: that one holds the counts and the errands.
  expect(pencil.closest(".song-actions")).toBeNull();
});

test("the editor's close goes back to the song", async () => {
  asAccount(["songs.edit"]);
  renderDetails();

  const dialog = await openEditor();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(
    await screen.findByRole("dialog", { name: "Bohemian Rhapsody" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit details" })).toBeVisible();
});

/** A duet as USDB files it: the tag is in the title, never in a service's. */
const duet: SongRead = {
  ...song,
  id: "usdb:2",
  artist: "Sonny & Cher",
  title: "I Got You Babe [DUET]",
  is_duet: true,
};

function renderSong(shown: SongRead) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SongDetails song={shown} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

/** Opens the streaming sub-view and hands back its dialog. */
async function openStreaming(): Promise<HTMLElement> {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open in a streaming service" }),
  );
  return screen.getByRole("dialog", { name: "Open in a streaming service" });
}

test("a guest gets the streaming errand too, a right nobody needs", async () => {
  // Nobody: no account, no right beyond seeing the song.
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  renderDetails();

  const button = await screen.findByRole("button", {
    name: "Open in a streaming service",
  });
  // A 40px icon button that opens a view inside, its glyph alone.
  expect(button.className).toBe("icon-button");
  expect(button).toHaveAttribute("title", "Open in a streaming service");
  expect(iconNames(button)).toEqual(["external-link"]);
  // A guest's bar: the comments, and the one errand everybody gets. No
  // trophy (no `stats.history`), no tags to see, no playlist without an
  // account, and no pencil on the fact line.
  await waitFor(() => expect(getMe).toHaveBeenCalled());
  await waitFor(() =>
    expect(
      iconNames(document.querySelector(".song-actions") as Element),
    ).toEqual(["comment", "external-link"]),
  );
  expect(
    screen.queryByRole("button", { name: "Edit details" }),
  ).not.toBeInTheDocument();
});

test("the streaming view links to each service's search, in a new tab", async () => {
  renderDetails();

  const dialog = await openStreaming();

  // No note over the rows: what they do is plain from them.
  expect(
    within(dialog).queryByText(/searches for this song/),
  ).not.toBeInTheDocument();
  expect(dialog.querySelector(".section-note")).toBeNull();
  const links = within(dialog).getAllByRole("link");
  expect(links.map((link) => link.textContent)).toEqual([
    "Spotify",
    "Apple Music",
    "YouTube Music",
    "Tidal",
    "Deezer",
  ]);
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    "https://open.spotify.com/search/Queen%20Bohemian%20Rhapsody",
    "https://music.apple.com/search?term=Queen%20Bohemian%20Rhapsody",
    "https://music.youtube.com/search?q=Queen%20Bohemian%20Rhapsody",
    "https://tidal.com/search?q=Queen%20Bohemian%20Rhapsody",
    "https://www.deezer.com/search/Queen%20Bohemian%20Rhapsody",
  ]);
  for (const link of links) {
    // Real anchors, so a long press or a middle click works as on any link.
    expect(link.tagName).toBe("A");
    expect(link).toHaveClass("song-option");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  }
  // Each service's mark where a row glyph sits, then the way out, where a
  // chevron would promise a view inside.
  expect(links.map((link) => iconNames(link))).toEqual([
    ["brand-spotify", "external-link"],
    ["brand-applemusic", "external-link"],
    ["brand-youtubemusic", "external-link"],
    ["brand-tidal", "external-link"],
    ["brand-deezer", "external-link"],
  ]);
  for (const link of links) {
    // The mark is the row's glyph, monochrome, before the name.
    const mark = link.firstElementChild;
    expect(mark).toHaveClass("song-option-icon", "song-option-brand");
    expect(mark?.nextElementSibling).toHaveClass("song-option-label");
    expect(mark).toHaveAttribute("aria-hidden", "true");
  }
});

test("a duet is searched for without the tag its title carries", async () => {
  renderSong(duet);

  const dialog = await openStreaming();
  const hrefs = within(dialog)
    .getAllByRole("link")
    .map((link) => link.getAttribute("href") ?? "");

  expect(hrefs).toContain(
    "https://open.spotify.com/search/Sonny%20%26%20Cher%20I%20Got%20You%20Babe",
  );
  expect(new URL(hrefs[1]).searchParams.get("term")).toBe(
    "Sonny & Cher I Got You Babe",
  );
  for (const href of hrefs) expect(href).not.toMatch(/DUET/i);
});

test("the streaming view's close goes back to the song", async () => {
  renderDetails();

  const dialog = await openStreaming();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

  expect(
    screen.queryByRole("dialog", { name: "Open in a streaming service" }),
  ).not.toBeInTheDocument();
  expect(
    await screen.findByRole("button", { name: "Open in a streaming service" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Bohemian Rhapsody", { selector: "h3" }),
  ).toBeVisible();
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
  // The fact line says it at once, glyph and all.
  expect(factsOf(song_modal.querySelector(".song-facts") as Element)).toEqual([
    ["flag", "Language", "English"],
    ["music", "Genre", "Rock"],
    ["calendar", "Year", "1976"],
  ]);
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
