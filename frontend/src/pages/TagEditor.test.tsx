import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type {
  BuiltInTagRead,
  MeRead,
  TagPermissionRead,
  TagRead,
  TagRuleKindRead,
} from "../api";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import {
  builtInTagRead,
  builtInTagReads,
  ruleKindReads,
  tagRead,
} from "../test/tags";
import TagEditor from "./TagEditor";

const {
  getMe,
  listTags,
  listTagRules,
  createTag,
  updateTag,
  replaceTagPermissions,
  deleteTag,
  lookupUsers,
  updateBuiltInTag,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  listTags: vi.fn(),
  listTagRules: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  replaceTagPermissions: vi.fn(),
  deleteTag: vi.fn(),
  lookupUsers: vi.fn(),
  updateBuiltInTag: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listTags,
  listTagRules,
  createTag,
  updateTag,
  replaceTagPermissions,
  deleteTag,
  lookupUsers,
  updateBuiltInTag,
}));

const MANAGER = ["songs.view", "tags.manage"];
const ACCOUNT: Partial<MeRead> = { user: userRead(), role: "trusted" };

/** Everybody may see the tag and its songs — the shape the editor's own default
 *  for a new tag has, spelled out in `NEW_TAG_GRANTS` and copied from no row. */
function roleRows(): TagPermissionRead[] {
  return (["guest", "user", "trusted"] as const).flatMap((role) => [
    { action: "view" as const, role, user_id: null, username: null },
    { action: "view_songs" as const, role, user_id: null, username: null },
  ]);
}

function tag(overrides: Partial<TagRead> = {}): TagRead {
  return tagRead({
    id: "t1",
    name: "broken",
    icon: "alert",
    color: "gold",
    show_in_list: true,
    hide_by_default: true,
    permissions: [
      ...roleRows(),
      { action: "assign", role: "trusted", user_id: null, username: null },
    ],
    ...overrides,
  });
}

/** Where a create or a delete has taken the reader. */
function Probe() {
  return <p>at {useLocation().pathname}</p>;
}

function renderEditor({
  path = "/user/tags/t1",
  tags = [tag({ song_count: 2 })],
  capabilities = MANAGER,
  builtIns = builtInTagReads(),
  rules = ruleKindReads(),
}: {
  path?: string;
  tags?: TagRead[];
  capabilities?: string[];
  builtIns?: BuiltInTagRead[];
  rules?: TagRuleKindRead[];
} = {}) {
  getMe.mockResolvedValue(meResponse(capabilities, ACCOUNT));
  listTags.mockResolvedValue({ data: { tags, built_ins: builtIns } });
  listTagRules.mockResolvedValue({ data: { rules } });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/user/tags" element={<p>the tag list</p>} />
          <Route path="/user/tags/new" element={<TagEditor />} />
          <Route path="/user/tags/:tagId" element={<TagEditor />} />
        </Routes>
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The classes on one picker cell's glyph. The colour rides on the `<svg>`
 *  rather than on the button, so that the cell's hover cannot repaint it — so
 *  that is where a test has to look for it. */
function glyphClass(label: string): string {
  return (
    screen.getByLabelText(label).querySelector("svg")?.getAttribute("class") ??
    ""
  );
}

/** A permissions body, as a sorted set of `action role|user` strings — the
 *  order the rows go out in is not part of the contract. */
function sentRows(body: { permissions: unknown[] }): string[] {
  return (
    body.permissions as {
      action: string;
      role?: string;
      user_id?: string;
    }[]
  )
    .map((row) => `${row.action} ${row.role ?? row.user_id}`)
    .sort();
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  for (const mock of [
    getMe,
    listTags,
    listTagRules,
    createTag,
    updateTag,
    replaceTagPermissions,
    deleteTag,
    lookupUsers,
    updateBuiltInTag,
  ])
    mock.mockReset();
});

afterEach(() => {
  // Whatever a test did with the clock, the next one starts on the real one:
  // a leaked fake timer turns every later `waitFor` into a five-second wait.
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps the editor from a role that may not manage tags", async () => {
  renderEditor({ capabilities: ["songs.view"] });

  expect(
    await screen.findByText(/Tags are set up by trusted accounts/),
  ).toBeInTheDocument();
  expect(listTags).not.toHaveBeenCalled();
});

it("says so when the tag is not in the listing", async () => {
  renderEditor({ tags: [] });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This tag is gone.",
  );
});

it("seeds the form from the tag it is editing", async () => {
  renderEditor();

  expect(await screen.findByDisplayValue("broken")).toBeInTheDocument();
  expect(screen.getByLabelText("Show in song list")).toBeChecked();
  expect(screen.getByLabelText("Hide songs by default")).toBeChecked();
  expect(screen.getByLabelText("Gold")).toBeChecked();
  expect(screen.getByLabelText("alert")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByLabelText("See tag for guest")).toBeChecked();
  expect(screen.getByLabelText("Tag songs for guest")).not.toBeChecked();
  expect(screen.getByLabelText("Tag songs for trusted")).toBeChecked();
  // Nothing to send yet.
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

it("creates a tag with the rights the form was left on", async () => {
  createTag.mockResolvedValue({ data: tag({ id: "t-new", name: "duet" }) });
  renderEditor({ path: "/user/tags/new", tags: [] });

  await screen.findByLabelText("Name");
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "  duet  " },
  });
  fireEvent.click(screen.getByLabelText("music"));
  fireEvent.click(screen.getByLabelText("Blue"));
  fireEvent.click(screen.getByLabelText("Show in song list"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(createTag).toHaveBeenCalled());
  const body = createTag.mock.calls[0][0].body;
  expect(body).toMatchObject({
    name: "duet",
    icon: "music",
    color: "blue",
    show_in_list: true,
    hide_by_default: false,
  });
  // A fresh tag opens on `NEW_TAG_GRANTS` — its own constant, not a copy of any
  // existing tag: the listing above is empty and the rows are still these, so
  // the manager who made it can still see it.
  expect(sentRows(body)).toEqual([
    "assign trusted",
    "view guest",
    "view trusted",
    "view user",
    "view_songs guest",
    "view_songs trusted",
    "view_songs user",
  ]);
  expect(await screen.findByText("at /user/tags/t-new")).toBeInTheDocument();
});

it("sends only the fields that changed, and no permissions", async () => {
  updateTag.mockResolvedValue({ data: tag({ name: "cursed" }) });
  renderEditor();

  await screen.findByDisplayValue("broken");
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "cursed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(updateTag).toHaveBeenCalled());
  expect(updateTag.mock.calls[0][0].body).toEqual({ name: "cursed" });
  expect(replaceTagPermissions).not.toHaveBeenCalled();
  expect(await screen.findByText("Saved")).toBeInTheDocument();
});

it("clears an icon with an explicit null and touches nothing else", async () => {
  updateTag.mockResolvedValue({ data: tag({ icon: null }) });
  renderEditor();

  await screen.findByDisplayValue("broken");
  fireEvent.click(screen.getByLabelText("No icon"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(updateTag).toHaveBeenCalled());
  const body = updateTag.mock.calls[0][0].body;
  expect(body).toEqual({ icon: null });
  expect(Object.keys(body)).toEqual(["icon"]);
});

it("greys the offered glyphs and paints only the chosen one", async () => {
  renderEditor();

  await screen.findByDisplayValue("broken");
  // The tag is gold, so the cell it is on wears gold and every other cell is
  // left to the idle `--color-dark` of any `.icon-button`.
  expect(glyphClass("alert")).toBe("icon tag-color-gold");
  expect(glyphClass("music")).toBe("icon");
  expect(glyphClass("flame")).toBe("icon");
});

it("moves the chosen glyph's colour with the colour pills", async () => {
  renderEditor();

  await screen.findByDisplayValue("broken");
  fireEvent.click(screen.getByLabelText("Blue"));

  expect(glyphClass("alert")).toBe("icon tag-color-blue");
  // And it follows the choice, not the cell it started on.
  fireEvent.click(screen.getByLabelText("flame"));
  expect(glyphClass("flame")).toBe("icon tag-color-blue");
  expect(glyphClass("alert")).toBe("icon");
});

it("keeps the 'no icon' cell quiet even when it is the chosen one", async () => {
  renderEditor();

  await screen.findByDisplayValue("broken");
  fireEvent.click(screen.getByLabelText("No icon"));

  expect(screen.getByLabelText("No icon")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // A control, not a preview: it never takes the tag's colour.
  expect(glyphClass("No icon")).toBe("icon");
  expect(glyphClass("alert")).toBe("icon");
});

it("keeps a glyph the picker no longer offers choosable for its own tag", async () => {
  renderEditor({ tags: [tag({ icon: "gear" })] });

  await screen.findByDisplayValue("broken");
  const cells = screen
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label"));
  // Appended after the allowlist, for this tag alone.
  expect(cells).toContain("gear");
  expect(cells.indexOf("gear")).toBeGreaterThan(cells.indexOf("skull"));
  expect(screen.getByLabelText("gear")).toHaveAttribute("aria-pressed", "true");
  expect(glyphClass("gear")).toBe("icon tag-color-gold");
  // And it is the gear itself, not the `tag` fallback an unknown name gets.
  expect(iconNames(screen.getByLabelText("gear"))).toEqual(["gear"]);

  // Trying another glyph must not take the cell the reader came in on away.
  fireEvent.click(screen.getByLabelText("flame"));
  expect(screen.getByLabelText("gear")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  fireEvent.click(screen.getByLabelText("gear"));
  expect(screen.getByLabelText("gear")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

it("keeps a name this build has no glyph for chosen, drawn as the tag itself", async () => {
  // The backend only checks the shape of an icon name, so a tag can carry one
  // this frontend cannot draw. Its cell still says which name that is.
  renderEditor({ tags: [tag({ icon: "sparkles" })] });

  await screen.findByDisplayValue("broken");
  expect(screen.getByLabelText("sparkles")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(iconNames(screen.getByLabelText("sparkles"))).toEqual(["tag"]);
  expect(glyphClass("sparkles")).toBe("icon tag-color-gold");
});

it("replaces the permissions when a box in the matrix moves", async () => {
  replaceTagPermissions.mockResolvedValue({ data: tag() });
  renderEditor();

  await screen.findByDisplayValue("broken");
  fireEvent.click(screen.getByLabelText("Tag songs for user"));
  fireEvent.click(screen.getByLabelText("See tag for guest"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(replaceTagPermissions).toHaveBeenCalled());
  expect(updateTag).not.toHaveBeenCalled();
  expect(sentRows(replaceTagPermissions.mock.calls[0][0].body)).toEqual([
    "assign trusted",
    "assign user",
    "view trusted",
    "view user",
    "view_songs guest",
    "view_songs trusted",
    "view_songs user",
  ]);
});

it("keeps rows for subjects the matrix has no column for", async () => {
  replaceTagPermissions.mockResolvedValue({ data: tag() });
  renderEditor({
    tags: [
      tag({
        permissions: [
          ...roleRows(),
          // A role the table does not draw; a PUT that dropped it would take
          // the grant away without anybody asking.
          { action: "view", role: "curator", user_id: null, username: null },
        ],
      }),
    ],
  });

  await screen.findByDisplayValue("broken");
  fireEvent.click(screen.getByLabelText("Tag songs for trusted"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(replaceTagPermissions).toHaveBeenCalled());
  expect(sentRows(replaceTagPermissions.mock.calls[0][0].body)).toContain(
    "view curator",
  );
});

it("drops a row that names nobody rather than sending it back", async () => {
  replaceTagPermissions.mockResolvedValue({ data: tag() });
  renderEditor({
    tags: [
      tag({
        permissions: [
          ...roleRows(),
          // The API refuses a row without a subject, and it would refuse the
          // whole PUT with it — every other grant on the tag included.
          { action: "view", role: null, user_id: null, username: null },
        ],
      }),
    ],
  });

  await screen.findByDisplayValue("broken");
  fireEvent.click(screen.getByLabelText("Tag songs for trusted"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(replaceTagPermissions).toHaveBeenCalled());
  const rows = replaceTagPermissions.mock.calls[0][0].body.permissions as {
    role?: string | null;
    user_id?: string | null;
  }[];
  expect(
    rows.every(
      (row) => (row.role ?? null) !== null || (row.user_id ?? null) !== null,
    ),
  ).toBe(true);
});

it("adds a person through the search and gives them their rights", async () => {
  replaceTagPermissions.mockResolvedValue({ data: tag() });
  lookupUsers.mockResolvedValue({
    data: {
      users: [
        { id: "u-bob", username: "Bob", player_id: "bbb", avatar_version: 1 },
      ],
    },
  });
  renderEditor();

  await screen.findByDisplayValue("broken");
  fireEvent.change(screen.getByLabelText("Add people"), {
    target: { value: "Bo" },
  });
  fireEvent.click(await screen.findByLabelText("Add Bob"));

  // Added with the one right that makes the row mean anything at all.
  expect(screen.getByLabelText("See tag for Bob")).toBeChecked();
  expect(screen.getByLabelText("See songs for Bob")).not.toBeChecked();
  fireEvent.click(screen.getByLabelText("See songs for Bob"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(replaceTagPermissions).toHaveBeenCalled());
  const rows = sentRows(replaceTagPermissions.mock.calls[0][0].body);
  expect(rows).toContain("view u-bob");
  expect(rows).toContain("view_songs u-bob");
});

it("drops every right of a person who is removed", async () => {
  replaceTagPermissions.mockResolvedValue({ data: tag() });
  renderEditor({
    tags: [
      tag({
        permissions: [
          ...roleRows(),
          { action: "view", role: null, user_id: "u-bob", username: "Bob" },
          {
            action: "view_songs",
            role: null,
            user_id: "u-bob",
            username: "Bob",
          },
        ],
      }),
    ],
  });

  await screen.findByDisplayValue("broken");
  expect(screen.getByText("Bob")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Remove Bob"));
  expect(screen.queryByText("Bob")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(replaceTagPermissions).toHaveBeenCalled());
  expect(sentRows(replaceTagPermissions.mock.calls[0][0].body)).not.toContain(
    "view u-bob",
  );
});

it("warns about a tagger who would not see what they tagged", async () => {
  renderEditor();

  await screen.findByDisplayValue("broken");
  expect(screen.queryByText(/could not undo it/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByLabelText("See songs for trusted"));
  expect(await screen.findByText(/Trusted may tag songs/)).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText("See songs for trusted"));
  await waitFor(() =>
    expect(screen.queryByText(/may tag songs without/)).not.toBeInTheDocument(),
  );
});

it("warns about a filter that can never have anything in it", async () => {
  renderEditor();

  await screen.findByDisplayValue("broken");
  expect(screen.queryByText(/always empty/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByLabelText("See songs for guest"));
  expect(await screen.findByText(/Guest may see the tag/)).toHaveTextContent(
    "always empty",
  );

  fireEvent.click(screen.getByLabelText("See tag for guest"));
  await waitFor(() =>
    expect(screen.queryByText(/always empty/)).not.toBeInTheDocument(),
  );
});

it("explains a name another tag already has", async () => {
  updateTag.mockRejectedValue({ detail: "duplicate_tag_name" });
  renderEditor();

  await screen.findByDisplayValue("broken");
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "archive" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    'A tag called "archive" already exists.',
  );
});

it("names the songs that lose the tag before deleting it", async () => {
  deleteTag.mockResolvedValue({ data: undefined });
  renderEditor();

  await screen.findByDisplayValue("broken");
  fireEvent.click(screen.getByRole("button", { name: "Delete tag" }));
  expect(
    screen.getByText(/It comes off the 2 songs carrying it/),
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  await waitFor(() => expect(deleteTag).toHaveBeenCalled());
  expect(deleteTag.mock.calls[0][0].path).toEqual({ tag_id: "t1" });
  expect(await screen.findByText("at /user/tags")).toBeInTheDocument();
});

it("does not count zero songs at the reader when deleting", async () => {
  renderEditor({ tags: [tag()] });

  await screen.findByDisplayValue("broken");
  fireEvent.click(screen.getByRole("button", { name: "Delete tag" }));

  expect(screen.getByText(/No song carries it/)).toBeInTheDocument();
  expect(screen.queryByText(/the 0 songs/)).not.toBeInTheDocument();
});

it("offers no delete for a tag that does not exist yet", async () => {
  renderEditor({ path: "/user/tags/new", tags: [] });

  await screen.findByLabelText("Name");
  expect(
    screen.queryByRole("button", { name: "Delete tag" }),
  ).not.toBeInTheDocument();
});

// --- automatic tags --------------------------------------------------------

/** The rule select's options, in the order it offers them. */
function ruleOptions(): string[] {
  return [...screen.getByLabelText("Rule").querySelectorAll("option")].map(
    (option) => option.textContent ?? "",
  );
}

/** The confirmation, whose confirm button says "Save" like the form's own. */
function dialog() {
  return within(screen.getByRole("dialog"));
}

it("offers every rule the registry lists, and 'not automatic' first", async () => {
  renderEditor();

  await screen.findByDisplayValue("broken");
  await waitFor(() =>
    expect(ruleOptions()).toEqual([
      "Not automatic",
      "Duet",
      "Has video",
      "Language is…",
      "Genre is…",
      "Edition is…",
    ]),
  );
  // A manual tag opens on the first one, and asks for nothing to compare.
  expect(screen.getByLabelText("Rule")).toHaveValue("");
  expect(screen.queryByLabelText("Value")).not.toBeInTheDocument();
});

it("asks for a value only where the rule needs one, and suggests the library's", async () => {
  renderEditor();

  await screen.findByDisplayValue("broken");
  fireEvent.change(screen.getByLabelText("Rule"), {
    target: { value: "duet" },
  });
  expect(screen.queryByLabelText("Value")).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Rule"), {
    target: { value: "language" },
  });
  const value = screen.getByLabelText("Value");
  expect(value).toBeInTheDocument();
  // A suggestion, not a choice: the input takes anything, and the list is the
  // languages this library happens to hold.
  const list = document.getElementById(value.getAttribute("list") ?? "");
  expect(
    [...(list?.querySelectorAll("option") ?? [])].map((option) => option.value),
  ).toEqual(["Deutsch", "English"]);
});

it("sends the rule a new tag was given", async () => {
  createTag.mockResolvedValue({ data: tag({ id: "t-new", name: "deutsch" }) });
  renderEditor({ path: "/user/tags/new", tags: [] });

  await screen.findByLabelText("Name");
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "deutsch" },
  });
  fireEvent.change(screen.getByLabelText("Rule"), {
    target: { value: "language" },
  });
  fireEvent.change(screen.getByLabelText("Value"), {
    target: { value: "  Deutsch  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(createTag).toHaveBeenCalled());
  expect(createTag.mock.calls[0][0].body.rule).toEqual({
    kind: "language",
    value: "Deutsch",
  });
  // A tag that has never had a song has nothing to lose, so nothing was asked.
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("waits for a value the rule cannot do without", async () => {
  renderEditor({ path: "/user/tags/new", tags: [] });

  await screen.findByLabelText("Name");
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "editions" },
  });
  fireEvent.change(screen.getByLabelText("Rule"), {
    target: { value: "edition" },
  });

  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Value"), {
    target: { value: "Party" },
  });
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});

it("never sends a value with a rule that has nothing to compare", async () => {
  createTag.mockResolvedValue({ data: tag({ id: "t-new", name: "duets" }) });
  renderEditor({ path: "/user/tags/new", tags: [] });

  await screen.findByLabelText("Name");
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "duets" },
  });
  fireEvent.change(screen.getByLabelText("Rule"), {
    target: { value: "language" },
  });
  fireEvent.change(screen.getByLabelText("Value"), {
    target: { value: "English" },
  });
  // Changed its mind: the input is gone, and what was in it must go with it —
  // the backend refuses a value on a rule that compares nothing.
  fireEvent.change(screen.getByLabelText("Rule"), {
    target: { value: "duet" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(createTag).toHaveBeenCalled());
  expect(createTag.mock.calls[0][0].body.rule).toEqual({
    kind: "duet",
    value: null,
  });
});

it("leaves the assign ticks standing but nobody's while a rule is on", async () => {
  renderEditor({
    tags: [tag({ song_count: 0, rule: { kind: "duet", value: null } })],
  });

  await screen.findByDisplayValue("broken");
  // Still ticked — the permission rows survive the rule, so taking it off
  // gives the tag back to the same people.
  expect(screen.getByLabelText("Tag songs for trusted")).toBeChecked();
  expect(screen.getByLabelText("Tag songs for trusted")).toBeDisabled();
  expect(screen.getByLabelText("Tag songs for guest")).toBeDisabled();
  expect(screen.getByLabelText("See tag for guest")).toBeEnabled();
  expect(
    screen.getByText(/Tag songs is nobody's while it is automatic/),
  ).toBeInTheDocument();

  // Back to manual and the ticks are ticks again.
  fireEvent.change(screen.getByLabelText("Rule"), { target: { value: "" } });
  expect(screen.getByLabelText("Tag songs for trusted")).toBeEnabled();
});

it("warns before a rule takes over the songs somebody set by hand", async () => {
  updateTag.mockResolvedValue({
    data: tag({ rule: { kind: "duet", value: null } }),
  });
  renderEditor();

  await screen.findByDisplayValue("broken");
  fireEvent.change(screen.getByLabelText("Rule"), {
    target: { value: "duet" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(
    screen.getByText(/The 2 songs carrying it lose their hand-set tag/),
  ).toBeInTheDocument();
  expect(updateTag).not.toHaveBeenCalled();

  fireEvent.click(dialog().getByRole("button", { name: "Save" }));
  await waitFor(() => expect(updateTag).toHaveBeenCalled());
  expect(updateTag.mock.calls[0][0].body).toEqual({
    rule: { kind: "duet", value: null },
  });
});

it("says a changed rule is re-derived, and a removed one empties the tag", async () => {
  updateTag.mockResolvedValue({ data: tag() });
  renderEditor({
    tags: [
      tag({ song_count: 3, rule: { kind: "language", value: "English" } }),
    ],
  });

  await screen.findByDisplayValue("broken");
  fireEvent.change(screen.getByLabelText("Value"), {
    target: { value: "Deutsch" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByText(/Its 3 songs are re-derived/)).toBeInTheDocument();
  fireEvent.click(dialog().getByRole("button", { name: "Cancel" }));
  // Cancel is not a save: nothing went, and the draft is still the reader's.
  expect(updateTag).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Value")).toHaveValue("Deutsch");
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();

  fireEvent.change(screen.getByLabelText("Rule"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(
    screen.getByText(/the tag comes off them all and starts empty/),
  ).toBeInTheDocument();

  fireEvent.click(dialog().getByRole("button", { name: "Save" }));
  await waitFor(() => expect(updateTag).toHaveBeenCalled());
  expect(updateTag.mock.calls[0][0].body).toEqual({ rule: null });
});

it("counts a single song in the singular", async () => {
  renderEditor({ tags: [tag({ song_count: 1 })] });

  await screen.findByDisplayValue("broken");
  fireEvent.change(screen.getByLabelText("Rule"), {
    target: { value: "duet" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(
    screen.getByText(/The one song carrying it loses its hand-set tag/),
  ).toBeInTheDocument();
});

it("asks nothing when the rule costs the tag no songs", async () => {
  updateTag.mockResolvedValue({
    data: tag({ rule: { kind: "has_video", value: null } }),
  });
  renderEditor({ tags: [tag({ song_count: 0 })] });

  await screen.findByDisplayValue("broken");
  fireEvent.change(screen.getByLabelText("Rule"), {
    target: { value: "has_video" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(updateTag).toHaveBeenCalled());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps a rule kind this build does not know rather than dropping it", async () => {
  updateTag.mockResolvedValue({ data: tag({ name: "cursed" }) });
  renderEditor({
    tags: [
      tag({ song_count: 2, rule: { kind: "year_between", value: "1990" } }),
    ],
  });

  await screen.findByDisplayValue("broken");
  await waitFor(() => expect(ruleOptions()).toContain("year_between"));
  // Shown, so the editor says what the tag follows; disabled, so it cannot be
  // chosen for another tag.
  expect(screen.getByLabelText("Rule")).toHaveValue("year_between");
  expect(screen.getByRole("option", { name: "year_between" })).toBeDisabled();
  expect(screen.getByLabelText("Value")).toHaveValue("1990");

  // Saving something else does not mention the rule at all, so the backend
  // leaves it — and the songs under it — alone.
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "cursed" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(updateTag).toHaveBeenCalled());
  expect(updateTag.mock.calls[0][0].body).toEqual({ name: "cursed" });
});

it("freezes the value of a rule kind it cannot send back", async () => {
  renderEditor({
    tags: [
      tag({ song_count: 2, rule: { kind: "year_between", value: "1990" } }),
    ],
  });

  await screen.findByDisplayValue("broken");
  await waitFor(() => expect(ruleOptions()).toContain("year_between"));
  // The listing comes from the very backend a save would go to, so a kind it
  // does not offer is a kind that save would refuse: editing the value could
  // only ever end in a 422.
  expect(screen.getByLabelText("Value")).toBeDisabled();

  // A rule this build does know unfreezes it again, the text still there.
  fireEvent.change(screen.getByLabelText("Rule"), {
    target: { value: "language" },
  });
  expect(screen.getByLabelText("Value")).toBeEnabled();
  expect(screen.getByLabelText("Value")).toHaveValue("1990");
});

it("says why Save is off while a rule has nothing to compare against", async () => {
  renderEditor({ path: "/user/tags/new", tags: [] });

  await screen.findByLabelText("Name");
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "editions" },
  });
  fireEvent.change(screen.getByLabelText("Rule"), {
    target: { value: "edition" },
  });

  // A dead button without a reason is not a refusal the reader can act on.
  const hint = screen.getByText(/Save waits for this/);
  expect(screen.getByLabelText("Value")).toHaveAttribute(
    "aria-describedby",
    hint.id,
  );
  // Spaces are not a value either — the backend trims before it compares.
  fireEvent.change(screen.getByLabelText("Value"), { target: { value: "  " } });
  expect(screen.getByText(/Save waits for this/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  fireEvent.change(screen.getByLabelText("Value"), {
    target: { value: "Party" },
  });
  expect(screen.queryByText(/Save waits for this/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});

it("keeps the value when the kind moves from one value rule to another", async () => {
  renderEditor({
    tags: [
      tag({ song_count: 3, rule: { kind: "language", value: "English" } }),
    ],
  });

  await screen.findByDisplayValue("broken");
  fireEvent.change(screen.getByLabelText("Rule"), {
    target: { value: "genre" },
  });
  // Two rules over the same word: retyping it would be the editor forgetting
  // what the reader just told it.
  expect(screen.getByLabelText("Value")).toHaveValue("English");
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});

it("asks for nothing when a rule comes back to where it started", async () => {
  renderEditor({
    tags: [
      tag({ song_count: 3, rule: { kind: "language", value: "English" } }),
    ],
  });

  await screen.findByDisplayValue("broken");
  fireEvent.change(screen.getByLabelText("Rule"), {
    target: { value: "genre" },
  });
  fireEvent.change(screen.getByLabelText("Rule"), {
    target: { value: "language" },
  });

  // Back where it was: nothing to send, so nothing to confirm either.
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  // Even submitted around the dead button, it neither asks nor sends.
  const [form] = document.getElementsByTagName("form");
  fireEvent.submit(form);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(updateTag).not.toHaveBeenCalled();
});

it("sends the assign rows a rule made nobody's, untouched", async () => {
  replaceTagPermissions.mockResolvedValue({ data: tag() });
  renderEditor({
    tags: [tag({ song_count: 0, rule: { kind: "duet", value: null } })],
  });

  await screen.findByDisplayValue("broken");
  expect(screen.getByLabelText("Tag songs for trusted")).toBeDisabled();
  // Something else moves, so the permissions go out — and the greyed tick has
  // to be in them, or an automatic tag would quietly lose its grants.
  fireEvent.click(screen.getByLabelText("See tag for guest"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(replaceTagPermissions).toHaveBeenCalled());
  expect(sentRows(replaceTagPermissions.mock.calls[0][0].body)).toContain(
    "assign trusted",
  );
});

// --- the built-in marks ---------------------------------------------------

it("opens a built-in on two controls and nothing else", async () => {
  renderEditor({ path: "/user/tags/favorites" });

  expect(
    await screen.findByRole("radiogroup", { name: "Colour" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Favorites" }),
  ).toBeInTheDocument();
  // A colour, a flag, Save — and none of what belongs to a `tags` row.
  expect(
    screen.getByRole("radiogroup", { name: "Colour" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("checkbox", { name: "Show in song list" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Icon" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("checkbox", { name: "Hide songs by default" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Permissions" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Delete tag" }),
  ).not.toBeInTheDocument();
  // And one line saying why there is nothing else.
  expect(
    screen.getByText(/Favorites are one person's own/),
  ).toBeInTheDocument();
});

it("draws the colour pills of a built-in with its own glyph", async () => {
  renderEditor({
    path: "/user/tags/sung",
    builtIns: [
      builtInTagRead(),
      builtInTagRead({ id: "sung", color: "gold", show_in_list: false }),
    ],
  });

  await screen.findByRole("radiogroup", { name: "Colour" });
  expect(screen.getByRole("radio", { name: /Gold/ })).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Show in song list" }),
  ).not.toBeChecked();
  // Every pill previews the mark itself, never the tag glyph.
  expect(iconNames(screen.getByRole("radiogroup", { name: "Colour" }))).toEqual(
    ["mic", "mic", "mic", "mic"],
  );
});

it("saves a built-in's colour and flag together", async () => {
  updateBuiltInTag.mockResolvedValue({
    data: { id: "favorites", color: "gold", show_in_list: false },
  });
  renderEditor({ path: "/user/tags/favorites" });

  await screen.findByRole("radiogroup", { name: "Colour" });
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: /Gold/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Show in song list" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(updateBuiltInTag).toHaveBeenCalled());
  expect(updateBuiltInTag.mock.calls[0][0]).toMatchObject({
    path: { built_in_id: "favorites" },
    body: { color: "gold", show_in_list: false },
  });
  expect(await screen.findByText("Saved")).toBeInTheDocument();
  // Back on the answer, so there is nothing left to save.
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

it("says so when a built-in cannot be saved", async () => {
  updateBuiltInTag.mockRejectedValue(new Error("nope"));
  renderEditor({ path: "/user/tags/sung" });

  await screen.findByRole("radiogroup", { name: "Colour" });
  fireEvent.click(screen.getByRole("radio", { name: /Neutral/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not save the mark.",
  );
});

it("keeps a built-in from a role that may not manage tags", async () => {
  renderEditor({ path: "/user/tags/favorites", capabilities: ["songs.view"] });

  expect(
    await screen.findByText(/Tags are set up by trusted accounts/),
  ).toBeInTheDocument();
  expect(listTags).not.toHaveBeenCalled();
});
