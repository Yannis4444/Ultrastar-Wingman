import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import type { MeRead, SongRead, WishRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import { tagRead } from "../test/tags";
import SongSpinner from "./SongSpinner";

// Same seam as the other tests: the real TanStack wiring runs, only the
// transport is faked.
const {
  listSongs,
  listWishlist,
  listFavorites,
  getMe,
  listTags,
  listTagAssignments,
  listKaraokeSlots,
  listPlayers,
  openPlayerSelection,
  clearWishes,
} = vi.hoisted(() => ({
  listSongs: vi.fn(),
  listWishlist: vi.fn(),
  listFavorites: vi.fn(),
  getMe: vi.fn(),
  listTags: vi.fn(),
  listTagAssignments: vi.fn(),
  listKaraokeSlots: vi.fn(),
  listPlayers: vi.fn(),
  openPlayerSelection: vi.fn(),
  clearWishes: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listSongs,
  listWishlist,
  listFavorites,
  getMe,
  listTags,
  listTagAssignments,
  listKaraokeSlots,
  listPlayers,
  openPlayerSelection,
  clearWishes,
}));

function song(id: string, title: string): SongRead {
  return {
    id,
    source: "usdb",
    title,
    artist: `Artist of ${title}`,
    duration_seconds: 100,
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

function wish(song: SongRead, count = 1): WishRead {
  return { song, count, mine: false, latest: "2026-08-23T10:00:00" };
}

const QUEEN = song("usdb:1", "Dancing Queen");
const AFRICA = song("usdb:2", "Africa");
const WATERLOO = song("usdb:3", "Waterloo");

/** Signed in by default: favorites need an account to belong to. */
const ACCOUNT: Partial<MeRead> = { user: userRead(), role: "user" };

const SINGING = ["songs.view", "wishlist.view", "karaoke.sing"];

function renderSpinner(
  songs: SongRead[],
  wishes: WishRead[],
  favorites: string[] = [],
  me: Partial<MeRead> = ACCOUNT,
  capabilities = SINGING,
  props: ComponentProps<typeof SongSpinner> = {},
) {
  getMe.mockResolvedValue(meResponse(capabilities, me));
  listSongs.mockResolvedValue({ data: { songs } });
  listWishlist.mockResolvedValue({ data: { wishes } });
  listFavorites.mockResolvedValue({ data: { song_ids: favorites } });
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SongSpinner {...props} />
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
  listFavorites.mockReset();
  getMe.mockReset();
  listTags.mockReset();
  listTagAssignments.mockReset();
  // No tags unless a test seeds them: the reel holds the whole library.
  listTags.mockResolvedValue({ data: { tags: [] } });
  listTagAssignments.mockResolvedValue({ data: { assignments: [] } });
  // What the host spin opens the room's selection with. Never answered: these
  // tests are about the button and the body it sends, not about the modal.
  listKaraokeSlots.mockResolvedValue({
    data: { slots: [{ name: "blue", hex: "#048BB9" }], player_counts: [1] },
  });
  listPlayers.mockResolvedValue({ data: { players: [] } });
  openPlayerSelection.mockReset();
  openPlayerSelection.mockReturnValue(new Promise(() => {}));
  clearWishes.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const pickFrom = () =>
  screen.getByRole("combobox", { name: "Pick from" }) as HTMLSelectElement;

/** The option of that name inside the *Pick from* select. */
const scopeOption = (label: string) =>
  within(pickFrom()).getByRole("option", { name: label }) as HTMLOptionElement;

/** Picks a scope once its pool has arrived — the options load disabled. */
async function chooseScope(label: string): Promise<void> {
  await screen.findByRole("combobox", { name: "Pick from" });
  await waitFor(() => expect(scopeOption(label)).toBeEnabled());
  fireEvent.change(pickFrom(), {
    target: { value: scopeOption(label).value },
  });
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

test("the scope is one quiet select, opening on the whole library", async () => {
  renderSpinner([QUEEN, AFRICA], [wish(AFRICA)]);

  const select = await screen.findByRole("combobox", { name: "Pick from" });
  // A quiet select, not the bank of pills that used to compete with the reel.
  expect(select).toHaveClass("text-input-quiet");
  expect(select).toHaveValue("all");
  expect(
    within(select)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["All songs", "Favorites", "Wishlist", "Wishlist (weighted)"]);

  await chooseScope("Wishlist");

  expect(select).toHaveValue("wishlist");
});

test("the favorites scope spins the hearted songs and counts them", async () => {
  const { container } = renderSpinner(
    [QUEEN, AFRICA, WATERLOO],
    [],
    ["usdb:2", "usdb:3"],
  );
  await chooseScope("Favorites");

  expect(screen.getByText("2 favorites")).toBeInTheDocument();
  fireEvent.click(spinButton());
  expect(new Set(reelSongIds(container))).toEqual(
    new Set(["usdb:2", "usdb:3"]),
  );
});

test("without an account favorites cannot be picked and are not fetched", async () => {
  renderSpinner([QUEEN, AFRICA], [], [], { user: null, role: "guest" });

  await screen.findByRole("combobox", { name: "Pick from" });
  expect(scopeOption("Favorites")).toBeDisabled();
  expect(listFavorites).not.toHaveBeenCalled();
});

test("the caption under the select counts what the reel can land on", async () => {
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
  await screen.findByRole("combobox", { name: "Pick from" });

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
  await screen.findByRole("combobox", { name: "Pick from" });

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

test("the number on the die comes to rest before the reel does", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // Pinned randomness: every roll then steps exactly one face on, so a changed
  // number is a roll that happened and an unchanged one is a roll that did not.
  vi.spyOn(Math, "random").mockReturnValue(0);
  renderSpinner([QUEEN, AFRICA], []);
  await screen.findByText("2 songs");
  const die = () => iconNames(spinButton())[0];

  fireEvent.click(spinButton());
  // Both ends have to be pinned. Deep into the spin the die is still rolling —
  // "it settles before the reel" would otherwise also pass on a die that went
  // quiet in the first second, which is the opposite of what this is for.
  act(() => vi.advanceTimersByTime(3000));
  const late = die();
  act(() => vi.advanceTimersByTime(900));
  expect(die()).not.toBe(late);

  // And from here it no longer changes, while the covers are still gliding —
  // the button is busy — which is what makes the stop look like a die coming
  // to rest instead of a counter being switched off.
  act(() => vi.advanceTimersByTime(300));
  const settled = die();
  act(() => vi.advanceTimersByTime(700));

  expect(spinButton()).toBeDisabled();
  expect(die()).toBe(settled);
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

test("an empty scope cannot be picked", async () => {
  renderSpinner([], []);

  await screen.findByRole("combobox", { name: "Pick from" });
  expect(scopeOption("Favorites")).toBeDisabled();
  expect(scopeOption("Wishlist")).toBeDisabled();
  expect(scopeOption("Wishlist (weighted)")).toBeDisabled();
  // "All songs" stays open even so: an empty library is the library's state,
  // not a closed door.
  expect(scopeOption("All songs")).toBeEnabled();
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
  await screen.findByRole("combobox", { name: "Pick from" });

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

test("a favorited song stays in the reel even when a tag would hide it", async () => {
  listTags.mockResolvedValue({
    data: { tags: [tagRead({ id: "t-archive", hide_by_default: true })] },
  });
  listTagAssignments.mockResolvedValue({
    data: { assignments: [{ tag_id: "t-archive", song_ids: ["usdb:2"] }] },
  });
  const { container } = renderSpinner([QUEEN, AFRICA], [], ["usdb:2"]);
  await chooseScope("Favorites");

  // Somebody hearted it: a favorite is a decision, not a listing.
  fireEvent.click(spinButton());
  expect(new Set(reelSongIds(container))).toEqual(new Set(["usdb:2"]));
});

const hostButton = () =>
  screen.queryByRole("button", { name: "Spin on the host screen" });

test("the quiet host button stands under SPIN, and rests while the reel runs", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderSpinner([QUEEN, AFRICA], []);
  await screen.findByText("2 songs");

  // A plain button, never the gradient: SPIN is the gesture of this page.
  expect(hostButton()).toHaveClass("button");
  expect(hostButton()).not.toHaveClass("spinner-spin");
  expect(hostButton()).toBeEnabled();

  fireEvent.click(spinButton());
  expect(hostButton()).toBeDisabled();

  act(() => vi.advanceTimersByTime(6000));
  expect(hostButton()).toBeEnabled();
});

test("with nothing to land on there is no host button either", async () => {
  renderSpinner([], []);

  expect(
    await screen.findByText("No songs in the library yet"),
  ).toBeInTheDocument();
  expect(hostButton()).toBeNull();
});

test("without the right to start a song there is no host button", async () => {
  renderSpinner([QUEEN, AFRICA], [], [], ACCOUNT, [
    "songs.view",
    "wishlist.view",
  ]);
  await screen.findByText("2 songs");

  expect(hostButton()).toBeNull();
  expect(spinButton()).toBeEnabled();
});

test("the host button spins the select's scope on the host screen", async () => {
  renderSpinner([QUEEN, AFRICA, WATERLOO], [wish(AFRICA), wish(WATERLOO)]);
  await chooseScope("Wishlist");

  fireEvent.click(
    screen.getByRole("button", { name: "Spin on the host screen" }),
  );

  expect(
    await screen.findByRole("dialog", { name: "Spin on the host screen" }),
  ).toBeInTheDocument();
  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalledTimes(1));
  expect(openPlayerSelection.mock.calls[0][0].body.spin).toEqual({
    scope: "wishlist",
  });
});

test("a playlist's reel spins that playlist on the host screen", async () => {
  renderSpinner([], [], [], ACCOUNT, SINGING, {
    songs: [QUEEN, AFRICA],
    playlistId: "p1",
  });
  await screen.findByText("2 songs");

  fireEvent.click(
    screen.getByRole("button", { name: "Spin on the host screen" }),
  );

  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalledTimes(1));
  expect(openPlayerSelection.mock.calls[0][0].body.spin).toEqual({
    scope: "playlist",
    playlist_id: "p1",
  });
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

  await screen.findByRole("combobox", { name: "Pick from" });
  await waitFor(() => expect(listSongs).toHaveBeenCalled());
  expect(spinButton()).toBeDisabled();

  landTags();
  expect(await screen.findByText("1 song")).toBeInTheDocument();
  fireEvent.click(spinButton());
  expect(new Set(reelSongIds(container))).toEqual(new Set(["usdb:1"]));
});

const MANAGING = [...SINGING, "wishlist.manage"];

const takeOffButton = () =>
  screen.queryByRole("button", { name: "Take off the wishlist" });

/** Spins the scope of that label and lets the reel land. */
async function spinAndLand(label: string): Promise<void> {
  await chooseScope(label);
  fireEvent.click(spinButton());
  act(() => vi.advanceTimersByTime(6000));
}

test("a landed wish can be taken off the wishlist, and the result stays", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderSpinner(
    [QUEEN, AFRICA, WATERLOO],
    [wish(AFRICA, 2), wish(WATERLOO)],
    [],
    ACCOUNT,
    MANAGING,
  );
  // Pinned to the first wish: Africa wins.
  vi.spyOn(Math, "random").mockReturnValue(0);
  await spinAndLand("Wishlist");

  // Nothing to take off while the reel runs; once it lands the quiet button is
  // there, last in the column under the host one.
  const button = takeOffButton();
  expect(button).toHaveClass("button");
  expect(iconNames(button!)).toEqual(["trash"]);
  const column = button!.parentElement!;
  expect(column.lastElementChild).toBe(button);

  clearWishes.mockResolvedValue({ data: undefined });
  listWishlist.mockResolvedValue({ data: { wishes: [wish(WATERLOO)] } });
  fireEvent.click(button!);

  // The tile's take-off for everybody, no confirmation in between.
  await waitFor(() => expect(clearWishes).toHaveBeenCalledTimes(1));
  expect(clearWishes.mock.calls[0][0].path).toEqual({ song_id: "usdb:2" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  // The wish is gone, so is the button; the pool and its caption shrink, the
  // landed result stays where it was.
  await waitFor(() => expect(takeOffButton()).toBeNull());
  expect(screen.getByText("1 wished song")).toBeInTheDocument();
  expect(screen.getByText("Africa")).toBeInTheDocument();
});

test("the weighted wishlist offers the take-off too", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderSpinner([QUEEN], [wish(QUEEN, 3)], [], ACCOUNT, MANAGING);
  await spinAndLand("Wishlist (weighted)");

  expect(takeOffButton()).toBeInTheDocument();
});

test("without wishlist.manage the reel offers no take-off", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderSpinner([QUEEN], [wish(QUEEN)]);
  await spinAndLand("Wishlist");

  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(takeOffButton()).toBeNull();
});

test("a wished song the whole library landed on offers no take-off", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderSpinner([QUEEN], [wish(QUEEN)], [], ACCOUNT, MANAGING);
  await spinAndLand("All songs");

  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(takeOffButton()).toBeNull();
});

test("a playlist's reel never offers the take-off, even on a wished song", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderSpinner([], [wish(QUEEN)], [], ACCOUNT, MANAGING, {
    songs: [QUEEN],
    playlistId: "p1",
  });
  await screen.findByText("1 song");
  await waitFor(() => expect(listWishlist).toHaveBeenCalled());

  fireEvent.click(spinButton());
  act(() => vi.advanceTimersByTime(6000));

  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(takeOffButton()).toBeNull();
});

test("the take-off goes when somebody else's phone takes the wish off first", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderSpinner(
    [QUEEN, AFRICA],
    [wish(QUEEN), wish(AFRICA)],
    [],
    ACCOUNT,
    MANAGING,
  );
  vi.spyOn(Math, "random").mockReturnValue(0);
  await spinAndLand("Wishlist");
  expect(takeOffButton()).toBeInTheDocument();

  // The song was started somewhere else, which settles every wish for it.
  listWishlist.mockResolvedValue({ data: { wishes: [wish(AFRICA)] } });
  await act(async () => {
    FakeSocket.deliver({
      event: "wishlist.updated",
      song_id: "usdb:1",
      count: 0,
      latest: null,
    });
  });

  await waitFor(() => expect(takeOffButton()).toBeNull());
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
});
