import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ScoreWithContext, SongRead } from "../api";
import { shortDate } from "../duration";
import { meResponse, userRead } from "../test/auth";
import UserStats from "./UserStats";

interface RenderedChart {
  label: string;
  option: { yAxis?: { data?: string[] } };
}

const { getMe, listPlayerScores, listPlayers, charts } = vi.hoisted(() => ({
  getMe: vi.fn(),
  listPlayerScores: vi.fn(),
  listPlayers: vi.fn(),
  charts: [] as { label: string; option: { yAxis?: { data?: string[] } } }[],
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listPlayerScores,
  listPlayers,
}));

// jsdom has no canvas, so the real chart cannot render; the option building is
// covered in `stats.test.ts` and the mock only records what it was handed.
vi.mock("../components/Chart", () => ({
  default: ({ option, label }: RenderedChart) => {
    charts.push({ option, label });
    return <div data-testid="chart">{label}</div>;
  },
}));

vi.mock("../components/SongDetails", () => ({
  default: ({ song }: { song: SongRead }) => (
    <div data-testid="song-details">{song.title}</div>
  ),
}));

const CAPABILITIES = ["songs.view", "players.view", "stats.view"];

function song(id: string, artist: string, title: string): SongRead {
  return {
    id,
    artist,
    title,
    duration_seconds: null,
    has_video: false,
    language: null,
    genre: null,
    year: null,
    edition: null,
    creator: null,
    source: "usdb",
  };
}

function score(
  id: number,
  value: number,
  songRead: SongRead,
  singId: string,
): ScoreWithContext {
  return {
    id,
    sing_id: singId,
    player_id: "aaa",
    player_name: "Alice",
    score: value,
    difficulty: 1,
    recorded_at: "2026-08-23T20:00:00Z",
    song: songRead,
    sing_started_at: "2026-08-23T19:55:00Z",
  };
}

const bohemian = song("usdb:1", "Queen", "Bohemian Rhapsody");
const wonderwall = song("usdb:2", "Oasis", "Wonderwall");

// Two songs, two runs each: Bohemian peaks higher, Wonderwall is the steadier
// of the two — enough for the four orders to disagree with each other.
const HISTORY = [
  score(1, 9500, bohemian, "sing-1"),
  score(2, 3000, bohemian, "sing-2"),
  score(3, 8000, wonderwall, "sing-3"),
  score(4, 7000, wonderwall, "sing-4"),
];

/** A logged-in account that owns player `aaa`. */
function loggedIn(
  capabilities = CAPABILITIES,
  playerId: string | null = "aaa",
) {
  getMe.mockResolvedValue(
    meResponse(capabilities, {
      user: userRead({ username: "Alice", player_id: playerId }),
      role: "user",
    }),
  );
}

function renderStats() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    // The router carries the back arrow and the empty state's link.
    <MemoryRouter initialEntries={["/user/stats"]}>
      <QueryClientProvider client={client}>
        <UserStats />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** The group rows in the order the page put them. */
function groupLabels(): (string | null)[] {
  return screen
    .getAllByTestId("score-group")
    .map((row) => row.querySelector(".score-group-label")?.textContent ?? null);
}

beforeEach(() => {
  vi.resetAllMocks();
  charts.length = 0;
  loggedIn();
  listPlayerScores.mockResolvedValue({ data: { scores: HISTORY } });
  listPlayers.mockResolvedValue({
    data: {
      players: [
        { id: "aaa", name: "Alice", registered: true, has_avatar: false },
      ],
    },
  });
});

test("the account's whole history is grouped by song, best first", async () => {
  renderStats();

  expect(
    await screen.findByRole("heading", { name: "Your scores" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
    "href",
    "/user",
  );
  await waitFor(() =>
    expect(listPlayerScores.mock.calls[0][0].path).toEqual({
      player_id: "aaa",
    }),
  );

  // One row per song, not per score, and the strongest song leads.
  await waitFor(() =>
    expect(groupLabels()).toEqual([
      "Queen – Bohemian Rhapsody",
      "Oasis – Wonderwall",
    ]),
  );
});

test("the one control is a quiet Sort select — this page never groups", async () => {
  renderStats();

  const sort = await screen.findByLabelText("Sort");
  expect(sort).toHaveClass("text-input-quiet");
  expect(sort).toHaveValue("best");
  expect(
    within(sort)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["alphabetically", "average score", "best score", "worst score"]);
  // Grouping is fixed: one singer grouped by player would be a single row.
  expect(screen.queryByLabelText("Group")).not.toBeInTheDocument();
});

test("sorting reorders the songs without touching the grouping", async () => {
  renderStats();
  await waitFor(() => expect(groupLabels()).toHaveLength(2));

  // Bohemian has the single best run; Wonderwall is the steadier song, so it
  // takes the lead the moment the average decides the order.
  fireEvent.change(screen.getByLabelText("Sort"), {
    target: { value: "average" },
  });
  await waitFor(() => expect(groupLabels()[0]).toBe("Oasis – Wonderwall"));

  // "worst score" sorts the other way round — the biggest flop leads.
  fireEvent.change(screen.getByLabelText("Sort"), {
    target: { value: "worst" },
  });
  await waitFor(() =>
    expect(groupLabels()[0]).toBe("Queen – Bohemian Rhapsody"),
  );

  // Still two songs, never four scores: the grouping is not a control here.
  expect(screen.queryAllByTestId("score-group")).toHaveLength(2);
});

test("a spread of two songs is worth a chart", async () => {
  renderStats();

  expect(await screen.findByTestId("chart")).toHaveTextContent(
    "Score spread per song",
  );
  expect(
    screen.getByRole("heading", { name: "Score spread" }),
  ).toBeInTheDocument();
});

test("a single song gets the list alone", async () => {
  listPlayerScores.mockResolvedValue({
    data: { scores: [score(1, 9500, bohemian, "sing-1")] },
  });
  renderStats();

  await waitFor(() => expect(groupLabels()).toHaveLength(1));
  expect(screen.queryByTestId("chart")).not.toBeInTheDocument();
});

test("a singer without a single score is asked to sing, not shown an empty list", async () => {
  listPlayerScores.mockResolvedValue({ data: { scores: [] } });
  renderStats();

  expect(
    await screen.findByText(
      "Sing a song and your whole record builds up here.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Browse songs" })).toHaveAttribute(
    "href",
    "/songs",
  );
  expect(screen.queryByLabelText("Sort")).not.toBeInTheDocument();
});

test("a role without stats.view is told so and asks for nothing", async () => {
  loggedIn(CAPABILITIES.filter((name) => name !== "stats.view"));
  renderStats();

  expect(
    await screen.findByText(/Statistics are not open to your role/),
  ).toBeInTheDocument();
  expect(listPlayerScores).not.toHaveBeenCalled();
});

test("an account without a player has nothing to total up", async () => {
  loggedIn(CAPABILITIES, null);
  renderStats();

  expect(
    await screen.findByText(/not linked to a player yet/),
  ).toBeInTheDocument();
  expect(listPlayerScores).not.toHaveBeenCalled();
});

test("nothing in the list repeats the one singer it is about", async () => {
  renderStats();
  await waitFor(() => expect(groupLabels()).toHaveLength(2));

  // Best and worst name the singer under a song — but here every score is the
  // reader's own, and the repeated name pushes the rest of the caption off a
  // phone. The numbers themselves stay.
  const caption = screen
    .getAllByTestId("score-group")[0]
    .querySelector(".score-group-caption");
  expect(caption).not.toHaveTextContent("Alice");
  expect(caption).toHaveTextContent("9500");
  expect(caption).toHaveTextContent("3000");
});

test("a score is dated, not just clocked: this list spans parties", async () => {
  renderStats();

  fireEvent.click(await screen.findByText("Queen – Bohemian Rhapsody"));

  const rows = await screen.findAllByTestId("score-row");
  // The day, because two runs of one song can be months apart. Built the way
  // the page builds it: the rendered date is the runner's locale, not ours.
  expect(rows[0]).toHaveTextContent(shortDate("2026-08-23T20:00:00Z"));
});

test("a song sung once is captioned by its run, not by the reader's own name", async () => {
  listPlayerScores.mockResolvedValue({
    data: { scores: [score(1, 9500, bohemian, "sing-1")] },
  });
  renderStats();

  await waitFor(() => expect(groupLabels()).toHaveLength(1));
  const caption = screen
    .getAllByTestId("score-group")[0]
    .querySelector(".score-group-caption");
  // Under a song the caption normally names the singer. Here that singer is
  // the reader, on every row of the page — the date is the half that says
  // something.
  expect(caption).not.toHaveTextContent("Alice");
  expect(caption).toHaveTextContent(shortDate("2026-08-23T20:00:00Z"));
});

test("a visitor without an account is not shown someone else's history", async () => {
  getMe.mockResolvedValue(meResponse(CAPABILITIES));
  renderStats();

  // Nothing links a guest here; typing the URL must still land on a sentence
  // rather than on a request for a player that is not theirs.
  expect(
    await screen.findByText(/not linked to a player yet/),
  ).toBeInTheDocument();
  expect(listPlayerScores).not.toHaveBeenCalled();
});

test("a cover opens the song modal from inside the history", async () => {
  renderStats();

  fireEvent.click(
    await screen.findByRole("button", {
      name: "Details for Bohemian Rhapsody",
    }),
  );

  expect(await screen.findByTestId("song-details")).toHaveTextContent(
    "Bohemian Rhapsody",
  );
});

test("an expanded row leads with the run, not with the reader's own name", async () => {
  renderStats();

  fireEvent.click(await screen.findByText("Queen – Bohemian Rhapsody"));
  const rows = await screen.findAllByTestId("score-row");

  // The singer is a given on this page; printing "Alice" plus her avatar once
  // per score says nothing and costs the row its whole left edge.
  expect(rows[0]).not.toHaveTextContent("Alice");
  expect(rows[0].querySelector(".player-avatar")).toBeNull();
  // What is left is when it happened, how hard it was and what it scored.
  expect(rows[0].querySelector(".score-entry-when")).toHaveTextContent(
    shortDate("2026-08-23T20:00:00Z"),
  );
  expect(rows[0]).toHaveTextContent("9500");
});

test("the roster is not fetched for a list of avatars nobody draws", async () => {
  renderStats();
  await waitFor(() => expect(groupLabels()).toHaveLength(2));

  expect(listPlayers).not.toHaveBeenCalled();
});

test("a failed history request says so instead of claiming nothing was sung", async () => {
  listPlayerScores.mockRejectedValue({ detail: "boom" });
  renderStats();

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load your scores.",
  );
  expect(
    screen.queryByRole("heading", { name: "No scores yet" }),
  ).not.toBeInTheDocument();
});
