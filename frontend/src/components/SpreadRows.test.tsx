import { fireEvent, render, screen } from "@testing-library/react";
import type { ScoreWithContext, SongRead } from "../api";
import { chartTheme } from "../chartTheme";
import { groupScores } from "../stats";
import SpreadRows from "./SpreadRows";

function song(id: string, artist: string, title: string): SongRead {
  return {
    id,
    artist,
    title,
    duration_seconds: null,
    has_video: false,
    is_duet: false,
    language: null,
    genre: null,
    year: null,
    edition: null,
    creator: null,
    source: "usdb",
  };
}

const bohemian = song("usdb:1", "Queen", "Bohemian Rhapsody");

let nextId = 1;

function score(
  playerName: string,
  value: number,
  songRead: SongRead = bohemian,
): ScoreWithContext {
  return {
    id: nextId++,
    sing_id: `sing-${nextId}`,
    player_id: null,
    player_name: playerName,
    score: value,
    difficulty: 2,
    recorded_at: "2026-08-23T20:00:00Z",
    song: songRead,
    sing_started_at: "2026-08-23T19:55:00Z",
  };
}

/** One singer's worth of scores, `count` of them around `around`. */
function series(
  name: string,
  count: number,
  around: number,
): ScoreWithContext[] {
  return Array.from({ length: count }, (_, index) =>
    score(name, around + index * 50),
  );
}

test("a singer with enough scores gets a box, the raw scores on top", () => {
  const groups = groupScores(series("Alice", 6, 8000), "player");
  render(<SpreadRows groups={groups} grouping="player" label="Spread" />);

  expect(screen.getByTestId("spread-box")).toBeInTheDocument();
  const dots = screen.getAllByTestId("spread-dot");
  expect(dots).toHaveLength(6);
  // The raw scores are the neutral grey layer, never a second accent.
  for (const dot of dots) {
    expect(dot).toHaveAttribute("fill", chartTheme.dot);
  }
});

test("below five scores there is no box — just the scores themselves", () => {
  const groups = groupScores(series("Bob", 4, 6000), "player");
  render(<SpreadRows groups={groups} grouping="player" label="Spread" />);

  expect(screen.queryByTestId("spread-box")).not.toBeInTheDocument();
  const dots = screen.getAllByTestId("spread-dot");
  expect(dots).toHaveLength(4);
  for (const dot of dots) {
    expect(dot).toHaveAttribute("fill", chartTheme.accent);
  }
});

test("a song row wears its singers' initials while the scores are few", () => {
  const groups = groupScores(
    [score("Alice", 9000), score("Bob", 7000), score("Mia", 5000)],
    "song",
  );
  render(<SpreadRows groups={groups} grouping="song" label="Spread" />);

  expect(screen.getAllByTestId("spread-chip")).toHaveLength(3);
  expect(screen.queryByTestId("spread-box")).not.toBeInTheDocument();
  for (const initial of ["A", "B", "M"]) {
    expect(screen.getByText(initial)).toBeInTheDocument();
  }
});

test("from eight scores up the initials retire; the row stays a swarm, never a box", () => {
  const groups = groupScores(series("Alice", 8, 7000), "song");
  render(<SpreadRows groups={groups} grouping="song" label="Spread" />);

  expect(screen.queryByTestId("spread-chip")).not.toBeInTheDocument();
  expect(screen.queryByTestId("spread-box")).not.toBeInTheDocument();
  expect(screen.getAllByTestId("spread-dot")).toHaveLength(8);
});

test("the own-history view turns initials off — every chip would say the same letter", () => {
  const groups = groupScores(
    [score("Alice", 9000), score("Alice", 7000)],
    "song",
  );
  render(
    <SpreadRows
      groups={groups}
      grouping="song"
      label="Spread"
      initials={false}
    />,
  );

  expect(screen.queryByTestId("spread-chip")).not.toBeInTheDocument();
  expect(screen.getAllByTestId("spread-dot")).toHaveLength(2);
});

test("two near-identical scores stand beside each other, not on each other", () => {
  const groups = groupScores(
    [score("Alice", 8400), score("Bob", 8404)],
    "song",
  );
  render(<SpreadRows groups={groups} grouping="song" label="Spread" />);

  const [first, second] = screen.getAllByTestId("spread-chip");
  expect(first.getAttribute("cy")).not.toBe(second.getAttribute("cy"));
});

test("the card draws eight groups and owns up to the rest", () => {
  const groups = groupScores(
    Array.from({ length: 10 }, (_, index) =>
      score(`Singer${index}`, 9000 - index * 100),
    ),
    "player",
  );
  render(<SpreadRows groups={groups} grouping="player" label="Spread" />);

  expect(document.querySelectorAll(".spread-row")).toHaveLength(8);
  expect(screen.getByText("… 2 more in the list below")).toBeInTheDocument();
});

test("a row is headed by its label, its count and the best the list ranks by", () => {
  const groups = groupScores(series("Alice", 5, 8000), "player");
  render(<SpreadRows groups={groups} grouping="player" label="Spread" />);

  const top = document.querySelector(".spread-row-top") as HTMLElement;
  expect(top).toHaveTextContent("Alice");
  expect(top).toHaveTextContent("× 5");
  expect(top.querySelector(".spread-row-best")).toHaveTextContent("8200");
});

test("a tap on a mark answers with singer, song and score; a second tap closes", () => {
  const groups = groupScores([score("Alice", 9000)], "song");
  render(<SpreadRows groups={groups} grouping="song" label="Spread" />);

  const chip = screen.getByTestId("spread-chip");
  fireEvent.click(chip);
  const tipped = document.querySelector(".chart-tip") as HTMLElement;
  expect(tipped).toHaveTextContent("Alice");
  expect(tipped).toHaveTextContent("Queen – Bohemian Rhapsody");
  expect(tipped).toHaveTextContent("9000");

  fireEvent.click(chip);
  expect(document.querySelector(".chart-tip")).toBeNull();
});

test("a tap beside the marks dismisses the tip", () => {
  const groups = groupScores([score("Alice", 9000)], "song");
  render(<SpreadRows groups={groups} grouping="song" label="Spread" />);

  fireEvent.click(screen.getByTestId("spread-chip"));
  expect(document.querySelector(".chart-tip")).not.toBeNull();

  fireEvent.click(screen.getByRole("img", { name: "Spread" }));
  expect(document.querySelector(".chart-tip")).toBeNull();
});
