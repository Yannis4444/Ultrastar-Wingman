import { fireEvent, render } from "@testing-library/react";
import type { PlayerRead } from "../api";
import PlayerAvatar from "./PlayerAvatar";

function player(overrides: Partial<PlayerRead> = {}): PlayerRead {
  return {
    id: "player-alice",
    name: "alice",
    registered: true,
    hidden: false,
    has_avatar: true,
    avatar_version: 1,
    ...overrides,
  };
}

it("draws the picture at its versioned address", () => {
  const { container } = render(<PlayerAvatar player={player()} />);

  expect(container.querySelector("img")).toHaveAttribute(
    "src",
    "/api/v1/players/player-alice/avatar?v=1",
  );
});

it("draws the initial for somebody without a picture, and asks for none", () => {
  const { container } = render(
    <PlayerAvatar
      player={player({ has_avatar: false, avatar_version: null })}
    />,
  );

  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector(".player-avatar-letter")).toHaveTextContent(
    "A",
  );
});

it("falls back to the initial when the picture cannot be shown", () => {
  // A file gone from the disk is a 404, and one the browser cannot decode is an
  // error too: the TV must show the initial, never a broken-image icon.
  const { container } = render(<PlayerAvatar player={player()} />);

  fireEvent.error(container.querySelector("img")!);

  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector(".player-avatar-letter")).toHaveTextContent(
    "A",
  );
});

it("tries again once the picture has a new version", () => {
  const { container, rerender } = render(<PlayerAvatar player={player()} />);
  fireEvent.error(container.querySelector("img")!);

  rerender(<PlayerAvatar player={player({ avatar_version: 2 })} />);

  expect(container.querySelector("img")).toHaveAttribute(
    "src",
    "/api/v1/players/player-alice/avatar?v=2",
  );
});

it("draws the empty square for a slot nobody is on", () => {
  const { container } = render(<PlayerAvatar player={null} />);

  expect(container.querySelector(".player-avatar-empty")).not.toBeNull();
  expect(container.querySelector("img")).toBeNull();
});
