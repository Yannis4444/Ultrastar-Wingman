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
import { iconNames } from "../test/icons";
import { tagRead } from "../test/tags";
import SongSpinner from "./SongSpinner";

// Same seam as the other tests: the real TanStack wiring runs, only the
// transport is faked.
const { listSongs, listWishlist, getMe, listTags, listTagAssignments } =
  vi.hoisted(() => ({
    listSongs: vi.fn(),
    listWishlist: vi.fn(),
    getMe: vi.fn(),
    listTags: vi.fn(),
    listTagAssignments: vi.fn(),
  }));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listSongs,
  listWishlist,
  getMe,
  listTags,
  listTagAssignments,
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
  listTags.mockReset();
  listTagAssignments.mockReset();
  // No tags unless a test seeds them: the reel holds the whole library.
  listTags.mockResolvedValue({ data: { tags: [] } });
  listTagAssignments.mockResolvedValue({ data: { assignments: [] } });
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

test("the scope options are segmented pills, one of them chosen", async () => {
  renderSpinner([QUEEN, AFRICA], [wish(AFRICA)]);

  const all = await screen.findByLabelText("All songs");
  const wishlist = screen.getByLabelText("Wishlist");
  expect(all).toBeChecked();
  expect(all.closest("label")).toHaveClass("spinner-scope");
  // The pills are radios of one group: the keyboard and screen-reader
  // semantics stay with the hidden input.
  expect(all).toHaveAttribute("type", "radio");
  expect(all).toHaveClass("visually-hidden");

  await waitFor(() => expect(wishlist).toBeEnabled());
  fireEvent.click(wishlist);

  expect(wishlist).toBeChecked();
  expect(all).not.toBeChecked();
});

test("the caption under the pills counts what the reel can land on", async () => {
  renderSpinner(
    [QUEEN, AFRICA, WATERLOO],
    [wish(AFRICA, 3), wish(WATERLOO, 1)],
  );

  expect(await screen.findByText("3 songs")).toBeInTheDocument();

  await chooseScope("Wishlist");
  expect(screen.getByText("2 wished songs")).toBeInTheDocument();

  // Weighted: one ticket per wish, so the wish total is what matters.
  await chooseScope("Wishlist (weighted)");
  expect(screen.getByText("2 wished songs · 4 wishes")).toBeInTheDocument();
});

test("an empty library says so instead of showing a count", async () => {
  renderSpinner([], []);

  expect(
    await screen.findByText("No songs in the library yet"),
  ).toBeInTheDocument();
});

test("the reel covers load eagerly, so they are there when they fly past", async () => {
  const { container } = renderSpinner([QUEEN, AFRICA], []);
  // The caption is the sign that the library has arrived.
  await screen.findByText("2 songs");

  fireEvent.click(spinButton());

  const covers = container.querySelectorAll(".spinner-reel img");
  expect(covers.length).toBeGreaterThan(40);
  for (const cover of covers) {
    expect(cover).toHaveAttribute("loading", "eager");
  }
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

test("the first spin starts from the logo, later spins from the last winner", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { container } = renderSpinner([QUEEN], []);
  await screen.findByText("1 song");
  const resting = () => container.querySelector(".spinner-reel > :last-child");

  fireEvent.click(spinButton());
  // The window showed the logo before the first spin; it is what spins away.
  expect(resting()).toHaveClass("spinner-cover-logo");
  expect(resting()?.tagName).toBe("SPAN");

  act(() => vi.advanceTimersByTime(6000));
  fireEvent.click(spinButton());
  // From then on the previous winner's cover is the one on show at the start.
  expect(resting()?.tagName).toBe("IMG");
  const ids = reelSongIds(container);
  expect(ids[ids.length - 1]).toBe("usdb:1");
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
  // The pool line is the page's "ready": the reel holds nothing until the tag
  // listings have said which songs are kept out of it.
  await screen.findByText("1 song");

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

test("the die on the button rolls through its faces while the reel runs", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderSpinner([QUEEN, AFRICA], []);
  await screen.findByText("2 songs");
  const die = () => iconNames(spinButton())[0];
  expect(die()).toBe("dice");

  fireEvent.click(spinButton());
  const seen = new Set<string>();
  for (let step = 0; step < 6; step += 1) {
    act(() => vi.advanceTimersByTime(150));
    seen.add(die());
  }

  // Every roll lands on another face, so a handful of steps show several.
  expect(seen.size).toBeGreaterThan(1);
  for (const name of seen) expect(name).toMatch(/^dice(-[1-6])?$/);

  // Settled: the die stops on whatever it last showed and stays there.
  act(() => vi.advanceTimersByTime(6000));
  const rest = die();
  act(() => vi.advanceTimersByTime(1000));
  expect(die()).toBe(rest);
});

test("the settled result opens the song modal when it is clicked", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderSpinner([QUEEN], []);
  await screen.findByText("1 song");

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
  await screen.findByText("1 song");

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

test("a hidden-by-default tag keeps its songs out of the reel and its count", async () => {
  listTags.mockResolvedValue({
    data: { tags: [tagRead({ id: "t-archive", hide_by_default: true })] },
  });
  listTagAssignments.mockResolvedValue({
    data: { assignments: [{ tag_id: "t-archive", song_ids: ["usdb:2"] }] },
  });
  const { container } = renderSpinner([QUEEN, AFRICA], []);
  await screen.findByLabelText("All songs");

  // The pool line counts what the reel can land on, so it drops too.
  expect(await screen.findByText("1 song")).toBeInTheDocument();
  fireEvent.click(spinButton());
  expect(new Set(reelSongIds(container))).toEqual(new Set(["usdb:1"]));
});

test("a wished song stays in the reel even when a tag would hide it", async () => {
  listTags.mockResolvedValue({
    data: { tags: [tagRead({ id: "t-archive", hide_by_default: true })] },
  });
  listTagAssignments.mockResolvedValue({
    data: { assignments: [{ tag_id: "t-archive", song_ids: ["usdb:2"] }] },
  });
  const { container } = renderSpinner([QUEEN, AFRICA], [wish(AFRICA)]);
  await chooseScope("Wishlist");

  // Somebody asked for it by name: the wishlist is a decision, not a listing.
  fireEvent.click(spinButton());
  expect(new Set(reelSongIds(container))).toEqual(new Set(["usdb:2"]));
});

test("the reel waits for the tags rather than spinning what they would hide", async () => {
  // The library answers first and the tag listings are still out — the state a
  // cold load passes through. Nothing may be spun in it: the criteria are empty
  // until the tags land, so an archived song would be a candidate.
  let landTags = (): void => {};
  listTags.mockReturnValue(
    new Promise((resolve) => {
      landTags = () =>
        resolve({
          data: {
            tags: [tagRead({ id: "t-archive", hide_by_default: true })],
          },
        });
    }),
  );
  listTagAssignments.mockResolvedValue({
    data: { assignments: [{ tag_id: "t-archive", song_ids: ["usdb:2"] }] },
  });
  const { container } = renderSpinner([QUEEN, AFRICA], []);

  await screen.findByLabelText("All songs");
  await waitFor(() => expect(listSongs).toHaveBeenCalled());
  expect(spinButton()).toBeDisabled();

  landTags();
  expect(await screen.findByText("1 song")).toBeInTheDocument();
  fireEvent.click(spinButton());
  expect(new Set(reelSongIds(container))).toEqual(new Set(["usdb:1"]));
});
