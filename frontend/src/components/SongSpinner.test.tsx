import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { SongRead, WishRead } from "../api";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import SongSpinner from "./SongSpinner";

// Same seam as the other tests: the real TanStack wiring runs, only the
// transport is faked.
const { listSongs, listWishlist, getMe } = vi.hoisted(() => ({
  listSongs: vi.fn(),
  listWishlist: vi.fn(),
  getMe: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listSongs,
  listWishlist,
  getMe,
}));

function song(id: string, title: string): SongRead {
  return {
    id,
    source: "usdb",
    title,
    artist: `Artist of ${title}`,
    duration_seconds: 100,
    has_video: false,
    language: null,
    genre: null,
    year: null,
    edition: null,
    creator: null,
  };
}

function wish(song: SongRead, count = 1): WishRead {
  return { song, count, mine: false, latest: "2026-08-23T10:00:00" };
}

const QUEEN = song("usdb:1", "Dancing Queen");
const AFRICA = song("usdb:2", "Africa");
const WATERLOO = song("usdb:3", "Waterloo");

function renderSpinner(songs: SongRead[], wishes: WishRead[]) {
  getMe.mockResolvedValue(
    meResponse(["songs.view", "wishlist.view", "karaoke.sing"]),
  );
  listSongs.mockResolvedValue({ data: { songs } });
  listWishlist.mockResolvedValue({ data: { wishes } });
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SongSpinner />
    </QueryClientProvider>,
  );
}

/** The cover of every reel entry, top (winner) to bottom. */
function reelSongIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLImageElement>(".spinner-reel img")]
    .map((cover) => cover.getAttribute("src") ?? "")
    .map((source) => decodeURIComponent(source.split("/")[4] ?? ""));
}

const spinButton = () => screen.getByRole("button", { name: "Spin" });

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  listSongs.mockReset();
  listWishlist.mockReset();
  getMe.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Clicks a scope once the wishlist has arrived — the options load disabled. */
async function chooseScope(label: string): Promise<void> {
  const option = await screen.findByLabelText(label);
  await waitFor(() => expect(option).toBeEnabled());
  fireEvent.click(option);
}

test("the reel only holds songs from the selected scope", async () => {
  const { container } = renderSpinner(
    [QUEEN, AFRICA, WATERLOO],
    [wish(AFRICA), wish(WATERLOO)],
  );
  await chooseScope("Wishlist");

  fireEvent.click(spinButton());

  const ids = reelSongIds(container);
  // 40-60 fillers plus the winner and the resting cover.
  expect(ids.length).toBeGreaterThan(40);
  expect(new Set(ids)).toEqual(new Set(["usdb:2", "usdb:3"]));
});

test("the scope options are the shared check control, one of them chosen", async () => {
  renderSpinner([QUEEN, AFRICA], [wish(AFRICA)]);

  const all = await screen.findByLabelText("All songs");
  const wishlist = screen.getByLabelText("Wishlist");
  expect(all).toBeChecked();
  expect(all.closest("label")).toHaveClass("check-option");
  // Only the chosen option draws the animated mark.
  expect(document.querySelectorAll(".check-option-mark")).toHaveLength(1);

  await waitFor(() => expect(wishlist).toBeEnabled());
  fireEvent.click(wishlist);

  expect(wishlist).toBeChecked();
  expect(all).not.toBeChecked();
  expect(document.querySelectorAll(".check-option-mark")).toHaveLength(1);
});

test("the result slot is reserved but empty before the first spin", async () => {
  const { container } = renderSpinner([QUEEN, AFRICA], []);
  await screen.findByLabelText("All songs");

  // The page header already says "Random song": no placeholder repeats it.
  expect(container.querySelector(".spinner-result")).toBeEmptyDOMElement();
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();
});

test("the weighted scope gives a song one ticket per wish", async () => {
  // Every pick lands in the middle of the pool: ["Africa", "Africa", "Africa",
  // "Waterloo"] weighted against ["Africa", "Waterloo"] unweighted, so the two
  // scopes must produce different winners.
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const wishes = [wish(AFRICA, 3), wish(WATERLOO, 1)];

  const plain = renderSpinner([AFRICA, WATERLOO], wishes);
  await chooseScope("Wishlist");
  fireEvent.click(spinButton());
  expect(new Set(reelSongIds(plain.container))).toEqual(new Set(["usdb:3"]));
  plain.unmount();

  const weighted = renderSpinner([AFRICA, WATERLOO], wishes);
  await chooseScope("Wishlist (weighted)");
  fireEvent.click(spinButton());
  expect(new Set(reelSongIds(weighted.container))).toEqual(new Set(["usdb:2"]));
});

test("the reel stays put when an unrelated update re-renders the spinner", async () => {
  const { container } = renderSpinner([QUEEN, AFRICA, WATERLOO], []);
  await screen.findByLabelText("All songs");

  fireEvent.click(spinButton());
  const before = reelSongIds(container);

  // A wish somewhere else in the party refetches the wishlist and re-renders.
  listWishlist.mockResolvedValue({ data: { wishes: [wish(QUEEN)] } });
  await act(async () => {
    FakeSocket.deliver({
      event: "wishlist.updated",
      song_id: "usdb:1",
      count: 1,
      latest: "2026-08-23T10:00:00",
    });
  });

  expect(reelSongIds(container)).toEqual(before);
});

test("the finished spin settles in place and opens no modal by itself", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderSpinner([QUEEN], []);
  await screen.findByLabelText("All songs");

  fireEvent.click(spinButton());
  expect(spinButton()).toBeDisabled();
  // The button keeps its word while the reel runs — no "…" flicker.
  expect(spinButton()).toHaveTextContent("Spin");

  act(() => vi.advanceTimersByTime(6000));

  // The result is on the page; the song modal is not.
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(spinButton()).toBeEnabled();
});

test("the settled result opens the song modal when it is clicked", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderSpinner([QUEEN], []);
  await screen.findByLabelText("All songs");

  // Nothing to open before the first spin.
  expect(
    screen.getByRole("button", { name: "Nothing spun yet" }),
  ).toBeDisabled();

  fireEvent.click(spinButton());
  act(() => vi.advanceTimersByTime(6000));

  fireEvent.click(screen.getByText("Dancing Queen"));

  expect(
    screen.getByRole("dialog", { name: "Dancing Queen" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sing" })).toBeInTheDocument();
});

test("the cover is the second way into the song modal", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderSpinner([QUEEN], []);
  await screen.findByLabelText("All songs");

  fireEvent.click(spinButton());
  act(() => vi.advanceTimersByTime(6000));

  fireEvent.click(
    screen.getByRole("button", { name: "Details for Dancing Queen" }),
  );

  expect(
    screen.getByRole("dialog", { name: "Dancing Queen" }),
  ).toBeInTheDocument();
});

test("an empty scope cannot be spun", async () => {
  renderSpinner([], []);

  expect(await screen.findByLabelText("Wishlist")).toBeDisabled();
  expect(screen.getByLabelText("Wishlist (weighted)")).toBeDisabled();
  // No songs at all: even "All songs" has nothing to pick from.
  expect(spinButton()).toBeDisabled();
});
