import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { GroupRead, PlayerRead } from "../api";
import {
  AS,
  MEMBER_OF,
  TRUSTED_GROUP_ID,
  meResponse,
  userRead,
} from "../test/auth";
import UserAccounts from "./UserAccounts";

const {
  getMe,
  listUsers,
  listGroups,
  setUserGroups,
  deleteUser,
  listPlayers,
  createPlayer,
  deletePlayer,
  setPlayerAvatar,
  updatePlayer,
  oidcConfig,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  listUsers: vi.fn(),
  listGroups: vi.fn(),
  setUserGroups: vi.fn(),
  deleteUser: vi.fn(),
  listPlayers: vi.fn(),
  createPlayer: vi.fn(),
  deletePlayer: vi.fn(),
  setPlayerAvatar: vi.fn(),
  updatePlayer: vi.fn(),
  oidcConfig: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listUsers,
  listGroups,
  setUserGroups,
  deleteUser,
  listPlayers,
  createPlayer,
  deletePlayer,
  setPlayerAvatar,
  updatePlayer,
  oidcConfig,
}));

function group(id: string, name: string): GroupRead {
  const builtIn = id === "guest" || id === "user" || id === "admin";
  return {
    id,
    name,
    built_in: builtIn,
    member_count: 1,
    capabilities: null,
    right_count: null,
    can_assign: id !== "guest" && id !== "user",
  };
}

const GROUPS: GroupRead[] = [
  group("guest", "Guest"),
  group("user", "User"),
  group(TRUSTED_GROUP_ID, "Trusted"),
  group("admin", "Admin"),
];

// What `trusted` holds over the players: the roster, the pictures, and adding
// and deleting people.
const PLAYER_CAPABILITIES = [
  "players.view",
  "players.avatar",
  "players.manage",
];
const ADMIN_CAPABILITIES = [...PLAYER_CAPABILITIES, "users.manage"];

function player(
  id: string,
  name: string,
  registered = false,
  hidden = false,
): PlayerRead {
  return { id, name, registered, hidden, has_avatar: false };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/user/accounts"]}>
        <UserAccounts />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The rows under one of the two headings. */
function section(name: string): HTMLElement {
  return screen.getByRole("list", { name });
}

beforeEach(() => {
  vi.resetAllMocks();
  // The admin browser: logged in as Alice, allowed to manage both.
  getMe.mockResolvedValue(
    meResponse(ADMIN_CAPABILITIES, {
      user: userRead({ groups: MEMBER_OF.admin }),
      ...AS.admin,
    }),
  );
  listGroups.mockResolvedValue({
    data: { groups: GROUPS, capabilities: null },
  });
  listUsers.mockResolvedValue({
    data: {
      users: [
        userRead({ groups: MEMBER_OF.admin }),
        userRead({ id: "user-2", username: "Bob", player_id: "bbb" }),
      ],
    },
  });
  // Alice and Bob log in, Mallory sings as a guest.
  listPlayers.mockResolvedValue({
    data: {
      players: [
        player("aaa", "Alice", true),
        player("bbb", "Bob", true),
        player("mmm", "Mallory"),
      ],
    },
  });
});

test("the back link leads to the user page", async () => {
  renderPage();

  expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
    "href",
    "/user",
  );
  expect(
    screen.getByRole("heading", { name: "Players & accounts" }),
  ).toBeInTheDocument();
  expect(await screen.findByText("Bob")).toBeInTheDocument();
});

test("accounts and guests stand in one view, under a heading each", async () => {
  renderPage();

  await screen.findByText("Mallory");
  // The section is the mark: no badge repeats it per row.
  expect(within(section("Accounts")).getByText("Alice")).toBeInTheDocument();
  expect(within(section("Accounts")).getByText("Bob")).toBeInTheDocument();
  expect(
    within(section("Accounts")).queryByText("Mallory"),
  ).not.toBeInTheDocument();
  expect(within(section("Guests")).getByText("Mallory")).toBeInTheDocument();
  expect(screen.queryByText("guest")).not.toBeInTheDocument();
});

test("somebody with an account stands in the list exactly once", async () => {
  renderPage();

  await screen.findByText("Mallory");
  // Bob is a player *and* an account; the two sides are one person, one row.
  expect(screen.getAllByText("Bob")).toHaveLength(1);
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
});

test("an empty group says so only once the answer is in", async () => {
  listPlayers.mockResolvedValue({ data: { players: [] } });
  let answerUsers = (): void => {};
  listUsers.mockReturnValue(
    new Promise((resolve) => {
      answerUsers = () => resolve({ data: { users: [] } });
    }),
  );
  renderPage();

  // The headings follow from the rights, so they are there at once — but a
  // verdict about who is in them must wait for the lists.
  await screen.findByRole("heading", { name: "Accounts" });
  expect(
    screen.queryByText("Nobody has registered yet."),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("No guests yet.")).not.toBeInTheDocument();

  answerUsers();

  expect(
    await screen.findByText("Nobody has registered yet."),
  ).toBeInTheDocument();
  expect(screen.getByText("No guests yet.")).toBeInTheDocument();
});

test("a party nobody has joined yet needs no groups at all", async () => {
  // The pictures right alone: enough to open the page, nothing to add anybody
  // with, so neither heading has a reason to stand there.
  getMe.mockResolvedValue(meResponse(["players.view", "players.avatar"]));
  listPlayers.mockResolvedValue({ data: { players: [] } });
  renderPage();

  expect(await screen.findByText("No players yet.")).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Accounts" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Guests" }),
  ).not.toBeInTheDocument();
});

test("seeing the players is not on its own a reason to open this page", async () => {
  // Every guest phone holds `players.view` for the singer picker; the page is
  // for the four rights that actually do something here.
  getMe.mockResolvedValue(meResponse(["songs.view", "players.view"]));
  renderPage();

  expect(
    await screen.findByText(/Players and accounts are for the host/),
  ).toBeInTheDocument();
  expect(listUsers).not.toHaveBeenCalled();
  expect(listPlayers).not.toHaveBeenCalled();
});

test("the own account is marked and its groups can be changed", async () => {
  setUserGroups.mockResolvedValue({
    data: userRead({ id: "user-2", groups: MEMBER_OF.trusted }),
  });
  renderPage();

  // Alice is the caller, so her row carries the marker.
  expect(await screen.findByText("(you)")).toBeInTheDocument();
  await within(await screen.findByLabelText("Groups of Bob")).findByRole(
    "option",
    { name: "Put in Trusted" },
  );
  // Bob is in no group, so the select reads User.
  expect(screen.getByLabelText("Groups of Bob")).toHaveAttribute(
    "title",
    "User",
  );

  fireEvent.change(screen.getByLabelText("Groups of Bob"), {
    target: { value: TRUSTED_GROUP_ID },
  });

  await waitFor(() =>
    expect(setUserGroups.mock.calls[0][0]).toMatchObject({
      path: { user_id: "user-2" },
      body: { groups: [TRUSTED_GROUP_ID] },
    }),
  );
  // A guest has no account, so there are no groups to pick for one.
  expect(screen.queryByLabelText("Groups of Mallory")).not.toBeInTheDocument();
});

test("picking a group the account is in takes it out of it", async () => {
  listUsers.mockResolvedValue({
    data: {
      users: [
        userRead({ groups: MEMBER_OF.admin }),
        userRead({
          id: "user-2",
          username: "Bob",
          player_id: "bbb",
          groups: MEMBER_OF.trusted,
        }),
      ],
    },
  });
  setUserGroups.mockResolvedValue({ data: userRead({ id: "user-2" }) });
  renderPage();

  await within(await screen.findByLabelText("Groups of Bob")).findByRole(
    "option",
    { name: "Take out of Trusted" },
  );
  expect(screen.getByLabelText("Groups of Bob")).toHaveAttribute(
    "title",
    "Trusted",
  );
  fireEvent.change(screen.getByLabelText("Groups of Bob"), {
    target: { value: TRUSTED_GROUP_ID },
  });

  await waitFor(() =>
    expect(setUserGroups.mock.calls[0][0]).toMatchObject({
      path: { user_id: "user-2" },
      body: { groups: [] },
    }),
  );
});

test("each heading explains itself", async () => {
  renderPage();

  await screen.findByText("Mallory");
  // The way out of a forgotten password, and what registering a guest's name does.
  expect(
    screen.getByText(/delete the account and register the same name again/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/taken over by whoever registers that name/),
  ).toBeInTheDocument();
});

test("the eye takes a player out of the singer picker and back", async () => {
  updatePlayer.mockResolvedValue({
    data: player("mmm", "Mallory", false, true),
  });
  renderPage();

  const eye = await screen.findByRole("button", {
    name: "Hide Mallory from player selection",
  });
  expect(eye).toHaveAttribute("aria-pressed", "false");

  listPlayers.mockResolvedValue({
    data: {
      players: [
        player("aaa", "Alice", true),
        player("bbb", "Bob", true),
        player("mmm", "Mallory", false, true),
      ],
    },
  });
  fireEvent.click(eye);

  await waitFor(() =>
    expect(updatePlayer.mock.calls[0][0]).toMatchObject({
      path: { player_id: "mmm" },
      body: { hidden: true },
    }),
  );
  // The row stays: hiding is not a deletion, and the name only goes quiet.
  await waitFor(() =>
    expect(
      screen.getByRole("button", {
        name: "Hide Mallory from player selection",
      }),
    ).toHaveAttribute("aria-pressed", "true"),
  );
  expect(screen.getByText("Mallory")).toHaveClass("people-name-hidden");

  fireEvent.click(
    screen.getByRole("button", { name: "Hide Mallory from player selection" }),
  );
  await waitFor(() =>
    expect(updatePlayer.mock.calls[1][0].body).toEqual({ hidden: false }),
  );
});

test("hiding somebody takes the player right", async () => {
  getMe.mockResolvedValue(meResponse(["players.view", "players.avatar"]));
  renderPage();

  await screen.findByText("Mallory");
  expect(
    screen.queryByRole("button", {
      name: "Hide Mallory from player selection",
    }),
  ).not.toBeInTheDocument();
});

test("removing the last admin is stopped with an explanation", async () => {
  deleteUser.mockRejectedValue({ detail: "last_admin" });
  renderPage();

  fireEvent.click(
    await screen.findByRole("button", { name: "Delete account Alice" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  expect(
    await screen.findByText("There has to be one administrator left."),
  ).toBeInTheDocument();
});

test("deleting an account says what happens to its player", async () => {
  deleteUser.mockResolvedValue({ data: undefined });
  renderPage();

  fireEvent.click(
    await screen.findByRole("button", { name: "Delete account Bob" }),
  );
  expect(
    screen.getByRole("dialog", { name: "Delete account" }),
  ).toHaveTextContent("Its player stays as a guest");
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  await waitFor(() =>
    expect(deleteUser.mock.calls[0][0].path).toEqual({ user_id: "user-2" }),
  );
  // The player behind an account is never deleted from here: it becomes a guest
  // first, and the guest row is where it can go.
  expect(deletePlayer).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Delete Bob" }),
  ).not.toBeInTheDocument();
});

test("an account whose player is gone is still listed and manageable", async () => {
  listUsers.mockResolvedValue({
    data: {
      users: [userRead({ id: "user-3", username: "Dana", player_id: null })],
    },
  });
  listPlayers.mockResolvedValue({ data: { players: [] } });
  renderPage();

  await screen.findByText("Dana");
  expect(within(section("Accounts")).getByText("Dana")).toBeInTheDocument();
  expect(screen.getByLabelText("Groups of Dana")).toBeInTheDocument();
  // No player, so nothing to upload a picture for.
  expect(screen.queryByLabelText("Avatar for Dana")).not.toBeInTheDocument();
});

test("managing only the accounts never asks for the players", async () => {
  getMe.mockResolvedValue(
    meResponse(["users.manage"], {
      user: userRead({ groups: MEMBER_OF.admin }),
      ...AS.admin,
    }),
  );
  renderPage();

  expect(
    within(await screen.findByRole("list", { name: "Accounts" })).getByText(
      "Bob",
    ),
  ).toBeInTheDocument();
  expect(listPlayers).not.toHaveBeenCalled();
  // Nothing to add or delete players with, so the guest section stays away.
  expect(
    screen.queryByRole("heading", { name: "Guests" }),
  ).not.toBeInTheDocument();
});

test("a player manager sees the people but no account controls", async () => {
  getMe.mockResolvedValue(meResponse(PLAYER_CAPABILITIES));
  renderPage();

  await screen.findByText("Mallory");
  expect(listUsers).not.toHaveBeenCalled();
  // `registered` marks the accounts even for somebody who may not see them.
  expect(within(section("Accounts")).getByText("Alice")).toBeInTheDocument();
  expect(screen.queryByLabelText("Groups of Alice")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Delete account Alice" }),
  ).not.toBeInTheDocument();
  // A registered player is not deleted behind its account's back either.
  expect(
    screen.queryByRole("button", { name: "Delete Alice" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Delete Mallory" }),
  ).toBeInTheDocument();
});

test("only looking on means no form, no delete and no uploader", async () => {
  // `users.view` opens the page read-only: who is here and who has an account,
  // and not one control over either.
  getMe.mockResolvedValue(meResponse(["players.view", "users.view"]));
  renderPage();

  await screen.findByText("Mallory");
  expect(screen.queryByLabelText("New player name")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Delete Mallory" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Avatar for Mallory")).not.toBeInTheDocument();
  // Read-only over the accounts too: the names, never the groups.
  expect(screen.queryByLabelText("Groups of Alice")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Delete account Alice" }),
  ).not.toBeInTheDocument();
});

test("the pictures right hands out the uploaders and nothing else", async () => {
  getMe.mockResolvedValue(meResponse(["players.view", "players.avatar"]));
  renderPage();

  await screen.findByText("Mallory");
  expect(screen.getByLabelText("Avatar for Mallory")).toBeInTheDocument();
  expect(screen.queryByLabelText("New player name")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Delete Mallory" }),
  ).not.toBeInTheDocument();
});

test("a new player joins the guests", async () => {
  createPlayer.mockResolvedValue({ data: player("nnn", "Nina") });
  getMe.mockResolvedValue(meResponse(PLAYER_CAPABILITIES));
  renderPage();
  await screen.findByText("Mallory");

  listPlayers.mockResolvedValue({
    data: {
      players: [
        player("aaa", "Alice", true),
        player("mmm", "Mallory"),
        player("nnn", "Nina"),
      ],
    },
  });
  fireEvent.change(screen.getByLabelText("New player name"), {
    target: { value: "  Nina  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  await waitFor(() =>
    expect(createPlayer.mock.calls[0][0].body).toEqual({ name: "Nina" }),
  );
  expect(await screen.findByText("Nina")).toBeInTheDocument();
  expect(within(section("Guests")).getByText("Nina")).toBeInTheDocument();
});

test("a duplicate name is reported instead of silently failing", async () => {
  createPlayer.mockRejectedValue({ detail: "duplicate_name" });
  renderPage();
  await screen.findByText("Mallory");

  fireEvent.change(screen.getByLabelText("New player name"), {
    target: { value: "Mallory" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "There is already a player with that name.",
  );
  expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
});

test("deleting a guest asks for confirmation first", async () => {
  deletePlayer.mockResolvedValue({ data: undefined });
  renderPage();

  fireEvent.click(
    await screen.findByRole("button", { name: "Delete Mallory" }),
  );
  expect(deletePlayer).not.toHaveBeenCalled();

  const confirm = screen.getByRole("dialog", { name: "Delete player" });
  expect(confirm).toHaveTextContent('Delete "Mallory"?');

  listPlayers.mockResolvedValue({
    data: {
      players: [player("aaa", "Alice", true), player("bbb", "Bob", true)],
    },
  });
  // The row button is labelled "Delete Mallory", so this is the prompt's button.
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  await waitFor(() =>
    expect(deletePlayer.mock.calls[0][0].path).toEqual({ player_id: "mmm" }),
  );
  expect(await screen.findByText("No guests yet.")).toBeInTheDocument();
});

test("cancelling the delete prompt keeps the player", async () => {
  renderPage();

  fireEvent.click(
    await screen.findByRole("button", { name: "Delete Mallory" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(deletePlayer).not.toHaveBeenCalled();
  expect(screen.getByText("Mallory")).toBeInTheDocument();
});

test("an oversized avatar never leaves the browser", async () => {
  renderPage();
  await screen.findByText("Mallory");

  const file = new File(["x"], "big.png", { type: "image/png" });
  // 5 MB is the backend's limit; the size is faked so no huge buffer is needed.
  Object.defineProperty(file, "size", { value: 5 * 1024 * 1024 + 1 });
  fireEvent.change(screen.getByLabelText("Avatar for Mallory"), {
    target: { files: [file] },
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "larger than 5 MB",
  );
  expect(setPlayerAvatar).not.toHaveBeenCalled();
});

test("a rejected avatar upload is reported next to that person", async () => {
  setPlayerAvatar.mockRejectedValue({ detail: "unsupported_avatar_type" });
  renderPage();
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
  const alerts = await screen.findAllByRole("alert");
  expect(alerts).toHaveLength(1);
  expect(alerts[0]).toHaveTextContent("Only jpeg, png, and webp images work");
});

test("a roster that cannot be loaded says so", async () => {
  listPlayers.mockRejectedValue(new Error("nope"));
  renderPage();

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load the players.",
  );
});

test("an account single sign-on answers for says so under its name", async () => {
  oidcConfig.mockResolvedValue({
    data: { enabled: true, display_name: "Keycloak" },
  });
  listUsers.mockResolvedValue({
    data: {
      users: [
        userRead({ groups: MEMBER_OF.admin, auth_provider: "local" }),
        userRead({
          id: "user-2",
          username: "Bob",
          player_id: "bbb",
          auth_provider: "oidc",
        }),
      ],
    },
  });
  renderPage();

  const bob = (await screen.findByText("Bob")).closest("li");
  expect(bob).not.toBeNull();
  expect(
    await within(bob as HTMLElement).findByText("Signs in with Keycloak"),
  ).toBeInTheDocument();
  // A quiet line on that row alone: Alice has a password here.
  expect(screen.getAllByText(/Signs in with/)).toHaveLength(1);
});

test("the note reads without the provider's name until it is known", async () => {
  oidcConfig.mockReturnValue(new Promise(() => {}));
  listUsers.mockResolvedValue({
    data: {
      users: [userRead({ groups: MEMBER_OF.admin, auth_provider: "oidc" })],
    },
  });
  renderPage();

  expect(
    await screen.findByText("Signs in with single sign-on"),
  ).toBeInTheDocument();
});

test("nobody asks for the provider while no account uses it", async () => {
  renderPage();
  await screen.findByText("Mallory");

  expect(screen.queryByText(/Signs in with/)).not.toBeInTheDocument();
  expect(oidcConfig).not.toHaveBeenCalled();
});
