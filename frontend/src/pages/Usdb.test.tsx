import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DownloadRead, UsdbSong } from "../api";
import { FakeSocket } from "../test/fakeSocket";
import Usdb from "./Usdb";

// Same seam as Songs.test.tsx: the real TanStack wiring runs, only the transport
// is faked, so a changed endpoint shape breaks the test instead of hiding.
const { usdbStatus, usdbSearch, listDownloads, createDownload, updateSetting } =
  vi.hoisted(() => ({
    usdbStatus: vi.fn(),
    usdbSearch: vi.fn(),
    listDownloads: vi.fn(),
    createDownload: vi.fn(),
    updateSetting: vi.fn(),
  }));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  usdbStatus,
  usdbSearch,
  listDownloads,
  createDownload,
  updateSetting,
}));

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
    created_at: "2026-08-23T10:00:00Z",
    updated_at: "2026-08-23T10:00:05Z",
    ...overrides,
  };
}

function renderUsdb() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Usdb />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  for (const mock of [
    usdbStatus,
    usdbSearch,
    listDownloads,
    createDownload,
    updateSetting,
  ]) {
    mock.mockReset();
  }
  usdbStatus.mockResolvedValue({ data: { logged_in: true, error: null } });
  usdbSearch.mockResolvedValue({
    data: { results: [usdbSong()], page: 1, pages: 3 },
  });
  listDownloads.mockResolvedValue({ data: { downloads: [] } });
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
  expect(screen.getByText("SingStar")).toBeInTheDocument();
  expect(screen.getByText("English")).toBeInTheDocument();
  expect(screen.getByText("GOLDEN")).toBeInTheDocument();
  expect(screen.getByLabelText("Rated 3.5 of 5")).toHaveTextContent("★★★½");
  expect(screen.getByText("1 / 3")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Download ABBA – Dancing Queen" }),
  ).toBeInTheDocument();
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
        query: { artist: "Toto", title: "Africa", page: 1 },
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

test("an already downloaded result shows a checkmark instead of a button", async () => {
  usdbSearch.mockResolvedValue({
    data: { results: [usdbSong({ downloaded: true })], page: 1, pages: 1 },
  });
  renderUsdb();

  expect(await screen.findByTitle("In the library")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Download/ })).toBeNull();
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
  expect(await screen.findByText("Queued")).toBeInTheDocument();

  FakeSocket.deliver({ event: "download.updated", download: download() });

  // The badge in the result row, and the panel's step line and progress bar.
  expect(await screen.findByText("42%")).toBeInTheDocument();
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

test("the downloads panel shows a failure and retries it with force", async () => {
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

  expect(
    await screen.findByText("no_video — the song has no video link"),
  ).toBeInTheDocument();
  // The row keeps a retry affordance too, with the error as its tooltip.
  expect(await screen.findByTitle("no_video — the song has no video link"));

  fireEvent.click(
    screen.getByRole("button", {
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

  // The result row's own retry forces too — the failed attempt may have left a
  // broken copy behind, which `already_downloaded` would otherwise block.
  createDownload.mockClear();
  fireEvent.click(
    screen.getByRole("button", { name: "Retry ABBA – Dancing Queen" }),
  );
  await waitFor(() =>
    expect(createDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { source: "usdb", source_song_id: "1234", force: true },
      }),
    ),
  );
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

  // The banner reacts to the refreshed verdict and the search runs.
  expect(await screen.findByText("Logged in to USDB.")).toBeInTheDocument();
  expect(await screen.findByText("Dancing Queen")).toBeInTheDocument();
});

test("an unreachable USDB is reported instead of results", async () => {
  usdbSearch.mockRejectedValue({ detail: "unreachable" });
  renderUsdb();

  expect(
    await screen.findByText("USDB could not be reached."),
  ).toBeInTheDocument();
});
