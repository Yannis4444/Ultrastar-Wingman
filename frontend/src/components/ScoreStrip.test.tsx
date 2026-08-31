import { fireEvent, render, screen } from "@testing-library/react";
import type { ScoreWithContext, SongRead } from "../api";
import { chartTheme } from "../chartTheme";
import { shortDate } from "../duration";
import ScoreStrip from "./ScoreStrip";

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

function score(playerName: string, value: number): ScoreWithContext {
  return {
    id: nextId++,
    sing_id: `sing-${nextId}`,
    player_id: null,
    player_name: playerName,
    score: value,
    difficulty: 2,
    recorded_at: "2026-08-23T20:00:00Z",
    song: bohemian,
    sing_started_at: "2026-08-23T19:55:00Z",
  };
}

test("every score is a dot, and only the session's best is gold", () => {
  render(
    <ScoreStrip
      scores={[score("Alice", 9000), score("Bob", 4000), score("Mia", 7000)]}
      label="All scores"
    />,
  );

  const dots = screen.getAllByTestId("strip-dot");
  expect(dots).toHaveLength(3);
  expect(
    dots.filter((dot) => dot.getAttribute("fill") === chartTheme.gold),
  ).toHaveLength(1);
  // The gold dot is named: the number and who managed it.
  expect(screen.getByText("9000 · Alice")).toBeInTheDocument();
});

test("the session median stands as a labelled line", () => {
  render(
    <ScoreStrip
      scores={[score("Alice", 9000), score("Bob", 4000), score("Mia", 7000)]}
      label="All scores"
    />,
  );

  expect(screen.getByText("median 7000")).toBeInTheDocument();
});

test("an even count interpolates the median, as the groups do", () => {
  render(
    <ScoreStrip
      scores={[score("Alice", 8000), score("Bob", 7000)]}
      label="All scores"
    />,
  );

  expect(screen.getByText("median 7500")).toBeInTheDocument();
});

test("two near-identical scores stagger apart instead of overlapping", () => {
  render(
    <ScoreStrip
      scores={[score("Alice", 8400), score("Bob", 8404)]}
      label="All scores"
    />,
  );

  const [first, second] = screen.getAllByTestId("strip-dot");
  expect(first.getAttribute("cy")).not.toBe(second.getAttribute("cy"));
});

test("a strip that spans parties dates its tooltips", () => {
  render(
    <ScoreStrip scores={[score("Alice", 9000)]} label="All scores" dated />,
  );

  // The hit target is the dot's invisible, finger-sized sibling.
  const target = screen.getByTestId("strip-dot")
    .nextElementSibling as SVGCircleElement;
  fireEvent.click(target);

  const tip = document.querySelector(".chart-tip") as HTMLElement;
  expect(tip).toHaveTextContent("Alice");
  expect(tip).toHaveTextContent(shortDate("2026-08-23T20:00:00Z"));
});

test("nothing to draw, nothing drawn", () => {
  const { container } = render(<ScoreStrip scores={[]} label="All scores" />);
  expect(container).toBeEmptyDOMElement();
});
