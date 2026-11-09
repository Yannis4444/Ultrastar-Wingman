import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GroupRead, UserRead } from "../api";
import { MEMBER_OF, TRUSTED_GROUP_ID, userRead } from "../test/auth";
import { iconNames } from "../test/icons";
import AccountGroups from "./AccountGroups";

const { setUserGroups } = vi.hoisted(() => ({ setUserGroups: vi.fn() }));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  setUserGroups,
}));

const DJS = "d".repeat(32);

function group(
  id: string,
  name: string,
  overrides: Partial<GroupRead> = {},
): GroupRead {
  return {
    id,
    name,
    built_in: id === "guest" || id === "user" || id === "admin",
    member_count: 1,
    capabilities: null,
    right_count: id === "admin" ? null : 2,
    can_assign: true,
    ...overrides,
  };
}

const GROUPS = [
  group("guest", "Guest"),
  group("user", "User"),
  group(DJS, "DJs", { right_count: 1 }),
  group(TRUSTED_GROUP_ID, "Trusted", { right_count: 11 }),
  group("admin", "Admin"),
];

function renderPanel(account: UserRead, isAdmin = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AccountGroups
        account={account}
        name="Fry"
        groups={GROUPS}
        isAdmin={isAdmin}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

// A block body: a function `beforeEach` returns is run as its teardown, and
// `mockReset()` returns the mock itself.
beforeEach(() => {
  setUserGroups.mockReset();
});

test("one row per group but Guest and User, each saying what it adds", () => {
  renderPanel(userRead({ groups: MEMBER_OF.trusted }));

  expect(screen.getByRole("dialog", { name: "Groups of Fry" })).toBeVisible();
  const rows = screen
    .getAllByRole("button", { pressed: true })
    .concat(screen.getAllByRole("button", { pressed: false }));
  expect(rows).toHaveLength(3);
  expect(screen.getByRole("button", { name: /DJs/ })).toHaveTextContent(
    "adds 1 right",
  );
  expect(screen.getByRole("button", { name: /Admin/ })).toHaveTextContent(
    "every right",
  );
  // The account is in Trusted: the check on that row alone, a plus on the rest.
  const trusted = screen.getByRole("button", { name: /Trusted/ });
  expect(trusted).toHaveAttribute("aria-pressed", "true");
  expect(iconNames(trusted)).toEqual(["users", "check"]);
  expect(iconNames(screen.getByRole("button", { name: /Admin/ }))).toEqual([
    "shield",
    "plus",
  ]);
  expect(screen.queryByRole("button", { name: /Guest/ })).toBeNull();
});

test("every row waits for a round trip, so a second tap cannot undo the first", async () => {
  let answer: (value: unknown) => void = () => {};
  setUserGroups.mockReturnValue(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  renderPanel(userRead({ groups: MEMBER_OF.trusted }));

  fireEvent.click(screen.getByRole("button", { name: /DJs/ }));

  await waitFor(() =>
    expect(setUserGroups.mock.calls[0][0].body).toEqual({
      groups: [TRUSTED_GROUP_ID, DJS],
    }),
  );
  expect(screen.getByRole("button", { name: /DJs/ })).toBeDisabled();
  // The second body would be built from the set before the first flip.
  expect(screen.getByRole("button", { name: /Trusted/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Trusted/ }));
  expect(setUserGroups).toHaveBeenCalledTimes(1);

  answer({ data: userRead({ groups: [TRUSTED_GROUP_ID, DJS] }) });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /DJs/ })).toBeEnabled(),
  );
  expect(screen.getByRole("button", { name: /Trusted/ })).toBeEnabled();
});

test("a refusal is one notice in the panel", async () => {
  setUserGroups.mockRejectedValue({ detail: "admin_required" });
  renderPanel(userRead(), true);

  fireEvent.click(screen.getByRole("button", { name: /Admin/ }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Only an administrator can change who is in Admin",
  );
});
