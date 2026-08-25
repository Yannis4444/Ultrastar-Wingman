import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PlayerRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import UserAccounts from "./UserAccounts";

const {
  getMe,
  listUsers,
  updateUser,
  deleteUser,
  listPlayers,
  createPlayer,
  deletePlayer,
  setPlayerAvatar,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  listUsers: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  listPlayers: vi.fn(),
  createPlayer: vi.fn(),
  deletePlayer: vi.fn(),
  setPlayerAvatar: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listUsers,
  updateUser,
  deleteUser,
  listPlayers,
  createPlayer,
  deletePlayer,
  setPlayerAvatar,
}));

const PLAYER_CAPABILITIES = ["players.view", "players.manage"];
const ADMIN_CAPABILITIES = [...PLAYER_CAPABILITIES, "users.manage"];

function player(id: string, name: string, registered = false): PlayerRead {
  return { id, name, registered, has_avatar: false };
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
      user: userRead({ role: "admin" }),
      role: "admin",
    }),
  );
  listUsers.mockResolvedValue({
    data: {
      users: [
        userRead({ role: "admin" }),
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
  getMe.mockResolvedValue(meResponse(["players.view"]));
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

test("without either right the page explains itself and asks nothing", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  renderPage();

  expect(
    await screen.findByText(/Players and accounts are for the host/),
  ).toBeInTheDocument();
  expect(listUsers).not.toHaveBeenCalled();
  expect(listPlayers).not.toHaveBeenCalled();
});

test("the own account is marked and a role can be changed", async () => {
  updateUser.mockResolvedValue({
    data: userRead({ id: "user-2", role: "trusted" }),
  });
  renderPage();

  // Alice is the caller, so her row carries the marker.
  expect(await screen.findByText("(you)")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Role of Bob"), {
    target: { value: "trusted" },
  });

  await waitFor(() =>
    expect(updateUser.mock.calls[0][0]).toMatchObject({
      path: { user_id: "user-2" },
      body: { role: "trusted" },
    }),
  );
  // A guest has no account, so there is no role to pick for one.
  expect(screen.queryByLabelText("Role of Mallory")).not.toBeInTheDocument();
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
  expect(screen.getByLabelText("Role of Dana")).toBeInTheDocument();
  // No player, so nothing to upload a picture for.
  expect(screen.queryByLabelText("Avatar for Dana")).not.toBeInTheDocument();
});

test("managing only the accounts never asks for the players", async () => {
  getMe.mockResolvedValue(
    meResponse(["users.manage"], {
      user: userRead({ role: "admin" }),
      role: "admin",
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
  expect(screen.queryByLabelText("Role of Alice")).not.toBeInTheDocument();
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
  getMe.mockResolvedValue(meResponse(["players.view"]));
  renderPage();

  await screen.findByText("Mallory");
  expect(screen.queryByLabelText("New player name")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Delete Mallory" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Avatar for Mallory")).not.toBeInTheDocument();
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
  expect(alerts[0]).toHaveTextContent("Only jpeg, png and webp images work");
});

test("a roster that cannot be loaded says so", async () => {
  listPlayers.mockRejectedValue(new Error("nope"));
  renderPage();

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load the players.",
  );
});
