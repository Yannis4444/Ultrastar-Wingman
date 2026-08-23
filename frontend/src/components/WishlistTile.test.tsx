import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SongRead, WishRead } from "../api";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import WishlistTile from "./WishlistTile";

const { listWishlist, addWish, removeWish, getMe } = vi.hoisted(() => ({
  listWishlist: vi.fn(),
  addWish: vi.fn(),
  removeWish: vi.fn(),
  getMe: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listWishlist,
  addWish,
  removeWish,
  getMe,
}));

const WISHLIST = ["songs.view", "wishlist.view", "wishlist.add"];

function song(id: string, title: string, artist: string): SongRead {
  return {
    id,
    source: "usdb",
    title,
    artist,
    duration_seconds: 231,
    has_video: false,
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
  getMe.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

test("the tile lists the aggregated wishes, most wanted first", async () => {
  renderTile([wish(QUEEN, 3, true), wish(AFRICA, 1, false)]);

  expect(await screen.findByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.getByText("ABBA")).toBeInTheDocument();
  expect(screen.getByLabelText("3 wishes")).toHaveTextContent("3×");
  expect(screen.getByLabelText("1 wishes")).toHaveTextContent("1×");
  expect(screen.getAllByText("just now")).toHaveLength(2);

  // Only the caller's own wish can be taken back.
  expect(
    screen.getByRole("button", {
      name: "Take back your wish for Dancing Queen",
    }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Take back your wish for Africa" }),
  ).not.toBeInTheDocument();
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
  fireEvent.click(screen.getByRole("button", { name: "Wish" }));

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
});
