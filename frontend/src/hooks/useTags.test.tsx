import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  getMeQueryKey,
  listSongsOptions,
} from "../api/@tanstack/react-query.gen";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { tagRead } from "../test/tags";
import { useTags } from "./useTags";

const { getMe, listSongs, listTags, listTagAssignments } = vi.hoisted(() => ({
  getMe: vi.fn(),
  listSongs: vi.fn(),
  listTags: vi.fn(),
  listTagAssignments: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listSongs,
  listTags,
  listTagAssignments,
}));

const ARCHIVE = tagRead({ id: "t-archive", hide_by_default: true });
const BROKEN = tagRead({
  id: "t-broken",
  name: "broken",
  icon: "alert",
  color: "gold",
  show_in_list: true,
  hide_by_default: true,
});

function render(capabilities = ["songs.view"]) {
  getMe.mockResolvedValue(meResponse(capabilities));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useTags(), { wrapper }), client };
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  for (const mock of [getMe, listSongs, listTags, listTagAssignments])
    mock.mockReset();
  listSongs.mockResolvedValue({ data: { songs: [] } });
  listTags.mockResolvedValue({ data: { tags: [ARCHIVE, BROKEN] } });
  listTagAssignments.mockResolvedValue({
    data: {
      assignments: [
        { tag_id: "t-archive", song_ids: ["s1"] },
        { tag_id: "t-broken", song_ids: ["s1", "s2"] },
      ],
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

it("groups the tags by song in the listing's order", async () => {
  const { result } = render();

  await waitFor(() => expect(result.current.isPending).toBe(false));
  expect(result.current.bySong.get("s1")).toEqual([ARCHIVE, BROKEN]);
  expect(result.current.bySong.get("s2")).toEqual([BROKEN]);
  expect(result.current.bySong.get("s3")).toBeUndefined();
  expect(result.current.showInList).toEqual([BROKEN]);
  expect(result.current.hideByDefault).toEqual([ARCHIVE, BROKEN]);
});

it("hands the reader's surfaces only the tags they may view", async () => {
  // What a `tags.manage` holder gets: the tag they took their own `view` away
  // from is still listed, so the admin page can show it.
  const secret = tagRead({ id: "t-secret", name: "scratch", can_view: false });
  listTags.mockResolvedValue({ data: { tags: [ARCHIVE, secret] } });
  const { result } = render(["songs.view", "tags.manage"]);

  await waitFor(() => expect(result.current.isPending).toBe(false));
  expect(result.current.allTags).toEqual([ARCHIVE, secret]);
  expect(result.current.tags).toEqual([ARCHIVE]);
});

it("asks nothing of a role that may not see the songs", async () => {
  const { result, client } = render([]);

  // Once /auth/me is in the cache the hook has made up its mind: `can` says yes
  // to everything only while that request is in flight.
  await waitFor(() =>
    expect(client.getQueryData(getMeQueryKey())).toBeDefined(),
  );
  expect(result.current.isPending).toBe(false);
  expect(listTags).not.toHaveBeenCalled();
  expect(listTagAssignments).not.toHaveBeenCalled();
});

it("reloads the tags when one changes", async () => {
  const { result } = render();

  await waitFor(() => expect(result.current.tags).toHaveLength(2));
  listTags.mockResolvedValue({ data: { tags: [BROKEN] } });
  FakeSocket.deliver({ event: "tags.changed" });

  await waitFor(() => expect(result.current.tags).toEqual([BROKEN]));
});

it("reloads the song library too, because a right can hide songs", async () => {
  getMe.mockResolvedValue(meResponse(["songs.view"]));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  // The song list is what a `view_songs` change moves, so a reader of it has to
  // be watching for the hook's invalidation to be worth anything.
  const { result } = renderHook(
    () => ({ tags: useTags(), songs: useQuery(listSongsOptions()) }),
    { wrapper },
  );

  // Settled before the event: an invalidation landing on a request still in
  // flight is answered by that request, and would count once either way.
  await waitFor(() => expect(result.current.tags.isPending).toBe(false));
  expect(listSongs).toHaveBeenCalledTimes(1);
  FakeSocket.deliver({ event: "tags.changed" });

  await waitFor(() => expect(listSongs).toHaveBeenCalledTimes(2));
  expect(listTags).toHaveBeenCalledTimes(2);
});

it("reloads the assignments when a song is tagged", async () => {
  const { result } = render();

  await waitFor(() => expect(result.current.bySong.size).toBe(2));
  listTagAssignments.mockResolvedValue({
    data: { assignments: [{ tag_id: "t-broken", song_ids: ["s2", "s3"] }] },
  });
  FakeSocket.deliver({
    event: "song_tags.changed",
    song_id: "s3",
    tag_id: "t-broken",
  });

  await waitFor(() =>
    expect(result.current.bySong.get("s3")).toEqual([BROKEN]),
  );
  expect(result.current.bySong.get("s1")).toBeUndefined();
});
