import type { ScoreWithContext } from "../api";
import {
  CHART_LABEL_SIZE,
  SCORE_INSET,
  SCORE_TICKS,
  scoreTickLabel,
  scoreX,
  swarm,
  tickAnchor,
} from "../chartLayout";
import { chartTheme } from "../chartTheme";
import { useChartTip } from "../hooks/useChartTip";
import { useMeasuredWidth } from "../hooks/useMeasuredWidth";
import { bestScoreOf, scoreTipLines } from "../stats";
import ChartTip from "./ChartTip";
import "./ScoreStrip.css";

const DOT_RADIUS = 3.5;
const RING = 1.5;
/** Centre to centre, the closest two dots may stand before one steps aside. */
const MIN_GAP = 9;
/** Room a dot may take off the base line before the swarm overlaps instead:
 * the band grows with the dots, a monster heap of parties does not. */
const MAX_OFFSET = MIN_GAP * 6;
/** The band is never lower than this, so one row of dots is not a sliver. */
const MIN_BAND = 40;
/** What the band keeps above and below its outermost dots. */
const BAND_PAD = 11;
/** The axis under the band: its line, then the tick labels. */
const AXIS_HEIGHT = 20;

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
  /** Whether the line over the strip names the best score's singer. Off for a
   * page that is one singer's own record: their name on it says nothing. */
  named?: boolean;
  /** Whether that line prints the best score at all. Off where a score
   * summary right above already prints it, holder and all. */
  showBest?: boolean;
}

/**
 * Every score on one 0–10k strip: a beeswarm that staggers near-ties apart,
 * as high as the stagger needs and no higher, the median as a dashed line and
 * the best score as the one gold dot. The two numbers those stand for are
 * written out above the drawing, as text: the Scores page's whole-party view,
 * one singer's record, a song's best scores.
 */
export default function ScoreStrip({
  scores,
  label,
  dated = false,
  surface = chartTheme.pageBg,
  named = true,
  showBest = true,
}: ScoreStripProps) {
  const [containerRef, width] = useMeasuredWidth<HTMLDivElement>(340);
  const { tip, clear, markTip, surfaceTip } = useChartTip(containerRef);
  const best = bestScoreOf(scores);
  if (best === null) return null;

  const x = (value: number) => scoreX(value, width, SCORE_INSET);
  const ascending = [...scores].sort((a, b) => a.score - b.score);
  // Placed around 0 first: how far the swarm spreads decides the band's
  // height, and the band's height decides where its middle is.
  const placed = swarm(
    ascending,
    (score) => x(score.score),
    0,
    MIN_GAP,
    MAX_OFFSET,
  );
  const spread = Math.max(0, ...placed.map(({ y }) => Math.abs(y)));
  const band = Math.max(
    MIN_BAND,
    2 * (spread + DOT_RADIUS + RING) + 2 * BAND_PAD,
  );
  const height = band + AXIS_HEIGHT;
  const marks = placed
    .map((mark) => ({ ...mark, y: mark.y + band / 2 }))
    // The gold dot last, so no grey one is ever painted over it.
    .sort((a, b) => Number(a.item === best) - Number(b.item === best));
  // What a finger can land on: the whole SVG resolves a tap to the nearest of
  // these, so nobody has to hit a 7px dot exactly.
  const tappable = marks.map(({ item, x: markX, y }) => ({
    key: `score:${item.id}`,
    x: markX,
    y,
    lines: scoreTipLines(item, dated),
  }));
  // Linear-interpolated, exactly as `groupScores` computes its medians.
  const position = (ascending.length - 1) / 2;
  const lower = ascending[Math.floor(position)].score;
  const upper = ascending[Math.ceil(position)].score;
  const median = Math.round(lower + (position % 1) * (upper - lower));
  const medianX = x(median);

  return (
    <div className="score-strip">
      {/* The two numbers the drawing stands on, as words a screen reader
          reads and nobody has to aim at: the drawing itself is an image. */}
      <p className="score-strip-figures">
        Median <span className="score-strip-value">{median}</span>
        {showBest && (
          <>
            {" · "}Best <span className="score-strip-best">{best.score}</span>
            {named && (
              <>
                {" "}
                <span className="score-strip-value">{best.player_name}</span>
              </>
            )}
          </>
        )}
      </p>
      <div
        className="chart-plot"
        ref={containerRef}
        role="img"
        aria-label={label}
        onClick={clear}
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          {...surfaceTip(tappable)}
        >
          {SCORE_TICKS.map((tick) => (
            <line
              key={tick}
              data-testid="strip-grid"
              x1={x(tick)}
              x2={x(tick)}
              y1={0}
              y2={band}
              stroke={chartTheme.grid}
              strokeWidth={1}
              opacity={0.55}
            />
          ))}
          <line
            data-testid="strip-median"
            x1={medianX}
            x2={medianX}
            y1={0}
            y2={band}
            stroke={chartTheme.median}
            strokeWidth={1.5}
            strokeDasharray="3 4"
            opacity={0.8}
          />

          {marks.map(({ item, x: markX, y }) => (
            <g key={item.id}>
              <circle
                data-testid="strip-dot"
                cx={markX}
                cy={y}
                r={DOT_RADIUS}
                fill={item === best ? chartTheme.gold : chartTheme.dot}
                stroke={surface}
                strokeWidth={RING}
              />
              {/* The invisible target the dot answers hover on; taps resolve
                  on the SVG itself, to the nearest mark. */}
              <circle
                cx={markX}
                cy={y}
                r={8}
                fill="transparent"
                data-tipkey={`score:${item.id}`}
                {...markTip(`score:${item.id}`, scoreTipLines(item, dated))}
              />
            </g>
          ))}

          {/* The axis at the foot, every chart's: the line, the ticks under. */}
          <line
            x1={0}
            x2={width}
            y1={band + 0.5}
            y2={band + 0.5}
            stroke={chartTheme.grid}
            strokeWidth={1}
          />
          {SCORE_TICKS.map((tick) => (
            <text
              key={tick}
              x={x(tick)}
              y={band + 15}
              fontSize={CHART_LABEL_SIZE}
              fill={chartTheme.axisQuiet}
              textAnchor={tickAnchor(tick)}
            >
              {scoreTickLabel(tick)}
            </text>
          ))}
        </svg>
        <ChartTip tip={tip} />
      </div>
    </div>
  );
}
