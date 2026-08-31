import { asPlayer, avatarUrl } from "./avatars";

test("an unversioned avatar keeps the bare URL", () => {
  expect(avatarUrl("p1")).toBe("/api/v1/players/p1/avatar");
  expect(avatarUrl("p1", null)).toBe("/api/v1/players/p1/avatar");
});

test("a version busts the browser's cached copy", () => {
  expect(avatarUrl("p1", 3)).toBe("/api/v1/players/p1/avatar?v=3");
  // A player id is somebody's name in the old databases, not always a uuid.
  expect(avatarUrl("Anna & Bob", 3)).toBe(
    "/api/v1/players/Anna%20%26%20Bob/avatar?v=3",
  );
});

test("a known version is carried into the avatar's URL", () => {
  expect(asPlayer("alice", "p1", 4)).toEqual({
    id: "p1",
    name: "alice",
    registered: true,
    // A stand-in is never in the singer picker, so it is never hidden from it.
    hidden: false,
    has_avatar: true,
    avatar_version: 4,
  });
});

test("a null version says there is no picture at all", () => {
  // The row draws the initial instead of asking for a file the backend 404s.
  expect(asPlayer("alice", "p1", null).has_avatar).toBe(false);
});

test("an unknown version asks for the picture anyway", () => {
  // A member row carries no version, so the endpoint's own 404 is the fallback.
  const member = asPlayer("alice", "p1");
  expect(member.has_avatar).toBe(true);
  expect(member.avatar_version).toBeNull();
});

test("somebody without a player has no picture, versioned or not", () => {
  expect(asPlayer("alice", null).has_avatar).toBe(false);
  expect(asPlayer("alice", null, 4).has_avatar).toBe(false);
  // And nothing to ask the avatar endpoint for.
  expect(asPlayer("alice", null).id).toBe("");
});
