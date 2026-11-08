import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { GroupRead } from "../api";
import { AS, TRUSTED_GROUP_ID, meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import Groups from "./Groups";

const { getMe, listGroups } = vi.hoisted(() => ({
  getMe: vi.fn(),
  listGroups: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listGroups,
}));

const DJS = "d".repeat(32);

function group(
  id: string,
  name: string,
  member_count: number | null,
  right_count: number | null,
): GroupRead {
  return {
    id,
    name,
    built_in: id === "guest" || id === "user" || id === "admin",
    member_count,
    capabilities: [],
    right_count,
    can_assign: true,
  };
}

const GROUPS: GroupRead[] = [
  group("guest", "Guest", null, 8),
  group("user", "User", 9, 13),
  group(DJS, "DJs", 1, 1),
  group(TRUSTED_GROUP_ID, "Trusted", 3, 11),
  group("admin", "Admin", 2, null),
];

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/user/groups"]}>
        <Groups />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("WebSocket", FakeSocket);
  getMe.mockResolvedValue(
    meResponse(["permissions.manage"], {
      user: userRead({ groups: ["admin"] }),
      ...AS.admin,
    }),
  );
  listGroups.mockResolvedValue({
    data: { groups: GROUPS, capabilities: ["songs.view"] },
  });
});
afterEach(() => vi.unstubAllGlobals());

test("one row per group in the one order, each saying who and what", async () => {
  renderPage();

  const list = await screen.findByRole("list", { name: "Groups" });
  const rows = within(list).getAllByRole("listitem");
  expect(rows.map((row) => row.textContent)).toEqual([
    "GuestEverybody without an account · 8 rights",
    "UserEvery account · 13 rights",
    "DJs1 member · adds 1 right",
    "Trusted3 members · adds 11 rights",
    "Admin2 members · every right",
  ]);
  // A group's square is `users`, Admin's `shield`.
  expect(iconNames(rows[3])).toContain("users");
  expect(iconNames(rows[4])).toEqual(["shield"]);
});

test("every row leads into its editor but Admin's, which is no link", async () => {
  renderPage();

  expect(await screen.findByRole("link", { name: /^Trusted/ })).toHaveAttribute(
    "href",
    `/user/groups/${TRUSTED_GROUP_ID}`,
  );
  expect(screen.getByRole("link", { name: /^Guest/ })).toHaveAttribute(
    "href",
    "/user/groups/guest",
  );
  expect(screen.queryByRole("link", { name: /^Admin/ })).toBeNull();
  // And no chevron on it: there is nothing behind it.
  const admin = screen.getByText("Admin").closest("li") as HTMLElement;
  expect(iconNames(admin)).not.toContain("chevron-right");
});

test("the header starts a new group and a note says how groups add up", async () => {
  renderPage();

  expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
    "href",
    "/user",
  );
  expect(screen.getByRole("heading", { name: "Groups" })).toBeInTheDocument();
  expect(
    await screen.findByRole("link", { name: "New group" }),
  ).toHaveAttribute("href", "/user/groups/new");
  expect(
    await screen.findByText(
      "Every account is in User. A group adds its rights to User's. Admins hold every right, so nothing here can lock the host out.",
    ),
  ).toBeInTheDocument();
});

test("the counts are read off right_count, never off the capabilities", async () => {
  // A reader without permissions.manage would get `capabilities: null`; the
  // line must not care.
  listGroups.mockResolvedValue({
    data: {
      groups: GROUPS.map((row) => ({ ...row, capabilities: null })),
      capabilities: null,
    },
  });
  renderPage();

  expect(await screen.findByText("3 members · adds 11 rights")).toBeVisible();
});

test("without permissions.manage the page explains itself and asks nothing", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  renderPage();

  expect(
    await screen.findByText(/Groups are the host's to set up/),
  ).toBeInTheDocument();
  expect(listGroups).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: "New group" })).toBeNull();
});
