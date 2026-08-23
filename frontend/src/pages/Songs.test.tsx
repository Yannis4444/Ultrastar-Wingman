import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SongRead } from "../api";
import { meResponse } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import Songs from "./Songs";

// The generated query options call the sdk and read `.data`, so the sdk is the
// seam: the real TanStack wiring runs, only the transport is faked. The rest of
// the module stays real so a new endpoint can't break this mock.
const { listSongs, rescanSongs, getMe } = vi.hoisted(() => ({
  listSongs: vi.fn(),
  rescanSongs: vi.fn(),
  getMe: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  listSongs,
  rescanSongs,
  getMe,
}));

/** What the trusted role holds: enough for every button on this page. */
const TRUSTED = [
  "songs.view",
  "songs.rescan",
  "karaoke.sing",
  "usdb.search",
  "players.view",
];

function song(overrides: Partial<SongRead> = {}): SongRead {
  return {
    id: "usdb:1",
    source: "usdb",
    title: "Dancing Queen",
    artist: "ABBA",
    duration_seconds: 231,
    has_video: true,
    language: "English",
    genre: "Pop",
    year: 1976,
    edition: "SingStar",
    creator: "someone",
    ...overrides,
  };
}

function renderSongs(songs: SongRead[] | Error, capabilities = TRUSTED) {
  getMe.mockResolvedValue(meResponse(capabilities));
  listSongs.mockImplementation(async () => {
    if (songs instanceof Error) throw songs;
    return { data: { songs } };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {/* The "Explore USDB" link needs a router context. */}
      <MemoryRouter>
        <Songs />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function searchFor(text: string) {
  fireEvent.change(screen.getByRole("searchbox", { name: "Search songs" }), {
    target: { value: text },
  });
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  listSongs.mockReset();
  rescanSongs.mockReset();
  getMe.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

test("songs from the API are listed with artist and duration", async () => {
  renderSongs([
    song(),
    song({
      id: "local:abc",
      title: "Africa",
      artist: "Toto",
      duration_seconds: 295,
      has_video: false,
    }),
  ]);

  expect(await screen.findByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.getByText("ABBA")).toBeInTheDocument();
  expect(screen.getByText("3:51")).toBeInTheDocument();
  expect(screen.getByText("4:55")).toBeInTheDocument();
  expect(screen.getByText("2 songs")).toBeInTheDocument();
  // Only the song that has one gets the badge.
  expect(screen.getAllByText("VIDEO")).toHaveLength(1);
});

test("the search box filters by title, artist and exact id", async () => {
  renderSongs([
    song(),
    song({ id: "local:abc", title: "Africa", artist: "Toto" }),
  ]);
  await screen.findByText("Dancing Queen");

  searchFor("toT");
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();
  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.getByText("1 song")).toBeInTheDocument();

  searchFor("queen");
  expect(screen.getByText("Dancing Queen")).toBeInTheDocument();
  expect(screen.queryByText("Africa")).not.toBeInTheDocument();

  searchFor("local:abc");
  expect(screen.getByText("Africa")).toBeInTheDocument();
  expect(screen.queryByText("Dancing Queen")).not.toBeInTheDocument();

  searchFor("nothing matches this");
  expect(
    screen.getByText('No song matches "nothing matches this".'),
  ).toBeInTheDocument();
});

test("an empty library says so instead of showing an empty list", async () => {
  renderSongs([]);

  expect(await screen.findByText(/library is empty/)).toBeInTheDocument();
  expect(screen.getByText("0 songs")).toBeInTheDocument();
});

test("clicking a song opens the details modal", async () => {
  renderSongs([song()]);

  fireEvent.click(await screen.findByText("Dancing Queen"));

  const modal = screen.getByRole("dialog", { name: "Dancing Queen" });
  for (const value of ["ABBA", "3:51", "English", "Pop", "1976", "usdb:1"]) {
    expect(modal).toHaveTextContent(value);
  }

  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("missing metadata shows as unknown in the modal", async () => {
  renderSongs([song({ duration_seconds: null, genre: null, year: null })]);

  fireEvent.click(await screen.findByText("Dancing Queen"));

  const modal = screen.getByRole("dialog", { name: "Dancing Queen" });
  expect(modal).toHaveTextContent("--:--");
  expect(modal).toHaveTextContent("unknown");
});

test("escape closes the modal", async () => {
  renderSongs([song()]);

  fireEvent.click(await screen.findByText("Dancing Queen"));
  expect(screen.getByRole("dialog")).toBeInTheDocument();

  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("a failing songs request shows a styled error with a retry", async () => {
  renderSongs(new Error("boom"));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load the song library.",
  );
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
});

test("rescan reports a scan that is already running, then disables itself", async () => {
  renderSongs([song()]);
  await screen.findByText("Dancing Queen");
  rescanSongs.mockRejectedValue({ status: "running" });

  fireEvent.click(screen.getByRole("button", { name: "Rescan" }));

  expect(
    await screen.findByText("A scan is already running."),
  ).toBeInTheDocument();

  rescanSongs.mockResolvedValue({ data: { status: "started" } });
  fireEvent.click(screen.getByRole("button", { name: "Rescan" }));

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled(),
  );
});

test("a finished download refetches the song list", async () => {
  renderSongs([song()]);
  await screen.findByText("Dancing Queen");
  expect(listSongs).toHaveBeenCalledTimes(1);

  listSongs.mockResolvedValue({
    data: { songs: [song(), song({ id: "usdb:2", title: "Waterloo" })] },
  });
  // Still running: the song is not in the library yet, so nothing is refetched.
  FakeSocket.deliver({
    event: "download.updated",
    download: { id: 1, source: "usdb", source_song_id: "2", status: "running" },
  });
  expect(listSongs).toHaveBeenCalledTimes(1);

  FakeSocket.deliver({
    event: "download.updated",
    download: {
      id: 1,
      source: "usdb",
      source_song_id: "2",
      status: "finished",
      song_id: "usdb:2",
    },
  });

  expect(await screen.findByText("Waterloo")).toBeInTheDocument();
});

test("a finished scan refetches the song list", async () => {
  renderSongs([song()]);
  await screen.findByText("Dancing Queen");
  expect(listSongs).toHaveBeenCalledTimes(1);

  listSongs.mockResolvedValue({
    data: { songs: [song(), song({ id: "usdb:2", title: "Waterloo" })] },
  });
  // What the backend broadcasts on the shared socket when a scan completes.
  FakeSocket.deliver({
    event: "songs.scan_finished",
    added: 1,
    removed: 0,
    updated: 0,
    total: 2,
  });

  expect(await screen.findByText("Waterloo")).toBeInTheDocument();
});

test("the privileged buttons are gone for a role without the capability", async () => {
  renderSongs([song()], ["songs.view", "players.view"]);
  await screen.findByText("Dancing Queen");

  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Rescan" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("link", { name: "Explore USDB" }),
  ).not.toBeInTheDocument();

  // The song itself stays browsable — only the actions are gated.
  fireEvent.click(screen.getByText("Dancing Queen"));
  expect(
    screen.queryByRole("button", { name: "Sing" }),
  ).not.toBeInTheDocument();
});

test("a role with the capabilities gets rescan and sing", async () => {
  renderSongs([song()], ["songs.view", "songs.rescan", "karaoke.sing"]);
  await screen.findByText("Dancing Queen");

  expect(
    await screen.findByRole("button", { name: "Rescan" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByText("Dancing Queen"));
  expect(screen.getByRole("button", { name: "Sing" })).toBeInTheDocument();
});

test("a rescan denied by the backend explains the missing capability", async () => {
  renderSongs([song()]);
  await screen.findByText("Dancing Queen");
  rescanSongs.mockRejectedValue({ detail: "missing_permission:songs.rescan" });

  fireEvent.click(screen.getByRole("button", { name: "Rescan" }));

  expect(
    await screen.findByText(/may not do this \(songs\.rescan\)/),
  ).toBeInTheDocument();
});
