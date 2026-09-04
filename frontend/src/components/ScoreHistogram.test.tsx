import { fireEvent, render, screen } from "@testing-library/react";
import type { ScoreWithContext, SongRead } from "../api";
import ScoreHistogram from "./ScoreHistogram";

const bohemian: SongRead = {
  id: "usdb:1",
  artist: "Queen",
  title: "Bohemian Rhapsody",
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
