import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { PlayerRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import BottomNav from "./BottomNav";

const { listPlayers, getMe } = vi.hoisted(() => ({
  listPlayers: vi.fn(),
  getMe: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listPlayers,
  getMe,
}));

const CAPABILITIES = ["songs.view", "players.view"];

function player(overrides: Partial<PlayerRead> = {}): PlayerRead {
  return {
    id: "aaa",
    name: "Alice",
    registered: true,
    hidden: false,
    has_avatar: true,
    avatar_version: 1700,
    ...overrides,
  };
}

function renderNav(url = "/") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <BottomNav />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The User tab's own glyph slot — an `<img>` once there is a picture. */
function userTab(): HTMLElement {
  return screen.getByRole("link", { name: "User" });
}

beforeEach(() => {
  vi.resetAllMocks();
  listPlayers.mockResolvedValue({ data: { players: [player()] } });
  getMe.mockResolvedValue(
    meResponse(CAPABILITIES, {
      user: userRead({ username: "Alice", player_id: "aaa" }),
      role: "user",
    }),
  );
});

test("a logged-in singer's own picture replaces the generic glyph", async () => {
  renderNav();

  const image = await waitFor(() => {
    const found = userTab().querySelector("img");
    expect(found).not.toBeNull();
    return found as HTMLImageElement;
  });
  // The version the backend reports for the stored file, and nothing else: the
  // URL stays the same — and cacheable — until the picture itself changes.
  expect(image.getAttribute("src")).toBe("/api/v1/players/aaa/avatar?v=1700");
  expect(userTab().querySelector("svg")).toBeNull();
  // The other tabs keep their inline paths.
  expect(
    screen.getByRole("link", { name: "Songs" }).querySelector("svg"),
  ).not.toBeNull();
});

test.each([
  ["/user/stats", "User"],
  ["/settings", "User"],
  ["/spinner", "Home"],
  ["/songs/playlists", "Songs"],
  ["/usdb", "Songs"],
])("%s lights the %s tab", async (url, tab) => {
  renderNav(url);

  // A sub-surface has no tab of its own; the tab it belongs to must not go
  // dark under it, or the reader loses track of where they are.
  await waitFor(() =>
    expect(screen.getByRole("link", { name: tab })).toHaveClass("active"),
  );
  const dark = ["Home", "Songs", "Scores", "User"].filter(
    (name) => name !== tab,
  );
  for (const name of dark) {
    expect(screen.getByRole("link", { name })).not.toHaveClass("active");
  }
});

test("a logged-out browser keeps the glyph and asks for no players at all", async () => {
  getMe.mockResolvedValue(meResponse(CAPABILITIES));
  renderNav();

  await waitFor(() => expect(getMe).toHaveBeenCalled());
  expect(userTab().querySelector("svg")).not.toBeNull();
  expect(userTab().querySelector("img")).toBeNull();
  expect(listPlayers).not.toHaveBeenCalled();
});

test("an account whose player has no picture keeps the glyph", async () => {
  listPlayers.mockResolvedValue({
    data: { players: [player({ has_avatar: false })] },
  });
  renderNav();

  await waitFor(() => expect(listPlayers).toHaveBeenCalled());
  expect(userTab().querySelector("svg")).not.toBeNull();
  expect(userTab().querySelector("img")).toBeNull();
});

test("a picture that fails to load falls back to the glyph", async () => {
  renderNav();

  const image = await waitFor(() => {
    const found = userTab().querySelector("img");
    expect(found).not.toBeNull();
    return found as HTMLImageElement;
  });
  fireEvent.error(image);

  expect(userTab().querySelector("img")).toBeNull();
  expect(userTab().querySelector("svg")).not.toBeNull();
});

test("gives every tab one glyph over one caption", async () => {
  const { container } = renderNav();

  await waitFor(() => expect(listPlayers).toHaveBeenCalled());
  const tabs = [...container.querySelectorAll(".bottom-nav a")];
  expect(tabs).toHaveLength(4);
  // The nav is `--bottom-nav-height` tall by declaration, and what fits in that
  // is a 24px glyph over one 16px caption. A tab with a second line, or none,
  // would either spill past the nav's edge or leave the gap the sticky editor
  // action row rides on — so the stack itself is what is guarded here.
  for (const tab of tabs) {
    expect(tab.querySelectorAll("span")).toHaveLength(1);
    expect(tab.querySelector("span")?.textContent).toMatch(/^\S+$/);
  }
});
