import { fireEvent, render, screen } from "@testing-library/react";
import type { ScoreWithContext, SongRead } from "../api";
import { chartTheme } from "../chartTheme";
import ScoreHistogram from "./ScoreHistogram";

const bohemian: SongRead = {
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

let nextId = 1;

function score(value: number): ScoreWithContext {
  return {
    id: nextId++,
    sing_id: `sing-${nextId}`,
    player_id: null,
    player_name: "Alice",
    score: value,
    difficulty: 2,
    placement: null,
    field_size: null,
    recorded_at: "2026-08-23T20:00:00Z",
    song: bohemian,
    sing_started_at: "2026-08-23T19:55:00Z",
  };
}

test("twenty buckets, sized by their counts, between the two anchors", () => {
  render(
    <ScoreHistogram
      scores={[score(5100), score(5200), score(9900)]}
      height={96}
      label="Score distribution"
    />,
  );

  const bars = screen.getAllByTestId("histogram-bar");
  expect(bars).toHaveLength(20);
  const heights = bars.map((bar) => Number(bar.getAttribute("height")));
  // Bucket 10 (5000–5500) holds two scores, bucket 19 one, the rest nothing.
  expect(heights[10]).toBeGreaterThan(heights[19]);
  expect(heights[19]).toBeGreaterThan(0);
  expect(heights.filter((height) => height === 0)).toHaveLength(18);
  // The ends anchor the scale; twenty range labels never fit a phone.
  expect(screen.getByText("0")).toBeInTheDocument();
  expect(screen.getByText("10000")).toBeInTheDocument();
});

test("a column answers with its range and count — the empty ones too", () => {
  render(
    <ScoreHistogram
      scores={[score(5100)]}
      height={96}
      label="Score distribution"
    />,
  );

  // The hit column is the bar's transparent sibling, full height.
  const column = screen.getAllByTestId("histogram-bar")[10]
    .nextElementSibling as SVGRectElement;
  fireEvent.click(column);

  const tip = document.querySelector(".chart-tip") as HTMLElement;
  expect(tip).toHaveTextContent("5000 to 5500");
  expect(tip).toHaveTextContent("1 score");
});

test("the drawing is announced as one image", () => {
  render(<ScoreHistogram scores={[score(5100)]} height={96} label="Shape" />);
  expect(screen.getByRole("img", { name: "Shape" })).toBeInTheDocument();
});

test("bare, every bar is the accent and no line runs through them", () => {
  render(
    <ScoreHistogram
      scores={[score(5100), score(9900)]}
      height={96}
      label="Shape"
    />,
  );
  const fills = screen
    .getAllByTestId("histogram-bar")
    .map((bar) => bar.getAttribute("fill"));
  expect(new Set(fills)).toEqual(new Set([chartTheme.accent]));
  expect(
    document.querySelectorAll("[data-testid^=histogram-mark]"),
  ).toHaveLength(0);
});

test("the ends are labelled at every chart's 11px", () => {
  render(<ScoreHistogram scores={[score(5100)]} height={96} label="Shape" />);
  expect(screen.getByText("0")).toHaveAttribute("font-size", "11");
  expect(screen.getByText("10000")).toHaveAttribute("font-size", "11");
});

test("the best's bucket is gold, and its tip says whose best it is", () => {
  render(
    <ScoreHistogram
      scores={[score(4100), score(6900), score(8662)]}
      height={96}
      label="Shape"
      best={{ score: 8662, holder: "Alice" }}
    />,
  );
  const bars = screen.getAllByTestId("histogram-bar");
  // 8662 is bucket 17 (8500–9000), and only that one wears the gold.
  expect(bars[17]).toHaveAttribute("fill", chartTheme.gold);
  expect(
    bars.filter((bar) => bar.getAttribute("fill") === chartTheme.gold),
  ).toHaveLength(1);

  fireEvent.click(bars[17].nextElementSibling as SVGRectElement);
  const tip = document.querySelector(".chart-tip") as HTMLElement;
  expect(tip).toHaveTextContent("8500 to 9000");
  expect(tip).toHaveTextContent("Best 8662 · Alice");
});

test("unnamed, the best bucket's tip names nobody", () => {
  render(
    <ScoreHistogram
      scores={[score(4100), score(8662)]}
      height={96}
      label="Shape"
      best={{ score: 8662 }}
    />,
  );
  fireEvent.click(
    screen.getAllByTestId("histogram-bar")[17]
      .nextElementSibling as SVGRectElement,
  );
  const tip = document.querySelector(".chart-tip") as HTMLElement;
  expect(tip.textContent).toContain("Best 8662");
  expect(tip.textContent).not.toContain("·");
});

test("the marks run through the bars at their score, gold painted last", () => {
  render(
    <ScoreHistogram
      scores={[score(4120), score(6890), score(8662)]}
      height={96}
      label="Shape"
      // Handed over in reading order; painted worst, average, best.
      marks={[
        { kind: "best", score: 8662 },
        { kind: "average", score: 6890 },
        { kind: "worst", score: 4120 },
      ]}
    />,
  );
  const lines = [
    ...document.querySelectorAll<SVGLineElement>(
      "[data-testid^=histogram-mark]",
    ),
  ];
  expect(lines.map((line) => line.dataset.testid)).toEqual([
    "histogram-mark-worst",
    "histogram-mark-average",
    "histogram-mark-best",
  ]);
  const [worst, average, best] = lines;
  // jsdom lays nothing out, so the drawing is the 340px fallback: the bars'
  // own mapping puts 8662 at 294.5px, inside bucket 17 (289–306).
  expect(Number(best.getAttribute("x1"))).toBeCloseTo(294.508);
  expect(best).toHaveAttribute("stroke", chartTheme.gold);
  expect(best).not.toHaveAttribute("stroke-dasharray");
  expect(average).toHaveAttribute("stroke", chartTheme.axis);
  expect(average).toHaveAttribute("stroke-dasharray", "3 3");
  expect(worst).toHaveAttribute("stroke", chartTheme.dot);
  // From the top of the drawing to the axis, and never in the way of a tap.
  expect(best).toHaveAttribute("y1", "0");
  expect(best).toHaveAttribute("y2", "82");
  for (const line of lines)
    expect(line).toHaveAttribute("pointer-events", "none");
});
