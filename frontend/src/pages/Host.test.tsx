import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  CurrentSing,
  MusicRead,
  MusicTrackRead,
  ScoreWithContext,
  SessionRead,
  SongRead,
  WishRead,
} from "../api";
import { achievementRead, achievementSettings } from "../test/achievements";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import Host from "./Host";

const {
  getMe,
  getMusic,
  exchangeHostToken,
  getCurrentSing,
  getJoinInfo,
  getDeviceStatus,
  getPlayerSelection,
  listAchievements,
  listKaraokeColors,
  listLatestScores,
  listPlayers,
  listSessionScores,
  listSessions,
  listSongScores,
  listWishlist,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  getMusic: vi.fn(),
  exchangeHostToken: vi.fn(),
  getCurrentSing: vi.fn(),
  getJoinInfo: vi.fn(),
  getDeviceStatus: vi.fn(),
  getPlayerSelection: vi.fn(),
  listAchievements: vi.fn(),
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
  getMusic,
  exchangeHostToken,
  getCurrentSing,
  getJoinInfo,
  getDeviceStatus,
  getPlayerSelection,
  listAchievements,
  listKaraokeColors,
  listLatestScores,
  listPlayers,
  listSessionScores,
  listSessions,
  listSongScores,
  listWishlist,
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
    placement: null,
    field_size: null,
    recorded_at: "2026-08-23T20:00:00Z",
    song: RHAPSODY,
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
  singer_count: 2,
  hidden: false,
  current: true,
};

/** Two sings, so the rail carries a standing next to the QR code. */
const PARTY = [
  score(2, "sing-2", "Alice", 8500),
  score(1, "sing-1", "Bob", 6000),
];

/** Rank, name and value of every leaderboard row, best first. */
function ranking(): (string | null)[][] {
  const board = screen.getByLabelText("Party leaderboard");
  return within(board)
    .getAllByRole("listitem")
    .map((row) => [
      row.querySelector(".host-leaderboard-rank")?.textContent ?? null,
      row.querySelector(".host-leaderboard-name")?.textContent ?? null,
      row.querySelector(".host-leaderboard-value")?.textContent ?? null,
    ]);
}

/** Wishes enough to prove both rail caps. */
const WISHES: WishRead[] = [1, 2, 3, 4, 5].map((n) => ({
  song: { ...RHAPSODY, id: `usdb:w${n}`, title: `Wish ${n}` },
  count: 6 - n,
  latest: "2026-08-23T20:00:00Z",
  mine: false,
}));

/** A sing on the stage, so the brand and the results both have to give way. */
const RUNNING: CurrentSing = {
  sing_id: "sing-9",
  started_at: "2026-08-23T20:05:00Z",
  song: { ...RHAPSODY, id: "usdb:2", title: "Dancing Queen" },
  slots: [],
};

/** What `GET /music` answers while nothing is playing. */
function quietMusic(overrides: Partial<MusicRead> = {}): MusicRead {
  return {
    status: "off",
    track: null,
    preview: null,
    blocked_by: null,
    resume_at: null,
    retry_at: null,
    sink_online: false,
    sink_generation: 0,
    volume: { master: 100, music: 60, preview: 100, effects: 80 },
    scope: "all",
    ...overrides,
  };
}

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
  listWishlist.mockReset();
  // Reset too: a test that counts join requests must not see the last one's.
  getJoinInfo.mockReset();
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  getCurrentSing.mockResolvedValue({ data: { sing: null } });
  getMusic.mockResolvedValue({ data: quietMusic() });
  getJoinInfo.mockResolvedValue({ data: { url: "http://192.168.0.10:8080" } });
  getPlayerSelection.mockReset();
  getPlayerSelection.mockResolvedValue({ data: { selection: null } });
  // No player selector in the room unless a test puts one there.
  getDeviceStatus.mockReset();
  getDeviceStatus.mockResolvedValue({ data: { online: false } });
  listAchievements.mockReset();
  listAchievements.mockResolvedValue({
    data: { achievements: [], settings: achievementSettings() },
  });
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

  expect(
    await screen.findByText("This browser holds host rights"),
  ).toBeInTheDocument();
});

test("the QR encodes the server's join URL and prints it readably", async () => {
  renderHost("/host");

  // Phones on the host machine's `localhost` origin would go nowhere, so the
  // LAN URL from the backend is both encoded and printed as text.
  expect(await screen.findByText("192.168.0.10:8080")).toBeInTheDocument();
});

test("an https join URL keeps its scheme in the printed line", async () => {
  getJoinInfo.mockResolvedValue({ data: { url: "https://party.example" } });
  renderHost("/host");

  // Only `http://` may be dropped: a guest typing the line instead of scanning
  // it has to land on the protocol the host configured.
  expect(await screen.findByText("https://party.example")).toBeInTheDocument();
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

test("between songs the stage shows the last song and the rail the standing", async () => {
  withScores();
  const { container } = renderHost("/host");

  expect(await screen.findByLabelText("Last song")).toHaveTextContent(
    "Bohemian Rhapsody",
  );
  // Each column has one job: the finished song is stage content, the party's
  // standing is rail content that outlives it.
  const board = await screen.findByLabelText("Party leaderboard");
  expect(container.querySelector(".host-stage")).toContainElement(
    screen.getByLabelText("Last song"),
  );
  expect(container.querySelector(".host-rail")).toContainElement(board);
  // The QR card is the rail's anchor and does not move for the results.
  expect(screen.getByText("Scan to join")).toBeInTheDocument();
});

test("the standing reads every party, the ones off the Scores list included", async () => {
  // The standing is the newest party by activity, and a party the host took
  // off the Scores page's picker is still a party the room sang at. Without
  // this the TV would fall back to the evening before it once the room went
  // home. The backend ignores the parameter for whoever may not hold it.
  withScores();
  renderHost("/host");

  await screen.findByLabelText("Party leaderboard");
  expect(listSessions.mock.calls[0][0]).toMatchObject({
    query: { include_hidden: true },
  });
});

test("the idle stage is the brand, and only the idle stage", async () => {
  const { container } = renderHost("/host");

  expect(await screen.findByText("Ultrastar Wingman")).toBeInTheDocument();
  const stage = container.querySelector(".host-stage");
  expect(stage).toContainElement(screen.getByText("Ultrastar Wingman"));
  expect(stage).toContainElement(
    screen.getByText("Scan the code to pick a song"),
  );
});

test("a playing song owns the stage and the rail carries on", async () => {
  withScores();
  getCurrentSing.mockResolvedValue({ data: { sing: RUNNING } });
  const { container } = renderHost("/host");

  expect(await screen.findByText("Dancing Queen")).toBeInTheDocument();
  // The name of the app is idle-only: a TV playing a song needs the room.
  expect(screen.queryByText("Ultrastar Wingman")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Last song")).not.toBeInTheDocument();
  // The rail does not depend on the stage — that is the point of splitting it.
  expect(container.querySelector(".host-rail")).toContainElement(
    await screen.findByLabelText("Party leaderboard"),
  );
  expect(screen.getByText("Scan to join")).toBeInTheDocument();
});

test("the leaderboard ranks the running session by best score by default", async () => {
  withScores();
  renderHost("/host");

  await screen.findByLabelText("Party leaderboard");
  expect(ranking()).toEqual([
    ["1", "Alice", "8500"],
    ["2", "Bob", "6000"],
  ]);
  // Newest activity wins, whatever order the backend listed the sessions in.
  expect(listSessionScores.mock.calls[0][0].path).toEqual({
    session_id: "session-1",
  });
});

test("the leaderboard order can be switched to average and to sings", async () => {
  withScores();
  // Bob sang twice, weakly the second time: best keeps him second, sings puts
  // him first.
  listSessionScores.mockResolvedValue({
    data: { scores: [...PARTY, score(3, "sing-0", "Bob", 4000)] },
  });
  renderHost("/host");

  const board = await screen.findByLabelText("Party leaderboard");
  expect(ranking()).toEqual([
    ["1", "Alice", "8500"],
    ["2", "Bob", "6000"],
  ]);

  fireEvent.click(within(board).getByRole("radio", { name: "average" }));
  expect(ranking()).toEqual([
    ["1", "Alice", "8500"],
    ["2", "Bob", "5000"],
  ]);

  // A count is not a score, so it is not printed as one.
  fireEvent.click(within(board).getByRole("radio", { name: "sings" }));
  expect(ranking()).toEqual([
    ["1", "Bob", "2×"],
    ["2", "Alice", "1×"],
  ]);
});

test("one performance ranks nobody, so the first song gets no leaderboard", async () => {
  withScores();
  listSessionScores.mockResolvedValue({
    data: { scores: PARTY.filter((row) => row.sing_id === "sing-2") },
  });
  renderHost("/host");

  expect(await screen.findByLabelText("Last song")).toBeInTheDocument();
  expect(screen.queryByLabelText("Party leaderboard")).not.toBeInTheDocument();
});

test("the standing outlives the results the stage was showing", async () => {
  withScores();
  renderHost("/host");
  await screen.findByLabelText("Last song");
  await screen.findByLabelText("Party leaderboard");

  FakeSocket.deliver({ event: "karaoke.started", sing: null });

  // The song was stopped before USDX scored it, so the results are stale and the
  // stage falls back to the brand. The party's standing is not stale — it is
  // rail content now precisely so it stays up through every stage change.
  expect(await screen.findByText("Ultrastar Wingman")).toBeInTheDocument();
  expect(screen.queryByLabelText("Last song")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Party leaderboard")).toBeInTheDocument();
});

/** The room opening a selection on the song it just picked. */
function picks(): void {
  act(() =>
    FakeSocket.deliver({
      event: "selection.changed",
      selection: {
        song: { ...RHAPSODY, id: "usdb:3", title: "Waterloo" },
        slots: [{ color: "blue", player: null, card_uid: null }],
        opened_at: "2026-08-23T20:20:00Z",
        updated_at: "2026-08-23T20:20:00Z",
        auto_start_at: null,
      },
    }),
  );
}

test("the room picking the next song takes the whole screen", async () => {
  withScores();
  const { container } = renderHost("/host");
  await screen.findByLabelText("Last song");

  picks();

  const stage = await screen.findByLabelText("Picking singers");
  expect(container.querySelector(".host-stage")).toContainElement(stage);
  expect(stage).toHaveTextContent("Waterloo");
  // The results wait underneath it, and the brand does not stand in for them.
  expect(screen.queryByLabelText("Last song")).not.toBeInTheDocument();
  expect(screen.queryByText("Ultrastar Wingman")).not.toBeInTheDocument();
  // And the screen is the selection's, the way it is the badges': no rail at
  // all — nobody is scanning the code while the slots are being filled.
  expect(container.querySelector(".host-rail")).toBeNull();
  expect(screen.queryByText("Scan to join")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Party leaderboard")).not.toBeInTheDocument();
  expect(container.querySelector(".host-page")).toHaveClass("host-takeover");

  // And the rail comes back with the selection going away.
  act(() =>
    FakeSocket.deliver({ event: "selection.changed", selection: null }),
  );
  expect(await screen.findByText("Scan to join")).toBeInTheDocument();
  expect(container.querySelector(".host-page")).not.toHaveClass(
    "host-takeover",
  );
});

test("badges take the stage from a selection, which comes back after them", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  withScores();
  const { container } = renderHost("/host");
  await screen.findByLabelText("Last song");

  picks();
  await screen.findByLabelText("Picking singers");

  act(() =>
    FakeSocket.deliver({
      event: "achievements.earned",
      sing_id: "sing-2",
      players: [
        {
          player: {
            id: "p1",
            name: "Alice",
            registered: false,
            hidden: false,
            has_avatar: false,
            avatar_version: null,
          },
          achievements: [achievementRead()],
        },
      ],
    }),
  );

  // What a singer just earned wins the seconds: the cards wait for it.
  expect(await screen.findByLabelText("New achievements")).toBeInTheDocument();
  expect(screen.queryByLabelText("Picking singers")).not.toBeInTheDocument();
  expect(container.querySelector(".host-rail")).toBeNull();

  act(() => vi.advanceTimersByTime(6_100));

  // And hands them back, with the rail still down: the room is still picking.
  expect(screen.queryByLabelText("New achievements")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Picking singers")).toBeInTheDocument();
  expect(screen.queryByLabelText("Last song")).not.toBeInTheDocument();
  expect(container.querySelector(".host-rail")).toBeNull();
  expect(container.querySelector(".host-page")).toHaveClass("host-takeover");
});

test("what a song earned takes the stage, and the results follow it", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  withScores();
  const { container } = renderHost("/host");
  await screen.findByLabelText("Last song");

  act(() =>
    FakeSocket.deliver({
      event: "achievements.earned",
      sing_id: "sing-2",
      players: [
        {
          player: {
            id: "p1",
            name: "Alice",
            registered: false,
            hidden: false,
            has_avatar: false,
            avatar_version: null,
          },
          achievements: [achievementRead()],
        },
      ],
    }),
  );

  // The badges own the stage alone: not next to the results, and not next to
  // the brand that stands in for them.
  const stage = await screen.findByLabelText("New achievements");
  expect(container.querySelector(".host-stage")).toContainElement(stage);
  expect(stage).toHaveTextContent("Golden Voice");
  expect(screen.queryByLabelText("Last song")).not.toBeInTheDocument();
  expect(screen.queryByText("Ultrastar Wingman")).not.toBeInTheDocument();
  // And the whole screen with it (§7): the rail is not rendered for those
  // seconds — no QR card, no standing, no wishes — and the one column left is
  // the stage.
  expect(container.querySelector(".host-rail")).toBeNull();
  expect(screen.queryByText("Scan to join")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Party leaderboard")).not.toBeInTheDocument();
  expect(container.querySelector(".host-page")).toHaveClass("host-takeover");

  // 4 + 2 × 1 seconds at the default settings, and then the stage is handed
  // back to the song that earned them — and the rail comes back with it.
  act(() => vi.advanceTimersByTime(6_100));
  expect(screen.queryByLabelText("New achievements")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Last song")).toBeInTheDocument();
  expect(container.querySelector(".host-page")).not.toHaveClass(
    "host-takeover",
  );
  expect(await screen.findByText("Scan to join")).toBeInTheDocument();
});

test("the beat between two singers shows the brand, not an empty screen", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  withScores();
  const { container } = renderHost("/host");
  await screen.findByLabelText("Last song");

  const singer = (id: string, name: string) => ({
    id,
    name,
    registered: false,
    hidden: false,
    has_avatar: false,
    avatar_version: null,
  });
  act(() =>
    FakeSocket.deliver({
      event: "achievements.earned",
      sing_id: "sing-2",
      players: [
        {
          player: singer("p1", "Alice"),
          achievements: [achievementRead({ id: "a1", name: "Golden Voice" })],
        },
        {
          player: singer("p2", "Bob"),
          achievements: [achievementRead({ id: "a2", name: "Brave Soul" })],
        },
      ],
    }),
  );
  await screen.findByLabelText("New achievements");

  // Alice's row has had its 4 + 2 × 1 seconds: what follows is the beat before
  // Bob, and the sequence still owns the whole screen for it. The stage shows
  // the brand rather than going blank on a TV across the room (§7) — without
  // the scan line, the rail holding the code being down.
  act(() => vi.advanceTimersByTime(6_100));
  expect(screen.queryByLabelText("New achievements")).not.toBeInTheDocument();
  expect(screen.getByText("Ultrastar Wingman")).toBeInTheDocument();
  expect(
    screen.queryByText("Scan the code to pick a song"),
  ).not.toBeInTheDocument();
  expect(container.querySelector(".host-page")).toHaveClass("host-takeover");
  expect(container.querySelector(".host-rail")).toBeNull();
  // The results are still waiting their turn behind it.
  expect(screen.queryByLabelText("Last song")).not.toBeInTheDocument();

  // And the beat ends on the next singer, not on the brand.
  act(() => vi.advanceTimersByTime(800));
  expect(await screen.findByLabelText("New achievements")).toHaveTextContent(
    "Bob",
  );
  expect(screen.queryByText("Ultrastar Wingman")).not.toBeInTheDocument();
});

test("the scores wait for the badges rather than flashing past them", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  withScores();
  const { container } = renderHost("/host");
  await screen.findByLabelText("Last song");
  FakeSocket.deliver({ event: "karaoke.started", sing: null });
  await waitFor(() =>
    expect(screen.queryByLabelText("Last song")).not.toBeInTheDocument(),
  );

  // USDX has scored: the stage holds the brand for a beat rather than putting
  // the scoreboard up in front of the badges that are about to land on it.
  act(() =>
    FakeSocket.deliver({
      event: "scores.recorded",
      sing_id: "sing-2",
      scores: [],
    }),
  );
  expect(screen.getByText("Ultrastar Wingman")).toBeInTheDocument();
  expect(screen.queryByLabelText("Last song")).not.toBeInTheDocument();
  // The beat is held for badges that may never come, so the rail stays where
  // it is: only badges actually on the stage take the screen (§7).
  expect(container.querySelector(".host-page")).not.toHaveClass(
    "host-takeover",
  );
  expect(screen.getByText("Scan to join")).toBeInTheDocument();

  // Nothing followed, so the beat runs out and the results take the stage.
  act(() => vi.advanceTimersByTime(1_500));
  expect(await screen.findByLabelText("Last song")).toBeInTheDocument();
});

test("the wishes sit in the rail and make room for the standing", async () => {
  withScores();
  getMe.mockResolvedValue(
    meResponse(["stats.view", "wishlist.view"], {
      is_host: true,
      role: "admin",
    }),
  );
  listWishlist.mockResolvedValue({ data: { wishes: WISHES } });
  const { container } = renderHost("/host");

  // The standing is a round trip behind the wishlist; the cap follows it.
  await screen.findByLabelText("Party leaderboard");
  const wishes = await screen.findByLabelText("Most wished");
  expect(container.querySelector(".host-rail")).toContainElement(wishes);
  // Five wishes with a standing above them: the rail shows the top three.
  await waitFor(() =>
    expect(within(wishes).getAllByRole("listitem")).toHaveLength(3),
  );
  expect(within(wishes).getByText("Wish 1")).toBeInTheDocument();
});

test("without a standing the rail gives the wishes the whole column", async () => {
  getMe.mockResolvedValue(meResponse(["wishlist.view"]));
  listWishlist.mockResolvedValue({ data: { wishes: WISHES } });
  renderHost("/host");

  const wishes = await screen.findByLabelText("Most wished");
  expect(within(wishes).getAllByRole("listitem")).toHaveLength(5);
});

test("a changed join URL reaches the TV without a reload", async () => {
  renderHost("/host");
  expect(await screen.findByText("192.168.0.10:8080")).toBeInTheDocument();

  getJoinInfo.mockResolvedValue({ data: { url: "http://party.local:1234" } });
  FakeSocket.deliver({
    event: "setting.changed",
    key: "host.join_url",
    value: "http://party.local:1234",
  });

  // The QR encodes exactly what the line under it prints, so one assertion
  // covers both — nobody may have to walk over to the TV and reload it.
  expect(await screen.findByText("party.local:1234")).toBeInTheDocument();
});

test("a setting that is not the join URL leaves the QR alone", async () => {
  renderHost("/host");
  await screen.findByText("192.168.0.10:8080");
  expect(getJoinInfo).toHaveBeenCalledTimes(1);

  FakeSocket.deliver({
    event: "setting.changed",
    key: "usdb.username",
    value: "singer",
  });

  await waitFor(() => expect(getJoinInfo).toHaveBeenCalledTimes(1));
});

test("the leaderboard order settings hide with the host chrome, the ranking stays", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  withScores();
  const { container } = renderHost("/host");

  const order = await screen.findByRole("group", {
    name: "Leaderboard order",
  });
  const page = container.querySelector(".host-page");
  const board = screen.getByLabelText("Party leaderboard");

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

test("the rail says the player selector is gone, but only once it was there", async () => {
  renderHost("/host");
  await screen.findByText("Scan to join");

  // Nothing yet: this party has never had a device, and a room that never had
  // one must not be told all evening that it lost something. Waited for, so an
  // implementation that drew the note on every offline answer could not pass
  // this on the strength of the request not having landed yet.
  await waitFor(() => expect(getDeviceStatus).toHaveBeenCalledTimes(1));
  expect(screen.queryByText("Player selector offline")).not.toBeInTheDocument();

  // One reports, then stops. `devices.changed` is what the watchdog broadcasts
  // on that transition, and the rail refetches on it.
  getDeviceStatus.mockResolvedValue({ data: { online: true } });
  act(() => FakeSocket.deliver({ event: "devices.changed" }));
  await waitFor(() => expect(getDeviceStatus).toHaveBeenCalledTimes(2));
  // The answer has to land before the device goes away: an online answer that
  // arrived after the offline one would leave the page having never seen a
  // selector, and the note would rightly stay away for the wrong reason.
  await act(async () => undefined);
  expect(screen.queryByText("Player selector offline")).not.toBeInTheDocument();

  getDeviceStatus.mockResolvedValue({ data: { online: false } });
  act(() => FakeSocket.deliver({ event: "devices.changed" }));
  await waitFor(() =>
    expect(screen.getByText("Player selector offline")).toBeInTheDocument(),
  );
});

test("the idle screen names the background song, quietly", async () => {
  getMe.mockResolvedValue(
    meResponse(["music.view"], { is_host: true, role: "admin" }),
  );
  const track: MusicTrackRead = {
    id: "t-1",
    song: { ...RHAPSODY, title: "Waterloo", artist: "ABBA" },
    started_at: "2026-08-23T20:00:00Z",
    position_s: 3,
    position_at: "2026-08-23T20:00:00Z",
    duration_s: 200,
  };
  getMusic.mockResolvedValue({
    data: quietMusic({ status: "playing", track, sink_online: true }),
  });

  renderHost("/host");

  const line = await screen.findByText(/Waterloo/);
  expect(line).toHaveClass("host-music-line");
  expect(line).toHaveTextContent("ABBA");
  // The code is still what the screen is for.
  expect(screen.getByText("Scan the code to pick a song")).toBeInTheDocument();
});

test("the background song stays named along the foot with the scores up, and goes with the rail", async () => {
  withScores();
  getMe.mockResolvedValue(
    meResponse(["music.view", "stats.view"], { is_host: true, role: "admin" }),
  );
  const track: MusicTrackRead = {
    id: "t-1",
    song: { ...RHAPSODY, title: "Waterloo", artist: "ABBA" },
    started_at: "2026-08-23T20:00:00Z",
    position_s: 3,
    position_at: "2026-08-23T20:00:00Z",
    duration_s: 200,
  };
  getMusic.mockResolvedValue({
    data: quietMusic({ status: "playing", track, sink_online: true }),
  });
  const { container } = renderHost("/host");

  // The scores are up, and the line stands along the foot of the whole page,
  // outside the stage's column.
  await screen.findByLabelText("Last song");
  const line = await screen.findByText(/Waterloo · ABBA/);
  expect(line).toHaveClass("host-music-line");
  expect(container.querySelector(".host-page")).toContainElement(line);
  expect(container.querySelector(".host-stage")).not.toContainElement(line);

  // The room picking the next song takes the screen, and the line goes with
  // the rail: the reel names its own song, large.
  picks();
  await screen.findByLabelText("Picking singers");
  expect(document.querySelector(".host-music-line")).toBeNull();
});

test("a screen that is not playing anything says nothing about music", async () => {
  getMe.mockResolvedValue(
    meResponse(["music.view"], { is_host: true, role: "admin" }),
  );
  renderHost("/host");

  await screen.findByText("Scan the code to pick a song");
  expect(document.querySelector(".host-music-line")).toBeNull();
});
