import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { CurrentSing, ScoreWithContext, SongRead } from "../api";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import HostResults from "./HostResults";

const { getMe, getCurrentSing, listLatestScores, listSongScores } = vi.hoisted(
  () => ({
    getMe: vi.fn(),
    getCurrentSing: vi.fn(),
    listLatestScores: vi.fn(),
    listSongScores: vi.fn(),
  }),
);

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  getCurrentSing,
  listLatestScores,
  listSongScores,
}));

const RHAPSODY: SongRead = {
  id: "usdb:1",
  artist: "Queen",
  title: "Bohemian Rhapsody",
  duration_seconds: null,
  has_video: false,
  is_duet: false,
  language: null,
  genre: null,
  year: null,
  edition: null,
  creator: null,
  source: "usdb",
};

function score(
  id: number,
  singId: string,
  playerName: string,
  value: number,
): ScoreWithContext {
  return {
    id,
    sing_id: singId,
    player_id: null,
    player_name: playerName,
    score: value,
    difficulty: 2,
    recorded_at: "2026-08-23T20:00:00Z",
    song: RHAPSODY,
    sing_started_at: "2026-08-23T19:55:00Z",
  };
}

/** The duet that just finished, plus an older sing nothing may mix in. */
const latest = [
  score(3, "sing-2", "Bob", 6000),
  score(4, "sing-2", "Alice", 8500),
  score(1, "sing-1", "Chris", 4000),
];

const RUNNING: CurrentSing = {
  sing_id: "sing-3",
  started_at: "2026-08-23T20:05:00+00:00",
  song: {
    id: "usdb:2",
    source: "usdb",
    title: "Dancing Queen",
    artist: "ABBA",
    duration_seconds: 231,
    has_video: true,
    is_duet: false,
    language: null,
    genre: null,
    year: null,
    edition: null,
    creator: null,
  },
  slots: [],
};

/** Name, rating word and score of every bar, top bar first. */
function bars(container: HTMLElement): (string | null)[][] {
  return [...container.querySelectorAll(".last-song-row")].map((row) => [
    row.querySelector(".last-song-name")?.textContent ?? null,
    row.querySelector(".last-song-evaluation")?.textContent ?? null,
    row.querySelector(".last-song-score")?.textContent ?? null,
  ]);
}

function renderResults(fallback?: ReactNode, suppressed = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {/* The avatars' source is the page's, not this component's — an empty
          map still draws every singer's initial. */}
      <HostResults
        players={new Map()}
        fallback={fallback}
        suppressed={suppressed}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  getMe.mockReset();
  getCurrentSing.mockReset();
  listLatestScores.mockReset();
  listSongScores.mockReset();
  getMe.mockResolvedValue(meResponse(["stats.view"]));
  getCurrentSing.mockResolvedValue({ data: { sing: null } });
  listLatestScores.mockResolvedValue({ data: { scores: latest } });
  listSongScores.mockResolvedValue({ data: { scores: latest } });
});

afterEach(() => vi.unstubAllGlobals());

test("a reload right after a song still shows that song's scores", async () => {
  const { container } = renderResults();

  const block = await screen.findByLabelText("Last song");
  expect(block).toHaveTextContent("Bohemian Rhapsody");
  expect(block).toHaveTextContent("Queen");
  // Only the last sing, best singer first — the older sing gets no bar. Each
  // bar carries the USDX rating word for its score.
  expect(bars(container)).toEqual([
    ["Alice", "Lead Singer", "8500"],
    ["Bob", "Hopeful", "6000"],
  ]);
});

test("the last song carries its album cover", async () => {
  const { container } = renderResults();

  await screen.findByLabelText("Last song");
  expect(container.querySelector(".last-song-cover")).toHaveAttribute(
    "src",
    "/api/v1/songs/usdb%3A1/cover",
  );
});

test("the song's whole history is on the screen, not just this run", async () => {
  renderResults();

  // The all-time lines arrive with the song's own score list, one round trip
  // behind the bars.
  const block = await screen.findByLabelText("Last song");
  await screen.findByTitle("Times sung");
  // Two performances ever, best 8500 by Alice, worst 4000 by Chris — who sang
  // it before and never gets a bar of this sing.
  expect(within(block).getByTitle("Times sung")).toHaveTextContent("2");
  expect(within(block).getByTitle("Best score")).toHaveTextContent(
    "8500 (Alice)",
  );
  expect(within(block).getByTitle("Average score")).toHaveTextContent("6167");
  expect(within(block).getByTitle("Worst score")).toHaveTextContent(
    "4000 (Chris)",
  );
});

test("a record set by the finished sing is called out once", async () => {
  renderResults();

  const block = await screen.findByLabelText("Last song");
  // 8500 is the song's all-time best and it was scored just now, so Alice owns
  // the record — and only her bar says so.
  await screen.findByText("New Highscore");
  expect(within(block).getAllByText("New Highscore")).toHaveLength(1);
});

test("a song that was sung better before gets no record marker", async () => {
  listSongScores.mockResolvedValue({
    data: { scores: [...latest, score(9, "sing-0", "Dora", 9500)] },
  });
  renderResults();

  const block = await screen.findByLabelText("Last song");
  expect(await screen.findByTitle("Best score")).toHaveTextContent(
    "9500 (Dora)",
  );
  expect(within(block).queryByText("New Highscore")).not.toBeInTheDocument();
});

test("a reload in the middle of a song shows the sing, not old scores", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: RUNNING } });
  renderResults(<p>idle fallback</p>);

  await waitFor(() => expect(getCurrentSing).toHaveBeenCalled());
  // The stage is single-state: neither the results nor the idle fallback may
  // show up next to the running song.
  expect(screen.queryByLabelText("Last song")).not.toBeInTheDocument();
  expect(screen.queryByText("idle fallback")).not.toBeInTheDocument();
});

test("without scores the host stage falls back to its idle content", async () => {
  listLatestScores.mockResolvedValue({ data: { scores: [] } });
  renderResults(<p>idle fallback</p>);

  expect(await screen.findByText("idle fallback")).toBeInTheDocument();
  // No song: nothing to ask its history about either.
  expect(listSongScores).not.toHaveBeenCalled();
});

test("new scores bring the block back and refresh it", async () => {
  listLatestScores.mockResolvedValue({ data: { scores: [] } });
  renderResults();
  await waitFor(() => expect(listLatestScores).toHaveBeenCalled());
  expect(screen.queryByLabelText("Last song")).not.toBeInTheDocument();

  listLatestScores.mockResolvedValue({ data: { scores: latest } });
  FakeSocket.deliver({
    event: "scores.recorded",
    sing_id: "sing-2",
    scores: [],
  });

  expect(await screen.findByLabelText("Last song")).toHaveTextContent("Alice");
});

test("the block gets out of the way when the next song starts", async () => {
  renderResults();
  await screen.findByLabelText("Last song");

  FakeSocket.deliver({ event: "karaoke.started", sing: null });

  await waitFor(() =>
    expect(screen.queryByLabelText("Last song")).not.toBeInTheDocument(),
  );
});

test("while the badges own the stage the results wait their turn", async () => {
  renderResults(<p>idle fallback</p>, true);

  // The scores are the right ones and everything is still being listened for —
  // the achievements a finished song earned are simply on the stage first.
  expect(await screen.findByText("idle fallback")).toBeInTheDocument();
  expect(screen.queryByLabelText("Last song")).not.toBeInTheDocument();
});

test("a role without stats.view sees nothing and asks for nothing", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  renderResults();

  await waitFor(() => expect(getMe).toHaveBeenCalled());
  expect(screen.queryByLabelText("Last song")).not.toBeInTheDocument();
  expect(listLatestScores).not.toHaveBeenCalled();
});
