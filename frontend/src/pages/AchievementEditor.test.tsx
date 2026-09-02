import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { MANAGE_CATALOGUE } from "../achievements";
import type { AchievementRead, MeRead } from "../api";
import { listAchievementsQueryKey } from "../api/@tanstack/react-query.gen";
import {
  achievementRead,
  achievementSettings,
  condition,
} from "../test/achievements";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import AchievementEditor from "./AchievementEditor";

const {
  getMe,
  listAchievements,
  createAchievement,
  updateAchievement,
  deleteAchievement,
  resetAchievement,
  setAchievementIcon,
  deleteAchievementIcon,
  listSongs,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  listAchievements: vi.fn(),
  createAchievement: vi.fn(),
  updateAchievement: vi.fn(),
  deleteAchievement: vi.fn(),
  resetAchievement: vi.fn(),
  setAchievementIcon: vi.fn(),
  deleteAchievementIcon: vi.fn(),
  listSongs: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listAchievements,
  createAchievement,
  updateAchievement,
  deleteAchievement,
  resetAchievement,
  setAchievementIcon,
  deleteAchievementIcon,
  listSongs,
}));

const MANAGER = ["songs.view", "achievements.manage"];

/** One of the seventeen Wingman ships, as the managing listing answers with it:
 *  everything editable except what it asks for. */
function builtIn(overrides: Partial<AchievementRead> = {}): AchievementRead {
  return achievementRead({
    id: "builtin-score-9000",
    built_in: true,
    ...overrides,
  });
}

const BUILT_IN_PATH = "/user/achievements/builtin-score-9000";
const ACCOUNT: Partial<MeRead> = { user: userRead(), role: "trusted" };

/** Where a create or a delete has taken the reader. */
function Probe() {
  return <p>at {useLocation().pathname}</p>;
}

function renderEditor({
  path = "/user/achievements/a-golden",
  achievements = [achievementRead()],
  capabilities = MANAGER,
  cached,
}: {
  path?: string;
  achievements?: AchievementRead[];
  capabilities?: string[];
  /** A managing listing already in the cache when the page opens — the browser
   *  a manager used before whoever is reading now. */
  cached?: AchievementRead[];
} = {}) {
  getMe.mockResolvedValue(meResponse(capabilities, ACCOUNT));
  listAchievements.mockResolvedValue({
    data: { achievements, settings: achievementSettings() },
  });
  listSongs.mockResolvedValue({ data: { songs: [] } });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (cached !== undefined)
    client.setQueryData(listAchievementsQueryKey(MANAGE_CATALOGUE), {
      achievements: cached,
      settings: achievementSettings(),
    });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/user/achievements"
            element={<p>the achievement list</p>}
          />
          <Route
            path="/user/achievements/new"
            element={<AchievementEditor />}
          />
          <Route
            path="/user/achievements/:achievementId"
            element={<AchievementEditor />}
          />
        </Routes>
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The classes on one picker cell's glyph. The colour rides on the `<svg>` so
 *  that the cell's hover cannot repaint it — so that is where to look for it. */
function glyphClass(label: string): string {
  return (
    screen.getByLabelText(label).querySelector("svg")?.getAttribute("class") ??
    ""
  );
}

/** A picture as the file input hands one over. */
function picture(size = 1024): File {
  const file = new File(["x"], "badge.png", { type: "image/png" });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  for (const mock of [
    getMe,
    listAchievements,
    createAchievement,
    updateAchievement,
    deleteAchievement,
    resetAchievement,
    setAchievementIcon,
    deleteAchievementIcon,
    listSongs,
  ])
    mock.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

it("keeps the editor from a role that may not manage achievements", async () => {
  renderEditor({ capabilities: ["songs.view"] });

  expect(
    await screen.findByText(/Achievements are looked after by the host/),
  ).toBeInTheDocument();
  expect(listAchievements).not.toHaveBeenCalled();
});

it("says so when the achievement is not in the listing", async () => {
  renderEditor({ achievements: [] });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This achievement is gone.",
  );
});

it("seeds the form from the achievement it is editing", async () => {
  renderEditor({
    achievements: [
      achievementRead({
        hidden: true,
        enabled: false,
        definition: [condition(), condition({ metric: "number_of_sings" })],
      }),
    ],
  });

  expect(await screen.findByDisplayValue("Golden Voice")).toBeInTheDocument();
  expect(
    screen.getByDisplayValue("Score 9,000 or more in a song."),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Gold")).toBeChecked();
  expect(screen.getByLabelText("Hidden until earned")).toBeChecked();
  expect(screen.getByLabelText("Enabled")).not.toBeChecked();
  // Both conditions are drawn, each as the sentence it means.
  expect(screen.getByText("Condition 1")).toBeInTheDocument();
  expect(screen.getByText("Condition 2")).toBeInTheDocument();
  expect(
    screen.getByText("Over all time, some score of 9000 or more."),
  ).toBeInTheDocument();
  // Nothing to send yet.
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

it("creates an achievement with exactly what the form was left on", async () => {
  createAchievement.mockResolvedValue({
    data: achievementRead({ id: "a-new", name: "Karaoke Hero" }),
  });
  renderEditor({ path: "/user/achievements/new", achievements: [] });

  await screen.findByLabelText("Name");
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "  Karaoke Hero  " },
  });
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Sing ten songs. " },
  });
  fireEvent.click(screen.getByLabelText("music"));
  fireEvent.click(screen.getByLabelText("Blue"));
  fireEvent.click(screen.getByLabelText("Hidden until earned"));
  fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(createAchievement).toHaveBeenCalled());
  expect(createAchievement.mock.calls[0][0].body).toEqual({
    name: "Karaoke Hero",
    description: "Sing ten songs.",
    icon: "music",
    color: "blue",
    hidden: true,
    enabled: true,
    definition: [
      { scope: "global", metric: "any_score", comparator: ">=", value: 9000 },
    ],
  });
  // And the reader is on the achievement that now exists.
  expect(
    await screen.findByText("at /user/achievements/a-new"),
  ).toBeInTheDocument();
});

it("sends only the fields that changed", async () => {
  updateAchievement.mockResolvedValue({
    data: achievementRead({ name: "Silver Voice" }),
  });
  renderEditor();

  await screen.findByDisplayValue("Golden Voice");
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Silver Voice" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(updateAchievement).toHaveBeenCalled());
  expect(updateAchievement.mock.calls[0][0]).toMatchObject({
    path: { achievement_id: "a-golden" },
  });
  expect(updateAchievement.mock.calls[0][0].body).toEqual({
    name: "Silver Voice",
  });
  expect(await screen.findByText("Saved")).toBeInTheDocument();
});

it("sends the conditions when one of them is edited", async () => {
  updateAchievement.mockResolvedValue({ data: achievementRead() });
  renderEditor();

  await screen.findByDisplayValue("Golden Voice");
  fireEvent.change(screen.getByLabelText("What is measured"), {
    target: { value: "different_songs" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(updateAchievement).toHaveBeenCalled());
  expect(updateAchievement.mock.calls[0][0].body).toEqual({
    definition: [
      {
        scope: "global",
        metric: "different_songs",
        comparator: ">=",
        value: 9000,
      },
    ],
  });
});

it("refuses to save a condition the backend would reject", async () => {
  renderEditor();

  await screen.findByDisplayValue("Golden Voice");
  fireEvent.change(screen.getByLabelText("At least"), {
    target: { value: "9000" },
  });
  fireEvent.change(screen.getByLabelText("At most"), {
    target: { value: "100" },
  });

  expect(
    await screen.findByText(/cannot be above .at most./),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  // Put it right and the way out opens again.
  fireEvent.change(screen.getByLabelText("At most"), {
    target: { value: "9500" },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
  );
  expect(updateAchievement).not.toHaveBeenCalled();
});

it("warns that an achievement with no conditions can never be earned", async () => {
  updateAchievement.mockResolvedValue({ data: achievementRead() });
  renderEditor({ achievements: [achievementRead({ definition: [] })] });

  await screen.findByDisplayValue("Golden Voice");
  expect(screen.getByText(/nobody can ever earn this/)).toBeInTheDocument();

  // A warning, never a refusal: it saves as it stands.
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Unearnable" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(updateAchievement).toHaveBeenCalled());

  // And it goes the moment a condition exists.
  fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
  expect(
    screen.queryByText(/nobody can ever earn this/),
  ).not.toBeInTheDocument();
});

it("says nothing can be typed away without a name", async () => {
  renderEditor();

  await screen.findByDisplayValue("Golden Voice");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "   " } });
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

it("shows what the backend refused", async () => {
  updateAchievement.mockRejectedValue({
    detail: "value is not a valid integer",
  });
  renderEditor();

  await screen.findByDisplayValue("Golden Voice");
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Silver Voice" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "value is not a valid integer",
  );
});

it("names what a delete takes with it and then deletes", async () => {
  deleteAchievement.mockResolvedValue({ data: undefined });
  renderEditor();

  await screen.findByDisplayValue("Golden Voice");
  fireEvent.click(screen.getByRole("button", { name: "Delete achievement" }));
  expect(
    screen.getByText(/Everybody who earned it loses it/),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  await waitFor(() => expect(deleteAchievement).toHaveBeenCalled());
  expect(deleteAchievement.mock.calls[0][0].path).toEqual({
    achievement_id: "a-golden",
  });
  expect(await screen.findByText("at /user/achievements")).toBeInTheDocument();
});

it("offers no delete for an achievement that does not exist yet", async () => {
  renderEditor({ path: "/user/achievements/new", achievements: [] });

  await screen.findByLabelText("Name");
  expect(
    screen.queryByRole("button", { name: "Delete achievement" }),
  ).not.toBeInTheDocument();
});

it("lets a built-in be edited but never deleted", async () => {
  updateAchievement.mockResolvedValue({ data: achievementRead() });
  renderEditor({ achievements: [builtIn()], path: BUILT_IN_PATH });

  await screen.findByDisplayValue("Golden Voice");
  expect(
    screen.queryByRole("button", { name: "Delete achievement" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/one of the achievements Wingman brings with it/),
  ).toBeInTheDocument();

  // Everything else is the same form: it can be renamed and switched off.
  fireEvent.click(screen.getByLabelText("Enabled"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(updateAchievement).toHaveBeenCalled());
  expect(updateAchievement.mock.calls[0][0].body).toEqual({ enabled: false });
});

it("draws a built-in's conditions as locked, not as controls that fail", async () => {
  renderEditor({ achievements: [builtIn()], path: BUILT_IN_PATH });

  await screen.findByDisplayValue("Golden Voice");
  // The sentence is still there: what it asks for is not a secret, it is simply
  // not the party's to change.
  expect(
    screen.getByText("Over all time, some score of 9000 or more."),
  ).toBeInTheDocument();
  // And not one control of the builder — a refusal after pressing Save is what
  // this replaces.
  expect(screen.queryByLabelText("What is measured")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Add condition" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Remove condition 1" }),
  ).not.toBeInTheDocument();
  // One quiet line says why, where the reader is looking.
  expect(
    screen.getByText(/cannot be changed — the same badge means the same thing/),
  ).toBeInTheDocument();
});

it("puts a built-in back the way Wingman ships it, once it is confirmed", async () => {
  resetAchievement.mockResolvedValue({
    data: builtIn({ name: "Golden Voice", color: "gold" }),
  });
  renderEditor({
    achievements: [builtIn({ name: "Renamed", color: "pink" })],
    path: BUILT_IN_PATH,
  });

  await screen.findByDisplayValue("Renamed");
  fireEvent.click(screen.getByRole("button", { name: "Reset achievement" }));
  // A reset throws edits away, so it asks first (§5).
  expect(screen.getByText(/back the way Wingman ships it/)).toBeInTheDocument();
  expect(resetAchievement).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Reset" }));

  await waitFor(() => expect(resetAchievement).toHaveBeenCalled());
  expect(resetAchievement.mock.calls[0][0].path).toEqual({
    achievement_id: "builtin-score-9000",
  });
  // The form is re-seeded from the restored row rather than left showing the
  // name that was just thrown away.
  expect(await screen.findByDisplayValue("Golden Voice")).toBeInTheDocument();
});

it("offers no reset for an achievement the party made itself", async () => {
  renderEditor();

  await screen.findByDisplayValue("Golden Voice");
  expect(
    screen.queryByRole("button", { name: "Reset achievement" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Delete achievement" }),
  ).toBeInTheDocument();
});

it("paints only the chosen glyph and keeps one the picker does not offer", async () => {
  renderEditor();

  await screen.findByDisplayValue("Golden Voice");
  // `trophy` is not in the picker's allowlist (§3), so it is appended for this
  // achievement alone — and it is the cell the reader came in on.
  expect(screen.getByLabelText("trophy")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(glyphClass("trophy")).toBe("icon tag-color-gold");
  expect(glyphClass("music")).toBe("icon");

  // The colour follows the pills, and the choice follows the cell.
  fireEvent.click(screen.getByLabelText("Blue"));
  expect(glyphClass("trophy")).toBe("icon tag-color-blue");
  fireEvent.click(screen.getByLabelText("music"));
  expect(glyphClass("music")).toBe("icon tag-color-blue");
  expect(glyphClass("trophy")).toBe("icon");

  // And "no icon" is a control, not a preview.
  fireEvent.click(screen.getByLabelText("No icon"));
  expect(screen.getByLabelText("No icon")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(glyphClass("No icon")).toBe("icon");
});

it("cannot upload a picture until the achievement exists", async () => {
  renderEditor({ path: "/user/achievements/new", achievements: [] });

  await screen.findByLabelText("Name");
  expect(screen.getByLabelText("Use a picture instead")).toBeDisabled();
  expect(
    screen.getByText(/A picture needs an achievement/),
  ).toBeInTheDocument();
});

it("uploads a picture and puts it where the glyph was", async () => {
  setAchievementIcon.mockResolvedValue({
    data: achievementRead({ has_image: true }),
  });
  renderEditor();

  await screen.findByDisplayValue("Golden Voice");
  fireEvent.change(screen.getByLabelText("Use a picture instead"), {
    target: { files: [picture()] },
  });

  await waitFor(() => expect(setAchievementIcon).toHaveBeenCalled());
  expect(setAchievementIcon.mock.calls[0][0].path).toEqual({
    achievement_id: "a-golden",
  });
  // A picture and a glyph are alternatives: the grid and the colours go.
  expect(
    await screen.findByRole("button", { name: "Use a glyph instead" }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("No icon")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("radiogroup", { name: "Colour" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/no colour to set/)).toBeInTheDocument();
  // Nothing about the form was touched by an upload — it is its own endpoint.
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

it("draws the replacement rather than the picture it replaced", async () => {
  const { container } = renderEditor({
    achievements: [achievementRead({ has_image: true, icon_version: 100 })],
  });

  await screen.findByDisplayValue("Golden Voice");
  expect(container.querySelector("img")).toHaveAttribute(
    "src",
    "/api/v1/achievements/a-golden/icon?v=100",
  );

  // The URL and `has_image` do not move when a picture is replaced — the
  // version off the answer is the whole of what tells the browser to fetch it.
  setAchievementIcon.mockResolvedValue({
    data: achievementRead({ has_image: true, icon_version: 200 }),
  });
  fireEvent.change(screen.getByLabelText("Replace picture"), {
    target: { files: [picture()] },
  });

  await waitFor(() =>
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/api/v1/achievements/a-golden/icon?v=200",
    ),
  );
});

it("keeps an oversized picture in the browser", async () => {
  renderEditor();

  await screen.findByDisplayValue("Golden Voice");
  fireEvent.change(screen.getByLabelText("Use a picture instead"), {
    target: { files: [picture(6 * 1024 * 1024)] },
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "That image is larger than 5 MB.",
  );
  expect(setAchievementIcon).not.toHaveBeenCalled();
});

it("says what the backend refused about a picture", async () => {
  setAchievementIcon.mockRejectedValue({ detail: "unsupported_icon_type" });
  renderEditor();

  await screen.findByDisplayValue("Golden Voice");
  fireEvent.change(screen.getByLabelText("Use a picture instead"), {
    target: { files: [picture()] },
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Only jpeg, png and webp images work",
  );
});

it("goes back to a glyph from a picture", async () => {
  deleteAchievementIcon.mockResolvedValue({
    data: achievementRead({ has_image: false }),
  });
  renderEditor({ achievements: [achievementRead({ has_image: true })] });

  await screen.findByDisplayValue("Golden Voice");
  expect(screen.queryByLabelText("No icon")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Use a glyph instead" }));

  await waitFor(() => expect(deleteAchievementIcon).toHaveBeenCalled());
  expect(deleteAchievementIcon.mock.calls[0][0].path).toEqual({
    achievement_id: "a-golden",
  });
  // The grid and the colours are back, on the glyph the row still carries.
  expect(await screen.findByLabelText("No icon")).toBeInTheDocument();
  expect(screen.getByLabelText("trophy")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    screen.getByRole("radiogroup", { name: "Colour" }),
  ).toBeInTheDocument();
});

it("asks for the managing copy of the catalogue", async () => {
  renderEditor();

  await screen.findByDisplayValue("Golden Voice");
  // Without it the listing would come back masked, and the editor would open a
  // hidden achievement on the stand-in words instead of its own.
  expect(listAchievements).toHaveBeenCalledWith(
    expect.objectContaining({ query: { manage: true } }),
  );
});

it("draws no form for a reader who may not manage, warm cache or not", async () => {
  // The other half of the same worry as on the list page: the managing entry
  // outlives the manager who filled it, and this page seeds its draft off it
  // during render. Nothing of it may reach the screen for the next person on
  // that browser.
  renderEditor({
    cached: [achievementRead({ name: "Brave Soul", hidden: true })],
    capabilities: ["songs.view"],
  });

  expect(
    await screen.findByText(/Achievements are looked after by the host/),
  ).toBeInTheDocument();
  expect(screen.queryByDisplayValue("Brave Soul")).not.toBeInTheDocument();
  expect(screen.queryByText("Brave Soul")).not.toBeInTheDocument();
});
