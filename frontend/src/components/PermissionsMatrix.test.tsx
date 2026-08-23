import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import PermissionsMatrix from "./PermissionsMatrix";

const { getPermissions, updateRolePermissions } = vi.hoisted(() => ({
  getPermissions: vi.fn(),
  updateRolePermissions: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getPermissions,
  updateRolePermissions,
}));

// Admin holds everything, which is what makes its column the row list.
const ROLES = {
  guest: ["songs.view"],
  user: ["songs.view", "karaoke.stop"],
  trusted: ["songs.view", "karaoke.stop"],
  admin: ["songs.view", "karaoke.stop", "users.manage"],
};

function renderMatrix() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PermissionsMatrix />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getPermissions.mockReset();
  updateRolePermissions.mockReset();
  getPermissions.mockResolvedValue({ data: { roles: ROLES } });
});

test("every capability gets a row and admin cannot be edited", async () => {
  renderMatrix();

  expect(await screen.findByText("users.manage")).toBeInTheDocument();
  expect(screen.getByLabelText("songs.view for guest")).toBeChecked();
  expect(screen.getByLabelText("karaoke.stop for guest")).not.toBeChecked();
  expect(screen.getByLabelText("users.manage for admin")).toBeDisabled();
});

test("granting a capability puts the whole new list into one PUT", async () => {
  updateRolePermissions.mockResolvedValue({
    data: { roles: { ...ROLES, guest: ["songs.view", "karaoke.stop"] } },
  });
  renderMatrix();

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
  renderMatrix();

  fireEvent.click(await screen.findByLabelText("karaoke.stop for user"));

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
  renderMatrix();

  const box = await screen.findByLabelText("karaoke.stop for guest");
  fireEvent.click(box);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "may not do this (permissions.manage)",
  );
  expect(screen.getByLabelText("karaoke.stop for guest")).not.toBeChecked();
});
