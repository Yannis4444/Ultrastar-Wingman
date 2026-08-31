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

test("an unnamed strip keeps the number and drops the singer", () => {
  // One singer's own record: their name on their own best says nothing.
  render(
    <ScoreStrip
      scores={[score("Alice", 9000), score("Alice", 4000)]}
      label="All scores"
      named={false}
    />,
  );

  expect(screen.getByText("9000")).toBeInTheDocument();
  expect(screen.queryByText("9000 · Alice")).not.toBeInTheDocument();
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

test("a near-miss tap answers with the nearest dot; a far one dismisses", () => {
  // A fingertip covers ~40px and a dot 6px: the SVG resolves the tap.
  const { container } = render(
    <ScoreStrip
      scores={[score("Alice", 9000), score("Bob", 2000)]}
      label="All scores"
    />,
  );
  const svg = container.querySelector("svg") as SVGSVGElement;
  // jsdom lays nothing out, so the SVG's rect is (0,0) and the click's client
  // coordinates are chart coordinates. At the 340px fallback width the 9000
  // dot sits at x = 8 + 0.9 × 324 ≈ 300, on the base line y ≈ 87.
  fireEvent.click(svg, { clientX: 310, clientY: 100 });
  expect(document.querySelector(".chart-tip")).toHaveTextContent("Alice");

  // The same near-miss again toggles the tip away, like a tap on the dot.
  fireEvent.click(svg, { clientX: 310, clientY: 100 });
  expect(document.querySelector(".chart-tip")).toBeNull();

  // Far from every dot the tap means "put it away", not the closest anyway.
  fireEvent.click(svg, { clientX: 310, clientY: 100 });
  fireEvent.click(svg, { clientX: 150, clientY: 20 });
  expect(document.querySelector(".chart-tip")).toBeNull();
});

test("the click's own pointerType is never trusted — the pointerdown's is", () => {
  // WebKit stamps a tap's synthesized click "mouse"; the pointerdown before
  // it says "touch" truthfully on every engine. A tap must show the tip even
  // when its click lies, and a real mouse click must stay inert (hover owns
  // the mouse tip).
  const { container } = render(
    <ScoreStrip scores={[score("Alice", 9000)]} label="All scores" />,
  );
  const svg = container.querySelector("svg") as SVGSVGElement;
  const target = screen.getByTestId("strip-dot")
    .nextElementSibling as SVGCircleElement;
  // jsdom has no PointerEvent and drops `pointerType` from fireEvent's
  // options — a plain event with the field assigned carries it through.
  const pointerDown = (pointerType: string) =>
    fireEvent(
      svg,
      Object.assign(new Event("pointerdown", { bubbles: true }), {
        pointerType,
      }),
    );

  pointerDown("touch");
  fireEvent.click(target);
  expect(document.querySelector(".chart-tip")).toHaveTextContent("Alice");

  pointerDown("touch");
  fireEvent.click(target);
  expect(document.querySelector(".chart-tip")).toBeNull();

  pointerDown("mouse");
  fireEvent.click(target);
  expect(document.querySelector(".chart-tip")).toBeNull();
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

test("the dot rings are painted for the ground the strip is given", () => {
  const { rerender } = render(
    <ScoreStrip
      scores={[score("Alice", 9000), score("Bob", 4000)]}
      label="All scores"
    />,
  );

  // A card's strip: the ring is the tile it sits on.
  for (const dot of screen.getAllByTestId("strip-dot"))
    expect(dot).toHaveAttribute("stroke", chartTheme.surface);

  rerender(
    <ScoreStrip
      scores={[score("Alice", 9000), score("Bob", 4000)]}
      label="All scores"
      surface={chartTheme.pageBg}
    />,
  );

  // Flat on the page — the song modal — and the ring follows it.
  for (const dot of screen.getAllByTestId("strip-dot"))
    expect(dot).toHaveAttribute("stroke", chartTheme.pageBg);
});

test("nothing to draw, nothing drawn", () => {
  const { container } = render(<ScoreStrip scores={[]} label="All scores" />);
  expect(container).toBeEmptyDOMElement();
});
