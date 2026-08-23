import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import Host from "./Host";

const { getMe, exchangeHostToken, getCurrentSing, listKaraokeColors } =
  vi.hoisted(() => ({
    getMe: vi.fn(),
    exchangeHostToken: vi.fn(),
    getCurrentSing: vi.fn(),
    listKaraokeColors: vi.fn(),
  }));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  exchangeHostToken,
  getCurrentSing,
  listKaraokeColors,
}));

function renderHost(url: string) {
  window.history.replaceState(null, "", url);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Host />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  getMe.mockReset();
  exchangeHostToken.mockReset();
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  getCurrentSing.mockResolvedValue({ data: { sing: null } });
  listKaraokeColors.mockResolvedValue({ data: { colors: [] } });
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
