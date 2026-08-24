import type { ScoreWithContext, SessionRead, SongRead } from "./api";
import { parseServerTime } from "./duration";
import {
  buildBoxplotOption,
  buildHistogramOption,
  difficultyLabel,
  groupScores,
  histogram,
  sessionLabel,
  songLabel,
  summarize,
} from "./stats";

function song(id: string, artist: string, title: string): SongRead {
  return {
    id,
    artist,
    title,
    duration_seconds: null,
    has_video: false,
    language: null,
    genre: null,
    year: null,
    edition: null,
    creator: null,
    source: "usdb",
  };
}

let nextId = 1;

function score(
  playerName: string,
  value: number,
  songRead: SongRead | null,
  overrides: Partial<ScoreWithContext> = {},
): ScoreWithContext {
  return {
    id: nextId++,
    sing_id: `sing-${songRead?.id ?? "gone"}`,
    player_id: null,
    player_name: playerName,
    score: value,
    difficulty: 2,
    recorded_at: "2026-08-23T20:00:00Z",
    song: songRead,
    sing_started_at: "2026-08-23T19:55:00Z",
    ...overrides,
  };
}

const bohemian = song("usdb:1", "Queen", "Bohemian Rhapsody");
const wonderwall = song("usdb:2", "Oasis", "Wonderwall");

/** Alice is the better singer; Bob only ever gets close on one song. */
const scores = [
  score("Alice", 8000, bohemian),
  score("Alice", 9000, wonderwall),
  score("Bob", 4000, bohemian),
  score("Bob", 6000, wonderwall),
];

function axisLabels(option: ReturnType<typeof buildBoxplotOption>): unknown {
  return (option.yAxis as { data: string[] }).data;
}

test("a session shows its own name, and its start time when it has none", () => {
  const base: SessionRead = {
    id: "s1",
    name: null,
    started_at: "2026-08-23T18:00:00Z",
    last_activity_at: "2026-08-23T23:00:00Z",
    sing_count: 4,
    score_count: 6,
  };
  expect(sessionLabel({ ...base, name: "Yannis' birthday" })).toBe(
    "Yannis' birthday",
  );
  // Node's locale decides the format, so the expectation is built the same way.
  // The time keeps two nameless parties on the same day apart.
  const started = new Date(parseServerTime(base.started_at));
  const label = `Session ${started.toLocaleDateString()}, ${started.toLocaleTimeString(
    [],
    { hour: "2-digit", minute: "2-digit" },
  )}`;
  expect(sessionLabel(base)).toBe(label);
  // The backend accepts an empty name; it must not read as a nameless session.
  expect(sessionLabel({ ...base, name: "" })).toBe(label);
});

test("a score whose song left the library still has a label", () => {
  expect(songLabel(scores[0])).toBe("Queen – Bohemian Rhapsody");
  expect(songLabel(score("Alice", 1000, null))).toBe("Unknown song");
});

test("difficulty is named, not a raw USDX number", () => {
  expect(difficultyLabel(0)).toBe("Easy");
  expect(difficultyLabel(2)).toBe("Hard");
  expect(difficultyLabel(null)).toBe("—");
  expect(difficultyLabel(9)).toBe("—");
});

test("groups are strongest median first, with their scores best first", () => {
  const groups = groupScores(scores, "player");

  expect(groups.map((group) => group.label)).toEqual(["Alice", "Bob"]);
  expect(groups[0].scores.map((entry) => entry.score)).toEqual([9000, 8000]);
  expect(groups[0]).toMatchObject({
    best: 9000,
    worst: 8000,
    median: 8500,
    average: 8500,
  });
  expect(groups[0].quartiles).toEqual([8000, 8250, 8500, 8750, 9000]);
});

test("singers who share a display name are kept apart by their player id", () => {
  const groups = groupScores(
    [
      score("Chris", 9000, bohemian, { player_id: "player-a" }),
      score("Chris", 1000, wonderwall, { player_id: "player-b" }),
    ],
    "player",
  );

  expect(groups).toHaveLength(2);
  expect(groups.map((group) => group.best)).toEqual([9000, 1000]);
});

test("grouping by song puts the strongest song on top and labels it", () => {
  const groups = groupScores(scores, "song");

  expect(groups.map((group) => group.label)).toEqual([
    "Oasis – Wonderwall",
    "Queen – Bohemian Rhapsody",
  ]);
  expect(groups[0].songId).toBe("usdb:2");
});

test("the grouping decides the boxplot's categories and boxes", () => {
  const byPlayer = buildBoxplotOption(scores, "player");
  const bySong = buildBoxplotOption(scores, "song");

  expect(axisLabels(byPlayer)).toEqual(["Alice", "Bob"]);
  expect(axisLabels(bySong)).toEqual([
    "Oasis – Wonderwall",
    "Queen – Bohemian Rhapsody",
  ]);

  // Strongest first, and the axis is inverted so that row draws at the top.
  expect((bySong.yAxis as { inverse: boolean }).inverse).toBe(true);
  const boxes = (bySong.series as { data: number[][] }[])[0].data;
  expect(boxes[0]).toEqual([6000, 6750, 7500, 8250, 9000]);
});

test("groups of single scores get bars on an adaptive axis, not boxplots", () => {
  const option = buildBoxplotOption([score("Alice", 30, bohemian)], "player");

  // A boxplot of one score is a hairline; a fixed 0–10000 axis makes it 1px.
  expect((option.series as { type: string }[])[0].type).toBe("bar");
  expect((option.xAxis as { min: number; max: number }).min).toBe(0);
  expect((option.xAxis as { min: number; max: number }).max).toBe(500);
});

test("the score axis keeps the full range once scores pass 40% of perfect", () => {
  const option = buildBoxplotOption(scores, "player");

  expect((option.series as { type: string }[])[0].type).toBe("boxplot");
  expect((option.xAxis as { max: number }).max).toBe(10000);
});

test("histogram buckets cover the whole score range, 10000 included", () => {
  const buckets = histogram([
    score("Alice", 0, bohemian),
    score("Alice", 499, bohemian),
    score("Alice", 9999, bohemian),
    score("Alice", 10000, bohemian),
  ]);

  expect(buckets).toHaveLength(20);
  expect(buckets[0]).toBe(2);
  expect(buckets[19]).toBe(2);
  expect(buckets.reduce((sum, count) => sum + count, 0)).toBe(4);
});

test("the histogram option carries one bar per bucket and a labelled range", () => {
  const option = buildHistogramOption([score("Alice", 5000, bohemian)]);

  expect((option.series as { data: number[] }[])[0].data[10]).toBe(1);
  expect((option.xAxis as { data: string[] }).data[10]).toBe("5000 – 5500");
});

test("the summary counts distinct songs and singers and finds the top score", () => {
  const summary = summarize([...scores, score("Alice", 9500, null)]);

  // Two known songs plus the one that left the library.
  expect(summary).toMatchObject({ songs: 3, singers: 2 });
  expect(summary.top?.score).toBe(9500);
  expect(summary.top?.player_name).toBe("Alice");
});

test("an empty session summarizes to nothing rather than crashing", () => {
  expect(summarize([])).toEqual({ songs: 0, singers: 0, top: null });
  expect(groupScores([], "player")).toEqual([]);
  expect(axisLabels(buildBoxplotOption([], "player"))).toEqual([]);
});
