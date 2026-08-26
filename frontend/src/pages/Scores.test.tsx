import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ScoreWithContext, SessionRead, SongRead } from "../api";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import Scores from "./Scores";

interface RenderedChart {
  label: string;
  option: { yAxis?: { data?: string[] } };
}

const {
  getMe,
  listSessions,
  listSessionScores,
  listPlayers,
  renameSession,
  charts,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  listSessions: vi.fn(),
  listSessionScores: vi.fn(),
  listPlayers: vi.fn(),
  renameSession: vi.fn(),
  // Every option object the page hands to echarts, in render order.
  charts: [] as { label: string; option: { yAxis?: { data?: string[] } } }[],
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listSessions,
  listSessionScores,
  listPlayers,
  renameSession,
}));

// jsdom has no canvas, so the real chart cannot render. The option building is
// covered in `stats.test.ts`; here the mock only records what it was given.
vi.mock("../components/Chart", () => ({
  default: ({ option, label }: RenderedChart) => {
    charts.push({ option, label });
    return <div data-testid="chart">{label}</div>;
  },
}));

// The song modal has a page's worth of queries of its own and is tested where
// it lives; what matters here is that the scores view opens it for the right
// song.
vi.mock("../components/SongDetails", () => ({
  default: ({ song }: { song: SongRead }) => (
    <div data-testid="song-details">{song.title}</div>
  ),
}));

/** Pick a value in one of the two compact selects above the list. */
function choose(control: "Group" | "Sort", value: string): void {
  fireEvent.change(screen.getByLabelText(control), { target: { value } });
}

/** Category axis of the most recent boxplot — the per-group histograms have none. */
function lastBoxplotCategories(): string[] | undefined {
  const boxplots = charts.filter((chart) =>
    chart.label.startsWith("Score spread"),
  );
  return boxplots[boxplots.length - 1]?.option.yAxis?.data;
}

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
  playerName: string,
  value: number,
  songRead: SongRead,
  singId: string,
  playerId: string | null = null,
): ScoreWithContext {
  return {
    id,
    sing_id: singId,
    player_id: playerId,
    player_name: playerName,
    score: value,
    difficulty: 1,
    recorded_at: "2026-08-23T20:00:00Z",
    song: songRead,
    sing_started_at: "2026-08-23T19:55:00Z",
  };
}

const bohemian = song("usdb:1", "Queen", "Bohemian Rhapsody");
const wonderwall = song("usdb:2", "Oasis", "Wonderwall");

const tonight: SessionRead = {
  id: "session-new",
  name: null,
  started_at: "2026-08-23T18:00:00Z",
  last_activity_at: "2026-08-23T23:00:00Z",
  sing_count: 4,
  score_count: 4,
};
const lastYear: SessionRead = {
  id: "session-old",
  name: "New Year 2025",
  started_at: "2025-12-31T20:00:00Z",
  last_activity_at: "2026-01-01T03:00:00Z",
  sing_count: 9,
  score_count: 12,
};

// Two duets: four scores out of two runs of a song. Two more songs were
// started and never scored, which is what `sing_count: 4` counts.
const tonightScores = [
  score(1, "Alice", 8000, bohemian, "sing-bohemian", "player-alice"),
  score(2, "Alice", 9000, wonderwall, "sing-wonderwall", "player-alice"),
  score(3, "Bob", 4000, bohemian, "sing-bohemian"),
  score(4, "Bob", 6000, wonderwall, "sing-wonderwall"),
];

const PLAYERS = [
  { id: "player-alice", name: "Alice", registered: true, has_avatar: true },
];

function renderScores() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    // The router carries the empty state's "Browse songs" link.
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <Scores />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  charts.length = 0;
  getMe.mockReset();
  listSessions.mockReset();
  listSessionScores.mockReset();
  listPlayers.mockReset();
  renameSession.mockReset();
  getMe.mockResolvedValue(
    meResponse(["stats.view", "stats.manage", "players.view"]),
  );
  listSessions.mockResolvedValue({ data: { sessions: [tonight, lastYear] } });
  listSessionScores.mockResolvedValue({ data: { scores: tonightScores } });
  listPlayers.mockResolvedValue({ data: { players: PLAYERS } });
});

afterEach(() => vi.unstubAllGlobals());

test("the picker lists every session and starts on the newest one", async () => {
  renderScores();

  const picker = await screen.findByRole("combobox", { name: "Session" });
  const started = new Date("2026-08-23T18:00:00Z");
  const label = `Session ${started.toLocaleDateString()}, ${started.toLocaleTimeString(
    [],
    { hour: "2-digit", minute: "2-digit" },
  )}`;
  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual([label, "New Year 2025"]);
  // Newest first from the backend, so the first entry is preselected.
  expect(picker).toHaveValue("session-new");
  await waitFor(() =>
    expect(listSessionScores.mock.calls[0][0].path).toEqual({
      session_id: "session-new",
    }),
  );
});

test("picking another session loads that session's scores", async () => {
  renderScores();
  const picker = await screen.findByRole("combobox", { name: "Session" });

  listSessionScores.mockResolvedValue({ data: { scores: [] } });
  fireEvent.change(picker, { target: { value: "session-old" } });

  await waitFor(() =>
    expect(
      listSessionScores.mock.calls.map((call) => call[0].path.session_id),
    ).toContain("session-old"),
  );
  expect(await screen.findByText(/no scores yet/i)).toBeInTheDocument();
});

test("the summary counts scored performances, not songs started", async () => {
  renderScores();

  const summary = await screen.findByLabelText("Session summary");
  // Four songs were started; two of them produced the four scores below, so
  // the stat shows 2 and the tooltip is what carries the session's 4.
  await waitFor(() =>
    expect(
      within(summary).getByTitle("Sings — 2 scored of 4 started"),
    ).toHaveTextContent("2"),
  );
  expect(within(summary).getByTitle("Songs")).toHaveTextContent(/^Songs2$/);
  expect(within(summary).getByTitle("Singers")).toHaveTextContent(/^Singers2$/);
});

test("the summary names the evening's best score but not who sang it", async () => {
  renderScores();

  const summary = await screen.findByLabelText("Session summary");
  // The number is the headline; who got it and on what is the first row of the
  // ranking below, which is where the reader looks for a name.
  await waitFor(() =>
    expect(within(summary).getByTitle("Top score")).toHaveTextContent(
      /^Top score9000$/,
    ),
  );
  expect(within(summary).queryByText("Alice")).not.toBeInTheDocument();
  expect(
    within(summary).queryByText(/Oasis – Wonderwall/),
  ).not.toBeInTheDocument();
  expect(summary.querySelector("img")).toBeNull();
});

test("a session whose sings were all scored says only 'Sings'", async () => {
  listSessions.mockResolvedValue({
    data: { sessions: [{ ...tonight, sing_count: 2 }, lastYear] },
  });
  renderScores();

  const summary = await screen.findByLabelText("Session summary");
  await waitFor(() =>
    expect(within(summary).getByTitle("Sings")).toHaveTextContent(/^Sings2$/),
  );
});

test("the compact controls sit above both the chart and the list they reorder", async () => {
  renderScores();
  await screen.findAllByTestId("chart");

  // Summary, then the two dropdowns, then the picture and the ranking they
  // both rebuild — the selects rewrite the chart's title as well as its bars.
  const summary = document.querySelector(".session-summary");
  const title = document.querySelector(".scores-chart-title");
  const controls = document.querySelector(".scores-controls");
  const list = document.querySelector(".score-groups");
  expect(summary).not.toBeNull();
  expect(title).not.toBeNull();
  expect(controls).not.toBeNull();
  expect(list).not.toBeNull();
  const follows = (first: Element, second: Element): boolean =>
    Boolean(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  expect(follows(summary as Element, controls as Element)).toBe(true);
  expect(follows(controls as Element, title as Element)).toBe(true);
  expect(follows(title as Element, list as Element)).toBe(true);
});

test("both controls are quiet selects carrying the old wordings", async () => {
  renderScores();

  const group = await screen.findByLabelText("Group");
  const sort = screen.getByLabelText("Sort");
  expect(group).toHaveClass("text-input-quiet");
  expect(sort).toHaveClass("text-input-quiet");
  expect(
    within(group)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["don't group", "group by player", "group by song"]);
  expect(
    within(sort)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["alphabetically", "average score", "best score", "worst score"]);
  // The defaults the page has always opened on.
  expect(group).toHaveValue("player");
  expect(sort).toHaveValue("best");
});

test("switching the grouping rebuilds the chart around the other axis", async () => {
  renderScores();
  await screen.findAllByTestId("chart");

  expect(lastBoxplotCategories()).toEqual(["Alice", "Bob"]);

  choose("Group", "song");

  await waitFor(() =>
    expect(lastBoxplotCategories()).toEqual([
      "Oasis – Wonderwall",
      "Queen – Bohemian Rhapsody",
    ]),
  );
});

test("sorting by worst score puts the evening's flop first", async () => {
  renderScores();
  const groupLabels = (): (string | null)[] =>
    screen
      .getAllByTestId("score-group")
      .map(
        (row) => row.querySelector(".score-group-label")?.textContent ?? null,
      );

  // Best score first by default: Alice's 9000 leads.
  await waitFor(() => expect(groupLabels()[0]).toBe("Alice"));

  choose("Sort", "worst");
  await waitFor(() => expect(groupLabels()[0]).toBe("Bob"));

  choose("Sort", "alphabetically");
  await waitFor(() => expect(groupLabels()).toEqual(["Alice", "Bob"]));
});

test("'don't group' leaves every score standing on its own", async () => {
  renderScores();
  await screen.findAllByTestId("chart");

  choose("Group", "none");

  // One row per score, headed by its song and best score first.
  await waitFor(() =>
    expect(screen.getAllByTestId("score-group")).toHaveLength(4),
  );
  expect(
    screen.getAllByTestId("score-group")[0].querySelector(".score-group-label")
      ?.textContent,
  ).toBe("Oasis – Wonderwall");
});

test("the ungrouped chart never claims a ranking the order does not have", async () => {
  renderScores();
  await screen.findAllByTestId("chart");
  choose("Group", "none");

  const title = (): string | undefined =>
    document.querySelector(".scores-chart-title")?.textContent ?? undefined;

  await waitFor(() => expect(title()).toBe("Top scores"));

  // "worst score" sorts ascending, so the drawn head of the list is the
  // session's *lowest* scores — calling that "Top scores" would be a lie.
  choose("Sort", "worst");
  await waitFor(() => expect(title()).toBe("Lowest scores"));

  choose("Sort", "alphabetically");
  await waitFor(() => expect(title()).toBe("Scores"));
});

test("a score whose song has left the library keeps its place in the row", async () => {
  listSessionScores.mockResolvedValue({
    data: {
      scores: [
        ...tonightScores,
        { ...score(5, "Bob", 5000, bohemian, "sing-gone"), song: null },
      ],
    },
  });
  renderScores();
  await screen.findAllByTestId("chart");
  choose("Group", "song");

  // No cover to show and no modal to open, but the 40px square stays so the
  // text column of every row still lines up.
  const gone = await waitFor(() => {
    const row = screen
      .getAllByTestId("score-group")
      .find((entry) => entry.textContent?.includes("Unknown song"));
    expect(row).toBeDefined();
    return row as HTMLElement;
  });
  expect(gone.querySelector(".score-group-cover")).toHaveClass(
    "song-cover-fallback",
  );
});

test("every group lists its raw scores, strongest first and difficulty named", async () => {
  renderScores();

  // The rendered time is local, so the expectation is built the same way.
  const at = new Date("2026-08-23T20:00:00Z").toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  // Best score first: Alice's group leads, and her 9000 leads inside it.
  const rows = (await screen.findAllByTestId("score-row")).map(
    (row) => row.textContent,
  );
  expect(rows[0]).toBe(`Oasis – WonderwallMedium · ${at}9000`);
  expect(rows[1]).toBe(`Queen – Bohemian RhapsodyMedium · ${at}8000`);
});

test("a group's caption states its spread with icons, not words", async () => {
  renderScores();

  const alice = (await screen.findAllByTestId("score-group"))[0];
  expect(within(alice).getByTitle("Scores")).toHaveTextContent(/^Scores2$/);
  expect(within(alice).getByTitle("Best")).toHaveTextContent(/^Best9000$/);
  expect(within(alice).getByTitle("Worst")).toHaveTextContent(/^Worst8000$/);
  expect(within(alice).getByTitle("Average")).toHaveTextContent(
    /^Average8500$/,
  );
});

test("a player's avatar stands next to their name, an initial when there is none", async () => {
  renderScores();

  const [alice, bob] = await screen.findAllByTestId("score-group");
  // Alice has an uploaded avatar; Bob sang as a guest, so he gets his initial.
  expect(alice.querySelector("img.score-group-avatar")).toHaveAttribute(
    "src",
    "/api/v1/players/player-alice/avatar",
  );
  expect(bob.querySelector(".score-group-avatar")).toHaveTextContent("B");
});

test("a collapsed group row points its chevron right, like every other row", async () => {
  renderScores();

  const alice = (await screen.findAllByTestId("score-group"))[0];
  expect(alice).not.toHaveAttribute("open");
  // The caption's four stat glyphs, then the disclosure. Collapsed it points
  // the same way as every option row in the song modal; the open state turns
  // this one glyph 90° in CSS rather than swapping in a second path.
  expect(iconNames(alice.querySelector("summary") as Element)).toEqual([
    "hash",
    "arrow-up",
    "arrow-down",
    "average",
    "chevron-right",
  ]);
});

test("a song's cover opens its details instead of expanding the row", async () => {
  renderScores();
  await screen.findAllByTestId("chart");
  choose("Group", "song");

  const cover = await screen.findByRole("button", {
    name: "Details for Wonderwall",
  });
  fireEvent.click(cover);

  expect(await screen.findByTestId("song-details")).toHaveTextContent(
    "Wonderwall",
  );
  // The cover sits inside the `<summary>`, whose default action is the toggle.
  expect(cover.closest("details")).not.toHaveAttribute("open");
});

test("a song under a player opens its details when the row is tapped", async () => {
  renderScores();

  fireEvent.click(
    (await screen.findAllByRole("button", { name: /Oasis – Wonderwall/ }))[0],
  );

  expect(await screen.findByTestId("song-details")).toHaveTextContent(
    "Wonderwall",
  );
});

test("renaming a session patches it and shows the new name", async () => {
  renameSession.mockResolvedValue({
    data: { ...tonight, name: "Yannis' birthday" },
  });
  renderScores();

  fireEvent.click(
    await screen.findByRole("button", { name: "Rename session" }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Session name" }), {
    target: { value: "Yannis' birthday" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(renameSession.mock.calls[0][0]).toMatchObject({
      path: { session_id: "session-new" },
      body: { name: "Yannis' birthday" },
    }),
  );
  expect(
    await screen.findByRole("option", { name: "Yannis' birthday" }),
  ).toBeInTheDocument();
});

test("clearing the name sends null, not an empty string", async () => {
  renameSession.mockResolvedValue({ data: { ...lastYear, name: null } });
  renderScores();

  fireEvent.change(await screen.findByRole("combobox", { name: "Session" }), {
    target: { value: "session-old" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Rename session" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Session name" }), {
    target: { value: "  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(renameSession.mock.calls[0][0].body).toEqual({ name: null }),
  );
});

test("a session change drops an open rename draft instead of moving it", async () => {
  renderScores();

  fireEvent.click(
    await screen.findByRole("button", { name: "Rename session" }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Session name" }), {
    target: { value: "Yannis' birthday" },
  });
  // While renaming, the input takes the select's place in the row…
  expect(
    screen.queryByRole("combobox", { name: "Session" }),
  ).not.toBeInTheDocument();

  // …so the session changes under the form: a websocket refresh reorders the
  // list and another session becomes the default selection.
  listSessions.mockResolvedValue({ data: { sessions: [lastYear, tonight] } });
  FakeSocket.deliver({ event: "scores.recorded", sing_id: "sing-5" });

  // Otherwise Save would rename the other session with this session's name.
  await waitFor(() =>
    expect(
      screen.queryByRole("textbox", { name: "Session name" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("button", { name: "Rename session" }),
  ).toBeInTheDocument();
});

test("a role without stats.view gets an explanation, not a chart", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  renderScores();

  expect(await screen.findByText(/not open to your role/i)).toBeInTheDocument();
  expect(listSessions).not.toHaveBeenCalled();
});

test("a finished song refreshes the session list and its scores", async () => {
  renderScores();
  await screen.findAllByTestId("chart");
  const scoreCalls = listSessionScores.mock.calls.length;
  const sessionCalls = listSessions.mock.calls.length;

  FakeSocket.deliver({
    event: "scores.recorded",
    sing_id: "sing-5",
    scores: [],
  });

  await waitFor(() => {
    expect(listSessionScores.mock.calls.length).toBeGreaterThan(scoreCalls);
    expect(listSessions.mock.calls.length).toBeGreaterThan(sessionCalls);
  });
});
