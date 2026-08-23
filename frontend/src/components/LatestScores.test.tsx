import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ScoreWithContext } from "../api";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import LatestScores from "./LatestScores";

const { getMe, listLatestScores } = vi.hoisted(() => ({
  getMe: vi.fn(),
  listLatestScores: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listLatestScores,
}));

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
    song: {
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
    },
    sing_started_at: "2026-08-23T19:55:00Z",
  };
}

/** The finished duet, plus an older sing the panel must not mix in. */
const latest = [
  score(3, "sing-2", "Bob", 6000),
  score(4, "sing-2", "Alice", 8500),
  score(1, "sing-1", "Chris", 4000),
];

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <LatestScores />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  getMe.mockReset();
  listLatestScores.mockReset();
  getMe.mockResolvedValue(meResponse(["stats.view"]));
  listLatestScores.mockResolvedValue({ data: { scores: latest } });
});

afterEach(() => vi.unstubAllGlobals());

test("a reload right after a song still shows that song's scores", async () => {
  renderPanel();

  const panel = await screen.findByLabelText("Latest scores");
  expect(panel).toHaveTextContent("Queen – Bohemian Rhapsody");
  // Only the last sing, best singer first — the older sing stays out.
  expect(
    within(panel)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual(["Alice8500", "Bob6000"]);
});

test("new scores bring the panel back and refresh it", async () => {
  listLatestScores.mockResolvedValue({ data: { scores: [] } });
  renderPanel();
  await waitFor(() => expect(listLatestScores).toHaveBeenCalled());
  expect(screen.queryByLabelText("Latest scores")).not.toBeInTheDocument();

  listLatestScores.mockResolvedValue({ data: { scores: latest } });
  FakeSocket.deliver({
    event: "scores.recorded",
    sing_id: "sing-2",
    scores: [],
  });

  expect(await screen.findByLabelText("Latest scores")).toHaveTextContent(
    "Alice",
  );
});

test("the panel gets out of the way when the next song starts", async () => {
  renderPanel();
  await screen.findByLabelText("Latest scores");

  FakeSocket.deliver({ event: "karaoke.started", sing: null });

  await waitFor(() =>
    expect(screen.queryByLabelText("Latest scores")).not.toBeInTheDocument(),
  );
});

test("a role without stats.view sees no panel and asks for nothing", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  renderPanel();

  await waitFor(() => expect(getMe).toHaveBeenCalled());
  expect(screen.queryByLabelText("Latest scores")).not.toBeInTheDocument();
  expect(listLatestScores).not.toHaveBeenCalled();
});
