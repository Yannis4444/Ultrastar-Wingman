import type { ScoreWithContext, SessionRead, SongRead } from "./api";
import { parseServerTime, shortDate } from "./duration";
import {
  allSessionsMeta,
  boxplotWidth,
  buildBoxplotOption,
  buildHistogramOption,
  difficultyLabel,
  evaluationLabel,
  groupScores,
  groupValue,
  histogram,
  isNewHighscore,
  playerSummary,
  scorePlayer,
  sessionLabel,
  sessionLeaderboard,
  sessionMeta,
  songHistory,
  songLabel,
  sortGroups,
  summarize,
} from "./stats";

function song(id: string, artist: string, title: string): SongRead {
  return {
    id,
    artist,
    title,
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

/** The group names of a boxplot. They sit on the *x*-axis: the chart stands
 * its groups up, score on the y. */
function axisLabels(option: ReturnType<typeof buildBoxplotOption>): unknown {
  return (option.xAxis as { data: string[] }).data;
}

test("a session shows its own name, and its start time when it has none", () => {
  const base: SessionRead = {
    id: "s1",
    name: null,
    started_at: "2026-08-23T18:00:00Z",
    last_activity_at: "2026-08-23T23:00:00Z",
    sing_count: 4,
    score_count: 6,
    singer_count: 3,
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

test("a party's picker line is when it was and how much happened at it", () => {
  const party: SessionRead = {
    id: "s1",
    name: "New Year",
    started_at: "2025-12-31T20:00:00Z",
    last_activity_at: "2026-01-01T03:00:00Z",
    sing_count: 30,
    score_count: 23,
    singer_count: 5,
  };

  // Node's locale decides the date's format, so the expectation borrows it.
  expect(sessionMeta(party)).toBe(
    `${shortDate(party.started_at)} · 5 singers · 23 scores`,
  );
  // Never a bare number, and never "1 singers".
  expect(sessionMeta({ ...party, singer_count: 1, score_count: 1 })).toBe(
    `${shortDate(party.started_at)} · 1 singer · 1 score`,
  );

  // The head row sums exactly the parties under it — the listing holds only
  // the ones this reader may open.
  expect(allSessionsMeta([party, { ...party, id: "s2", score_count: 4 }])).toBe(
    "2 sessions · 27 scores",
  );
  expect(allSessionsMeta([])).toBe("0 sessions · 0 scores");
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

test("the grouping decides the boxplot's categories and boxes", () => {
  const byPlayer = buildBoxplotOption(groupScores(scores, "player"));
  const bySong = buildBoxplotOption(groupScores(scores, "song"));

  // A singer stands under their own name, which is what a name is.
  expect(axisLabels(byPlayer)).toEqual(["Alice", "Bob"]);
  // A song stands under its title alone: a category is 52px wide, and "Nena –
  // 99 Luftballons" would spend all of it on the artist.
  expect(axisLabels(bySong)).toEqual(["Wonderwall", "Bohemian Rhapsody"]);
  // Ungrouped rows are songs too, and truncate exactly the same way.
  expect(axisLabels(buildBoxplotOption(groupScores(scores, "none")))).toEqual([
    "Wonderwall",
    "Bohemian Rhapsody",
    "Wonderwall",
    "Bohemian Rhapsody",
  ]);
  // A song that left the library has no title to stand under.
  expect(
    axisLabels(
      buildBoxplotOption(groupScores([score("Al", 10, null)], "song")),
    ),
  ).toEqual(["Unknown song"]);

  const boxes = (bySong.series as { data: number[][] }[])[0].data;
  expect(boxes[0]).toEqual([6000, 6750, 7500, 8250, 9000]);
});

test("the tooltip names a box in full, artist included", () => {
  const formatterOf = (
    option: ReturnType<typeof buildBoxplotOption>,
  ): ((params: unknown) => string) =>
    (option.tooltip as { formatter: (params: unknown) => string }).formatter;

  // The box the axis calls "Wonderwall": [index, min, q1, median, q3, max].
  const spread = formatterOf(buildBoxplotOption(groupScores(scores, "song")));
  expect(
    spread([{ dataIndex: 0, data: [0, 6000, 6750, 7500, 8250, 9000] }]),
  ).toContain("<b>Oasis – Wonderwall</b>");

  // And the bar a lone score is drawn as, which carries a plain number.
  const single = formatterOf(
    buildBoxplotOption(groupScores([score("Alice", 30, bohemian)], "song")),
  );
  expect(single([{ dataIndex: 0, data: 30 }])).toBe(
    "<b>Queen – Bohemian Rhapsody</b><br/>Score: 30",
  );
});

test("the groups stand on the x-axis, every one of them named", () => {
  const option = buildBoxplotOption(groupScores(scores, "player"));

  // Standing up, strongest on the left: a category axis on x counts left to
  // right by itself, so nothing inverts it any more.
  expect((option.xAxis as { type: string }).type).toBe("category");
  expect((option.yAxis as { type: string }).type).toBe("value");
  expect(option.xAxis).not.toHaveProperty("inverse");
  // echarts thins a crowded category axis out by dropping labels; a box with
  // no name under it says nothing, and the chart scrolls instead.
  expect(
    (option.xAxis as { axisLabel: { interval: number } }).axisLabel,
  ).toMatchObject({ interval: 0, overflow: "truncate" });
});

test("the chart gets wider with its groups, and stops at the eight it draws", () => {
  // 56px per group plus the value axis' gutter — what the scrolling box in
  // `Scores.css` scrolls when that is more than the page has.
  expect(boxplotWidth(2)).toBe(156);
  expect(boxplotWidth(8)).toBe(492);
  expect(boxplotWidth(40)).toBe(boxplotWidth(8));
});

test("groups of single scores get bars on an adaptive axis, not boxplots", () => {
  const option = buildBoxplotOption(
    groupScores([score("Alice", 30, bohemian)], "player"),
  );

  // A boxplot of one score is a hairline; a fixed 0–10000 axis makes it 1px.
  expect((option.series as { type: string }[])[0].type).toBe("bar");
  expect((option.yAxis as { min: number; max: number }).min).toBe(0);
  expect((option.yAxis as { min: number; max: number }).max).toBe(500);
});

test("the score axis keeps the full range once scores pass 40% of perfect", () => {
  const option = buildBoxplotOption(groupScores(scores, "player"));

  expect((option.series as { type: string }[])[0].type).toBe("boxplot");
  expect((option.yAxis as { max: number }).max).toBe(10000);
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
  expect(axisLabels(buildBoxplotOption([]))).toEqual([]);
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

test("one singer's totals come out of their own scores", () => {
  const mine = [
    score("Alice", 8000, bohemian),
    score("Alice", 9000, wonderwall),
    score("Alice", 4900, bohemian, { sing_id: "sing-again" }),
  ];

  expect(playerSummary(mine)).toEqual({
    sings: 3,
    best: 9000,
    // 21900 / 3 = 7300 exactly; the rounding is what a third score would need.
    average: 7300,
    // Three performances, but the same song twice.
    songs: 2,
  });
});

test("a duet counts as one sing, and the average is rounded", () => {
  const duet = [
    score("Alice", 8000, bohemian, { sing_id: "sing-duet" }),
    score("Alice", 7001, bohemian, { sing_id: "sing-duet" }),
  ];

  expect(playerSummary(duet)).toEqual({
    sings: 1,
    best: 8000,
    average: 7501,
    songs: 1,
  });
});

test("songs that have left the library count as one unknown song, as elsewhere", () => {
  // Same lumping as `summarize`, so the user page and the scores page agree.
  const gone = [
    score("Alice", 8000, null, { sing_id: "sing-1" }),
    score("Alice", 7000, null, { sing_id: "sing-2" }),
    score("Alice", 6000, bohemian, { sing_id: "sing-3" }),
  ];

  expect(playerSummary(gone)).toMatchObject({ sings: 3, songs: 2 });
});

test("a singer without a single score has no summary at all", () => {
  // Null, not four zeroes: the page says "sing something" instead of lying.
  expect(playerSummary([])).toBeNull();
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
    // A duet is one performance, so two sings and not three.
    sings: 2,
    best: 8500,
    bestPlayers: ["Alice"],
    worst: 4000,
    worstPlayers: ["Chris"],
    // 18500 / 3 = 6166.67, rounded.
    average: 6167,
  });
});

test("everybody who tied for best or worst is named once", () => {
  const history = [
    score("Alice", 9000, bohemian, { sing_id: "sing-1" }),
    score("Alice", 9000, bohemian, { sing_id: "sing-2" }),
    score("Bob", 9000, bohemian, { sing_id: "sing-3" }),
  ];

  // Alice managed it twice; the line names her once, not twice.
  expect(songHistory(history)).toMatchObject({
    bestPlayers: ["Alice", "Bob"],
    worstPlayers: ["Alice", "Bob"],
  });
});

test("a song nobody has scored yet has no history at all", () => {
  expect(songHistory([])).toBeNull();
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
