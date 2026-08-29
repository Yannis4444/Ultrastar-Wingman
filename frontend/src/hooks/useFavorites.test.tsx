import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { meResponse, userRead } from "../test/auth";
import { useFavorites } from "./useFavorites";

const { getMe, listFavorites, addFavorite } = vi.hoisted(() => ({
  getMe: vi.fn(),
  listFavorites: vi.fn(),
  addFavorite: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listFavorites,
  addFavorite,
}));

function render() {
  getMe.mockResolvedValue(meResponse(["songs.view"], { user: userRead() }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useFavorites(), { wrapper });
}

beforeEach(() => {
  for (const mock of [getMe, listFavorites, addFavorite]) mock.mockReset();
  listFavorites.mockResolvedValue({ data: { song_ids: ["s1"] } });
  addFavorite.mockResolvedValue({ data: undefined });
});

test("the same answer keeps the same set", async () => {
  // The Songs list memoizes what it shows on this set, over thousands of rows:
  // a new one every render would make that memo recompute on every keystroke.
  const { result, rerender } = render();

  await waitFor(() => expect(result.current.ids.has("s1")).toBe(true));
  const first = result.current.ids;
  rerender();

  expect(result.current.ids).toBe(first);
});

test("a toggled favorite is a new set", async () => {
  const { result } = render();

  await waitFor(() => expect(result.current.ids.has("s1")).toBe(true));
  const before = result.current.ids;
  result.current.toggle("s2");

  // The optimistic write puts a new answer in the cache, so the set moves with
  // the heart rather than going stale behind it.
  await waitFor(() => expect(result.current.ids.has("s2")).toBe(true));
  expect(result.current.ids).not.toBe(before);
});
