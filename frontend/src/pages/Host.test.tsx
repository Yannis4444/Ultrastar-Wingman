import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import Host from "./Host";

const {
  getMe,
  exchangeHostToken,
  getCurrentSing,
  getJoinInfo,
  listKaraokeColors,
  listLatestScores,
  listWishlist,
} = vi.hoisted(() => ({
  getMe: vi.fn(),
  exchangeHostToken: vi.fn(),
  getCurrentSing: vi.fn(),
  getJoinInfo: vi.fn(),
  listKaraokeColors: vi.fn(),
  listLatestScores: vi.fn(),
  listWishlist: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  exchangeHostToken,
  getCurrentSing,
  getJoinInfo,
  listKaraokeColors,
  listLatestScores,
  listWishlist,
}));

function renderHost(url: string) {
  window.history.replaceState(null, "", url);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Host />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  getMe.mockReset();
  exchangeHostToken.mockReset();
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  getCurrentSing.mockResolvedValue({ data: { sing: null } });
  getJoinInfo.mockResolvedValue({ data: { url: "http://192.168.0.10:8080" } });
  listKaraokeColors.mockResolvedValue({ data: { colors: [] } });
  listLatestScores.mockResolvedValue({ data: { scores: [] } });
  listWishlist.mockResolvedValue({ data: { wishes: [] } });
});

afterEach(() => vi.unstubAllGlobals());

test("the token from the host URL is exchanged and taken out of the URL", async () => {
  exchangeHostToken.mockResolvedValue({
    data: meResponse([], { is_host: true, role: "admin" }).data,
  });
  renderHost("/host?hostToken=secret-token");

  await waitFor(() =>
    expect(exchangeHostToken.mock.calls[0][0].body).toEqual({
      token: "secret-token",
    }),
  );
  // Nobody may re-share (or reload) a URL that carries a live token.
  expect(window.location.search).toBe("");
  expect(exchangeHostToken).toHaveBeenCalledTimes(1);
});

test("no token in the URL means no exchange", async () => {
  renderHost("/host");

  expect(await screen.findByText("Scan to join")).toBeInTheDocument();
  expect(exchangeHostToken).not.toHaveBeenCalled();
});

test("a used token says so and points at the server log", async () => {
  exchangeHostToken.mockRejectedValue({ detail: "invalid_host_token" });
  renderHost("/host?hostToken=already-used");

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "can only be used once",
  );
});

test("an established host session is shown as active", async () => {
  getMe.mockResolvedValue(
    meResponse(["songs.view"], { is_host: true, role: "admin" }),
  );
  renderHost("/host");

  expect(await screen.findByText("Host session active")).toBeInTheDocument();
});

test("the QR encodes the server's join URL and prints it readably", async () => {
  renderHost("/host");

  // Phones on the host machine's `localhost` origin would go nowhere, so the
  // LAN URL from the backend is both encoded and printed as text.
  expect(await screen.findByText("192.168.0.10:8080")).toBeInTheDocument();
});

test("the overlay opens the host's own manage view, not the user page", async () => {
  getMe.mockResolvedValue(
    meResponse(["settings.view"], { is_host: true, role: "admin" }),
  );
  renderHost("/host");

  const gear = await screen.findByRole("link", { name: "Manage" });
  expect(gear).toHaveAttribute("href", "/host/manage");
});

test("a browser without management rights gets no manage entry", async () => {
  // The default `getMe` here is a plain guest that only found the host URL.
  renderHost("/host");

  expect(await screen.findByText("Scan to join")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Manage" })).toBeNull();
});

test("an idle USDX invites guests to pick a song", async () => {
  renderHost("/host");

  expect(
    await screen.findByText("Scan the code to pick a song"),
  ).toBeInTheDocument();
});
