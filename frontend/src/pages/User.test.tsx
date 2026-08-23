import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PlayerRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import User from "./User";

const {
  listPlayers,
  createPlayer,
  deletePlayer,
  setPlayerAvatar,
  getMe,
  login,
  register,
  logout,
  listUsers,
  updateUser,
  deleteUser,
  getPermissions,
} = vi.hoisted(() => ({
  listPlayers: vi.fn(),
  createPlayer: vi.fn(),
  deletePlayer: vi.fn(),
  setPlayerAvatar: vi.fn(),
  getMe: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  listUsers: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  getPermissions: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listPlayers,
  createPlayer,
  deletePlayer,
  setPlayerAvatar,
  getMe,
  login,
  register,
  logout,
  listUsers,
  updateUser,
  deleteUser,
  getPermissions,
}));

const USER_CAPABILITIES = [
  "songs.view",
  "karaoke.sing",
  "karaoke.stop",
  "players.view",
  "players.manage",
];

const ADMIN_CAPABILITIES = [
  ...USER_CAPABILITIES,
  "users.manage",
  "permissions.manage",
  "settings.view",
];

function player(id: string, name: string): PlayerRead {
  return { id, name, registered: false, has_avatar: false };
}

function renderUser() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // A router: the page links to /settings.
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <User />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  listPlayers.mockResolvedValue({
    data: { players: [player("aaa", "Alice")] },
  });
  // A logged-in ordinary account: players are manageable, no admin sections.
  // Not named after a player, so the profile card never collides with a row.
  getMe.mockResolvedValue(
    meResponse(USER_CAPABILITIES, {
      user: userRead({ username: "Charlie", player_id: "ccc" }),
      role: "user",
    }),
  );
});

test("players are listed and a new one can be added", async () => {
  createPlayer.mockResolvedValue({ data: player("bbb", "Bob") });
  renderUser();
  expect(await screen.findByText("Alice")).toBeInTheDocument();

  listPlayers.mockResolvedValue({
    data: { players: [player("aaa", "Alice"), player("bbb", "Bob")] },
  });
  fireEvent.change(screen.getByLabelText("New player name"), {
    target: { value: "  Bob  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() =>
    expect(createPlayer.mock.calls[0][0].body).toEqual({ name: "Bob" }),
  );
  expect(await screen.findByText("Bob")).toBeInTheDocument();
});

test("a duplicate name is reported instead of silently failing", async () => {
  createPlayer.mockRejectedValue({ detail: "duplicate_name" });
  renderUser();
  await screen.findByText("Alice");

  fireEvent.change(screen.getByLabelText("New player name"), {
    target: { value: "Alice" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "There is already a player with that name.",
  );
  expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
});

test("deleting a player asks for confirmation first", async () => {
  deletePlayer.mockResolvedValue({ data: undefined });
  renderUser();

  fireEvent.click(await screen.findByRole("button", { name: "Delete Alice" }));
  expect(deletePlayer).not.toHaveBeenCalled();

  const confirm = screen.getByRole("dialog", { name: "Delete player" });
  expect(confirm).toHaveTextContent('Delete "Alice"?');

  listPlayers.mockResolvedValue({ data: { players: [] } });
  // The row button is labelled "Delete Alice", so this is the prompt's button.
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  await waitFor(() =>
    expect(deletePlayer.mock.calls[0][0].path).toEqual({ player_id: "aaa" }),
  );
  expect(await screen.findByText("No players yet.")).toBeInTheDocument();
});

test("cancelling the delete prompt keeps the player", async () => {
  renderUser();

  fireEvent.click(await screen.findByRole("button", { name: "Delete Alice" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(deletePlayer).not.toHaveBeenCalled();
  expect(screen.getByText("Alice")).toBeInTheDocument();
});

test("an oversized avatar never leaves the browser", async () => {
  renderUser();
  await screen.findByText("Alice");

  const file = new File(["x"], "big.png", { type: "image/png" });
  // 5 MB is the backend's limit; the size is faked so no huge buffer is needed.
  Object.defineProperty(file, "size", { value: 5 * 1024 * 1024 + 1 });
  fireEvent.change(screen.getByLabelText("Avatar for Alice"), {
    target: { files: [file] },
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "larger than 5 MB",
  );
  expect(setPlayerAvatar).not.toHaveBeenCalled();
});

test("a rejected avatar upload is reported next to the player", async () => {
  setPlayerAvatar.mockRejectedValue({ detail: "unsupported_avatar_type" });
  renderUser();
  await screen.findByText("Alice");

  const file = new File(["not an image"], "cv.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Avatar for Alice"), {
    target: { files: [file] },
  });

  await waitFor(() =>
    expect(setPlayerAvatar.mock.calls[0][0]).toMatchObject({
      path: { player_id: "aaa" },
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Only jpeg, png and webp images work",
  );
});

test("an anonymous visitor gets the login form and the profile after logging in", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view", "players.view"]));
  login.mockResolvedValue({ data: userRead({ role: "trusted" }) });
  renderUser();

  await screen.findByRole("tab", { name: "Register" });
  // A guest without players.manage cannot add or delete players either.
  expect(screen.queryByLabelText("New player name")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Delete Alice" }),
  ).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: " Alice " },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "hunter2hunter2" },
  });
  // The answer to `/auth/me` changes with the session cookie the login sets.
  getMe.mockResolvedValue(
    meResponse(USER_CAPABILITIES, {
      user: userRead({ role: "trusted" }),
      role: "trusted",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));

  await waitFor(() =>
    expect(login.mock.calls[0][0].body).toEqual({
      username: "Alice",
      password: "hunter2hunter2",
    }),
  );
  expect(await screen.findByText("trusted")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  expect(screen.getByLabelText("New player name")).toBeInTheDocument();
});

test("a short password never reaches the backend", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view", "players.view"]));
  renderUser();

  fireEvent.click(await screen.findByRole("tab", { name: "Register" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bo" } });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "at least 3 characters",
  );

  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bob" } });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "short" },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "at least 8 characters",
  );
  expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();
  expect(register).not.toHaveBeenCalled();
});

test("a taken username is reported on the register form", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view", "players.view"]));
  register.mockRejectedValue({ detail: "duplicate_username" });
  renderUser();

  fireEvent.click(await screen.findByRole("tab", { name: "Register" }));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Alice" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "hunter2hunter2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));

  await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "That name is taken",
  );
});

test("the admin sections stay hidden for an ordinary account", async () => {
  renderUser();

  expect(await screen.findByText("Alice")).toBeInTheDocument();
  expect(screen.queryByText("Accounts")).not.toBeInTheDocument();
  expect(screen.queryByText("Permissions")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Settings" }),
  ).not.toBeInTheDocument();
  expect(listUsers).not.toHaveBeenCalled();
});

test("an admin can change a role and is stopped from removing the last admin", async () => {
  getMe.mockResolvedValue(
    meResponse(ADMIN_CAPABILITIES, {
      user: userRead({ role: "admin" }),
      role: "admin",
    }),
  );
  getPermissions.mockResolvedValue({
    data: { roles: { guest: [], admin: [] } },
  });
  listUsers.mockResolvedValue({
    data: {
      users: [
        userRead({ role: "admin" }),
        userRead({ id: "user-2", username: "Bob" }),
      ],
    },
  });
  updateUser.mockResolvedValue({
    data: userRead({ id: "user-2", role: "trusted" }),
  });
  renderUser();

  fireEvent.change(await screen.findByLabelText("Role of Bob"), {
    target: { value: "trusted" },
  });
  expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
    "href",
    "/settings",
  );

  await waitFor(() =>
    expect(updateUser.mock.calls[0][0]).toMatchObject({
      path: { user_id: "user-2" },
      body: { role: "trusted" },
    }),
  );

  deleteUser.mockRejectedValue({ detail: "last_admin" });
  fireEvent.click(screen.getByRole("button", { name: "Delete account Alice" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  expect(
    await screen.findByText("There has to be one administrator left."),
  ).toBeInTheDocument();
});
