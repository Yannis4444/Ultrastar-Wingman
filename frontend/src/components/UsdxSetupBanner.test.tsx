import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import UsdxSetupBanner from "./UsdxSetupBanner";

const { usdxStatus, getMe } = vi.hoisted(() => ({
  usdxStatus: vi.fn(),
  getMe: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  usdxStatus,
  getMe,
}));

const HOST = ["songs.view", "settings.view", "settings.manage"];
const GUEST = ["songs.view"];

const PROBLEMS = [
  "'usdx.executable' is not set and cannot be derived from 'usdx.base_path'",
  "'songs.directory' is not a directory: D:\\gone",
];

function renderBanner(
  status: { configured: boolean; problems: string[]; bundled?: boolean },
  capabilities = HOST,
) {
  getMe.mockResolvedValue(meResponse(capabilities));
  usdxStatus.mockResolvedValue({ data: status });
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <UsdxSetupBanner />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const banner = () => screen.findByText(/Ultrastar Deluxe is not set up yet/);

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  usdxStatus.mockReset();
  getMe.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

test("a configured Wingman says nothing at all", async () => {
  renderBanner({ configured: true, problems: [] });

  await waitFor(() => expect(usdxStatus).toHaveBeenCalled());
  expect(
    screen.queryByText(/Ultrastar Deluxe is not set up yet/),
  ).not.toBeInTheDocument();
});

test("the host is offered a way to fix it", async () => {
  renderBanner({ configured: false, problems: PROBLEMS });

  expect(await banner()).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Fix it" })).toBeInTheDocument();
  expect(screen.queryByText(/Ask the host/)).not.toBeInTheDocument();
});

test("a guest is told to ask the host instead", async () => {
  renderBanner({ configured: false, problems: [] }, GUEST);

  expect(await banner()).toBeInTheDocument();
  expect(screen.getByText(/Ask the host/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Fix it" })).toBeNull();
});

test("without songs.view the status is never even asked for", async () => {
  renderBanner({ configured: false, problems: [] }, []);

  await waitFor(() => expect(getMe).toHaveBeenCalled());
  await waitFor(() => expect(usdxStatus).not.toHaveBeenCalled());
});

test("the guide explains every problem and links to the settings", async () => {
  renderBanner({ configured: false, problems: PROBLEMS });
  fireEvent.click(await screen.findByRole("button", { name: "Fix it" }));

  const guide = await screen.findByRole("dialog", {
    name: "Ultrastar Deluxe is not set up",
  });
  // The raw backend strings are replaced by sentences, one per problem.
  expect(guide).toHaveTextContent(/does not know where Ultrastar Deluxe/);
  expect(guide).toHaveTextContent(/songs directory does not exist/);
  expect(guide).not.toHaveTextContent("usdx.executable");
  expect(
    screen.getByRole("link", { name: "Open the settings" }),
  ).toHaveAttribute("href", "/settings");
});

test("a problem the frontend does not know is shown as it came", async () => {
  renderBanner({ configured: false, problems: ["the flux capacitor is cold"] });
  fireEvent.click(await screen.findByRole("button", { name: "Fix it" }));

  expect(
    await screen.findByText("the flux capacitor is cold"),
  ).toBeInTheDocument();
});

test("a changed USDX setting makes the banner disappear", async () => {
  renderBanner({ configured: false, problems: PROBLEMS });
  await banner();

  usdxStatus.mockResolvedValue({ data: { configured: true, problems: [] } });
  FakeSocket.deliver({
    event: "setting.changed",
    key: "usdx.base_path",
    value: "C:\\usdx",
  });

  await waitFor(() =>
    expect(
      screen.queryByText(/Ultrastar Deluxe is not set up yet/),
    ).not.toBeInTheDocument(),
  );
});

test("an unrelated setting does not cost a request", async () => {
  renderBanner({ configured: false, problems: PROBLEMS });
  await banner();
  await waitFor(() => expect(usdxStatus).toHaveBeenCalledTimes(1));

  FakeSocket.deliver({
    event: "setting.changed",
    key: "usdb.username",
    value: "bob",
  });

  await waitFor(() => expect(usdxStatus).toHaveBeenCalledTimes(1));
});

test("a Wingman that brings its own Ultrastar Deluxe never asks for a base path", async () => {
  renderBanner({
    configured: false,
    problems: ["'songs.directory' is not a directory: D:\\gone"],
    bundled: true,
  });
  fireEvent.click(await screen.findByRole("button", { name: "Fix it" }));

  const guide = await screen.findByRole("dialog", {
    name: "Ultrastar Deluxe is not set up",
  });
  expect(guide).toHaveTextContent(/comes with this installation/);
  expect(guide).toHaveTextContent(/songs directory does not exist/);
  expect(guide).not.toHaveTextContent(/base path/i);
});

test("a bundled Ultrastar Deluxe gone missing is not blamed on a setting", async () => {
  renderBanner({
    configured: false,
    problems: [
      "the bundled Ultrastar Deluxe is missing: C:\\Wingman\\usdx\\ultrastardx.exe",
    ],
    bundled: true,
  });
  fireEvent.click(await screen.findByRole("button", { name: "Fix it" }));

  const guide = await screen.findByRole("dialog", {
    name: "Ultrastar Deluxe is not set up",
  });
  expect(guide).toHaveTextContent(
    /Ultrastar Deluxe that comes with this installation is missing/,
  );
  expect(guide).not.toHaveTextContent(/base path/i);
});
