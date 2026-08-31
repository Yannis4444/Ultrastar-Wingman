import type { ReactNode } from "react";
import type { ScoreWithContext } from "../api";
import { SCORE_TICKS, jitterOf, scoreTickLabel, swarm } from "../chartLayout";
import { MAX_SCORE, chartTheme } from "../chartTheme";
import { useChartTip } from "../hooks/useChartTip";
import { useMeasuredWidth } from "../hooks/useMeasuredWidth";
import { boxStats, scoreTipLines, type ScoreGroup } from "../stats";
import ChartTip from "./ChartTip";
import "./SpreadRows.css";

/** How many groups the card draws at most — the full list sits right below. */
const CHART_GROUPS = 8;
/** Below this many scores a quartile box is interpolation fiction — the group
 * shows its scores as plain marks instead of pretending to a distribution. */
const BOX_MIN_SCORES = 5;
/** From this many scores a song row's initials would crowd the line — it is
 * two full four-mic performances — so they retire in favour of plain dots. */
const INITIALS_MAX_SCORES = 8;

interface SpreadRowsProps {
  /** The groups in the reader's order — the chart draws the head of the same
   * list the page shows, so the two can never disagree. */
  groups: ScoreGroup[];
  grouping: "player" | "song";
  /** Announced to screen readers, which get nothing out of the drawing —
   * everything in it is also in the ranking list below. */
  label: string;
  /**
   * Whether a song row's marks wear their singers' initials. The account's
   * own history turns this off: every mark would be the same letter.
   */
  initials?: boolean;
  /** Whether the tooltips date a score: on for a list that spans parties. */
  dated?: boolean;
}

/**
 * The score spread, one full-width row per group under a shared 0–10k axis.
 * A singer with enough scores gets the standard box plot — Tukey whiskers
 * ending on real scores, outliers past them on either side — with every raw
 * score as a small grey dot on top. A song is usually one performance rather
 * than a distribution, so its row is a strip in miniature: the scores swarm
 * on the line, wearing their singers' initials while they are few.
 */
export default function SpreadRows({
  groups,
  grouping,
  label,
  initials = true,
  dated = false,
}: SpreadRowsProps) {
  const [containerRef, width] = useMeasuredWidth<HTMLDivElement>(340);
  const { tip, clear, markTip } = useChartTip(containerRef);
  const shown = groups.slice(0, CHART_GROUPS);
  // Chip rows stagger 17px marks, so they get a taller track than dot rows.
  const trackHeight = grouping === "song" && initials ? 46 : 38;
  const mid = trackHeight / 2;
  const scoreX = (value: number) => (value / MAX_SCORE) * width;

  /** A raw-score mark plus an invisible, finger-sized hover/tap target. */
  const dot = (
    score: ScoreWithContext,
    x: number,
    y: number,
    looks: { r: number; fill: string; opacity?: number; ring?: boolean },
  ) => (
    <g key={score.id}>
      <circle
        data-testid="spread-dot"
        cx={x}
        cy={y}
        r={looks.r}
        fill={looks.fill}
        opacity={looks.opacity}
        stroke={looks.ring === true ? chartTheme.surface : undefined}
        strokeWidth={looks.ring === true ? 2 : undefined}
      />
      <circle
        cx={x}
        cy={y}
        r={Math.max(looks.r, 8)}
        fill="transparent"
        {...markTip(`score:${score.id}`, scoreTipLines(score, dated))}
      />
    </g>
  );

  /** Tukey box with the raw scores jittered on top — the player rows. */
  const boxMarks = (group: ScoreGroup): ReactNode => {
    const box = boxStats(group);
    const tipLines = [
      group.label,
      `${group.scores.length} scores`,
      `Best: ${group.best}`,
      `Upper quartile: ${Math.round(box.q3)}`,
      `Median: ${group.median}`,
      `Lower quartile: ${Math.round(box.q1)}`,
      `Worst: ${group.worst}`,
    ];
    return (
      <>
        {[
          [box.whiskerLow, box.q1],
          [box.q3, box.whiskerHigh],
        ].map(([from, to], side) => (
          <line
            // Five identical scores collapse every value into one — the side
            // is the one thing that still tells the two segments apart.
            key={side}
            x1={scoreX(from)}
            x2={scoreX(to)}
            y1={mid}
            y2={mid}
            stroke={chartTheme.accent}
            strokeWidth={1.5}
          />
        ))}
        {[box.whiskerLow, box.whiskerHigh].map((end, side) => (
          <line
            key={`cap-${side}`}
            x1={scoreX(end)}
            x2={scoreX(end)}
            y1={mid - 5}
            y2={mid + 5}
            stroke={chartTheme.accent}
            strokeWidth={1.5}
          />
        ))}
        <rect
          data-testid="spread-box"
          x={scoreX(box.q1)}
          y={mid - 9}
          width={Math.max(scoreX(box.q3) - scoreX(box.q1), 2)}
          height={18}
          rx={3}
          fill={chartTheme.fill}
          stroke={chartTheme.accent}
          strokeWidth={1.25}
          {...markTip(`box:${group.key}`, tipLines)}
        />
        <line
          x1={scoreX(group.median)}
          x2={scoreX(group.median)}
          y1={mid - 9}
          y2={mid + 9}
          stroke={chartTheme.median}
          strokeWidth={2}
        />
        {group.scores.map((score) =>
          dot(score, scoreX(score.score), mid + jitterOf(score.id) * 11, {
            r: 2,
            fill: chartTheme.dot,
            opacity: 0.65,
          }),
        )}
      </>
    );
  };

  /** A strip in miniature — the song rows, and a singer with too few scores
   * for a box. Near-ties stagger apart instead of hiding each other. */
  const swarmMarks = (group: ScoreGroup, chips: boolean): ReactNode => {
    const ascending = [...group.scores].sort((a, b) => a.score - b.score);
    const marks = swarm(
      ascending,
      (score) => scoreX(score.score),
      mid,
      chips ? 15 : 9,
      chips ? 15 : 9,
    );
    return marks.map(({ item, x, y }) =>
      chips ? (
        <g key={item.id}>
          <circle
            data-testid="spread-chip"
            cx={x}
            cy={y}
            r={8.5}
            fill={chartTheme.chip}
            stroke={chartTheme.surface}
            strokeWidth={2}
            {...markTip(`score:${item.id}`, scoreTipLines(item, dated))}
          />
          <text
            x={x}
            y={y + 3.5}
            textAnchor="middle"
            fontSize={10}
            fontWeight={600}
            fill={chartTheme.chipText}
            pointerEvents="none"
          >
            {item.player_name.slice(0, 1)}
          </text>
        </g>
      ) : (
        dot(item, x, y, { r: 3, fill: chartTheme.accent, ring: true })
      ),
    );
  };

  return (
    <div
      className="chart-plot spread-rows"
      ref={containerRef}
      role="img"
      aria-label={label}
      onClick={clear}
    >
      <svg width={width} height={14} viewBox={`0 0 ${width} 14`}>
        {SCORE_TICKS.map((tick) => (
          <text
            key={tick}
            // Clamped so "0" and "10k" stay inside the card's edge.
            x={Math.min(Math.max(scoreX(tick), 8), width - 10)}
            y={11}
            textAnchor={
              tick === 0 ? "start" : tick === MAX_SCORE ? "end" : "middle"
            }
            fontSize={10}
            fill={chartTheme.axisQuiet}
          >
            {scoreTickLabel(tick)}
          </text>
        ))}
      </svg>

      {shown.map((group) => (
        <div className="spread-row" key={group.key}>
          <div className="spread-row-top">
            <span
              className="spread-row-label"
              title={`${group.label} — ${group.scores.length} scores`}
            >
              {group.label}{" "}
              <small className="spread-row-count">
                × {group.scores.length}
              </small>
            </span>
            {/* The group's best — the number the ranking list ranks by, so
                the chart can never disagree with the row below it. */}
            <span className="spread-row-best">{group.best}</span>
          </div>
          <svg
            width={width}
            height={trackHeight}
            viewBox={`0 0 ${width} ${trackHeight}`}
          >
            {SCORE_TICKS.map((tick) => (
              <line
                key={tick}
                x1={scoreX(tick)}
                x2={scoreX(tick)}
                y1={0}
                y2={trackHeight}
                stroke={chartTheme.grid}
                strokeWidth={1}
                opacity={tick === 0 || tick === MAX_SCORE ? 0.9 : 0.45}
              />
            ))}
            {grouping === "player" && group.scores.length >= BOX_MIN_SCORES
              ? boxMarks(group)
              : swarmMarks(
                  group,
                  grouping === "song" &&
                    initials &&
                    group.scores.length < INITIALS_MAX_SCORES,
                )}
          </svg>
        </div>
      ))}

      {shown.length < groups.length && (
        <p className="spread-more">
          … {groups.length - shown.length} more in the list below
        </p>
      )}
      <ChartTip tip={tip} />
    </div>
  );
}
