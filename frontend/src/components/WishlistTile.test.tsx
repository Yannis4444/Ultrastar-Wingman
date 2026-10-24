import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BuiltInTagRead, SongRead, WishRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import { builtInTagRead } from "../test/tags";
import WishlistTile from "./WishlistTile";

const {
  listWishlist,
  addWish,
  removeWish,
  clearWishes,
  getMe,
  listFavorites,
  listTags,
  listTagAssignments,
} = vi.hoisted(() => ({
  listWishlist: vi.fn(),
  addWish: vi.fn(),
  removeWish: vi.fn(),
  clearWishes: vi.fn(),
  getMe: vi.fn(),
  listFavorites: vi.fn(),
  listTags: vi.fn(),
  listTagAssignments: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listWishlist,
  addWish,
  removeWish,
  clearWishes,
  getMe,
  listFavorites,
  listTags,
  listTagAssignments,
}));

const WISHLIST = ["songs.view", "wishlist.view", "wishlist.add"];
const MODERATOR = [...WISHLIST, "wishlist.manage"];

function song(id: string, title: string, artist: string): SongRead {
  return {
    id,
    source: "usdb",
    title,
    artist,
    duration_seconds: 231,
    has_video: false,
    is_duet: false,
    created_at: "2026-01-01T12:00:00Z",
    language: null,
    genre: null,
    year: null,
    edition: null,
    creator: null,
  };
}

const QUEEN = song("usdb:1", "Dancing Queen", "ABBA");
const AFRICA = song("usdb:2", "Africa", "Toto");

function wish(song: SongRead, count: number, mine: boolean): WishRead {
  return { song, count, mine, latest: new Date().toISOString() };
}

function renderTile(wishes: WishRead[], capabilities = WISHLIST) {
  getMe.mockResolvedValue(meResponse(capabilities));
  listWishlist.mockResolvedValue({ data: { wishes } });
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <WishlistTile />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  listWishlist.mockReset();
  addWish.mockReset();
  removeWish.mockReset();
  clearWishes.mockReset();
  getMe.mockReset();
  for (const mock of [listFavorites, listTags, listTagAssignments])
    mock.mockReset();
  listFavorites.mockResolvedValue({ data: { song_ids: [] } });
  listTags.mockResolvedValue({ data: { tags: [], built_ins: [] } });
});

afterEach(() => vi.unstubAllGlobals());

test("the tile lists the aggregated wishes, most wanted first", async () => {
  renderTile([wish(QUEEN, 3, true), wish(AFRICA, 1, false)]);

  expect(await screen.findByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.getByText("ABBA")).toBeInTheDocument();
  expect(screen.getByLabelText("3 wishes")).toHaveTextContent("3×");
  // A single wish is the norm — the count only shows up beyond it.
  expect(screen.queryByText(/1×/)).not.toBeInTheDocument();

  // Only the caller's own wish can be taken back.
  expect(
    screen.getByRole("button", {
      name: "Take back your wish for Dancing Queen",
    }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Take back your wish for Africa" }),
  ).not.toBeInTheDocument();

  // The row mark stays the small check even though the wish *control* moved to
  // the three-bar family: at 0.8em a bar stack with a plus welded on is mud,
  // and the mark is a state ("wished"), not the control.
  const mark = screen.getByTitle("On your wishlist");
  expect(iconNames(mark)).toEqual(["check"]);
});

test("an empty wishlist invites the party to wish", async () => {
  renderTile([]);

  expect(
    await screen.findByText(/Nobody wished for anything yet/),
  ).toHaveTextContent("hit Wish");
});

test("a wishlist.updated broadcast refreshes the tile", async () => {
  renderTile([wish(QUEEN, 1, false)]);
  await screen.findByText("Dancing Queen");

  listWishlist.mockResolvedValue({
    data: { wishes: [wish(QUEEN, 2, false), wish(AFRICA, 1, false)] },
  });
  FakeSocket.deliver({
    event: "wishlist.updated",
    song_id: "usdb:2",
    count: 1,
    latest: new Date().toISOString(),
  });

  expect(await screen.findByText("Africa")).toBeInTheDocument();
  expect(await screen.findByLabelText("2 wishes")).toBeInTheDocument();
});

test("a song started on another phone leaves the tile without a reload", async () => {
  // Starting a song clears every wish for it on the server, which announces
  // the song at count 0 — the one event this phone hears about it.
  renderTile([wish(QUEEN, 2, true), wish(AFRICA, 1, false)]);
  await screen.findByText("Dancing Queen");

  listWishlist.mockResolvedValue({
    data: { wishes: [wish(AFRICA, 1, false)] },
  });
  FakeSocket.deliver({
    event: "wishlist.updated",
    song_id: "usdb:1",
    count: 0,
    latest: null,
  });

  await waitFor(() =>
    expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("Africa")).toBeInTheDocument();
});

test("taking back a wish deletes only the caller's own", async () => {
  renderTile([wish(QUEEN, 3, true)]);
  removeWish.mockResolvedValue({ data: undefined });

  fireEvent.click(
    await screen.findByRole("button", {
      name: "Take back your wish for Dancing Queen",
    }),
  );

  await waitFor(() =>
    expect(removeWish.mock.calls[0][0].path).toEqual({ song_id: "usdb:1" }),
  );
});

test("the wish button in the song details adds a wish", async () => {
  renderTile([wish(AFRICA, 1, false)]);
  addWish.mockResolvedValue({
    data: { song: AFRICA, count: 2, latest: new Date().toISOString() },
  });

  fireEvent.click(await screen.findByText("Africa"));
  fireEvent.click(screen.getByRole("button", { name: "Add to wishlist" }));

  await waitFor(() =>
    expect(addWish.mock.calls[0][0].body).toEqual({ song_id: "usdb:2" }),
  );
});

test("without the capability there is no way to change a wish", async () => {
  renderTile([wish(QUEEN, 1, true)], ["songs.view", "wishlist.view"]);
  await screen.findByText("Dancing Queen");

  await waitFor(() =>
    expect(
      screen.queryByRole("button", {
        name: "Take back your wish for Dancing Queen",
      }),
    ).not.toBeInTheDocument(),
  );
  // The own wish is still marked, just not removable.
  expect(screen.getByTitle("On your wishlist")).toBeInTheDocument();
});

test("a moderator takes somebody else's wish off the list", async () => {
  renderTile([wish(AFRICA, 2, false)], MODERATOR);
  clearWishes.mockResolvedValue({ data: undefined });

  fireEvent.click(
    await screen.findByRole("button", {
      name: "Take Africa off the wishlist for everybody",
    }),
  );

  await waitFor(() =>
    expect(clearWishes.mock.calls[0][0].path).toEqual({ song_id: "usdb:2" }),
  );
});

test("clearing is not offered where the only wish is the reader's own", async () => {
  // The take-back button beside it already does exactly that, and two buttons
  // for one outcome is one button too many.
  renderTile([wish(QUEEN, 1, true), wish(AFRICA, 2, true)], MODERATOR);
  await screen.findByText("Dancing Queen");

  expect(
    screen.queryByRole("button", {
      name: "Take Dancing Queen off the wishlist for everybody",
    }),
  ).not.toBeInTheDocument();
  // Two wishes, one of them somebody else's — that one is a moderator's to clear.
  expect(
    screen.getByRole("button", {
      name: "Take Africa off the wishlist for everybody",
    }),
  ).toBeInTheDocument();
});

test("without wishlist.manage nobody else's wish can be touched", async () => {
  renderTile([wish(AFRICA, 2, false)]);
  await screen.findByText("Africa");

  await waitFor(() =>
    expect(
      screen.queryByRole("button", {
        name: "Take Africa off the wishlist for everybody",
      }),
    ).not.toBeInTheDocument(),
  );
});

// --- the built-in heart ----------------------------------------------------

// The tile's heart is the song list's passive mark, so it follows the built-in:
// the party's colour, and gone from the rows when the mark is switched off.

function renderWithFavorite(
  builtIns: BuiltInTagRead[],
  capabilities = WISHLIST,
) {
  getMe.mockResolvedValue(meResponse(capabilities, { user: userRead() }));
  listWishlist.mockResolvedValue({ data: { wishes: [wish(QUEEN, 1, false)] } });
  listFavorites.mockResolvedValue({ data: { song_ids: [QUEEN.id] } });
  listTags.mockResolvedValue({ data: { tags: [], built_ins: builtIns } });
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <WishlistTile />
    </QueryClientProvider>,
  );
}

test("the tile's heart wears the colour the party gave the mark", async () => {
  const { container } = renderWithFavorite([
    builtInTagRead({ color: "gold" }),
    builtInTagRead({ id: "sung", color: "blue" }),
  ]);

  await waitFor(() =>
    expect(container.querySelector(".song-mark-favorite")).toHaveClass(
      "tag-color-gold",
    ),
  );
  // Home draws no tag, so it must not pay for the assignments listing.
  expect(listTagAssignments).not.toHaveBeenCalled();
});

// Same fixture as the test above, which proves the heart is drawn at all — only
// the built-in's `show_in_list` differs.
test("a built-in taken off the song rows is off this row too", async () => {
  const { container } = renderWithFavorite([
    builtInTagRead({ show_in_list: false }),
  ]);

  await screen.findByText("Dancing Queen");
  await waitFor(() => expect(listTags).toHaveBeenCalled());
  expect(container.querySelector(".song-mark-favorite")).toBeNull();
});
