import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type {
  ScoreWithContext,
  SessionRead,
  SingDetail,
  SongRead,
} from "../api";
import { cardDate, shortTime } from "../duration";
import { AS, meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import SingView from "./SingView";

const { getMe, readSing, listPlayers } = vi.hoisted(() => ({
  getMe: vi.fn(),
  readSing: vi.fn(),
  listPlayers: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  readSing,
  listPlayers,
}));

// Both are tested where they live; here, what opens them and what they get.
vi.mock("./SongDetails", () => ({
  default: ({ song }: { song: SongRead }) => (
    <div data-testid="song-details">{song.title}</div>
  ),
}));

vi.mock("./ShareCardPanel", () => ({
  default: ({
    target,
    onClose,
  }: {
    target: {
      kind: string;
      score: ScoreWithContext;
      session: SessionRead | null;
      singScores: ScoreWithContext[];
    };
    onClose: () => void;
  }) => (
    <div
      data-testid="share-panel"
      data-kind={target.kind}
      data-score={target.score.id}
      data-session={target.session?.id ?? "none"}
      data-sing={target.singScores.map((entry) => entry.id).join(",")}
    >
      <button type="button" onClick={onClose}>
        Close the share panel
      </button>
    </div>
  ),
}));

const STARTED = "2026-10-17T19:42:00Z";

const bohemian: SongRead = {
  id: "usdb:1",
  artist: "Queen",
  title: "Bohemian Rhapsody",
  duration_seconds: null,
  has_video: false,
  is_duet: false,
  created_at: "2026-01-01T12:00:00Z",
  language: null,
  genre: null,
  year: null,
  edition: null,
  creator: null,
  source: "usdb",
};

const party: SessionRead = {
  id: "session-ben",
  name: "Ben's birthday",
  started_at: "2026-10-17T18:00:00Z",
  last_activity_at: "2026-10-17T23:00:00Z",
  sing_count: 12,
  score_count: 20,
  singer_count: 5,
  hidden: false,
  current: false,
};

function score(
  id: number,
  name: string,
  value: number,
  overrides: Partial<ScoreWithContext> = {},
): ScoreWithContext {
  return {
    id,
    sing_id: "sing-1",
    player_id: `player-${name.toLowerCase()}`,
    player_name: name,
    score: value,
    difficulty: 1,
    placement: null,
    field_size: 3,
    recorded_at: "2026-10-17T19:46:00Z",
    song: bohemian,
    sing_started_at: STARTED,
    ...overrides,
  };
}

const alice = score(1, "Alice", 8662, { placement: 1 });
const bob = score(2, "Bob", 7934, { placement: 2 });
const carol = score(3, "Carol", 6120, { placement: 3 });

function detail(overrides: Partial<SingDetail> = {}): { data: SingDetail } {
  return {
    data: {
      sing_id: "sing-1",
      song_id: bohemian.id,
      song: bohemian,
      song_listed: true,
      session: party,
      started_at: STARTED,
      ended_at: "2026-10-17T19:48:00Z",
      scores: [alice, bob, carol],
      ...overrides,
    },
  };
}

function renderView(tapped: ScoreWithContext = bob, onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SingView score={tapped} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

/** The rows of the singers' list as [rank, name, score, pressed]. */
function rows(): (string | null)[][] {
  const list = screen.getByRole("list", { name: "Who sang" });
  return within(list)
    .getAllByRole("button")
    .map((row) => [
      row.querySelector(".ranked-score-rank")?.textContent ?? null,
      row.querySelector(".ranked-score-name")?.textContent ?? null,
      row.querySelector(".ranked-score-value")?.textContent ?? null,
      row.getAttribute("aria-pressed"),
    ]);
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.resetAllMocks();
  // Bob is reading: his own row says so.
  getMe.mockResolvedValue(
    meResponse(["stats.view", "players.view"], {
      user: userRead({ username: "Bob", player_id: "player-bob" }),
      ...AS.user,
    }),
  );
  readSing.mockResolvedValue(detail());
  listPlayers.mockResolvedValue({ data: { players: [] } });
});

afterEach(() => vi.unstubAllGlobals());

test("the hero stands at once from the tapped row, the rows load under it", async () => {
  readSing.mockReturnValue(new Promise(() => {}));
  renderView();

  // A bare modal named after the sing, the close alone in its header.
  const dialog = screen.getByRole("dialog", {
    name: "Sing of Bohemian Rhapsody",
  });
  expect(dialog).toHaveClass("modal-bare");
  expect(within(dialog).queryByRole("heading")).toBeNull();
  expect(within(dialog).getByText("Bohemian Rhapsody")).toBeInTheDocument();
  expect(within(dialog).getByText("Queen")).toBeInTheDocument();
  expect(dialog.querySelector(".sing-view-cover")).not.toBeNull();
  // When, out of the tapped row; the party follows once the read is in.
  expect(dialog.querySelector(".sing-view-when")).toHaveTextContent(
    `${cardDate(STARTED)}, ${shortTime(STARTED)}`,
  );
  expect(within(dialog).getByRole("status", { name: "Loading" })).toBeVisible();
  // Nothing to share before the rows are in.
  expect(within(dialog).queryByRole("button", { name: "Share" })).toBeNull();
  expect(readSing).toHaveBeenCalledWith(
    expect.objectContaining({ path: { sing_id: "sing-1" } }),
  );
});

test("every score of the sing, best first, with its stored place and the tapped one pressed", async () => {
  // A tie: the stored placements say so, never a recount of the positions.
  const tied = score(3, "Carol", 7934, { placement: 2 });
  readSing.mockResolvedValue(detail({ scores: [alice, bob, tied] }));
  renderView();

  await screen.findByRole("list", { name: "Who sang" });
  expect(rows()).toEqual([
    ["1", "Alice", "8662", "false"],
    ["2", "Bob", "7934", "true"],
    ["2", "Carol", "7934", "false"],
  ]);
  // The podium colour follows the place shown: both twos wear it.
  const ranks = document.querySelectorAll(".ranked-score-rank");
  for (const rank of ranks) expect(rank).toHaveClass("ranked-score-podium");
  // The difficulty under each name; the day is the view's own line.
  expect(document.querySelector(".ranked-score-caption")).toHaveTextContent(
    "Medium",
  );

  // A tap on another row moves the choice.
  fireEvent.click(screen.getByRole("button", { name: /Alice/ }));
  expect(rows().map((row) => row[3])).toEqual(["true", "false", "false"]);
});

test("the reader's own row carries a quiet You, nobody else's does", async () => {
  renderView();
  await screen.findByRole("list", { name: "Who sang" });

  const you = screen.getAllByText("You");
  expect(you).toHaveLength(1);
  expect(you[0]).toHaveClass("ranked-score-you");
  expect(you[0].closest("button")).toHaveTextContent("Bob");
});

test("a row without a stored place has an empty rank cell", async () => {
  readSing.mockResolvedValue(
    detail({ scores: [{ ...alice, placement: null }, bob] }),
  );
  renderView();
  await screen.findByRole("list", { name: "Who sang" });
  expect(rows().map((row) => row[0])).toEqual(["", "2"]);
});

test("a sing with one score is one row with no rank", async () => {
  const solo = score(7, "Bob", 7000, { placement: 1, field_size: 1 });
  readSing.mockResolvedValue(detail({ scores: [solo] }));
  renderView(solo);

  await screen.findByRole("list", { name: "Who sang" });
  expect(rows()).toEqual([["", "Bob", "7000", "true"]]);
});

test("the when line names the party after the date and time", async () => {
  renderView();
  await screen.findByRole("list", { name: "Who sang" });
  expect(document.querySelector(".sing-view-when")).toHaveTextContent(
    `${cardDate(STARTED)}, ${shortTime(STARTED)} · Ben's birthday`,
  );
});

test("a nameless party, or a sing from before parties, is the date alone", async () => {
  readSing.mockResolvedValue(detail({ session: { ...party, name: null } }));
  renderView();
  await screen.findByRole("list", { name: "Who sang" });
  const line = document.querySelector(".sing-view-when");
  expect(line?.textContent).toBe(`${cardDate(STARTED)}, ${shortTime(STARTED)}`);
});

test("a sing from before parties were recorded reads the date alone", async () => {
  readSing.mockResolvedValue(detail({ session: null }));
  renderView();
  await screen.findByRole("list", { name: "Who sang" });
  expect(document.querySelector(".sing-view-when")?.textContent).toBe(
    `${cardDate(STARTED)}, ${shortTime(STARTED)}`,
  );

  // Shared all the same, naming no party.
  fireEvent.click(screen.getByRole("button", { name: "Share" }));
  expect(screen.getByTestId("share-panel")).toHaveAttribute(
    "data-session",
    "none",
  );
});

test("cover, title and artist are one button into the song", async () => {
  renderView();
  const hero = await screen.findByRole("button", {
    name: "Bohemian Rhapsody",
  });
  // One control holding all three, named by the title alone: one tab stop,
  // the cover a second door to the same action and never a second button.
  expect(hero).toHaveClass("sing-view-song");
  expect(hero.querySelector(".sing-view-cover")).not.toBeNull();
  expect(hero.querySelector(".sing-view-title")).toHaveTextContent(
    "Bohemian Rhapsody",
  );
  expect(hero.querySelector(".sing-view-artist")).toHaveTextContent("Queen");
  const heroArea = hero.closest(".sing-view-hero") as HTMLElement;
  expect(heroArea.querySelectorAll("button")).toHaveLength(1);
  // The when line stays outside it.
  expect(hero).not.toHaveTextContent("·");
  expect(heroArea.querySelector(".sing-view-when")?.parentElement).toBe(
    heroArea,
  );

  // A tap on the cover is the same press.
  fireEvent.click(hero.querySelector(".sing-view-cover") as HTMLElement);
  expect(screen.getByTestId("song-details")).toHaveTextContent(
    "Bohemian Rhapsody",
  );
});

test("the title opens the song when the reader may open it", async () => {
  renderView();
  const title = await screen.findByRole("button", {
    name: "Bohemian Rhapsody",
  });
  fireEvent.click(title);
  expect(screen.getByTestId("song-details")).toHaveTextContent(
    "Bohemian Rhapsody",
  );
  // Over the view, which stays open behind it.
  expect(
    screen.getByRole("dialog", { name: "Sing of Bohemian Rhapsody" }),
  ).toBeInTheDocument();
});

test("a song a tag keeps back is plain text, never a way in", async () => {
  readSing.mockResolvedValue(detail({ song_listed: false }));
  renderView();
  await screen.findByRole("list", { name: "Who sang" });
  expect(
    screen.queryByRole("button", { name: "Bohemian Rhapsody" }),
  ).toBeNull();
  // The same three in a plain block, drawn by the same rule as the button.
  const block = screen.getByText("Bohemian Rhapsody").parentElement;
  expect(block?.tagName).toBe("DIV");
  expect(block).toHaveClass("sing-view-song");
  expect(block?.querySelector(".sing-view-cover")).not.toBeNull();
});

test("a song that left the library reads Unknown song, with no artist", async () => {
  const gone = { ...bob, song: null };
  readSing.mockResolvedValue(
    detail({
      song: null,
      song_listed: false,
      scores: [{ ...alice, song: null }, gone],
    }),
  );
  renderView(gone);

  const dialog = screen.getByRole("dialog", { name: "Sing of Unknown song" });
  await screen.findByRole("list", { name: "Who sang" });
  expect(within(dialog).getByText("Unknown song").closest("button")).toBeNull();
  expect(within(dialog).queryByText("Queen")).toBeNull();
  // The `?` tile in the cover's place, and never inside a button.
  const missing = dialog.querySelector(".song-cover-fallback.sing-view-cover");
  expect(missing).not.toBeNull();
  expect(missing?.closest("button")).toBeNull();
  expect(missing?.parentElement?.tagName).toBe("DIV");
});

test("Share opens the panel on the pressed score, with the sing and its party", async () => {
  renderView();
  const share = await screen.findByRole("button", { name: "Share" });
  // A plain button, the achievement modal's Share: sharing is the view's
  // errand, not its headline (share-cards §8).
  expect(share).toHaveClass("button");
  expect(share).not.toHaveClass("button-primary");
  expect(iconNames(share)).toEqual(["share"]);

  // A duet partner's score is shared from the same place as your own.
  fireEvent.click(screen.getByRole("button", { name: /Carol/ }));
  fireEvent.click(share);
  const panel = screen.getByTestId("share-panel");
  expect(panel).toHaveAttribute("data-kind", "score");
  expect(panel).toHaveAttribute("data-score", "3");
  expect(panel).toHaveAttribute("data-session", "session-ben");
  expect(panel).toHaveAttribute("data-sing", "1,2,3");

  // Closing the panel comes back here.
  fireEvent.click(
    screen.getByRole("button", { name: "Close the share panel" }),
  );
  expect(screen.queryByTestId("share-panel")).toBeNull();
  expect(
    screen.getByRole("dialog", { name: "Sing of Bohemian Rhapsody" }),
  ).toBeInTheDocument();
});

test("a sing the reader may not open says why, and offers no Share", async () => {
  readSing.mockRejectedValue({ detail: "missing_permission:stats.history" });
  renderView();

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "You may not do this (stats.history). Ask the host for access.",
  );
  expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  // The hero still stands: the reader tapped a row they could see.
  expect(screen.getByText("Bohemian Rhapsody")).toBeInTheDocument();
});

test("any other failure says it could not load the sing", async () => {
  readSing.mockRejectedValue({ detail: "unknown sing 'sing-1'" });
  renderView();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load this sing.",
  );
});

test("a correction to this sing reads it again; one to another sing does not", async () => {
  renderView();
  await screen.findByRole("list", { name: "Who sang" });
  const calls = readSing.mock.calls.length;

  FakeSocket.deliver({ event: "scores.changed", sing_id: "sing-other" });
  FakeSocket.deliver({ event: "scores.changed", sing_id: "sing-1" });

  await waitFor(() => expect(readSing.mock.calls.length).toBe(calls + 1));
});

test("a read again that is refused takes Share away with the rows", async () => {
  renderView();
  await screen.findByRole("button", { name: "Share" });
  // The reader's own score was put on somebody else, and the party is not
  // one they may open: the sing is no longer theirs to read.
  readSing.mockRejectedValue({ detail: "missing_permission:stats.history" });

  FakeSocket.deliver({ event: "scores.changed", sing_id: "sing-1" });

  expect(await screen.findByRole("alert")).toHaveTextContent("stats.history");
  expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
});

test("a pressed score taken off the record hands the choice to the best", async () => {
  renderView();
  await screen.findByRole("list", { name: "Who sang" });
  readSing.mockResolvedValue(detail({ scores: [alice, carol] }));

  FakeSocket.deliver({ event: "scores.changed", sing_id: "sing-1" });

  await waitFor(() =>
    expect(rows()).toEqual([
      ["1", "Alice", "8662", "true"],
      ["3", "Carol", "6120", "false"],
    ]),
  );
});

test("Escape closes the view", async () => {
  const onClose = renderView();
  await screen.findByRole("list", { name: "Who sang" });
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
});
