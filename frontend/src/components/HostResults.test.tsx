import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import type {
  CurrentSing,
  ScoreWithContext,
  SessionRead,
  SongRead,
} from "../api";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import HostResults from "./HostResults";

const {
  getMe,
  getCurrentSing,
  listLatestScores,
  listPlayers,
  listSessionScores,
  listSessions,
  listSongScores,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  getCurrentSing: vi.fn(),
  listLatestScores: vi.fn(),
  listPlayers: vi.fn(),
  listSessionScores: vi.fn(),
  listSessions: vi.fn(),
  listSongScores: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  getCurrentSing,
  listLatestScores,
  listPlayers,
  listSessionScores,
  listSessions,
  listSongScores,
}));

const RHAPSODY: SongRead = {
  id: "usdb:1",
  artist: "Queen",
  title: "Bohemian Rhapsody",
  duration_seconds: null,
  has_video: false,
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

/** The whole session — which for these fixtures is the song's whole life too. */
const session: SessionRead = {
  id: "session-1",
  name: null,
  started_at: "2026-08-23T19:00:00Z",
  last_activity_at: "2026-08-23T20:00:00Z",
  sing_count: 2,
  score_count: 3,
};

/** A party from July, listed after the running one to prove the order rule. */
const older: SessionRead = {
  ...session,
  id: "session-0",
  started_at: "2026-07-01T19:00:00Z",
  last_activity_at: "2026-07-01T21:00:00Z",
};

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

/** Rank, name and value of every leaderboard row, best first. */
function ranking(): (string | null)[][] {
  const board = screen.getByLabelText("Session leaderboard");
  return within(board)
    .getAllByRole("listitem")
    .map((row) => [
      row.querySelector(".host-leaderboard-rank")?.textContent ?? null,
      row.querySelector(".host-leaderboard-name")?.textContent ?? null,
      row.querySelector(".host-leaderboard-value")?.textContent ?? null,
    ]);
}

function renderResults(fallback?: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HostResults fallback={fallback} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  getMe.mockReset();
  getCurrentSing.mockReset();
  listLatestScores.mockReset();
  listSongScores.mockReset();
  listSessions.mockReset();
  listSessionScores.mockReset();
  listPlayers.mockReset();
  getMe.mockResolvedValue(meResponse(["stats.view"]));
  getCurrentSing.mockResolvedValue({ data: { sing: null } });
  listLatestScores.mockResolvedValue({ data: { scores: latest } });
  listSongScores.mockResolvedValue({ data: { scores: latest } });
  listSessions.mockResolvedValue({ data: { sessions: [older, session] } });
  listSessionScores.mockResolvedValue({ data: { scores: latest } });
  listPlayers.mockResolvedValue({ data: { players: [] } });
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
  // The stage is single-state: neither the results, nor the leaderboard, nor
  // the idle fallback may show up next to the running song.
  expect(screen.queryByLabelText("Last song")).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText("Session leaderboard"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("idle fallback")).not.toBeInTheDocument();
});

test("without scores the host stage falls back to its idle content", async () => {
  listLatestScores.mockResolvedValue({ data: { scores: [] } });
  listSessions.mockResolvedValue({ data: { sessions: [] } });
  renderResults(<p>idle fallback</p>);

  expect(await screen.findByText("idle fallback")).toBeInTheDocument();
  // No song, no session: nothing to ask about either.
  expect(listSongScores).not.toHaveBeenCalled();
  expect(listSessionScores).not.toHaveBeenCalled();
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

test("a role without stats.view sees nothing and asks for nothing", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  renderResults();

  await waitFor(() => expect(getMe).toHaveBeenCalled());
  expect(screen.queryByLabelText("Last song")).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText("Session leaderboard"),
  ).not.toBeInTheDocument();
  expect(listLatestScores).not.toHaveBeenCalled();
  expect(listSessions).not.toHaveBeenCalled();
});

test("the leaderboard ranks the running session by best score by default", async () => {
  renderResults();

  await screen.findByLabelText("Session leaderboard");
  expect(ranking()).toEqual([
    ["1", "Alice", "8500"],
    ["2", "Bob", "6000"],
    ["3", "Chris", "4000"],
  ]);
  // Newest activity wins, whatever order the backend listed the sessions in.
  expect(listSessionScores.mock.calls[0][0].path).toEqual({
    session_id: "session-1",
  });
});

test("the leaderboard order can be switched to average and to sings", async () => {
  // Chris sang twice, weakly both times: best puts him last, sings first.
  listSessionScores.mockResolvedValue({
    data: { scores: [...latest, score(7, "sing-0", "Chris", 5000)] },
  });
  renderResults();

  const board = await screen.findByLabelText("Session leaderboard");
  expect(ranking()).toEqual([
    ["1", "Alice", "8500"],
    ["2", "Bob", "6000"],
    ["3", "Chris", "5000"],
  ]);

  fireEvent.click(within(board).getByRole("radio", { name: "average" }));
  expect(ranking()).toEqual([
    ["1", "Alice", "8500"],
    ["2", "Bob", "6000"],
    ["3", "Chris", "4500"],
  ]);

  // A count is not a score, so it is not printed as one.
  fireEvent.click(within(board).getByRole("radio", { name: "sings" }));
  expect(ranking()).toEqual([
    ["1", "Chris", "2×"],
    ["2", "Alice", "1×"],
    ["3", "Bob", "1×"],
  ]);
});

test("one performance ranks nobody, so the first song gets no leaderboard", async () => {
  listSessionScores.mockResolvedValue({
    data: { scores: latest.filter((row) => row.sing_id === "sing-2") },
  });
  renderResults();

  await screen.findByLabelText("Last song");
  expect(
    screen.queryByLabelText("Session leaderboard"),
  ).not.toBeInTheDocument();
});

test("the leaderboard stays up once the last song is out of the way", async () => {
  renderResults(<p>idle fallback</p>);
  await screen.findByLabelText("Session leaderboard");

  FakeSocket.deliver({ event: "karaoke.started", sing: null });

  // The song was stopped before USDX scored it: the results are stale, the
  // party's standing is not.
  expect(await screen.findByText("idle fallback")).toBeInTheDocument();
  expect(screen.getByLabelText("Session leaderboard")).toBeInTheDocument();
});
