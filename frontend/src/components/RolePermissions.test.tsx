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
  user: ["songs.view", "karaoke.stop", "playlists.manage"],
  trusted: ["songs.view", "karaoke.stop", "playlists.manage"],
  admin: ["songs.view", "karaoke.stop", "playlists.manage", "users.manage"],
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

test("every editable role is a column of the one matrix, admin is not", async () => {
  renderPermissions();

  // All three roles at once, no role picker in between.
  expect(await screen.findByLabelText("songs.view for guest")).toBeChecked();
  expect(screen.getByLabelText("songs.view for user")).toBeChecked();
  expect(screen.getByLabelText("songs.view for trusted")).toBeChecked();
  expect(screen.getByLabelText("karaoke.stop for guest")).not.toBeChecked();
  expect(screen.getByLabelText("karaoke.stop for user")).toBeChecked();

  // Admin is hardwired to everything, so it has no column and no button.
  expect(screen.queryByLabelText("users.manage for admin")).toBeNull();
  expect(screen.queryByRole("button", { name: "guest" })).toBeNull();
  expect(screen.queryByRole("button", { name: "admin" })).toBeNull();

  // Grouped: the heading carries the noun, the row the verb, and the
  // description spells the capability out.
  expect(screen.getByRole("heading", { name: "karaoke" })).toBeInTheDocument();
  expect(screen.getByText("stop")).toBeInTheDocument();
  expect(
    screen.getByText("Stop the song that is running now."),
  ).toBeInTheDocument();
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
  // The acknowledgement sits in the row that was ticked.
  expect(await screen.findByRole("status")).toHaveTextContent("Saved");
});

test("revoking sends the list without that capability", async () => {
  updateRolePermissions.mockResolvedValue({
    data: { roles: { ...ROLES, user: ["songs.view", "playlists.manage"] } },
  });
  renderPermissions();

  // No role to pick first: the row for `user` is right there.
  fireEvent.click(await screen.findByLabelText("karaoke.stop for user"));

  await waitFor(() =>
    expect(updateRolePermissions.mock.calls[0][0].body).toEqual({
      capabilities: ["songs.view", "playlists.manage"],
    }),
  );
});

test("a capability a guest could never use is disabled, not a lying tick", async () => {
  renderPermissions();

  const guestBox = await screen.findByLabelText("playlists.manage for guest");
  expect(guestBox).toBeDisabled();
  expect(guestBox).not.toBeChecked();
  expect(guestBox).toHaveAccessibleDescription(/belongs to an account/);
  // Only the guest column: an account can own a playlist.
  expect(screen.getByLabelText("playlists.manage for user")).toBeEnabled();
});

test("a stored grant stays clearable even where it does nothing", async () => {
  getPermissions.mockResolvedValue({
    data: {
      roles: { ...ROLES, guest: ["songs.view", "playlists.manage"] },
    },
  });
  renderPermissions();

  const guestBox = await screen.findByLabelText("playlists.manage for guest");
  expect(guestBox).toBeChecked();
  expect(guestBox).toBeEnabled();
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
  // The notice is out of sight from most rows, so the row says it too — and
  // stays saying it, because it explains why the box jumped back.
  expect(screen.getByText("Not saved")).toBeInTheDocument();
  expect(screen.queryByText("Saved")).toBeNull();
});
