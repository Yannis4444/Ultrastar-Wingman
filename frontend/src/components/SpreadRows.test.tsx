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
    created_at: "2026-01-01T12:00:00Z",
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
    placement: null,
    field_size: null,
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

/** The marks' fills, best score first. */
function fills(marks: HTMLElement[]): (string | null)[] {
  return marks
    .map((mark) => ({
      fill: mark.getAttribute("fill"),
      x: Number(mark.getAttribute("cx")),
    }))
    .sort((a, b) => b.x - a.x)
    .map(({ fill }) => fill);
}

test("a singer with enough scores gets a box, the raw scores on top", () => {
  const groups = groupScores(series("Alice", 6, 8000), "player");
  render(<SpreadRows groups={groups} grouping="player" label="Spread" />);

  expect(screen.getByTestId("spread-box")).toBeInTheDocument();
  const dots = screen.getAllByTestId("spread-dot");
  expect(dots).toHaveLength(6);
  // The raw scores are the neutral grey layer, never a second accent — but
  // for the party's best, the one gold mark of every chart.
  expect(fills(dots)).toEqual([
    chartTheme.gold,
    ...Array<string>(5).fill(chartTheme.dot),
  ]);
});

test("below five scores there is no box — just the scores themselves", () => {
  const groups = groupScores(series("Bob", 4, 6000), "player");
  render(<SpreadRows groups={groups} grouping="player" label="Spread" />);

  expect(screen.queryByTestId("spread-box")).not.toBeInTheDocument();
  const dots = screen.getAllByTestId("spread-dot");
  expect(dots).toHaveLength(4);
  // Grey like every raw score — blue is the box's alone — the best in gold.
  expect(fills(dots)).toEqual([
    chartTheme.gold,
    ...Array<string>(3).fill(chartTheme.dot),
  ]);
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

test("a row is its name and count, its track, and the best the list ranks by", () => {
  const groups = groupScores(series("Alice", 5, 8000), "player");
  render(<SpreadRows groups={groups} grouping="player" label="Spread" />);

  const row = document.querySelector(".spread-row") as HTMLElement;
  const [name, track, best] = [...row.children];
  expect(name).toHaveClass("spread-row-label");
  expect(name).toHaveTextContent("Alice ×5");
  expect(name.querySelector(".spread-row-count")).toHaveTextContent("×5");
  expect(track.tagName.toLowerCase()).toBe("svg");
  expect(track).toHaveAttribute("height", "32");
  // The right-hand column: the group's best, in the score gold.
  expect(best).toHaveClass("spread-row-best");
  expect(best).toHaveTextContent("8200");
});

test("a song row is named by its title alone, the whole label on hover", () => {
  const groups = groupScores([score("Alice", 9000)], "song");
  render(<SpreadRows groups={groups} grouping="song" label="Spread" />);

  const name = document.querySelector(".spread-row-label") as HTMLElement;
  expect(name.textContent).toBe("Bohemian Rhapsody");
  expect(name).toHaveAttribute("title", "Queen – Bohemian Rhapsody: 1 score");
});

test("the gridlines and the axis are drawn once, under every row", () => {
  const groups = groupScores(
    Array.from({ length: 6 }, (_, index) =>
      score(`Singer${index}`, 9000 - index * 100),
    ),
    "player",
  );
  render(<SpreadRows groups={groups} grouping="player" label="Spread" />);

  expect(document.querySelectorAll(".spread-row")).toHaveLength(6);
  // Five ticks, five lines — not five per row.
  expect(screen.getAllByTestId("spread-grid")).toHaveLength(5);
  const grid = document.querySelector(".spread-rows-grid") as SVGElement;
  expect(grid.closest(".spread-row")).toBeNull();
  // One set of tick labels, after the last row.
  const labels = [...document.querySelectorAll("svg text")].map(
    (text) => text.textContent,
  );
  expect(labels).toEqual(["0", "2.5k", "5k", "7.5k", "10k"]);
  const axis = document.querySelector(".spread-rows-axis") as SVGElement;
  const rows = document.querySelectorAll(".spread-row");
  expect(
    rows[rows.length - 1].compareDocumentPosition(axis) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test("a row grows only as far as its near-ties have to stack", () => {
  const groups = groupScores(
    [
      score("Alice", 8400, song("usdb:2", "Oasis", "Wonderwall")),
      score("Bob", 8404, song("usdb:2", "Oasis", "Wonderwall")),
      score("Alice", 3000),
    ],
    "song",
  );
  render(<SpreadRows groups={groups} grouping="song" label="Spread" />);

  const [tied, alone] = [...document.querySelectorAll(".spread-row svg")];
  expect(Number(tied.getAttribute("height"))).toBeGreaterThan(32);
  expect(alone).toHaveAttribute("height", "32");
});

test("the party's best is the one gold chip, its initial in the page's ink", () => {
  const groups = groupScores(
    [score("Alice", 9000), score("Bob", 7000)],
    "song",
  );
  render(<SpreadRows groups={groups} grouping="song" label="Spread" />);

  expect(fills(screen.getAllByTestId("spread-chip"))).toEqual([
    chartTheme.gold,
    chartTheme.chip,
  ]);
  expect(screen.getByText("A")).toHaveAttribute("fill", chartTheme.pageBg);
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
