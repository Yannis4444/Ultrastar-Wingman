import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { meResponse } from "../test/auth";
import UserPermissions from "./UserPermissions";

const { getMe, listGroups } = vi.hoisted(() => ({
  getMe: vi.fn(),
  listGroups: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listGroups,
}));

function group(id: string, name: string, capabilities: string[]) {
  return {
    id,
    name,
    built_in: true,
    member_count: null,
    capabilities,
    right_count: null,
    can_assign: false,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/user/permissions"]}>
        <UserPermissions />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  getMe.mockResolvedValue(meResponse(["permissions.manage"]));
  listGroups.mockResolvedValue({
    data: {
      groups: [
        group("guest", "Guest", ["songs.view"]),
        group("admin", "Admin", ["songs.view", "users.manage"]),
      ],
      capabilities: ["songs.view", "users.manage"],
    },
  });
});

test("the back link leads to the user page and the roles load", async () => {
  renderPage();

  expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
    "href",
    "/user",
  );
  expect(
    screen.getByRole("heading", { name: "Permissions" }),
  ).toBeInTheDocument();
  // One matrix, no group picker: the Guest column is simply there.
  expect(await screen.findByLabelText("songs.view for Guest")).toBeChecked();
});

test("without permissions.manage the page explains itself and asks nothing", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  renderPage();

  expect(
    await screen.findByText(/Managing permissions is for the host/),
  ).toBeInTheDocument();
  expect(listGroups).not.toHaveBeenCalled();
});
