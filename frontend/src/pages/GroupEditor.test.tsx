import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import type { GroupRead } from "../api";
import { AS, TRUSTED_GROUP_ID, meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import GroupEditor from "./GroupEditor";

const { getMe, listGroups, createGroup, updateGroup, deleteGroup } = vi.hoisted(
  () => ({
    getMe: vi.fn(),
    listGroups: vi.fn(),
    createGroup: vi.fn(),
    updateGroup: vi.fn(),
    deleteGroup: vi.fn(),
  }),
);

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
}));

const DJS = "d".repeat(32);
const CATALOGUE = [
  "songs.view",
  "karaoke.stop",
  "music.manage",
  "playlists.manage",
  "wishlist.manage",
  "users.manage",
  "permissions.manage",
];

function group(
  id: string,
  name: string,
  capabilities: string[],
  member_count: number | null = 0,
): GroupRead {
  return {
    id,
    name,
    built_in: id === "guest" || id === "user" || id === "admin",
    member_count,
    capabilities,
    right_count: capabilities.length,
    can_assign: true,
  };
}

const USER_RIGHTS = ["songs.view", "karaoke.stop", "playlists.manage"];

function groups(): GroupRead[] {
  return [
    group("guest", "Guest", ["songs.view"], null),
    group("user", "User", USER_RIGHTS, 9),
    group(DJS, "DJs", ["music.manage", "songs.view"], 3),
    group(TRUSTED_GROUP_ID, "Trusted", USER_RIGHTS, 0),
    group("admin", "Admin", CATALOGUE, 1),
  ];
}

/** Where the editor has taken the reader, and how it got there. */
function Probe() {
  return (
    <p>
      at {useLocation().pathname} by {useNavigationType()}
    </p>
  );
}

function renderEditor(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/user/groups" element={<p>the group list</p>} />
          <Route path="/user/groups/new" element={<GroupEditor />} />
          <Route path="/user/groups/:groupId" element={<GroupEditor />} />
          <Route path="/user/accounts" element={<p>the accounts</p>} />
        </Routes>
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("WebSocket", FakeSocket);
  getMe.mockResolvedValue(
    meResponse(CATALOGUE, {
      user: userRead({ groups: ["admin"] }),
      ...AS.admin,
    }),
  );
  listGroups.mockResolvedValue({
    data: { groups: groups(), capabilities: CATALOGUE },
  });
});
afterEach(() => vi.unstubAllGlobals());

test("a group opens on its name and one box per capability", async () => {
  renderEditor(`/user/groups/${DJS}`);

  expect(await screen.findByDisplayValue("DJs")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { level: 1, name: "Edit group" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("music.manage for DJs")).toBeChecked();
  expect(screen.getByLabelText("wishlist.manage for DJs")).not.toBeChecked();
  // What User gives is drawn ticked and locked in a group that adds to it.
  const karaoke = screen.getByLabelText("karaoke.stop for DJs");
  expect(karaoke).toBeChecked();
  expect(karaoke).toBeDisabled();
  expect(karaoke).toHaveAttribute(
    "title",
    "Every account holds this through User.",
  );
  // An own row User also holds stays live: it is data, and may be taken away.
  expect(screen.getByLabelText("songs.view for DJs")).toBeEnabled();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("Save sends the group's own rows alone, never User's", async () => {
  updateGroup.mockResolvedValue({
    data: group(DJS, "DJs", ["music.manage", "songs.view", "wishlist.manage"]),
  });
  renderEditor(`/user/groups/${DJS}`);

  fireEvent.click(await screen.findByLabelText("wishlist.manage for DJs"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(updateGroup).toHaveBeenCalled());
  expect(updateGroup.mock.calls[0][0]).toMatchObject({
    path: { group_id: DJS },
    // In the catalogue's order; karaoke.stop and playlists.manage are User's.
    body: { capabilities: ["songs.view", "music.manage", "wishlist.manage"] },
  });
  // The name did not change, so the body does not name it.
  expect(updateGroup.mock.calls[0][0].body).not.toHaveProperty("name");
  expect(await screen.findByText("Saved")).toBeInTheDocument();
});

test("a rename sends the trimmed name alone", async () => {
  updateGroup.mockResolvedValue({
    data: group(DJS, "Music crew", ["music.manage", "songs.view"]),
  });
  renderEditor(`/user/groups/${DJS}`);

  fireEvent.change(await screen.findByLabelText("Name"), {
    target: { value: "  Music crew " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(updateGroup).toHaveBeenCalled());
  expect(updateGroup.mock.calls[0][0].body).toEqual({ name: "Music crew" });
});

test("a name another group holds is refused in words", async () => {
  updateGroup.mockRejectedValue({ detail: "duplicate_group_name" });
  renderEditor(`/user/groups/${DJS}`);

  fireEvent.change(await screen.findByLabelText("Name"), {
    target: { value: "admin" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    'A group called "admin" already exists. Pick another name.',
  );
});

test("a built-in keeps its name: the heading is the name and there is no Delete", async () => {
  renderEditor("/user/groups/guest");

  expect(
    await screen.findByRole("heading", { level: 1, name: "Guest" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByText(/A built-in group keeps its name\./),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Name")).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete group" })).toBeNull();
  // Guest is a bundle of its own: nothing is drawn on User's behalf.
  expect(screen.getByLabelText("karaoke.stop for Guest")).toBeEnabled();
  // And a guest has no account to own a playlist with.
  expect(screen.getByLabelText("playlists.manage for Guest")).toBeDisabled();
});

test("a new group is made in one call and the address becomes its own", async () => {
  const made = group("n".repeat(32), "Moderators", ["wishlist.manage"]);
  createGroup.mockImplementation(async () => {
    // From now on the server lists it too.
    listGroups.mockResolvedValue({
      data: { groups: [...groups(), made], capabilities: CATALOGUE },
    });
    return { data: made };
  });
  renderEditor("/user/groups/new");

  expect(
    await screen.findByRole("heading", { level: 1, name: "New group" }),
  ).toBeInTheDocument();
  fireEvent.change(await screen.findByLabelText("Name"), {
    target: { value: " Moderators " },
  });
  fireEvent.click(screen.getByLabelText("wishlist.manage for Moderators"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(createGroup).toHaveBeenCalled());
  expect(createGroup.mock.calls[0][0].body).toEqual({
    name: "Moderators",
    capabilities: ["wishlist.manage"],
  });
  // REPLACE: `/new` stands in for the group it became.
  expect(
    await screen.findByText(`at /user/groups/${made.id} by REPLACE`),
  ).toBeInTheDocument();
  expect(await screen.findByText("Saved")).toBeInTheDocument();
  expect(screen.getByDisplayValue("Moderators")).toBeInTheDocument();
});

test("a new group needs a name before Save goes", async () => {
  renderEditor("/user/groups/new");

  await screen.findByLabelText("Name");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(
    screen.getByText("It needs a name before it can be saved."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete group" })).toBeNull();
});

test("the members are counted and changed on the accounts page", async () => {
  renderEditor(`/user/groups/${DJS}`);

  const note = await screen.findByText(/3 accounts are in this group\./);
  expect(
    within(note).getByRole("link", { name: "Players & accounts" }),
  ).toHaveAttribute("href", "/user/accounts");
});

test("deleting says who loses what, then goes back to the list", async () => {
  deleteGroup.mockResolvedValue({ data: undefined });
  renderEditor(`/user/groups/${DJS}`);

  fireEvent.click(await screen.findByRole("button", { name: "Delete group" }));
  expect(
    screen.getByRole("dialog", { name: "Delete group" }),
  ).toHaveTextContent(
    'Delete the group "DJs"? Its 3 members lose the rights it gives them. Their accounts stay.',
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  await waitFor(() =>
    expect(deleteGroup.mock.calls[0][0].path).toEqual({ group_id: DJS }),
  );
  expect(await screen.findByText("the group list")).toBeInTheDocument();
});

test("Admin's address replaces itself with the list", async () => {
  renderEditor("/user/groups/admin");

  expect(
    await screen.findByText("at /user/groups by REPLACE"),
  ).toBeInTheDocument();
});

test("an id the list does not hold says the group is gone", async () => {
  renderEditor("/user/groups/nope");

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This group is gone.",
  );
});

test("a helper hands out only what they hold, and may take anything away", async () => {
  getMe.mockResolvedValue(
    meResponse(["permissions.manage", "songs.view", "music.manage"], {
      user: userRead({ id: "u-amy", username: "Amy" }),
      ...AS.user,
    }),
  );
  renderEditor(`/user/groups/${DJS}`);

  const wishlist = await screen.findByLabelText("wishlist.manage for DJs");
  expect(wishlist).toBeDisabled();
  expect(wishlist).toHaveAttribute(
    "title",
    "You can only hand out a right you hold yourself.",
  );
  expect(screen.getByLabelText("music.manage for DJs")).toBeEnabled();
  expect(screen.getByLabelText("users.manage for DJs")).toBeDisabled();
});

test("without permissions.manage the editor explains itself", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  renderEditor(`/user/groups/${DJS}`);

  expect(
    await screen.findByText(/Groups are the host's to set up/),
  ).toBeInTheDocument();
  expect(listGroups).not.toHaveBeenCalled();
});
