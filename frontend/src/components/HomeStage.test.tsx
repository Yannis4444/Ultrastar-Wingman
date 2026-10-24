import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { CurrentSing, MusicRead, MusicTrackRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import HomeStage from "./HomeStage";

const {
  addFavorite,
  addWish,
  getCurrentSing,
  getMe,
  getMusic,
  getMusicSettings,
  getPlaylist,
  listFavorites,
  listKaraokeColors,
  listPlayers,
  listPlaylists,
  listSongScores,
  listWishlist,
  pauseMusic,
  removeFavorite,
  removeWish,
  skipMusic,
  setMusicVolume,
  stopSinging,
  updateMusicSettings,
} = vi.hoisted(() => ({
  addFavorite: vi.fn(),
  addWish: vi.fn(),
  getCurrentSing: vi.fn(),
  getMe: vi.fn(),
  getMusic: vi.fn(),
  getMusicSettings: vi.fn(),
  getPlaylist: vi.fn(),
  listFavorites: vi.fn(),
  listKaraokeColors: vi.fn(),
  listPlayers: vi.fn(),
  listPlaylists: vi.fn(),
  listSongScores: vi.fn(),
  listWishlist: vi.fn(),
  pauseMusic: vi.fn(),
  removeFavorite: vi.fn(),
  removeWish: vi.fn(),
  skipMusic: vi.fn(),
  setMusicVolume: vi.fn(),
  stopSinging: vi.fn(),
  updateMusicSettings: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  addFavorite,
  addWish,
  getCurrentSing,
  getMe,
  getMusic,
  getMusicSettings,
  getPlaylist,
  listFavorites,
  listKaraokeColors,
  listPlayers,
  listPlaylists,
  listSongScores,
  listWishlist,
  pauseMusic,
  removeFavorite,
  removeWish,
  skipMusic,
  setMusicVolume,
  stopSinging,
  updateMusicSettings,
}));

const SONG = {
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
};

const BACKGROUND = { ...SONG, id: "usdb:2", title: "Waterloo", artist: "ABBA" };

const SING: CurrentSing = {
  sing_id: "sing-1",
  started_at: "2026-08-23T20:00:00+00:00",
  song: SONG,
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
  ],
};

function track(overrides: Partial<MusicTrackRead> = {}): MusicTrackRead {
  return {
    id: "t-1",
    song: BACKGROUND,
    started_at: new Date().toISOString(),
    position_s: 12,
    position_at: new Date().toISOString(),
    duration_s: 200,
    gain_db: null,
    peak: null,
    ...overrides,
  };
}

function music(overrides: Partial<MusicRead> = {}): MusicRead {
  return {
    status: "playing",
    track: track(),
    preview: null,
    blocked_by: null,
    resume_at: null,
    retry_at: null,
    sink_online: true,
    sink_generation: 1,
    volume: { master: 100, music: 60, preview: 100, effects: 80 },
    scope: "all",
    ...overrides,
  };
}

const OFF: MusicRead = music({ status: "off", track: null });

/** Everything the player can draw: a sing, the music and its options. */
const FULL = [
  "karaoke.sing",
  "karaoke.stop",
  "wishlist.add",
  "wishlist.view",
  "music.view",
  "music.control",
  "music.manage",
];

function signedIn(capabilities: string[] = FULL): void {
  getMe.mockResolvedValue(
    meResponse(capabilities, { user: userRead(), role: "user" }),
  );
}

function renderStage() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <HomeStage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.clearAllMocks();
  getCurrentSing.mockResolvedValue({ data: { sing: null } });
  signedIn();
  getMusic.mockResolvedValue({ data: OFF });
  getMusicSettings.mockResolvedValue({
    data: { enabled: false, scope: "all", playlist: "", resume_delay_s: 10 },
  });
  listKaraokeColors.mockResolvedValue({
    data: { colors: [{ name: "blue", hex: "#048BB9" }] },
  });
  listFavorites.mockResolvedValue({ data: { song_ids: [] } });
  listPlayers.mockResolvedValue({ data: { players: [] } });
  listPlaylists.mockResolvedValue({ data: { playlists: [] } });
  listSongScores.mockResolvedValue({ data: { scores: [] } });
  listWishlist.mockResolvedValue({ data: { wishes: [] } });
  addFavorite.mockResolvedValue({ data: undefined });
  removeFavorite.mockResolvedValue({ data: undefined });
  addWish.mockResolvedValue({ data: undefined });
  removeWish.mockResolvedValue({ data: undefined });
  getPlaylist.mockResolvedValue({
    data: { id: "pl-1", name: "Warm-up", entries: [] },
  });
  stopSinging.mockResolvedValue({ data: undefined });
  pauseMusic.mockResolvedValue({ data: music({ status: "paused" }) });
  skipMusic.mockResolvedValue({ data: music() });
  setMusicVolume.mockResolvedValue({ data: music() });
  updateMusicSettings.mockResolvedValue({
    data: { enabled: true, scope: "all", playlist: "", resume_delay_s: 10 },
  });
});

afterEach(() => vi.unstubAllGlobals());

test("a quiet room shows the brand and the logo", async () => {
  const { container } = renderStage();

  expect(await screen.findByText(/Nothing is playing/)).toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "Ultrastar Wingman" }),
  ).toBeInTheDocument();
  // The reel's own logo tile, so the brand mark is drawn in one place.
  expect(container.querySelector(".spinner-cover-logo")).toBeInTheDocument();
  // The brand fills the tile: nothing of the song layout is drawn.
  expect(container.querySelector(".home-stage-head")).toBe(null);
  expect(container.querySelector(".home-stage-controls")).toBe(null);
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
});

test("a running song takes the stage", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  renderStage();

  const block = await screen.findByRole("region", { name: "Now playing" });
  expect(block).toHaveTextContent("Dancing Queen");
  // The singers stay on the USDX screen; the phone shows the song alone.
  expect(block).not.toHaveTextContent("Alice");
  expect(screen.getByRole("button", { name: "Stop" })).toHaveClass(
    "song-control-lead",
  );
});

test("the background song takes the stage while nobody sings", async () => {
  getMusic.mockResolvedValue({ data: music() });
  renderStage();

  const block = await screen.findByRole("region", {
    name: "Background music",
  });
  expect(block).toHaveTextContent("Waterloo");
  expect(block).toHaveTextContent("ABBA");
});

test("a sing outranks the background music", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  getMusic.mockResolvedValue({ data: music() });
  renderStage();

  await screen.findByRole("region", { name: "Now playing" });
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.queryByText("Waterloo")).not.toBeInTheDocument();
});

test("a song draws one control row, and the gear stays out of it", async () => {
  getMusic.mockResolvedValue({ data: music() });
  const background = renderStage();
  await screen.findByRole("region", { name: "Background music" });
  expect(
    background.container.querySelectorAll(".home-stage-controls"),
  ).toHaveLength(1);
  const gear = screen.getByRole("button", {
    name: "Background music settings",
  });
  expect(gear.closest(".home-stage-controls")).toBe(null);
  background.unmount();

  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  const singing = renderStage();
  await screen.findByRole("region", { name: "Now playing" });
  expect(
    singing.container.querySelectorAll(".home-stage-controls"),
  ).toHaveLength(1);
});

test("the background song's row is the music's transport, not a second Sing", async () => {
  getMusic.mockResolvedValue({ data: music() });
  const { container } = renderStage();

  await screen.findByRole("region", { name: "Background music" });
  expect(
    screen.queryByRole("button", { name: "Sing" }),
  ).not.toBeInTheDocument();
  expect(container.querySelector(".song-control-lead")).toBe(null);
  // Heart, play/pause, skip, the volume, wish — the marks at the ends, the
  // music's own controls between them.
  const row = container.querySelector(".home-stage-controls");
  expect(iconNames(row as HTMLElement)).toEqual([
    "heart",
    "pause",
    "skip",
    "volume",
    "playlist-plus",
  ]);
  expect(screen.getByRole("button", { name: "Pause" })).toHaveClass(
    "song-control",
  );
});

test("the cover opens the song modal, which is where the background song is sung", async () => {
  getMusic.mockResolvedValue({ data: music() });
  renderStage();

  fireEvent.click(
    await screen.findByRole("button", { name: "Details for Waterloo" }),
  );

  const modal = await screen.findByRole("dialog", { name: "Waterloo" });
  expect(
    within(modal).getByRole("button", { name: "Sing" }),
  ).toBeInTheDocument();
});

test("the heart and the wish work on the background song", async () => {
  getMusic.mockResolvedValue({ data: music() });
  renderStage();

  await screen.findByRole("region", { name: "Background music" });
  fireEvent.click(screen.getByRole("button", { name: "Add to favorites" }));
  await waitFor(() => expect(addFavorite).toHaveBeenCalled());
  expect(addFavorite.mock.calls[0][0].path.song_id).toBe("usdb:2");

  // The song modal's own names for the same control.
  fireEvent.click(screen.getByRole("button", { name: "Add to wishlist" }));
  await waitFor(() => expect(addWish).toHaveBeenCalled());
  expect(addWish.mock.calls[0][0].body.song_id).toBe("usdb:2");
});

test("a wished background song offers Remove from wishlist, the song modal's name", async () => {
  getMusic.mockResolvedValue({ data: music() });
  listWishlist.mockResolvedValue({
    data: {
      wishes: [
        {
          song: BACKGROUND,
          count: 1,
          mine: true,
          latest: "2026-08-23T20:00:00Z",
        },
      ],
    },
  });
  renderStage();

  fireEvent.click(
    await screen.findByRole("button", { name: "Remove from wishlist" }),
  );
  await waitFor(() => expect(removeWish).toHaveBeenCalled());
});

test("the control row reads favorite, lead, wish — the song modal's order", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  const { container } = renderStage();

  await screen.findByRole("region", { name: "Now playing" });
  const row = container.querySelector(".home-stage-controls");
  expect(iconNames(row as HTMLElement)).toEqual([
    "heart",
    "stop",
    "playlist-plus",
  ]);
});

test("the stage's controls carry no captions, while the modal it opens does", async () => {
  // The tile is a fixed 200px (§4): the words under the song modal's three
  // controls are the modal's alone, in either of the stage's song modes.
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  const { container, unmount } = renderStage();
  await screen.findByRole("region", { name: "Now playing" });
  let row = container.querySelector(".home-stage-controls") as HTMLElement;
  expect(row.querySelector(".song-control-caption")).toBeNull();
  expect(row).not.toHaveTextContent(/Favorite|Sing|Wishlist/);
  unmount();

  getCurrentSing.mockResolvedValue({ data: { sing: null } });
  getMusic.mockResolvedValue({ data: music() });
  const background = renderStage();
  await screen.findByRole("region", { name: "Background music" });
  row = background.container.querySelector(
    ".home-stage-controls",
  ) as HTMLElement;
  expect(row.querySelector(".song-control-caption")).toBeNull();
  expect(row).not.toHaveTextContent(/Favorite|Sing|Wishlist/);

  fireEvent.click(screen.getByRole("button", { name: "Details for Waterloo" }));
  const modal = await screen.findByRole("dialog", { name: "Waterloo" });
  expect(
    modal.querySelectorAll(".song-control-caption").length,
  ).toBeGreaterThan(0);
  expect(row.querySelector(".song-control-caption")).toBeNull();
});

test("pausing and skipping call the backend", async () => {
  getMusic.mockResolvedValue({ data: music() });
  renderStage();

  fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
  await waitFor(() => expect(pauseMusic).toHaveBeenCalled());

  fireEvent.click(screen.getByRole("button", { name: "Skip" }));
  await waitFor(() => expect(skipMusic).toHaveBeenCalled());
});

test("a paused room offers Play in the transport", async () => {
  getMusic.mockResolvedValue({ data: music({ status: "paused" }) });
  renderStage();

  await screen.findByRole("region", { name: "Background music" });
  expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Pause" }),
  ).not.toBeInTheDocument();
});

test("the volume slider writes the music's own volume", async () => {
  getMusic.mockResolvedValue({ data: music() });
  renderStage();

  const slider = await screen.findByRole("slider", { name: "Music volume" });
  fireEvent.change(slider, { target: { value: "25" } });

  await waitFor(() => expect(setMusicVolume).toHaveBeenCalled());
  expect(setMusicVolume.mock.calls[0][0].body).toEqual({ music: 25 });
});

test("a reader who may not control the music gets no transport", async () => {
  signedIn(["music.view", "karaoke.sing"]);
  getMusic.mockResolvedValue({ data: music() });
  renderStage();

  await screen.findByRole("region", { name: "Background music" });
  expect(
    screen.queryByRole("button", { name: "Pause" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  // The song itself, and what it is, are still there.
  expect(screen.getByText("Waterloo")).toBeInTheDocument();
});

test("the gear is there in every mode, so the music can be switched back on", async () => {
  renderStage();

  fireEvent.click(
    await screen.findByRole("button", { name: "Background music settings" }),
  );

  const panel = await screen.findByRole("dialog", { name: "Background music" });
  fireEvent.click(
    within(panel).getByRole("checkbox", { name: "Background music" }),
  );
  await waitFor(() => expect(updateMusicSettings).toHaveBeenCalled());
  expect(updateMusicSettings.mock.calls[0][0].body).toEqual({ enabled: true });
});

test("a reader who may not manage the music gets no gear", async () => {
  signedIn(["music.view", "music.control"]);
  renderStage();

  await waitFor(() => expect(getCurrentSing).toHaveBeenCalled());
  expect(
    screen.queryByRole("button", { name: "Background music settings" }),
  ).not.toBeInTheDocument();
});

test("a reader who may not see the music is told nothing about it", async () => {
  signedIn(["karaoke.sing"]);
  renderStage();

  await waitFor(() => expect(getCurrentSing).toHaveBeenCalled());
  // Not "Nothing is playing": that reader cannot know whether it is.
  expect(screen.queryByText(/Nothing is playing/)).not.toBeInTheDocument();
  expect(screen.getByText("Pick a song and press play.")).toBeInTheDocument();
  expect(getMusic).not.toHaveBeenCalled();
});

test("the player says when no screen is making the sound", async () => {
  getMusic.mockResolvedValue({ data: music({ sink_online: false }) });
  renderStage();

  expect(await screen.findByText("No host screen is open")).toBeInTheDocument();
});

test("stopping from the stage asks first, then calls the backend", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  renderStage();

  fireEvent.click(await screen.findByRole("button", { name: "Stop" }));

  const confirm = screen.getByRole("dialog", { name: "Stop the song" });
  expect(confirm).toHaveTextContent("Dancing Queen");
  expect(stopSinging).not.toHaveBeenCalled();

  fireEvent.click(within(confirm).getByRole("button", { name: "Stop" }));
  await waitFor(() => expect(stopSinging).toHaveBeenCalledTimes(1));
});

test("the song modal outlives the sing that opened it", async () => {
  getCurrentSing.mockResolvedValue({ data: { sing: SING } });
  renderStage();

  fireEvent.click(
    await screen.findByRole("button", { name: "Details for Dancing Queen" }),
  );
  await screen.findByRole("dialog", { name: "Dancing Queen" });

  FakeSocket.deliver({
    event: "karaoke.ended",
    sing_id: "sing-1",
    song_id: "usdb:1",
  });

  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Now playing" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("dialog", { name: "Dancing Queen" }),
  ).toBeInTheDocument();
});

test("the switch is driven by the event, without a second request", async () => {
  renderStage();
  await waitFor(() => expect(getCurrentSing).toHaveBeenCalledTimes(1));

  FakeSocket.deliver({ event: "karaoke.started", sing: SING });
  await screen.findByRole("region", { name: "Now playing" });
  expect(getCurrentSing).toHaveBeenCalledTimes(1);

  FakeSocket.deliver({
    event: "karaoke.ended",
    sing_id: "sing-1",
    song_id: "usdb:1",
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Now playing" }),
    ).not.toBeInTheDocument(),
  );
  expect(getCurrentSing).toHaveBeenCalledTimes(1);
});

test("a music.changed event moves the player without a refetch", async () => {
  getMusic.mockResolvedValue({ data: music() });
  renderStage();
  await screen.findByRole("region", { name: "Background music" });
  expect(getMusic).toHaveBeenCalledTimes(1);

  FakeSocket.deliver({
    event: "music.changed",
    music: music({
      track: track({ id: "t-2", song: { ...SONG, title: "Mamma Mia" } }),
    }),
  });

  expect(await screen.findByText("Mamma Mia")).toBeInTheDocument();
  expect(getMusic).toHaveBeenCalledTimes(1);
});

test("the page keeps exactly one heading in every mode", async () => {
  renderStage();
  await waitFor(() => expect(getCurrentSing).toHaveBeenCalled());

  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
    "Ultrastar Wingman",
  );

  FakeSocket.deliver({ event: "karaoke.started", sing: SING });
  await screen.findByRole("region", { name: "Now playing" });
  const playing = screen.getAllByRole("heading", { level: 1 });
  expect(playing).toHaveLength(1);
  expect(playing[0]).toHaveTextContent("Now playing");
});
