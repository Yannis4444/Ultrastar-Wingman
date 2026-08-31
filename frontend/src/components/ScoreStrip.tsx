import type { ScoreWithContext } from "../api";
import {
  SCORE_TICKS,
  scoreTickLabel,
  swarm,
  type PlacedMark,
} from "../chartLayout";
import { MAX_SCORE, chartTheme } from "../chartTheme";
import { useChartTip } from "../hooks/useChartTip";
import { useMeasuredWidth } from "../hooks/useMeasuredWidth";
import { scoreTipLines } from "../stats";
import ChartTip from "./ChartTip";

const HEIGHT = 175;
const PAD_BOTTOM = 20;
const BASE = (HEIGHT - PAD_BOTTOM) / 2 + 10;
/** Room a mark may take off the base line before the swarm starts overlapping
 * instead — the strip's height is fixed, a monster party is not. */
const MAX_OFFSET = BASE - 42;
const DOT_RADIUS = 3;
const MIN_GAP = 7.5;

interface ScoreStripProps {
  scores: ScoreWithContext[];
  /** Announced to screen readers, which get nothing out of the drawing —
   * everything in it is also in the ranking list below. */
  label: string;
  /** Whether the tooltips date a score: on for a strip that spans parties. */
  dated?: boolean;
  /** The colour behind the chart, which the dot rings stroke so two piled
   * marks still read as two — a ring painted for the wrong ground haloes. */
  surface?: string;
  /** Whether the gold label names the best score's singer. Off for a page
   * that is one singer's own record: their name on it says nothing. */
  named?: boolean;
}

/**
 * Every score of the session on one 0–10k strip: a beeswarm that staggers
 * near-ties apart, the session median as a dashed line, the best score in
 * gold with its singer named. The whole-session headline the Scores page
 * leads with — and the whole chart once grouping is off.
 */
export default function ScoreStrip({
  scores,
  label,
  dated = false,
  surface = chartTheme.surface,
  named = true,
}: ScoreStripProps) {
  const [containerRef, width] = useMeasuredWidth<HTMLDivElement>(340);
  const { tip, clear, markTip, surfaceTip } = useChartTip(containerRef);
  if (scores.length === 0) return null;

  const scoreX = (value: number) => 8 + (value / MAX_SCORE) * (width - 16);
  const ascending = [...scores].sort((a, b) => a.score - b.score);
  const best = ascending[ascending.length - 1];
  const marks: PlacedMark<ScoreWithContext>[] = swarm(
    ascending,
    (score) => scoreX(score.score),
    BASE,
    MIN_GAP,
    MAX_OFFSET,
  );
  // What a finger can land on: the whole SVG resolves a tap to the nearest of
  // these, so nobody has to hit a 6px dot exactly.
  const tappable = marks.map(({ item, x, y }) => ({
    key: `score:${item.id}`,
    x,
    y,
    lines: scoreTipLines(item, dated),
  }));
  // Linear-interpolated, exactly as `groupScores` computes its medians.
  const position = (ascending.length - 1) / 2;
  const lower = ascending[Math.floor(position)].score;
  const upper = ascending[Math.ceil(position)].score;
  const median = Math.round(lower + (position % 1) * (upper - lower));
  const medianX = scoreX(median);

  return (
    <div
      className="chart-plot"
      ref={containerRef}
      role="img"
      aria-label={label}
      onClick={clear}
    >
      <svg
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        {...surfaceTip(tappable)}
      >
        {SCORE_TICKS.map((tick) => (
          <g key={tick}>
            <line
              x1={scoreX(tick)}
              x2={scoreX(tick)}
              y1={6}
              y2={HEIGHT - PAD_BOTTOM}
              stroke={chartTheme.grid}
              strokeWidth={1}
              opacity={tick === 0 || tick === MAX_SCORE ? 0.9 : 0.4}
            />
            <text
              x={scoreX(tick)}
              y={HEIGHT - 6}
              fontSize={10}
              fill={chartTheme.axisQuiet}
              textAnchor={
                tick === 0 ? "start" : tick === MAX_SCORE ? "end" : "middle"
              }
            >
              {scoreTickLabel(tick)}
            </text>
          </g>
        ))}

        <line
          x1={medianX}
          x2={medianX}
          y1={6}
          y2={HEIGHT - PAD_BOTTOM}
          stroke={chartTheme.median}
          strokeWidth={1.5}
          strokeDasharray="3 4"
          opacity={0.8}
        />
        <text
          x={medianX - 6}
          y={16}
          textAnchor="end"
          fontSize={10.5}
          fill={chartTheme.axis}
        >
          median {median}
        </text>

        {marks.map(({ item, x, y }) => (
          <g key={item.id}>
            <circle
              data-testid="strip-dot"
              cx={x}
              cy={y}
              r={DOT_RADIUS}
              fill={item === best ? chartTheme.gold : chartTheme.accent}
              stroke={surface}
              strokeWidth={2}
            />
            {/* The invisible target the dot answers hover on; taps resolve on
                the SVG itself, to the nearest mark. */}
            <circle
              cx={x}
              cy={y}
              r={8}
              fill="transparent"
              data-tipkey={`score:${item.id}`}
              {...markTip(`score:${item.id}`, scoreTipLines(item, dated))}
            />
          </g>
        ))}

        <text
          x={Math.min(scoreX(best.score), width - 10)}
          y={30}
          textAnchor="end"
          fontSize={11}
          fontWeight={600}
          fill={chartTheme.gold}
        >
          {named ? `${best.score} · ${best.player_name}` : best.score}
        </text>
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}
