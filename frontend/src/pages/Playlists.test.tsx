import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { MeRead, PlaylistRead } from "../api";
import { AS, meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import Playlists from "./Playlists";

// Same seam as the songs page: the real TanStack wiring runs, only the
// transport is faked.
const { getMe, listPlaylists, createPlaylist } = vi.hoisted(() => ({
  getMe: vi.fn(),
  listPlaylists: vi.fn(),
  createPlaylist: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listPlaylists,
  createPlaylist,
}));

const LIBRARY = ["playlists.view", "playlists.manage"];
const ACCOUNT: Partial<MeRead> = { user: userRead(), ...AS.user };

function playlist(overrides: Partial<PlaylistRead> = {}): PlaylistRead {
  return {
    id: "p1",
    name: "Party",
    description: null,
    is_global: false,
    owner_username: "Alice",
    owner_player_id: null,
    song_count: 2,
    duration_seconds: 0,
    cover_song_ids: [],
    my_access: "owner",
    followed: true,
    can_edit: true,
    can_manage: true,
    contains: null,
    ...overrides,
  };
}

/** Somebody else's global list: everybody may look, nobody but them may change. */
const THEIRS: Partial<PlaylistRead> = {
  is_global: true,
  my_access: null,
  followed: false,
  can_edit: false,
  can_manage: false,
  owner_username: "Bob",
};

/** A list Bob named the reader on, and the reader kept. */
const SHARED: Partial<PlaylistRead> = {
  my_access: "write",
  followed: true,
  can_edit: true,
  can_manage: false,
  owner_username: "Bob",
};

/** The same, unfollowed: out of the way, not gone. */
const UNFOLLOWED: Partial<PlaylistRead> = { ...SHARED, followed: false };

/** Where the page has taken the reader — the create flow navigates. */
function Probe() {
  return <p>at {useLocation().pathname}</p>;
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
      <MemoryRouter initialEntries={["/songs/playlists"]}>
        <Playlists />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  for (const mock of [getMe, listPlaylists, createPlaylist]) mock.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

test("every visible playlist is a row leading to its songs", async () => {
  renderPlaylists([
    playlist({ cover_song_ids: ["local:a", "local:b"] }),
    playlist({ ...THEIRS, id: "p2", name: "Bobs mix", song_count: 1 }),
  ]);

  expect(await screen.findByRole("link", { name: /Party/ })).toHaveAttribute(
    "href",
    "/songs/playlists/p1",
  );
  expect(screen.getByText("2 songs")).toBeInTheDocument();
  // The owner of a list that is not the reader's is plain text, never a badge.
  expect(screen.getByText("1 song · by Bob")).toBeInTheDocument();
});

test("the four groups sort the playlists, and Hidden folds away", async () => {
  renderPlaylists([
    playlist(),
    playlist({ ...SHARED, id: "p2", name: "Bobs mix" }),
    playlist({ ...THEIRS, id: "p3", name: "House list" }),
    playlist({ ...UNFOLLOWED, id: "p4", name: "Old set" }),
  ]);

  await screen.findByRole("link", { name: /Party/ });
  for (const heading of ["Your playlists", "Shared with you", "Global"]) {
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
  }

  // The unfollowed one is behind a closed disclosure, not on the page.
  const hidden = screen.getByText("Hidden").closest("details");
  expect(hidden).not.toBeNull();
  expect(hidden).not.toHaveAttribute("open");
  expect(hidden).toContainElement(
    screen.getByRole("link", { name: /Old set/ }),
  );
});

test("a global list nobody unfollowed out of stays under Global", async () => {
  // Unfollowing cannot hide what everybody can see anyway, so a member row on a
  // global list drops it back into Global rather than into Hidden.
  renderPlaylists([
    playlist({ ...UNFOLLOWED, is_global: true, id: "p4", name: "House list" }),
  ]);

  await screen.findByRole("link", { name: /House list/ });
  expect(screen.getByRole("heading", { name: "Global" })).toBeInTheDocument();
  expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
});

test("with nothing to hide there is no Hidden group", async () => {
  renderPlaylists([playlist()]);

  await screen.findByRole("link", { name: /Party/ });
  expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
});

test("a row without songs falls back to the list glyph", async () => {
  const { container } = renderPlaylists([playlist({ cover_song_ids: [] })]);

  const row = await screen.findByRole("link", { name: /Party/ });
  expect(iconNames(row)).toEqual(["list", "chevron-right"]);
  expect(container.querySelectorAll("img")).toHaveLength(0);
});

test("a row with songs wears their covers", async () => {
  const { container } = renderPlaylists([
    playlist({ cover_song_ids: ["local:a", "local:b", "local:c"] }),
  ]);

  await screen.findByRole("link", { name: /Party/ });
  const covers = [...container.querySelectorAll("img")].map((img) =>
    img.getAttribute("src"),
  );
  expect(covers).toEqual([
    "/api/v1/songs/local%3Aa/cover",
    "/api/v1/songs/local%3Ab/cover",
    "/api/v1/songs/local%3Ac/cover",
  ]);
});

test("a globe marks the rows everybody can see", async () => {
  renderPlaylists([
    playlist(),
    playlist({ id: "p2", name: "House list", is_global: true }),
  ]);

  expect(
    iconNames(await screen.findByRole("link", { name: /Party/ })),
  ).not.toContain("globe");
  expect(iconNames(screen.getByRole("link", { name: /House list/ }))).toContain(
    "globe",
  );
});

test("no row carries an edit or a delete control any more", async () => {
  // Managing a list lives behind the detail page's gear, so a row is a way in
  // and nothing else.
  renderPlaylists([playlist()]);

  await screen.findByRole("link", { name: /Party/ });
  expect(
    screen.queryByRole("button", { name: /Edit Party/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Delete playlist/ }),
  ).not.toBeInTheDocument();
});

test("the header's plus opens the panel and lands in what it creates", async () => {
  createPlaylist.mockResolvedValue({
    data: playlist({ id: "p9", name: "Ballads", song_count: 0 }),
  });
  renderPlaylists([playlist()]);

  fireEvent.click(await screen.findByRole("button", { name: "New playlist" }));
  expect(
    screen.getByRole("dialog", { name: "New playlist" }),
  ).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "  Ballads  " },
  });
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "The slow ones" },
  });
  fireEvent.click(screen.getByLabelText(/Global/));
  fireEvent.click(screen.getByRole("button", { name: "Create" }));

  await waitFor(() =>
    expect(createPlaylist.mock.calls[0][0].body).toEqual({
      name: "Ballads",
      description: "The slow ones",
      is_global: true,
    }),
  );
  expect(await screen.findByText("at /songs/playlists/p9")).toBeInTheDocument();
});

test("the panel can be left without a request", async () => {
  renderPlaylists([playlist()]);

  fireEvent.click(await screen.findByRole("button", { name: "New playlist" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  expect(
    screen.queryByRole("dialog", { name: "New playlist" }),
  ).not.toBeInTheDocument();
  expect(createPlaylist).not.toHaveBeenCalled();
});

test("an empty page invites the reader to make the first playlist", async () => {
  renderPlaylists([]);

  await screen.findByRole("heading", { name: "No playlists yet" });
  // The header's plus and the empty state's button, in that document order.
  const ways = screen.getAllByRole("button", { name: "New playlist" });
  expect(ways).toHaveLength(2);

  fireEvent.click(ways[1]);
  expect(
    screen.getByRole("dialog", { name: "New playlist" }),
  ).toBeInTheDocument();
});

test("a refused create says which capability is missing", async () => {
  // What a 403 from the backend looks like once the generated client has
  // parsed it: the page has to name the capability, not swallow the refusal.
  createPlaylist.mockRejectedValue({
    detail: "missing_permission:playlists.manage",
  });
  renderPlaylists([]);

  fireEvent.click(
    (await screen.findAllByRole("button", { name: "New playlist" }))[0],
  );
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Party" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));

  // Inside the panel: a notice on the page behind the backdrop is a notice
  // nobody reads, and the panel stays open with the name still in it.
  const panel = within(screen.getByRole("dialog", { name: "New playlist" }));
  expect(await panel.findByRole("alert")).toHaveTextContent(
    "You may not do this (playlists.manage)",
  );
});

test("a guest sees the global lists and no way to make one", async () => {
  renderPlaylists([playlist(THEIRS)], ["playlists.view"], {
    user: null,
    ...AS.guest,
  });

  await screen.findByRole("link", { name: /Party/ });
  expect(screen.getByRole("heading", { name: "Global" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "New playlist" }),
  ).not.toBeInTheDocument();
});

test("a guest with nothing to see is not invited to create one", async () => {
  renderPlaylists([], ["playlists.view"], { user: null, ...AS.guest });

  await screen.findByRole("heading", { name: "No playlists yet" });
  expect(
    screen.queryByRole("button", { name: "New playlist" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/Playlists shared with everybody/),
  ).toBeInTheDocument();
});

test("a reader without playlists.view is told who may look", async () => {
  renderPlaylists([], ["songs.view"], { user: null, ...AS.guest });

  expect(
    await screen.findByText(/Playlists are not open to you\./),
  ).toBeInTheDocument();
  expect(listPlaylists).not.toHaveBeenCalled();
});

test("a failing request says so", async () => {
  renderPlaylists(new Error("boom"));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load the playlists.",
  );
});

test("somebody else sharing a list refreshes the page", async () => {
  renderPlaylists([playlist()]);
  await screen.findByRole("link", { name: /Party/ });
  expect(listPlaylists).toHaveBeenCalledTimes(1);

  listPlaylists.mockResolvedValue({
    data: { playlists: [playlist(), playlist({ ...SHARED, id: "p2" })] },
  });
  FakeSocket.deliver({ event: "playlists.changed", playlist_id: "p2" });

  await waitFor(() => expect(listPlaylists).toHaveBeenCalledTimes(2));
});
