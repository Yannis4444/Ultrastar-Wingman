import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { MeRead, PlaylistDetail, PlaylistMemberRead } from "../api";
import { AS, meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import PlaylistManage from "./PlaylistManage";

const {
  getMe,
  getPlaylist,
  listPlaylistMembers,
  lookupUsers,
  updatePlaylist,
  setPlaylistMember,
  removePlaylistMember,
  deletePlaylist,
  listPlaylists,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  getPlaylist: vi.fn(),
  listPlaylistMembers: vi.fn(),
  lookupUsers: vi.fn(),
  updatePlaylist: vi.fn(),
  setPlaylistMember: vi.fn(),
  removePlaylistMember: vi.fn(),
  deletePlaylist: vi.fn(),
  listPlaylists: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  getPlaylist,
  listPlaylistMembers,
  lookupUsers,
  updatePlaylist,
  setPlaylistMember,
  removePlaylistMember,
  deletePlaylist,
  listPlaylists,
}));

const LIBRARY = ["songs.view", "playlists.view", "playlists.manage"];
const ACCOUNT: Partial<MeRead> = { user: userRead(), ...AS.user };

function detail(overrides: Partial<PlaylistDetail> = {}): PlaylistDetail {
  return {
    id: "p1",
    name: "Party",
    description: "The good ones",
    is_global: false,
    owner_username: "Alice",
    owner_player_id: "aaa",
    song_count: 2,
    duration_seconds: 0,
    cover_song_ids: [],
    my_access: "owner",
    followed: true,
    can_edit: true,
    can_manage: true,
    contains: null,
    entries: [],
    ...overrides,
  };
}

function member(
  overrides: Partial<PlaylistMemberRead> = {},
): PlaylistMemberRead {
  return {
    user_id: "u-bob",
    username: "Bob",
    player_id: "bbb",
    access: "write",
    created_at: "2026-08-28T18:00:00Z",
    ...overrides,
  };
}

/** Where a delete has taken the reader. */
function Probe() {
  return <p>at {useLocation().pathname}</p>;
}

function renderManage(
  playlist: PlaylistDetail | Error = detail(),
  capabilities = LIBRARY,
  me: Partial<MeRead> = ACCOUNT,
) {
  getMe.mockResolvedValue(meResponse(capabilities, me));
  getPlaylist.mockImplementation(async () => {
    if (playlist instanceof Error) throw playlist;
    return { data: playlist };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/songs/playlists/p1/manage"]}>
        <Routes>
          <Route
            path="/songs/playlists/:playlistId/manage"
            element={<PlaylistManage />}
          />
        </Routes>
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  for (const mock of [
    getMe,
    getPlaylist,
    listPlaylistMembers,
    lookupUsers,
    updatePlaylist,
    setPlaylistMember,
    removePlaylistMember,
    deletePlaylist,
    listPlaylists,
  ])
    mock.mockReset();
  listPlaylistMembers.mockResolvedValue({ data: { members: [] } });
  listPlaylists.mockResolvedValue({ data: { playlists: [] } });
  lookupUsers.mockResolvedValue({ data: { users: [] } });
});

afterEach(() => vi.unstubAllGlobals());

test("the owner gets the fields, the members and the way back", async () => {
  listPlaylistMembers.mockResolvedValue({ data: { members: [member()] } });
  renderManage();

  expect(await screen.findByLabelText("Name")).toHaveValue("Party");
  expect(screen.getByLabelText("Description")).toHaveValue("The good ones");
  expect(
    screen.getByLabelText("Global: everyone can see it"),
  ).not.toBeChecked();
  expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
    "href",
    "/songs/playlists/p1",
  );

  const members = await screen.findByRole("list", { name: "Members" });
  const rows = within(members).getAllByRole("listitem");
  // The owner heads the list and carries no control of their own.
  expect(rows[0]).toHaveTextContent("Alice");
  expect(rows[0]).toHaveTextContent("owner");
  expect(within(rows[0]).queryByRole("combobox")).not.toBeInTheDocument();
  expect(rows[1]).toHaveTextContent("Bob");
  expect(within(rows[1]).getByRole("combobox")).toHaveValue("write");
});

test.each([
  ["a read member", "read"],
  ["a write member", "write"],
] as const)(
  "%s may look at the playlist but not manage it",
  async (_, access) => {
    renderManage(
      detail({
        my_access: access,
        can_manage: false,
        can_edit: access === "write",
      }),
    );

    expect(
      await screen.findByText(/Only the owner of this playlist/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    // The member listing 403s for them, so it is never asked for.
    expect(listPlaylistMembers).not.toHaveBeenCalled();
  },
);

test.each([
  ["an admin member", { my_access: "admin" as const }],
  // A moderator reaches a list they were never named on; the backend is what
  // decides that, and the page only reads `can_manage`.
  ["a moderator", { my_access: null, owner_username: "Bob" }],
])("%s manages the playlist", async (_, overrides) => {
  renderManage(detail({ can_manage: true, ...overrides }));

  expect(await screen.findByLabelText("Name")).toHaveValue("Party");
});

test("a guest without the right is told who may do this", async () => {
  renderManage(detail(), ["songs.view"], {});

  expect(
    await screen.findByText(/Playlists are not open to you\./),
  ).toBeInTheDocument();
  expect(getPlaylist).not.toHaveBeenCalled();
});

test("an unknown playlist is gone, with the way back to the list", async () => {
  renderManage(new Error("nope"));

  const notice = await screen.findByRole("alert");
  expect(notice).toHaveTextContent("This playlist is gone.");
  expect(within(notice).getByRole("link")).toHaveAttribute(
    "href",
    "/songs/playlists",
  );
});

test("Save patches only what changed", async () => {
  updatePlaylist.mockResolvedValue({ data: detail({ name: "Late shift" }) });
  renderManage();

  const name = await screen.findByLabelText("Name");
  const save = screen.getByRole("button", { name: "Save" });
  // Nothing to send yet.
  expect(save).toBeDisabled();

  fireEvent.change(name, { target: { value: "Late shift" } });
  fireEvent.click(save);

  await waitFor(() => expect(updatePlaylist).toHaveBeenCalled());
  // Exactly the one field — `toMatchObject` would let the other two through.
  expect(updatePlaylist.mock.calls[0][0].body).toEqual({ name: "Late shift" });
  expect(await screen.findByText("Saved")).toBeInTheDocument();
});

test("emptying the description sends the explicit null that clears it", async () => {
  updatePlaylist.mockResolvedValue({ data: detail() });
  renderManage();

  fireEvent.change(await screen.findByLabelText("Description"), {
    target: { value: "  " },
  });
  fireEvent.click(screen.getByLabelText("Global: everyone can see it"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(updatePlaylist).toHaveBeenCalled());
  expect(updatePlaylist.mock.calls[0][0].body).toEqual({
    description: null,
    is_global: true,
  });
});

test("somebody else's rename does not ride along on the next save", async () => {
  updatePlaylist.mockResolvedValue({ data: detail({ name: "Party" }) });
  renderManage();
  await screen.findByLabelText("Name");

  // Somebody else renames the list while this page is open. The field keeps
  // what the reader can see — rewriting it mid-word would be worse — but the
  // name they never typed must not turn up in the PATCH.
  getPlaylist.mockResolvedValue({ data: detail({ name: "Renamed by Bob" }) });
  FakeSocket.deliver({ event: "playlists.changed", playlist_id: "p1" });
  await waitFor(() => expect(getPlaylist).toHaveBeenCalledTimes(2));

  const save = screen.getByRole("button", { name: "Save" });
  // Nothing was typed here, so there is nothing to save.
  expect(save).toBeDisabled();

  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Only this" },
  });
  fireEvent.click(save);

  await waitFor(() => expect(updatePlaylist).toHaveBeenCalled());
  expect(updatePlaylist.mock.calls[0][0].body).toEqual({
    description: "Only this",
  });
});

test("saving twice sends nothing the second time", async () => {
  updatePlaylist.mockResolvedValue({ data: detail({ name: "Late shift" }) });
  renderManage();

  fireEvent.change(await screen.findByLabelText("Name"), {
    target: { value: "Late shift" },
  });
  const save = screen.getByRole("button", { name: "Save" });
  fireEvent.click(save);

  await screen.findByText("Saved");
  // The answer became the new baseline, so the button has nothing left to do.
  await waitFor(() => expect(save).toBeDisabled());
  expect(updatePlaylist).toHaveBeenCalledTimes(1);
});

test("a searched account is shared with as a reader", async () => {
  lookupUsers.mockResolvedValue({
    data: {
      users: [
        {
          id: "u-carol",
          username: "Carol",
          player_id: "ccc",
          avatar_version: 7,
        },
      ],
    },
  });
  setPlaylistMember.mockResolvedValue({ data: { members: [] } });
  renderManage();

  fireEvent.change(await screen.findByLabelText("Add people"), {
    target: { value: "Car" },
  });

  const add = await screen.findByRole("button", { name: "Share with Carol" });
  expect(iconNames(add)).toEqual(["user-plus"]);
  fireEvent.click(add);

  await waitFor(() =>
    expect(setPlaylistMember).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { playlist_id: "p1" },
        body: { user_id: "u-carol", access: "read" },
      }),
    ),
  );
  // One request for the word, not one per keystroke.
  expect(lookupUsers).toHaveBeenCalledTimes(1);
  expect(lookupUsers.mock.calls[0][0]).toMatchObject({ query: { q: "Car" } });
});

test("somebody already named on the playlist is not offered again", async () => {
  listPlaylistMembers.mockResolvedValue({ data: { members: [member()] } });
  lookupUsers.mockResolvedValue({
    data: {
      users: [
        {
          id: "u-bob",
          username: "Bob",
          player_id: "bbb",
          avatar_version: null,
        },
      ],
    },
  });
  renderManage();

  fireEvent.change(await screen.findByLabelText("Add people"), {
    target: { value: "Bo" },
  });

  // Not "no account matches that": Bob is right there on the list below.
  expect(
    await screen.findByText(
      "Everybody matching that is already on the playlist.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Share with Bob" }),
  ).not.toBeInTheDocument();
});

test("nothing matching at all says so", async () => {
  renderManage();

  fireEvent.change(await screen.findByLabelText("Add people"), {
    target: { value: "zz" },
  });

  expect(
    await screen.findByText("No account matches that."),
  ).toBeInTheDocument();
});

test("a single letter asks the backend nothing", async () => {
  // The clock still runs, so the queries behind the page resolve; only the
  // debounce is under this test's control.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    renderManage();

    fireEvent.change(await screen.findByLabelText("Add people"), {
      target: { value: "a" },
    });
    await vi.advanceTimersByTimeAsync(1000);

    // Two characters is the shortest the backend answers, so one is not asked.
    expect(lookupUsers).not.toHaveBeenCalled();
    expect(
      screen.queryByText("No account matches that."),
    ).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("sharing with the owner is refused in words", async () => {
  lookupUsers.mockResolvedValue({
    data: {
      users: [
        {
          id: "u-alice",
          username: "Alice",
          player_id: "aaa",
          avatar_version: null,
        },
      ],
    },
  });
  setPlaylistMember.mockRejectedValue({ detail: "already_owner" });
  renderManage();

  fireEvent.change(await screen.findByLabelText("Add people"), {
    target: { value: "Ali" },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Share with Alice" }),
  );

  const notice = await screen.findByRole("alert");
  expect(notice).toHaveTextContent("That account already owns this playlist.");
  // Beside the search that caused it, not up at the form a screen above: the
  // reader is looking at the row they just tapped.
  expect(
    screen.getByLabelText("Add people").compareDocumentPosition(notice),
  ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

test("a failed removal is said at the members, and saving still at the form", async () => {
  listPlaylistMembers.mockResolvedValue({ data: { members: [member()] } });
  removePlaylistMember.mockRejectedValue(new Error("nope"));
  updatePlaylist.mockRejectedValue(new Error("nope"));
  renderManage();

  fireEvent.click(await screen.findByRole("button", { name: "Remove Bob" }));

  const search = await screen.findByLabelText("Add people");
  const atMembers = await screen.findByRole("alert");
  expect(atMembers).toHaveTextContent("Could not take that person off");
  expect(search.compareDocumentPosition(atMembers)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );

  // The form's own failure keeps the page-level notice, above the form.
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Encore" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  const atForm = await screen.findByText("Could not save the playlist.");
  expect(search.compareDocumentPosition(atForm)).toBe(
    Node.DOCUMENT_POSITION_PRECEDING,
  );
});

test("a member's access is changed on their own row", async () => {
  listPlaylistMembers.mockResolvedValue({ data: { members: [member()] } });
  setPlaylistMember.mockResolvedValue({ data: { members: [] } });
  renderManage();

  fireEvent.change(await screen.findByLabelText("Access of Bob"), {
    target: { value: "admin" },
  });

  await waitFor(() =>
    expect(setPlaylistMember).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { playlist_id: "p1" },
        body: { user_id: "u-bob", access: "admin" },
      }),
    ),
  );
});

test("a member is taken off the playlist", async () => {
  listPlaylistMembers.mockResolvedValue({ data: { members: [member()] } });
  removePlaylistMember.mockResolvedValue({ data: undefined });
  renderManage();

  const remove = await screen.findByRole("button", { name: "Remove Bob" });
  expect(iconNames(remove)).toEqual(["close"]);
  fireEvent.click(remove);

  await waitFor(() =>
    expect(removePlaylistMember).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { playlist_id: "p1", user_id: "u-bob" },
      }),
    ),
  );
});

test("deleting asks first, then leaves for the playlists page", async () => {
  deletePlaylist.mockResolvedValue({ data: undefined });
  renderManage();

  fireEvent.click(
    await screen.findByRole("button", { name: "Delete playlist" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Delete playlist" });
  expect(dialog).toHaveTextContent(
    "The list and everybody's access to it are gone",
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

  await waitFor(() => expect(deletePlaylist).toHaveBeenCalled());
  expect(await screen.findByText("at /songs/playlists")).toBeInTheDocument();
});

test("cancelling the confirmation deletes nothing", async () => {
  renderManage();

  fireEvent.click(
    await screen.findByRole("button", { name: "Delete playlist" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(
    screen.queryByRole("dialog", { name: "Delete playlist" }),
  ).not.toBeInTheDocument();
  expect(deletePlaylist).not.toHaveBeenCalled();
});

test("a change somebody else makes reaches the page", async () => {
  renderManage();
  await screen.findByLabelText("Name");
  getPlaylist.mockClear();

  FakeSocket.deliver({ event: "playlists.changed", playlist_id: "p1" });

  await waitFor(() => expect(getPlaylist).toHaveBeenCalled());
});
