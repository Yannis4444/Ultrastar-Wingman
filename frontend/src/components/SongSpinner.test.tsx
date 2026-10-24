import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { StrictMode, type ComponentProps } from "react";
import { MemoryRouter } from "react-router-dom";
import type {
  MeRead,
  PlayerRead,
  SelectionRead,
  SlotCreate,
  SongRead,
  SpinRequest,
  WishRead,
} from "../api";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import { tagRead } from "../test/tags";
import { REVEAL_MS } from "./SongReel";
import SongSpinner, { SHOW_IT_DELAY_MS } from "./SongSpinner";

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
  getPlayerSelection,
  spinPlayerSelection,
  pickPlayerSelection,
  setPlayerSelectionSlots,
  startPlayerSelection,
  getDeviceStatus,
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
  getPlayerSelection: vi.fn(),
  spinPlayerSelection: vi.fn(),
  pickPlayerSelection: vi.fn(),
  setPlayerSelectionSlots: vi.fn(),
  startPlayerSelection: vi.fn(),
  getDeviceStatus: vi.fn(),
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
  getPlayerSelection,
  spinPlayerSelection,
  pickPlayerSelection,
  setPlayerSelectionSlots,
  startPlayerSelection,
  getDeviceStatus,
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

function player(id: string, name: string): PlayerRead {
  return { id, name, registered: false, hidden: false, has_avatar: false };
}

const PLAYERS = [player("aaa", "Alice"), player("bbb", "Bob")];

const SLOTS = [
  { name: "blue", hex: "#048BB9" },
  { name: "red", hex: "#D00000" },
];

/** The token the fake backend hands out. It is never drawn, only sent back. */
const TOKEN = "selection-token";

/** When the fake selection was opened: its identity, never its content. */
const OPENED_AT = "2026-09-06T20:00:00.000Z";

/** Every answer is newer than the last, which is what the page orders them by. */
let writes = 0;

function stamp(): string {
  writes += 1;
  return new Date(Date.parse(OPENED_AT) + writes * 1000).toISOString();
}

/**
 * A spun selection as the backend answers: the server's pick, the slots as
 * asked for, and the spin stamped *now* on the (faked) clock, which is what
 * the phone's reveal waits on.
 */
function spunSelection(
  winner: SongRead,
  slots: SlotCreate[] = [],
  extra: Partial<SelectionRead> = {},
  spinId = 1,
  scope: SpinRequest["scope"] = "all",
): SelectionRead {
  const asked = new Map(slots.map((slot) => [slot.color, slot.player_id]));
  return {
    song: winner,
    slots: SLOTS.map((color) => {
      const id = asked.get(color.name) ?? null;
      return {
        color: color.name,
        player: PLAYERS.find((person) => person.id === id) ?? null,
        card_uid: null,
      };
    }),
    opened_at: OPENED_AT,
    updated_at: stamp(),
    auto_start_at: null,
    spin: {
      id: spinId,
      spun_at: new Date(Date.now()).toISOString(),
      scope,
      playlist_id: null,
      origin: "phone",
      revealed: false,
    },
    ...extra,
  };
}

/** The spun selection with its spin taken off: what `/pick` answers. */
function picked(
  winner: SongRead,
  slots: SlotCreate[] = [],
  extra: Partial<SelectionRead> = {},
): SelectionRead {
  return spunSelection(winner, slots, { spin: null, ...extra });
}

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
  strict = false,
) {
  getMe.mockResolvedValue(meResponse(capabilities, me));
  listSongs.mockResolvedValue({ data: { songs } });
  listWishlist.mockResolvedValue({ data: { wishes } });
  listFavorites.mockResolvedValue({ data: { song_ids: favorites } });
  // The player selection Play opens links to /settings from its setup guide,
  // so the page needs a router around it — the real app always has one.
  const tree = (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <SongSpinner {...props} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

/** The cover of every reel entry, top (winner) to bottom. */
function reelSongIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLImageElement>(".spinner-reel img")]
    .map((cover) => cover.getAttribute("src") ?? "")
    .map((source) => decodeURIComponent(source.split("/")[4] ?? ""));
}

const spinButton = () => screen.getByRole("button", { name: "Spin" });
/** This screen's SPIN while its own reel runs: the press that lands it. */
const localShowIt = () => screen.getByRole("button", { name: "Show it" });
/** SPIN whatever it reads: the die is on it either way. */
const spinControl = () =>
  screen.getByRole("button", { name: /^(Spin|Show it)$/ });

const fetchMock = vi.fn();

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  window.localStorage.clear();
  writes = 0;
  // The one hand-written request: the DELETE that gives the room back.
  fetchMock.mockReset();
  fetchMock.mockRejectedValue(new Error("no network in tests"));
  vi.stubGlobal("fetch", fetchMock);
  listSongs.mockReset();
  listWishlist.mockReset();
  listFavorites.mockReset();
  getMe.mockReset();
  listTags.mockReset();
  listTagAssignments.mockReset();
  // No tags unless a test seeds them: the reel holds the whole library.
  listTags.mockResolvedValue({ data: { tags: [] } });
  listTagAssignments.mockResolvedValue({ data: { assignments: [] } });
  // What a spin on the host screen opens the room's selection with, and what
  // the backend answers: the server's pick, Dancing Queen, then Africa.
  listKaraokeSlots.mockResolvedValue({
    data: { slots: SLOTS, player_counts: [1, 2] },
  });
  listPlayers.mockResolvedValue({ data: { players: PLAYERS } });
  openPlayerSelection.mockReset();
  openPlayerSelection.mockImplementation(
    async (options: { body: { slots?: SlotCreate[] } }) => ({
      data: {
        selection: spunSelection(QUEEN, options.body.slots),
        token: TOKEN,
      },
    }),
  );
  spinPlayerSelection.mockReset();
  spinPlayerSelection.mockImplementation(async () => ({
    data: spunSelection(AFRICA, [], {}, 2),
  }));
  pickPlayerSelection.mockReset();
  pickPlayerSelection.mockImplementation(async () => ({
    data: picked(QUEEN),
  }));
  setPlayerSelectionSlots.mockReset();
  startPlayerSelection.mockReset();
  getDeviceStatus.mockResolvedValue({ data: { online: false } });
  getPlayerSelection.mockReset();
  getPlayerSelection.mockResolvedValue({ data: { selection: null } });
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
  // While the reel runs the button names the press that lands it, and never a
  // "…" flicker — held, lit, for the double tap's moment, then live. Held is
  // `aria-disabled`, never `disabled`, which would throw a keyboard's focus
  // off the button the moment it spun.
  expect(localShowIt()).toHaveTextContent("Show it");
  expect(localShowIt()).toHaveClass("spinner-spin-running");
  expect(localShowIt()).toBeEnabled();
  expect(localShowIt()).toHaveAttribute("aria-disabled", "true");
  act(() => vi.advanceTimersByTime(SHOW_IT_DELAY_MS));
  expect(localShowIt()).toBeEnabled();
  expect(localShowIt()).not.toHaveAttribute("aria-disabled");

  act(() => vi.advanceTimersByTime(6000));

  // The result is on the page; the song modal is not.
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(spinButton()).toBeEnabled();
});

test("Show it on this screen lands the reel at once on the winner it drew", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { container } = renderSpinner([QUEEN, AFRICA], []);
  await screen.findByText("2 songs");
  // Pinned randomness: the winner is the first song of the pool.
  vi.spyOn(Math, "random").mockReturnValue(0);

  fireEvent.click(spinButton());
  act(() => vi.advanceTimersByTime(1000));
  // Mid-spin: the covers fly, the die rolls, Pick from and the pills rest.
  expect(localShowIt()).toHaveClass("spinner-spin-running");
  expect(pickFrom()).toBeDisabled();
  expect(hostPill()).toBeDisabled();
  expect(playButton()).toBeDisabled();

  fireEvent.click(localShowIt());

  // Landed in the press, seconds before the reel would have: the winner it
  // already had in the window and the words, the die at rest, SPIN reading
  // Spin, and everything that rested while it ran back on.
  expect(
    screen.getByRole("button", { name: "Details for Dancing Queen" }),
  ).toBeEnabled();
  expect(container.querySelectorAll(".spinner-reel img")).toHaveLength(1);
  expect(screen.getByText("Dancing Queen").closest("button")).toHaveClass(
    "spinner-winner",
  );
  expect(spinButton()).not.toHaveClass("spinner-spin-running");
  expect(screen.queryByRole("button", { name: "Show it" })).toBeNull();
  expect(pickFrom()).toBeEnabled();
  expect(hostPill()).toBeEnabled();
  expect(playButton()).toBeEnabled();

  // The reel's own timer running out later lands nothing a second time.
  act(() => vi.advanceTimersByTime(6000));
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();

  // And the next press is a spin again, not a landing.
  fireEvent.click(spinButton());
  expect(localShowIt()).toHaveClass("spinner-spin-running");
});

test("a double tap on this screen's SPIN is one spin, not a spin and a landing", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { container } = renderSpinner([QUEEN, AFRICA], []);
  await screen.findByText("2 songs");

  // The second tap of the double tap, as fast as a finger makes it.
  fireEvent.click(spinButton());
  act(() => vi.advanceTimersByTime(150));
  fireEvent.click(localShowIt());

  // Still spinning: the covers fly, the die rolls, nothing has landed.
  expect(
    container.querySelectorAll(".spinner-reel img").length,
  ).toBeGreaterThan(1);
  expect(localShowIt()).toHaveClass("spinner-spin-running");
  expect(playButton()).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: /^Details for / }),
  ).not.toBeInTheDocument();

  // And it lands on the reel's own clock, once.
  act(() => vi.advanceTimersByTime(6000));
  expect(container.querySelectorAll(".spinner-reel img")).toHaveLength(1);
  expect(spinButton()).toBeEnabled();
  expect(playButton()).toBeEnabled();
});

test("this screen's Show it becomes pressable exactly SHOW_IT_DELAY_MS into the spin", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { container } = renderSpinner([QUEEN, AFRICA], []);
  await screen.findByText("2 songs");

  fireEvent.click(spinButton());
  // Short of the moment by more than the few real milliseconds the clock may
  // drift on its own here.
  act(() => vi.advanceTimersByTime(SHOW_IT_DELAY_MS - 50));
  expect(localShowIt()).toHaveAttribute("aria-disabled", "true");
  // The click reaches the button — it is not `disabled` — and is ignored.
  fireEvent.click(localShowIt());
  expect(localShowIt()).toHaveClass("spinner-spin-running");
  expect(
    container.querySelectorAll(".spinner-reel img").length,
  ).toBeGreaterThan(1);

  act(() => vi.advanceTimersByTime(50));
  expect(localShowIt()).not.toHaveAttribute("aria-disabled");
  // A deliberate second press, after the covers have been seen to move, lands
  // the reel at once.
  fireEvent.click(localShowIt());
  expect(container.querySelectorAll(".spinner-reel img")).toHaveLength(1);
  expect(spinButton()).not.toHaveClass("spinner-spin-running");
  expect(playButton()).toBeEnabled();

  // The next spin starts held again: the last spin's moment is not inherited.
  fireEvent.click(spinButton());
  expect(localShowIt()).toHaveAttribute("aria-disabled", "true");
});

test("under reduced motion this screen's SPIN never reads Show it", async () => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
  renderSpinner([QUEEN], []);
  await screen.findByText("1 song");

  // The reel lands in the press that spun it.
  fireEvent.click(spinButton());
  expect(screen.queryByRole("button", { name: "Show it" })).toBeNull();
  expect(spinButton()).toBeEnabled();
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(playButton()).toBeEnabled();
});

test("the die on the button rolls through its faces while the reel runs", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderSpinner([QUEEN, AFRICA], []);
  await screen.findByText("2 songs");
  const die = () => iconNames(spinControl())[0];
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
  const die = () => iconNames(spinControl())[0];

  fireEvent.click(spinButton());
  // Both ends have to be pinned. Deep into the spin the die is still rolling —
  // "it settles before the reel" would otherwise also pass on a die that went
  // quiet in the first second, which is the opposite of what this is for.
  act(() => vi.advanceTimersByTime(3000));
  const late = die();
  act(() => vi.advanceTimersByTime(900));
  expect(die()).not.toBe(late);

  // And from here it no longer changes, while the covers are still gliding —
  // SPIN still reads Show it — which is what makes the stop look like a die coming
  // to rest instead of a counter being switched off.
  act(() => vi.advanceTimersByTime(300));
  const settled = die();
  act(() => vi.advanceTimersByTime(700));

  expect(localShowIt()).toHaveClass("spinner-spin-running");
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

const playButton = () => screen.getByRole("button", { name: "Play" });
const hostPill = () => screen.queryByRole("radio", { name: "Host screen" });
const localPill = () => screen.queryByRole("radio", { name: "This screen" });

test("one action row: SPIN, then Play, which waits for a landed song", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderSpinner([QUEEN], []);
  await screen.findByText("1 song");

  // SPIN first and the plain Play beside it — never a second gradient, never
  // a second die, and the blue `play` before the word.
  const row = playButton().parentElement!;
  expect(row).toHaveClass("spinner-actions");
  expect([...row.children]).toEqual([spinButton(), playButton()]);
  expect(playButton()).toHaveClass("button");
  expect(playButton()).not.toHaveClass("spinner-spin", "button-primary");
  expect(iconNames(playButton())).toEqual(["play"]);
  expect(playButton()).toBeDisabled();

  fireEvent.click(spinButton());
  expect(playButton()).toBeDisabled();

  act(() => vi.advanceTimersByTime(6000));
  expect(playButton()).toBeEnabled();
});

test("Play on this screen picks the singers for the landed song", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  openPlayerSelection.mockReturnValue(new Promise(() => {}));
  renderSpinner([QUEEN], []);
  await screen.findByText("1 song");

  fireEvent.click(spinButton());
  act(() => vi.advanceTimersByTime(6000));
  fireEvent.click(playButton());

  // The song modal's Sing by another door: the picker opens over the song,
  // and it is the picker that takes the room, with a song and not a spin.
  expect(
    await screen.findByRole("dialog", { name: "Player selection" }),
  ).toHaveTextContent("Dancing Queen");
  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalledTimes(1));
  expect(openPlayerSelection.mock.calls[0][0].body.song_id).toBe("usdb:1");
  expect(openPlayerSelection.mock.calls[0][0].body.spin).toBeUndefined();
});

test("the pills say where the reel runs, this screen first, and are kept per device", async () => {
  const { unmount } = renderSpinner([QUEEN, AFRICA], []);
  await screen.findByText("2 songs");

  // The column's first row: two pills over *Pick from*, the TV's with its glyph.
  const group = screen.getByRole("group", { name: "Where the reel runs" });
  expect(group).toHaveClass("spinner-target");
  expect(localPill()).toBeChecked();
  expect(hostPill()).not.toBeChecked();
  expect(iconNames(hostPill()!.closest("label")!)).toEqual(["tv"]);
  expect(
    group.compareDocumentPosition(pickFrom()) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  fireEvent.click(hostPill()!);
  expect(hostPill()).toBeChecked();
  expect(window.localStorage.getItem("wingman.spinTarget")).toBe("host");
  unmount();

  renderSpinner([QUEEN, AFRICA], []);
  await screen.findByText("2 songs");
  expect(hostPill()).toBeChecked();
});

test("a kept Host screen opens nothing on entry", async () => {
  window.localStorage.setItem("wingman.spinTarget", "host");
  const { container } = renderSpinner([QUEEN, AFRICA], []);
  await screen.findByText("2 songs");
  await waitFor(() => expect(spinButton()).toBeEnabled());

  // The room's selection is taken by the first SPIN, never by the page: the
  // window stands on its empty tile and nothing was asked of the room.
  expect(hostPill()).toBeChecked();
  expect(openPlayerSelection).not.toHaveBeenCalled();
  expect(container.querySelector(".spinner-window img")).toBeNull();
  expect(container.querySelector(".spinner-result")).toBeEmptyDOMElement();
  expect(playButton()).toBeDisabled();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("the pills rest while this screen's reel runs", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderSpinner([QUEEN, AFRICA], []);
  await screen.findByText("2 songs");

  fireEvent.click(spinButton());
  expect(hostPill()).toBeDisabled();
  expect(localPill()).toBeDisabled();

  act(() => vi.advanceTimersByTime(6000));
  expect(hostPill()).toBeEnabled();
});

test("without the right to start a song there are no pills and no Play", async () => {
  // Even where this device kept the TV: the reel is this screen's.
  window.localStorage.setItem("wingman.spinTarget", "host");
  renderSpinner([QUEEN, AFRICA], [], [], ACCOUNT, [
    "songs.view",
    "wishlist.view",
  ]);
  await screen.findByText("2 songs");
  await waitFor(() => expect(hostPill()).toBeNull());

  expect(localPill()).toBeNull();
  expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  expect(spinButton()).toBeEnabled();
  fireEvent.click(spinButton());
  expect(openPlayerSelection).not.toHaveBeenCalled();
});

test("on the Host screen SPIN spins the select's scope on the TV", async () => {
  renderSpinner([QUEEN, AFRICA, WATERLOO], [wish(AFRICA), wish(WATERLOO)]);
  await chooseScope("Wishlist");
  fireEvent.click(hostPill()!);

  await waitFor(() => expect(spinButton()).toBeEnabled());
  fireEvent.click(spinButton());

  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalledTimes(1));
  expect(openPlayerSelection.mock.calls[0][0].body.spin).toEqual({
    scope: "wishlist",
  });
  // No dialog: the page is the view.
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("a playlist's reel spins that playlist on the host screen", async () => {
  renderSpinner([], [], [], ACCOUNT, SINGING, {
    songs: [QUEEN, AFRICA],
    playlistId: "p1",
  });
  await screen.findByText("2 songs");

  fireEvent.click(hostPill()!);
  await waitFor(() => expect(spinButton()).toBeEnabled());
  fireEvent.click(spinButton());

  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalledTimes(1));
  expect(openPlayerSelection.mock.calls[0][0].body.spin).toEqual({
    scope: "playlist",
    playlist_id: "p1",
  });
});

test("a fixed pool without a playlist to name offers no TV", async () => {
  renderSpinner([], [], [], ACCOUNT, SINGING, { songs: [QUEEN] });
  await screen.findByText("1 song");

  expect(hostPill()).toBeNull();
  expect(playButton()).toBeInTheDocument();
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
  screen.queryByRole("button", { name: /off the wishlist for everybody$/ });

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

  // Once it lands the wishlist tile's own trash is there, named for the song,
  // beside the result and not inside it: the right cell of the result's grid,
  // the song's button its sibling.
  const button = takeOffButton();
  expect(button).toHaveAccessibleName(
    "Take Africa off the wishlist for everybody",
  );
  expect(button).toHaveClass("icon-button", "icon-button-bordered");
  expect(iconNames(button!)).toEqual(["trash"]);
  const result = button!.parentElement!;
  expect(result).toHaveClass("spinner-result");
  const winner = result.querySelector(".spinner-winner")!;
  expect([...result.children]).toEqual([winner, button]);
  expect(winner).not.toContainElement(button);
  // Not in the action row either.
  expect(document.querySelector(".spinner-actions")).not.toContainElement(
    button,
  );

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

test("the take-off waits for the reel to land, and steps back with the next spin", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  renderSpinner([QUEEN], [wish(QUEEN)], [], ACCOUNT, MANAGING);
  await chooseScope("Wishlist");

  fireEvent.click(spinButton());
  expect(takeOffButton()).toBeNull();

  act(() => vi.advanceTimersByTime(6000));
  expect(takeOffButton()).toBeInTheDocument();

  // A new spin: the result line steps back, and so does its take-off.
  fireEvent.click(spinButton());
  expect(takeOffButton()).toBeNull();
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

// --- The Host screen: the room's one selection, spun on the TV ---

/** The line the result slot reads while the TV's reel runs. */
const WAITING = "Spinning on the host screen…";
const TAKEN = "Somebody else took over the selection.";

/** The die while the TV's reel still runs: the press that shows the song. */
const showIt = () => screen.getByRole("button", { name: "Show it" });
const spinAgain = () => screen.getByRole("button", { name: "Spin again" });

/** Every `DELETE …/selection` so far: the pills, the unmount and a closing
 *  tab all go through the one hand-written `fetch`. */
function releases(): unknown[][] {
  return fetchMock.mock.calls.filter((args) =>
    String(args[0]).startsWith("/api/v1/karaoke/selection"),
  );
}

function expectRelease(call: unknown[], token = TOKEN): void {
  // No query at all: a token in the URL lands in an access log.
  expect(call[0]).toBe("/api/v1/karaoke/selection");
  expect(call[1]).toMatchObject({
    method: "DELETE",
    keepalive: true,
    headers: { "X-Selection-Token": token },
  });
}

/** The `selection.changed` broadcast, as the backend sends it. */
function broadcast(selection: SelectionRead | null): void {
  act(() => FakeSocket.deliver({ event: "selection.changed", selection }));
}

/** The TV's reel lands: `REVEAL_MS` after the spin, on the server's clock. */
function reelLands(): void {
  act(() => vi.advanceTimersByTime(REVEAL_MS));
}

/** The page on the Host screen with its pool in and SPIN ready. */
async function onHostScreen(...args: Parameters<typeof renderSpinner>) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  window.localStorage.setItem("wingman.spinTarget", "host");
  const rendered = renderSpinner(...args);
  await waitFor(() => expect(spinButton()).toBeEnabled());
  return rendered;
}

/** SPIN pressed on the Host screen and answered, the TV's reel still running. */
async function spunOnHost(): Promise<void> {
  fireEvent.click(spinButton());
  expect(await screen.findByText(WAITING)).toBeInTheDocument();
}

const LIBRARY = [QUEEN, AFRICA, WATERLOO];

test("Spin opens the room's selection with a spin and waits for the TV's reel", async () => {
  window.localStorage.setItem(
    "wingman.playerSlots",
    JSON.stringify({ red: "bbb", green: "aaa" }),
  );
  const { container } = await onHostScreen(LIBRARY, []);
  await spunOnHost();

  // The server picks: no song id, the scope instead, and the remembered group
  // filtered against the room first — green is not a configured slot.
  expect(openPlayerSelection.mock.calls[0][0].body).toEqual({
    spin: { scope: "all" },
    slots: [{ color: "red", player_id: "bbb" }],
  });
  // The pick is not said until the reel on the TV has landed on it: the
  // window keeps its empty tile, the cover loads unseen under it. The die is
  // live and rolling — it is the press that shows the song — and Play waits.
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();
  expect(screen.getByText(WAITING)).toHaveAttribute("role", "status");
  expect(container.querySelector(".spinner-window img")).toBeNull();
  expect(container.querySelector("img.spinner-preload")).toHaveAttribute(
    "src",
    "/api/v1/songs/usdb%3A1/cover",
  );
  expect(showIt()).toBeEnabled();
  expect(showIt()).toHaveClass("spinner-spin", "spinner-spin-running");
  expect(playButton()).toBeDisabled();
  const live = container.querySelector('[aria-live="polite"]');
  expect(live).toHaveTextContent("");
  // No door to the song while the TV spins: the logo tile is a plain frame.
  expect(container.querySelector(".spinner-winner")).toBeNull();
  expect(container.querySelector(".spinner-window")?.tagName).toBe("DIV");

  act(() => vi.advanceTimersByTime(REVEAL_MS - 100));
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();
  expect(container.querySelector(".spinner-window")?.tagName).toBe("DIV");

  act(() => vi.advanceTimersByTime(100));
  // The cover settled in the window at once, the words under it — both the
  // song modal's doors from the landing on — and the region says the song.
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.getByText("Artist of Dancing Queen")).toBeInTheDocument();
  expect(screen.getByText("Dancing Queen").closest("button")).toHaveClass(
    "spinner-winner",
  );
  expect(
    screen.getByRole("button", { name: "Details for Dancing Queen" }),
  ).toHaveClass("spinner-window");
  expect(container.querySelector(".spinner-window img")).toHaveAttribute(
    "src",
    "/api/v1/songs/usdb%3A1/cover",
  );
  expect(live).toHaveTextContent("Dancing Queen by Artist of Dancing Queen");
  expect(screen.queryByText(WAITING)).not.toBeInTheDocument();
  expect(spinAgain()).toBeEnabled();
  expect(spinAgain()).not.toHaveClass("spinner-spin-running");
  expect(playButton()).toBeEnabled();
});

test("the wait is capped at REVEAL_MS from the answer, whatever the phone's clock says", async () => {
  // A phone whose clock runs behind the server's: the spin seems to have
  // started ten seconds from now. It still shows the song when the reel there
  // has had its time.
  openPlayerSelection.mockImplementation(async () => ({
    data: {
      selection: spunSelection(QUEEN, [], {
        spin: {
          id: 1,
          spun_at: new Date(Date.now() + 10_000).toISOString(),
          scope: "all",
          playlist_id: null,
          origin: "phone",
          revealed: false,
        },
      }),
      token: TOKEN,
    },
  }));
  await onHostScreen(LIBRARY, []);
  await spunOnHost();

  act(() => vi.advanceTimersByTime(REVEAL_MS - 100));
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(100));
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
});

test("a TV that already landed is shown at once", async () => {
  openPlayerSelection.mockImplementation(async () => ({
    data: {
      selection: spunSelection(QUEEN, [], {
        spin: {
          id: 1,
          spun_at: new Date(Date.now() - REVEAL_MS - 1000).toISOString(),
          scope: "all",
          playlist_id: null,
          origin: "phone",
          revealed: false,
        },
      }),
      token: TOKEN,
    },
  }));
  await onHostScreen(LIBRARY, []);
  fireEvent.click(spinButton());

  expect(await screen.findByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.queryByText(WAITING)).not.toBeInTheDocument();
});

test("a double tap on the Host screen's SPIN opens the room once and shows nothing early", async () => {
  // Host mode as it stands: SPIN is busy for the open's round trip and no
  // longer, so a second tap inside that round trip lands nowhere — one after
  // a faster answer would be a press on Show it.
  let land: () => void = () => {};
  openPlayerSelection.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      land = resolve;
    });
    return { data: { selection: spunSelection(QUEEN), token: TOKEN } };
  });
  await onHostScreen(LIBRARY, []);

  fireEvent.click(spinButton());
  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalled());
  act(() => vi.advanceTimersByTime(150));
  expect(spinButton()).toBeDisabled();
  expect(spinButton()).toHaveClass("spinner-spin-running");
  fireEvent.click(spinButton());

  await act(async () => land());
  expect(await screen.findByText(WAITING)).toBeInTheDocument();
  expect(openPlayerSelection).toHaveBeenCalledTimes(1);
  expect(spinPlayerSelection).not.toHaveBeenCalled();
  expect(showIt()).toBeEnabled();
});

test("Show it while the TV spins shows the song at once, the same one", async () => {
  await onHostScreen(LIBRARY, []);
  await spunOnHost();
  // The server answers the spin it has, revealed, and not another one.
  spinPlayerSelection.mockImplementationOnce(async () => ({
    data: spunSelection(QUEEN, [], {
      spin: {
        id: 1,
        spun_at: new Date(Date.now() - 2000).toISOString(),
        scope: "all",
        playlist_id: null,
        origin: "phone",
        revealed: true,
      },
    }),
  }));

  act(() => vi.advanceTimersByTime(2000));
  fireEvent.click(showIt());

  // The same route as a respin, the token in its header: the server decides
  // what the press means, this phone's clock does not.
  await waitFor(() => expect(spinPlayerSelection).toHaveBeenCalledTimes(1));
  expect(spinPlayerSelection.mock.calls[0][0].headers).toEqual({
    "X-Selection-Token": TOKEN,
  });
  expect(await screen.findByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.queryByText(WAITING)).not.toBeInTheDocument();
  expect(spinAgain()).toBeEnabled();
  expect(playButton()).toBeEnabled();
  expect(openPlayerSelection).toHaveBeenCalledTimes(1);

  // The clock's own moment passing later changes nothing.
  act(() => vi.advanceTimersByTime(REVEAL_MS));
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(spinPlayerSelection).toHaveBeenCalledTimes(1);
});

test("the room's own press that showed the song is read off the broadcast", async () => {
  await onHostScreen(LIBRARY, []);
  await spunOnHost();

  // The selector's start button landed the reel: the same spin, revealed.
  broadcast(
    spunSelection(QUEEN, [], {
      spin: {
        id: 1,
        spun_at: new Date(Date.now()).toISOString(),
        scope: "all",
        playlist_id: null,
        origin: "phone",
        revealed: true,
      },
    }),
  );

  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.queryByText(WAITING)).not.toBeInTheDocument();
  expect(spinAgain()).toBeEnabled();
});

test("Spin again asks for another song with the token, and waits again", async () => {
  const { container } = await onHostScreen(LIBRARY, []);
  await spunOnHost();
  reelLands();
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();

  fireEvent.click(spinAgain());

  await waitFor(() => expect(spinPlayerSelection).toHaveBeenCalledTimes(1));
  expect(spinPlayerSelection.mock.calls[0][0].headers).toEqual({
    "X-Selection-Token": TOKEN,
  });
  // A new spin: the TV's reel runs again, and so does the wait here — the
  // window back on its tile, the die back to being the press that shows it.
  expect(await screen.findByText(WAITING)).toBeInTheDocument();
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();
  expect(container.querySelector(".spinner-window img")).toBeNull();
  expect(showIt()).toBeEnabled();
  expect(openPlayerSelection).toHaveBeenCalledTimes(1);

  reelLands();
  expect(screen.getByText("Africa")).toBeInTheDocument();
});

test("a respin from the room restarts the wait too", async () => {
  await onHostScreen(LIBRARY, []);
  await spunOnHost();
  reelLands();

  broadcast(spunSelection(AFRICA, [], {}, 2));

  expect(screen.getByText(WAITING)).toBeInTheDocument();
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();
  reelLands();
  expect(screen.getByText("Africa")).toBeInTheDocument();
});

test("Play moves the room on to its singers, hands the selection on, and the page holds nothing after", async () => {
  await onHostScreen(LIBRARY, []);
  await spunOnHost();
  reelLands();

  fireEvent.click(playButton());

  // `/pick` with the token: the spin comes off the selection on the server, so
  // the TV shows the picking screen, and the answer is what the picker gets.
  await waitFor(() => expect(pickPlayerSelection).toHaveBeenCalledTimes(1));
  expect(pickPlayerSelection.mock.calls[0][0].headers).toEqual({
    "X-Selection-Token": TOKEN,
  });
  const picker = await screen.findByRole("dialog", {
    name: "Player selection",
  });
  expect(picker).toHaveTextContent("Dancing Queen");
  // No second open: the selection is open already and the token went with it.
  expect(openPlayerSelection).toHaveBeenCalledTimes(1);
  expect(releases()).toHaveLength(0);

  // From here on the picker owns the token: its Cancel gives the room back,
  // once.
  fireEvent.click(within(picker).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(releases()).toHaveLength(1));
  expectRelease(releases()[0]);
  expect(
    screen.queryByRole("dialog", { name: "Player selection" }),
  ).not.toBeInTheDocument();

  // And the page holds nothing: the words stay, SPIN reads Spin, Play is off,
  // and going back to this screen has nothing left to give back.
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(spinButton()).toBeEnabled();
  expect(playButton()).toBeDisabled();
  fireEvent.click(localPill()!);
  await act(async () => {});
  expect(releases()).toHaveLength(1);
});

test("the TV's landed song opens the song modal, whose Sing is Play's own path", async () => {
  await onHostScreen(LIBRARY, []);
  await spunOnHost();
  reelLands();

  // The words are the door (the cover is the other one).
  fireEvent.click(screen.getByText("Dancing Queen"));
  const modal = screen.getByRole("dialog", { name: "Dancing Queen" });
  const sing = within(modal).getByRole("button", { name: "Sing" });
  expect(sing).toBeEnabled();

  fireEvent.click(sing);

  // The modal closes and the room moves on over the selection this phone
  // already holds: `/pick` with its token, then the hand-over — never a
  // second selection, and nothing given back.
  expect(
    screen.queryByRole("dialog", { name: "Dancing Queen" }),
  ).not.toBeInTheDocument();
  await waitFor(() => expect(pickPlayerSelection).toHaveBeenCalledTimes(1));
  expect(pickPlayerSelection.mock.calls[0][0].headers).toEqual({
    "X-Selection-Token": TOKEN,
  });
  const picker = await screen.findByRole("dialog", {
    name: "Player selection",
  });
  expect(picker).toHaveTextContent("Dancing Queen");
  expect(openPlayerSelection).toHaveBeenCalledTimes(1);
  expect(releases()).toHaveLength(0);
});

test("the cover is the TV's song's second door, from the landing on", async () => {
  await onHostScreen(LIBRARY, []);
  await spunOnHost();
  expect(
    screen.queryByRole("button", { name: /^Details for/ }),
  ).not.toBeInTheDocument();
  reelLands();

  fireEvent.click(
    screen.getByRole("button", { name: "Details for Dancing Queen" }),
  );
  expect(
    screen.getByRole("dialog", { name: "Dancing Queen" }),
  ).toBeInTheDocument();
});

test("a respin from the room turns the open modal's Sing off", async () => {
  await onHostScreen(LIBRARY, []);
  await spunOnHost();
  reelLands();
  fireEvent.click(screen.getByText("Dancing Queen"));
  const modal = screen.getByRole("dialog", { name: "Dancing Queen" });

  // The selector's start spun again: the held selection is another song now.
  broadcast(spunSelection(AFRICA, [], {}, 2));

  // Still this song's modal, but its Sing would sing another one: off.
  const sing = within(modal).getByRole("button", { name: "Sing" });
  expect(sing).toBeDisabled();
  fireEvent.click(sing);
  await act(async () => {});
  expect(pickPlayerSelection).not.toHaveBeenCalled();
  expect(openPlayerSelection).toHaveBeenCalledTimes(1);
});

test("a respin the room has already revealed puts its own cover in the window", async () => {
  await onHostScreen(LIBRARY, []);
  await spunOnHost();
  reelLands();
  expect(
    screen.getByRole("button", { name: "Details for Dancing Queen" }),
  ).toBeInTheDocument();

  // The selector's start spun again and the room showed it at once: the page
  // goes from one landed song to the next without a wait in between.
  broadcast(
    spunSelection(AFRICA, [], {
      spin: {
        id: 2,
        spun_at: new Date(Date.now()).toISOString(),
        scope: "all",
        playlist_id: null,
        origin: "device",
        revealed: true,
      },
    }),
  );

  // The window is the new song's door, never the last song's cover.
  expect(
    screen.queryByRole("button", { name: "Details for Dancing Queen" }),
  ).toBeNull();
  const door = screen.getByRole("button", { name: "Details for Africa" });
  expect(door.querySelector("img")).toHaveAttribute(
    "src",
    "/api/v1/songs/usdb%3A2/cover",
  );
  fireEvent.click(door);
  const modal = screen.getByRole("dialog", { name: "Africa" });
  expect(within(modal).getByRole("button", { name: "Sing" })).toBeEnabled();
});

test("a selection lost while the song modal is open leaves the ordinary Sing", async () => {
  await onHostScreen(LIBRARY, []);
  await spunOnHost();
  reelLands();
  fireEvent.click(screen.getByText("Dancing Queen"));
  const modal = screen.getByRole("dialog", { name: "Dancing Queen" });

  // Another phone took the room over: another selection's `opened_at`.
  broadcast(
    spunSelection(WATERLOO, [], { opened_at: "2026-10-24T09:00:00Z" }, 3),
  );
  expect(
    screen.getByText("Somebody else took over the selection."),
  ).toBeInTheDocument();

  // The page holds nothing now: Sing opens a selection of its own, which the
  // room answers as it answers anybody, and never a `/pick` over a lock this
  // phone no longer has.
  fireEvent.click(within(modal).getByRole("button", { name: "Sing" }));
  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalledTimes(2));
  expect(openPlayerSelection.mock.calls[1][0].body.song_id).toBe("usdb:1");
  expect(pickPlayerSelection).not.toHaveBeenCalled();
});

test("once the page holds nothing the song modal's Sing is the ordinary one", async () => {
  await onHostScreen(LIBRARY, []);
  await spunOnHost();
  reelLands();
  fireEvent.click(playButton());
  const picker = await screen.findByRole("dialog", {
    name: "Player selection",
  });
  fireEvent.click(within(picker).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(releases()).toHaveLength(1));

  // The words stay, still the door; Sing now opens a selection of its own.
  fireEvent.click(screen.getByText("Dancing Queen"));
  const modal = screen.getByRole("dialog", { name: "Dancing Queen" });
  fireEvent.click(within(modal).getByRole("button", { name: "Sing" }));
  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalledTimes(2));
  expect(openPlayerSelection.mock.calls[1][0].body.song_id).toBe("usdb:1");
  expect(pickPlayerSelection).toHaveBeenCalledTimes(1);
});

test("a card that lands is kept for the hand-over", async () => {
  await onHostScreen(LIBRARY, []);
  await spunOnHost();
  reelLands();

  const withBob = [
    { color: "blue", player: PLAYERS[1], card_uid: "A1B2C3D4" },
    { color: "red", player: null, card_uid: null },
  ];
  broadcast(
    spunSelection(QUEEN, [], {
      slots: withBob,
      spin: {
        id: 1,
        spun_at: new Date(Date.now() - REVEAL_MS).toISOString(),
        scope: "all",
        playlist_id: null,
        origin: "phone",
        revealed: false,
      },
    }),
  );
  pickPlayerSelection.mockImplementationOnce(async () => ({
    data: picked(QUEEN, [], { slots: withBob }),
  }));
  fireEvent.click(playButton());

  expect(
    await screen.findByRole("button", {
      name: "Slot blue: Bob, held by a card",
    }),
  ).toBeInTheDocument();
});

test("the broadcast of /pick overtaking its answer does not put the wait back up", async () => {
  let answer: (value: { data: SelectionRead }) => void = () => {};
  pickPlayerSelection.mockImplementationOnce(
    () =>
      new Promise<{ data: SelectionRead }>((resolve) => {
        answer = resolve;
      }),
  );
  await onHostScreen(LIBRARY, []);
  await spunOnHost();
  reelLands();

  fireEvent.click(playButton());
  await waitFor(() => expect(pickPlayerSelection).toHaveBeenCalledTimes(1));
  broadcast(picked(QUEEN));

  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.queryByText(WAITING)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Show it" })).toBeNull();
  expect(spinAgain()).toBeDisabled();

  await act(async () => {
    answer({ data: picked(QUEEN) });
  });
  expect(
    await screen.findByRole("dialog", { name: "Player selection" }),
  ).toBeInTheDocument();
  expect(releases()).toHaveLength(0);
});

test.each([["no_selection"], ["not_the_opener"]])(
  "a /pick refused with %s is the lost sentence, and SPIN opens anew",
  async (detail) => {
    pickPlayerSelection.mockRejectedValueOnce({ detail });
    await onHostScreen(LIBRARY, []);
    await spunOnHost();
    reelLands();

    fireEvent.click(playButton());

    expect(await screen.findByText(TAKEN)).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Player selection" }),
    ).not.toBeInTheDocument();
    expect(playButton()).toBeDisabled();
    expect(spinButton()).toBeEnabled();
    // The dead token is not given back either.
    expect(releases()).toHaveLength(0);
  },
);

test("a /pick refused for another reason is a notice over the row, and the song stays up", async () => {
  pickPlayerSelection.mockRejectedValueOnce({ detail: "not_a_spin" });
  const { container } = await onHostScreen(LIBRARY, []);
  await spunOnHost();
  reelLands();

  fireEvent.click(playButton());

  const notice = await screen.findByRole("alert");
  expect(notice).toHaveTextContent("not_a_spin");
  expect(notice).toHaveClass("error-notice");
  expect(notice.nextElementSibling).toBe(
    container.querySelector(".spinner-actions"),
  );
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(playButton()).toBeEnabled();
});

test("the pills back on This screen give the room back once, and a kept TV opens nothing again", async () => {
  await onHostScreen(LIBRARY, []);
  await spunOnHost();

  fireEvent.click(localPill()!);

  await waitFor(() => expect(releases()).toHaveLength(1));
  expectRelease(releases()[0]);
  expect(window.localStorage.getItem("wingman.spinTarget")).toBe("local");
  // This screen's reel, back as it was: a plain Spin, the song modal's window.
  expect(screen.queryByText(WAITING)).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Nothing spun yet" }),
  ).toBeDisabled();

  // Back to the TV: nothing is opened by the pill, and the next SPIN takes
  // the room again — and holds it, the earlier close notwithstanding.
  fireEvent.click(hostPill()!);
  await act(async () => {});
  expect(openPlayerSelection).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(spinButton()).toBeEnabled());
  await spunOnHost();
  expect(openPlayerSelection).toHaveBeenCalledTimes(2);
  expect(releases()).toHaveLength(1);
  reelLands();
  expect(playButton()).toBeEnabled();
});

test("leaving the page gives it back once, StrictMode's double effect included", async () => {
  const { unmount } = await onHostScreen(
    LIBRARY,
    [],
    [],
    ACCOUNT,
    SINGING,
    {},
    true,
  );
  await spunOnHost();
  await act(async () => {});
  expect(releases()).toHaveLength(0);

  unmount();

  await waitFor(() => expect(releases()).toHaveLength(1));
  expectRelease(releases()[0]);
  await act(async () => {});
  expect(releases()).toHaveLength(1);
});

test("a spin that lands after the pills came back is given straight back", async () => {
  let land: (() => void) | null = null;
  openPlayerSelection.mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      land = resolve;
    });
    return { data: { selection: spunSelection(QUEEN), token: TOKEN } };
  });
  await onHostScreen(LIBRARY, []);
  fireEvent.click(spinButton());
  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalled());

  fireEvent.click(localPill()!);
  await act(async () => {
    land?.();
  });

  await waitFor(() => expect(releases()).toHaveLength(1));
  expectRelease(releases()[0]);
  expect(screen.queryByText(WAITING)).not.toBeInTheDocument();
});

test("a pool changed under a held selection leaves the TV alone until the next press", async () => {
  await onHostScreen(LIBRARY, [wish(AFRICA), wish(WATERLOO)]);
  await spunOnHost();
  reelLands();

  // The select stays live, and changing it asks nothing of the room.
  await chooseScope("Wishlist");
  await act(async () => {});
  expect(releases()).toHaveLength(0);
  expect(spinPlayerSelection).not.toHaveBeenCalled();
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();

  // The next press gives the old selection back and opens one over the new
  // pool — after the room has answered the DELETE, never beside it: sent
  // together, the open could find this phone's own selection still there.
  let answerDelete: () => void = () => {};
  fetchMock.mockImplementation((url: unknown) =>
    String(url).startsWith("/api/v1/karaoke/selection")
      ? new Promise<void>((resolve) => {
          answerDelete = resolve;
        })
      : Promise.reject(new Error("no network in tests")),
  );
  fireEvent.click(spinAgain());
  await waitFor(() => expect(releases()).toHaveLength(1));
  expectRelease(releases()[0]);
  await act(async () => {});
  expect(openPlayerSelection).toHaveBeenCalledTimes(1);
  expect(spinButton()).toBeDisabled();

  await act(async () => {
    answerDelete();
  });
  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalledTimes(2));
  expect(openPlayerSelection.mock.calls[1][0].body.spin).toEqual({
    scope: "wishlist",
  });
  expect(spinPlayerSelection).not.toHaveBeenCalled();
  expect(await screen.findByText(WAITING)).toBeInTheDocument();
});

test("a page left while a pool change waits on its DELETE opens nothing after", async () => {
  const { unmount } = await onHostScreen(LIBRARY, [
    wish(AFRICA),
    wish(WATERLOO),
  ]);
  await spunOnHost();
  reelLands();
  await chooseScope("Wishlist");

  let answerDelete: () => void = () => {};
  fetchMock.mockImplementation((url: unknown) =>
    String(url).startsWith("/api/v1/karaoke/selection")
      ? new Promise<void>((resolve) => {
          answerDelete = resolve;
        })
      : Promise.reject(new Error("no network in tests")),
  );
  fireEvent.click(spinAgain());
  await waitFor(() => expect(releases()).toHaveLength(1));

  // Gone before the room answered: an open sent now would hold the room for
  // a page nobody can give it back from.
  unmount();
  await act(async () => {
    answerDelete();
  });
  await act(async () => {});
  expect(openPlayerSelection).toHaveBeenCalledTimes(1);
  expect(releases()).toHaveLength(1);
});

test("somebody else picking is named, Take over replaces Play, and SPIN tries again", async () => {
  openPlayerSelection.mockRejectedValueOnce({ detail: "selection_open" });
  getPlayerSelection.mockResolvedValue({
    data: { selection: spunSelection(AFRICA) },
  });
  await onHostScreen(LIBRARY, [wish(QUEEN, 2)]);
  await chooseScope("Wishlist (weighted)");
  fireEvent.click(spinButton());

  expect(
    await screen.findByText(/Somebody is picking singers for/),
  ).toHaveTextContent("Somebody is picking singers for Africa.");
  expect(spinButton()).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Play" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Take over" }));
  const confirm = await screen.findByRole("dialog", {
    name: "Take over the selection",
  });
  expect(confirm).toHaveTextContent("loses their singers");
  const confirmButton = within(confirm).getByRole("button", {
    name: "Take over",
  });
  expect(confirmButton).toHaveClass("button-danger");
  fireEvent.click(confirmButton);

  // The same spin, forced this time.
  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalledTimes(2));
  expect(openPlayerSelection.mock.calls[1][0].body).toEqual({
    spin: { scope: "weighted" },
    slots: [],
    force: true,
  });
  expect(await screen.findByText(WAITING)).toBeInTheDocument();
});

test("a blocked SPIN press tries again without forcing", async () => {
  openPlayerSelection.mockRejectedValueOnce({ detail: "selection_open" });
  await onHostScreen(LIBRARY, []);
  fireEvent.click(spinButton());
  expect(
    await screen.findByText("Somebody else is picking singers."),
  ).toBeInTheDocument();

  fireEvent.click(spinButton());

  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalledTimes(2));
  expect(openPlayerSelection.mock.calls[1][0].body.force).toBeUndefined();
  expect(await screen.findByText(WAITING)).toBeInTheDocument();
});

test("an empty pool is said in the reel's words in the result slot", async () => {
  openPlayerSelection.mockRejectedValueOnce({ detail: "empty_pool" });
  await onHostScreen(LIBRARY, [wish(QUEEN)]);
  await chooseScope("Wishlist");
  fireEvent.click(spinButton());

  const line = await screen.findByText(
    "The wishlist is empty. The reel has nothing to land on.",
  );
  expect(line).toHaveClass("spinner-state");
  expect(line.parentElement).toHaveClass("spinner-result");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(spinButton()).toBeEnabled();
  expect(playButton()).toBeDisabled();
  // Nothing was opened, so there is nothing to give back.
  fireEvent.click(localPill()!);
  await act(async () => {});
  expect(releases()).toHaveLength(0);
});

test("a pool that runs dry on Spin again keeps the song that is up", async () => {
  spinPlayerSelection.mockRejectedValueOnce({ detail: "empty_pool" });
  await onHostScreen([], [], [], ACCOUNT, SINGING, {
    songs: [QUEEN],
    playlistId: "p1",
  });
  await spunOnHost();
  reelLands();

  fireEvent.click(spinAgain());

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This playlist is empty. The reel has nothing to land on.",
  );
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(playButton()).toBeEnabled();
});

test("a selection taken away says so, and SPIN opens a fresh one", async () => {
  await onHostScreen(LIBRARY, []);
  await spunOnHost();
  reelLands();

  broadcast(null);

  expect(screen.getByText(TAKEN)).toBeInTheDocument();
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();
  expect(playButton()).toBeDisabled();
  expect(spinButton()).toBeEnabled();

  fireEvent.click(spinButton());

  await waitFor(() => expect(openPlayerSelection).toHaveBeenCalledTimes(2));
  expect(openPlayerSelection.mock.calls[1][0].body).toEqual({
    spin: { scope: "all" },
    slots: [],
  });
  expect(await screen.findByText(WAITING)).toBeInTheDocument();
  // The dead token is never sent back: losing the selection is not closing it.
  expect(releases()).toHaveLength(0);
});

test("a selection replaced by another one is treated as taken away", async () => {
  await onHostScreen(LIBRARY, []);
  await spunOnHost();

  broadcast(
    spunSelection(AFRICA, [], { opened_at: "2026-09-06T20:05:00.000Z" }),
  );

  expect(screen.getByText(TAKEN)).toBeInTheDocument();
  expect(screen.queryByText(WAITING)).not.toBeInTheDocument();
});

test("the TV's wishlist spin offers the take-off beside the song once it has landed", async () => {
  openPlayerSelection.mockImplementation(async () => ({
    data: {
      selection: spunSelection(QUEEN, [], {}, 1, "wishlist"),
      token: TOKEN,
    },
  }));
  await onHostScreen(
    LIBRARY,
    [wish(QUEEN), wish(AFRICA)],
    [],
    ACCOUNT,
    MANAGING,
  );
  await chooseScope("Wishlist");
  await spunOnHost();

  // Nothing is given away while the reel runs: no song, nothing to take off.
  expect(takeOffButton()).toBeNull();

  reelLands();
  const button = takeOffButton();
  expect(button).toHaveAccessibleName(
    "Take Dancing Queen off the wishlist for everybody",
  );
  expect(iconNames(button!)).toEqual(["trash"]);
  const result = button!.parentElement!;
  expect(result).toHaveClass("spinner-result");
  // The take-off beside the song's own button, never inside it.
  const words = result.querySelector(".spinner-winner")!;
  expect(words.tagName).toBe("BUTTON");
  expect([...result.children]).toEqual([words, button]);

  clearWishes.mockResolvedValue({ data: undefined });
  listWishlist.mockResolvedValue({ data: { wishes: [wish(AFRICA)] } });
  fireEvent.click(button!);

  await waitFor(() => expect(clearWishes).toHaveBeenCalledTimes(1));
  expect(clearWishes.mock.calls[0][0].path).toEqual({ song_id: "usdb:1" });
  await waitFor(() => expect(takeOffButton()).toBeNull());
  // The song stays, so does Play, and the room is untouched.
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(playButton()).toBeEnabled();
  expect(releases()).toHaveLength(0);
});

test("the TV's spin over another pool never offers the take-off", async () => {
  await onHostScreen(LIBRARY, [wish(QUEEN)], [], ACCOUNT, MANAGING);
  await spunOnHost();
  reelLands();

  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(takeOffButton()).toBeNull();
});
