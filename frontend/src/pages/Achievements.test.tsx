import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AchievementRead, AchievementSettings, MeRead } from "../api";
import {
  achievementRead,
  achievementSettings,
  builtInAchievementReads,
  condition,
} from "../test/achievements";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import Achievements from "./Achievements";

const { getMe, listAchievements, updateAchievementSettings } = vi.hoisted(
  () => ({
    getMe: vi.fn(),
    listAchievements: vi.fn(),
    updateAchievementSettings: vi.fn(),
  }),
);

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listAchievements,
  updateAchievementSettings,
}));

const MANAGER = ["songs.view", "achievements.manage"];
const ACCOUNT: Partial<MeRead> = { user: userRead(), role: "trusted" };

function renderPage(
  achievements: AchievementRead[] | Error = [achievementRead()],
  capabilities = MANAGER,
  settings: AchievementSettings = achievementSettings(),
) {
  getMe.mockResolvedValue(meResponse(capabilities, ACCOUNT));
  listAchievements.mockImplementation(async () => {
    if (achievements instanceof Error) throw achievements;
    return { data: { achievements, settings } };
  });
  updateAchievementSettings.mockImplementation(
    async ({ body }: { body: Partial<AchievementSettings> }) => ({
      data: { ...settings, ...body },
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/user/achievements"]}>
        <Achievements />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The rows of one list, in the order they are drawn. */
function rowsUnder(container: HTMLElement, index: number): HTMLAnchorElement[] {
  const lists = container.querySelectorAll(".achievements-list");
  return [
    ...lists[index].querySelectorAll<HTMLAnchorElement>(".achievements-open"),
  ];
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  for (const mock of [getMe, listAchievements, updateAchievementSettings])
    mock.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

it("keeps the page from a role that may not manage achievements", async () => {
  renderPage([achievementRead()], ["songs.view"]);

  expect(
    await screen.findByText(/Achievements are looked after by the host/),
  ).toBeInTheDocument();
  expect(listAchievements).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("New achievement")).not.toBeInTheDocument();
});

it("shows the three settings the feature has, in order", async () => {
  renderPage([], MANAGER, achievementSettings({ host_seconds_base: 6 }));

  const toggle = await screen.findByLabelText("Enabled");
  expect(toggle).toBeChecked();
  expect(
    screen.getByLabelText("How long a row of badges stays on the host screen"),
  ).toHaveValue(6);
  expect(screen.getByLabelText("Added for each badge in the row")).toHaveValue(
    2,
  );
});

it("switches the feature off for the whole party", async () => {
  renderPage();

  const toggle = await screen.findByLabelText("Enabled");
  fireEvent.click(toggle);

  await waitFor(() =>
    expect(updateAchievementSettings).toHaveBeenCalledWith(
      expect.objectContaining({ body: { enabled: false } }),
    ),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("Saved");
});

it("saves a second count when the box is left, and only when it moved", async () => {
  renderPage();

  const input = await screen.findByLabelText(
    "How long a row of badges stays on the host screen",
  );
  fireEvent.change(input, { target: { value: "9" } });
  fireEvent.blur(input);

  await waitFor(() =>
    expect(updateAchievementSettings).toHaveBeenCalledWith(
      expect.objectContaining({ body: { host_seconds_base: 9 } }),
    ),
  );

  // Left again without anything moving: nothing is asked for.
  updateAchievementSettings.mockClear();
  fireEvent.blur(input);
  expect(updateAchievementSettings).not.toHaveBeenCalled();
});

it("shows what the backend refused verbatim", async () => {
  renderPage();
  updateAchievementSettings.mockRejectedValue({
    detail: "between 0 and 60 seconds",
  });

  const input = await screen.findByLabelText("Added for each badge in the row");
  fireEvent.change(input, { target: { value: "900" } });
  fireEvent.blur(input);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "between 0 and 60 seconds",
  );
});

it("keeps what people made apart from what Wingman brings", async () => {
  const { container } = renderPage([
    achievementRead({ id: "a-own", name: "Karaoke Hero" }),
    ...builtInAchievementReads(),
  ]);

  await screen.findByText("Karaoke Hero");
  // Only the second group is named: the rows people made lead the page without
  // a heading, the way the Tags page leads with its own tags.
  expect(screen.getByRole("heading", { name: "Included" })).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: /your achievements/i }),
  ).not.toBeInTheDocument();

  expect(rowsUnder(container, 0).map((row) => row.textContent)).toEqual([
    "Karaoke Hero1 condition",
  ]);
  const included = rowsUnder(container, 1);
  expect(included).toHaveLength(17);
  expect(included[0]).toHaveTextContent("First Time on the Mic");
  expect(included[0]).toHaveAttribute(
    "href",
    "/user/achievements/builtin-first-song",
  );
  // The hidden one Wingman ships says so, and is the last of them.
  expect(included[16]).toHaveTextContent("Brave Soul1 condition · hidden");
});

it("says only what is unusual about a row", async () => {
  const { container } = renderPage([
    achievementRead({ id: "a1", name: "Plain" }),
    achievementRead({
      id: "a2",
      name: "Three",
      definition: [condition(), condition(), condition()],
    }),
    achievementRead({ id: "a3", name: "Secret", hidden: true }),
    achievementRead({ id: "a4", name: "Paused", enabled: false }),
    achievementRead({
      id: "a5",
      name: "Both",
      hidden: true,
      enabled: false,
    }),
  ]);

  await screen.findByText("Plain");
  expect(
    rowsUnder(container, 0).map(
      (row) => row.querySelector(".achievements-meta")?.textContent,
    ),
  ).toEqual([
    "1 condition",
    "3 conditions",
    "1 condition · hidden",
    "1 condition · off",
    "1 condition · hidden · off",
  ]);
});

it("says a built-in is off in the same words", async () => {
  const { container } = renderPage(
    builtInAchievementReads().map((row, index) =>
      index === 0 ? { ...row, enabled: false } : row,
    ),
  );

  await screen.findByText("First Time on the Mic");
  expect(rowsUnder(container, 0)[0]).toHaveTextContent(
    "First Time on the Mic1 condition · off",
  );
});

it("invites the first achievement when nobody has made one", async () => {
  renderPage(builtInAchievementReads());

  expect(await screen.findByText("No achievements yet")).toBeInTheDocument();
  // The seventeen are still there: the empty state is about the party's own.
  expect(screen.getByText("Golden Voice")).toBeInTheDocument();
});

it("leads each row into the editor and the header into a new one", async () => {
  renderPage();

  expect(
    await screen.findByRole("link", { name: /Golden Voice/ }),
  ).toHaveAttribute("href", "/user/achievements/a-golden");
  expect(screen.getByLabelText("New achievement")).toHaveAttribute(
    "href",
    "/user/achievements/new",
  );
});

it("says so when the catalogue cannot be loaded", async () => {
  renderPage(new Error("nope"));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load the achievements.",
  );
});

it("reloads when somebody else changes the catalogue", async () => {
  renderPage();

  await screen.findByText("Golden Voice");
  listAchievements.mockResolvedValue({
    data: {
      achievements: [achievementRead({ name: "Silver Voice" })],
      settings: achievementSettings(),
    },
  });
  FakeSocket.deliver({ event: "achievements.changed" });

  expect(await screen.findByText("Silver Voice")).toBeInTheDocument();
});

it("draws each achievement in its own colour", async () => {
  const { container } = renderPage([
    achievementRead({ id: "a1", name: "Gold", color: "gold" }),
    achievementRead({ id: "a2", name: "Blue", color: "blue" }),
  ]);

  await screen.findByText("Gold");
  const rows = rowsUnder(container, 0);
  expect(rows[0].querySelector(".achievement-badge")).toHaveClass(
    "tag-color-gold",
  );
  expect(rows[1].querySelector(".achievement-badge")).toHaveClass(
    "tag-color-blue",
  );
});
