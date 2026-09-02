import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MANAGE_CATALOGUE } from "../achievements";
import type { AchievementRead, AchievementSettings, MeRead } from "../api";
import { listAchievementsQueryKey } from "../api/@tanstack/react-query.gen";
import {
  achievementRead,
  achievementSettings,
  builtInAchievementReads,
  condition,
} from "../test/achievements";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import Achievements from "./Achievements";

const {
  getMe,
  listAchievements,
  updateAchievementSettings,
  exportAchievements,
  importAchievements,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  listAchievements: vi.fn(),
  updateAchievementSettings: vi.fn(),
  exportAchievements: vi.fn(),
  importAchievements: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listAchievements,
  updateAchievementSettings,
  exportAchievements,
  importAchievements,
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

/** An archive as the file input hands one over. */
function archive(size = 2048): File {
  const file = new File(["x"], "achievements.tar.gz", {
    type: "application/gzip",
  });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

/** What the export endpoint answers with: the bytes, and the name the backend
 *  put on them. */
function exported(
  filename = 'attachment; filename="achievements-2026-09-02.tar.gz"',
) {
  return {
    data: new Blob(["archive bytes"]),
    response: { headers: new Headers({ "Content-Disposition": filename }) },
  };
}

/** The rows of the export picker. */
function pickerRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".picker-row")];
}

const createObjectURL = vi.fn(() => "blob:the-archive");
const revokeObjectURL = vi.fn();
/** The anchor the page synthesises to save the archive; its click never leaves
 *  jsdom, so this is where the download's name and href are read. */
let saved: HTMLAnchorElement | undefined;

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  for (const mock of [
    getMe,
    listAchievements,
    updateAchievementSettings,
    exportAchievements,
    importAchievements,
    createObjectURL,
    revokeObjectURL,
  ])
    mock.mockReset();
  createObjectURL.mockReturnValue("blob:the-archive");
  // jsdom has neither, and a real one would need a real blob store.
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  saved = undefined;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
    // The page puts the link in the document before clicking it, and takes it
    // out again straight after — so it is only here that it can be read.
    saved =
      document.body.querySelector<HTMLAnchorElement>("a[download]") ??
      undefined;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

/* --------------------------------------------------------- import and export */

it("imports an archive and says what it did to which achievement", async () => {
  importAchievements.mockResolvedValue({
    data: { created: ["a-new"], updated: ["a-golden"] },
  });
  renderPage();

  await screen.findByText("Golden Voice");
  fireEvent.change(screen.getByLabelText("Import archive"), {
    target: { files: [archive()] },
  });

  await waitFor(() => expect(importAchievements).toHaveBeenCalled());
  expect(importAchievements.mock.calls[0][0].body.file.name).toBe(
    "achievements.tar.gz",
  );
  // Names for what the catalogue holds, the id for what it has not seen yet.
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Added a-new and updated Golden Voice.",
  );
  // And the catalogue is asked for again, socket or no socket.
  await waitFor(() => expect(listAchievements.mock.calls.length).toBe(2));
});

it("shows what a refused archive was refused for", async () => {
  importAchievements.mockRejectedValue({
    detail: "'builtin-duet/achievement.json' names an unknown key 'colour'",
  });
  renderPage();

  await screen.findByText("Golden Voice");
  fireEvent.change(screen.getByLabelText("Import archive"), {
    target: { files: [archive()] },
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "'builtin-duet/achievement.json' names an unknown key 'colour'",
  );
});

it("keeps an oversized archive in the browser", async () => {
  renderPage();

  await screen.findByText("Golden Voice");
  fireEvent.change(screen.getByLabelText("Import archive"), {
    target: { files: [archive(33 * 1024 * 1024)] },
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "larger than 32 MB",
  );
  expect(importAchievements).not.toHaveBeenCalled();
});

it("picks what goes into the archive without touching the rows", async () => {
  const { container } = renderPage([
    achievementRead({ id: "a-own", name: "Karaoke Hero" }),
    ...builtInAchievementReads(),
  ]);

  await screen.findByText("Karaoke Hero");
  // Nothing on the page's own rows selects anything: they are links into the
  // editor and stay that way.
  expect(rowsUnder(container, 0)[0].querySelector("input")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Export…" }));

  const rows = pickerRows();
  // Everything is offered, the seventeen included: sharing one of those is
  // what the format is for.
  expect(rows).toHaveLength(18);
  expect(rows[0]).toHaveTextContent("Karaoke Hero");
  expect(rows[1]).toHaveTextContent("included");
  expect(
    rows.every((row) => row.getAttribute("aria-pressed") === "false"),
  ).toBe(true);
  expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
});

it("exports the chosen ones and saves the file the backend named", async () => {
  exportAchievements.mockResolvedValue(exported());
  renderPage([
    achievementRead({ id: "a-own", name: "Karaoke Hero" }),
    achievementRead({ id: "a-other", name: "Second Voice" }),
  ]);

  await screen.findByText("Karaoke Hero");
  fireEvent.click(screen.getByRole("button", { name: "Export…" }));
  fireEvent.click(pickerRows()[1]);

  const button = screen.getByRole("button", { name: "Export · 1" });
  fireEvent.click(button);

  await waitFor(() => expect(exportAchievements).toHaveBeenCalled());
  expect(exportAchievements.mock.calls[0][0].body).toEqual({
    ids: ["a-other"],
  });

  // The bytes reach the browser as a blob URL on a synthetic link, under the
  // name the response's Content-Disposition gave them.
  expect(createObjectURL).toHaveBeenCalled();
  expect(saved?.getAttribute("href")).toBe("blob:the-archive");
  expect(saved?.getAttribute("download")).toBe(
    "achievements-2026-09-02.tar.gz",
  );
  // And the URL is let go again, or the blob would be held for the session.
  await waitFor(() =>
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:the-archive"),
  );
  // The picker closes on its own once the file is on its way.
  await waitFor(() => expect(pickerRows()).toHaveLength(0));
});

it("names the archive itself when nothing else does", async () => {
  exportAchievements.mockResolvedValue(exported(""));
  renderPage();

  await screen.findByText("Golden Voice");
  fireEvent.click(screen.getByRole("button", { name: "Export…" }));
  fireEvent.click(pickerRows()[0]);
  fireEvent.click(screen.getByRole("button", { name: "Export · 1" }));

  await waitFor(() => expect(saved).toBeDefined());
  expect(saved?.getAttribute("download")).toMatch(
    /^achievements-\d{4}-\d{2}-\d{2}\.tar\.gz$/,
  );
});

it("takes the lot and puts it back down again", async () => {
  renderPage([
    achievementRead({ id: "a1", name: "One" }),
    achievementRead({ id: "a2", name: "Two" }),
  ]);

  await screen.findByText("One");
  fireEvent.click(screen.getByRole("button", { name: "Export…" }));
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));

  expect(screen.getByRole("button", { name: "Export · 2" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Select none" }));
  expect(screen.getByRole("button", { name: "Export" })).toBeDisabled();
});

it("says what the backend refused about an archive it would not make", async () => {
  exportAchievements.mockRejectedValue({
    detail: "there is no achievement 'a-golden'",
  });
  renderPage();

  await screen.findByText("Golden Voice");
  fireEvent.click(screen.getByRole("button", { name: "Export…" }));
  fireEvent.click(pickerRows()[0]);
  fireEvent.click(screen.getByRole("button", { name: "Export · 1" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "there is no achievement 'a-golden'",
  );
  // Still open, with the choice intact: the reader has something to fix.
  expect(pickerRows()).toHaveLength(1);
});

it("asks for the managing copy of the catalogue", async () => {
  renderPage();

  await screen.findByText("Golden Voice");
  // `GET /achievements` is masked for everybody now, an administrator reading
  // their own user page included — a hidden achievement spelled out there is the
  // surprise gone. This page is the one that says it is managing, and the 403
  // for anybody who is not is the backend's.
  expect(listAchievements).toHaveBeenCalledWith(
    expect.objectContaining({ query: { manage: true } }),
  );
});

it("draws nothing of the managing catalogue a manager left in the cache", async () => {
  // The browser an administrator used and then logged out of: the managing
  // entry is still in memory, unmasked, and whoever signs in next may not
  // manage anything. `enabled` only stops the *request* — a disabled query
  // still hands back the data it has — so the render gate is what keeps a
  // hidden achievement's name off this page.
  getMe.mockResolvedValue(meResponse(["songs.view"], ACCOUNT));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(listAchievementsQueryKey(MANAGE_CATALOGUE), {
    achievements: [achievementRead({ name: "Brave Soul", hidden: true })],
    settings: achievementSettings(),
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/user/achievements"]}>
        <Achievements />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByText(/Achievements are looked after by the host/),
  ).toBeInTheDocument();
  expect(screen.queryByText("Brave Soul")).not.toBeInTheDocument();
});
