import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { PlayerRead, ScoreWithContext } from "../api";
import { meResponse, userRead } from "../test/auth";
import User from "./User";

const {
  listPlayers,
  listPlayerScores,
  listFavorites,
  createPlayer,
  deletePlayer,
  setPlayerAvatar,
  getMe,
  login,
  register,
  logout,
  listUsers,
  oidcConfig,
} = vi.hoisted(() => ({
  listPlayers: vi.fn(),
  listPlayerScores: vi.fn(),
  listFavorites: vi.fn(),
  createPlayer: vi.fn(),
  deletePlayer: vi.fn(),
  setPlayerAvatar: vi.fn(),
  getMe: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  listUsers: vi.fn(),
  oidcConfig: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listPlayers,
  listPlayerScores,
  listFavorites,
  createPlayer,
  deletePlayer,
  setPlayerAvatar,
  getMe,
  login,
  register,
  logout,
  listUsers,
  oidcConfig,
}));

const USER_CAPABILITIES = [
  "songs.view",
  "karaoke.sing",
  "karaoke.stop",
  "players.view",
  "players.manage",
  "stats.view",
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

/** Shows what the router thinks the URL is, so a stripped parameter is visible. */
function LocationProbe() {
  return <span data-testid="search">{useLocation().search}</span>;
}

function renderUser(url = "/user") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // A router: the page links to its subpages and owns the `?login=` parameter.
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <User />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** A score of the logged-in singer, as `/stats/players/{id}/scores` returns it. */
function score(value: number, singId: string): ScoreWithContext {
  return {
    id: value,
    sing_id: singId,
    player_id: "aaa",
    player_name: "Alice",
    score: value,
    difficulty: 1,
    recorded_at: "2026-08-23T20:00:00Z",
    song: null,
    sing_started_at: "2026-08-23T19:55:00Z",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  listPlayers.mockResolvedValue({
    data: { players: [player("aaa", "Alice")] },
  });
  listPlayerScores.mockResolvedValue({ data: { scores: [] } });
  listFavorites.mockResolvedValue({ data: { song_ids: ["usdb:1", "usdb:2"] } });
  // A logged-in ordinary account: players are manageable, no admin sections.
  // Not named after a player, so the identity tile never collides with a row.
  getMe.mockResolvedValue(
    meResponse(USER_CAPABILITIES, {
      user: userRead({ username: "Charlie", player_id: "ccc" }),
      role: "user",
    }),
  );
  oidcConfig.mockResolvedValue({
    data: { enabled: false, display_name: "SSO" },
  });
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

  await screen.findByRole("button", { name: "New account" });
  expect(screen.getByRole("heading", { name: "You" })).toBeInTheDocument();
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

  fireEvent.click(await screen.findByRole("button", { name: "New account" }));
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

  fireEvent.click(await screen.findByRole("button", { name: "New account" }));
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

test("the manage menu stays hidden for an ordinary account", async () => {
  renderUser();

  expect(await screen.findByText("Alice")).toBeInTheDocument();
  expect(screen.queryByText("Manage")).not.toBeInTheDocument();
  expect(screen.queryByText("Accounts")).not.toBeInTheDocument();
  expect(screen.queryByText("Permissions")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Settings" }),
  ).not.toBeInTheDocument();
  expect(listUsers).not.toHaveBeenCalled();
});

test("an admin gets one menu row per admin surface, not the surfaces inline", async () => {
  getMe.mockResolvedValue(
    meResponse(ADMIN_CAPABILITIES, {
      user: userRead({ role: "admin" }),
      role: "admin",
    }),
  );
  renderUser();

  expect(await screen.findByText("Manage")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
    "href",
    "/settings",
  );
  expect(screen.getByRole("link", { name: "Accounts" })).toHaveAttribute(
    "href",
    "/user/accounts",
  );
  expect(screen.getByRole("link", { name: "Permissions" })).toHaveAttribute(
    "href",
    "/user/permissions",
  );
  // The account list itself lives on the subpage now.
  expect(listUsers).not.toHaveBeenCalled();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

test("the host screen gets an identity tile, and the login form only on request", async () => {
  getMe.mockResolvedValue(meResponse(ADMIN_CAPABILITIES, { is_host: true }));
  renderUser();

  expect(
    await screen.findByRole("heading", { name: "Host screen" }),
  ).toBeInTheDocument();
  expect(screen.getByText("This browser has full access.")).toBeInTheDocument();
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();

  fireEvent.click(
    screen.getByRole("button", { name: "Log in as a user instead" }),
  );

  expect(screen.getByLabelText("Password")).toBeInTheDocument();
  expect(screen.getByLabelText("Name")).toBeInTheDocument();
});

test("the SSO button appears only when the provider is configured", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view", "players.view"]));
  oidcConfig.mockResolvedValue({
    data: { enabled: true, display_name: "Keycloak" },
  });
  renderUser();

  // A full navigation, not a fetch: the answer is a redirect to the provider.
  expect(
    await screen.findByRole("link", { name: "Sign in with Keycloak" }),
  ).toHaveAttribute("href", "/api/v1/auth/oidc/login");
});

test("the SSO button stays hidden when the provider is switched off", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view", "players.view"]));
  renderUser();

  await screen.findByRole("button", { name: "New account" });
  await waitFor(() => expect(oidcConfig).toHaveBeenCalled());
  expect(screen.queryByRole("link", { name: /Sign in with/ })).toBeNull();
});

test("a failed SSO round trip explains itself and leaves no parameter behind", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view", "players.view"]));
  renderUser("/user?login=error:invalid_state");

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "took too long or was already used",
  );
  // A reload must not repeat the notice.
  expect(screen.getByTestId("search")).toHaveTextContent("");
});

test("an unknown SSO failure falls back to the generic notice", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view", "players.view"]));
  renderUser("/user?login=error:something_new");

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The sign-in did not work.",
  );
});

test("a successful SSO login only strips the parameter", async () => {
  renderUser("/user?login=ok");

  // The cookie was set before the redirect, so /auth/me already answers as the
  // account — nothing to do but clean the URL.
  expect(
    await screen.findByRole("button", { name: "Log out" }),
  ).toBeInTheDocument();
  expect(screen.getByTestId("search")).toHaveTextContent("");
  expect(screen.queryByRole("alert")).toBeNull();
});

/** The logged-in account is the one that owns the listed player. */
function loggedInAsAlice(capabilities: string[] = USER_CAPABILITIES) {
  getMe.mockResolvedValue(
    meResponse(capabilities, {
      user: userRead({ username: "Alice", player_id: "aaa" }),
      role: "user",
    }),
  );
}

test("the account's own totals are summed up under the identity", async () => {
  loggedInAsAlice();
  listPlayerScores.mockResolvedValue({
    data: { scores: [score(9000, "s1"), score(8000, "s2")] },
  });
  renderUser();

  expect(await screen.findByText("Sings")).toBeInTheDocument();
  await waitFor(() =>
    expect(listPlayerScores.mock.calls[0][0].path).toEqual({
      player_id: "aaa",
    }),
  );
  expect(screen.getByText("Sings").previousSibling).toHaveTextContent("2");
  expect(screen.getByText("Best").previousSibling).toHaveTextContent("9000");
  expect(screen.getByText("Average").previousSibling).toHaveTextContent("8500");
  // Both scores are on songs that have left the library: one unknown song.
  expect(screen.getByText("Songs").previousSibling).toHaveTextContent("1");
  // The account's favorites, which belong to it rather than to the player.
  expect(screen.getByText("Favorites").previousSibling).toHaveTextContent("2");
  // Not on the user's own page: nobody needs their flops counted for them.
  expect(screen.queryByText("Worst")).not.toBeInTheDocument();
});

test("the favorites count waits until it is known", async () => {
  loggedInAsAlice();
  listPlayerScores.mockResolvedValue({ data: { scores: [score(9000, "s1")] } });
  listFavorites.mockRejectedValue(new Error("no"));
  renderUser();

  expect(await screen.findByText("Sings")).toBeInTheDocument();
  // A count that starts at zero and jumps reads as a number that changed.
  expect(screen.queryByText("Favorites")).not.toBeInTheDocument();
});

test("a singer without scores is asked to sing instead of shown zeroes", async () => {
  loggedInAsAlice();
  renderUser();

  expect(
    await screen.findByText("Sing a song and your stats appear here."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Average")).not.toBeInTheDocument();
});

test("stats stay away from a role that may not see statistics", async () => {
  loggedInAsAlice(USER_CAPABILITIES.filter((name) => name !== "stats.view"));
  renderUser();

  await screen.findByRole("button", { name: "Log out" });
  expect(listPlayerScores).not.toHaveBeenCalled();
  expect(screen.queryByText("Sings")).not.toBeInTheDocument();
  expect(
    screen.queryByText("Sing a song and your stats appear here."),
  ).not.toBeInTheDocument();
});

test("the identity avatar is the way to change the own picture", async () => {
  loggedInAsAlice();
  setPlayerAvatar.mockResolvedValue({ data: player("aaa", "Alice") });
  renderUser();

  const file = new File(["png"], "me.png", { type: "image/png" });
  fireEvent.change(await screen.findByLabelText("Change your picture"), {
    target: { files: [file] },
  });

  await waitFor(() =>
    expect(setPlayerAvatar.mock.calls[0][0]).toMatchObject({
      path: { player_id: "aaa" },
    }),
  );
});

test("a rejected own picture is reported in the tile, not twice", async () => {
  loggedInAsAlice();
  setPlayerAvatar.mockRejectedValue({ detail: "unsupported_avatar_type" });
  renderUser();

  const file = new File(["not an image"], "cv.png", { type: "image/png" });
  fireEvent.change(await screen.findByLabelText("Change your picture"), {
    target: { files: [file] },
  });

  const alerts = await screen.findAllByRole("alert");
  // The same player also has a row in the list below; the failure belongs to
  // the uploader that was used, and only to that one.
  expect(alerts).toHaveLength(1);
  expect(alerts[0]).toHaveTextContent("Only jpeg, png and webp images work");
});

test("an oversized own picture never leaves the browser", async () => {
  loggedInAsAlice();
  renderUser();

  const file = new File(["x"], "big.png", { type: "image/png" });
  Object.defineProperty(file, "size", { value: 5 * 1024 * 1024 + 1 });
  fireEvent.change(await screen.findByLabelText("Change your picture"), {
    target: { files: [file] },
  });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "larger than 5 MB",
  );
  expect(setPlayerAvatar).not.toHaveBeenCalled();
});

test("without players.manage the identity avatar is not an uploader", async () => {
  loggedInAsAlice(
    USER_CAPABILITIES.filter((name) => name !== "players.manage"),
  );
  renderUser();

  await screen.findByRole("button", { name: "Log out" });
  expect(
    screen.queryByLabelText("Change your picture"),
  ).not.toBeInTheDocument();
});
