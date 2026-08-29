import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { MeRead, TagPermissionRead, TagRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import TagEditor from "./TagEditor";

const {
  getMe,
  listTags,
  listTagAssignments,
  createTag,
  updateTag,
  replaceTagPermissions,
  deleteTag,
  lookupUsers,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  listTags: vi.fn(),
  listTagAssignments: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  replaceTagPermissions: vi.fn(),
  deleteTag: vi.fn(),
  lookupUsers: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listTags,
  listTagAssignments,
  createTag,
  updateTag,
  replaceTagPermissions,
  deleteTag,
  lookupUsers,
}));

const MANAGER = ["songs.view", "tags.manage"];
const ACCOUNT: Partial<MeRead> = { user: userRead(), role: "trusted" };

/** The rows the seeded `archive` tag carries — the shape the editor's own
 *  default for a new tag copies. */
function roleRows(): TagPermissionRead[] {
  return (["guest", "user", "trusted"] as const).flatMap((role) => [
    { action: "view" as const, role, user_id: null, username: null },
    { action: "view_songs" as const, role, user_id: null, username: null },
  ]);
}

function tag(overrides: Partial<TagRead> = {}): TagRead {
  return {
    id: "t1",
    name: "broken",
    icon: "alert",
    color: "gold",
    show_in_list: true,
    hide_by_default: true,
    can_assign: true,
    permissions: [
      ...roleRows(),
      { action: "assign", role: "trusted", user_id: null, username: null },
    ],
    ...overrides,
  };
}

/** Where a create or a delete has taken the reader. */
function Probe() {
  return <p>at {useLocation().pathname}</p>;
}

function renderEditor({
  path = "/user/tags/t1",
  tags = [tag()],
  assignments = [{ tag_id: "t1", song_ids: ["s1", "s2"] }],
  capabilities = MANAGER,
}: {
  path?: string;
  tags?: TagRead[];
  assignments?: { tag_id: string; song_ids: string[] }[];
  capabilities?: string[];
} = {}) {
  getMe.mockResolvedValue(meResponse(capabilities, ACCOUNT));
  listTags.mockResolvedValue({ data: { tags } });
  listTagAssignments.mockResolvedValue({ data: { assignments } });
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
    listTagAssignments,
    createTag,
    updateTag,
    replaceTagPermissions,
    deleteTag,
    lookupUsers,
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
  // A fresh tag opens on the seeded `archive` tag's rows, so the manager who
  // made it can still see it.
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
  renderEditor({ assignments: [] });

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
