import { fireEvent, render, screen, within } from "@testing-library/react";
import { GUEST, TRUSTED_GROUP_ID, USER } from "../groups";
import { iconNames } from "../test/icons";
import GroupCapabilities, { NOT_HELD, THROUGH_USER } from "./GroupCapabilities";

const CATALOGUE = [
  "songs.view",
  "karaoke.stop",
  "playlists.manage",
  "users.view",
  "users.manage",
  "permissions.manage",
  "achievements.manage",
];

function renderList({
  groupId = TRUSTED_GROUP_ID,
  groupName = "Trusted",
  own = [] as string[],
  // What the group holds as stored: the draft itself unless a test says not.
  stored = undefined as string[] | undefined,
  inherited = [] as string[],
  isAdmin = true,
  held = [] as string[],
  onToggle = vi.fn(),
} = {}) {
  render(
    <GroupCapabilities
      groupId={groupId}
      groupName={groupName}
      catalogue={CATALOGUE}
      own={new Set(own)}
      stored={new Set(stored ?? own)}
      inherited={new Set(inherited)}
      isAdmin={isAdmin}
      held={new Set(held)}
      onToggle={onToggle}
    />,
  );
  return onToggle;
}

test("the catalogue is grouped into areas, one box per capability, no head", () => {
  renderList();

  // Sorted by area, each heading carrying its glyph.
  expect(
    screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
  ).toEqual([
    "achievements",
    "karaoke",
    "permissions",
    "playlists",
    "songs",
    "users",
  ]);
  expect(
    iconNames(screen.getByRole("heading", { name: "permissions" })),
  ).toEqual(["shield"]);
  // One column: exactly one box per capability, and no column head at all.
  expect(screen.getAllByRole("checkbox")).toHaveLength(CATALOGUE.length);
  expect(document.querySelector(".perm-head")).toBeNull();
  // The three sentences that changed with groups.
  expect(
    screen.getByText("See who has an account and which groups they are in."),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      "Make groups, rename them, say what each one may do, and delete them.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Put accounts in groups and take them out/),
  ).toBeInTheDocument();
});

test("a box User already gives is ticked and locked, with its reason", () => {
  renderList({ inherited: ["songs.view"], own: ["karaoke.stop"] });

  const box = screen.getByLabelText("songs.view for Trusted");
  expect(box).toBeChecked();
  expect(box).toBeDisabled();
  expect(box).toHaveAttribute("title", THROUGH_USER);
  // The reason is read out, not only hovered.
  expect(box).toHaveAccessibleDescription(
    expect.stringContaining(THROUGH_USER),
  );
  expect(screen.getByLabelText("karaoke.stop for Trusted")).toBeEnabled();
});

test("an own row that User also holds stays a live tick", () => {
  const onToggle = renderList({
    inherited: ["songs.view"],
    own: ["songs.view"],
  });

  const box = screen.getByLabelText("songs.view for Trusted");
  expect(box).toBeChecked();
  expect(box).toBeEnabled();
  fireEvent.click(box);
  expect(onToggle).toHaveBeenCalledWith("songs.view", false);
});

test("Guest cannot be given a playlist of its own, unless it already has it", () => {
  renderList({ groupId: GUEST, groupName: "Guest" });

  const box = screen.getByLabelText("playlists.manage for Guest");
  expect(box).toBeDisabled();
  expect(box.getAttribute("title")).toMatch(/A playlist belongs to an account/);
});

test("a reader who is no administrator hands out only what they hold", () => {
  const onToggle = renderList({
    groupId: USER,
    groupName: "User",
    isAdmin: false,
    held: ["songs.view"],
    own: ["users.manage"],
  });

  // Not held and off: refused, with rule 2's sentence.
  const permissions = screen.getByLabelText("permissions.manage for User");
  expect(permissions).toBeDisabled();
  expect(permissions).toHaveAttribute("title", NOT_HELD);
  // Held: free to hand out.
  expect(screen.getByLabelText("songs.view for User")).toBeEnabled();
  // Not held but already on: taking away is free.
  const users = screen.getByLabelText("users.manage for User");
  expect(users).toBeEnabled();
  fireEvent.click(users);
  expect(onToggle).toHaveBeenCalledWith("users.manage", false);
});

test("a stored row a helper unticked may be ticked again: putting it back is no change", () => {
  const onToggle = renderList({
    groupId: USER,
    groupName: "User",
    isAdmin: false,
    held: [],
    own: [],
    stored: ["users.manage"],
  });

  const users = screen.getByLabelText("users.manage for User");
  expect(users).not.toBeChecked();
  expect(users).toBeEnabled();
  fireEvent.click(users);
  expect(onToggle).toHaveBeenCalledWith("users.manage", true);
  // A right the group never had stays out of reach.
  expect(screen.getByLabelText("permissions.manage for User")).toBeDisabled();
});

test("an administrator may hand out anything", () => {
  renderList({ isAdmin: true, held: [] });

  for (const box of within(document.body).getAllByRole("checkbox"))
    expect(box).toBeEnabled();
});
