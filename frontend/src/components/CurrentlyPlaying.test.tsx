import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { CurrentSing } from "../api";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import CurrentlyPlaying from "./CurrentlyPlaying";

const { getCurrentSing, getMe, listKaraokeColors } = vi.hoisted(() => ({
  getCurrentSing: vi.fn(),
  getMe: vi.fn(),
  listKaraokeColors: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getCurrentSing,
  getMe,
  listKaraokeColors,
}));

const SING: CurrentSing = {
  sing_id: "sing-1",
  started_at: "2026-08-23T20:00:00+00:00",
  song: {
    id: "usdb:1",
    source: "usdb",
    title: "Dancing Queen",
    artist: "ABBA",
    duration_seconds: 231,
    has_video: true,
    is_duet: false,
    created_at: "2026-01-01T12:00:00Z",
    language: null,
    genre: null,
    year: null,
    edition: null,
    creator: null,
  },
  slots: [
    {
      color: "blue",
      player: {
        id: "aaa",
        name: "Alice",
        registered: false,
        hidden: false,
        has_avatar: false,
      },
    },
    { color: "red", player: null },
  ],
};

/**
 * The same sing, started `secondsAgo` ago. The elapsed clock runs against the
 * real time, so anything that asserts on it has to place the start relative to
 * now instead of pinning it to a date.
 */
function playing(secondsAgo: number): CurrentSing {
  return {
    ...SING,
    started_at: new Date(Date.now() - secondsAgo * 1000).toISOString(),
  };
}

function renderBlock() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CurrentlyPlaying />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.clearAllMocks();
  getCurrentSing.mockResolvedValue({ data: { sing: null } });
  getMe.mockResolvedValue(meResponse(["karaoke.stop"]));
  listKaraokeColors.mockResolvedValue({
    data: { colors: [{ name: "blue", hex: "#048BB9" }] },
  });
});

afterEach(() => vi.unstubAllGlobals());

test("nothing is rendered while USDX is idle", async () => {
  const { container } = renderBlock();

  await waitFor(() => expect(getCurrentSing).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});

test("the host shows the whole picture: players and elapsed time", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: playing(60) } });
  renderBlock();

  const tile = await screen.findByRole("region", { name: "Now playing" });
  expect(tile).toHaveTextContent("Dancing Queen");
  expect(tile).toHaveTextContent("ABBA");
  expect(tile).toHaveTextContent("Alice");
  // The total comes from the song, so an elapsed time is always paired with it.
  expect(tile).toHaveTextContent("/ 3:51");
  // Empty slots carry no player and must not show up as one.
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
});

test("the progress bar sits under the text, above the players", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: playing(60) } });
  renderBlock();

  const tile = await screen.findByRole("region", { name: "Now playing" });
  expect([...tile.children].map((child) => child.className)).toEqual([
    "song-cover currently-playing-cover",
    "currently-playing-info",
    "currently-playing-bar",
    "currently-playing-players",
  ]);
});

test("a total the elapsed time already passed is dropped, the bar stays full", async () => {
  // USDX boots after Wingman starts the clock, so the elapsed time can overtake
  // the song. A total that is provably wrong is worse than none.
  getCurrentSing.mockResolvedValue({ data: { sing: playing(300) } });
  const { container } = renderBlock();

  const tile = await screen.findByRole("region", { name: "Now playing" });
  // A loaded runner may need a second between the mock and the render, so the
  // elapsed value is matched loosely — the missing total is the point.
  expect(tile).toHaveTextContent(/5:0\d/);
  expect(tile).not.toHaveTextContent("/ 3:51");
  const fill = container.querySelector<HTMLElement>(
    ".currently-playing-bar > span",
  );
  expect(fill?.style.width).toBe("100%");
});

test("a song without a known duration has no bar", async () => {
  const sing = playing(60);
  getCurrentSing.mockResolvedValue({
    data: { sing: { ...sing, song: { ...sing.song, duration_seconds: null } } },
  });
  const { container } = renderBlock();

  const tile = await screen.findByRole("region", { name: "Now playing" });
  expect(tile).toHaveTextContent(/1:0\d/);
  expect(tile).not.toHaveTextContent("/");
  expect(container.querySelector(".currently-playing-bar")).toBeNull();
});

test("the block carries its own class alone", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  renderBlock();

  expect(
    await screen.findByRole("region", { name: "Now playing" }),
  ).toHaveAttribute("class", "currently-playing");
});

test("the host page owns Stop, so the block carries no controls at all", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  renderBlock();

  await screen.findByRole("region", { name: "Now playing" });
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("a karaoke.started event brings the block up without a refetch", async () => {
  renderBlock();
  await waitFor(() => expect(getCurrentSing).toHaveBeenCalledTimes(1));

  FakeSocket.deliver({ event: "karaoke.started", sing: SING });

  expect(await screen.findByText("Dancing Queen")).toBeInTheDocument();
  expect(getCurrentSing).toHaveBeenCalledTimes(1);
});

test("a karaoke.ended event takes the block away again", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  renderBlock();
  await screen.findByText("Dancing Queen");

  FakeSocket.deliver({
    event: "karaoke.ended",
    sing_id: "sing-1",
    song_id: "usdb:1",
  });

  await waitFor(() =>
    expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument(),
  );
});
