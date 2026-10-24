import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { ScoreWithContext, SongRead } from "../api";
import ScoreOverview from "./ScoreOverview";

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
const wonderwall = song("usdb:2", "Oasis", "Wonderwall");

let nextId = 1;

function score(
  playerName: string,
  value: number,
  songRead: SongRead,
  singId = `sing-${nextId}`,
): ScoreWithContext {
  return {
    id: nextId++,
    sing_id: singId,
    player_id: null,
    player_name: playerName,
    score: value,
    difficulty: 1,
    placement: null,
    field_size: null,
    recorded_at: "2026-08-23T20:00:00Z",
    song: songRead,
    sing_started_at: "2026-08-23T19:55:00Z",
  };
}

/** Three scores: under the chart's threshold. */
const three = () => [
  score("Alice", 9000, wonderwall),
  score("Bob", 6000, wonderwall),
  score("Alice", 8000, bohemian),
];

/** Four: the fewest that are drawn. */
const four = () => [...three(), score("Bob", 4120, bohemian)];

const head = (container: HTMLElement) =>
  container.querySelector(".score-overview-counts")?.textContent;

const line = (container: HTMLElement) =>
  container.querySelector(".score-overview-line")?.textContent;

/** The band's labels in DOM order, each as its own text. */
const labels = (container: HTMLElement) =>
  [...container.querySelectorAll(".score-overview-mark")].map(
    (mark) => mark.textContent,
  );

test("under four scores the numbers are one line under the head line", () => {
  const { container } = render(
    <ScoreOverview scores={three()} songs label="Shape" />,
  );

  expect(head(container)).toBe("3 sings · 2 songs");
  expect(line(container)).toBe("Best 9000 · Average 7667 · Worst 6000");
  // No chart: two dots have no spread, a few bars across twenty buckets are
  // noise.
  expect(screen.queryByRole("img")).toBeNull();
  expect(container.querySelector(".score-overview-band")).toBeNull();
});

test("from four scores the numbers are marks on the histogram", () => {
  const { container } = render(
    <ScoreOverview scores={four()} songs label="Shape" />,
  );

  const plot = screen.getByRole("img", { name: "Shape" });
  expect(line(container)).toBeUndefined();
  // Reading order, Best first — a screen reader reads them as one line.
  expect(labels(container)).toEqual([
    "Best 9000",
    "Average 6780",
    "Worst 4120",
  ]);
  // Outside the drawing's image, so they are read and not swallowed by it.
  for (const mark of container.querySelectorAll(".score-overview-mark"))
    expect(plot.contains(mark)).toBe(false);
  // One line per number through the bars, the best's bucket gold.
  expect(plot.querySelectorAll("[data-testid^=histogram-mark]")).toHaveLength(
    3,
  );
  expect(
    within(plot)
      .getAllByTestId("histogram-bar")
      .filter((bar) => bar.getAttribute("fill") === "#faa636"),
  ).toHaveLength(1);
});

test("the labels never overlap at the fallback width", () => {
  // Close peaks: three lines a few pixels apart still get a slot each.
  const close = [
    score("Alice", 8300, bohemian),
    score("Bob", 8100, bohemian),
    score("Chris", 8000, bohemian),
    score("Dora", 7900, bohemian),
  ];
  const { container } = render(<ScoreOverview scores={close} label="Shape" />);

  const slots = [
    ...container.querySelectorAll<HTMLElement>(".score-overview-mark"),
  ].map((mark) => ({
    left: parseFloat(mark.style.left),
    width: parseFloat(mark.style.width),
  }));
  expect(slots).toHaveLength(3);
  const ascending = [...slots].sort((a, b) => a.left - b.left);
  for (let index = 1; index < ascending.length; index++) {
    const before = ascending[index - 1];
    expect(before.left + before.width).toBeLessThanOrEqual(
      ascending[index].left + 1e-9,
    );
  }
  // Worst is the leftmost line, so its slot is the leftmost slot.
  const [best, , worst] = slots;
  expect(worst.left).toBeLessThan(best.left);
});

test("named, the band grows a line for the holders of Best and Worst", () => {
  const { container } = render(
    <ScoreOverview scores={four()} named label="Shape" />,
  );

  expect(container.querySelector(".score-overview-band-named")).not.toBeNull();
  expect(labels(container)).toEqual([
    "Best 9000Alice",
    "Average 6780",
    "Worst 4120Bob",
  ]);
});

test("named, the line form puts the holder after its number", () => {
  const { container } = render(
    <ScoreOverview scores={three()} named label="Shape" />,
  );

  expect(line(container)).toBe(
    "Best 9000 Alice · Average 7667 · Worst 6000 Bob",
  );
});

test("unnamed, nobody is named", () => {
  const { container } = render(<ScoreOverview scores={four()} label="Shape" />);

  expect(container.textContent).not.toContain("Alice");
  expect(container.querySelector(".score-overview-band-named")).toBeNull();
});

test("the action stands at the head line's far end", () => {
  const { container } = render(
    <ScoreOverview
      scores={four()}
      songs
      label="Shape"
      action={<button type="button">Share stats</button>}
    />,
  );

  const headLine = container.querySelector(
    ".score-overview-head",
  ) as HTMLElement;
  expect(headLine).toHaveClass("score-overview-head-action");
  expect(
    within(headLine).getByRole("button", { name: "Share stats" }),
  ).toBeInTheDocument();
  expect(headLine.lastElementChild).toHaveTextContent("Share stats");
});

test("no action, no 40px head line", () => {
  const { container } = render(
    <ScoreOverview scores={four()} label="Shape" action={false} />,
  );

  expect(container.querySelector(".score-overview-head")).not.toHaveClass(
    "score-overview-head-action",
  );
  expect(screen.queryByRole("button")).toBeNull();
});

test("without songs the head line counts the sings alone", () => {
  // A song group, or the song modal: "1 song" on every row says nothing.
  const duet = [
    score("Alice", 9000, wonderwall, "sing-duet"),
    score("Bob", 6000, wonderwall, "sing-duet"),
  ];
  const { container } = render(<ScoreOverview scores={duet} label="Shape" />);

  // One duet run is one sing, and the word follows the count.
  expect(head(container)).toBe("1 sing");
});

test("every score the same number is one Best, in both forms", () => {
  const equal = (count: number) =>
    Array.from({ length: count }, () => score("Alice", 7300, bohemian));

  const lined = render(<ScoreOverview scores={equal(3)} label="Shape" />);
  expect(line(lined.container)).toBe("Best 7300");
  lined.unmount();

  const { container } = render(
    <ScoreOverview scores={equal(5)} label="Shape" />,
  );
  expect(labels(container)).toEqual(["Best 7300"]);
  expect(
    container.querySelectorAll("[data-testid^=histogram-mark]"),
  ).toHaveLength(1);
  expect(
    container.querySelector("[data-testid=histogram-mark-best]"),
  ).not.toBeNull();
});

test("chart={false} keeps the line at any count", () => {
  const many = [...four(), ...four(), ...four()];
  const { container } = render(
    <ScoreOverview scores={many} named chart={false} label="Shape" />,
  );

  expect(screen.queryByRole("img")).toBeNull();
  expect(line(container)).toMatch(
    /^Best 9000 Alice · Average \d+ · Worst 4120 Bob$/,
  );
});

test("nothing at all without a score to add up", () => {
  const { container } = render(
    <ScoreOverview scores={[]} songs named label="Shape" />,
  );

  expect(container.querySelector(".score-overview")).toBeNull();
});
