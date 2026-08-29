import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MeRead, TagRead } from "../api";
import { meResponse, userRead } from "../test/auth";
import { FakeSocket } from "../test/fakeSocket";
import { iconNames } from "../test/icons";
import Tags from "./Tags";

const { getMe, listTags, listTagAssignments } = vi.hoisted(() => ({
  getMe: vi.fn(),
  listTags: vi.fn(),
  listTagAssignments: vi.fn(),
}));

vi.mock("../api/sdk.gen", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/sdk.gen")>()),
  getMe,
  listTags,
  listTagAssignments,
}));

const MANAGER = ["songs.view", "tags.manage"];
const ACCOUNT: Partial<MeRead> = { user: userRead(), role: "trusted" };

function tag(overrides: Partial<TagRead> = {}): TagRead {
  return {
    id: "t-broken",
    name: "broken",
    icon: "alert",
    color: "gold",
    show_in_list: true,
    hide_by_default: true,
    can_assign: true,
    permissions: [],
    ...overrides,
  };
}

function renderTags(
  tags: TagRead[] | Error = [tag()],
  assignments: { tag_id: string; song_ids: string[] }[] = [],
  capabilities = MANAGER,
) {
  getMe.mockResolvedValue(meResponse(capabilities, ACCOUNT));
  listTags.mockImplementation(async () => {
    if (tags instanceof Error) throw tags;
    return { data: { tags } };
  });
  listTagAssignments.mockResolvedValue({ data: { assignments } });
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
  for (const mock of [getMe, listTags, listTagAssignments]) mock.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

it("keeps the page from a role that may not manage tags", async () => {
  renderTags([tag()], [], ["songs.view"]);

  expect(
    await screen.findByText(/Tags are set up by trusted accounts/),
  ).toBeInTheDocument();
  expect(listTags).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("New tag")).not.toBeInTheDocument();
});

it("names the songs a tag carries and the flags that are on", async () => {
  renderTags(
    [
      tag(),
      tag({
        id: "t-archive",
        name: "archive",
        icon: "archive",
        color: "neutral",
        show_in_list: false,
        hide_by_default: true,
      }),
      tag({
        id: "t-duet",
        name: "duet",
        icon: null,
        color: "blue",
        show_in_list: true,
        hide_by_default: false,
      }),
    ],
    [
      { tag_id: "t-broken", song_ids: ["s1", "s2", "s3"] },
      { tag_id: "t-archive", song_ids: ["s4"] },
    ],
  );

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
  renderTags([tag()], [{ tag_id: "t-broken", song_ids: ["s1"] }]);

  await screen.findByText(/1 song/);
  listTagAssignments.mockResolvedValue({
    data: { assignments: [{ tag_id: "t-broken", song_ids: ["s1", "s2"] }] },
  });
  FakeSocket.deliver({
    event: "song_tags.changed",
    song_id: "s2",
    tag_id: "t-broken",
  });

  await waitFor(() => expect(screen.getByText(/2 songs/)).toBeInTheDocument());
});
