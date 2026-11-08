import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { ScoreWithContext, SongRead } from "../api";
import { sessionLeaderboard, type LeaderboardOrder } from "../stats";
import SessionLeaderboard from "./SessionLeaderboard";

const SONG: SongRead = {
  id: "usdb:1",
  artist: "Queen",
  title: "Bohemian Rhapsody",
  duration_seconds: null,
  has_video: false,
  is_duet: false,
  created_at: "2026-01-01T12:00:00Z",
  language: null,
  genre: null,
  year: null,
  edition: null,
  creator: null,
  source: "usdb",
};

/** One score per singer, in its own sing, the first singer the strongest. */
function party(count: number): ScoreWithContext[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    sing_id: `sing-${index + 1}`,
    player_id: null,
    player_name: `Singer ${String(index + 1).padStart(2, "0")}`,
    score: 9900 - index * 100,
    difficulty: 1,
    placement: null,
    field_size: null,
    recorded_at: "2026-11-08T20:00:00Z",
    song: SONG,
    sing_started_at: "2026-11-08T19:55:00Z",
  }));
}

function renderBoard(count: number, order: LeaderboardOrder = "best") {
  const onOrder = vi.fn();
  render(
    <SessionLeaderboard
      entries={sessionLeaderboard(party(count), order)}
      order={order}
      onOrder={onOrder}
      players={new Map()}
    />,
  );
  return onOrder;
}

function list(): HTMLElement {
  return within(screen.getByLabelText("Party leaderboard")).getByRole("list");
}

function names(): string[] {
  return within(list())
    .getAllByRole("listitem")
    .map(
      (row) => row.querySelector(".host-leaderboard-name")?.textContent ?? "",
    );
}

test("a party of three ranks all three, strongest first", () => {
  renderBoard(3);

  expect(names()).toEqual(["Singer 01", "Singer 02", "Singer 03"]);
  expect(list()).not.toHaveClass("host-leaderboard-dense");
});

test.each([8, 15, 30])(
  "a party of %i ranks its five strongest, and every one of them is drawn",
  (count) => {
    // All five stay in the list whatever the TV's height: they are what the
    // rail shares its height out by, and the stylesheet — not this component —
    // wraps a row that does not fit whole out of sight. A component that drew
    // fewer would hand the wishes the difference and move them.
    renderBoard(count);

    expect(names()).toEqual([
      "Singer 01",
      "Singer 02",
      "Singer 03",
      "Singer 04",
      "Singer 05",
    ]);
    expect(list()).toHaveClass("host-leaderboard-list");
  },
);

test("five rows take the tighter treatment, four do not", () => {
  const { unmount } = render(
    <SessionLeaderboard
      entries={sessionLeaderboard(party(4), "best")}
      order="best"
      onOrder={() => {}}
      players={new Map()}
    />,
  );
  expect(list()).not.toHaveClass("host-leaderboard-dense");
  unmount();

  renderBoard(5);
  expect(list()).toHaveClass("host-leaderboard-dense");
});

test("the first three places carry the podium accent", () => {
  renderBoard(5);

  const ranks = within(list())
    .getAllByRole("listitem")
    .map((row) =>
      row
        .querySelector(".host-leaderboard-rank")
        ?.classList.contains("host-leaderboard-podium"),
    );
  expect(ranks).toEqual([true, true, true, false, false]);
});

test("ranked by sings, the value reads as a count", () => {
  renderBoard(2, "sings");

  const values = within(list())
    .getAllByRole("listitem")
    .map((row) => row.querySelector(".host-leaderboard-value")?.textContent);
  expect(values).toEqual(["1×", "1×"]);
});

test("the order pills hand the chosen order up", () => {
  const onOrder = renderBoard(3);

  fireEvent.click(screen.getByLabelText("average"));

  expect(onOrder).toHaveBeenCalledWith("average");
});
