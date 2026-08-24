import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import RolePermissions from "./RolePermissions";

const { getPermissions, updateRolePermissions } = vi.hoisted(() => ({
  getPermissions: vi.fn(),
  updateRolePermissions: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getPermissions,
  updateRolePermissions,
}));

// Admin holds everything, which is what makes its list the row list.
const ROLES = {
  guest: ["songs.view"],
  user: ["songs.view", "karaoke.stop"],
  trusted: ["songs.view", "karaoke.stop"],
  admin: ["songs.view", "karaoke.stop", "users.manage"],
};

function renderPermissions() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RolePermissions />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getPermissions.mockReset();
  updateRolePermissions.mockReset();
  getPermissions.mockResolvedValue({ data: { roles: ROLES } });
});

test("the first editable role is selected and admin is not offered at all", async () => {
  renderPermissions();

  expect(await screen.findByRole("button", { name: "guest" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.queryByRole("button", { name: "admin" })).toBeNull();

  // Only the selected role's checkboxes exist, one per capability.
  expect(screen.getByLabelText("songs.view for guest")).toBeChecked();
  expect(screen.getByLabelText("karaoke.stop for guest")).not.toBeChecked();
  expect(screen.getByLabelText("users.manage for guest")).not.toBeChecked();
  expect(screen.queryByLabelText("karaoke.stop for user")).toBeNull();
  expect(screen.queryByLabelText("users.manage for admin")).toBeNull();

  // Grouped: the heading carries the noun, the row the verb.
  expect(screen.getByRole("heading", { name: "karaoke" })).toBeInTheDocument();
  expect(screen.getByText("stop")).toBeInTheDocument();
});

test("granting a capability puts the whole new list into one PUT", async () => {
  updateRolePermissions.mockResolvedValue({
    data: { roles: { ...ROLES, guest: ["songs.view", "karaoke.stop"] } },
  });
  renderPermissions();

  fireEvent.click(await screen.findByLabelText("karaoke.stop for guest"));

  await waitFor(() =>
    expect(updateRolePermissions.mock.calls[0][0]).toMatchObject({
      path: { role: "guest" },
      body: { capabilities: ["songs.view", "karaoke.stop"] },
    }),
  );
  expect(screen.getByLabelText("karaoke.stop for guest")).toBeChecked();
});

test("revoking sends the list without that capability", async () => {
  updateRolePermissions.mockResolvedValue({
    data: { roles: { ...ROLES, user: ["songs.view"] } },
  });
  renderPermissions();

  // Role first: switch to "user", then toggle its row.
  fireEvent.click(await screen.findByRole("button", { name: "user" }));
  fireEvent.click(screen.getByLabelText("karaoke.stop for user"));

  await waitFor(() =>
    expect(updateRolePermissions.mock.calls[0][0].body).toEqual({
      capabilities: ["songs.view"],
    }),
  );
});

test("a failed save rolls the checkbox back and says why", async () => {
  updateRolePermissions.mockRejectedValue({
    detail: "missing_permission:permissions.manage",
  });
  renderPermissions();

  const box = await screen.findByLabelText("karaoke.stop for guest");
  fireEvent.click(box);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "may not do this (permissions.manage)",
  );
  expect(screen.getByLabelText("karaoke.stop for guest")).not.toBeChecked();
});
