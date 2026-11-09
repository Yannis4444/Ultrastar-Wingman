import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PageHeader from "../components/PageHeader";
import { AS, meResponse } from "../test/auth";
import HostManage from "./HostManage";

const { getMe } = vi.hoisted(() => ({ getMe: vi.fn() }));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
}));

/**
 * The stub stands in for the real pages behind the rows: all that matters here
 * is that they carry a `PageHeader` whose own default leads to the user page.
 */
function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/host/manage"]}>
        <Routes>
          <Route path="/host/manage" element={<HostManage />} />
          <Route
            path="/settings"
            element={<PageHeader title="Settings" back="/user" />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  getMe.mockResolvedValue(
    meResponse(
      ["settings.view", "players.manage", "users.manage", "permissions.manage"],
      { is_host: true, ...AS.host },
    ),
  );
});

test("the host session gets every management page and a way back to the stage", async () => {
  renderPage();

  expect(
    await screen.findByRole("link", { name: "Players & accounts" }),
  ).toHaveAttribute("href", "/user/accounts");
  expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
    "href",
    "/settings",
  );
  expect(screen.getByRole("link", { name: "Permissions" })).toHaveAttribute(
    "href",
    "/user/groups",
  );
  // The stage, not /user: this view is the host screen's own chrome.
  expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
    "href",
    "/host",
  );
});

test("a page opened from here comes back here instead of to the user page", async () => {
  renderPage();

  fireEvent.click(await screen.findByRole("link", { name: "Settings" }));

  expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
    "href",
    "/host/manage",
  );
});

test("only the entries the session may open are listed", async () => {
  getMe.mockResolvedValue(meResponse(["settings.view"]));
  renderPage();

  expect(await screen.findByRole("link", { name: "Settings" })).toBeVisible();
  expect(screen.queryByRole("link", { name: "Permissions" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Players & accounts" })).toBeNull();
});

test("a browser without any rights is told why the view is empty", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  renderPage();

  expect(await screen.findByText(/no management rights/)).toBeInTheDocument();
  expect(screen.queryByRole("navigation")).toBeNull();
});
