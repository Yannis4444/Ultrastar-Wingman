import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  AchievementRead,
  AchievementSettings,
  PlayerAchievementRead,
} from "../api";
import {
  achievementRead,
  achievementSettings,
  builtInAchievementReads,
  maskedAchievementRead,
  playerAchievementRead,
} from "../test/achievements";
import { FakeSocket } from "../test/fakeSocket";
import UserAchievements from "./UserAchievements";

const { listAchievements, listPlayerAchievements } = vi.hoisted(() => ({
  listAchievements: vi.fn(),
  listPlayerAchievements: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listAchievements,
  listPlayerAchievements,
}));

const EARNED_AT = "2026-09-01T20:15:00Z";

function renderSection(
  catalogue: AchievementRead[],
  rows: PlayerAchievementRead[],
  settings: AchievementSettings = achievementSettings(),
) {
  listAchievements.mockResolvedValue({
    data: { achievements: catalogue, settings },
  });
  listPlayerAchievements.mockResolvedValue({ data: { achievements: rows } });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <UserAchievements playerId="p1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The names of the list's rows, in the order they are drawn. */
function rowNames(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".user-achievement-name")].map(
    (name) => name.textContent ?? "",
  );
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  for (const mock of [listAchievements, listPlayerAchievements])
    mock.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

it("counts what the singer holds against what there is to hold", async () => {
  const catalogue = builtInAchievementReads();
  renderSection(
    catalogue,
    catalogue.map((achievement, index) =>
      playerAchievementRead({
        achievement,
        earned_at: index < 7 ? EARNED_AT : null,
      }),
    ),
  );

  expect(await screen.findByText("7 of 17")).toBeInTheDocument();
});

it("puts the earned ones first and draws the rest in the off state", async () => {
  const first = achievementRead({ id: "a-1", name: "First" });
  const second = achievementRead({ id: "a-2", name: "Second" });
  const third = achievementRead({ id: "a-3", name: "Third" });
  const { container } = renderSection(
    [first, second, third],
    [
      playerAchievementRead({ achievement: first, earned_at: null }),
      // Earned last, so it leads: the one just reached is the one being
      // looked for.
      playerAchievementRead({
        achievement: second,
        earned_at: "2026-09-01T22:00:00Z",
      }),
      playerAchievementRead({
        achievement: third,
        earned_at: "2026-08-30T20:00:00Z",
      }),
    ],
  );

  await screen.findByText("2 of 3");
  expect(rowNames(container)).toEqual(["Second", "Third", "First"]);
  // The unearned one, and only it, carries the off styling.
  const off = [...container.querySelectorAll(".user-achievement-off")];
  expect(off).toHaveLength(1);
  expect(off[0].textContent).toContain("First");
});

it("says a hidden achievement is one without saying what it is", async () => {
  const masked = maskedAchievementRead();
  renderSection(
    [masked],
    [
      playerAchievementRead({
        achievement: masked,
        earned_at: null,
        // Nulled by the API on a masked row: a bar would leak what it is for.
        progress_current: null,
        progress_target: null,
      }),
    ],
  );

  expect(await screen.findByText("Hidden achievement")).toBeInTheDocument();
  expect(
    screen.getByText("Earn it to find out what this is."),
  ).toBeInTheDocument();
  // Nothing of the real achievement, and no progress to read it off either.
  expect(screen.queryByText("Golden Voice")).not.toBeInTheDocument();
  expect(
    screen.queryByText("Score 9,000 or more in a song."),
  ).not.toBeInTheDocument();
  expect(document.querySelector(".user-achievement-bar")).toBeNull();
});

it("draws a bar where there is progress and none where there is no target", async () => {
  const counted = achievementRead({ id: "a-count", name: "Ten songs" });
  const uncounted = achievementRead({ id: "a-exact", name: "Exactly one" });
  const { container } = renderSection(
    [counted, uncounted],
    [
      playerAchievementRead({
        achievement: counted,
        earned_at: null,
        progress_current: 7,
        progress_target: 10,
      }),
      // `=`, `<` and `<=` progress towards nothing, so the backend stores no
      // target and the row gets no bar.
      playerAchievementRead({
        achievement: uncounted,
        earned_at: null,
        progress_current: null,
        progress_target: null,
      }),
    ],
  );

  expect(await screen.findByText("7 / 10")).toBeInTheDocument();
  const bars = [
    ...container.querySelectorAll<HTMLElement>(".user-achievement-bar > span"),
  ];
  expect(bars).toHaveLength(1);
  expect(bars[0].style.width).toBe("70%");
});

it("invites a singer who has earned nothing yet", async () => {
  // What the API answers for a player who has never been scored: no rows at
  // all, so the catalogue is what says how many there are.
  renderSection(builtInAchievementReads().slice(0, 3), []);

  expect(await screen.findByText("0 of 3")).toBeInTheDocument();
  expect(
    screen.getByText("Nothing yet — the first one is a song away."),
  ).toBeInTheDocument();
  // The list behind it still says what is out there.
  expect(screen.getByText("First Time on the Mic")).toBeInTheDocument();
});

it("draws nothing at all while the feature is switched off", async () => {
  const catalogue = [achievementRead()];
  const { container } = renderSection(
    catalogue,
    [playerAchievementRead({ achievement: catalogue[0] })],
    achievementSettings({ enabled: false }),
  );

  await waitFor(() => expect(listAchievements).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
  // And the record is never even asked for.
  expect(listPlayerAchievements).not.toHaveBeenCalled();
});

it("picks up an achievement earned while the page is open", async () => {
  const achievement = achievementRead({ id: "a-1", name: "Golden Voice" });
  listAchievements.mockResolvedValue({
    data: {
      achievements: [achievement],
      settings: achievementSettings(),
    },
  });
  listPlayerAchievements.mockResolvedValue({
    data: {
      achievements: [playerAchievementRead({ achievement, earned_at: null })],
    },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <UserAchievements playerId="p1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByText("0 of 1")).toBeInTheDocument();

  listPlayerAchievements.mockResolvedValue({
    data: {
      achievements: [playerAchievementRead({ achievement })],
    },
  });
  FakeSocket.deliver({
    event: "achievements.earned",
    sing_id: "sing-1",
    players: [
      {
        player: {
          id: "p1",
          name: "Alice",
          registered: true,
          hidden: false,
          has_avatar: false,
        },
        achievements: [achievement],
      },
    ],
  });

  expect(await screen.findByText("1 of 1")).toBeInTheDocument();
});

it("leaves the record alone when somebody else earned something", async () => {
  const achievement = achievementRead({ id: "a-1" });
  renderSection(
    [achievement],
    [playerAchievementRead({ achievement, earned_at: null })],
  );

  await screen.findByText("0 of 1");
  expect(listPlayerAchievements).toHaveBeenCalledTimes(1);

  FakeSocket.deliver({
    event: "achievements.earned",
    sing_id: "sing-1",
    players: [
      {
        player: {
          id: "p2",
          name: "Bob",
          registered: false,
          hidden: false,
          has_avatar: false,
        },
        achievements: [achievement],
      },
    ],
  });

  await waitFor(() => expect(listPlayerAchievements).toHaveBeenCalledTimes(1));
});

it("asks for the catalogue as a singer, never as a manager", async () => {
  renderSection([achievementRead()], []);

  await screen.findByText("Golden Voice");
  // The singer's own page, drawn from the same listing the management page reads
  // — and this is the one the administrator opens on their phone. Asking to
  // manage here is what spelled a hidden achievement out for them.
  for (const [options] of listAchievements.mock.calls)
    expect(options?.query?.manage).toBeUndefined();
});
