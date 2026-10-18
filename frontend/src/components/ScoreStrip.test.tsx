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
    placement: null,
    field_size: null,
    recorded_at: "2026-08-23T20:00:00Z",
    song: bohemian,
    sing_started_at: "2026-08-23T19:55:00Z",
  };
}

/** The line over the strip, as one string. */
function figures(): string | null {
  return document.querySelector(".score-strip-figures")?.textContent ?? null;
}

/** The SVG's drawn height, which follows how far the dots stack. */
function stripHeight(container: HTMLElement): number {
  return Number(container.querySelector("svg")?.getAttribute("height"));
}

test("every score is a dot, grey but for the session's best in gold", () => {
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
  expect(
    dots.filter((dot) => dot.getAttribute("fill") === chartTheme.dot),
  ).toHaveLength(2);
});

test("median and best stand over the strip as text, the best named", () => {
  render(
    <ScoreStrip
      scores={[score("Alice", 9000), score("Bob", 4000), score("Mia", 7000)]}
      label="All scores"
    />,
  );

  expect(figures()).toBe("Median 7000 · Best 9000 Alice");
  const line = document.querySelector(".score-strip-figures") as HTMLElement;
  expect(line.querySelector(".score-strip-best")).toHaveTextContent("9000");
  // Words a screen reader reads: outside the drawing, which is an image.
  expect(line.closest("[role='img']")).toBeNull();
  // Nothing of it is drawn into the SVG any more.
  expect(document.querySelector("svg text")?.textContent).not.toMatch(
    /median|9000/,
  );
});

test("an unnamed strip keeps the best's number and drops the singer", () => {
  // One singer's own record: their name on their own best says nothing.
  render(
    <ScoreStrip
      scores={[score("Alice", 9000), score("Alice", 4000)]}
      label="All scores"
      named={false}
    />,
  );

  expect(figures()).toBe("Median 6500 · Best 9000");
});

test("under a summary that prints the best, the line keeps the median alone", () => {
  render(
    <ScoreStrip
      scores={[score("Alice", 9000), score("Bob", 4000), score("Mia", 7000)]}
      label="All scores"
      showBest={false}
    />,
  );

  expect(figures()).toBe("Median 7000");
  // The gold dot stays: the drawing still marks the best.
  expect(
    screen
      .getAllByTestId("strip-dot")
      .filter((dot) => dot.getAttribute("fill") === chartTheme.gold),
  ).toHaveLength(1);
});

test("a shared best goes to whoever got there first, as in the summary", () => {
  const late = {
    ...score("Bob", 9000),
    recorded_at: "2026-08-23T21:00:00Z",
  };
  const early = score("Alice", 9000);
  render(<ScoreStrip scores={[late, early]} label="All scores" />);

  expect(figures()).toBe("Median 9000 · Best 9000 Alice");
});

test("an even count interpolates the median, as the groups do", () => {
  render(
    <ScoreStrip
      scores={[score("Alice", 8000), score("Bob", 7000)]}
      label="All scores"
    />,
  );

  expect(figures()).toMatch(/^Median 7500 /);
});

test("the median is one dashed line through the band", () => {
  render(
    <ScoreStrip
      scores={[score("Alice", 9000), score("Bob", 4000)]}
      label="All scores"
    />,
  );

  expect(screen.getByTestId("strip-median")).toHaveAttribute(
    "stroke-dasharray",
    "3 4",
  );
});

test("the strip is as high as its dots stack, and no higher", () => {
  // Far apart, one line of dots: the band's floor of 40, plus the axis.
  const { container, rerender } = render(
    <ScoreStrip
      scores={[score("Alice", 9000), score("Bob", 2000)]}
      label="All scores"
    />,
  );
  expect(stripHeight(container)).toBe(60);
  // The gridlines stop at the band; the axis is under it.
  for (const line of screen.getAllByTestId("strip-grid"))
    expect(line).toHaveAttribute("y2", "40");

  // Five near-ties pile up two steps above and below: the band grows.
  rerender(
    <ScoreStrip
      scores={[8400, 8401, 8402, 8403, 8404].map((value) =>
        score("Alice", value),
      )}
      label="All scores"
    />,
  );
  const piled = stripHeight(container);
  expect(piled).toBeGreaterThan(60);
  // Every dot inside the band, none on the axis.
  const band = piled - 20;
  for (const dot of screen.getAllByTestId("strip-dot")) {
    const cy = Number(dot.getAttribute("cy"));
    expect(cy - 5).toBeGreaterThanOrEqual(0);
    expect(cy + 5).toBeLessThanOrEqual(band);
  }
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
  // A fingertip covers ~40px and a dot 7px: the SVG resolves the tap.
  const { container } = render(
    <ScoreStrip
      scores={[score("Alice", 9000), score("Bob", 2000)]}
      label="All scores"
    />,
  );
  const svg = container.querySelector("svg") as SVGSVGElement;
  // jsdom lays nothing out, so the SVG's rect is (0,0) and the click's client
  // coordinates are chart coordinates. At the 340px fallback width the 9000
  // dot sits at x = 6 + 0.9 × 328 ≈ 301, in the middle of the 40px band.
  fireEvent.click(svg, { clientX: 310, clientY: 30 });
  expect(document.querySelector(".chart-tip")).toHaveTextContent("Alice");

  // The same near-miss again toggles the tip away, like a tap on the dot.
  fireEvent.click(svg, { clientX: 310, clientY: 30 });
  expect(document.querySelector(".chart-tip")).toBeNull();

  // Far from every dot the tap means "put it away", not the closest anyway.
  fireEvent.click(svg, { clientX: 310, clientY: 30 });
  fireEvent.click(svg, { clientX: 180, clientY: 20 });
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

  // Every chart sits flat on the page now, so that is the default ground.
  for (const dot of screen.getAllByTestId("strip-dot"))
    expect(dot).toHaveAttribute("stroke", chartTheme.pageBg);

  rerender(
    <ScoreStrip
      scores={[score("Alice", 9000), score("Bob", 4000)]}
      label="All scores"
      surface="#123456"
    />,
  );

  // Another ground, and the ring follows it.
  for (const dot of screen.getAllByTestId("strip-dot"))
    expect(dot).toHaveAttribute("stroke", "#123456");
});

test("nothing to draw, nothing drawn", () => {
  const { container } = render(<ScoreStrip scores={[]} label="All scores" />);
  expect(container).toBeEmptyDOMElement();
});
