import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/** The buttons of the closed strip, one per badge the singer holds. */
function stripButtons(container: HTMLElement): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>(
      ".user-achievements-badge-button",
    ),
  ];
}

/** Every picture the page is asking the icon endpoint for, at what resolution. */
function iconSizes(container: HTMLElement): string[] {
  return [...container.querySelectorAll("img")].map((image) =>
    (image.getAttribute("src") ?? "").includes("size=full") ? "full" : "small",
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

  expect(await screen.findByText("7 of 35")).toBeInTheDocument();
});

it("puts the earned ones first and draws the rest in the off state", async () => {
  const first = achievementRead({ id: "a-1", name: "First" });
  const second = achievementRead({ id: "a-2", name: "Second" });
  const third = achievementRead({ id: "a-3", name: "Third" });
  const { container } = renderSection(
    [first, second, third],
    [
      // The dates fight the catalogue: *First* was earned before *Third*, and
      // still leads, because where a badge sits is the host's arrangement and
      // not the day it was reached.
      playerAchievementRead({
        achievement: first,
        earned_at: "2026-08-30T20:00:00Z",
      }),
      playerAchievementRead({ achievement: second, earned_at: null }),
      playerAchievementRead({
        achievement: third,
        earned_at: "2026-09-01T22:00:00Z",
      }),
    ],
  );

  await screen.findByText("2 of 3");
  expect(rowNames(container)).toEqual(["First", "Third", "Second"]);
  // And the strip says the same thing in the same order.
  expect(
    stripButtons(container).map((badge) => badge.getAttribute("aria-label")),
  ).toEqual(["First", "Third"]);
  // The unearned one, and only it, carries the off styling.
  const off = [...container.querySelectorAll(".user-achievement-off")];
  expect(off).toHaveLength(1);
  expect(off[0].textContent).toContain("Second");
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
  expect(document.querySelector(".achievement-progress-bar")).toBeNull();
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
    ...container.querySelectorAll<HTMLElement>(
      ".achievement-progress-bar > span",
    ),
  ];
  expect(bars).toHaveLength(1);
  expect(bars[0].style.width).toBe("70%");
});

it("draws an empty bar for a party-scoped achievement between parties", async () => {
  // The API answers `0` with the target kept for progress it counted at a party
  // that is over ("ten songs in one evening" is ten songs again tomorrow), and
  // `0` is not `null`: the row still has a bar, standing at nothing. A falsy
  // check anywhere on the way here would hide it.
  const tonight = achievementRead({ id: "a-party", name: "Ten in one night" });
  const { container } = renderSection(
    [tonight],
    [
      playerAchievementRead({
        achievement: tonight,
        earned_at: null,
        progress_current: 0,
        progress_target: 10,
      }),
    ],
  );

  expect(await screen.findByText("0 / 10")).toBeInTheDocument();
  const bar = container.querySelector<HTMLElement>(
    ".achievement-progress-bar > span",
  );
  expect(bar).not.toBeNull();
  expect(bar?.style.width).toBe("0%");
});

it("invites a singer who has earned nothing yet", async () => {
  // What the API answers for a player who has never been scored: no rows at
  // all, so the catalogue is what says how many there are.
  renderSection(builtInAchievementReads().slice(0, 3), []);

  expect(await screen.findByText("0 of 3")).toBeInTheDocument();
  expect(
    screen.getByText("Nothing yet. The first one is a song away."),
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

it("lands a freshly earned one at its catalogue place, not at the top", async () => {
  const first = achievementRead({ id: "a-1", name: "First" });
  const second = achievementRead({ id: "a-2", name: "Second" });
  const third = achievementRead({ id: "a-3", name: "Third" });
  const { container } = renderSection(
    [first, second, third],
    [
      playerAchievementRead({ achievement: first, earned_at: EARNED_AT }),
      playerAchievementRead({ achievement: second, earned_at: null }),
      playerAchievementRead({ achievement: third, earned_at: null }),
    ],
  );

  await screen.findByText("1 of 3");

  // The refetch answers newest first, the reverse of the catalogue — and it
  // makes no difference: the list is built by walking the catalogue and looking
  // each row up, so what order the record arrives in is never read. The one
  // just earned lands third, where the host put it.
  listPlayerAchievements.mockResolvedValue({
    data: {
      achievements: [
        playerAchievementRead({
          achievement: third,
          earned_at: "2026-09-02T21:00:00Z",
        }),
        playerAchievementRead({ achievement: first, earned_at: EARNED_AT }),
        playerAchievementRead({ achievement: second, earned_at: null }),
      ],
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
        achievements: [third],
      },
    ],
  });

  await screen.findByText("2 of 3");
  expect(rowNames(container)).toEqual(["First", "Third", "Second"]);
  expect(
    stripButtons(container).map((badge) => badge.getAttribute("aria-label")),
  ).toEqual(["First", "Third"]);
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

it("still folds the list out when the line itself is pressed", async () => {
  const achievement = achievementRead();
  const { container } = renderSection(
    [achievement],
    [playerAchievementRead({ achievement })],
  );

  await screen.findByText("1 of 1");
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  fireEvent.click(container.querySelector(".user-achievements-summary")!);
  expect(details.open).toBe(true);
});

it("opens a badge on the strip large, and leaves the list folded away", async () => {
  const achievement = achievementRead();
  const { container } = renderSection(
    [achievement],
    [playerAchievementRead({ achievement })],
  );

  await screen.findByText("1 of 1");
  const badge = stripButtons(container);
  // The badge is decorative, so the button carries the name.
  expect(badge).toHaveLength(1);
  expect(badge[0]).toHaveAccessibleName("Golden Voice");

  // What the browser reads to decide whether to fold the list out: a summary's
  // activation runs once the click has finished travelling, and skips a click
  // whose default action was cancelled on the way. jsdom does not run that step
  // at all for a click whose target is a button of its own, so the open state
  // alone would say nothing here — the cancelled default action is the thing to
  // assert, and `document` is where it is read, past React's own root listener.
  const details = container.querySelector("details")!;
  let cancelled: boolean | null = null;
  const watch = (event: Event) => {
    cancelled = event.defaultPrevented;
  };
  document.addEventListener("click", watch);

  fireEvent.click(badge[0]);
  expect(screen.getByRole("dialog")).toHaveAccessibleName("Golden Voice");
  expect(cancelled).toBe(true);
  expect(details.open).toBe(false);

  // And the line itself is undefended, so it still folds the list out.
  cancelled = null;
  fireEvent.click(container.querySelector(".user-achievements-summary")!);
  expect(cancelled).toBe(false);
  document.removeEventListener("click", watch);
});

it("opens the same thing from a row of the list", async () => {
  const achievement = achievementRead({ name: "Ten songs" });
  const { container } = renderSection(
    [achievement],
    [
      playerAchievementRead({
        achievement,
        earned_at: null,
        progress_current: 7,
        progress_target: 10,
      }),
    ],
  );

  await screen.findByText("0 of 1");
  fireEvent.click(
    container.querySelector<HTMLElement>(".user-achievement-button")!,
  );

  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveAccessibleName("Ten songs");
  // The row's own line, again: the modal is a bigger place for the same words.
  expect(dialog).toHaveTextContent("7 / 10");
});

it("asks for the full-size picture only while the modal is open", async () => {
  const achievement = achievementRead({ has_image: true, icon_version: 4 });
  const { container } = renderSection(
    [achievement],
    [playerAchievementRead({ achievement })],
  );

  await screen.findByText("1 of 1");
  // The strip and the row draw the 256px file; a megabyte per badge is what
  // `size=small` exists to keep off this page.
  expect(iconSizes(container)).toEqual(["small", "small"]);

  fireEvent.click(stripButtons(container)[0]);
  expect(iconSizes(container)).toEqual(["small", "small", "full"]);

  fireEvent.keyDown(document, { key: "Escape" });
  expect(iconSizes(container)).toEqual(["small", "small"]);
});

it("gives the focus back to the badge that opened it", async () => {
  const achievement = achievementRead();
  const { container } = renderSection(
    [achievement],
    [playerAchievementRead({ achievement })],
  );

  await screen.findByText("1 of 1");
  const badge = stripButtons(container)[0];
  badge.focus();
  fireEvent.click(badge);
  expect(screen.getByRole("dialog")).toBeInTheDocument();

  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(document.activeElement).toBe(badge);
});
