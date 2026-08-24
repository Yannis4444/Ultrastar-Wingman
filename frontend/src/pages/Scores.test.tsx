import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ScoreWithContext, SessionRead, SongRead } from "../api";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import Scores from "./Scores";

interface RenderedChart {
  label: string;
  option: { yAxis?: { data?: string[] } };
}

const { getMe, listSessions, listSessionScores, renameSession, charts } =
  vi.hoisted(() => ({
    getMe: vi.fn(),
    listSessions: vi.fn(),
    listSessionScores: vi.fn(),
    renameSession: vi.fn(),
    // Every option object the page hands to echarts, in render order.
    charts: [] as { label: string; option: { yAxis?: { data?: string[] } } }[],
  }));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listSessions,
  listSessionScores,
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
): ScoreWithContext {
  return {
    id,
    sing_id: `sing-${id}`,
    player_id: null,
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

const tonightScores = [
  score(1, "Alice", 8000, bohemian),
  score(2, "Alice", 9000, wonderwall),
  score(3, "Bob", 4000, bohemian),
  score(4, "Bob", 6000, wonderwall),
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
  renameSession.mockReset();
  getMe.mockResolvedValue(meResponse(["stats.view", "stats.manage"]));
  listSessions.mockResolvedValue({ data: { sessions: [tonight, lastYear] } });
  listSessionScores.mockResolvedValue({ data: { scores: tonightScores } });
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

test("the summary counts the session's songs and singers and names the winner", async () => {
  renderScores();

  const summary = await screen.findByLabelText("Session summary");
  await waitFor(() => expect(summary).toHaveTextContent(/Songs\s*2/));
  // Sings come from the session row: a stopped song records no score at all.
  expect(summary).toHaveTextContent(/Sings\s*4/);
  expect(summary).toHaveTextContent(/Singers\s*2/);
  expect(summary).toHaveTextContent("9000 — Alice · Oasis – Wonderwall");
});

test("switching the grouping rebuilds the chart around the other axis", async () => {
  renderScores();
  await screen.findAllByTestId("chart");

  expect(lastBoxplotCategories()).toEqual(["Alice", "Bob"]);

  fireEvent.click(screen.getByRole("radio", { name: "song" }));

  await waitFor(() =>
    expect(lastBoxplotCategories()).toEqual([
      "Oasis – Wonderwall",
      "Queen – Bohemian Rhapsody",
    ]),
  );
});

test("every group lists its raw scores, strongest first and difficulty named", async () => {
  renderScores();

  // The rendered time is local, so the expectation is built the same way.
  const at = new Date("2026-08-23T20:00:00Z").toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  // Strongest median first: Alice's group leads, and her 9000 leads inside it.
  const rows = (await screen.findAllByTestId("score-row")).map(
    (row) => row.textContent,
  );
  expect(rows[0]).toBe(`Oasis – WonderwallMedium · ${at}9000`);
  expect(rows[1]).toBe(`Queen – Bohemian RhapsodyMedium · ${at}8000`);
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
