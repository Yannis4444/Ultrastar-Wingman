import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import type { ScoreWithContext, SongRead } from "../api";
import { iconNames } from "../test/icons";
import ScoreSummary from "./ScoreSummary";

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
  singId = `sing-${songRead.id}`,
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

/** The row as `[glyph, value, word]` triples, in the order it prints them. */
function stats(container: HTMLElement): (string | null)[][] {
  return [...container.querySelectorAll(".score-summary-stat")].map((stat) => [
    iconNames(stat)[0] ?? null,
    stat.querySelector(".icon-stat-value")?.textContent ?? null,
    stat.querySelector(".icon-stat-label")?.textContent ?? null,
  ]);
}

const evening = [
  score("Alice", 9000, wonderwall),
  score("Bob", 6000, wonderwall),
  score("Alice", 8000, bohemian),
];

test("five stats in one order, every one of them behind its own word", () => {
  const { container } = render(<ScoreSummary scores={evening} songs />);

  // What was sung before how well it went, and the three score numbers
  // reading down from the best.
  expect(stats(container)).toEqual([
    ["hash", "2", "Sings"],
    ["music", "2", "Songs"],
    // `arrow-up`, never `trophy`: the cup belongs to the song modal's strip.
    ["arrow-up", "9000", "Best"],
    ["average", "7667", "Average"],
    ["arrow-down", "6000", "Worst"],
  ]);
});

test("one duet run is one sing, not two", () => {
  const duet = [
    score("Alice", 9000, wonderwall, "sing-duet"),
    score("Bob", 6000, wonderwall, "sing-duet"),
  ];
  const { container } = render(<ScoreSummary scores={duet} songs />);

  expect(stats(container)[0]).toEqual(["hash", "1", "Sings"]);
});

test("where every score is the same song, the Songs stat is left out", () => {
  const { container } = render(<ScoreSummary scores={evening} />);

  expect(stats(container).map((stat) => stat[2])).toEqual([
    "Sings",
    "Best",
    "Average",
    "Worst",
  ]);
});

test("named, the peaks carry the singer who holds them", () => {
  const { container } = render(<ScoreSummary scores={evening} named />);

  expect(stats(container).map((stat) => stat[2])).toEqual([
    "Sings",
    "Best · Alice",
    "Average",
    "Worst · Bob",
  ]);
});

test("unnamed by default: a page of the reader's own scores says one name once", () => {
  const { container } = render(<ScoreSummary scores={evening} songs />);

  expect(container.textContent).not.toContain("Alice");
});

test("nothing at all without a score to add up", () => {
  const { container } = render(<ScoreSummary scores={[]} songs named />);

  // Not five zeroes: the surface says why in its own words, if at all.
  expect(container.querySelector(".score-summary")).toBeNull();
});
