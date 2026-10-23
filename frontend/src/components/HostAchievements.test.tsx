import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { AchievementRead, AchievementSettings, PlayerRead } from "../api";
import { achievementRead, achievementSettings } from "../test/achievements";
import { FakeSocket } from "../test/fakeSocket";
import HostAchievements from "./HostAchievements";

const { listAchievements } = vi.hoisted(() => ({
  listAchievements: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listAchievements,
}));

function player(id: string, name: string): PlayerRead {
  return {
    id,
    name,
    registered: false,
    hidden: false,
    has_avatar: false,
    avatar_version: null,
  };
}

/** `n` badges with distinct names, so a row can be read off the screen. */
function badges(count: number, prefix = "Badge"): AchievementRead[] {
  return Array.from({ length: count }, (_, index) =>
    achievementRead({
      id: `${prefix}-${index + 1}`,
      name: `${prefix} ${index + 1}`,
      description: `What ${prefix} ${index + 1} takes.`,
    }),
  );
}

/**
 * Long dwells on purpose: the clock advances with real time here, so a check
 * "still on the screen" has to sit in the middle of a row, never a breath
 * before its edge.
 */
const SLOW = achievementSettings({
  host_seconds_base: 10,
  host_seconds_per_badge: 5,
});

function catalogue(settings: AchievementSettings = SLOW) {
  listAchievements.mockResolvedValue({
    data: { achievements: [], settings },
  });
}

/** The badge titles on the stage right now, left to right. */
function row(): string[] {
  return [...document.querySelectorAll(".host-achievement-name")].map(
    (name) => name.textContent ?? "",
  );
}

const onPhase = vi.fn();

/** Standing in for the page's brand, which is what really goes here. */
const FALLBACK = "Ultrastar Wingman";

function renderSequence() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HostAchievements onPhase={onPhase} fallback={<p>{FALLBACK}</p>} />
    </QueryClientProvider>,
  );
}

/** Rendered, and the settings behind the timing actually in hand. */
async function ready() {
  renderSequence();
  await waitFor(() => expect(listAchievements).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
}

function earned(
  players: { player: PlayerRead; achievements: AchievementRead[] }[],
): void {
  act(() =>
    FakeSocket.deliver({
      event: "achievements.earned",
      sing_id: "sing-1",
      players,
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  listAchievements.mockReset();
  onPhase.mockReset();
  catalogue();
});

afterEach(() => {
  // A leaked fake clock would break every later test's `findBy*`.
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("one singer with one badge takes the stage", async () => {
  await ready();
  earned([{ player: player("p1", "Alice"), achievements: badges(1) }]);

  const stage = await screen.findByLabelText("New achievements");
  expect(stage).toHaveTextContent("Alice");
  expect(row()).toEqual(["Badge 1"]);
  // The sentence under the title is the point of showing it at all.
  expect(stage).toHaveTextContent("What Badge 1 takes.");
});

test("under each description, how many hold it with the singer counted", async () => {
  await ready();
  earned([
    {
      player: player("p1", "Alice"),
      achievements: [
        achievementRead({ id: "a", name: "First", holder_count: 1 }),
        achievementRead({ id: "b", name: "Third", holder_count: 3 }),
        // A badge with no sentence still says how many hold it.
        achievementRead({
          id: "c",
          name: "Quiet",
          description: "",
          holder_count: 2,
        }),
        // A count the payload did not carry is no line at all.
        achievementRead({ id: "d", name: "Older", holder_count: null }),
      ],
    },
  ]);

  await screen.findByLabelText("New achievements");
  const lines = [...document.querySelectorAll(".host-achievement")].map(
    (badge) =>
      badge.querySelector(".host-achievement-holders")?.textContent ?? null,
  );
  expect(lines).toEqual([
    "First to earn it",
    "Earned by 3 players",
    "Earned by 2 players",
    null,
  ]);
  // Under the description, where there is one — its own line, never part of
  // the sentence (ui-guidelines §7).
  const first = document.querySelector(".host-achievement-holders");
  expect(first?.previousElementSibling).toHaveClass(
    "host-achievement-description",
  );
  expect(first?.previousElementSibling).not.toHaveTextContent("First to earn");
});

test("six badges are two rows: the first four, then the rest", async () => {
  await ready();
  earned([{ player: player("p1", "Alice"), achievements: badges(6) }]);

  await screen.findByLabelText("New achievements");
  expect(row()).toEqual(["Badge 1", "Badge 2", "Badge 3", "Badge 4"]);

  // 10 + 5 × 4 seconds for a row of four.
  act(() => vi.advanceTimersByTime(30_100));
  expect(row()).toEqual(["Badge 5", "Badge 6"]);
  // The singer is introduced once; the second row is the same arrival.
  expect(screen.getByLabelText("New achievements")).toHaveTextContent("Alice");
});

test("one singer follows the other, with a beat in between", async () => {
  await ready();
  earned([
    { player: player("p1", "Alice"), achievements: badges(1, "Alpha") },
    { player: player("p2", "Bob"), achievements: badges(1, "Beta") },
  ]);

  await screen.findByLabelText("New achievements");
  expect(screen.getByLabelText("New achievements")).toHaveTextContent("Alice");

  // The row's 15s, and then the beat before the next singer: no badges and no
  // name, but the stage is not empty — the sequence still owns the screen, so
  // what stands there is what stands there when nothing is playing.
  act(() => vi.advanceTimersByTime(15_100));
  expect(screen.queryByLabelText("New achievements")).not.toBeInTheDocument();
  expect(screen.getByText(FALLBACK)).toBeInTheDocument();
  // And the page is not handed the stage back for those 700ms.
  expect(onPhase).toHaveBeenLastCalledWith("playing");

  act(() => vi.advanceTimersByTime(800));
  expect(screen.queryByText(FALLBACK)).not.toBeInTheDocument();
  expect(screen.getByLabelText("New achievements")).toHaveTextContent("Bob");
  expect(row()).toEqual(["Beta 1"]);
});

test("a row stays for base plus per-badge seconds, as configured", async () => {
  catalogue(
    achievementSettings({ host_seconds_base: 6, host_seconds_per_badge: 3 }),
  );
  await ready();
  earned([{ player: player("p1", "Alice"), achievements: badges(2) }]);

  // 6 + 3 × 2 = 12 seconds for these two.
  await screen.findByLabelText("New achievements");
  act(() => vi.advanceTimersByTime(11_000));
  expect(screen.getByLabelText("New achievements")).toBeInTheDocument();

  act(() => vi.advanceTimersByTime(1_500));
  expect(screen.queryByLabelText("New achievements")).not.toBeInTheDocument();
});

test("with the feature off nothing is drawn and nothing is held back", async () => {
  catalogue(achievementSettings({ enabled: false }));
  await ready();

  act(() =>
    FakeSocket.deliver({ event: "scores.recorded", sing_id: "s", scores: [] }),
  );
  earned([{ player: player("p1", "Alice"), achievements: badges(2) }]);

  expect(screen.queryByLabelText("New achievements")).not.toBeInTheDocument();
  // Not even the beat before the results: a party with achievements off must
  // behave exactly as it did before they existed.
  expect(onPhase).not.toHaveBeenCalledWith("waiting");
  expect(onPhase).not.toHaveBeenCalledWith("playing");
});

test("the next song cuts the sequence short", async () => {
  await ready();
  earned([{ player: player("p1", "Alice"), achievements: badges(4) }]);
  await screen.findByLabelText("New achievements");

  act(() => FakeSocket.deliver({ event: "karaoke.started", sing: null }));

  // Badges over a running song would be the sequence outliving its own song.
  expect(screen.queryByLabelText("New achievements")).not.toBeInTheDocument();
  expect(onPhase).toHaveBeenLastCalledWith("idle");
});

test("the scores are given a beat to be followed by badges", async () => {
  await ready();
  act(() =>
    FakeSocket.deliver({ event: "scores.recorded", sing_id: "s", scores: [] }),
  );

  // The stage is held, so the scoreboard cannot flash up between the two
  // events — but nothing is drawn here yet either.
  await waitFor(() => expect(onPhase).toHaveBeenLastCalledWith("waiting"));
  expect(screen.queryByLabelText("New achievements")).not.toBeInTheDocument();

  earned([{ player: player("p1", "Alice"), achievements: badges(1) }]);
  await waitFor(() => expect(onPhase).toHaveBeenLastCalledWith("playing"));
});

test("a song nobody earned anything for gives the stage back on its own", async () => {
  await ready();
  act(() =>
    FakeSocket.deliver({ event: "scores.recorded", sing_id: "s", scores: [] }),
  );
  await waitFor(() => expect(onPhase).toHaveBeenLastCalledWith("waiting"));

  act(() => vi.advanceTimersByTime(1_500));
  expect(onPhase).toHaveBeenLastCalledWith("idle");
});

test("the last row hands the stage back to the results", async () => {
  await ready();
  earned([{ player: player("p1", "Alice"), achievements: badges(1) }]);
  await screen.findByLabelText("New achievements");
  expect(onPhase).toHaveBeenLastCalledWith("playing");

  act(() => vi.advanceTimersByTime(15_100));
  expect(screen.queryByLabelText("New achievements")).not.toBeInTheDocument();
  // The stand-in belongs to the beat between two singers, not to the way out:
  // once the sequence is over the results own the stage again.
  expect(screen.queryByText(FALLBACK)).not.toBeInTheDocument();
  expect(onPhase).toHaveBeenLastCalledWith("idle");
});

test("a second song's badges supersede the ones still on the screen", async () => {
  await ready();
  earned([{ player: player("p1", "Alice"), achievements: badges(1, "Old") }]);
  await screen.findByLabelText("New achievements");
  expect(row()).toEqual(["Old 1"]);

  earned([{ player: player("p1", "Alice"), achievements: badges(1, "New") }]);

  // The same singer, the same position in the sequence — and still a fresh
  // arrival, or the newest song's badge would land without being thrown.
  expect(row()).toEqual(["New 1"]);
});
