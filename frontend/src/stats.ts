import type { EChartsOption } from "echarts";
import type {
  PlayerRead,
  ScoreWithContext,
  SessionRead,
  SongRead,
} from "./api";
import { MAX_SCORE, chartTheme } from "./chartTheme";
import { parseServerTime, shortDate } from "./duration";

/** What the score lists can be grouped by on the stats page. `none` leaves
 * every single score standing on its own, as the old app's "don't group". */
export type Grouping = "none" | "player" | "song";

/**
 * The old app's four score orders, recreated verbatim, plus one it never had:
 * `chronological` reads the evening back in the order it happened. It says
 * nothing about a *singer* — a player is not an event — so the Scores page
 * keeps it out of the sort list while the grouping is by player.
 */
export type Sorting =
  "alphabetically" | "average" | "best" | "worst" | "chronological";

export interface ScoreGroup {
  /** Stable across renders, so it works as a React key and an expansion id. */
  key: string;
  label: string;
  /** The song the row stands for, for its cover and its details modal. Null
   * when grouping by player, and when the song has left the library. */
  song: SongRead | null;
  /** The group's scores, best first. */
  scores: ScoreWithContext[];
  best: number;
  worst: number;
  median: number;
  /** Boxplot five-number summary, ascending: worst, q1, median, q3, best. */
  quartiles: number[];
  average: number;
  /**
   * When the group first happened, as epoch milliseconds — the earliest
   * `recorded_at` behind it. What `chronological` orders by: a song's place in
   * the evening is the run that put it there, not the last time it came round.
   */
  firstAt: number;
}

/** One singer's totals over their whole history, for the user page. */
export interface PlayerSummary {
  /** Performances that were scored, not scores: a duet counts once. */
  sings: number;
  best: number;
  average: number;
  /** Distinct songs behind those performances; the ones that have left the
   * library are lumped into one, exactly as `summarize` counts them. */
  songs: number;
}

export interface SessionSummary {
  /** Performances that produced a score — distinct `sing_id`s among them. */
  sings: number;
  songs: number;
  singers: number;
  top: ScoreWithContext | null;
}

/** What a song's whole history adds up to — the lines the host stage prints
 * under the cover of the song that just finished. */
export interface SongHistory {
  /** Performances that were scored, so a duet counts once. */
  sings: number;
  best: number;
  /** Everybody who ever hit `best`, deduplicated — a singer who managed it
   * twice is one name, not two. */
  bestPlayers: string[];
  worst: number;
  worstPlayers: string[];
  average: number;
}

/** How the session leaderboard ranks its singers. */
export type LeaderboardOrder = "best" | "average" | "sings";

/** One singer's standing in the running session. */
export interface LeaderboardEntry {
  /** Stable across renders, so it works as a React key. */
  key: string;
  name: string;
  best: number;
  average: number;
  /** Performances of theirs that were scored in this session. */
  sings: number;
  /** The number the chosen order ranks by, and therefore the one shown. */
  value: number;
  /** Their best score of the session — where the row's avatar comes from. */
  top: ScoreWithContext;
}

/** The USDX rating words the old app printed under each singer's name, with
 * its thresholds verbatim: the score has to be at or below the bound. */
const EVALUATIONS: [number, string][] = [
  [2009, "Tone Deaf"],
  [4009, "Amateur"],
  [5009, "Wannabe"],
  [6009, "Hopeful"],
  [7509, "Rising Star"],
  [8509, "Lead Singer"],
  [9009, "Superstar"],
  [MAX_SCORE, "Ultrastar"],
];

/**
 * The rating word for one score. USDX cannot award more than `MAX_SCORE`, so
 * anything above it is a parsing accident rather than a better performance —
 * it gets the top word instead of the old app's "How did we get here?".
 */
export function evaluationLabel(score: number): string {
  for (const [bound, label] of EVALUATIONS) if (score <= bound) return label;
  return EVALUATIONS[EVALUATIONS.length - 1][1];
}

/** The names of everybody who scored exactly `value`, each name once. */
function playersWith(scores: ScoreWithContext[], value: number): string[] {
  return [
    ...new Set(
      scores
        .filter((score) => score.score === value)
        .map((score) => score.player_name),
    ),
  ];
}

/**
 * What one song's complete score history adds up to, or `null` when it has
 * none. Computed over *every* score the song ever got, across all sessions —
 * that is what makes the numbers worth putting on the TV.
 */
export function songHistory(scores: ScoreWithContext[]): SongHistory | null {
  if (scores.length === 0) return null;
  const sings = new Set<string>();
  let best = scores[0].score;
  let worst = scores[0].score;
  let total = 0;
  for (const score of scores) {
    sings.add(score.sing_id);
    if (score.score > best) best = score.score;
    if (score.score < worst) worst = score.score;
    total += score.score;
  }
  return {
    sings: sings.size,
    best,
    bestPlayers: playersWith(scores, best),
    worst,
    worstPlayers: playersWith(scores, worst),
    average: Math.round(total / scores.length),
  };
}

/**
 * Whether the sing that just finished set the song's all-time record. The old
 * app's rule, ported: it is a record when *every* occurrence of the song's best
 * score came out of this one sing.
 *
 * `history` is the song's complete history, which already contains `scores`.
 * An empty history means nothing is known yet — not a record.
 */
export function isNewHighscore(
  history: ScoreWithContext[],
  scores: ScoreWithContext[],
): boolean {
  if (history.length === 0 || scores.length === 0) return false;
  const best = Math.max(...history.map((score) => score.score));
  const counts = (rows: ScoreWithContext[]): number =>
    rows.filter((score) => score.score === best).length;
  return counts(history) === counts(scores);
}

/**
 * The running session's singers, strongest first in the reader's order. Ties
 * fall back to the best score and then the name, so the rows keep a stable
 * place while the party goes on.
 */
export function sessionLeaderboard(
  scores: ScoreWithContext[],
  order: LeaderboardOrder,
): LeaderboardEntry[] {
  // `groupScores` already bundles the scores per singer, keeping two guests of
  // the same name apart, and its groups are sorted best score first.
  const entries = groupScores(scores, "player").map((group) => {
    const sings = new Set(group.scores.map((score) => score.sing_id)).size;
    return {
      key: group.key,
      name: group.label,
      best: group.best,
      average: group.average,
      sings,
      value:
        order === "average"
          ? group.average
          : order === "sings"
            ? sings
            : group.best,
      top: group.scores[0],
    };
  });
  return entries.sort(
    (a, b) =>
      b.value - a.value ||
      b.best - a.best ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** "1 singer" / "5 singers" — the picker's counts, none of which is ever a bare
 * number the reader has to guess the unit of. */
function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * A party's second line in the session picker: when it was and how much
 * happened at it. A party is more than its name, and this is what tells two
 * evenings apart before either is opened.
 */
export function sessionMeta(session: SessionRead): string {
  return [
    shortDate(session.started_at),
    plural(session.singer_count, "singer"),
    plural(session.score_count, "score"),
  ].join(" · ");
}

/**
 * The picker's head row under its name: what "everything at once" adds up to.
 * The listing holds exactly the parties the reader may open, so summing it is
 * summing precisely what the head row will show.
 */
export function allSessionsMeta(sessions: SessionRead[]): string {
  const scores = sessions.reduce((sum, entry) => sum + entry.score_count, 0);
  return `${plural(sessions.length, "session")} · ${plural(scores, "score")}`;
}

/** A session's own name, or when it started — the label the picker shows.
 * The time keeps two nameless parties on the same day apart. */
export function sessionLabel(session: SessionRead): string {
  if (session.name !== null && session.name !== "") return session.name;
  const started = new Date(parseServerTime(session.started_at));
  const time = started.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Session ${started.toLocaleDateString()}, ${time}`;
}

/** The song a score was sung on — `song` is null once it has left the library. */
export function songLabel(score: ScoreWithContext): string {
  return score.song === null
    ? "Unknown song"
    : `${score.song.artist} – ${score.song.title}`;
}

/** USDX stores the difficulty it was sung on as 0/1/2; anything else is unknown. */
export function difficultyLabel(difficulty: number | null): string {
  return ["Easy", "Medium", "Hard"][difficulty ?? -1] ?? "—";
}

/**
 * The player record behind a score, for its avatar. A guest, a singer whose
 * player was deleted and a caller who may not list players all end up on the
 * same stand-in, which `PlayerAvatar` draws as the name's initial.
 */
export function scorePlayer(
  score: ScoreWithContext,
  players: Map<string, PlayerRead>,
): PlayerRead {
  const known =
    score.player_id === null ? undefined : players.get(score.player_id);
  return (
    known ?? {
      id: score.player_id ?? `name:${score.player_name}`,
      name: score.player_name,
      registered: false,
      hidden: false,
      has_avatar: false,
    }
  );
}

/** Linear-interpolated percentile of an ascending array, as echarts' own boxplot does it. */
function percentile(ascending: number[], fraction: number): number {
  const position = (ascending.length - 1) * fraction;
  const lower = Math.floor(position);
  const next = ascending[lower + 1];
  if (next === undefined) return ascending[lower];
  return ascending[lower] + (position - lower) * (next - ascending[lower]);
}

function groupKey(score: ScoreWithContext, grouping: Grouping): string {
  // Ungrouped: every score is its own group, so its own id is the key.
  if (grouping === "none") return `score:${score.id}`;
  if (grouping === "song") return score.song?.id ?? "song:unknown";
  // Two guests can share a display name; the player id keeps them apart when
  // there is one. Registered and walk-in singers never collide.
  return score.player_id ?? `name:${score.player_name}`;
}

/**
 * Scores bundled by player or song (or not at all), strongest group first (by
 * median, then by best score so a tie is still deterministic). `sortGroups`
 * puts the list into the order the reader picked; this order is only the
 * stable base it starts from.
 */
export function groupScores(
  scores: ScoreWithContext[],
  grouping: Grouping,
): ScoreGroup[] {
  const groups = new Map<string, ScoreWithContext[]>();
  for (const score of scores) {
    const key = groupKey(score, grouping);
    const existing = groups.get(key);
    if (existing) existing.push(score);
    else groups.set(key, [score]);
  }

  return [...groups]
    .map(([key, members]) => {
      const sorted = [...members].sort((a, b) => b.score - a.score);
      const ascending = sorted.map((score) => score.score).reverse();
      const total = ascending.reduce((sum, score) => sum + score, 0);
      return {
        key,
        // Grouped by player the row is a person; otherwise it is a song, and
        // an ungrouped row is a song too — its singer moves to the caption.
        label:
          grouping === "player" ? sorted[0].player_name : songLabel(sorted[0]),
        song: grouping === "player" ? null : sorted[0].song,
        scores: sorted,
        best: ascending[ascending.length - 1],
        worst: ascending[0],
        median: Math.round(percentile(ascending, 0.5)),
        quartiles: [
          ascending[0],
          percentile(ascending, 0.25),
          percentile(ascending, 0.5),
          percentile(ascending, 0.75),
          ascending[ascending.length - 1],
        ],
        average: Math.round(total / ascending.length),
        firstAt: Math.min(
          ...members.map((score) => parseServerTime(score.recorded_at)),
        ),
      };
    })
    .sort((a, b) => b.median - a.median || b.best - a.best);
}

/** The number a row is ranked by, and therefore the number it shows — the two
 * can never disagree. Alphabetical and chronological order have no value of
 * their own (a date is not a score), so they fall back to the best score, the
 * same thing "best score" ranks by. */
export function groupValue(group: ScoreGroup, sorting: Sorting): number {
  if (sorting === "average") return group.average;
  if (sorting === "worst") return group.worst;
  return group.best;
}

/**
 * The list in the reader's order. Every comparison ends on the label so two
 * groups with identical scores keep a stable place across re-renders.
 *
 * "worst score" sorts *ascending*, exactly as the old app did: the point of
 * that order is to put the evening's biggest flop first. "chronological" is
 * ascending too, and for the same reason: the word means oldest first — the
 * evening read forwards from its first song.
 */
export function sortGroups(
  groups: ScoreGroup[],
  sorting: Sorting,
): ScoreGroup[] {
  const byLabel = (a: ScoreGroup, b: ScoreGroup): number =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  const copy = [...groups];
  switch (sorting) {
    case "alphabetically":
      return copy.sort(byLabel);
    case "average":
      return copy.sort(
        (a, b) => b.average - a.average || b.best - a.best || byLabel(a, b),
      );
    case "worst":
      return copy.sort(
        (a, b) => a.worst - b.worst || a.average - b.average || byLabel(a, b),
      );
    case "best":
      return copy.sort(
        (a, b) => b.best - a.best || b.average - a.average || byLabel(a, b),
      );
    case "chronological":
      return copy.sort((a, b) => a.firstAt - b.firstAt || byLabel(a, b));
  }
}

/**
 * The numbers above the chart, all four derived from the scores themselves so
 * every one of them can be checked against the rows below.
 *
 * `sings` counts distinct performances that were scored — not the session's
 * `sing_count`, which counts every song *started*, restarts and songs stopped
 * before USDX scored them included, and therefore matches nothing on screen.
 */
export function summarize(scores: ScoreWithContext[]): SessionSummary {
  const sings = new Set<string>();
  const songs = new Set<string>();
  const singers = new Set<string>();
  let top: ScoreWithContext | null = null;
  for (const score of scores) {
    sings.add(score.sing_id);
    songs.add(groupKey(score, "song"));
    singers.add(groupKey(score, "player"));
    if (top === null || score.score > top.score) top = score;
  }
  return { sings: sings.size, songs: songs.size, singers: singers.size, top };
}

/**
 * What one singer's scores add up to, or `null` when there are none — a page
 * with nothing to show should say so rather than print four zeroes.
 *
 * Deliberately the same shape as `summarize`: the numbers are derived from the
 * scores themselves, so every one of them can be checked against the score list
 * on the Scores page.
 */
export function playerSummary(
  scores: ScoreWithContext[],
): PlayerSummary | null {
  if (scores.length === 0) return null;
  const sings = new Set<string>();
  const songs = new Set<string>();
  let best = scores[0].score;
  let total = 0;
  for (const score of scores) {
    sings.add(score.sing_id);
    songs.add(groupKey(score, "song"));
    if (score.score > best) best = score.score;
    total += score.score;
  }
  return {
    sings: sings.size,
    best,
    average: Math.round(total / scores.length),
    songs: songs.size,
  };
}

const AXIS = {
  axisLine: { lineStyle: { color: chartTheme.grid } },
  axisLabel: { color: chartTheme.axis },
  splitLine: { show: false },
};

const TOOLTIP = {
  confine: true,
  backgroundColor: chartTheme.tooltipBackground,
  borderColor: chartTheme.grid,
  textStyle: { color: "#fff" },
};

/** How many groups the chart draws at most — the full list sits right below it. */
const CHART_GROUPS = 8;

/** Room one group gets on the category axis. Less and the boxes touch and the
 * labels under them are two characters wide. */
const CATEGORY_WIDTH = 56;

/**
 * The boxplot's height. A standing chart no longer grows with the number of
 * groups — a group makes it wider, not taller — so this is a constant and not
 * the function it replaced.
 */
export const BOXPLOT_HEIGHT = 200;

/**
 * Width the boxplot needs: one column per drawn group plus the gutter the
 * value axis and its labels take. Narrower than its box the chart stretches to
 * fill it (`min-width: 100%` on the wrapper `Chart` sizes); wider, the box
 * scrolls sideways rather than the page (§1.11).
 */
export function boxplotWidth(groupCount: number): number {
  return CATEGORY_WIDTH * Math.min(groupCount, CHART_GROUPS) + 44;
}

/**
 * What a box is called under it. The axis below cuts every label to
 * `CATEGORY_WIDTH` — about seven characters — and cuts it there whatever the
 * chart's width: a box stretched past the width it asked for gets the room, its
 * label does not. "Nena – 99 Luftballons" spends all seven on the artist and
 * leaves "Nena –…" under a box whose song cannot be told from the next one's,
 * so a song stands under its title alone, exactly as its row in the list below
 * does; the tooltip still carries the artist. Grouped by player the label is a
 * person's name and stays whole.
 */
function categoryLabel(group: ScoreGroup): string {
  // `group.label` already reads "Unknown song" once a song has left the
  // library, and a player group has no song at all.
  return group.song?.title ?? group.label;
}

/**
 * Standing boxplot of every group's score spread: the group on the x-axis, the
 * score on the y, first group on the left. When no group has more than one
 * score a boxplot is just a row of hairlines, so each group's single score is
 * drawn as a bar instead.
 *
 * Takes the groups already sorted: the chart draws the head of the same list
 * the page shows, so changing the order never makes the two disagree.
 */
export function buildBoxplotOption(sorted: ScoreGroup[]): EChartsOption {
  const groups = sorted.slice(0, CHART_GROUPS);
  const spread = groups.some((group) => group.scores.length > 1);
  const best = Math.max(...groups.map((group) => group.best), 0);
  // A normal party's scores are meaningful as a percent of a perfect 10000, so
  // the full range stays for anything above 40% of it; only a session whose
  // best score is far lower gets an adaptive max — a fixed axis would draw
  // such scores as 1px slivers glued to the left edge.
  const max =
    best > MAX_SCORE * 0.4
      ? MAX_SCORE
      : Math.max(500, Math.ceil((best * 1.25) / 500) * 500);
  // The axis is cut to about seven characters, the tooltip is not: what a box
  // stands for is spelled out in full there, artist included, and a song that
  // shares its title with another one is told apart by it.
  const named = (index: number): string => groups[index]?.label ?? "";
  return {
    tooltip: {
      ...TOOLTIP,
      trigger: "axis",
      formatter: spread
        ? // `data` of a boxplot item is [index, min, q1, median, q3, max].
          (params: unknown) => {
            const [item] = params as { dataIndex: number; data: number[] }[];
            const [, min, q1, median, q3, top] = item.data;
            return [
              `<b>${named(item.dataIndex)}</b>`,
              `Best: ${top}`,
              `Upper quartile: ${Math.round(q3)}`,
              `Median: ${Math.round(median)}`,
              `Lower quartile: ${Math.round(q1)}`,
              `Worst: ${min}`,
            ].join("<br/>");
          }
        : (params: unknown) => {
            const [item] = params as { dataIndex: number; data: number }[];
            return `<b>${named(item.dataIndex)}</b><br/>Score: ${item.data}`;
          },
    },
    grid: { top: 4, bottom: 4, left: 4, right: 8, containLabel: true },
    xAxis: {
      ...AXIS,
      type: "category",
      // Every category keeps its label: echarts thins a crowded axis out by
      // dropping labels, and a box with no name under it says nothing. The
      // width is `CATEGORY_WIDTH` minus the gap, so a long title truncates
      // instead of running into its neighbours — the tooltip still carries the
      // full name.
      axisLabel: {
        ...AXIS.axisLabel,
        interval: 0,
        width: CATEGORY_WIDTH - 4,
        overflow: "truncate",
        ellipsis: "…",
      },
      data: groups.map(categoryLabel),
    },
    yAxis: {
      ...AXIS,
      type: "value",
      min: 0,
      max,
      splitNumber: 4,
      axisLabel: {
        ...AXIS.axisLabel,
        hideOverlap: true,
        // `2.5k` fits the narrow gutter a standing chart leaves the value axis,
        // where `10,000` would eat into the boxes.
        formatter: (value: number) =>
          value >= 1000 ? `${value / 1000}k` : String(value),
      },
    },
    series: [
      spread
        ? {
            type: "boxplot" as const,
            data: groups.map((group) => group.quartiles),
            itemStyle: {
              color: chartTheme.fill,
              borderColor: chartTheme.accent,
            },
            emphasis: {
              itemStyle: {
                color: chartTheme.emphasisFill,
                borderColor: chartTheme.emphasis,
              },
            },
          }
        : {
            type: "bar" as const,
            data: groups.map((group) => group.median),
            barMaxWidth: 18,
            itemStyle: { color: chartTheme.accent },
            emphasis: { itemStyle: { color: chartTheme.emphasis } },
          },
    ],
  };
}

/** Score buckets of a histogram, e.g. 500 wide for 20 buckets out of 10000. */
export const HISTOGRAM_BUCKETS = 20;
const BUCKET_WIDTH = MAX_SCORE / HISTOGRAM_BUCKETS;

/** How many of `scores` fall into each equally wide score bucket. */
export function histogram(scores: ScoreWithContext[]): number[] {
  const buckets = new Array<number>(HISTOGRAM_BUCKETS).fill(0);
  for (const { score } of scores) {
    // A perfect 10000 belongs in the last bucket, not in a 21st one.
    buckets[
      Math.min(Math.floor(score / BUCKET_WIDTH), HISTOGRAM_BUCKETS - 1)
    ]++;
  }
  return buckets;
}

/** Bar chart of one group's score distribution over the full 0–10000 range. */
export function buildHistogramOption(
  scores: ScoreWithContext[],
): EChartsOption {
  const buckets = histogram(scores);
  return {
    tooltip: {
      ...TOOLTIP,
      trigger: "axis",
      formatter: (params: unknown) => {
        const [item] = params as { name: string; data: number }[];
        return `<b>${item.name}</b><br/>${item.data} score${item.data === 1 ? "" : "s"}`;
      },
    },
    grid: { top: 4, bottom: 18, left: 4, right: 4, containLabel: true },
    xAxis: {
      ...AXIS,
      type: "category",
      // Only the ends are labelled — twenty ranges never fit on a phone, but
      // without `0` and `10000` anchors the bars have no scale at all.
      axisLabel: {
        color: chartTheme.axis,
        interval: (index: number) =>
          index === 0 || index === HISTOGRAM_BUCKETS - 1,
        formatter: (_value: string, index: number) =>
          index === 0 ? "0" : String(MAX_SCORE),
      },
      data: buckets.map(
        (_count, index) =>
          `${index * BUCKET_WIDTH} – ${(index + 1) * BUCKET_WIDTH}`,
      ),
    },
    // The count is in the tooltip and every score is listed right below the
    // chart — the left gutter is better spent on bars.
    yAxis: { show: false },
    series: [
      {
        type: "bar",
        barWidth: "100%",
        data: buckets,
        itemStyle: { color: chartTheme.accent },
        emphasis: { itemStyle: { color: chartTheme.emphasis } },
      },
    ],
  };
}
