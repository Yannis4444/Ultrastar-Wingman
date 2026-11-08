import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GroupList, GroupRead } from "../api";
import { TRUSTED_GROUP_ID } from "../test/auth";
import RolePermissions from "./RolePermissions";

const { listGroups, updateGroup } = vi.hoisted(() => ({
  listGroups: vi.fn(),
  updateGroup: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listGroups,
  updateGroup,
}));

// The catalogue is the row list; Admin holds all of it by rule.
const CATALOGUE = [
  "songs.view",
  "karaoke.stop",
  "playlists.manage",
  "users.manage",
  "achievements.manage",
];

function group(id: string, name: string, capabilities: string[]): GroupRead {
  return {
    id,
    name,
    built_in: id !== TRUSTED_GROUP_ID,
    member_count: null,
    capabilities,
    right_count: null,
    can_assign: false,
  };
}

function groups(overrides: Partial<Record<string, string[]>> = {}): GroupList {
  return {
    groups: [
      group("guest", "Guest", overrides.guest ?? ["songs.view"]),
      group(
        "user",
        "User",
        overrides.user ?? ["songs.view", "karaoke.stop", "playlists.manage"],
      ),
      group(
        TRUSTED_GROUP_ID,
        "Trusted",
        overrides.trusted ?? ["songs.view", "karaoke.stop", "playlists.manage"],
      ),
      group("admin", "Admin", CATALOGUE),
    ],
    capabilities: CATALOGUE,
  };
}

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
  listGroups.mockReset();
  updateGroup.mockReset();
  listGroups.mockResolvedValue({ data: groups() });
});

test("every editable group is a column of the one matrix, Admin is not", async () => {
  renderPermissions();

  // All three groups at once, no group picker in between.
  expect(await screen.findByLabelText("songs.view for Guest")).toBeChecked();
  expect(screen.getByLabelText("songs.view for User")).toBeChecked();
  expect(screen.getByLabelText("songs.view for Trusted")).toBeChecked();
  expect(screen.getByLabelText("karaoke.stop for Guest")).not.toBeChecked();
  expect(screen.getByLabelText("karaoke.stop for User")).toBeChecked();

  // Admin is hardwired to everything, so it has no column and no button.
  expect(screen.queryByLabelText("users.manage for Admin")).toBeNull();
  expect(screen.queryByRole("button", { name: "Guest" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();

  // Grouped: the heading carries the noun, the row the verb, and the
  // description spells the capability out.
  expect(screen.getByRole("heading", { name: "karaoke" })).toBeInTheDocument();
  expect(screen.getByText("stop")).toBeInTheDocument();
  expect(
    screen.getByText("Stop the song that is running now."),
  ).toBeInTheDocument();

  // A capability the backend grew renders either way, so what has to be checked
  // is that it arrived with its sentence — the handbook promises every row one.
  expect(
    screen.getByRole("heading", { name: "achievements" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Create achievements, edit what they ask for/),
  ).toBeInTheDocument();
});

test("granting a capability puts the whole new list into one PATCH", async () => {
  updateGroup.mockResolvedValue({
    data: group("guest", "Guest", ["songs.view", "karaoke.stop"]),
  });
  renderPermissions();

  const box = await screen.findByLabelText("karaoke.stop for Guest");
  // What the list answers once the write has landed.
  listGroups.mockResolvedValue({
    data: groups({ guest: ["songs.view", "karaoke.stop"] }),
  });
  fireEvent.click(box);

  await waitFor(() =>
    expect(updateGroup.mock.calls[0][0]).toMatchObject({
      path: { group_id: "guest" },
      body: { capabilities: ["songs.view", "karaoke.stop"] },
    }),
  );
  expect(screen.getByLabelText("karaoke.stop for Guest")).toBeChecked();
  // The acknowledgement sits in the row that was ticked.
  expect(await screen.findByRole("status")).toHaveTextContent("Saved");
});

test("revoking sends the list without that capability", async () => {
  updateGroup.mockResolvedValue({
    data: group("user", "User", ["songs.view", "playlists.manage"]),
  });
  renderPermissions();

  // No group to pick first: the row for User is right there.
  fireEvent.click(await screen.findByLabelText("karaoke.stop for User"));

  await waitFor(() =>
    expect(updateGroup.mock.calls[0][0].body).toEqual({
      capabilities: ["songs.view", "playlists.manage"],
    }),
  );
});

test("a capability a guest could never use is disabled, not a lying tick", async () => {
  renderPermissions();

  const guestBox = await screen.findByLabelText("playlists.manage for Guest");
  expect(guestBox).toBeDisabled();
  expect(guestBox).not.toBeChecked();
  expect(guestBox).toHaveAccessibleDescription(/belongs to an account/);
  // Only the Guest column: an account can own a playlist.
  expect(screen.getByLabelText("playlists.manage for User")).toBeEnabled();
});

test("a stored grant stays clearable even where it does nothing", async () => {
  listGroups.mockResolvedValue({
    data: groups({ guest: ["songs.view", "playlists.manage"] }),
  });
  renderPermissions();

  const guestBox = await screen.findByLabelText("playlists.manage for Guest");
  expect(guestBox).toBeChecked();
  expect(guestBox).toBeEnabled();
});

test("a failed save rolls the checkbox back and says why", async () => {
  updateGroup.mockRejectedValue({
    detail: "missing_permission:permissions.manage",
  });
  renderPermissions();

  const box = await screen.findByLabelText("karaoke.stop for Guest");
  fireEvent.click(box);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "may not do this (permissions.manage)",
  );
  expect(screen.getByLabelText("karaoke.stop for Guest")).not.toBeChecked();
  // The notice is out of sight from most rows, so the row says it too — and
  // stays saying it, because it explains why the box jumped back.
  expect(screen.getByText("Not saved")).toBeInTheDocument();
  expect(screen.queryByText("Saved")).toBeNull();
});
