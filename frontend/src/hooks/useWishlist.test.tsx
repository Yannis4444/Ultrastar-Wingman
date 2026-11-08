import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SongRead, WishRead } from "../api";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { useWishlist } from "./useWishlist";

const { getMe, listWishlist } = vi.hoisted(() => ({
  getMe: vi.fn(),
  listWishlist: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listWishlist,
}));

function wished(weight: number): WishRead {
  return {
    song: { id: "usdb:1", title: "Africa" } as SongRead,
    count: 2,
    weight,
    mine: false,
    latest: "2026-11-08T20:00:00Z",
  };
}

function render() {
  getMe.mockResolvedValue(meResponse(["wishlist.view"]));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useWishlist(), { wrapper });
}

/** Let a broadcast's refetch, if it started one, come back. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  getMe.mockReset();
  listWishlist.mockReset();
  listWishlist.mockResolvedValue({ data: { wishes: [wished(1.85)] } });
});

afterEach(() => vi.unstubAllGlobals());

test("switching fair wishes reloads the weights", async () => {
  const { result } = render();
  await waitFor(() => expect(result.current.wishes[0]?.weight).toBe(1.85));

  listWishlist.mockResolvedValue({ data: { wishes: [wished(2)] } });
  FakeSocket.deliver({
    event: "setting.changed",
    key: "karaoke.fair_wishes",
    value: false,
  });

  await waitFor(() => expect(result.current.wishes[0]?.weight).toBe(2));
});

test("a scan reloads the weights, because it can move what a wisher holds", async () => {
  const { result } = render();
  await waitFor(() => expect(result.current.wishes[0]?.weight).toBe(1.85));

  listWishlist.mockResolvedValue({ data: { wishes: [wished(1)] } });
  FakeSocket.deliver({
    event: "songs.scan_finished",
    added: 0,
    removed: 1,
    updated: 0,
    total: 1,
  });

  await waitFor(() => expect(result.current.wishes[0]?.weight).toBe(1));
});

test("any other setting reloads nothing", async () => {
  const { result } = render();
  await waitFor(() => expect(result.current.wishes).toHaveLength(1));
  const asked = listWishlist.mock.calls.length;

  FakeSocket.deliver({
    event: "setting.changed",
    key: "karaoke.rest_skipped_songs",
    value: false,
  });
  await settle();

  expect(listWishlist).toHaveBeenCalledTimes(asked);
});
