import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { DownloadRead, SongRead, UsdbSong } from "../api";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import Usdb from "./Usdb";

// Same seam as Songs.test.tsx: the real TanStack wiring runs, only the transport
// is faked, so a changed endpoint shape breaks the test instead of hiding.
const {
  usdbStatus,
  usdbSearch,
  listDownloads,
  createDownload,
  dismissDownload,
  dismissFinishedDownloads,
  updateSetting,
  listSongs,
  getMe,
  listFavorites,
  listWishlist,
  listPlaylists,
  listSongScores,
} = vi.hoisted(() => ({
  usdbStatus: vi.fn(),
  usdbSearch: vi.fn(),
  listDownloads: vi.fn(),
  createDownload: vi.fn(),
  dismissDownload: vi.fn(),
  dismissFinishedDownloads: vi.fn(),
  updateSetting: vi.fn(),
  listSongs: vi.fn(),
  getMe: vi.fn(),
  listFavorites: vi.fn(),
  listWishlist: vi.fn(),
  listPlaylists: vi.fn(),
  listSongScores: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  usdbStatus,
  usdbSearch,
  listDownloads,
  createDownload,
  dismissDownload,
  dismissFinishedDownloads,
  updateSetting,
  listSongs,
  getMe,
  listFavorites,
  listWishlist,
  listPlaylists,
  listSongScores,
}));

/** What the trusted role holds: enough for every control on this page. */
const TRUSTED = [
  "songs.view",
  "usdb.search",
  "downloads.view",
  "downloads.manage",
  "settings.manage",
  "wishlist.view",
  "playlists.view",
  "stats.view",
];

function localSong(overrides: Partial<SongRead> = {}): SongRead {
  return {
    id: "usdb:1234",
    source: "usdb",
    title: "Dancing Queen",
    artist: "ABBA",
    duration_seconds: 231,
    has_video: true,
    is_duet: false,
    language: "English",
    genre: "Pop",
    year: 1976,
    edition: "SingStar",
    creator: "someone",
    ...overrides,
  };
}

function usdbSong(overrides: Partial<UsdbSong> = {}): UsdbSong {
  return {
    usdb_id: 1234,
    artist: "ABBA",
    title: "Dancing Queen",
    edition: "SingStar",
    language: "English",
    golden: true,
    rating: 3.5,
    downloaded: false,
    ...overrides,
  };
}

function download(overrides: Partial<DownloadRead> = {}): DownloadRead {
  return {
    id: 7,
    source: "usdb",
    source_song_id: "1234",
    title: "Dancing Queen",
    artist: "ABBA",
    status: "running",
    progress: 42.4,
    step: "downloading the video",
    error: null,
    song_id: null,
    // What the backend says about a row this run produced; an older one carries
    // `current_session: false` and only shows with the filter off.
    current_session: true,
    dismissed_at: null,
    created_at: "2026-08-23T10:00:00Z",
    updated_at: "2026-08-23T10:00:05Z",
    ...overrides,
  };
}

function renderUsdb(capabilities = TRUSTED) {
  getMe.mockResolvedValue(meResponse(capabilities));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {/* The page header's back link and nothing else needs a router. */}
      <MemoryRouter>
        <Usdb />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  // jsdom has no layout; the page's scroll reset would log "Not implemented".
  vi.stubGlobal("scrollTo", vi.fn());
  for (const mock of [
    usdbStatus,
    usdbSearch,
    listDownloads,
    createDownload,
    dismissDownload,
    dismissFinishedDownloads,
    updateSetting,
    listSongs,
    getMe,
    listFavorites,
    listWishlist,
    listPlaylists,
    listSongScores,
  ]) {
    mock.mockReset();
  }
  usdbStatus.mockResolvedValue({ data: { logged_in: true, error: null } });
  usdbSearch.mockResolvedValue({
    data: { results: [usdbSong()], page: 1, pages: 3 },
  });
  listDownloads.mockResolvedValue({ data: { downloads: [] } });
  // The library is empty unless a test puts the song into it.
  listSongs.mockResolvedValue({ data: { songs: [] } });
  listFavorites.mockResolvedValue({ data: { song_ids: [] } });
  listWishlist.mockResolvedValue({ data: { wishes: [] } });
  listPlaylists.mockResolvedValue({ data: { playlists: [] } });
  listSongScores.mockResolvedValue({ data: { scores: [] } });
});

afterEach(() => vi.unstubAllGlobals());

test("search results show the USDB metadata and a download button", async () => {
  usdbSearch.mockResolvedValue({
    data: {
      results: [
        usdbSong(),
        usdbSong({
          usdb_id: 5,
          artist: "Toto",
          title: "Africa",
          edition: null,
          language: null,
          golden: false,
          rating: null,
        }),
      ],
      page: 1,
      pages: 3,
    },
  });
  renderUsdb();

  expect(await screen.findByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.getByText("Africa")).toBeInTheDocument();
  // Language on the sub-line; the edition survives only in its tooltip.
  expect(screen.getByText("ABBA · English")).toBeInTheDocument();
  expect(screen.getByTitle("SingStar · English")).toBeInTheDocument();
  expect(screen.queryByText("GOLDEN")).toBeNull();
  expect(screen.getByLabelText("Rated 3.5 of 5")).toBeInTheDocument();
  expect(screen.getByText("1 / 3")).toBeInTheDocument();
  expect(screen.getByText("2 results")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Download ABBA – Dancing Queen" }),
  ).toBeInTheDocument();
});

test("the page is a sub-view of Songs with the downloads button in its header", async () => {
  renderUsdb();

  const header = (await screen.findByRole("heading", { name: "USDB" }))
    .parentElement as HTMLElement;
  expect(within(header).getByRole("link", { name: "Back" })).toHaveAttribute(
    "href",
    "/songs",
  );
  expect(
    within(header).getByRole("button", { name: "Downloads" }),
  ).toBeInTheDocument();
});

test("every result shows the cover USDB serves, proxied by the backend", async () => {
  renderUsdb();
  await screen.findByText("Dancing Queen");

  const cover = document.querySelector("img.song-cover") as HTMLImageElement;
  expect(cover).not.toBeNull();
  expect(cover.getAttribute("src")).toBe(
    "/api/v1/sources/usdb/songs/1234/cover",
  );
  // Only what is on screen is fetched; a page of 100 results is not 100
  // requests to USDB up front.
  expect(cover.getAttribute("loading")).toBe("lazy");

  // USDB has no cover for every song, and says so with a 404.
  fireEvent.error(cover);
  expect(await screen.findByText("A")).toBeInTheDocument();
  expect(document.querySelector("img.song-cover")).toBeNull();
});

test("submitting the form searches for the entered artist and title", async () => {
  renderUsdb();
  await screen.findByText("Dancing Queen");

  fireEvent.change(screen.getByLabelText("Artist"), {
    target: { value: "Toto" },
  });
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Africa" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));

  await waitFor(() =>
    expect(usdbSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: {
          artist: "Toto",
          title: "Africa",
          order: "rating",
          ud: "desc",
          limit: 30,
          page: 1,
        },
      }),
    ),
  );
});

test("the extra filters change the order and the page size right away", async () => {
  renderUsdb();
  await screen.findByText("Dancing Queen");

  fireEvent.change(screen.getByLabelText("Artist"), {
    target: { value: "Toto" },
  });
  // Collapsed by default; the fields are in the DOM either way.
  fireEvent.change(screen.getByLabelText("Sort by"), {
    target: { value: "title-asc" },
  });

  // No second click on Search: a filter behind a button the user has to find
  // again is a filter nobody uses.
  await waitFor(() =>
    expect(usdbSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          artist: "Toto",
          order: "title",
          ud: "asc",
          page: 1,
        }),
      }),
    ),
  );

  fireEvent.change(screen.getByLabelText("Results per page"), {
    target: { value: "100" },
  });
  await waitFor(() =>
    expect(usdbSearch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ limit: 100, page: 1 }),
      }),
    ),
  );
});

test("paging past the last page keeps a way back", async () => {
  // No page count: USDB does not always render a paginator.
  usdbSearch.mockResolvedValue({
    data: { results: [usdbSong()], page: 1, pages: null },
  });
  renderUsdb();

  await screen.findByText("Page 1");
  usdbSearch.mockResolvedValue({ data: { results: [], page: 2, pages: null } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));

  expect(await screen.findByText("No more results.")).toBeInTheDocument();
  expect(await screen.findByText("Page 2")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

  usdbSearch.mockResolvedValue({
    data: { results: [usdbSong()], page: 1, pages: null },
  });
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(await screen.findByText("Dancing Queen")).toBeInTheDocument();
});

test("a result that is downloading shows its state and offers nothing to click", async () => {
  // `downloaded` is set for a queued download too, and there is no local song
  // behind it yet — so the row must stay inert.
  usdbSearch.mockResolvedValue({
    data: { results: [usdbSong({ downloaded: true })], page: 1, pages: 1 },
  });
  renderUsdb();

  expect(await screen.findByTitle("In the library")).toBeInTheDocument();
  // Only the header's downloads button is left — no per-row download button.
  expect(screen.queryByRole("button", { name: /Dancing Queen/ })).toBeNull();
});

test("a result that is in the library opens the song details", async () => {
  usdbSearch.mockResolvedValue({
    data: { results: [usdbSong({ downloaded: true })], page: 1, pages: 1 },
  });
  listSongs.mockResolvedValue({ data: { songs: [localSong()] } });
  renderUsdb();

  const row = await screen.findByRole("button", {
    name: "Details for ABBA – Dancing Queen",
  });
  fireEvent.click(row);

  // The standard song modal, not a USDB-only view.
  const dialog = await screen.findByRole("dialog", { name: "Dancing Queen" });
  expect(within(dialog).getByText("ABBA")).toBeInTheDocument();
  expect(
    within(dialog).getByRole("button", { name: "Details" }),
  ).toBeInTheDocument();
});

test("clicking download posts it and a progress event turns it into a badge", async () => {
  createDownload.mockResolvedValue({
    data: download({ status: "queued", progress: null, step: null }),
  });
  renderUsdb();

  fireEvent.click(
    await screen.findByRole("button", {
      name: "Download ABBA – Dancing Queen",
    }),
  );

  await waitFor(() =>
    expect(createDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { source: "usdb", source_song_id: "1234", force: false },
      }),
    ),
  );

  FakeSocket.deliver({
    event: "download.updated",
    download: download({ status: "queued", progress: null, step: null }),
  });
  expect(
    await screen.findByLabelText("Queued: ABBA – Dancing Queen"),
  ).toBeInTheDocument();

  FakeSocket.deliver({ event: "download.updated", download: download() });

  // The state icon in the result row, and the modal's step line and bar.
  const state = await screen.findByLabelText(
    "Downloading ABBA – Dancing Queen, 42%",
  );
  // The row's ring draws the same percentage the panel writes out — not the
  // spinner it falls back to while nothing measurable is happening.
  const ring = state.querySelector("svg");
  expect(ring).not.toHaveClass("usdb-ring-indeterminate");
  expect(ring?.style.getPropertyValue("--p")).toBe("0.424");
  fireEvent.click(screen.getByRole("button", { name: "Downloads: 1 running" }));
  expect(screen.getByText("downloading the video · 42%")).toBeInTheDocument();
  expect(
    screen.getByRole("progressbar", {
      name: "Progress of ABBA – Dancing Queen",
    }),
  ).toHaveValue(42.4);
  expect(screen.queryByRole("button", { name: /Dancing Queen/ })).toBeNull();

  FakeSocket.deliver({
    event: "download.updated",
    download: download({
      status: "finished",
      progress: 100,
      song_id: "usdb:1234",
    }),
  });
  expect(await screen.findByTitle("In the library")).toBeInTheDocument();
});

test("the downloads modal shows a failure and retries it with force", async () => {
  listDownloads.mockResolvedValue({
    data: {
      downloads: [
        download({
          status: "failed",
          progress: null,
          step: null,
          error: "no_video — the song has no video link",
        }),
      ],
    },
  });
  createDownload.mockResolvedValue({ data: download({ status: "queued" }) });
  renderUsdb();

  fireEvent.click(
    await screen.findByRole("button", { name: "Downloads: 1 failed" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Downloads" });
  // The reason in the summary, the raw dump behind the disclosure — the
  // message has no colon to strip, so it appears in both.
  expect(
    within(dialog).getAllByText("no_video — the song has no video link").length,
  ).toBeGreaterThan(0);

  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Retry download of ABBA – Dancing Queen",
    }),
  );

  await waitFor(() =>
    expect(createDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { source: "usdb", source_song_id: "1234", force: true },
      }),
    ),
  );
});

test("a failed row explains itself and retries with force", async () => {
  listDownloads.mockResolvedValue({
    data: {
      downloads: [
        download({
          status: "failed",
          progress: null,
          step: null,
          error: "ffmpeg failed with exit code 1: libavcodec 61 banner…",
        }),
      ],
    },
  });
  createDownload.mockResolvedValue({ data: download({ status: "queued" }) });
  renderUsdb();

  fireEvent.click(
    await screen.findByRole("button", {
      name: "Download of ABBA – Dancing Queen failed — show the error",
    }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Download failed",
  });
  // Only the first clause: the ffmpeg banner after the colon stays out.
  expect(
    within(dialog).getByText("ffmpeg failed with exit code 1"),
  ).toBeInTheDocument();

  // The retry forces — the failed attempt may have left a broken copy behind,
  // which `already_downloaded` would otherwise block.
  fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
  await waitFor(() =>
    expect(createDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { source: "usdb", source_song_id: "1234", force: true },
      }),
    ),
  );
});

test("the downloads live behind the header button, not on the page", async () => {
  listDownloads.mockResolvedValue({ data: { downloads: [download()] } });
  renderUsdb();

  const button = await screen.findByRole("button", {
    name: "Downloads: 1 running",
  });
  expect(screen.queryByText("downloading the video · 42%")).toBeNull();

  fireEvent.click(button);
  expect(
    await screen.findByText("downloading the video · 42%"),
  ).toBeInTheDocument();
});

test("the panel shows this run and keeps the older history one click away", async () => {
  listDownloads.mockResolvedValue({
    data: {
      downloads: [
        download({
          id: 9,
          artist: "Toto",
          title: "Africa",
          status: "finished",
          song_id: "usdb:5",
        }),
        download({
          id: 3,
          title: "Waterloo",
          status: "failed",
          progress: null,
          step: null,
          error: "no_video — the song has no video link",
          current_session: false,
        }),
      ],
    },
  });
  renderUsdb();

  // A failure from an earlier run is history: it must not keep the header
  // button alerting for ever, which is what it used to do.
  const button = await screen.findByRole("button", { name: "Downloads" });
  fireEvent.click(button);

  const dialog = await screen.findByRole("dialog", { name: "Downloads" });
  expect(within(dialog).getByText("Toto – Africa")).toBeInTheDocument();
  expect(within(dialog).queryByText("ABBA – Waterloo")).toBeNull();

  // Hidden, not gone.
  fireEvent.click(within(dialog).getByLabelText("Only this session"));
  expect(within(dialog).getByText("ABBA – Waterloo")).toBeInTheDocument();
});

test("dismissing a failed download takes it off the panel", async () => {
  const failed = download({
    status: "failed",
    progress: null,
    step: null,
    error: "no_video — the song has no video link",
  });
  listDownloads.mockResolvedValue({ data: { downloads: [failed] } });
  dismissDownload.mockResolvedValue({
    data: { ...failed, dismissed_at: "2026-08-23T10:05:00Z" },
  });
  renderUsdb();

  fireEvent.click(
    await screen.findByRole("button", { name: "Downloads: 1 failed" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Downloads" });
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Dismiss ABBA – Dancing Queen",
    }),
  );

  await waitFor(() =>
    expect(dismissDownload).toHaveBeenCalledWith(
      expect.objectContaining({ path: { download_id: 7 } }),
    ),
  );
  expect(
    await within(dialog).findByText("Nothing downloaded yet."),
  ).toBeInTheDocument();
  // And the alert on the header button goes with it.
  expect(screen.getByRole("button", { name: "Downloads" })).toBeInTheDocument();
});

test("clearing the finished downloads leaves the failures alone", async () => {
  const done = download({
    id: 9,
    artist: "Toto",
    title: "Africa",
    status: "finished",
    song_id: "usdb:5",
  });
  const failed = download({
    status: "failed",
    progress: null,
    step: null,
    error: "no_video — the song has no video link",
  });
  listDownloads.mockResolvedValue({ data: { downloads: [failed, done] } });
  dismissFinishedDownloads.mockResolvedValue({
    data: { downloads: [{ ...done, dismissed_at: "2026-08-23T10:05:00Z" }] },
  });
  renderUsdb();

  fireEvent.click(
    await screen.findByRole("button", { name: "Downloads: 1 failed" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Downloads" });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Clear finished" }),
  );

  await waitFor(() =>
    expect(within(dialog).queryByText("Toto – Africa")).toBeNull(),
  );
  expect(within(dialog).getByText("ABBA – Dancing Queen")).toBeInTheDocument();
});

test("a dismiss the backend refuses is reported inside the panel", async () => {
  const failed = download({
    status: "failed",
    progress: null,
    step: null,
    error: "no_video — the song has no video link",
  });
  listDownloads.mockResolvedValue({ data: { downloads: [failed] } });
  // Retention dropped it between the last refetch and the click.
  dismissDownload.mockRejectedValue({ detail: "unknown_download" });
  renderUsdb();

  fireEvent.click(
    await screen.findByRole("button", { name: "Downloads: 1 failed" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Downloads" });
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Dismiss ABBA – Dancing Queen",
    }),
  );

  // In the panel, not on the page behind the backdrop, where nobody would see it.
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Could not dismiss the download.",
  );
  expect(within(dialog).getByText("ABBA – Dancing Queen")).toBeInTheDocument();
});

test("without the right to manage downloads the panel only reports", async () => {
  listDownloads.mockResolvedValue({
    data: {
      downloads: [
        download({ status: "finished", song_id: "usdb:1234" }),
        download({
          id: 8,
          artist: "Toto",
          title: "Africa",
          status: "failed",
          progress: null,
          step: null,
          error: "no_video — the song has no video link",
        }),
      ],
    },
  });
  renderUsdb(TRUSTED.filter((one) => one !== "downloads.manage"));

  fireEvent.click(
    await screen.findByRole("button", { name: "Downloads: 1 failed" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Downloads" });
  expect(within(dialog).getByText("ABBA – Dancing Queen")).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: /^Dismiss/ })).toBeNull();
  expect(
    within(dialog).queryByRole("button", { name: "Clear finished" }),
  ).toBeNull();
  // Retry queues a new download, which is `downloads.manage` too: offering it
  // here would only ever produce a 403.
  expect(within(dialog).queryByRole("button", { name: /^Retry/ })).toBeNull();
  // The failure still reports itself — summary and raw dump — it just cannot be
  // acted on.
  expect(within(dialog).getByText("Toto – Africa")).toBeInTheDocument();
  expect(
    within(dialog).getAllByText("no_video — the song has no video link"),
  ).toHaveLength(2);
});

test("a download that is already queued is reported", async () => {
  createDownload.mockRejectedValue({ detail: "already_queued" });
  renderUsdb();

  fireEvent.click(
    await screen.findByRole("button", {
      name: "Download ABBA – Dancing Queen",
    }),
  );

  expect(
    await screen.findByText("That song is already in the queue."),
  ).toBeInTheDocument();
});

test("without a login the credentials form replaces the search", async () => {
  usdbStatus.mockResolvedValue({
    data: { logged_in: false, error: "no_credentials" },
  });
  renderUsdb();

  expect(
    await screen.findByText("Wingman has no USDB account yet."),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
  // Nothing is asked of USDB while the login is missing.
  expect(usdbSearch).not.toHaveBeenCalled();
});

test("saving credentials patches both settings and rechecks the status", async () => {
  usdbStatus.mockResolvedValue({
    data: { logged_in: false, error: "invalid_credentials" },
  });
  updateSetting.mockImplementation(async () => ({ data: {} }));
  renderUsdb();

  await screen.findByText("USDB rejected those credentials.");
  fireEvent.change(screen.getByLabelText("USDB username"), {
    target: { value: "singer" },
  });
  fireEvent.change(screen.getByLabelText("USDB password"), {
    target: { value: "s3cret" },
  });

  usdbStatus.mockResolvedValue({ data: { logged_in: true, error: null } });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));

  await waitFor(() =>
    expect(updateSetting).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { key: "usdb.username" },
        body: { value: "singer" },
      }),
    ),
  );
  expect(updateSetting).toHaveBeenCalledWith(
    expect.objectContaining({
      path: { key: "usdb.password" },
      body: { value: "s3cret" },
    }),
  );
  expect(usdbStatus).toHaveBeenCalledWith(
    expect.objectContaining({ query: { refresh: true } }),
  );

  // The refreshed verdict unlocks the search — results are the proof.
  expect(await screen.findByText("Dancing Queen")).toBeInTheDocument();
});

test("an unreachable USDB is reported instead of results", async () => {
  usdbSearch.mockRejectedValue({ detail: "unreachable" });
  renderUsdb();

  expect(
    await screen.findByText("USDB could not be reached."),
  ).toBeInTheDocument();
});
