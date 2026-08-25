import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MeRead, PlaylistRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import Playlists from "./Playlists";

// Same seam as the songs page: the real TanStack wiring runs, only the
// transport is faked.
const { getMe, listPlaylists, createPlaylist, updatePlaylist, deletePlaylist } =
  vi.hoisted(() => ({
    getMe: vi.fn(),
    listPlaylists: vi.fn(),
    createPlaylist: vi.fn(),
    updatePlaylist: vi.fn(),
    deletePlaylist: vi.fn(),
  }));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listPlaylists,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
}));

const LIBRARY = ["playlists.view", "playlists.manage"];
const ACCOUNT: Partial<MeRead> = { user: userRead(), role: "user" };

function playlist(overrides: Partial<PlaylistRead> = {}): PlaylistRead {
  return {
    id: "p1",
    name: "Party",
    shared: false,
    owner_username: "Alice",
    song_count: 2,
    mine: true,
    ...overrides,
  };
}

function renderPlaylists(
  playlists: PlaylistRead[] | Error,
  capabilities = LIBRARY,
  me: Partial<MeRead> = ACCOUNT,
) {
  getMe.mockResolvedValue(meResponse(capabilities, me));
  listPlaylists.mockImplementation(async () => {
    if (playlists instanceof Error) throw playlists;
    return { data: { playlists } };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Playlists />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const mock of [
    getMe,
    listPlaylists,
    createPlaylist,
    updatePlaylist,
    deletePlaylist,
  ]) {
    mock.mockReset();
  }
});

test("every visible playlist is a row leading to its songs", async () => {
  renderPlaylists([
    playlist(),
    playlist({
      id: "p2",
      name: "Bobs mix",
      shared: true,
      mine: false,
      owner_username: "Bob",
      song_count: 1,
    }),
  ]);

  expect(await screen.findByRole("link", { name: /Party/ })).toHaveAttribute(
    "href",
    "/songs/playlists/p1",
  );
  expect(screen.getByText("2 songs")).toBeInTheDocument();
  // The owner of a shared playlist is plain text, never a badge.
  expect(screen.getByText("1 song · Bob")).toBeInTheDocument();
});

test("the view creates a playlist", async () => {
  createPlaylist.mockResolvedValue({ data: playlist({ song_count: 0 }) });
  renderPlaylists([]);
  await screen.findByText(/No playlists yet/);

  fireEvent.change(screen.getByLabelText("New playlist name"), {
    target: { value: "Party" },
  });
  fireEvent.click(screen.getByLabelText("Shared"));
  fireEvent.click(screen.getByRole("button", { name: "Create" }));

  await waitFor(() =>
    expect(createPlaylist.mock.calls[0][0].body).toEqual({
      name: "Party",
      shared: true,
    }),
  );
});

test("the pencil renames a playlist and can share it", async () => {
  updatePlaylist.mockResolvedValue({ data: playlist({ name: "Karaoke" }) });
  renderPlaylists([playlist()]);

  fireEvent.click(await screen.findByRole("button", { name: "Edit Party" }));
  fireEvent.change(screen.getByLabelText("Name of Party"), {
    target: { value: "Karaoke" },
  });
  fireEvent.click(screen.getByLabelText("Share Party"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(updatePlaylist.mock.calls[0][0]).toMatchObject({
      path: { playlist_id: "p1" },
      body: { name: "Karaoke", shared: true },
    }),
  );
});

test("editing can be abandoned without a request", async () => {
  renderPlaylists([playlist()]);

  fireEvent.click(await screen.findByRole("button", { name: "Edit Party" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(
    await screen.findByRole("link", { name: /Party/ }),
  ).toBeInTheDocument();
  expect(updatePlaylist).not.toHaveBeenCalled();
});

test("deleting asks first", async () => {
  deletePlaylist.mockResolvedValue({ data: undefined });
  renderPlaylists([playlist()]);

  fireEvent.click(
    await screen.findByRole("button", { name: "Delete playlist Party" }),
  );
  expect(
    screen.getByRole("dialog", { name: "Delete playlist" }),
  ).toBeInTheDocument();
  // Backing out leaves the playlist alone.
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(deletePlaylist).not.toHaveBeenCalled();

  fireEvent.click(
    screen.getByRole("button", { name: "Delete playlist Party" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  await waitFor(() =>
    expect(deletePlaylist.mock.calls[0][0].path).toEqual({ playlist_id: "p1" }),
  );
});

test("somebody else's playlist has no edit or delete controls", async () => {
  renderPlaylists([
    playlist({ id: "p2", name: "Bobs mix", shared: true, mine: false }),
  ]);
  await screen.findByRole("link", { name: /Bobs mix/ });

  expect(
    screen.queryByRole("button", { name: "Edit Bobs mix" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Delete playlist Bobs mix" }),
  ).not.toBeInTheDocument();
});

test("a guest sees the playlists but gets no create form", async () => {
  renderPlaylists(
    [playlist({ shared: true, mine: false })],
    ["playlists.view"],
    {
      user: null,
      role: "guest",
    },
  );

  await screen.findByRole("link", { name: /Party/ });
  expect(screen.queryByLabelText("New playlist name")).not.toBeInTheDocument();
});

test("the host may fix a shared playlist it does not own", async () => {
  // The host session is an administrator without an account: it can never own a
  // playlist (so no create form), but the backend lets it edit anybody's.
  renderPlaylists([playlist({ shared: true, mine: false })], LIBRARY, {
    user: null,
    role: "admin",
    is_host: true,
  });

  expect(
    await screen.findByRole("button", { name: "Edit Party" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Delete playlist Party" }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("New playlist name")).not.toBeInTheDocument();
});

test("a role without playlists.view is told who may look", async () => {
  renderPlaylists([], ["songs.view"], { user: null, role: "guest" });

  expect(
    await screen.findByText(/Playlists are not open to your role/),
  ).toBeInTheDocument();
  expect(listPlaylists).not.toHaveBeenCalled();
});

test("a failing request says so", async () => {
  renderPlaylists(new Error("boom"));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load the playlists.",
  );
});
