import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ScoreWithContext, SessionRead, SongRead } from "../api";
import { chartTheme } from "../chartTheme";
import { shortDate } from "../duration";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import Scores from "./Scores";

const {
  getMe,
  listSessions,
  listSessionScores,
  listAllScores,
  listPlayers,
  renameSession,
  reassignScore,
  deleteScore,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  listSessions: vi.fn(),
  listSessionScores: vi.fn(),
  listAllScores: vi.fn(),
  listPlayers: vi.fn(),
  renameSession: vi.fn(),
  reassignScore: vi.fn(),
  deleteScore: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listSessions,
  listSessionScores,
  listAllScores,
  listPlayers,
  renameSession,
  reassignScore,
  deleteScore,
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

/** The `<summary>` of a group row — the part that is visible while it is shut. */
function summaryOf(row: HTMLElement): HTMLElement {
  return row.querySelector("summary") as HTMLElement;
}

/** What a row prints: its title, the quiet line under it, and its score. */
function lines(row: HTMLElement): (string | null)[] {
  return [
    ".score-group-label",
    ".score-group-caption",
    ".score-group-score",
  ].map((selector) => row.querySelector(selector)?.textContent ?? null);
}

/** The tile's stats as `[label, value]` pairs, in the order it prints them. */
function stats(panel: HTMLElement): (string | null)[][] {
  return [...panel.querySelectorAll(".score-group-stat")].map((stat) => [
    stat.querySelector(".icon-stat-label")?.textContent ?? null,
    stat.querySelector(".icon-stat-value")?.textContent ?? null,
  ]);
}

/** Open the session picker and hand the panel back. */
async function openSessions(): Promise<HTMLElement> {
  const opener = await screen.findByRole("button", { name: /^Party/ });
  // A real press focuses the button before it clicks it, and that is what the
  // dialog reads to know where to give the focus back when it closes.
  opener.focus();
  fireEvent.click(opener);
  return screen.findByRole("dialog", { name: "Party" });
}

/** The picker's rows: the first line of each, in order. */
function sessionRows(panel: HTMLElement): (string | null)[] {
  return [...panel.querySelectorAll(".picker-row")].map(
    (row) => row.querySelector(".picker-row-title")?.textContent ?? null,
  );
}

/** The labels of the ranking rows, in the order the page draws them. */
function groupLabels(): (string | null)[] {
  return screen
    .getAllByTestId("score-group")
    .map((row) => row.querySelector(".score-group-label")?.textContent ?? null);
}

/** The wordings of one of the two compact selects, in order. */
function options(control: "Group" | "Sort"): (string | null)[] {
  return within(screen.getByLabelText(control))
    .getAllByRole("option")
    .map((option) => option.textContent);
}

function song(id: string, artist: string, title: string): SongRead {
  return {
    id,
    artist,
    title,
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
}

function score(
  id: number,
  playerName: string,
  value: number,
  songRead: SongRead,
  singId: string,
  playerId: string | null = null,
  /** When it was sung — what the chronological order reads. */
  recordedAt = "2026-08-23T20:00:00Z",
): ScoreWithContext {
  return {
    id,
    sing_id: singId,
    player_id: playerId,
    player_name: playerName,
    score: value,
    difficulty: 1,
    placement: null,
    field_size: null,
    recorded_at: recordedAt,
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
  singer_count: 3,
};
const lastYear: SessionRead = {
  id: "session-old",
  name: "New Year 2025",
  started_at: "2025-12-31T20:00:00Z",
  last_activity_at: "2026-01-01T03:00:00Z",
  sing_count: 9,
  score_count: 12,
  singer_count: 5,
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
  { id: "player-bob", name: "Bob", registered: false, has_avatar: false },
];

// One score from a party that is over, so the head row is more than tonight.
const lastYearScore = score(
  9,
  "Alice",
  7000,
  bohemian,
  "sing-newyear",
  "player-alice",
);

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
  getMe.mockReset();
  listSessions.mockReset();
  listSessionScores.mockReset();
  listAllScores.mockReset();
  listPlayers.mockReset();
  renameSession.mockReset();
  reassignScore.mockReset();
  deleteScore.mockReset();
  getMe.mockResolvedValue(
    meResponse(["stats.view", "stats.manage", "players.view"]),
  );
  listSessions.mockResolvedValue({ data: { sessions: [tonight, lastYear] } });
  listSessionScores.mockResolvedValue({ data: { scores: tonightScores } });
  listAllScores.mockResolvedValue({
    data: { scores: [...tonightScores, lastYearScore] },
  });
  listPlayers.mockResolvedValue({ data: { players: PLAYERS } });
  reassignScore.mockResolvedValue({
    data: { ...tonightScores[2], player_id: "player-alice" },
  });
  deleteScore.mockResolvedValue({ data: undefined });
});

afterEach(() => vi.unstubAllGlobals());

test("the picker lists every session and starts on the newest one", async () => {
  renderScores();

  const started = new Date("2026-08-23T18:00:00Z");
  const label = `Party ${started.toLocaleDateString()}, ${started.toLocaleTimeString(
    [],
    { hour: "2-digit", minute: "2-digit" },
  )}`;
  // Newest first from the backend, so the bar opens on the first entry. The
  // name is the label and nothing else: a nameless party is already called
  // "Party <date>", and a hidden "Party: " in front of it would be read
  // out as "Party: Party 8/23/2026".
  expect(
    await screen.findByRole("button", { name: label }),
  ).toBeInTheDocument();

  const panel = await openSessions();
  // The head row first: everything at once, then the parties themselves. This
  // reader holds no `stats.history`, so what it adds up is their own parties.
  expect(sessionRows(panel)).toEqual(["All my scores", label, "New Year 2025"]);
  await waitFor(() =>
    expect(listSessionScores.mock.calls[0][0].path).toEqual({
      session_id: "session-new",
    }),
  );
});

test("a party's row says when it was and how big it was", async () => {
  renderScores();
  const panel = await openSessions();

  // A dropdown could only ever carry the name; this is why the picker is a
  // panel of rows.
  expect(
    within(panel).getByText(
      `${shortDate(tonight.started_at)} · 3 singers · 4 scores`,
    ),
  ).toBeInTheDocument();
  expect(
    within(panel).getByText(
      `${shortDate(lastYear.started_at)} · 5 singers · 12 scores`,
    ),
  ).toBeInTheDocument();
  // The head row adds those two parties up rather than dating itself, and the
  // stack of layers is what marks it as the row that is not a party.
  expect(within(panel).getByText("2 parties · 16 scores")).toBeInTheDocument();
  const rows = [...panel.querySelectorAll<HTMLElement>(".picker-row")];
  expect(iconNames(rows[0])).toEqual(["layers"]);
  expect(iconNames(rows[1])).toEqual([]);
  // The row the page stands on is the pressed one: the panel says where the
  // reader is, not only where they may go.
  expect(
    [...panel.querySelectorAll(".picker-row")].map((row) =>
      row.getAttribute("aria-pressed"),
    ),
  ).toEqual(["false", "true", "false"]);
});

test("picking another session loads that session's scores", async () => {
  renderScores();
  const panel = await openSessions();

  listSessionScores.mockResolvedValue({ data: { scores: [] } });
  fireEvent.click(within(panel).getByText("New Year 2025"));

  await waitFor(() =>
    expect(
      listSessionScores.mock.calls.map((call) => call[0].path.session_id),
    ).toContain("session-old"),
  );
  // The choice made, the panel is done: it closes behind it.
  expect(
    screen.queryByRole("dialog", { name: "Party" }),
  ).not.toBeInTheDocument();
  expect(await screen.findByText(/no scores yet/i)).toBeInTheDocument();
});

test("choosing another party hands the focus back to the session button", async () => {
  renderScores();
  const opener = await screen.findByRole("button", { name: /^Party/ });
  const panel = await openSessions();

  listSessionScores.mockResolvedValue({ data: { scores: [] } });
  fireEvent.click(within(panel).getByText("New Year 2025"));

  // The bar is not rebuilt around the new party, so the dialog still finds the
  // button it was opened from and a keyboard reader carries on from the bar
  // instead of re-tabbing from the top of the page.
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Party" }),
    ).not.toBeInTheDocument(),
  );
  expect(document.activeElement).toBe(opener);
  // A party with a name of its own says nothing about what it is, so the
  // hidden prefix stays there for it.
  expect(opener).toHaveAccessibleName("Party: New Year 2025");
});

test("a party whose own name holds the word still gets the hidden prefix", async () => {
  // The prefix is decided by whether the party is named at all, never by the
  // words in the name: "Christmas party" is exactly the case it exists for.
  listSessions.mockResolvedValue({
    data: { sessions: [{ ...tonight, name: "Christmas party" }] },
  });
  renderScores();

  expect(
    await screen.findByRole("button", { name: "Party: Christmas party" }),
  ).toBeInTheDocument();
});

test("picking the session already shown closes the picker anyway", async () => {
  renderScores();
  const panel = await openSessions();

  // Nothing changes, so nothing re-renders: the panel has to close itself.
  fireEvent.click(within(panel).getAllByText(/^Party /)[0]);

  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Party" }),
    ).not.toBeInTheDocument(),
  );
});

test("the summary counts scored performances, not songs started", async () => {
  // Wonderwall a second time, solo: three scored sings of two songs. Four
  // songs were started, so the tooltip is what carries the session's 4.
  listSessionScores.mockResolvedValue({
    data: {
      scores: [
        ...tonightScores,
        score(
          5,
          "Alice",
          7000,
          wonderwall,
          "sing-wonderwall-2",
          "player-alice",
        ),
      ],
    },
  });
  renderScores();

  const summary = await screen.findByLabelText("Party summary");
  await waitFor(() =>
    expect(
      within(summary).getByTitle("Sings: 3 scored of 4 started"),
    ).toHaveTextContent("3"),
  );
  expect(within(summary).getByTitle("Songs")).toHaveTextContent(/^Songs2$/);
  expect(within(summary).getByTitle("Singers")).toHaveTextContent(/^Singers2$/);
});

test("the summary leaves out the sing count while it equals the song count", async () => {
  renderScores();

  // Two sings of two songs: the same figure twice would only look like a
  // mistake, so the row starts with the songs.
  const summary = await screen.findByLabelText("Party summary");
  await waitFor(() =>
    expect(within(summary).getByTitle("Songs")).toHaveTextContent(/^Songs2$/),
  );
  expect(within(summary).queryByTitle(/^Sings/)).not.toBeInTheDocument();
});

test("an older session is dated in the summary; today's is not", async () => {
  renderScores();

  // `tonight` is a fixture from August 2026 — by the time anybody runs this it
  // is a party from another day, and nothing else on the page would say when
  // it was: the picker prints a *named* session's name, not its date.
  const summary = await screen.findByLabelText("Party summary");
  await waitFor(() =>
    expect(within(summary).getByTitle("Started")).toHaveTextContent(
      shortDate(tonight.started_at),
    ),
  );

  // A party that is happening today needs no date: the reader is at it.
  const today = new Date().toISOString();
  listSessions.mockResolvedValue({
    data: { sessions: [{ ...tonight, started_at: today }] },
  });
  cleanup();
  renderScores();

  const running = await screen.findByLabelText("Party summary");
  await waitFor(() =>
    expect(within(running).getByTitle("Songs")).toBeInTheDocument(),
  );
  expect(within(running).queryByTitle("Started")).not.toBeInTheDocument();
});

test("the summary names the evening's best score but not who sang it", async () => {
  renderScores();

  const summary = await screen.findByLabelText("Party summary");
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
    data: { sessions: [{ ...tonight, sing_count: 3 }, lastYear] },
  });
  listSessionScores.mockResolvedValue({
    data: {
      scores: [
        ...tonightScores,
        score(
          5,
          "Alice",
          7000,
          wonderwall,
          "sing-wonderwall-2",
          "player-alice",
        ),
      ],
    },
  });
  renderScores();

  const summary = await screen.findByLabelText("Party summary");
  await waitFor(() =>
    expect(within(summary).getByTitle("Sings")).toHaveTextContent(/^Sings3$/),
  );
});

test("summary, whole-session card, controls, spread, ranking — in that order", async () => {
  renderScores();
  await screen.findAllByTestId("score-group");

  // The switcher card is the session's headline and no select touches it; the
  // two dropdowns sit above the two things they reorder — spread and ranking.
  const summary = document.querySelector(".session-summary");
  const switcher = document.querySelector(".scores-chart-switch");
  const controls = document.querySelector(".scores-controls");
  const spread = document.querySelector(".spread-rows");
  const list = document.querySelector(".score-groups");
  for (const element of [summary, switcher, controls, spread, list]) {
    expect(element).not.toBeNull();
  }
  const follows = (first: Element | null, second: Element | null): boolean =>
    Boolean(
      (first as Element).compareDocumentPosition(second as Element) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  expect(follows(summary, switcher)).toBe(true);
  expect(follows(switcher, controls)).toBe(true);
  expect(follows(controls, spread)).toBe(true);
  expect(follows(spread, list)).toBe(true);
});

test("both controls are quiet selects carrying the old wordings", async () => {
  renderScores();

  const group = await screen.findByLabelText("Group");
  const sort = screen.getByLabelText("Sort");
  expect(group).toHaveClass("text-input-quiet");
  expect(sort).toHaveClass("text-input-quiet");
  expect(options("Group")).toEqual([
    "don't group",
    "group by player",
    "group by song",
  ]);
  // Grouped by player, which is where the page opens, a time order says
  // nothing — so the list is the old app's four.
  expect(options("Sort")).toEqual([
    "alphabetically",
    "average score",
    "best score",
    "worst score",
  ]);
  // The defaults the page has always opened on.
  expect(group).toHaveValue("player");
  expect(sort).toHaveValue("best");
});

test("chronological joins the sort list for every grouping but by player", async () => {
  renderScores();
  await screen.findAllByTestId("score-group");

  choose("Group", "song");
  await waitFor(() =>
    expect(options("Sort")).toEqual([
      "alphabetically",
      "average score",
      "best score",
      "chronological",
      "worst score",
    ]),
  );

  choose("Group", "none");
  await waitFor(() => expect(options("Sort")).toContain("chronological"));
});

test("going back to group by player takes chronological's place, not just its option", async () => {
  renderScores();
  await screen.findAllByTestId("score-group");
  choose("Group", "song");
  choose("Sort", "chronological");
  await waitFor(() =>
    expect(screen.getByLabelText("Sort")).toHaveValue("chronological"),
  );

  choose("Group", "player");

  // A `<select>` whose value matches no option of its own draws blank, so the
  // order has to be replaced and not merely hidden.
  await waitFor(() => expect(options("Sort")).not.toContain("chronological"));
  expect(screen.getByLabelText("Sort")).toHaveValue("best");
});

test("chronological reads the party forwards, from the song sung first", async () => {
  listSessionScores.mockResolvedValue({
    data: {
      scores: [
        // Bohemian Rhapsody scored higher but came second.
        score(
          1,
          "Alice",
          9000,
          bohemian,
          "sing-b",
          "player-alice",
          "2026-08-23T21:00:00Z",
        ),
        score(
          2,
          "Bob",
          4000,
          wonderwall,
          "sing-w",
          null,
          "2026-08-23T19:00:00Z",
        ),
      ],
    },
  });
  renderScores();
  await screen.findAllByTestId("score-group");

  choose("Group", "song");
  choose("Sort", "chronological");

  await waitFor(() =>
    expect(groupLabels()).toEqual(["Wonderwall", "Bohemian Rhapsody"]),
  );
});

test("the whole session is one strip card — every score a dot, the best in gold", async () => {
  renderScores();
  await screen.findAllByTestId("score-group");

  // Four scores, four dots; nothing scrolls sideways any more — the spread
  // rows below lie down instead of standing up.
  const dots = screen.getAllByTestId("strip-dot");
  expect(dots).toHaveLength(4);
  expect(
    dots.filter((dot) => dot.getAttribute("fill") === chartTheme.gold),
  ).toHaveLength(1);
  expect(screen.getByText("9000 · Alice")).toBeInTheDocument();
  expect(document.querySelector(".scores-chart-scroll")).toBeNull();
});

test("the switcher swaps the strip for the evening and back", async () => {
  renderScores();
  await screen.findAllByTestId("score-group");

  expect(screen.getByRole("radio", { name: "All scores" })).toBeChecked();
  fireEvent.click(screen.getByRole("radio", { name: "The evening" }));

  expect(screen.getAllByTestId("timeline-dot")).toHaveLength(4);
  expect(screen.queryByTestId("strip-dot")).not.toBeInTheDocument();
  expect(document.querySelector(".timeline-legend")).toHaveTextContent("Alice");

  fireEvent.click(screen.getByRole("radio", { name: "All scores" }));
  expect(screen.getAllByTestId("strip-dot")).toHaveLength(4);
  expect(screen.queryByTestId("timeline-dot")).not.toBeInTheDocument();
});

test("switching the grouping redraws the spread rows", async () => {
  renderScores();
  await screen.findAllByTestId("score-group");

  const rowLabels = () =>
    [...document.querySelectorAll(".spread-row-label")].map((label) =>
      label.textContent?.replace(/\s+/g, " ").trim(),
    );
  // Too few scores each for a box, so the rows are plain marks — but they are
  // the singers', best first, exactly like the ranking below.
  expect(rowLabels()).toEqual(["Alice × 2", "Bob × 2"]);

  choose("Group", "song");

  // A row is as wide as the card, so a song keeps its artist — the seven
  // characters a standing column allowed are history.
  await waitFor(() =>
    expect(rowLabels()).toEqual([
      "Oasis – Wonderwall × 2",
      "Queen – Bohemian Rhapsody × 2",
    ]),
  );
});

test("sorting by worst score puts the evening's flop first", async () => {
  renderScores();

  // Best score first by default: Alice's 9000 leads.
  await waitFor(() => expect(groupLabels()[0]).toBe("Alice"));

  choose("Sort", "worst");
  await waitFor(() => expect(groupLabels()[0]).toBe("Bob"));

  choose("Sort", "alphabetically");
  await waitFor(() => expect(groupLabels()).toEqual(["Alice", "Bob"]));
});

test("'don't group' leaves every score standing on its own", async () => {
  renderScores();
  await screen.findAllByTestId("score-group");

  choose("Group", "none");

  // One row per score, headed by its song and best score first.
  await waitFor(() =>
    expect(screen.getAllByTestId("score-group")).toHaveLength(4),
  );
  const first = screen.getAllByTestId("score-group")[0];
  expect(first.querySelector(".score-group-label")?.textContent).toBe(
    "Wonderwall",
  );
  // A single score has nothing behind it to unfold, so the row is a plain song
  // row that opens the modal — and the singer, who has nowhere else to go,
  // joins the artist on the line under the title.
  expect(first.querySelector(".score-group-caption")?.textContent).toBe(
    "Oasis · Alice",
  );
  expect(first.closest("details")).toBeNull();
});

test("an ungrouped row opens the song it is a score of", async () => {
  renderScores();
  await screen.findAllByTestId("score-group");
  choose("Group", "none");

  // No disclosure on these rows, so the whole row is the way into the song —
  // as a song list row is everywhere else in the app.
  const row = await waitFor(() => {
    const first = screen.getAllByTestId("score-group")[0];
    expect(first.tagName).toBe("BUTTON");
    return first;
  });
  fireEvent.click(row);

  expect(await screen.findByTestId("song-details")).toHaveTextContent(
    "Wonderwall",
  );
});

test("ungrouped there is no spread card — the strip already shows every score", async () => {
  renderScores();
  await screen.findAllByTestId("score-group");
  choose("Group", "none");

  await waitFor(() =>
    expect(screen.getAllByTestId("score-group")).toHaveLength(4),
  );
  expect(document.querySelector(".spread-rows")).toBeNull();
  expect(
    screen.queryByRole("heading", { name: "Score spread" }),
  ).not.toBeInTheDocument();
  // The whole-session card stays: it *is* the ungrouped view.
  expect(screen.getAllByTestId("strip-dot")).toHaveLength(4);
});

test("every party at once keeps the strip alone — a heap of parties is no evening", async () => {
  renderScores();
  const panel = await openSessions();
  fireEvent.click(within(panel).getByText("All my scores"));

  await screen.findAllByTestId("score-group");
  // No switcher and no timeline to switch to; a plain title stands instead,
  // and the tooltips date their scores — the strip spans parties now.
  expect(
    screen.queryByRole("radio", { name: "The evening" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "All scores" }),
  ).toBeInTheDocument();
  // Five scores over two parties, all on the one strip.
  expect(screen.getAllByTestId("strip-dot")).toHaveLength(5);
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
  await screen.findAllByTestId("score-group");
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

test("a group's scores are listed as the song rows they are", async () => {
  renderScores();

  // Best score first: Alice's group leads, and her 9000 leads inside it. Title
  // over artist, exactly as in the song list — no difficulty, no clock time.
  const rows = await screen.findAllByTestId("score-row");
  expect(lines(rows[0])).toEqual(["Wonderwall", "Oasis", "9000"]);
  expect(lines(rows[1])).toEqual(["Bohemian Rhapsody", "Queen", "8000"]);
});

test("under a song, the scores are the singers behind them", async () => {
  renderScores();
  await screen.findAllByTestId("score-group");
  choose("Group", "song");

  // A name is a name: no second line under it, and an avatar in front of it.
  const rows = await waitFor(() => {
    const found = screen.getAllByTestId("score-row");
    expect(lines(found[0])[0]).toBe("Alice");
    return found;
  });
  expect(lines(rows[0])).toEqual(["Alice", null, "9000"]);
  expect(rows[0].querySelector(".score-entry-avatar")).not.toBeNull();
});

test("a collapsed row carries a list row's two lines, not a spread", async () => {
  renderScores();

  const alice = (await screen.findAllByTestId("score-group"))[0];
  expect(lines(summaryOf(alice))).toEqual(["Alice", "2 scores", "9000"]);
  // The four stats moved into the tile the row unfolds.
  expect(within(summaryOf(alice)).queryByText("Average")).toBeNull();

  choose("Group", "song");
  await waitFor(() => {
    const wonderwall = summaryOf(screen.getAllByTestId("score-group")[0]);
    expect(lines(wonderwall)).toEqual(["Wonderwall", "Oasis", "9000"]);
  });
});

test("an opened group states its whole spread in one tile", async () => {
  renderScores();

  const alice = (await screen.findAllByTestId("score-group"))[0];
  fireEvent.click(within(summaryOf(alice)).getByText("Alice"));

  const panel = alice.querySelector(".score-group-panel") as HTMLElement;
  expect(stats(panel)).toEqual([
    ["Scores", "2"],
    ["Best", "9000"],
    ["Worst", "8000"],
    ["Average", "8500"],
  ]);
  // The scores are part of that tile, not a list left behind under it.
  expect(panel.querySelector(".score-group-scores")).not.toBeNull();
});

test("under a song, best and worst still name the singer who managed them", async () => {
  renderScores();
  await screen.findAllByTestId("score-group");
  choose("Group", "song");

  // The account's own history switches this off — every score there is the
  // reader's. On a party page the name is the interesting half and must stay.
  const wonderwall = (await screen.findAllByTestId("score-group"))[0];
  await waitFor(() =>
    expect(
      stats(wonderwall.querySelector(".score-group-panel") as HTMLElement),
    ).toEqual([
      ["Scores", "2"],
      ["Best · Alice", "9000"],
      ["Worst · Bob", "6000"],
      ["Average", "7500"],
    ]),
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
  // The disclosure and nothing else. Collapsed it points the same way as every
  // option row in the song modal; the open state turns this one glyph 90° in
  // CSS rather than swapping in a second path.
  expect(iconNames(summaryOf(alice))).toEqual(["chevron-right"]);
});

test("a song's cover opens its details instead of expanding the row", async () => {
  renderScores();
  await screen.findAllByTestId("score-group");
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
    (await screen.findAllByRole("button", { name: /Wonderwall/ }))[0],
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

  fireEvent.click(await screen.findByRole("button", { name: "Rename party" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Party name" }), {
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
    await screen.findByRole("button", { name: "Party: Yannis' birthday" }),
  ).toBeInTheDocument();
});

test("clearing the name sends null, not an empty string", async () => {
  renameSession.mockResolvedValue({ data: { ...lastYear, name: null } });
  renderScores();

  const panel = await openSessions();
  fireEvent.click(within(panel).getByText("New Year 2025"));
  fireEvent.click(screen.getByRole("button", { name: "Rename party" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Party name" }), {
    target: { value: "  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(renameSession.mock.calls[0][0].body).toEqual({ name: null }),
  );
});

test("a session change drops an open rename draft instead of moving it", async () => {
  renderScores();

  fireEvent.click(await screen.findByRole("button", { name: "Rename party" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Party name" }), {
    target: { value: "Yannis' birthday" },
  });
  // While renaming, the input takes the picker button's place in the row…
  expect(
    screen.queryByRole("button", { name: /^Party/ }),
  ).not.toBeInTheDocument();

  // …so the session changes under the form: a websocket refresh reorders the
  // list and another session becomes the default selection.
  listSessions.mockResolvedValue({ data: { sessions: [lastYear, tonight] } });
  FakeSocket.deliver({ event: "scores.recorded", sing_id: "sing-5" });

  // Otherwise Save would rename the other session with this session's name.
  await waitFor(() =>
    expect(
      screen.queryByRole("textbox", { name: "Party name" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("button", { name: "Rename party" }),
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
  await screen.findAllByTestId("score-group");
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

test("a failed score request says so instead of claiming nobody sang", async () => {
  listSessionScores.mockRejectedValue({ detail: "boom" });
  renderScores();

  const alert = await screen.findByRole("alert");
  // One party or every party at once: the bar above says which, so the line
  // fits both rather than claiming a session that may not be one.
  expect(alert).toHaveTextContent("Could not load the scores.");
  // The empty state would be a lie here: the session may be full of scores.
  expect(
    screen.queryByRole("heading", { name: "No scores yet" }),
  ).not.toBeInTheDocument();
});

test("a denied score request names the capability the role is missing", async () => {
  listSessionScores.mockRejectedValue({
    detail: "missing_permission:stats.view",
  });
  renderScores();

  expect(await screen.findByRole("alert")).toHaveTextContent("stats.view");
});

test("the head row adds every party the reader may open into one list", async () => {
  renderScores();
  const panel = await openSessions();

  fireEvent.click(within(panel).getByText("All my scores"));

  await waitFor(() => expect(listAllScores).toHaveBeenCalled());
  // "All my scores" says nothing about what the button picks, so the hidden
  // prefix stays in front of it.
  expect(
    screen.getByRole("button", { name: "Party: All my scores" }),
  ).toBeInTheDocument();
  // Five scores over two parties, grouped by player: Alice and Bob.
  const rows = await screen.findAllByTestId("score-group");
  expect(rows.map((row) => lines(summaryOf(row))[0])).toEqual(["Alice", "Bob"]);
  // Every party at once is no party: nothing to rename, and no evening's
  // figures to head the list with.
  expect(
    screen.queryByRole("button", { name: "Rename party" }),
  ).not.toBeInTheDocument();
  expect(document.querySelector(".session-summary")).toBeNull();
});

test("the head row is All parties for a reader who holds the history right", async () => {
  getMe.mockResolvedValue(
    meResponse(["stats.view", "stats.history", "players.view"]),
  );
  renderScores();

  const panel = await openSessions();
  expect(sessionRows(panel)).toContain("All parties");
  expect(sessionRows(panel)).not.toContain("All my scores");
  // The whole history added up says so on its own line.
  expect(within(panel).getByText("2 parties · 16 scores")).toBeInTheDocument();

  // And this one names sessions itself, so it is read out as it is written.
  fireEvent.click(within(panel).getByText("All parties"));
  expect(
    await screen.findByRole("button", { name: "All parties" }),
  ).toBeInTheDocument();
});

test("a single party gets no head row — it would only repeat itself", async () => {
  listSessions.mockResolvedValue({ data: { sessions: [tonight] } });
  renderScores();

  const panel = await openSessions();
  expect(sessionRows(panel)).toHaveLength(1);
  expect(screen.queryByText("All my scores")).not.toBeInTheDocument();
});

test("a moderator moves a score to the singer who really sang it", async () => {
  getMe.mockResolvedValue(
    meResponse(["stats.view", "stats.moderate", "players.view"]),
  );
  renderScores();
  await screen.findAllByTestId("score-group");
  // Ungrouped, every row is one score — the rows that carry the corrections.
  choose("Group", "none");

  fireEvent.click(
    await screen.findByRole("button", { name: "Change who sang 4000" }),
  );
  // Inside the picker: the list behind it names Alice on her own rows too.
  const picker = await screen.findByRole("dialog", { name: "Who sang this?" });
  fireEvent.click(within(picker).getByRole("button", { name: /Alice/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Move" }));

  await waitFor(() =>
    expect(reassignScore).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { score_id: 3 },
        body: { player_id: "player-alice" },
      }),
    ),
  );
});

test("deleting a score asks first and then takes it off the record", async () => {
  getMe.mockResolvedValue(
    meResponse(["stats.view", "stats.moderate", "players.view"]),
  );
  renderScores();
  await screen.findAllByTestId("score-group");
  choose("Group", "none");

  fireEvent.click(
    await screen.findByRole("button", { name: "Delete the score 4000" }),
  );
  expect(await screen.findByText(/gone for good/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  await waitFor(() =>
    expect(deleteScore).toHaveBeenCalledWith(
      expect.objectContaining({ path: { score_id: 3 } }),
    ),
  );
});

test("without stats.moderate a score row carries no corrections", async () => {
  renderScores();
  await screen.findAllByTestId("score-group");

  choose("Group", "none");

  expect(await screen.findAllByTestId("score-group")).not.toHaveLength(0);
  expect(
    screen.queryByRole("button", { name: /Change who sang/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Delete the score/ }),
  ).not.toBeInTheDocument();
});

test("a moved score reaches the other screens in the room", async () => {
  renderScores();
  await screen.findAllByTestId("score-group");
  const scoreCalls = listSessionScores.mock.calls.length;

  FakeSocket.deliver({ event: "scores.changed", sing_id: "sing-bohemian" });

  await waitFor(() =>
    expect(listSessionScores.mock.calls.length).toBeGreaterThan(scoreCalls),
  );
});
