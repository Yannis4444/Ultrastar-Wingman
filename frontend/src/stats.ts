import type { EChartsOption } from "echarts";
import type { ScoreWithContext, SessionRead } from "./api";
import { MAX_SCORE, chartTheme } from "./chartTheme";
import { parseServerTime } from "./duration";

/** What the score lists can be grouped by on the stats page. */
export type Grouping = "player" | "song";

export interface ScoreGroup {
  /** Stable across renders, so it works as a React key and an expansion id. */
  key: string;
  label: string;
  /** Only set when grouping by song and the song is still in the library. */
  songId: string | null;
  /** The group's scores, best first. */
  scores: ScoreWithContext[];
  best: number;
  worst: number;
  median: number;
  /** Boxplot five-number summary, ascending: worst, q1, median, q3, best. */
  quartiles: number[];
  average: number;
}

export interface SessionSummary {
  songs: number;
  singers: number;
  top: ScoreWithContext | null;
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

/** How a score is described inside a group: the other axis of the grouping. */
export function scoreLabel(
  score: ScoreWithContext,
  grouping: Grouping,
): string {
  return grouping === "song" ? score.player_name : songLabel(score);
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
  if (grouping === "song") return score.song?.id ?? "song:unknown";
  // Two guests can share a display name; the player id keeps them apart when
  // there is one. Registered and walk-in singers never collide.
  return score.player_id ?? `name:${score.player_name}`;
}

/**
 * Scores bundled by player or song, strongest group first (by median, then by
 * best score so a tie is still deterministic).
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
        label:
          grouping === "song" ? songLabel(sorted[0]) : sorted[0].player_name,
        songId: grouping === "song" ? (sorted[0].song?.id ?? null) : null,
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
      };
    })
    .sort((a, b) => b.median - a.median || b.best - a.best);
}

/** The numbers above the chart. Sings come from the session row, not from here:
 * a song stopped before USDX scored it records no scores at all. */
export function summarize(scores: ScoreWithContext[]): SessionSummary {
  const songs = new Set<string>();
  const singers = new Set<string>();
  let top: ScoreWithContext | null = null;
  for (const score of scores) {
    songs.add(groupKey(score, "song"));
    singers.add(groupKey(score, "player"));
    if (top === null || score.score > top.score) top = score;
  }
  return { songs: songs.size, singers: singers.size, top };
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

/** Height the boxplot needs: one row per drawn group plus room for the axis. */
export function boxplotHeight(groupCount: number): number {
  return 28 * Math.min(groupCount, CHART_GROUPS) + 40;
}

/**
 * Horizontal boxplot of every group's score spread, strongest group on top
 * (`inverse`, because an echarts category axis counts up from the bottom).
 * When no group has more than one score a boxplot is just a row of hairlines,
 * so each group's single score is drawn as a bar instead.
 */
export function buildBoxplotOption(
  scores: ScoreWithContext[],
  grouping: Grouping,
): EChartsOption {
  const groups = groupScores(scores, grouping).slice(0, CHART_GROUPS);
  const spread = groups.some((group) => group.scores.length > 1);
  const best = Math.max(...scores.map((score) => score.score), 0);
  // A normal party's scores are meaningful as a percent of a perfect 10000, so
  // the full range stays for anything above 40% of it; only a session whose
  // best score is far lower gets an adaptive max — a fixed axis would draw
  // such scores as 1px slivers glued to the left edge.
  const max =
    best > MAX_SCORE * 0.4
      ? MAX_SCORE
      : Math.max(500, Math.ceil((best * 1.25) / 500) * 500);
  return {
    tooltip: {
      ...TOOLTIP,
      trigger: "axis",
      formatter: spread
        ? // `data` of a boxplot item is [index, min, q1, median, q3, max].
          (params: unknown) => {
            const [item] = params as { name: string; data: number[] }[];
            const [, min, q1, median, q3, top] = item.data;
            return [
              `<b>${item.name}</b>`,
              `Best: ${top}`,
              `Upper quartile: ${Math.round(q3)}`,
              `Median: ${Math.round(median)}`,
              `Lower quartile: ${Math.round(q1)}`,
              `Worst: ${min}`,
            ].join("<br/>");
          }
        : (params: unknown) => {
            const [item] = params as { name: string; data: number }[];
            return `<b>${item.name}</b><br/>Score: ${item.data}`;
          },
    },
    grid: { top: 4, bottom: 22, left: 8, right: 12, containLabel: true },
    xAxis: {
      ...AXIS,
      type: "value",
      min: 0,
      max,
      splitNumber: 4,
      axisLabel: {
        ...AXIS.axisLabel,
        hideOverlap: true,
        // `2.5k` fits a 358px-wide tile where `10,000` collides.
        formatter: (value: number) =>
          value >= 1000 ? `${value / 1000}k` : String(value),
      },
    },
    yAxis: {
      ...AXIS,
      type: "category",
      inverse: true,
      // Song labels can be long; the tooltip still carries the full name.
      axisLabel: {
        ...AXIS.axisLabel,
        width: 96,
        overflow: "truncate",
        ellipsis: "…",
      },
      data: groups.map((group) => group.label),
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
