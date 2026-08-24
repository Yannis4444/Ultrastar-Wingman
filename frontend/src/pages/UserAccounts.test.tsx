import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { meResponse, userRead } from "../test/auth";
import UserAccounts from "./UserAccounts";

const { getMe, listUsers, updateUser, deleteUser } = vi.hoisted(() => ({
  getMe: vi.fn(),
  listUsers: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listUsers,
  updateUser,
  deleteUser,
}));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/user/accounts"]}>
        <UserAccounts />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  // The admin browser: logged in as Alice, allowed to manage accounts.
  getMe.mockResolvedValue(
    meResponse(["users.manage"], {
      user: userRead({ role: "admin" }),
      role: "admin",
    }),
  );
  listUsers.mockResolvedValue({
    data: {
      users: [
        userRead({ role: "admin" }),
        userRead({ id: "user-2", username: "Bob" }),
      ],
    },
  });
});

test("the back link leads to the user page", async () => {
  renderPage();

  expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
    "href",
    "/user",
  );
  expect(screen.getByRole("heading", { name: "Accounts" })).toBeInTheDocument();
  expect(await screen.findByText("Bob")).toBeInTheDocument();
});

test("without users.manage the page explains itself and asks nothing", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  renderPage();

  expect(
    await screen.findByText(/Managing accounts is for the host/),
  ).toBeInTheDocument();
  expect(listUsers).not.toHaveBeenCalled();
});

test("the own account is marked and a role can be changed", async () => {
  updateUser.mockResolvedValue({
    data: userRead({ id: "user-2", role: "trusted" }),
  });
  renderPage();

  // Alice is the caller, so her row carries the marker.
  expect(await screen.findByText("(you)")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Role of Bob"), {
    target: { value: "trusted" },
  });

  await waitFor(() =>
    expect(updateUser.mock.calls[0][0]).toMatchObject({
      path: { user_id: "user-2" },
      body: { role: "trusted" },
    }),
  );
});

test("removing the last admin is stopped with an explanation", async () => {
  deleteUser.mockRejectedValue({ detail: "last_admin" });
  renderPage();

  fireEvent.click(
    await screen.findByRole("button", { name: "Delete account Alice" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  expect(
    await screen.findByText("There has to be one administrator left."),
  ).toBeInTheDocument();
});
