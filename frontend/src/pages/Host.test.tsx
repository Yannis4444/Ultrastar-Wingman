import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ScoreWithContext, SessionRead } from "../api";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import Host from "./Host";

const {
  getMe,
  exchangeHostToken,
  getCurrentSing,
  getJoinInfo,
  listKaraokeColors,
  listLatestScores,
  listPlayers,
  listSessionScores,
  listSessions,
  listSongScores,
  listWishlist,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  exchangeHostToken: vi.fn(),
  getCurrentSing: vi.fn(),
  getJoinInfo: vi.fn(),
  listKaraokeColors: vi.fn(),
  listLatestScores: vi.fn(),
  listPlayers: vi.fn(),
  listSessionScores: vi.fn(),
  listSessions: vi.fn(),
  listSongScores: vi.fn(),
  listWishlist: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  exchangeHostToken,
  getCurrentSing,
  getJoinInfo,
  listKaraokeColors,
  listLatestScores,
  listPlayers,
  listSessionScores,
  listSessions,
  listSongScores,
  listWishlist,
}));

/** One singer's score in the running session, enough for a leaderboard row. */
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

const SESSION: SessionRead = {
  id: "session-1",
  name: null,
  started_at: "2026-08-23T19:00:00Z",
  last_activity_at: "2026-08-23T20:00:00Z",
  sing_count: 2,
  score_count: 2,
};

/** Two sings, so the stage carries a leaderboard next to the last song. */
const PARTY = [
  score(2, "sing-2", "Alice", 8500),
  score(1, "sing-1", "Bob", 6000),
];

/** A host screen that has something to rank: last song plus leaderboard. */
function withScores() {
  getMe.mockResolvedValue(
    meResponse(["stats.view"], { is_host: true, role: "admin" }),
  );
  listLatestScores.mockResolvedValue({ data: { scores: PARTY } });
  listSongScores.mockResolvedValue({ data: { scores: PARTY } });
  listSessions.mockResolvedValue({ data: { sessions: [SESSION] } });
  listSessionScores.mockResolvedValue({ data: { scores: PARTY } });
}

function renderHost(url: string) {
  window.history.replaceState(null, "", url);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Host />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  getMe.mockReset();
  exchangeHostToken.mockReset();
  listLatestScores.mockReset();
  listSongScores.mockReset();
  listSessions.mockReset();
  listSessionScores.mockReset();
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  getCurrentSing.mockResolvedValue({ data: { sing: null } });
  getJoinInfo.mockResolvedValue({ data: { url: "http://192.168.0.10:8080" } });
  listKaraokeColors.mockResolvedValue({ data: { colors: [] } });
  listLatestScores.mockResolvedValue({ data: { scores: [] } });
  listPlayers.mockResolvedValue({ data: { players: [] } });
  listSessions.mockResolvedValue({ data: { sessions: [] } });
  listSessionScores.mockResolvedValue({ data: { scores: [] } });
  listSongScores.mockResolvedValue({ data: { scores: [] } });
  listWishlist.mockResolvedValue({ data: { wishes: [] } });
});

afterEach(() => {
  // A leaked fake clock would break every later test's `findBy*`.
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("the token from the host URL is exchanged and taken out of the URL", async () => {
  exchangeHostToken.mockResolvedValue({
    data: meResponse([], { is_host: true, role: "admin" }).data,
  });
  renderHost("/host?hostToken=secret-token");

  await waitFor(() =>
    expect(exchangeHostToken.mock.calls[0][0].body).toEqual({
      token: "secret-token",
    }),
  );
  // Nobody may re-share (or reload) a URL that carries a live token.
  expect(window.location.search).toBe("");
  expect(exchangeHostToken).toHaveBeenCalledTimes(1);
});

test("no token in the URL means no exchange", async () => {
  renderHost("/host");

  expect(await screen.findByText("Scan to join")).toBeInTheDocument();
  expect(exchangeHostToken).not.toHaveBeenCalled();
});

test("a used token says so and points at the server log", async () => {
  exchangeHostToken.mockRejectedValue({ detail: "invalid_host_token" });
  renderHost("/host?hostToken=already-used");

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "can only be used once",
  );
});

test("an established host session is shown as active", async () => {
  getMe.mockResolvedValue(
    meResponse(["songs.view"], { is_host: true, role: "admin" }),
  );
  renderHost("/host");

  expect(await screen.findByText("Host session active")).toBeInTheDocument();
});

test("the QR encodes the server's join URL and prints it readably", async () => {
  renderHost("/host");

  // Phones on the host machine's `localhost` origin would go nowhere, so the
  // LAN URL from the backend is both encoded and printed as text.
  expect(await screen.findByText("192.168.0.10:8080")).toBeInTheDocument();
});

test("the overlay opens the host's own manage view, not the user page", async () => {
  getMe.mockResolvedValue(
    meResponse(["settings.view"], { is_host: true, role: "admin" }),
  );
  renderHost("/host");

  const gear = await screen.findByRole("link", { name: "Manage" });
  expect(gear).toHaveAttribute("href", "/host/manage");
});

test("a browser without management rights gets no manage entry", async () => {
  // The default `getMe` here is a plain guest that only found the host URL.
  renderHost("/host");

  expect(await screen.findByText("Scan to join")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Manage" })).toBeNull();
});

test("an idle USDX invites guests to pick a song", async () => {
  renderHost("/host");

  expect(
    await screen.findByText("Scan the code to pick a song"),
  ).toBeInTheDocument();
});

test("between songs the stage carries the last song and the standing", async () => {
  withScores();
  renderHost("/host");

  expect(await screen.findByLabelText("Last song")).toHaveTextContent(
    "Bohemian Rhapsody",
  );
  // The standing comes from the session's own score list, a round trip behind.
  expect(
    await screen.findByLabelText("Session leaderboard"),
  ).toBeInTheDocument();
  // The QR card is the page's anchor and does not move for the results.
  expect(screen.getByText("Scan to join")).toBeInTheDocument();
});

test("the leaderboard order settings hide with the host chrome, the ranking stays", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  withScores();
  const { container } = renderHost("/host");

  const order = await screen.findByRole("group", {
    name: "Leaderboard order",
  });
  const page = container.querySelector(".host-page");
  const board = screen.getByLabelText("Session leaderboard");

  // The pills ride the page's one reveal-on-move mechanism — `.host-idle
  // .host-reveal` is what hides them. The ranking is not part of that chrome,
  // so it stays on the TV whatever the mouse does.
  expect(order).toHaveClass("host-reveal");
  expect(board.closest(".host-reveal")).toBeNull();
  expect(board.querySelector(".host-leaderboard-list")).not.toHaveClass(
    "host-reveal",
  );
  expect(page).not.toHaveClass("host-idle");

  act(() => vi.advanceTimersByTime(3100));
  expect(page).toHaveClass("host-idle");
  expect(board).toBeInTheDocument();

  // One moved mouse brings the whole cluster back.
  fireEvent.pointerMove(window);
  expect(page).not.toHaveClass("host-idle");
});
