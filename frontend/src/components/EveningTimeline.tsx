import type { ScoreWithContext } from "../api";
import { SCORE_TICKS, scoreTickLabel, timeTicks } from "../chartLayout";
import { MAX_SCORE, chartTheme } from "../chartTheme";
import { parseServerTime, shortTime } from "../duration";
import { useChartTip } from "../hooks/useChartTip";
import { useMeasuredWidth } from "../hooks/useMeasuredWidth";
import {
  groupScores,
  scorePlayerKey,
  scoreTipLines,
  sortGroups,
} from "../stats";
import ChartTip from "./ChartTip";
import "./EveningTimeline.css";

const HEIGHT = 210;
const PAD = { left: 30, right: 10, top: 14, bottom: 22 };
const DOT_RADIUS = 4;

interface EveningTimelineProps {
  scores: ScoreWithContext[];
  /** Announced to screen readers, which get nothing out of the drawing. */
  label: string;
}

/**
 * The party read forwards: every score at the wall-clock moment it landed,
 * one dot each. The session's five best singers get the five categorical
 * hues; everybody else folds into one grey — the set is validated for
 * colour-blind separation and must never grow a sixth hue. A duet's dots
 * share their minute, because that is what happened. The session's best
 * score wears a gold ring and its number.
 */
export default function EveningTimeline({
  scores,
  label,
}: EveningTimelineProps) {
  const [containerRef, width] = useMeasuredWidth<HTMLDivElement>(340);
  const { tip, clear, markTip, surfaceTip } = useChartTip(containerRef);
  if (scores.length === 0) return null;

  // The five best singers wear the hues, strongest first — the same order the
  // ranking below opens on, so the legend reads like the podium.
  const groups = sortGroups(groupScores(scores, "player"), "best");
  const colored = groups.slice(0, chartTheme.categorical.length);
  const colorByKey = new Map(
    colored.map((group, index) => [
      scorePlayerKey(group.scores[0]),
      chartTheme.categorical[index],
    ]),
  );
  const colorOf = (score: ScoreWithContext) =>
    colorByKey.get(scorePlayerKey(score)) ?? chartTheme.categoricalRest;
  const rest = groups.length - colored.length;

  const times = scores.map((score) => parseServerTime(score.recorded_at));
  const earliest = Math.min(...times);
  const latest = Math.max(...times);
  // A hair of padding keeps the first and last dot off the plot's edges; a
  // single-sing session still gets a real span to draw on.
  const margin = Math.max((latest - earliest) * 0.04, 5 * 60_000);
  const start = earliest - margin;
  const end = latest + margin;
  const timeX = (at: number) =>
    PAD.left + ((at - start) / (end - start)) * (width - PAD.left - PAD.right);
  const scoreY = (value: number) =>
    PAD.top + (1 - value / MAX_SCORE) * (HEIGHT - PAD.top - PAD.bottom);

  const best = scores.reduce((top, score) =>
    score.score > top.score ? score : top,
  );

  // What a finger can land on: the whole SVG resolves a tap to the nearest of
  // these, so nobody has to hit a dot exactly.
  const placed = scores.map((score) => ({
    score,
    x: timeX(parseServerTime(score.recorded_at)),
    y: scoreY(score.score),
  }));
  const tappable = placed.map(({ score, x, y }) => ({
    key: `score:${score.id}`,
    x,
    y,
    lines: scoreTipLines(score, false),
  }));

  return (
    <div role="img" aria-label={label}>
      <div className="timeline-legend">
        {colored.map((group, index) => (
          <span key={group.key}>
            <i
              style={{ backgroundColor: chartTheme.categorical[index] }}
              aria-hidden="true"
            />
            {group.label}
          </span>
        ))}
        {rest > 0 && (
          <span>
            <i
              style={{ backgroundColor: chartTheme.categoricalRest }}
              aria-hidden="true"
            />
            {rest} more
          </span>
        )}
      </div>
      <div className="chart-plot" ref={containerRef} onClick={clear}>
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          {...surfaceTip(tappable)}
        >
          {SCORE_TICKS.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={scoreY(tick)}
                y2={scoreY(tick)}
                stroke={chartTheme.grid}
                strokeWidth={1}
                opacity={tick === 0 ? 0.9 : 0.4}
              />
              {tick % 5000 === 0 && (
                <text
                  x={PAD.left - 6}
                  y={scoreY(tick) + 3.5}
                  textAnchor="end"
                  fontSize={10}
                  fill={chartTheme.axisQuiet}
                >
                  {scoreTickLabel(tick)}
                </text>
              )}
            </g>
          ))}
          {timeTicks(start, end).map((tick) => (
            <text
              key={tick}
              x={timeX(tick)}
              y={HEIGHT - 6}
              textAnchor="middle"
              fontSize={10}
              fill={chartTheme.axisQuiet}
            >
              {shortTime(new Date(tick).toISOString())}
            </text>
          ))}

          <circle
            cx={timeX(parseServerTime(best.recorded_at))}
            cy={scoreY(best.score)}
            r={7.5}
            fill="none"
            stroke={chartTheme.gold}
            strokeWidth={2}
          />
          <text
            x={timeX(parseServerTime(best.recorded_at)) - 11}
            y={scoreY(best.score) + 4}
            textAnchor="end"
            fontSize={11}
            fontWeight={600}
            fill={chartTheme.gold}
          >
            {best.score}
          </text>

          {placed.map(({ score, x, y }) => (
            <g key={score.id}>
              <circle
                data-testid="timeline-dot"
                cx={x}
                cy={y}
                r={DOT_RADIUS}
                fill={colorOf(score)}
                stroke={chartTheme.surface}
                strokeWidth={2}
              />
              {/* The invisible target the dot answers hover on; taps resolve
                  on the SVG itself, to the nearest mark. */}
              <circle
                cx={x}
                cy={y}
                r={8}
                fill="transparent"
                data-tipkey={`score:${score.id}`}
                {...markTip(`score:${score.id}`, scoreTipLines(score, false))}
              />
            </g>
          ))}
        </svg>
        <ChartTip tip={tip} />
      </div>
    </div>
  );
}
