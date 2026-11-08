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
  PlayerRead,
  ScoreWithContext,
  SessionRead,
  SongRead,
  WishRead,
} from "../api";
import { achievementRead, achievementSettings } from "../test/achievements";
import { AS, meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import Host from "./Host";

const {
  getMe,
  getMusic,
  exchangeHostToken,
  getCurrentSing,
  getJoinInfo,
  getDeviceStatus,
  getPlayerSelection,
  launchUsdx,
  listAchievements,
  listKaraokeColors,
  listLatestScores,
  listPlayers,
  listSessionScores,
  listSessions,
  listSongScores,
  listWishlist,
  pauseMusic,
  playMusic,
  setMusicVolume,
  skipMusic,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  getMusic: vi.fn(),
  exchangeHostToken: vi.fn(),
  getCurrentSing: vi.fn(),
  getJoinInfo: vi.fn(),
  getDeviceStatus: vi.fn(),
  getPlayerSelection: vi.fn(),
  launchUsdx: vi.fn(),
  listAchievements: vi.fn(),
  listKaraokeColors: vi.fn(),
  listLatestScores: vi.fn(),
  listPlayers: vi.fn(),
  listSessionScores: vi.fn(),
  listSessions: vi.fn(),
  listSongScores: vi.fn(),
  listWishlist: vi.fn(),
  pauseMusic: vi.fn(),
  playMusic: vi.fn(),
  setMusicVolume: vi.fn(),
  skipMusic: vi.fn(),
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
  launchUsdx,
  listAchievements,
  listKaraokeColors,
  listLatestScores,
  listPlayers,
  listSessionScores,
  listSessions,
  listSongScores,
  listWishlist,
  pauseMusic,
  playMusic,
  setMusicVolume,
  skipMusic,
}));

const RHAPSODY: SongRead = {
  id: "usdb:1",
  artist: "Queen",
  title: "Bohemian Rhapsody",
  duration_seconds: null,
  has_video: false,
  is_duet: false,
  created_at: "2026-01-01T12:00:00Z",
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
  weight: 6 - n,
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
    sound_effects: true,
    scope: "all",
    ...overrides,
  };
}

/** A host screen that has something to rank: last song plus leaderboard. */
function withScores() {
  getMe.mockResolvedValue(
    meResponse(["stats.view"], { is_host: true, ...AS.host }),
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
  launchUsdx.mockReset();
  launchUsdx.mockResolvedValue({ data: { started: true } });
  for (const control of [pauseMusic, playMusic, skipMusic, setMusicVolume]) {
    control.mockReset();
    control.mockResolvedValue({ data: quietMusic() });
  }
});

afterEach(() => {
  // A leaked fake clock would break every later test's `findBy*`.
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("the token from the host URL is exchanged and taken out of the URL", async () => {
  exchangeHostToken.mockResolvedValue({
    data: meResponse([], { is_host: true, ...AS.host }).data,
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

test("the host's own browser carries no line about host rights", async () => {
  getMe.mockResolvedValue(
    meResponse(["songs.view"], { is_host: true, ...AS.host }),
  );
  renderHost("/host");

  // Drawn only where it is true, the line would say nothing (§7).
  await screen.findByText("Scan to join");
  expect(screen.queryByText(/host rights/i)).toBeNull();
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
    meResponse(["settings.view"], { is_host: true, ...AS.host }),
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

/**
 * A browser that can go full screen. jsdom implements none of the Fullscreen
 * API, so every other test runs in a browser without it; `afterEach` takes
 * these back off.
 */
function fullscreenApi(
  request: () => Promise<void> = vi.fn().mockResolvedValue(undefined),
) {
  let element: Element | null = null;
  const exit = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(document, "fullscreenEnabled", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => element,
  });
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exit,
  });
  Object.defineProperty(document.documentElement, "requestFullscreen", {
    configurable: true,
    value: request,
  });
  return {
    request,
    exit,
    /** What the browser does on entering or leaving, however it was asked. */
    change(next: Element | null) {
      element = next;
      act(() => {
        document.dispatchEvent(new Event("fullscreenchange"));
      });
    },
  };
}

afterEach(() => {
  for (const key of [
    "fullscreenEnabled",
    "fullscreenElement",
    "exitFullscreen",
  ])
    Reflect.deleteProperty(document, key);
  Reflect.deleteProperty(document.documentElement, "requestFullscreen");
});

test("a browser without full screen gets no full-screen button", async () => {
  renderHost("/host");

  expect(await screen.findByText("Scan to join")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
});

test("the full-screen button asks for the whole page and follows the browser", async () => {
  const api = fullscreenApi();
  renderHost("/host");

  // For a guest too: putting the page on the TV is not a management task.
  fireEvent.click(await screen.findByRole("button", { name: "Full screen" }));
  expect(api.request).toHaveBeenCalledTimes(1);
  // Nothing changes until the browser says so.
  expect(screen.getByRole("button", { name: "Full screen" })).toBeVisible();

  api.change(document.documentElement);
  const leave = screen.getByRole("button", { name: "Leave full screen" });
  expect(iconNames(leave)).toEqual(["fullscreen-exit"]);
  fireEvent.click(leave);
  expect(api.exit).toHaveBeenCalledTimes(1);

  // Esc leaves without the button: it turns back into the way in all the same.
  api.change(null);
  const enter = screen.getByRole("button", { name: "Full screen" });
  expect(iconNames(enter)).toEqual(["fullscreen"]);
  expect(api.request).toHaveBeenCalledTimes(1);
});

test("a refused full screen says so and the next press tries again", async () => {
  const api = fullscreenApi(
    vi.fn().mockRejectedValue(new TypeError("Permissions check failed")),
  );
  renderHost("/host");

  fireEvent.click(await screen.findByRole("button", { name: "Full screen" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The browser would not go full screen. Press F11 instead.",
  );
  expect(screen.getByRole("button", { name: "Full screen" })).toBeVisible();

  vi.mocked(api.request).mockResolvedValueOnce(undefined);
  fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
  expect(api.request).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a refusal goes with the overlay once the mouse rests", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fullscreenApi(vi.fn().mockRejectedValue(new TypeError("refused")));
  renderHost("/host");

  fireEvent.click(await screen.findByRole("button", { name: "Full screen" }));
  await screen.findByRole("alert");

  act(() => vi.advanceTimersByTime(3100));
  fireEvent.pointerMove(window);
  // The overlay is back for the movement, the refusal of the last press not.
  expect(screen.getByRole("button", { name: "Full screen" })).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a click lets go of the full-screen button's focus, a key press keeps it", async () => {
  fullscreenApi();
  renderHost("/host");
  const button = await screen.findByRole("button", { name: "Full screen" });

  // The next key — Esc out of full screen — would turn a clicked button's focus
  // visible and hold the overlay up over the TV.
  button.focus();
  fireEvent.click(button, { detail: 1 });
  expect(button).not.toHaveFocus();

  // Enter and Space click with no count: the keyboard keeps its place.
  button.focus();
  fireEvent.click(button, { detail: 0 });
  expect(button).toHaveFocus();
});

test("a control only a click focused lets go of it when the overlay fades", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  withScores();
  renderHost("/host");
  const board = await screen.findByLabelText("Party leaderboard");
  const pill = within(board).getByRole("radio", { name: "average" });
  const focusVisible = vi.spyOn(pill, "matches");

  // A clicked pill: the browser does not draw its focus.
  focusVisible.mockReturnValue(false);
  pill.focus();
  act(() => vi.advanceTimersByTime(3100));
  expect(pill).not.toHaveFocus();

  // One Tab reached: its focus is drawn and stays, holding the pills up.
  focusVisible.mockReturnValue(true);
  fireEvent.keyDown(window, { key: "Tab" });
  pill.focus();
  act(() => vi.advanceTimersByTime(3100));
  expect(pill).toHaveFocus();
  expect(focusVisible).toHaveBeenCalledWith(":focus-visible");
});

test("a clicked order pill lets go of its focus at once, a keyboard's keeps it", async () => {
  withScores();
  renderHost("/host");
  const board = await screen.findByLabelText("Party leaderboard");
  const pill = within(board).getByRole("radio", { name: "average" });
  const focusVisible = vi.spyOn(pill, "matches");

  // A click: the browser focuses the radio under the label without drawing it,
  // and a key pressed before the page idles would draw it and hold the pills up.
  focusVisible.mockReturnValue(false);
  pill.focus();
  fireEvent.click(pill, { detail: 1 });
  await waitFor(() => expect(pill).not.toHaveFocus());
  expect(focusVisible).toHaveBeenCalledWith(":focus-visible");

  // Space on a pill Tab reached clicks it too, and that focus is drawn: it stays.
  focusVisible.mockReturnValue(true);
  pill.focus();
  fireEvent.click(pill, { detail: 0 });
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  expect(pill).toHaveFocus();
});

test("the full-screen button stays reachable while the room picks singers", async () => {
  fullscreenApi();
  withScores();
  const { container } = renderHost("/host");
  await screen.findByLabelText("Last song");

  picks();

  await screen.findByLabelText("Picking singers");
  // In the overlay, not the rail the takeover takes down.
  await waitFor(() => expect(container.querySelector(".host-rail")).toBeNull());
  expect(container.querySelector(".host-controls")).toContainElement(
    screen.getByRole("button", { name: "Full screen" }),
  );
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
      ...AS.host,
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
  // All three stay in the list whatever the TV's height, the standing's way:
  // the stylesheet wraps a row that does not fit whole out of sight.
  expect(within(wishes).getByRole("list")).toHaveClass("host-wishes-list");
});

test("without a standing the rail gives the wishes the whole column", async () => {
  getMe.mockResolvedValue(meResponse(["wishlist.view"]));
  listWishlist.mockResolvedValue({ data: { wishes: WISHES } });
  renderHost("/host");

  const wishes = await screen.findByLabelText("Most wished");
  expect(within(wishes).getAllByRole("listitem")).toHaveLength(5);
});

/** Alice's player, with or without the picture she set after the TV came on. */
function alice(avatarVersion: number | null): PlayerRead {
  return {
    id: "player-alice",
    name: "Alice",
    registered: true,
    hidden: false,
    has_avatar: avatarVersion !== null,
    avatar_version: avatarVersion,
  };
}

/** What the leaderboard row of Alice draws: her picture's URL, or `null` for the initial. */
function aliceInTheStanding(): string | null {
  const board = screen.getByLabelText("Party leaderboard");
  const row = within(board).getByText("Alice").closest("li");
  return row?.querySelector("img")?.getAttribute("src") ?? null;
}

test.each(["players.changed", "server.ready"])(
  "a picture set after the TV came on reaches the standing on %s",
  async (event) => {
    // The TV is open all evening and nothing remounts it: the roster it read
    // when it came on must not be the one it draws from at midnight.
    withScores();
    getMe.mockResolvedValue(
      meResponse(["stats.view", "players.view"], {
        is_host: true,
        ...AS.host,
      }),
    );
    const party = [{ ...PARTY[0], player_id: "player-alice" }, PARTY[1]];
    listSessionScores.mockResolvedValue({ data: { scores: party } });
    listPlayers.mockResolvedValue({ data: { players: [alice(null)] } });
    renderHost("/host");
    await screen.findByLabelText("Party leaderboard");
    await waitFor(() => expect(listPlayers).toHaveBeenCalled());
    expect(aliceInTheStanding()).toBeNull();

    listPlayers.mockResolvedValue({ data: { players: [alice(1234)] } });
    act(() => FakeSocket.deliver({ event, version: "1" }));

    await waitFor(() =>
      expect(aliceInTheStanding()).toBe(
        "/api/v1/players/player-alice/avatar?v=1234",
      ),
    );
  },
);

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
    meResponse(["music.view"], { is_host: true, ...AS.host }),
  );
  const track: MusicTrackRead = {
    id: "t-1",
    song: { ...RHAPSODY, title: "Waterloo", artist: "ABBA" },
    started_at: "2026-08-23T20:00:00Z",
    position_s: 3,
    position_at: "2026-08-23T20:00:00Z",
    duration_s: 200,
    gain_db: null,
    peak: null,
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
    meResponse(["music.view", "stats.view"], { is_host: true, ...AS.host }),
  );
  const track: MusicTrackRead = {
    id: "t-1",
    song: { ...RHAPSODY, title: "Waterloo", artist: "ABBA" },
    started_at: "2026-08-23T20:00:00Z",
    position_s: 3,
    position_at: "2026-08-23T20:00:00Z",
    duration_s: 200,
    gain_db: null,
    peak: null,
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
    meResponse(["music.view"], { is_host: true, ...AS.host }),
  );
  renderHost("/host");

  await screen.findByText("Scan the code to pick a song");
  expect(document.querySelector(".host-music-line")).toBeNull();
});

/** The background song, loaded and moving. */
const TRACK: MusicTrackRead = {
  id: "t-1",
  song: { ...RHAPSODY, title: "Waterloo", artist: "ABBA" },
  started_at: "2026-08-23T20:00:00Z",
  position_s: 3,
  position_at: "2026-08-23T20:00:00Z",
  duration_s: 200,
  gain_db: null,
  peak: null,
};

function playingMusic(overrides: Partial<MusicRead> = {}): MusicRead {
  return quietMusic({
    status: "playing",
    track: TRACK,
    sink_online: true,
    volume: { master: 80, music: 60, preview: 100, effects: 80 },
    ...overrides,
  });
}

/** The host's own browser: an administrator, every right the overlay asks. */
function asHost() {
  getMe.mockResolvedValue(
    meResponse(
      [
        "settings.view",
        "settings.manage",
        "karaoke.stop",
        "music.view",
        "music.control",
      ],
      { is_host: true, ...AS.host },
    ),
  );
}

/** One key press on the page, the way a key with nothing focused arrives. */
function key(name: string, init: KeyboardEventInit = {}): boolean {
  let unprevented = true;
  act(() => {
    unprevented = fireEvent.keyDown(document.body, { key: name, ...init });
  });
  return unprevented;
}

test("the overlay opens Ultrastar Deluxe, with the reason a host would", async () => {
  asHost();
  renderHost("/host");

  const open = await screen.findByRole("button", {
    name: "Open Ultrastar Deluxe",
  });
  // The words say what the power glyph alone would not (§1.5).
  expect(open).toHaveTextContent(/^Open Ultrastar Deluxe$/);
  expect(iconNames(open)).toEqual(["power"]);
  expect(open).toHaveAccessibleDescription("For settings like microphones");
  expect(open.closest(".host-controls")).not.toBeNull();
  // A word button of the gear's weight, never a filled `.button` (§7).
  expect(open).toHaveClass("icon-button", "icon-button-text");
  expect(open).not.toHaveClass("button");

  // The caption is the button's own: described by it, standing under it in
  // the button's own slot, and describing nothing else in the corner.
  const caption = screen.getByText("For settings like microphones");
  expect(open).toHaveAttribute("aria-describedby", caption.id);
  expect(caption.parentElement).toHaveClass("host-usdx");
  expect(caption.previousElementSibling).toBe(open);
  const corner = open.closest(".host-controls") as HTMLElement;
  expect(corner.querySelectorAll("[aria-describedby]")).toHaveLength(1);
  expect(
    document.querySelectorAll(`[aria-describedby~="${caption.id}"]`),
  ).toHaveLength(1);
  // Not a sibling of the gear and the full-screen button in the row's line.
  expect(caption.parentElement).not.toHaveClass("host-controls-row");

  fireEvent.click(open);
  await waitFor(() => expect(launchUsdx).toHaveBeenCalledTimes(1));
  // Its window coming to the front is the answer: the overlay says nothing.
  await act(async () => undefined);
  expect(screen.queryByRole("alert")).toBeNull();
});

test("while a song plays the slot is Stop, and Ultrastar Deluxe is not offered", async () => {
  asHost();
  getCurrentSing.mockResolvedValue({ data: { sing: RUNNING } });
  renderHost("/host");

  expect(await screen.findByRole("button", { name: "Stop" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Open Ultrastar Deluxe" }),
  ).toBeNull();
  expect(screen.queryByText("For settings like microphones")).toBeNull();
});

test("a browser without the settings' right gets no Ultrastar Deluxe", async () => {
  getMe.mockResolvedValue(
    meResponse(["settings.view", "music.view"], { ...AS.user }),
  );
  renderHost("/host");

  await screen.findByText("Scan to join");
  expect(
    screen.queryByRole("button", { name: "Open Ultrastar Deluxe" }),
  ).toBeNull();
});

test("a refused launch says why in the overlay, and goes once the mouse rests", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  asHost();
  launchUsdx.mockRejectedValue({ detail: "already_playing" });
  renderHost("/host");

  fireEvent.click(
    await screen.findByRole("button", { name: "Open Ultrastar Deluxe" }),
  );
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "A song is playing right now. Ultrastar Deluxe is busy with it.",
  );
  expect(alert).toHaveClass("host-error");
  expect(alert.closest(".host-controls")).not.toBeNull();

  act(() => vi.advanceTimersByTime(3100));
  fireEvent.pointerMove(window);
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

test("a launch refused for the setup says each problem in words", async () => {
  asHost();
  launchUsdx.mockRejectedValue({
    detail: {
      error: "usdx_not_configured",
      problems: [
        "the bundled songs folder cannot be written to: C:\\Karaoke\\usdx\\songs",
      ],
    },
  });
  renderHost("/host");

  fireEvent.click(
    await screen.findByRole("button", { name: "Open Ultrastar Deluxe" }),
  );
  const alert = await screen.findByRole("alert");
  expect(alert).not.toHaveTextContent("C:\\Karaoke");
  expect(alert).toHaveClass("host-error");
});

test("the transport pauses, plays and skips the music, naming its keys", async () => {
  asHost();
  getMusic.mockResolvedValue({ data: playingMusic() });
  pauseMusic.mockResolvedValue({ data: playingMusic({ status: "paused" }) });
  renderHost("/host");

  const pause = await screen.findByRole("button", { name: "Pause" });
  expect(pause).toHaveAttribute("title", "Pause (Space)");
  expect(pause).toHaveAttribute("aria-keyshortcuts", "Space K");
  const skip = screen.getByRole("button", { name: "Skip" });
  expect(skip).toHaveAttribute("title", "Skip (N)");
  expect(skip).toHaveAttribute("aria-keyshortcuts", "N");

  fireEvent.click(pause);
  await waitFor(() => expect(pauseMusic).toHaveBeenCalledTimes(1));
  const play = await screen.findByRole("button", { name: "Play" });
  expect(play).toHaveAttribute("title", "Play (Space)");
  expect(iconNames(play)).toEqual(["play"]);

  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  await waitFor(() => expect(skipMusic).toHaveBeenCalledTimes(1));
});

/** The music group's children, in order, by what each one is. */
function musicCells(): string[] {
  const group = document.querySelector(".host-music");
  if (group === null) return [];
  return [...group.children].map((child) =>
    child.classList.contains("host-music-line")
      ? "line"
      : child.classList.contains("host-volume")
        ? "volume"
        : child.classList.contains("host-music-transport")
          ? "transport"
          : child.className,
  );
}

/** The legend's entries as they read: keys, then the word. */
function legend(): string[] {
  const line = document.querySelector(".host-legend");
  if (line === null) return [];
  return [...line.querySelectorAll(".host-legend-entry")].map((entry) => {
    const keys = [...entry.querySelectorAll("kbd")].map(
      (kbd) => kbd.textContent ?? "",
    );
    const word = [...entry.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? "")
      .join("");
    return [...keys, word].join(" ");
  });
}

test("the music's controls stand beside its song at the foot, not in the corner", async () => {
  asHost();
  getMusic.mockResolvedValue({ data: playingMusic() });
  const { container } = renderHost("/host");

  const pause = await screen.findByRole("button", { name: "Pause" });
  const group = container.querySelector<HTMLElement>(".host-music");
  // One group along the foot of the page, outside the stage and the corner.
  expect(group?.parentElement).toBe(container.querySelector(".host-page"));
  expect(container.querySelector(".host-controls")).not.toContainElement(pause);
  expect(container.querySelector(".host-stage")).not.toContainElement(group);
  // Corner, stage, music, rail in the page: Tab starts in the corner, and a
  // narrow page flows the music between the stage and the rail.
  expect(
    [...(container.querySelector(".host-page")?.children ?? [])]
      .map((child) => child.className)
      .filter((name) =>
        ["host-controls", "host-stage", "host-music", "host-rail"].includes(
          name,
        ),
      ),
  ).toEqual(["host-controls", "host-stage", "host-music", "host-rail"]);
  // Play or pause and skip end the cell left of the song, the volume starts
  // the one right of it.
  expect(musicCells()).toEqual(["transport", "line", "volume"]);
  const [transport, line, volume] = [...(group?.children ?? [])];
  expect(transport).toContainElement(pause);
  expect(transport).toContainElement(
    screen.getByRole("button", { name: "Skip" }),
  );
  expect(line).toHaveTextContent("Waterloo · ABBA");
  expect(volume).toContainElement(
    screen.getByRole("slider", { name: "Master volume" }),
  );
  // The cells are the overlay's and fade with it; the song playing is content.
  expect(transport).toHaveClass("host-reveal");
  expect(volume).toHaveClass("host-reveal");
  expect(line).not.toHaveClass("host-reveal");
  expect(line).not.toHaveClass("host-music-line-paused");
  expect(group).not.toHaveClass("host-music-single");
});

test("a paused song is named beside its play, as chrome", async () => {
  asHost();
  getMusic.mockResolvedValue({ data: playingMusic({ status: "paused" }) });
  renderHost("/host");

  await screen.findByRole("button", { name: "Play" });
  expect(musicCells()).toEqual(["transport", "line", "volume"]);
  const line = screen.getByText("Waterloo · ABBA");
  expect(line).toHaveClass("host-music-line", "host-music-line-paused");
  expect(line).toHaveClass("host-reveal");
});

test("a guest is told what plays, but not what was paused", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view", "music.view"]));
  getMusic.mockResolvedValue({ data: playingMusic() });
  renderHost("/host");

  // The line alone, in the middle.
  await screen.findByText(/Waterloo · ABBA/);
  expect(musicCells()).toEqual(["line"]);
  expect(document.querySelector(".host-music")).toHaveClass(
    "host-music-single",
  );

  act(() =>
    FakeSocket.deliver({
      event: "music.changed",
      music: playingMusic({ status: "paused" }),
    }),
  );
  await waitFor(() => expect(document.querySelector(".host-music")).toBeNull());
});

test("with the music off and during a sing the volume is the row alone, centred", async () => {
  asHost();
  const { container } = renderHost("/host");

  await screen.findByRole("slider", { name: "Master volume" });
  expect(musicCells()).toEqual(["volume"]);
  expect(container.querySelector(".host-music")).toHaveClass(
    "host-music-single",
  );

  act(() =>
    FakeSocket.deliver({
      event: "music.changed",
      music: playingMusic({ status: "blocked", blocked_by: "sing" }),
    }),
  );
  await waitFor(() => expect(musicCells()).toEqual(["volume"]));
  expect(container.querySelector(".host-music")).toHaveClass(
    "host-music-single",
  );
});

test("between songs the transport stands beside the volume with no line", async () => {
  asHost();
  getMusic.mockResolvedValue({
    data: playingMusic({ status: "waiting", track: null }),
  });
  renderHost("/host");

  await screen.findByRole("button", { name: "Pause" });
  expect(musicCells()).toEqual(["transport", "volume"]);
  expect(document.querySelector(".host-music")).not.toHaveClass(
    "host-music-single",
  );
});

test("in a takeover the music group stands without its line, the corner keeping the screen's", async () => {
  fullscreenApi();
  asHost();
  getMusic.mockResolvedValue({ data: playingMusic() });
  const { container } = renderHost("/host");
  await screen.findByText("Waterloo · ABBA");

  picks();
  await screen.findByLabelText("Picking singers");
  await waitFor(() => expect(container.querySelector(".host-rail")).toBeNull());
  expect(container.querySelector(".host-page")).toHaveClass("host-takeover");
  // The line goes — the reel names its own song — and the cells stay.
  expect(musicCells()).toEqual(["transport", "volume"]);
  expect(container.querySelector(".host-controls")).toContainElement(
    screen.getByRole("button", { name: "Full screen" }),
  );
  expect(container.querySelector(".host-controls")).not.toContainElement(
    screen.getByRole("button", { name: "Pause" }),
  );
  // The legend still says the keys: the chrome is up over a takeover too.
  expect(legend()).toEqual([
    "Space Play or pause",
    "N Skip",
    "↑ ↓ Volume",
    "F Full screen",
  ]);
});

test("the legend names the keys of the controls that are drawn, directly under the row", async () => {
  fullscreenApi();
  asHost();
  getMusic.mockResolvedValue({ data: playingMusic() });
  const { container } = renderHost("/host");
  await screen.findByRole("button", { name: "Pause" });

  expect(legend()).toEqual([
    "Space Play or pause",
    "N Skip",
    "↑ ↓ Volume",
    "F Full screen",
  ]);
  // In the corner, the line straight after the row of buttons and the
  // corner's last: no host-rights line between them, nothing after it.
  const controls = container.querySelector(".host-controls");
  const lines = [...(controls?.children ?? [])].map((child) => child.className);
  expect(lines).toEqual(["host-controls-row", "host-legend"]);
  expect(controls).not.toHaveTextContent(/host rights/i);

  // A sing holds the transport back, and the legend its keys with it.
  act(() =>
    FakeSocket.deliver({
      event: "music.changed",
      music: playingMusic({ status: "blocked", blocked_by: "sing" }),
    }),
  );
  await waitFor(() =>
    expect(legend()).toEqual(["↑ ↓ Volume", "F Full screen"]),
  );
});

test("the legend leaves out full screen where the browser cannot do it", async () => {
  asHost();
  getMusic.mockResolvedValue({ data: playingMusic({ status: "paused" }) });
  renderHost("/host");
  await screen.findByRole("button", { name: "Play" });

  expect(legend()).toEqual(["Space Play or pause", "N Skip", "↑ ↓ Volume"]);
});

test("a guest's legend has no music keys, and is not there at all without full screen", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view", "music.view"]));
  getMusic.mockResolvedValue({ data: playingMusic() });
  const { unmount } = renderHost("/host");

  await screen.findByText(/Waterloo · ABBA/);
  expect(document.querySelector(".host-legend")).toBeNull();
  unmount();

  // Full screen is every browser's, so its key is a guest's too.
  fullscreenApi();
  renderHost("/host");
  await screen.findByRole("button", { name: "Full screen" });
  await screen.findByText(/Waterloo · ABBA/);
  expect(legend()).toEqual(["F Full screen"]);
});

test("with the music off only the master volume stands", async () => {
  asHost();
  getMusic.mockResolvedValue({
    data: quietMusic({
      volume: { master: 70, music: 60, preview: 100, effects: 80 },
    }),
  });
  renderHost("/host");

  const slider = await screen.findByRole("slider", { name: "Master volume" });
  expect(slider).toHaveValue("70");
  expect(slider).toHaveAttribute("aria-keyshortcuts", "ArrowUp ArrowDown");
  expect(screen.getByText("70%")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
});

test("while a sing holds the music only the volume stands beside Stop, and K and N are nobody's", async () => {
  asHost();
  getCurrentSing.mockResolvedValue({ data: { sing: RUNNING } });
  getMusic.mockResolvedValue({
    data: playingMusic({ status: "blocked", blocked_by: "sing" }),
  });
  renderHost("/host");

  expect(
    await screen.findByRole("slider", { name: "Master volume" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();

  // `true`: the page left the key alone, and nothing reached the music.
  expect(key("k")).toBe(true);
  expect(key(" ")).toBe(true);
  expect(key("n")).toBe(true);
  await act(async () => undefined);
  expect(pauseMusic).not.toHaveBeenCalled();
  expect(playMusic).not.toHaveBeenCalled();
  expect(skipMusic).not.toHaveBeenCalled();
  // The volume is still the keyboard's.
  expect(key("ArrowDown")).toBe(false);
});

test("an open Ultrastar Deluxe holds the transport back too", async () => {
  asHost();
  getMusic.mockResolvedValue({
    data: playingMusic({ status: "blocked", blocked_by: "usdx" }),
  });
  renderHost("/host");

  await screen.findByRole("slider", { name: "Master volume" });
  expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  expect(key("k")).toBe(true);
  expect(key("n")).toBe(true);
  await act(async () => undefined);
  expect(pauseMusic).not.toHaveBeenCalled();
  expect(skipMusic).not.toHaveBeenCalled();
});

test("a guest's host screen has no transport and no keys for it", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view", "music.view"]));
  getMusic.mockResolvedValue({ data: playingMusic() });
  renderHost("/host");

  await screen.findByText(/Waterloo · ABBA/);
  expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  expect(screen.queryByRole("slider", { name: "Master volume" })).toBeNull();

  // The keys are not theirs either, and the page keeps its Space.
  expect(key("k")).toBe(true);
  expect(key(" ")).toBe(true);
  expect(key("ArrowUp")).toBe(true);
  await act(async () => undefined);
  expect(pauseMusic).not.toHaveBeenCalled();
  expect(setMusicVolume).not.toHaveBeenCalled();
});

test("the slider writes the master volume once, after it settles", async () => {
  asHost();
  getMusic.mockResolvedValue({ data: playingMusic() });
  setMusicVolume.mockResolvedValue({
    data: playingMusic({
      volume: { master: 55, music: 60, preview: 100, effects: 80 },
    }),
  });
  renderHost("/host");

  const slider = await screen.findByRole("slider", { name: "Master volume" });
  fireEvent.change(slider, { target: { value: "60" } });
  fireEvent.change(slider, { target: { value: "55" } });
  expect(screen.getByText("55%")).toBeInTheDocument();

  await waitFor(() => expect(setMusicVolume).toHaveBeenCalledTimes(1));
  expect(setMusicVolume.mock.calls[0][0].body).toEqual({ master: 55 });
});

test("the volume follows a phone that turns the room down", async () => {
  asHost();
  getMusic.mockResolvedValue({ data: playingMusic() });
  renderHost("/host");

  await screen.findByText("80%");
  act(() =>
    FakeSocket.deliver({
      event: "music.changed",
      music: playingMusic({
        volume: { master: 40, music: 60, preview: 100, effects: 80 },
      }),
    }),
  );
  expect(await screen.findByText("40%")).toBeInTheDocument();
  expect(screen.getByRole("slider", { name: "Master volume" })).toHaveValue(
    "40",
  );
});

test("K and Space pause, N skips, and none of them moves the focus", async () => {
  asHost();
  getMusic.mockResolvedValue({ data: playingMusic() });
  pauseMusic.mockResolvedValue({ data: playingMusic() });
  renderHost("/host");
  await screen.findByRole("button", { name: "Pause" });

  // `false` is a press the page kept for itself: Space must not scroll.
  expect(key("k")).toBe(false);
  await waitFor(() => expect(pauseMusic).toHaveBeenCalledTimes(1));
  expect(key(" ")).toBe(false);
  await waitFor(() => expect(pauseMusic).toHaveBeenCalledTimes(2));
  expect(key("N")).toBe(false);
  await waitFor(() => expect(skipMusic).toHaveBeenCalledTimes(1));
  expect(document.activeElement).toBe(document.body);

  // A held K is one press, not the music flickering on and off.
  key("k", { repeat: true });
  await act(async () => undefined);
  expect(pauseMusic).toHaveBeenCalledTimes(2);
});

test("a key works on a faded overlay, brings it back and lets it fade again", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  asHost();
  getMusic.mockResolvedValue({ data: playingMusic() });
  const { container } = renderHost("/host");
  await screen.findByText("80%");
  const page = container.querySelector(".host-page");

  act(() => vi.advanceTimersByTime(3100));
  expect(page).toHaveClass("host-idle");

  expect(key("ArrowDown")).toBe(false);
  expect(page).not.toHaveClass("host-idle");
  expect(screen.getByText("75%")).toBeInTheDocument();
  expect(document.activeElement).toBe(document.body);

  act(() => vi.advanceTimersByTime(3100));
  expect(page).toHaveClass("host-idle");
  await waitFor(() => expect(setMusicVolume).toHaveBeenCalledTimes(1));
  expect(setMusicVolume.mock.calls[0][0].body).toEqual({ master: 75 });
});

test("the shortcut listener is bound once, however often the page renders", async () => {
  // A browser drops a listener removed during a dispatch, and the one added in
  // its place: re-bound per render, the key that woke a faded overlay was
  // lost. jsdom renders after the dispatch, so only the binding itself shows it.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  try {
    asHost();
    getMusic.mockResolvedValue({ data: playingMusic() });
    const { unmount } = renderHost("/host");
    await screen.findByText("80%");
    const keydowns = (spy: typeof add | typeof remove) =>
      spy.mock.calls.filter(([type]) => type === "keydown").length;
    const bound = keydowns(add);
    expect(keydowns(remove)).toBe(0);

    act(() => vi.advanceTimersByTime(3100));
    key("ArrowDown");
    fireEvent.pointerMove(document.body);
    act(() =>
      FakeSocket.deliver({
        event: "music.changed",
        music: playingMusic({ status: "paused" }),
      }),
    );
    await screen.findByRole("button", { name: "Play" });
    act(() => vi.advanceTimersByTime(3100));

    expect(keydowns(add)).toBe(bound);
    expect(keydowns(remove)).toBe(0);
    unmount();
    expect(keydowns(remove)).toBe(bound);
  } finally {
    add.mockRestore();
    remove.mockRestore();
  }
});

test("K plays a paused room", async () => {
  asHost();
  getMusic.mockResolvedValue({ data: playingMusic({ status: "paused" }) });
  renderHost("/host");
  await screen.findByRole("button", { name: "Play" });

  key("K");
  await waitFor(() => expect(playMusic).toHaveBeenCalledTimes(1));
  expect(pauseMusic).not.toHaveBeenCalled();
});

test("a held arrow moves the volume by five a step and writes once it stops", async () => {
  asHost();
  getMusic.mockResolvedValue({ data: playingMusic() });
  renderHost("/host");
  await screen.findByText("80%");

  expect(key("ArrowUp")).toBe(false);
  key("ArrowUp", { repeat: true });
  key("ArrowUp", { repeat: true });
  // Shown at once, written once the key is let go of.
  expect(screen.getByText("95%")).toBeInTheDocument();
  key("ArrowUp", { repeat: true });
  expect(screen.getByText("100%")).toBeInTheDocument();

  await waitFor(() => expect(setMusicVolume).toHaveBeenCalledTimes(1));
  expect(setMusicVolume.mock.calls[0][0].body).toEqual({ master: 100 });
  expect(document.activeElement).toBe(document.body);

  // From the stored value the answer brought back, 100.
  key("ArrowDown");
  await waitFor(() => expect(setMusicVolume).toHaveBeenCalledTimes(2));
  expect(setMusicVolume.mock.calls[1][0].body).toEqual({ master: 95 });
});

test("a key with Ctrl, Alt or Meta, or pressed in a control, is not a shortcut", async () => {
  asHost();
  getMusic.mockResolvedValue({ data: playingMusic() });
  renderHost("/host");
  const slider = await screen.findByRole("slider", { name: "Master volume" });

  expect(key("k", { ctrlKey: true })).toBe(true);
  expect(key("k", { altKey: true })).toBe(true);
  expect(key("ArrowUp", { metaKey: true })).toBe(true);
  // The slider takes its own arrows, one step at a time; a button its Space.
  expect(fireEvent.keyDown(slider, { key: "ArrowUp" })).toBe(true);
  expect(
    fireEvent.keyDown(screen.getByRole("button", { name: "Skip" }), {
      key: " ",
    }),
  ).toBe(true);
  // Esc belongs to full screen.
  expect(key("Escape")).toBe(true);

  await act(async () => new Promise((resolve) => setTimeout(resolve, 250)));
  expect(pauseMusic).not.toHaveBeenCalled();
  expect(setMusicVolume).not.toHaveBeenCalled();
  expect(screen.getByText("80%")).toBeInTheDocument();
});

test("no shortcut while a dialog is open", async () => {
  asHost();
  getCurrentSing.mockResolvedValue({ data: { sing: RUNNING } });
  getMusic.mockResolvedValue({
    data: playingMusic({ status: "blocked", blocked_by: "sing" }),
  });
  renderHost("/host");

  fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();

  expect(key("k")).toBe(true);
  expect(key("ArrowDown")).toBe(true);
  await act(async () => new Promise((resolve) => setTimeout(resolve, 250)));
  expect(pauseMusic).not.toHaveBeenCalled();
  expect(setMusicVolume).not.toHaveBeenCalled();
});

test("F is nobody's in a browser that cannot go full screen", async () => {
  asHost();
  renderHost("/host");
  await screen.findByText("Scan to join");

  expect(key("f")).toBe(true);
});

test("F goes full screen and back, like its button", async () => {
  asHost();
  const api = fullscreenApi();
  renderHost("/host");
  const button = await screen.findByRole("button", { name: "Full screen" });
  expect(button).toHaveAttribute("title", "Full screen (F)");
  expect(button).toHaveAttribute("aria-keyshortcuts", "F");

  expect(key("f")).toBe(false);
  expect(api.request).toHaveBeenCalledTimes(1);
  api.change(document.documentElement);
  expect(key("F")).toBe(false);
  expect(api.exit).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(document.body);
});
