import type { ScoreWithContext, SessionRead, SongRead } from "./api";
import { parseServerTime, shortDate } from "./duration";
import {
  allSessionsMeta,
  bestScoreOf,
  boxStats,
  bucketOf,
  difficultyLabel,
  evaluationLabel,
  groupScores,
  groupValue,
  histogram,
  isNewHighscore,
  isTucked,
  MARK_LABEL_SLOT,
  scoreMarkers,
  scoreOffset,
  scorePlayer,
  scorePlayerKey,
  scoreSummary,
  sessionLabel,
  sessionLeaderboard,
  sessionMeta,
  songHistory,
  songLabel,
  sortGroups,
  spreadMarkLabels,
  summarize,
  type MarkLabelSlot,
  type SongHistory,
} from "./stats";

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
    // Nothing in `stats.ts` reads them; a score old enough to carry neither is a
    // shape the API really answers with, so it is the honest filler here.
    placement: null,
    field_size: null,
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

test("a session shows its own name, and its start time when it has none", () => {
  const base: SessionRead = {
    id: "s1",
    name: null,
    started_at: "2026-08-23T18:00:00Z",
    last_activity_at: "2026-08-23T23:00:00Z",
    sing_count: 4,
    score_count: 6,
    singer_count: 3,
    hidden: false,
    current: false,
  };
  expect(sessionLabel({ ...base, name: "Yannis' birthday" })).toBe(
    "Yannis' birthday",
  );
  // Node's locale decides the format, so the expectation is built the same way.
  // The time keeps two nameless parties on the same day apart.
  const started = new Date(parseServerTime(base.started_at));
  const label = `Party ${started.toLocaleDateString()}, ${started.toLocaleTimeString(
    [],
    { hour: "2-digit", minute: "2-digit" },
  )}`;
  expect(sessionLabel(base)).toBe(label);
  // The backend accepts an empty name; it must not read as a nameless session.
  expect(sessionLabel({ ...base, name: "" })).toBe(label);
});

test("a party's picker line is when it was and how much happened at it", () => {
  const party: SessionRead = {
    id: "s1",
    name: "New Year",
    started_at: "2025-12-31T20:00:00Z",
    last_activity_at: "2026-01-01T03:00:00Z",
    sing_count: 30,
    score_count: 23,
    singer_count: 5,
    hidden: false,
    current: false,
  };

  // Node's locale decides the date's format, so the expectation borrows it.
  expect(sessionMeta(party)).toBe(
    `${shortDate(party.started_at)} · 5 singers · 23 scores`,
  );
  // Never a bare number, and never "1 singers".
  expect(sessionMeta({ ...party, singer_count: 1, score_count: 1 })).toBe(
    `${shortDate(party.started_at)} · 1 singer · 1 score`,
  );

  // The head row stands for every party this reader may open, so it is handed
  // the listing's own figures rather than a sum over the rows it drew: a party
  // kept out of the picker is still in what the head row opens.
  expect(allSessionsMeta(2, 27)).toBe("2 parties · 27 scores");
  expect(allSessionsMeta(0, 0)).toBe("0 parties · 0 scores");
  // Never "1 partys": the one count here whose plural is not the word plus "s".
  expect(allSessionsMeta(1, 23)).toBe("1 party · 23 scores");

  // The party being sung is on the list whatever its flag says: the flag is
  // dormant until the room goes home.
  expect(isTucked(party)).toBe(false);
  expect(isTucked({ ...party, hidden: true })).toBe(true);
  expect(isTucked({ ...party, hidden: true, current: true })).toBe(false);
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
  expect(groups[0].song?.id).toBe("usdb:2");
});

test("ungrouped, every score stands alone under its own song", () => {
  const groups = groupScores(scores, "none");

  expect(groups).toHaveLength(4);
  // The row is headed by its song; the singer comes off the score itself.
  expect(groups[0].label).toBe("Oasis – Wonderwall");
  expect(groups[0].scores[0].player_name).toBe("Alice");
  expect(groups[0].song?.id).toBe("usdb:2");
  // One score each: best, worst and average are all that one number.
  expect(groups[0]).toMatchObject({ best: 9000, worst: 9000, average: 9000 });
});

test("a bombed song becomes an outlier instead of stretching the whisker", () => {
  const [group] = groupScores(
    [8000, 8200, 8400, 8600, 2000].map((value) =>
      score("Alice", value, bohemian),
    ),
    "player",
  );

  const box = boxStats(group);
  // Ascending [2000, 8000, 8200, 8400, 8600]: quartiles by interpolation.
  expect(box).toMatchObject({ q1: 8000, median: 8200, q3: 8400 });
  // 1.5 × IQR = 600 — the 2000 lies far below the fence, so the whisker ends
  // on the lowest score still inside it, never on the fence itself.
  expect(box.whiskerLow).toBe(8000);
  expect(box.whiskerHigh).toBe(8600);
  expect(box.outliers.map((entry) => entry.score)).toEqual([2000]);
});

test("outliers flag on both ends — a surprise hit counts like a flop", () => {
  const [group] = groupScores(
    [5000, 5100, 5200, 5300, 9900].map((value) =>
      score("Alice", value, bohemian),
    ),
    "player",
  );

  const box = boxStats(group);
  expect(box.outliers.map((entry) => entry.score)).toEqual([9900]);
  expect(box.whiskerHigh).toBe(5300);
});

test("a tight group has no outliers and whiskers at its extremes", () => {
  const [alice] = groupScores(scores, "player");

  expect(boxStats(alice)).toMatchObject({
    whiskerLow: 8000,
    whiskerHigh: 9000,
    outliers: [],
  });
});

test("the timeline tells two same-named guests apart by their player id", () => {
  expect(
    scorePlayerKey(score("Chris", 9000, bohemian, { player_id: "player-a" })),
  ).toBe("player-a");
  expect(scorePlayerKey(score("Chris", 9000, bohemian))).toBe("name:Chris");
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
  // The share card's gold bar asks the same rule of one score.
  expect([0, 499, 500, 9999, 10000].map(bucketOf)).toEqual([0, 0, 1, 19, 19]);
});

test("the summary counts distinct songs and singers and finds the top score", () => {
  const summary = summarize([...scores, score("Alice", 9500, null)]);

  // Two known songs plus the one that left the library.
  expect(summary).toMatchObject({ songs: 3, singers: 2 });
  expect(summary.top?.score).toBe(9500);
  expect(summary.top?.player_name).toBe("Alice");
});

test("the summary counts scored performances, not score rows", () => {
  // One duet: two singers, two scores, but a single run of the song.
  const duet = [
    score("Alice", 8000, bohemian, { sing_id: "sing-duet" }),
    score("Bob", 7000, bohemian, { sing_id: "sing-duet" }),
  ];

  expect(summarize(duet)).toMatchObject({ sings: 1, songs: 1, singers: 2 });
});

test("an empty session summarizes to nothing rather than crashing", () => {
  expect(summarize([])).toEqual({
    sings: 0,
    songs: 0,
    singers: 0,
    top: null,
  });
  expect(groupScores([], "player")).toEqual([]);
});

test("each sorting orders the groups the way the old app did", () => {
  const groups = groupScores(scores, "player");
  const labels = (sorting: Parameters<typeof sortGroups>[1]): string[] =>
    sortGroups(groups, sorting).map((group) => group.label);

  expect(labels("best")).toEqual(["Alice", "Bob"]);
  expect(labels("average")).toEqual(["Alice", "Bob"]);
  expect(labels("alphabetically")).toEqual(["Alice", "Bob"]);
  // "worst score" ranks ascending: whoever bombed hardest leads the list.
  expect(labels("worst")).toEqual(["Bob", "Alice"]);
  // Sorting never mutates the list it was handed.
  expect(groups.map((group) => group.label)).toEqual(["Alice", "Bob"]);
});

test("chronological reads the evening forwards, from its first song", () => {
  const sung = [
    score("Alice", 4000, bohemian, {
      recorded_at: "2026-08-23T21:30:00Z",
      sing_id: "sing-3",
    }),
    score("Bob", 9000, wonderwall, {
      recorded_at: "2026-08-23T20:00:00Z",
      sing_id: "sing-1",
    }),
    // A second run of Wonderwall, later: a group is placed by when it *first*
    // happened, so coming round again does not move it down the evening.
    score("Chris", 5000, wonderwall, {
      recorded_at: "2026-08-23T22:00:00Z",
      sing_id: "sing-4",
    }),
  ];
  const groups = groupScores(sung, "song");

  expect(
    sortGroups(groups, "chronological").map((group) => group.label),
  ).toEqual(["Oasis – Wonderwall", "Queen – Bohemian Rhapsody"]);
  // Oldest first is what the word means; "best score" is unmoved by any of it.
  expect(sortGroups(groups, "best").map((group) => group.label)).toEqual([
    "Oasis – Wonderwall",
    "Queen – Bohemian Rhapsody",
  ]);
});

test("two groups that started at the same moment fall back to their label", () => {
  const together = groupScores(
    [
      score("Zoe", 9000, bohemian, { player_id: "z" }),
      score("Ada", 5000, wonderwall, { player_id: "a" }),
    ],
    "player",
  );

  // Both fixtures carry the same `recorded_at`, which is exactly the tie.
  expect(
    sortGroups(together, "chronological").map((group) => group.label),
  ).toEqual(["Ada", "Zoe"]);
});

test("groups that tie on the sorted value fall back to their label", () => {
  const tied = groupScores(
    [
      score("Zoe", 5000, bohemian, { player_id: "z" }),
      score("Ada", 5000, wonderwall, { player_id: "a" }),
    ],
    "player",
  );

  expect(sortGroups(tied, "best").map((group) => group.label)).toEqual([
    "Ada",
    "Zoe",
  ]);
  expect(sortGroups(tied, "worst").map((group) => group.label)).toEqual([
    "Ada",
    "Zoe",
  ]);
});

test("the number a row shows is the number it is sorted by", () => {
  const [alice] = groupScores(scores, "player");

  expect(groupValue(alice, "best")).toBe(9000);
  expect(groupValue(alice, "worst")).toBe(8000);
  expect(groupValue(alice, "average")).toBe(8500);
  // Alphabetical and chronological order rank by nothing a row could print —
  // a name and a time are not scores — so the best score stands in.
  expect(groupValue(alice, "alphabetically")).toBe(9000);
  expect(groupValue(alice, "chronological")).toBe(9000);
});

test("a singer without a player record still gets an avatar to fall back on", () => {
  const known = {
    id: "p1",
    name: "Alice",
    registered: true,
    hidden: false,
    has_avatar: true,
  };
  const players = new Map([[known.id, known]]);

  expect(
    scorePlayer(score("Alice", 9000, bohemian, { player_id: "p1" }), players),
  ).toBe(known);
  // A guest has no player id at all; the stand-in carries the name so
  // `PlayerAvatar` can draw its initial.
  expect(scorePlayer(score("Guest", 100, bohemian), players)).toMatchObject({
    name: "Guest",
    has_avatar: false,
  });
});

test("a summary's totals come out of the scores it is given", () => {
  const mine = [
    score("Alice", 8000, bohemian),
    score("Alice", 9000, wonderwall),
    score("Alice", 4900, bohemian, { sing_id: "sing-again" }),
  ];

  expect(scoreSummary(mine)).toEqual({
    sings: 3,
    // Three performances, but the same song twice.
    songs: 2,
    best: 9000,
    bestBy: "Alice",
    // 21900 / 3 = 7300 exactly; the rounding is what a third score would need.
    average: 7300,
    worst: 4900,
    worstBy: "Alice",
  });
});

test("a duet counts as one sing, and the average is rounded", () => {
  const duet = [
    score("Alice", 8000, bohemian, { sing_id: "sing-duet" }),
    score("Bob", 7001, bohemian, { sing_id: "sing-duet" }),
  ];

  // Two scores, one run of one song — and the average is over the scores.
  expect(scoreSummary(duet)).toMatchObject({
    sings: 1,
    songs: 1,
    average: 7501,
  });
});

test("the best and the worst carry the name of whoever holds them", () => {
  const both = [
    score("Alice", 8000, bohemian),
    score("Bob", 4000, bohemian, { sing_id: "sing-bob" }),
  ];

  expect(scoreSummary(both)).toMatchObject({
    best: 8000,
    bestBy: "Alice",
    worst: 4000,
    worstBy: "Bob",
  });
});

test("a peak two people share is held by whoever got there first", () => {
  // Deliberately out of order: the name must not depend on the order the
  // scores arrive in, only on when they were sung.
  const tied = [
    score("Bob", 9000, bohemian, { recorded_at: "2026-08-23T21:00:00Z" }),
    score("Alice", 9000, wonderwall, { recorded_at: "2026-08-23T20:00:00Z" }),
  ];

  expect(scoreSummary(tied)).toMatchObject({ best: 9000, bestBy: "Alice" });
  // The same run of scores is its own worst, and the same rule names it.
  expect(scoreSummary(tied)).toMatchObject({ worst: 9000, worstBy: "Alice" });
});

test("a tie inside one run is settled by the row, not by the order it arrives", () => {
  // A duet: two scores of one sing, imported together and stamped the same
  // second. The clock cannot separate them, so the row id has to.
  const alice = score("Alice", 9000, bohemian, { sing_id: "sing-duet" });
  const bob = score("Bob", 9000, bohemian, { sing_id: "sing-duet" });

  expect(scoreSummary([alice, bob])).toMatchObject({ bestBy: "Alice" });
  expect(scoreSummary([bob, alice])).toMatchObject({ bestBy: "Alice" });
});

test("songs that have left the library count as one unknown song, as elsewhere", () => {
  // Same lumping as `summarize`, so the user page and the scores page agree.
  const gone = [
    score("Alice", 8000, null, { sing_id: "sing-1" }),
    score("Alice", 7000, null, { sing_id: "sing-2" }),
    score("Alice", 6000, bohemian, { sing_id: "sing-3" }),
  ];

  expect(scoreSummary(gone)).toMatchObject({ sings: 3, songs: 2 });
});

test("a set without a single score has no summary at all", () => {
  // Null, not five zeroes: the surface says "sing something" instead of lying.
  expect(scoreSummary([])).toBeNull();
});

test("every USDX rating word is reachable at its own threshold", () => {
  // The old app's bounds verbatim, checked on both sides of each one.
  expect(
    [
      0, 2009, 2010, 4009, 4010, 5009, 5010, 6009, 6010, 7509, 7510, 8509, 8510,
      9009, 9010, 10000,
    ].map(evaluationLabel),
  ).toEqual([
    "Tone Deaf",
    "Tone Deaf",
    "Amateur",
    "Amateur",
    "Wannabe",
    "Wannabe",
    "Hopeful",
    "Hopeful",
    "Rising Star",
    "Rising Star",
    "Lead Singer",
    "Lead Singer",
    "Superstar",
    "Superstar",
    "Ultrastar",
    "Ultrastar",
  ]);
});

test("a score above a perfect run is a parsing accident, not a better word", () => {
  expect(evaluationLabel(12345)).toBe("Ultrastar");
});

test("a song's history is measured over every score it ever got", () => {
  const history = [
    score("Alice", 8500, bohemian, { sing_id: "sing-2" }),
    score("Bob", 6000, bohemian, { sing_id: "sing-2" }),
    score("Chris", 4000, bohemian, { sing_id: "sing-1" }),
  ];

  expect(songHistory(history)).toEqual({
    best: 8500,
    worst: 4000,
    // 18500 / 3 = 6166.67, rounded.
    average: 6167,
  });
});

test("a song nobody has scored yet has no history at all", () => {
  expect(songHistory([])).toBeNull();
});

/** A history holding only the three numbers the markers are drawn from. */
function marks(worst: number, average: number, best: number): SongHistory {
  return { best, worst, average };
}

/** Which glyph each surviving mark wears, in the order they are drawn. */
function kinds(history: SongHistory, gap: number): string[] {
  return scoreMarkers(history, gap).map((marker) => marker.kind);
}

test("a score sits on the bars' scale, and never off either end", () => {
  expect(scoreOffset(2500)).toBe(25);
  // USDX cannot award more than 10000, and a negative score is a parsing
  // accident — either way the mark stays on the strip.
  expect(scoreOffset(12000)).toBe(100);
  expect(scoreOffset(-500)).toBe(0);
});

test("three numbers with room between them keep all three markers", () => {
  expect(kinds(marks(2000, 5000, 9000), 5)).toEqual([
    "worst",
    "average",
    "best",
  ]);
});

test("the average yields to the end it is crowding", () => {
  // 87% against 90%: three percent of the strip is not a glyph, its pointer
  // and air. The two ends imply the number that goes.
  expect(kinds(marks(2000, 8700, 9000), 5)).toEqual(["worst", "best"]);
  // The same the other way round.
  expect(kinds(marks(2000, 2300, 9000), 5)).toEqual(["worst", "best"]);
});

test("worst and best inside the gap collapse into one average mark", () => {
  const collapsed = scoreMarkers(marks(8000, 8200, 8400), 5);

  expect(collapsed).toEqual([{ kind: "average", offset: 82 }]);
});

test("a song sung exactly once wears one mark", () => {
  // Every number is the same number: three glyphs on one spot say it three
  // times over.
  expect(kinds(marks(7300, 7300, 7300), 5)).toEqual(["average"]);
});

test("exactly the minimum gap is far enough for a marker to stay", () => {
  // 20, 25 and 30 percent against a gap of five: a minimum is a minimum.
  expect(kinds(marks(2000, 2500, 3000), 5)).toEqual([
    "worst",
    "average",
    "best",
  ]);
  // A hundredth of a percent under it, and the average is the one that goes.
  expect(kinds(marks(2000, 2499, 3000), 5)).toEqual(["worst", "best"]);
  // The same boundary between the two ends: at the gap they both stay.
  expect(kinds(marks(2000, 2250, 2500), 5)).toEqual(["worst", "best"]);
  expect(kinds(marks(2000, 2250, 2499), 5)).toEqual(["average"]);
});

/** Whether no two of the slots overlap, and every one lies inside the plot. */
function apartAndInside(slots: MarkLabelSlot[], width: number): boolean {
  return slots.every(
    (slot, index) =>
      slot.left >= 0 &&
      slot.left + slot.width <= width + 1e-9 &&
      (index === 0 ||
        slots[index - 1].left + slots[index - 1].width <= slot.left + 1e-9),
  );
}

test("mark labels with room between them stand centred on their lines", () => {
  const slots = spreadMarkLabels([60, 200, 340], 400);

  expect(slots.map((slot) => slot.left)).toEqual([12, 152, 292]);
  expect(slots.every((slot) => slot.width === MARK_LABEL_SLOT)).toBe(true);
  expect(slots.map((slot) => slot.anchor)).toEqual([0.5, 0.5, 0.5]);
});

test("a 304px plot is three 96px slots, side by side, none dropped", () => {
  // The 360px phone's tile: close peaks, three lines a few pixels apart. The
  // run is held against the right edge, its 16px of room left over at the left.
  const slots = spreadMarkLabels([228, 232, 237], 304);

  expect(slots).toHaveLength(3);
  expect(slots.map((slot) => slot.width)).toEqual([96, 96, 96]);
  expect(slots.map((slot) => slot.left)).toEqual([16, 112, 208]);
  expect(apartAndInside(slots, 304)).toBe(true);
});

test("a narrower plot shares its width in three", () => {
  const slots = spreadMarkLabels([100, 101, 102], 240);

  expect(slots.map((slot) => slot.width)).toEqual([80, 80, 80]);
  expect(apartAndInside(slots, 240)).toBe(true);
});

test("overlapping slots move apart as a run, centred where their lines are", () => {
  // Two lines 10px apart in the middle of a wide plot: both give way, equally.
  const slots = spreadMarkLabels([400, 410, 700], 800);

  expect(slots[0].left).toBeCloseTo(309);
  expect(slots[1].left).toBeCloseTo(405);
  expect(slots[2].left).toBeCloseTo(652);
  expect(apartAndInside(slots, 800)).toBe(true);
  // Each label hangs off its own line's point in the slot it was moved to:
  // the left one towards its right edge, the right one from its left.
  expect(slots[0].anchor).toBeCloseTo(91 / 96);
  expect(slots[1].anchor).toBeCloseTo(5 / 96);
});

test("the order of the lines is the order of the slots", () => {
  // The nth label is the nth line, so the word is what pairs them.
  for (const xs of [
    [10, 12, 14],
    [140, 141, 290],
    [0, 150, 151],
    [500, 790, 799],
  ]) {
    const slots = spreadMarkLabels(xs, 800);
    const lefts = slots.map((slot) => slot.left);
    expect([...lefts].sort((a, b) => a - b)).toEqual(lefts);
    expect(apartAndInside(slots, 800)).toBe(true);
  }
});

test("a slot at either end is held inside the plot", () => {
  const slots = spreadMarkLabels([2, 150, 287], 288);

  expect(slots[0].left).toBe(0);
  expect(slots[2].left).toBe(192);
  // Pushed in from the edge, the label starts or ends on its line.
  expect(slots[0].anchor).toBeCloseTo(2 / 96);
  expect(slots[2].anchor).toBeCloseTo(95 / 96);
});

test("equal scores keep one slot each, and one alone is one slot", () => {
  const tied = spreadMarkLabels([200, 200, 200], 600);
  expect(tied).toHaveLength(3);
  expect(apartAndInside(tied, 600)).toBe(true);
  // The run is centred on the one line all three stand on.
  expect(tied[1].left + tied[1].width / 2).toBeCloseTo(200);

  expect(spreadMarkLabels([150], 300)).toEqual([
    { left: 102, width: 96, anchor: 0.5 },
  ]);
});

test("a record is one where the whole all-time best came out of this sing", () => {
  const now = [
    score("Alice", 8500, bohemian, { sing_id: "sing-2" }),
    score("Bob", 6000, bohemian, { sing_id: "sing-2" }),
  ];
  const earlier = score("Chris", 4000, bohemian, { sing_id: "sing-1" });

  expect(isNewHighscore([...now, earlier], now)).toBe(true);
  // Someone cleared it before: the same score is no longer a record.
  expect(
    isNewHighscore(
      [...now, earlier, score("Dora", 8500, bohemian, { sing_id: "sing-0" })],
      now,
    ),
  ).toBe(false);
});

test("a history that has not arrived yet is not a record", () => {
  const now = [score("Alice", 8500, bohemian, { sing_id: "sing-2" })];

  expect(isNewHighscore([], now)).toBe(false);
  expect(isNewHighscore(now, [])).toBe(false);
});

test("the session leaderboard ranks by the order it is asked for", () => {
  const party = [
    score("Alice", 8500, bohemian, { sing_id: "sing-3" }),
    score("Bob", 6000, bohemian, { sing_id: "sing-3" }),
    score("Chris", 5000, wonderwall, { sing_id: "sing-2" }),
    score("Chris", 4000, bohemian, { sing_id: "sing-1" }),
  ];

  const names = (order: "best" | "average" | "sings"): [string, number][] =>
    sessionLeaderboard(party, order).map((entry) => [entry.name, entry.value]);

  expect(names("best")).toEqual([
    ["Alice", 8500],
    ["Bob", 6000],
    ["Chris", 5000],
  ]);
  expect(names("average")).toEqual([
    ["Alice", 8500],
    ["Bob", 6000],
    ["Chris", 4500],
  ]);
  // Chris sang twice; the two singers he beats on count tie and fall back to
  // their best score, so Alice stays ahead of Bob.
  expect(names("sings")).toEqual([
    ["Chris", 2],
    ["Alice", 1],
    ["Bob", 1],
  ]);
});

test("a leaderboard row keeps its best score, for the avatar behind it", () => {
  const party = [
    score("Alice", 4000, bohemian, { sing_id: "sing-1", player_id: "p1" }),
    score("Alice", 8500, wonderwall, { sing_id: "sing-2", player_id: "p1" }),
  ];

  const [alice] = sessionLeaderboard(party, "best");
  expect(alice.top.score).toBe(8500);
  expect(alice.top.player_id).toBe("p1");
  expect(alice).toMatchObject({ best: 8500, average: 6250, sings: 2 });
});

test("nobody has sung, so nobody is ranked", () => {
  expect(sessionLeaderboard([], "best")).toEqual([]);
});

test("the best score of a set is held by whoever got there first", () => {
  const song1 = song("usdb:1", "Queen", "Bohemian Rhapsody");
  const late = score("Bob", 9000, song1, {
    recorded_at: "2026-08-23T21:00:00Z",
  });
  const early = score("Alice", 9000, song1);
  const duetPartner = score("Mia", 9000, song1);

  expect(bestScoreOf([late, early])).toBe(early);
  // Two scores of one run share the clock; the row id settles it.
  expect(bestScoreOf([duetPartner, early])).toBe(early);
  expect(bestScoreOf([score("Alice", 4000, song1), late])).toBe(late);
  expect(bestScoreOf([])).toBeNull();
});
