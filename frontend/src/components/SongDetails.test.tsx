import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ScoreWithContext, SongRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import { iconNames } from "../test/icons";
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
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  listSongScores: vi.fn(),
  listWishlist: vi.fn(),
  listPlaylists: vi.fn(),
  listPlayers: vi.fn(),
  getPlaylist: vi.fn(),
  addPlaylistEntry: vi.fn(),
  removePlaylistEntry: vi.fn(),
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

test("the playlist row and picker wear the bulleted-list glyphs", async () => {
  withPlaylist([]);
  renderDetails();

  const option = await screen.findByRole("button", { name: "Add to playlist" });
  expect(iconNames(option)).toEqual(["list-plus", "chevron-right"]);

  fireEvent.click(option);
  const dialog = screen.getByRole("dialog", { name: "Add to playlist" });
  const row = within(dialog).getByRole("button", { name: /Warm-up/ });
  expect(iconNames(row)).toEqual(["list"]);
});

/** A logged-in playlist owner with one playlist, `entries` as given. */
function withPlaylist(entries: { song: SongRead }[]) {
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
          song_count: entries.length,
          duration_seconds: 0,
          cover_song_ids: [],
          my_access: "owner",
          followed: true,
          can_edit: true,
          can_manage: true,
          contains: null,
        },
      ],
    },
  });
  getPlaylist.mockResolvedValue({
    data: { id: "pl-1", name: "Warm-up", entries },
  });
}

test("a playlist owner adds the song from the playlist picker", async () => {
  withPlaylist([]);
  addPlaylistEntry.mockResolvedValue({ data: {} });
  renderDetails();

  fireEvent.click(
    await screen.findByRole("button", { name: "Add to playlist" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Add to playlist" });
  const row = within(dialog).getByRole("button", { name: /Warm-up/ });
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
  withPlaylist([{ song }]);
  removePlaylistEntry.mockResolvedValue({ data: undefined });
  renderDetails();

  fireEvent.click(
    await screen.findByRole("button", { name: "Add to playlist" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Add to playlist" });
  const row = await within(dialog).findByRole("button", {
    name: /Warm-up/,
  });
  await waitFor(() => expect(row).toHaveAttribute("aria-pressed", "true"));
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
