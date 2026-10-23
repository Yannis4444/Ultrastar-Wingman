import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { PlayerRead, ScoreWithContext } from "../api";
import {
  achievementRead,
  achievementSettings,
  playerAchievementRead,
} from "../test/achievements";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import User from "./User";

const {
  listPlayers,
  listPlayerScores,
  listFavorites,
  setPlayerAvatar,
  getMe,
  login,
  register,
  logout,
  listUsers,
  oidcConfig,
  oidcPending,
  completeOidcLogin,
  forgetOidcLogin,
  health,
  listAchievements,
  listPlayerAchievements,
  getDeviceStatus,
  listUnknownCards,
  listMyCards,
} = vi.hoisted(() => ({
  listPlayers: vi.fn(),
  listPlayerScores: vi.fn(),
  listFavorites: vi.fn(),
  setPlayerAvatar: vi.fn(),
  getMe: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  listUsers: vi.fn(),
  oidcConfig: vi.fn(),
  oidcPending: vi.fn(),
  completeOidcLogin: vi.fn(),
  forgetOidcLogin: vi.fn(),
  health: vi.fn(),
  listAchievements: vi.fn(),
  listPlayerAchievements: vi.fn(),
  getDeviceStatus: vi.fn(),
  listUnknownCards: vi.fn(),
  listMyCards: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listPlayers,
  listPlayerScores,
  listFavorites,
  setPlayerAvatar,
  getMe,
  login,
  register,
  logout,
  listUsers,
  oidcConfig,
  oidcPending,
  completeOidcLogin,
  forgetOidcLogin,
  health,
  listAchievements,
  listPlayerAchievements,
  getDeviceStatus,
  listUnknownCards,
  listMyCards,
}));

// What a plain account holds: no right over anybody else's player, and none is
// needed for the picture of the one it sings as.
const USER_CAPABILITIES = [
  "songs.view",
  "karaoke.sing",
  "karaoke.stop",
  "players.view",
  "stats.view",
  "stats.history",
];

// A helper: the players page and everything on it but the accounts.
const TRUSTED_CAPABILITIES = [
  ...USER_CAPABILITIES,
  "players.avatar",
  "players.manage",
];

const ADMIN_CAPABILITIES = [
  ...TRUSTED_CAPABILITIES,
  "users.manage",
  "permissions.manage",
  "settings.view",
  "tags.manage",
];

function player(id: string, name: string): PlayerRead {
  return { id, name, registered: false, hidden: false, has_avatar: false };
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
    placement: null,
    field_size: null,
    recorded_at: "2026-08-23T20:00:00Z",
    song: null,
    sing_started_at: "2026-08-23T19:55:00Z",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  // The badge section listens on the socket, and no test may open a real one.
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  listPlayers.mockResolvedValue({
    data: { players: [player("aaa", "Alice")] },
  });
  // An instance with achievements switched on and one to reach for; the
  // singer's own record is empty until a test says otherwise.
  listAchievements.mockResolvedValue({
    data: {
      achievements: [achievementRead()],
      settings: achievementSettings(),
    },
  });
  listPlayerAchievements.mockResolvedValue({ data: { achievements: [] } });
  // No player selector in the room, so *My cards* has nothing to say: a test
  // that wants the block puts a device there itself.
  getDeviceStatus.mockResolvedValue({ data: { online: false } });
  listUnknownCards.mockResolvedValue({ data: { uids: [] } });
  listMyCards.mockResolvedValue({ data: { cards: [] } });
  listPlayerScores.mockResolvedValue({ data: { scores: [] } });
  listFavorites.mockResolvedValue({ data: { song_ids: ["usdb:1", "usdb:2"] } });
  // A logged-in ordinary account: nothing to manage, no admin sections.
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
  // No sign-on waiting to be named: the ordinary answer for every browser that
  // did not just come back from the provider.
  oidcPending.mockRejectedValue({ detail: "no_pending_login" });
  health.mockResolvedValue({
    data: { name: "Ultrastar Wingman", version: "0.4.2" },
  });
});

afterEach(() => vi.unstubAllGlobals());

test("an anonymous visitor gets the login form and the profile after logging in", async () => {
  // `players.view` is a guest capability, so this is what a stranger holds.
  getMe.mockResolvedValue(meResponse(["songs.view", "players.view"]));
  login.mockResolvedValue({ data: userRead({ role: "trusted" }) });
  renderUser();

  await screen.findByRole("button", { name: "New account" });
  expect(screen.getByRole("heading", { name: "You" })).toBeInTheDocument();
  // Nothing to manage without a single right for it — looking at the roster is
  // not one, or every party guest would get a "Manage" heading.
  expect(screen.queryByText("Manage")).not.toBeInTheDocument();
  // And no account, so no own player to look up either.
  expect(listPlayers).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: " Alice " },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "hunter2hunter2" },
  });
  // The answer to `/auth/me` changes with the session cookie the login sets.
  getMe.mockResolvedValue(
    meResponse(TRUSTED_CAPABILITIES, {
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
  // The players are a page of their own now, and the account may reach it.
  expect(
    screen.getByRole("link", { name: "Players & accounts" }),
  ).toHaveAttribute("href", "/user/accounts");
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

test("an ordinary account has nothing to manage", async () => {
  renderUser();

  expect(await screen.findByText("Charlie")).toBeInTheDocument();
  // Adding and deleting people starts at `trusted`, and reading the roster is
  // not a reason of its own to open the page — so no "Manage" heading at all.
  expect(screen.queryByText("Manage")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Players & accounts" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Permissions")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Settings" }),
  ).not.toBeInTheDocument();
  expect(listUsers).not.toHaveBeenCalled();
});

test("a helper reaches the players page, and nothing else", async () => {
  getMe.mockResolvedValue(
    meResponse(TRUSTED_CAPABILITIES, {
      user: userRead({ id: "user-3", username: "Charlie", role: "trusted" }),
      role: "trusted",
    }),
  );
  renderUser();

  expect(await screen.findByText("Charlie")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Players & accounts" }),
  ).toHaveAttribute("href", "/user/accounts");
  expect(screen.queryByText("Permissions")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Settings" }),
  ).not.toBeInTheDocument();
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
  expect(
    screen.getByRole("link", { name: "Players & accounts" }),
  ).toHaveAttribute("href", "/user/accounts");
  expect(screen.getByRole("link", { name: "Tags" })).toHaveAttribute(
    "href",
    "/user/tags",
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
  getMe.mockResolvedValue(
    meResponse(ADMIN_CAPABILITIES, { is_host: true, role: "admin" }),
  );
  renderUser();

  expect(
    await screen.findByRole("heading", { name: "Host screen" }),
  ).toBeInTheDocument();
  // The same role line an account's tile carries: the host is an admin.
  expect(screen.getByText("admin")).toHaveClass("user-identity-role");
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Log in as a user" }));

  expect(screen.getByLabelText("Password")).toBeInTheDocument();
  expect(screen.getByLabelText("Name")).toBeInTheDocument();
  // The way in goes once it has been taken: the form is under the tile.
  expect(
    screen.queryByRole("button", { name: "Log in as a user" }),
  ).not.toBeInTheDocument();
});

test("an account's tile is the picture beside its name, role and the way out", async () => {
  loggedInAsAlice();
  renderUser();

  await screen.findByLabelText("Change your picture");
  const name = screen.getByRole("heading", { level: 1 });
  const head = name.closest(".user-identity-head");
  expect(head).not.toBeNull();
  // One head: the picture (the upload label) and the text column side by side,
  // the name, the role word and Log out stacked in that column.
  expect(
    head?.querySelector(":scope > .user-identity-avatar-label"),
  ).not.toBeNull();
  const column = head?.querySelector(":scope > .user-identity-text");
  expect(
    Array.from(column?.children ?? []).map((child) => child.className),
  ).toEqual([
    "user-identity-name",
    "user-identity-role",
    "button user-identity-action",
  ]);
  expect(screen.getByRole("button", { name: "Log out" })).toBe(
    column?.lastElementChild,
  );
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

test("a first sign-on is asked for a name, and logging in follows from it", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view", "players.view"]));
  oidcPending.mockResolvedValue({ data: { username: "singer-2" } });
  completeOidcLogin.mockResolvedValue({
    data: userRead({ username: "Yannis", player_id: "ccc" }),
  });
  renderUser("/user?login=choose_name");

  // The name the provider would have given, and no login form behind it.
  expect(await screen.findByLabelText("Your name")).toHaveValue("singer-2");
  expect(screen.queryByRole("button", { name: "New account" })).toBeNull();

  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: "Yannis" },
  });
  // The session cookie the completion sets is what /auth/me answers to next.
  getMe.mockResolvedValue(
    meResponse(USER_CAPABILITIES, {
      user: userRead({ username: "Yannis", player_id: "ccc" }),
      role: "user",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));

  expect(
    await screen.findByRole("button", { name: "Log out" }),
  ).toBeInTheDocument();
  expect(completeOidcLogin).toHaveBeenCalledWith(
    expect.objectContaining({ body: { username: "Yannis" } }),
  );
});

test("giving the name up leads back to the login form", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view", "players.view"]));
  oidcPending.mockResolvedValue({ data: { username: "singer" } });
  forgetOidcLogin.mockResolvedValue({ data: undefined });
  renderUser("/user?login=choose_name");

  await screen.findByLabelText("Your name");
  // The pending login is gone from here on, so the refetch finds none.
  oidcPending.mockRejectedValue({ detail: "no_pending_login" });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(
    await screen.findByRole("button", { name: "New account" }),
  ).toBeInTheDocument();
  expect(forgetOidcLogin).toHaveBeenCalled();
  // Nothing went wrong, so nothing is explained.
  expect(screen.queryByRole("alert")).toBeNull();
});

test("the name form survives the parameter being stripped", async () => {
  // A reload, or the effect that takes `?login=` off the address: the form is
  // drawn off the pending login itself, which the cookie still stands for.
  getMe.mockResolvedValue(meResponse(["songs.view", "players.view"]));
  oidcPending.mockResolvedValue({ data: { username: "singer" } });
  renderUser("/user");

  expect(await screen.findByLabelText("Your name")).toHaveValue("singer");
  expect(screen.queryByRole("button", { name: "New account" })).toBeNull();
  // Nothing went wrong, so nothing is explained.
  expect(screen.queryByRole("alert")).toBeNull();
});

test("sso switched off while the name is being typed says so", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view", "players.view"]));
  oidcPending.mockResolvedValue({ data: { username: "singer" } });
  completeOidcLogin.mockRejectedValue({ detail: "oidc_disabled" });
  renderUser("/user?login=choose_name");

  await screen.findByLabelText("Your name");
  // The switch is off from here on, so the form has nothing left to stand on.
  oidcPending.mockRejectedValue({ detail: "oidc_disabled" });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Single sign-on is switched off",
  );
  expect(screen.queryByLabelText("Your name")).toBeNull();
  expect(
    screen.getByRole("button", { name: "New account" }),
  ).toBeInTheDocument();
});

test("a sign-on whose name came too late explains itself", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view", "players.view"]));
  renderUser("/user?login=choose_name");

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "took too long or was already finished",
  );
  expect(
    screen.getByRole("button", { name: "New account" }),
  ).toBeInTheDocument();
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
  expect(screen.getByText("Worst").previousSibling).toHaveTextContent("8000");
  // Both scores are on songs that have left the library: one unknown song.
  expect(screen.getByText("Songs").previousSibling).toHaveTextContent("1");
  // The app's one score summary (§7): what was sung before how well it went,
  // and the three score numbers reading down from the best.
  expect(
    [...document.querySelectorAll(".score-summary-stat .icon-stat-label")].map(
      (label) => label.textContent,
    ),
  ).toEqual(["Sings", "Songs", "Best", "Average", "Worst"]);
  // Every score on this page is the reader's own, so the peaks name nobody.
  expect(screen.getByText("Best").textContent).toBe("Best");
  expect(screen.getByText("Worst").textContent).toBe("Worst");
});

test("the best on the user page wears the arrow, never the cup", async () => {
  loggedInAsAlice();
  listPlayerScores.mockResolvedValue({
    data: { scores: [score(9000, "s1"), score(8000, "s2")] },
  });
  renderUser();

  // `trophy` is the song modal's action bar, where the best score is a
  // thing to open. Inside a score summary it is a number like any other.
  const stat = (await screen.findByText("Best")).parentElement!;
  expect(iconNames(stat)).toEqual(["arrow-up"]);
});

test("the distribution sits between the numbers and the way into the list", async () => {
  loggedInAsAlice();
  listPlayerScores.mockResolvedValue({
    data: {
      scores: [
        score(9000, "s1"),
        score(8000, "s2"),
        score(7000, "s3"),
        score(2000, "s4"),
      ],
    },
  });
  renderUser();

  const chart = await screen.findByRole("img", {
    name: "Your score distribution",
  });
  // Twenty buckets of 500, so the four scores land in 18, 16, 14 and 4.
  const heights = [
    ...chart.querySelectorAll("[data-testid=histogram-bar]"),
  ].map((bar) => Number(bar.getAttribute("height")));
  expect(heights).toHaveLength(20);
  expect(heights.map((height) => (height > 0 ? 1 : 0))).toEqual([
    0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0,
  ]);

  const wrapper = chart.parentElement;
  expect(
    wrapper?.previousElementSibling?.classList.contains("user-stats"),
  ).toBe(true);
  expect(
    wrapper?.nextElementSibling?.classList.contains("user-stats-link"),
  ).toBe(true);
});

test("three scores are too few buckets to be a shape", async () => {
  loggedInAsAlice();
  listPlayerScores.mockResolvedValue({
    data: { scores: [score(9000, "s1"), score(8000, "s2"), score(7000, "s3")] },
  });
  renderUser();

  await screen.findByRole("link", { name: "All my scores" });
  expect(
    screen.queryByRole("img", { name: "Your score distribution" }),
  ).toBeNull();
});

test("the whole history is one row below the numbers it totals", async () => {
  loggedInAsAlice();
  listPlayerScores.mockResolvedValue({ data: { scores: [score(9000, "s1")] } });
  renderUser();

  const link = await screen.findByRole("link", { name: "All my scores" });
  expect(link).toHaveAttribute("href", "/user/stats");
  // Directly under the stat bar: the row is the way into those very numbers.
  expect(link.previousElementSibling?.classList.contains("user-stats")).toBe(
    true,
  );
  // Belongs to the stats, not to the errands below: none of Manage's row idiom
  // — no 48px glyph row, and the only glyph on it is the chevron.
  expect(link.classList.contains("home-entry")).toBe(false);
  expect(iconNames(link)).toEqual(["chevron-right"]);
});

test("nothing links to an empty history", async () => {
  loggedInAsAlice();
  renderUser();

  expect(
    await screen.findByText("Sing a song and your stats appear here."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "All my scores" })).toBeNull();
});

test("the badges belong to the record, between the scores and the errands", async () => {
  loggedInAsAlice(ADMIN_CAPABILITIES);
  listPlayerScores.mockResolvedValue({ data: { scores: [score(9000, "s1")] } });
  listPlayerAchievements.mockResolvedValue({
    data: { achievements: [playerAchievementRead()] },
  });
  const { container } = renderUser();

  const section = await waitFor(() => {
    const found = container.querySelector(".user-achievements");
    expect(found).not.toBeNull();
    return found as HTMLElement;
  });
  expect(screen.getByText("1 of 1")).toBeInTheDocument();
  // Under the way into the scores, and above the Manage heading: still the
  // singer's own record, not one of the errands.
  expect(section.previousElementSibling).toHaveClass("user-stats-link");
  expect(section.nextElementSibling?.textContent).toBe("Manage");
});

test("no badges are drawn for a singer with no player of their own", async () => {
  getMe.mockResolvedValue(
    meResponse(USER_CAPABILITIES, {
      user: userRead({ username: "Alice", player_id: null }),
      role: "user",
    }),
  );
  const { container } = renderUser();

  await screen.findByRole("button", { name: "Log out" });
  expect(container.querySelector(".user-achievements")).toBeNull();
  expect(listPlayerAchievements).not.toHaveBeenCalled();
});

test("a role that may not see statistics gets no way into them either", async () => {
  loggedInAsAlice(USER_CAPABILITIES.filter((name) => name !== "stats.view"));
  renderUser();

  await screen.findByRole("button", { name: "Log out" });
  expect(screen.queryByRole("link", { name: "All my scores" })).toBeNull();
  expect(
    screen.queryByRole("img", { name: "Your score distribution" }),
  ).toBeNull();
});

test("the About footer signs the page with the mark, the name and the version", async () => {
  loggedInAsAlice();
  renderUser();

  expect(
    await screen.findByRole("heading", { name: "Ultrastar Wingman" }),
  ).toBeInTheDocument();
  // Decorative, so it has no accessible name to query by: the heading right
  // under it already says what it is.
  const logo = document.querySelector(".about-logo");
  expect(logo).toHaveAttribute("src", "/logo.png");
  expect(logo).toHaveAttribute("alt", "");
  // From the backend, so a frontend served by another release cannot lie.
  expect(await screen.findByText("v0.4.2")).toBeInTheDocument();

  const repository = screen.getByRole("link", { name: "GitHub" });
  expect(repository).toHaveAttribute(
    "href",
    "https://github.com/Yannis4444/Ultrastar-Wingman",
  );
  // A new tab, and one that cannot reach back into this one.
  expect(repository).toHaveAttribute("target", "_blank");
  expect(repository.getAttribute("rel")).toContain("noopener");
});

test("the version stays away until the backend answered", async () => {
  loggedInAsAlice();
  health.mockRejectedValue(new Error("no"));
  renderUser();

  // The link is what is always there; the version is not.
  expect(
    await screen.findByRole("link", { name: "GitHub" }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/^v\d/)).not.toBeInTheDocument();
});

test("a stranger gets the About footer too, and no way into someone's scores", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view", "players.view"]));
  renderUser();

  expect(await screen.findByText("v0.4.2")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "GitHub" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "All my scores" })).toBeNull();
});

test("favorites are no achievement, so the stat bar does not count them", async () => {
  loggedInAsAlice();
  listPlayerScores.mockResolvedValue({ data: { scores: [score(9000, "s1")] } });
  // Two favorites are there to be counted; the bar still does not count them.
  renderUser();

  expect(await screen.findByText("Sings")).toBeInTheDocument();
  expect(screen.queryByText("Favorites")).not.toBeInTheDocument();
  expect(listFavorites).not.toHaveBeenCalled();
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
  // One uploader, one failure: the tile says it once.
  expect(alerts).toHaveLength(1);
  expect(alerts[0]).toHaveTextContent("Only jpeg, png, and webp images work");
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

test("the own picture needs no capability at all", async () => {
  // Identity, like favorites: an account with nothing but the right to look at
  // the players still changes the picture of the player it sings as.
  loggedInAsAlice(["songs.view", "players.view"]);
  renderUser();

  expect(
    await screen.findByLabelText("Change your picture"),
  ).toBeInTheDocument();
});
