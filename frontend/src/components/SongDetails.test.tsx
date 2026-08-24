import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ScoreWithContext, SongRead } from "../api";
import { meResponse } from "../test/auth";
import SongDetails from "./SongDetails";

const { getMe, listSongScores, listWishlist, listPlaylists } = vi.hoisted(
  () => ({
    getMe: vi.fn(),
    listSongScores: vi.fn(),
    listWishlist: vi.fn(),
    listPlaylists: vi.fn(),
  }),
);

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listSongScores,
  listWishlist,
  listPlaylists,
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

test("the song's five best scores are shown, best first", async () => {
  renderDetails();

  const best = await screen.findByRole("list");
  expect(
    within(best)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual(["Alice9500", "Bob5000", "Chris4000", "Dan3000", "Erin2000"]);
  expect(screen.queryByText("Frank")).not.toBeInTheDocument();
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
  expect(screen.getByRole("dialog")).toHaveTextContent("5:55");

  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("English")).toBeVisible();

  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
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
