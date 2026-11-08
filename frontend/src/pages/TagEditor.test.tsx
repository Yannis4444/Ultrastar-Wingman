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
  GroupRead,
  MeRead,
  TagPermissionRead,
  TagRead,
} from "../api";
import { AS, TRUSTED_GROUP_ID, meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import { builtInTagRead, builtInTagReads, tagRead } from "../test/tags";
import TagEditor from "./TagEditor";

const {
  getMe,
  listTags,
  listGroups,
  createTag,
  updateTag,
  replaceTagPermissions,
  deleteTag,
  lookupUsers,
  updateBuiltInTag,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  listTags: vi.fn(),
  listGroups: vi.fn(),
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
  listGroups,
  createTag,
  updateTag,
  replaceTagPermissions,
  deleteTag,
  lookupUsers,
  updateBuiltInTag,
}));

const MANAGER = ["songs.view", "tags.manage"];
const ACCOUNT: Partial<MeRead> = { user: userRead(), ...AS.trusted };

/** The groups `GET /groups` answers: the permission rows but Admin. */
const GROUPS: GroupRead[] = [
  ["guest", "Guest"],
  ["user", "User"],
  [TRUSTED_GROUP_ID, "Trusted"],
  ["admin", "Admin"],
].map(([id, name]) => ({
  id,
  name,
  built_in: id !== TRUSTED_GROUP_ID,
  member_count: null,
  capabilities: null,
  right_count: null,
  can_assign: false,
}));

/** Everybody may see the tag and its songs, spelled out for Trusted too. */
function roleRows(): TagPermissionRead[] {
  return (["guest", "user", TRUSTED_GROUP_ID] as const).flatMap((id) => [
    { action: "view" as const, group_id: id, user_id: null, username: null },
    {
      action: "view_songs" as const,
      group_id: id,
      user_id: null,
      username: null,
    },
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
      {
        action: "assign",
        group_id: TRUSTED_GROUP_ID,
        user_id: null,
        username: null,
      },
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
}: {
  path?: string;
  tags?: TagRead[];
  capabilities?: string[];
  builtIns?: BuiltInTagRead[];
} = {}) {
  getMe.mockResolvedValue(meResponse(capabilities, ACCOUNT));
  listTags.mockResolvedValue({ data: { tags, built_ins: builtIns } });
  listGroups.mockResolvedValue({
    data: { groups: GROUPS, capabilities: null },
  });
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

/** A permissions body, as a sorted set of `action group|user` strings, Trusted's
 *  id read as `trusted` — the order the rows go out in is not part of the
 *  contract. */
function sentRows(body: { permissions: unknown[] }): string[] {
  return (
    body.permissions as {
      action: string;
      group_id?: string;
      user_id?: string;
    }[]
  )
    .map((row) => {
      const subject = row.group_id ?? row.user_id;
      return `${row.action} ${subject === TRUSTED_GROUP_ID ? "trusted" : subject}`;
    })
    .sort();
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  for (const mock of [
    getMe,
    listTags,
    listGroups,
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

it("keeps the editor from a reader who may not manage tags", async () => {
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
  expect(screen.getByLabelText("See tag for Guest")).toBeChecked();
  expect(screen.getByLabelText("Tag songs for Guest")).not.toBeChecked();
  expect(screen.getByLabelText("Tag songs for Trusted")).toBeChecked();
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
  // User's rows reach Trusted's members, so the view rows name Guest and User.
  expect(sentRows(body)).toEqual([
    "assign trusted",
    "view guest",
    "view user",
    "view_songs guest",
    "view_songs user",
  ]);
  expect(await screen.findByText("at /user/tags/t-new")).toBeInTheDocument();
});

it("acknowledges a create in the row of the tag it just made", async () => {
  // The route changes, so React is free to remount the editor: the press is
  // acknowledged through the navigation, never as "Nothing has changed yet."
  // on the tag it has this second created.
  const made = tag({ id: "t-new", name: "duet" });
  createTag.mockResolvedValue({ data: made });
  renderEditor({ path: "/user/tags/new", tags: [made] });

  await screen.findByLabelText("Name");
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "duet" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByText("at /user/tags/t-new")).toBeInTheDocument();
  expect(await screen.findByText("Saved")).toBeInTheDocument();
  expect(screen.queryByText("Nothing has changed yet.")).toBeNull();
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

it("replaces the permissions when a box in a group row moves", async () => {
  replaceTagPermissions.mockResolvedValue({ data: tag() });
  renderEditor();

  await screen.findByDisplayValue("broken");
  fireEvent.click(screen.getByLabelText("Tag songs for User"));
  fireEvent.click(screen.getByLabelText("See tag for Guest"));
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

it("leaves out a row for a group that is gone", async () => {
  replaceTagPermissions.mockResolvedValue({ data: tag() });
  renderEditor({
    tags: [
      tag({
        permissions: [
          ...roleRows(),
          // A group `GET /groups` does not hold: sent back, it would be the
          // backend's `unknown_group` and the tag could never be saved.
          {
            action: "view",
            group_id: "gone-group",
            user_id: null,
            username: null,
          },
        ],
      }),
    ],
  });

  await screen.findByDisplayValue("broken");
  fireEvent.click(await screen.findByLabelText("Tag songs for Trusted"));
  // Drawn nowhere: there is no row for a group the listing does not hold.
  expect(screen.queryByLabelText(/for gone-group/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(replaceTagPermissions).toHaveBeenCalled());
  expect(sentRows(replaceTagPermissions.mock.calls[0][0].body)).not.toContain(
    "view gone-group",
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
          { action: "view", group_id: null, user_id: null, username: null },
        ],
      }),
    ],
  });

  await screen.findByDisplayValue("broken");
  fireEvent.click(await screen.findByLabelText("Tag songs for Trusted"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(replaceTagPermissions).toHaveBeenCalled());
  const rows = replaceTagPermissions.mock.calls[0][0].body.permissions as {
    group_id?: string | null;
    user_id?: string | null;
  }[];
  expect(
    rows.every(
      (row) =>
        (row.group_id ?? null) !== null || (row.user_id ?? null) !== null,
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
          { action: "view", group_id: null, user_id: "u-bob", username: "Bob" },
          {
            action: "view_songs",
            group_id: null,
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

it("draws a person named on the tag with their own picture", async () => {
  // Read back from the stored tag, not added through the search this visit:
  // those rows used to come without a player and always drew the initial.
  renderEditor({
    tags: [
      tag({
        permissions: [
          ...roleRows(),
          {
            action: "view",
            group_id: null,
            user_id: "u-bob",
            username: "Bob",
            player_id: "bbb",
            avatar_version: 7,
          },
          {
            action: "view",
            group_id: null,
            user_id: "u-cid",
            username: "Cid",
            player_id: null,
            avatar_version: null,
          },
        ],
      }),
    ],
  });

  await screen.findByDisplayValue("broken");
  const rows = screen
    .getAllByRole("listitem")
    .filter((row) => row.classList.contains("tag-people-row"));
  const bob = rows.find((row) => row.textContent?.includes("Bob"));
  expect(bob?.querySelector("img.player-avatar")).toHaveAttribute(
    "src",
    "/api/v1/players/bbb/avatar?v=7",
  );
  const cid = rows.find((row) => row.textContent?.includes("Cid"));
  expect(cid?.querySelector("img")).toBeNull();
  expect(cid?.querySelector(".player-avatar-letter")).toHaveTextContent("C");
});

it("warns about a tagger who would not see what they tagged", async () => {
  renderEditor();

  await screen.findByDisplayValue("broken");
  expect(screen.queryByText(/could not undo it/)).not.toBeInTheDocument();

  // Trusted adds to User: while User sees the songs, so do Trusted's members,
  // and unticking Trusted's own row alone changes nothing for them.
  fireEvent.click(screen.getByLabelText("See songs for User"));
  fireEvent.click(screen.getByLabelText("See songs for Trusted"));
  expect(await screen.findByText(/Trusted may tag songs/)).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText("See songs for Trusted"));
  await waitFor(() =>
    expect(screen.queryByText(/may tag songs without/)).not.toBeInTheDocument(),
  );
});

it("draws one row per group but Admin, the actions as its columns", async () => {
  renderEditor();

  await screen.findByDisplayValue("broken");
  const rows = within(
    screen.getByRole("list", { name: "Permissions" }),
  ).getAllByRole("listitem");
  expect(rows.map((row) => row.textContent)).toEqual([
    "Guest",
    "User",
    "Trusted",
  ]);
  // Admin is no row: the hint over the rows says why.
  expect(screen.queryByLabelText("See tag for Admin")).not.toBeInTheDocument();
  expect(screen.getByText(/Administrators are not in the table/)).toBeVisible();
  // Each row's lead is the group's square, the people rows' avatar's place.
  expect(iconNames(rows[2])).toContain("users");
});

it("locks what User holds in a group that adds to it, and never sends it", async () => {
  const DJS = "d".repeat(32);
  replaceTagPermissions.mockResolvedValue({ data: tag() });
  renderEditor({
    tags: [
      tag({
        permissions: [
          ...roleRows().filter((row) => row.group_id !== TRUSTED_GROUP_ID),
        ],
      }),
    ],
  });
  listGroups.mockResolvedValue({
    data: {
      groups: [
        ...GROUPS.slice(0, 2),
        { ...GROUPS[2], id: DJS, name: "DJs" },
        GROUPS[3],
      ],
      capabilities: null,
    },
  });

  await screen.findByDisplayValue("broken");
  const seeTag = await screen.findByLabelText("See tag for DJs");
  // User sees the tag, so every account in DJs does: ticked, and locked.
  expect(seeTag).toBeChecked();
  expect(seeTag).toBeDisabled();
  expect(seeTag).toHaveAttribute(
    "title",
    "Every account holds this through User.",
  );
  expect(screen.getByLabelText("Tag songs for DJs")).toBeEnabled();
  // Built-ins are bundles of their own: Guest's boxes stay its own.
  expect(screen.getByLabelText("See tag for Guest")).toBeEnabled();

  fireEvent.click(screen.getByLabelText("Tag songs for DJs"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(replaceTagPermissions).toHaveBeenCalled());
  const sent = sentRows(replaceTagPermissions.mock.calls[0][0].body);
  expect(sent).toContain(`assign ${DJS}`);
  // What was drawn on User's behalf is not a row of DJs.
  expect(sent).not.toContain(`view ${DJS}`);
  expect(sent).not.toContain(`view_songs ${DJS}`);
});

it("a new tag lets Trusted tag songs only while Trusted exists", async () => {
  createTag.mockResolvedValue({ data: tag({ id: "t-new", name: "duet" }) });
  renderEditor({ path: "/user/tags/new", tags: [] });
  // The host deleted Trusted.
  listGroups.mockResolvedValue({
    data: {
      groups: GROUPS.filter((group) => group.id !== TRUSTED_GROUP_ID),
      capabilities: null,
    },
  });

  await screen.findByLabelText("Name");
  await screen.findByLabelText("See tag for User");
  expect(screen.queryByLabelText("Tag songs for Trusted")).toBeNull();
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "duet" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(createTag).toHaveBeenCalled());
  expect(sentRows(createTag.mock.calls[0][0].body)).toEqual([
    "view guest",
    "view user",
    "view_songs guest",
    "view_songs user",
  ]);
});

it("warns about a filter that can never have anything in it", async () => {
  renderEditor();

  await screen.findByDisplayValue("broken");
  expect(screen.queryByText(/always empty/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByLabelText("See songs for Guest"));
  expect(await screen.findByText(/Guest may see the tag/)).toHaveTextContent(
    "always empty",
  );

  fireEvent.click(screen.getByLabelText("See tag for Guest"));
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
  // Save can be pressed from anywhere in the form now, so the row it was
  // pressed in has to say the press went nowhere and where the sentence is.
  expect(
    await screen.findByText(
      "It did not go through. The message at the top of the page says why.",
    ),
  ).toBeInTheDocument();
});

it("words a group deleted since the page read the groups", async () => {
  replaceTagPermissions.mockRejectedValue({ detail: "unknown_group" });
  renderEditor();

  fireEvent.click(await screen.findByLabelText("Tag songs for User"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "That group no longer exists.",
  );
});

it("says so when the groups cannot be read, rather than drawing no rows", async () => {
  renderEditor();
  listGroups.mockRejectedValue({ detail: "boom" });

  await screen.findByDisplayValue("broken");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load the groups.",
  );
});

it("keeps Save and Delete tag on the one action row", async () => {
  renderEditor();

  await screen.findByDisplayValue("broken");
  const row = screen.getByRole("button", { name: "Save" }).parentElement!;
  expect(row).toHaveClass("editor-actions-row");
  expect(
    within(row).getByRole("button", { name: "Delete tag" }),
  ).toBeInTheDocument();
  // Nothing touched yet, and the row says so rather than leaving a grey button
  // to be guessed at.
  expect(screen.getByText("Nothing has changed yet.")).toBeInTheDocument();
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

// --- the built-in marks and facets ----------------------------------------

it("opens a mark on two controls and nothing else", async () => {
  renderEditor({ path: "/user/tags/favorites" });

  expect(
    await screen.findByRole("radiogroup", { name: "Color" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Favorites" }),
  ).toBeInTheDocument();
  // A colour, a flag, Save — and none of what belongs to a `tags` row.
  expect(screen.getByRole("radiogroup", { name: "Color" })).toBeInTheDocument();
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

  await screen.findByRole("radiogroup", { name: "Color" });
  expect(screen.getByRole("radio", { name: /Gold/ })).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Show in song list" }),
  ).not.toBeChecked();
  // Every pill previews the mark itself, never the tag glyph.
  expect(iconNames(screen.getByRole("radiogroup", { name: "Color" }))).toEqual([
    "mic",
    "mic",
    "mic",
    "mic",
  ]);
});

it("saves a built-in's colour and flag together", async () => {
  updateBuiltInTag.mockResolvedValue({
    data: { id: "favorites", color: "gold", show_in_list: false },
  });
  renderEditor({ path: "/user/tags/favorites" });

  await screen.findByRole("radiogroup", { name: "Color" });
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

  await screen.findByRole("radiogroup", { name: "Color" });
  fireEvent.click(screen.getByRole("radio", { name: /Neutral/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not save the built-in.",
  );
  // And the row Save was pressed in says the press went nowhere: the sentence
  // itself is at the head of the form, which a long one has scrolled past.
  expect(
    await screen.findByText(
      "It did not go through. The message at the top of the page says why.",
    ),
  ).toBeInTheDocument();
});

it("keeps a built-in from a role that may not manage tags", async () => {
  renderEditor({ path: "/user/tags/favorites", capabilities: ["songs.view"] });

  expect(
    await screen.findByText(/Tags are set up by trusted accounts/),
  ).toBeInTheDocument();
  expect(listTags).not.toHaveBeenCalled();
});

it("opens a boolean facet on its colour and its two flags", async () => {
  renderEditor({ path: "/user/tags/duet" });

  expect(
    await screen.findByRole("radiogroup", { name: "Color" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Duet" })).toBeInTheDocument();
  // Colour, both flags, Save — and every flag with its explaining line.
  expect(
    screen.getByRole("checkbox", { name: "Show in song list" }),
  ).not.toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Show in filter" }),
  ).toBeChecked();
  expect(screen.getByText(/next to the tags/)).toBeInTheDocument();
  expect(
    screen.getByText(/The Filter panel offers Duet as a row of its own/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Duet comes out of the song file/),
  ).toBeInTheDocument();
  // The pills preview the facet's own glyph, never the tag one.
  expect(iconNames(screen.getByRole("radiogroup", { name: "Color" }))).toEqual([
    "users",
    "users",
    "users",
    "users",
  ]);
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("checkbox", { name: "Hide songs by default" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Delete tag" }),
  ).not.toBeInTheDocument();
});

it("opens a valued facet on the one thing there is to decide", async () => {
  renderEditor({ path: "/user/tags/genre" });

  expect(
    await screen.findByRole("checkbox", { name: "Show in filter" }),
  ).toBeChecked();
  expect(screen.getByRole("heading", { name: "Genre" })).toBeInTheDocument();
  // No colour to set and never a mark on a row (§1.3), so neither control is
  // here — and one line says why the rest is gone.
  expect(
    screen.queryByRole("radiogroup", { name: "Color" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("checkbox", { name: "Show in song list" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/Genre comes out of the song file itself/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/listing the values the library actually holds/),
  ).toBeInTheDocument();
});

it("sends a boolean facet every option its kind has", async () => {
  updateBuiltInTag.mockResolvedValue({
    data: {
      id: "video",
      kind: "boolean",
      color: "pink",
      show_in_list: true,
      show_in_filter: false,
    },
  });
  renderEditor({ path: "/user/tags/video" });

  await screen.findByRole("radiogroup", { name: "Color" });
  fireEvent.click(screen.getByRole("radio", { name: /Pink/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Show in song list" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Show in filter" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(updateBuiltInTag).toHaveBeenCalled());
  expect(updateBuiltInTag.mock.calls[0][0]).toMatchObject({
    path: { built_in_id: "video" },
    body: { color: "pink", show_in_list: true, show_in_filter: false },
  });
  expect(await screen.findByText("Saved")).toBeInTheDocument();
});

it("sends a valued facet nothing but its flag", async () => {
  updateBuiltInTag.mockResolvedValue({
    data: {
      id: "decade",
      kind: "valued",
      color: null,
      show_in_list: null,
      show_in_filter: false,
    },
  });
  renderEditor({ path: "/user/tags/decade" });

  await screen.findByRole("checkbox", { name: "Show in filter" });
  fireEvent.click(screen.getByRole("checkbox", { name: "Show in filter" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(updateBuiltInTag).toHaveBeenCalled());
  // A colour on Decade is a 422: the body carries exactly the kind's options.
  expect(updateBuiltInTag.mock.calls[0][0].body).toEqual({
    show_in_filter: false,
  });
  expect(await screen.findByText("Saved")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

it("sends a mark nothing about the filter", async () => {
  updateBuiltInTag.mockResolvedValue({
    data: {
      id: "sung",
      kind: "mark",
      color: "gold",
      show_in_list: true,
      show_in_filter: null,
    },
  });
  renderEditor({ path: "/user/tags/sung" });

  await screen.findByRole("radiogroup", { name: "Color" });
  expect(
    screen.queryByRole("checkbox", { name: "Show in filter" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: /Gold/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(updateBuiltInTag).toHaveBeenCalled());
  expect(updateBuiltInTag.mock.calls[0][0].body).toEqual({
    color: "gold",
    show_in_list: true,
  });
});
