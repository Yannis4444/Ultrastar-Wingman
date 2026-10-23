import { render, screen } from "@testing-library/react";
import type { ScoreWithContext, SongRead } from "../api";
import { chartTheme } from "../chartTheme";
import EveningTimeline from "./EveningTimeline";

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

function score(
  playerName: string,
  value: number,
  recordedAt = "2026-08-23T20:00:00Z",
): ScoreWithContext {
  return {
    id: nextId++,
    sing_id: `sing-${nextId}`,
    player_id: `player-${playerName}`,
    player_name: playerName,
    score: value,
    difficulty: 2,
    placement: null,
    field_size: null,
    recorded_at: recordedAt,
    song: bohemian,
    sing_started_at: recordedAt,
  };
}

/** Seven singers, strongest first — two more than the palette holds. */
function sevenSingers(): ScoreWithContext[] {
  return ["Ada", "Ben", "Cleo", "Dan", "Eve", "Finn", "Gus"].map(
    (name, index) => score(name, 9000 - index * 500),
  );
}

test("the five best singers wear the hues; the rest fold into one grey", () => {
  render(<EveningTimeline scores={sevenSingers()} label="The evening" />);

  const legend = document.querySelector(".timeline-legend") as HTMLElement;
  for (const name of ["Ada", "Ben", "Cleo", "Dan", "Eve"]) {
    expect(legend).toHaveTextContent(name);
  }
  // Finn and Gus are not named — they are the folded tail.
  expect(legend).not.toHaveTextContent("Finn");
  expect(legend).toHaveTextContent("2 more");

  const dots = screen.getAllByTestId("timeline-dot");
  expect(dots[0]).toHaveAttribute("fill", chartTheme.categorical[0]);
  expect(dots[5]).toHaveAttribute("fill", chartTheme.categoricalRest);
  expect(dots[6]).toHaveAttribute("fill", chartTheme.categoricalRest);
});

test("five singers or fewer need no folded tail", () => {
  render(
    <EveningTimeline
      scores={[score("Ada", 9000), score("Ben", 7000)]}
      label="The evening"
    />,
  );

  const legend = document.querySelector(".timeline-legend") as HTMLElement;
  expect(legend).not.toHaveTextContent("more");
});

test("the session's best score wears a gold ring and its number", () => {
  render(
    <EveningTimeline
      scores={[score("Ada", 9000), score("Ben", 7000)]}
      label="The evening"
    />,
  );

  const ring = [...document.querySelectorAll("circle")].find(
    (circle) => circle.getAttribute("stroke") === chartTheme.gold,
  );
  expect(ring).toBeDefined();
  expect(ring).toHaveAttribute("fill", "none");
  expect(screen.getByText("9000")).toBeInTheDocument();
});

test("a duet's dots share their moment on the clock", () => {
  render(
    <EveningTimeline
      scores={[
        score("Ada", 9000, "2026-08-23T21:12:00Z"),
        score("Ben", 7000, "2026-08-23T21:12:00Z"),
        score("Cleo", 5000, "2026-08-23T22:40:00Z"),
      ]}
      label="The evening"
    />,
  );

  const [ada, ben, cleo] = screen.getAllByTestId("timeline-dot");
  expect(ada.getAttribute("cx")).toBe(ben.getAttribute("cx"));
  expect(ada.getAttribute("cx")).not.toBe(cleo.getAttribute("cx"));
});

test("the whole drawing is announced as one image", () => {
  render(<EveningTimeline scores={sevenSingers()} label="The evening" />);
  expect(screen.getByRole("img", { name: "The evening" })).toBeInTheDocument();
});

test("the dot rings are painted for the page the timeline sits on", () => {
  render(<EveningTimeline scores={sevenSingers()} label="The evening" />);
  for (const dot of screen.getAllByTestId("timeline-dot"))
    expect(dot).toHaveAttribute("stroke", chartTheme.pageBg);
});
