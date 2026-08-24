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
import SongDetails from "./SongDetails";

const {
  getMe,
  listSongScores,
  listWishlist,
  listPlaylists,
  getPlaylist,
  addPlaylistEntry,
  removePlaylistEntry,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  listSongScores: vi.fn(),
  listWishlist: vi.fn(),
  listPlaylists: vi.fn(),
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
): ScoreWithContext {
  return {
    id,
    sing_id: `sing-${id}`,
    player_id: null,
    player_name: playerName,
    score: value,
    difficulty: 2,
    recorded_at: "2026-08-23T20:00:00Z",
    song,
    sing_started_at: "2026-08-23T19:55:00Z",
  };
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
  getMe.mockResolvedValue(meResponse(["songs.view", "stats.view"]));
  listSongScores.mockResolvedValue({ data: { scores: history } });
  listWishlist.mockResolvedValue({ data: { wishes: [] } });
  listPlaylists.mockResolvedValue({ data: { playlists: [] } });
});

test("the best-scores row carries the top score and opens the ranked view", async () => {
  renderDetails();

  const row = await screen.findByRole("button", { name: /Best scores/ });
  expect(row).toHaveTextContent("9500");

  fireEvent.click(row);
  const dialog = screen.getByRole("dialog", { name: "Best scores" });
  expect(
    within(dialog)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([
    "Alice9500",
    "Bob5000",
    "Chris4000",
    "Dan3000",
    "Erin2000",
    "Frank1000",
  ]);

  // Closing the ranking returns to the song, not to the list behind it.
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(
    screen.getByRole("dialog", { name: "Bohemian Rhapsody" }),
  ).toBeInTheDocument();
});

test("a song nobody has sung shows no scores section", async () => {
  listSongScores.mockResolvedValue({ data: { scores: [] } });
  renderDetails();

  await waitFor(() => expect(listSongScores).toHaveBeenCalled());
  expect(screen.queryByText("Best scores")).not.toBeInTheDocument();
});

test("without stats.view the scores are not even requested", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view"]));
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
          shared: false,
          owner_username: null,
          song_count: entries.length,
          mine: true,
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
