import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { BuiltInTagRead, MeRead, TagRead } from "../api";
import { AS, meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import { builtInTagRead, builtInTagReads, tagRead } from "../test/tags";
import Tags from "./Tags";

const { getMe, listTags } = vi.hoisted(() => ({
  getMe: vi.fn(),
  listTags: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listTags,
}));

const MANAGER = ["songs.view", "tags.manage"];
const ACCOUNT: Partial<MeRead> = { user: userRead(), ...AS.trusted };

function tag(overrides: Partial<TagRead> = {}): TagRead {
  return tagRead({
    id: "t-broken",
    name: "broken",
    icon: "alert",
    color: "gold",
    show_in_list: true,
    hide_by_default: true,
    permissions: [],
    ...overrides,
  });
}

function renderTags(
  tags: TagRead[] | Error = [tag()],
  capabilities = MANAGER,
  builtIns: BuiltInTagRead[] = builtInTagReads(),
) {
  getMe.mockResolvedValue(meResponse(capabilities, ACCOUNT));
  listTags.mockImplementation(async () => {
    if (tags instanceof Error) throw tags;
    return { data: { tags, built_ins: builtIns } };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/user/tags"]}>
        <Tags />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  FakeSocket.last = undefined;
  vi.stubGlobal("WebSocket", FakeSocket);
  for (const mock of [getMe, listTags]) mock.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

it("keeps the page from a role that may not manage tags", async () => {
  renderTags([tag()], ["songs.view"]);

  expect(
    await screen.findByText(/Tags are set up by trusted accounts/),
  ).toBeInTheDocument();
  expect(listTags).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("New tag")).not.toBeInTheDocument();
});

it("names the songs a tag carries and the flags that are on", async () => {
  renderTags([
    tag({ song_count: 3 }),
    tag({
      id: "t-archive",
      name: "archive",
      icon: "archive",
      color: "neutral",
      show_in_list: false,
      hide_by_default: true,
      song_count: 1,
    }),
    tag({
      id: "t-duet",
      name: "duet",
      icon: null,
      color: "blue",
      show_in_list: true,
      hide_by_default: false,
    }),
  ]);

  const rows = await screen.findAllByRole("listitem");
  expect(
    within(rows[0]).getByText("3 songs · hidden by default · shown in list"),
  ).toBeInTheDocument();
  expect(
    within(rows[1]).getByText("1 song · hidden by default"),
  ).toBeInTheDocument();
  // Nothing tagged with it yet, and only the one flag on.
  expect(
    within(rows[2]).getByText("0 songs · shown in list"),
  ).toBeInTheDocument();
});

it("says the count first, then only the flags that are on", async () => {
  renderTags([
    tag({
      id: "t-duet",
      name: "duet",
      song_count: 4,
      show_in_list: true,
      hide_by_default: false,
    }),
    tag({
      id: "t-deutsch",
      name: "deutsch",
      song_count: 12,
      show_in_list: false,
      hide_by_default: true,
    }),
    tag({
      id: "t-nineties",
      name: "nineties",
      song_count: 1,
      show_in_list: false,
      hide_by_default: false,
    }),
  ]);

  const rows = await screen.findAllByRole("listitem");
  await waitFor(() =>
    expect(
      within(rows[0]).getByText("4 songs · shown in list"),
    ).toBeInTheDocument(),
  );
  expect(
    within(rows[1]).getByText("12 songs · hidden by default"),
  ).toBeInTheDocument();
  // Nothing unusual about it at all: the count is the whole line.
  expect(within(rows[2]).getByText("1 song")).toBeInTheDocument();
});

it("draws each tag in its own colour, falling back to the tag glyph", async () => {
  const { container } = renderTags([
    tag(),
    tag({ id: "t-plain", name: "plain", icon: null, color: "pink" }),
  ]);

  await screen.findByText("broken");
  const squares = container.querySelectorAll(".tags-square");
  expect(squares[0]).toHaveClass("tag-color-gold");
  expect(iconNames(squares[0])).toEqual(["alert"]);
  expect(squares[1]).toHaveClass("tag-color-pink");
  // An icon-less tag wears the feature's own glyph (ui-guidelines section 3).
  expect(iconNames(squares[1])).toEqual(["tag"]);
});

it("leads each row into the editor and the header into a new tag", async () => {
  renderTags();

  expect(await screen.findByRole("link", { name: /broken/ })).toHaveAttribute(
    "href",
    "/user/tags/t-broken",
  );
  expect(screen.getByLabelText("New tag")).toHaveAttribute(
    "href",
    "/user/tags/new",
  );
});

it("invites the first tag when there is none", async () => {
  renderTags([]);

  expect(await screen.findByText("No tags yet")).toBeInTheDocument();
});

it("says so when the tags cannot be loaded", async () => {
  renderTags(new Error("nope"));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load the tags.",
  );
});

it("reloads the list when somebody else changes a tag", async () => {
  renderTags();

  await screen.findByText("broken");
  listTags.mockResolvedValue({ data: { tags: [tag({ name: "cursed" })] } });
  FakeSocket.deliver({ event: "tags.changed" });

  expect(await screen.findByText("cursed")).toBeInTheDocument();
});

it("counts the songs again when one is tagged", async () => {
  // The count is `GET /tags`' own field — every song carrying the tag, the ones
  // this manager may not see included.
  renderTags([tag({ song_count: 1 })]);

  await screen.findByText(/1 song/);
  listTags.mockImplementation(async () => ({
    data: { tags: [tag({ song_count: 2 })] },
  }));
  FakeSocket.deliver({
    event: "song_tags.changed",
    song_id: "s2",
    tag_id: "t-broken",
  });

  await waitFor(() => expect(screen.getByText(/2 songs/)).toBeInTheDocument());
});

/** The rows of the *Built-in* list, in the order they are drawn. */
function builtInRows(container: HTMLElement): HTMLAnchorElement[] {
  const lists = container.querySelectorAll(".tags-list");
  return [
    ...lists[lists.length - 1].querySelectorAll<HTMLAnchorElement>(
      ".tags-open",
    ),
  ];
}

it("lists all eight built-ins under their own heading, in §7's order", async () => {
  const { container } = renderTags();

  expect(
    await screen.findByRole("heading", { name: "Built-in" }),
  ).toBeInTheDocument();
  const rows = builtInRows(container);
  expect(
    rows.map((row) => row.querySelector(".tags-name")?.textContent),
  ).toEqual([
    "Favorites",
    "Sung",
    "Duet",
    "Video",
    "Genre",
    "Language",
    "Edition",
    "Decade",
  ]);
  // Each opens the editor on its own reserved id.
  expect(rows.map((row) => row.getAttribute("href"))).toEqual([
    "/user/tags/favorites",
    "/user/tags/sung",
    "/user/tags/duet",
    "/user/tags/video",
    "/user/tags/genre",
    "/user/tags/language",
    "/user/tags/edition",
    "/user/tags/decade",
  ]);
  expect(
    rows.map((row) => iconNames(row.querySelector(".tags-square")!)[0]),
  ).toEqual([
    "heart",
    "mic",
    "users",
    "video",
    "music",
    "flag",
    "disc",
    "calendar",
  ]);
  // Recent is a mode, not a mark, so it has no row.
  expect(
    screen.queryByRole("link", { name: /Recent/ }),
  ).not.toBeInTheDocument();
});

it("leads a built-in's meta line with its kind and drops what is off", async () => {
  const { container } = renderTags();

  await screen.findByRole("heading", { name: "Built-in" });
  // The defaults: a mark is on the rows, a facet is off them and in the filter.
  expect(
    builtInRows(container).map(
      (row) => row.querySelector(".tags-meta")?.textContent,
    ),
  ).toEqual([
    "per person · shown in list",
    "per person · shown in list",
    "from the file · in filter",
    "from the file · in filter",
    "from the file · in filter",
    "from the file · in filter",
    "from the file · in filter",
    "from the file · in filter",
  ]);
  // Never a song count: a mark's is a different number for every reader, a
  // facet's is one number per value.
  expect(container.textContent).not.toContain("0 songs · per person");
});

it("says so when everything about a built-in is on, and when it is off", async () => {
  const { container } = renderTags(
    [tag()],
    MANAGER,
    builtInTagReads().map((row) => {
      if (row.id === "duet") return { ...row, show_in_list: true };
      if (row.id === "video") return { ...row, show_in_filter: false };
      if (row.id === "sung") return { ...row, show_in_list: false };
      if (row.id === "genre") return { ...row, show_in_filter: false };
      return row;
    }),
  );

  await screen.findByRole("heading", { name: "Built-in" });
  const meta = builtInRows(container).map(
    (row) => row.querySelector(".tags-meta")?.textContent,
  );
  expect(meta[1]).toBe("per person");
  expect(meta[2]).toBe("from the file · shown in list · in filter");
  expect(meta[3]).toBe("from the file");
  expect(meta[4]).toBe("from the file");
});

it("draws each built-in in its configured colour, a valued facet neutral", async () => {
  const { container } = renderTags([tag()], MANAGER, [
    builtInTagRead({ color: "gold" }),
    builtInTagRead({ id: "sung", color: "blue", show_in_list: false }),
  ]);

  const favorites = await screen.findByRole("link", { name: /Favorites/ });
  const sung = screen.getByRole("link", { name: /Sung/ });
  expect(favorites.querySelector(".tags-square")).toHaveClass("tag-color-gold");
  expect(sung.querySelector(".tags-square")).toHaveClass("tag-color-blue");
  expect(within(sung).getByText("per person")).toBeInTheDocument();
  // A valued facet has no colour to set, so its square is the neutral one.
  expect(builtInRows(container)[4].querySelector(".tags-square")).toHaveClass(
    "tag-color-neutral",
  );
});

it("keeps the built-in rows when the party has no tags of its own", async () => {
  renderTags([]);

  expect(await screen.findByText("No tags yet")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Favorites/ })).toBeInTheDocument();
});
