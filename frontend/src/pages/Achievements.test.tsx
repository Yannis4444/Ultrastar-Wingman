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
} from "../test/achievements";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import Achievements from "./Achievements";

const {
  getMe,
  listAchievements,
  updateAchievementSettings,
  exportAchievements,
  importAchievements,
  reorderAchievements,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  listAchievements: vi.fn(),
  updateAchievementSettings: vi.fn(),
  exportAchievements: vi.fn(),
  importAchievements: vi.fn(),
  reorderAchievements: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listAchievements,
  updateAchievementSettings,
  exportAchievements,
  importAchievements,
  reorderAchievements,
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

/** The catalogue's rows, in the order they are drawn. One list over all of it,
 *  so there is one place to read them from. */
function listRows(container: HTMLElement): HTMLAnchorElement[] {
  return [
    ...container.querySelectorAll<HTMLAnchorElement>(".achievements-open"),
  ];
}

/** jsdom has no layout, and a drag knows which row the finger is over from the
 *  rows' own `bottom`: 60px each, top to bottom. */
function layOutRows(list: Element, height = 60): void {
  [...list.children].forEach((row, index) =>
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
      top: index * height,
      bottom: (index + 1) * height,
    } as DOMRect),
  );
}

/** Pointer capture, which jsdom does not implement at all — the grip takes it
 *  so the gesture survives the row moving out from under it. */
const POINTER_CAPTURE = ["setPointerCapture", "releasePointerCapture"] as const;

/** A finger moved to `clientY` over the list.
 *
 * `fireEvent.pointerMove` cannot do it: jsdom has no `PointerEvent`, so the
 * event testing-library builds carries no coordinate at all and the drag reads
 * `undefined` — which lands every row at the foot of the list rather than where
 * the finger is. A `MouseEvent` under the same name carries `clientY`, and
 * React reads it off the native event either way. */
function dragTo(grip: Element, clientY: number): void {
  fireEvent(grip, new MouseEvent("pointermove", { bubbles: true, clientY }));
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
    reorderAchievements,
    createObjectURL,
    revokeObjectURL,
  ])
    mock.mockReset();
  createObjectURL.mockReturnValue("blob:the-archive");
  // jsdom has neither, and a real one would need a real blob store.
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  saved = undefined;
  for (const method of POINTER_CAPTURE)
    Object.defineProperty(Element.prototype, method, {
      value: () => {},
      configurable: true,
    });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
    // The page puts the link in the document before clicking it, and takes it
    // out again straight after — so it is only here that it can be read.
    saved =
      document.body.querySelector<HTMLAnchorElement>("a[download]") ??
      undefined;
  });
});

afterEach(() => {
  for (const method of POINTER_CAPTURE)
    Reflect.deleteProperty(Element.prototype, method);
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

it("draws the whole catalogue as one list, in the order it comes in", async () => {
  const { container } = renderPage([
    builtInAchievementReads()[0],
    achievementRead({ id: "a-own", name: "Karaoke Hero" }),
    ...builtInAchievementReads().slice(1),
  ]);

  await screen.findByText("Karaoke Hero");
  // One list and no section heading over any part of it: the order is the
  // host's, so a party's own achievement may stand above a shipped one.
  expect(container.querySelectorAll(".achievements-list")).toHaveLength(1);
  expect(
    screen.queryByRole("heading", { name: "Included" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: /your achievements/i }),
  ).not.toBeInTheDocument();

  const rows = listRows(container);
  expect(rows).toHaveLength(18);
  expect(rows[0]).toHaveTextContent("First Time on the Mic");
  expect(rows[0]).toHaveAttribute(
    "href",
    "/user/achievements/builtin-first-song",
  );
  // The party's own row sits where the catalogue puts it, between two shipped
  // ones, and is the one without the word.
  expect(rows[1]).toHaveTextContent("Karaoke Hero");
  expect(rows[1].querySelector(".achievements-included")).toBeNull();
  expect(rows[0].querySelector(".achievements-included")?.textContent).toBe(
    "Included",
  );
  // The hidden one Wingman ships wears the lock, and is the last of them.
  expect(rows[17]).toHaveTextContent("Brave Soul");
  expect(iconNames(rows[17])).toContain("lock");
});

it("says the name and the description, and only what is unusual", async () => {
  const { container } = renderPage([
    achievementRead({ id: "a1", name: "Plain" }),
    achievementRead({ id: "a2", name: "Wordless", description: "" }),
    achievementRead({ id: "a3", name: "Secret", hidden: true }),
    achievementRead({ id: "a4", name: "Paused", enabled: false }),
  ]);

  await screen.findByText("Plain");
  const rows = listRows(container);
  expect(
    rows.map((row) => row.querySelector(".achievements-name")?.textContent),
  ).toEqual(["Plain", "Wordless", "Secret", "Paused"]);
  // The description is the second line, and how much there is to read inside is
  // not a number a row compares itself by any more.
  expect(rows[0].querySelector(".achievements-description")?.textContent).toBe(
    "Score 9,000 or more in a song.",
  );
  expect(rows.map((row) => row.textContent).join("")).not.toMatch(/condition/);
  // No second line at all where the achievement has nothing on it.
  expect(rows[1].querySelector(".achievements-description")).toBeNull();
  // Hidden is the `lock` the masked badge wears, on the title line.
  expect(iconNames(rows[2])).toContain("lock");
  expect(iconNames(rows[0])).not.toContain("lock");
  // Switched off greys the row — and says so for a reader who cannot see that.
  expect(rows[3].className).toContain("achievements-row-off");
  expect(rows[3]).toHaveTextContent("Switched off");
  expect(rows[0].className).not.toContain("achievements-row-off");
  expect(rows[0]).not.toHaveTextContent("Switched off");
  // The label is for the set Wingman ships; nothing here is one of those.
  expect(container.querySelector(".achievements-included")).toBeNull();
});

it("labels an included row and greys one that is switched off", async () => {
  const { container } = renderPage(
    builtInAchievementReads().map((row, index) =>
      index === 0 ? { ...row, enabled: false } : row,
    ),
  );

  await screen.findByText("First Time on the Mic");
  const rows = listRows(container);
  expect(
    rows.every(
      (row) =>
        row.querySelector(".achievements-included")?.textContent === "Included",
    ),
  ).toBe(true);
  expect(rows[0].className).toContain("achievements-row-off");
  expect(rows[0]).toHaveTextContent("Switched off");
  expect(rows[1].className).not.toContain("achievements-row-off");
});

it("invites the first achievement when the catalogue is empty", async () => {
  renderPage([]);

  expect(await screen.findByText("No achievements yet")).toBeInTheDocument();
});

it("draws no empty state while the catalogue has rows", async () => {
  renderPage(builtInAchievementReads());

  expect(await screen.findByText("Golden Voice")).toBeInTheDocument();
  expect(screen.queryByText("No achievements yet")).not.toBeInTheDocument();
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
  const rows = listRows(container);
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
  expect(listRows(container)[0].querySelector("input")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Export…" }));

  const rows = pickerRows();
  // Everything is offered, the seventeen included: sharing one of those is
  // what the format is for.
  expect(rows).toHaveLength(18);
  expect(rows[0]).toHaveTextContent("Karaoke Hero");
  expect(rows[1]).toHaveTextContent("Included");
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

/* ------------------------------------------------------------- the order */

/** The party's own two rows in front of the seventeen Wingman ships. */
function catalogue(): AchievementRead[] {
  return [
    achievementRead({ id: "a-own", name: "Karaoke Hero" }),
    achievementRead({ id: "a-second", name: "Second Voice" }),
    ...builtInAchievementReads(),
  ];
}

it("arranges the catalogue and sends the whole order", async () => {
  const rows = catalogue();
  renderPage(rows);
  reorderAchievements.mockResolvedValue({
    data: { achievements: rows, settings: achievementSettings() },
  });

  fireEvent.click(
    await screen.findByRole("button", { name: "Arrange the order" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Move Karaoke Hero down" }),
  );

  await waitFor(() => expect(reorderAchievements).toHaveBeenCalled());
  // One sequence over the whole table, exactly the order the page draws.
  expect(reorderAchievements.mock.calls[0][0].body.ids).toEqual([
    "a-second",
    "a-own",
    ...builtInAchievementReads().map(({ id }) => id),
  ]);
  // One list, so only the first row of all of them has no way up and only the
  // last has no way down — no section boundary stops anything in between, and
  // the first of the ones Wingman ships can be moved above a party's own.
  expect(
    screen.getByRole("button", { name: "Move Second Voice up" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Move Karaoke Hero down" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Move First Time on the Mic up" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Move Brave Soul down" }),
  ).toBeDisabled();
});

it("moves a row past the ones Wingman ships", async () => {
  const rows = catalogue();
  const { container } = renderPage(rows);
  reorderAchievements.mockResolvedValue({
    data: { achievements: rows, settings: achievementSettings() },
  });

  fireEvent.click(
    await screen.findByRole("button", { name: "Arrange the order" }),
  );
  // The last of the party's own rows, moved under the first shipped one: the
  // two are in one order, so nothing holds it back.
  fireEvent.click(
    screen.getByRole("button", { name: "Move Second Voice down" }),
  );

  await waitFor(() => expect(reorderAchievements).toHaveBeenCalled());
  expect(reorderAchievements.mock.calls[0][0].body.ids.slice(0, 3)).toEqual([
    "a-own",
    "builtin-first-song",
    "a-second",
  ]);
  expect(names(container).slice(0, 3)).toEqual([
    "Karaoke Hero",
    "First Time on the Mic",
    "Second Voice",
  ]);
});

it("keeps the keyboard on the arrow a move was made with", async () => {
  const rows = catalogue();
  renderPage(rows);
  reorderAchievements.mockResolvedValue({
    data: { achievements: rows, settings: achievementSettings() },
  });

  fireEvent.click(
    await screen.findByRole("button", { name: "Arrange the order" }),
  );
  const down = screen.getByRole("button", { name: "Move Second Voice down" });
  down.focus();
  fireEvent.click(down);

  // The row's own node moves and both its arrows are disabled while the order
  // is saved, and neither a moved nor a disabled control keeps the focus — so
  // without putting it back, a reader arranging by keyboard is dropped at the
  // top of the page after every press.
  await waitFor(() => expect(reorderAchievements).toHaveBeenCalled());
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Move Second Voice down" }),
    ).toBeEnabled(),
  );
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Move Second Voice down" }),
  );
});

it("leaves the focus where the reader took it while a move was saving", async () => {
  const rows = catalogue();
  renderPage(rows);
  reorderAchievements.mockResolvedValue({
    data: { achievements: rows, settings: achievementSettings() },
  });

  fireEvent.click(
    await screen.findByRole("button", { name: "Arrange the order" }),
  );
  const down = screen.getByRole("button", { name: "Move Second Voice down" });
  down.focus();
  fireEvent.click(down);
  // Somewhere else, by hand, before the answer lands.
  const done = screen.getByRole("button", { name: "Done arranging" });
  done.focus();

  await waitFor(() => expect(reorderAchievements).toHaveBeenCalled());
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Move Second Voice down" }),
    ).toBeEnabled(),
  );
  expect(document.activeElement).toBe(done);
});

it("hands the keyboard the other arrow when a move uses one up", async () => {
  const rows = catalogue();
  renderPage(rows);
  reorderAchievements.mockResolvedValue({
    data: { achievements: rows, settings: achievementSettings() },
  });

  fireEvent.click(
    await screen.findByRole("button", { name: "Arrange the order" }),
  );
  const up = screen.getByRole("button", { name: "Move Second Voice up" });
  up.focus();
  fireEvent.click(up);

  // It now leads the list, so the arrow that got it there is disabled for
  // good. The focus goes to the row's other one rather than nowhere.
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Move Second Voice up" }),
    ).toBeDisabled(),
  );
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Move Second Voice down" }),
  );
});

it("holds the order the backend answered with", async () => {
  const rows = catalogue();
  const { container } = renderPage(rows);
  // The answer is the managing listing, and it is what the page keeps: the
  // listing mock still hands back the old order, so a page that asked again —
  // or that only waited for the socket — would snap back to it.
  reorderAchievements.mockResolvedValue({
    data: {
      achievements: [rows[1], rows[0], ...rows.slice(2)],
      settings: achievementSettings(),
    },
  });

  fireEvent.click(
    await screen.findByRole("button", { name: "Arrange the order" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Move Karaoke Hero down" }),
  );
  await waitFor(() => expect(reorderAchievements).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Done arranging" }));

  expect(names(container).slice(0, 2)).toEqual([
    "Second Voice",
    "Karaoke Hero",
  ]);
});

it("leaves the rows alone until the order is arranged", async () => {
  const { container } = renderPage(catalogue());

  await screen.findByText("Karaoke Hero");
  expect(
    screen.queryByRole("button", { name: "Move Karaoke Hero down" }),
  ).not.toBeInTheDocument();
  expect(container.querySelector(".achievements-drag")).toBeNull();

  const arrange = screen.getByRole("button", { name: "Arrange the order" });
  expect(arrange).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(arrange);

  // The grip per row, and the mode says what it is for once.
  expect(container.querySelectorAll(".achievements-drag")).toHaveLength(19);
  expect(screen.getByText(/Drag a row, or use its arrows/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Done arranging" }),
  ).toHaveAttribute("aria-pressed", "true");

  fireEvent.click(screen.getByRole("button", { name: "Done arranging" }));
  expect(container.querySelector(".achievements-drag")).toBeNull();
});

/** The names of the catalogue's rows, in the order they are drawn. */
function names(container: HTMLElement): (string | undefined)[] {
  return listRows(container).map(
    (row) => row.querySelector(".achievements-name")?.textContent ?? undefined,
  );
}

it("puts the rows back when the new order is refused", async () => {
  const { container } = renderPage(catalogue());
  reorderAchievements.mockRejectedValue({ detail: "something else" });

  fireEvent.click(
    await screen.findByRole("button", { name: "Arrange the order" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Move Karaoke Hero down" }),
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not save the new order.",
  );
  expect(names(container).slice(0, 2)).toEqual([
    "Karaoke Hero",
    "Second Voice",
  ]);
});

it("says the catalogue moved when the order no longer fits it", async () => {
  const { container } = renderPage(catalogue());
  reorderAchievements.mockRejectedValue({ detail: "order_mismatch" });

  fireEvent.click(
    await screen.findByRole("button", { name: "Arrange the order" }),
  );
  const asked = listAchievements.mock.calls.length;
  fireEvent.click(
    screen.getByRole("button", { name: "Move Karaoke Hero down" }),
  );

  // Somebody else created, imported or deleted one while this page held the old
  // list: not the host's mistake, so the notice says what happened.
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The achievements changed somewhere else",
  );
  expect(names(container).slice(0, 2)).toEqual([
    "Karaoke Hero",
    "Second Voice",
  ]);
  // And the catalogue is asked for again, or every further gesture is refused
  // for the same stale reason and the mode never recovers.
  await waitFor(() =>
    expect(listAchievements.mock.calls.length).toBeGreaterThan(asked),
  );
});

it("puts the rows back when a dragged order is refused", async () => {
  const { container } = renderPage(catalogue());
  reorderAchievements.mockRejectedValue({ detail: "something else" });

  fireEvent.click(
    await screen.findByRole("button", { name: "Arrange the order" }),
  );
  const list = container.querySelector(".achievements-list")!;
  layOutRows(list);
  const grip = list.querySelector<HTMLElement>(".achievements-drag");

  // A drag rearranges the rows as the finger crosses them and saves once, at
  // the end — so what a refusal has to go back to is the order the server still
  // holds. "The order before this move" is the move that was just refused.
  fireEvent.pointerDown(grip as HTMLElement, { pointerId: 1 });
  dragTo(grip as HTMLElement, 100);
  expect(names(container).slice(0, 2)).toEqual([
    "Second Voice",
    "Karaoke Hero",
  ]);
  fireEvent.pointerUp(grip as HTMLElement, { pointerId: 1 });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not save the new order.",
  );
  expect(names(container).slice(0, 2)).toEqual([
    "Karaoke Hero",
    "Second Voice",
  ]);
  expect(reorderAchievements).toHaveBeenCalledTimes(1);
});

it("starts no second gesture while an order is still in flight", async () => {
  const { container } = renderPage(catalogue());
  // Never answers: the moment between a gesture and its answer, held open.
  reorderAchievements.mockReturnValue(new Promise(() => {}));

  fireEvent.click(
    await screen.findByRole("button", { name: "Arrange the order" }),
  );
  const list = container.querySelector(".achievements-list")!;
  const grip = () => list.querySelector<HTMLElement>(".achievements-drag")!;

  // One gesture, and its answer never comes.
  layOutRows(list);
  fireEvent.pointerDown(grip(), { pointerId: 1 });
  dragTo(grip(), 100);
  fireEvent.pointerUp(grip(), { pointerId: 1 });
  await waitFor(() => expect(reorderAchievements).toHaveBeenCalledTimes(1));
  expect(names(container).slice(0, 2)).toEqual([
    "Second Voice",
    "Karaoke Hero",
  ]);

  // The arrows are disabled for this moment; so is the grip, or a second
  // gesture's order and this one's can land in either sequence and the loser is
  // what the catalogue keeps.
  expect(
    screen.getByRole("button", { name: "Move Second Voice down" }),
  ).toBeDisabled();
  layOutRows(list);
  fireEvent.pointerDown(grip(), { pointerId: 2 });
  dragTo(grip(), 100);
  fireEvent.pointerUp(grip(), { pointerId: 2 });

  // Nothing moved and nothing went out — the rows are where the first gesture
  // left them.
  expect(names(container).slice(0, 2)).toEqual([
    "Second Voice",
    "Karaoke Hero",
  ]);
  expect(reorderAchievements).toHaveBeenCalledTimes(1);
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
