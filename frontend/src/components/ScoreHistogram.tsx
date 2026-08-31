import type { ScoreWithContext } from "../api";
import { MAX_SCORE, chartTheme } from "../chartTheme";
import { useChartTip } from "../hooks/useChartTip";
import { useMeasuredWidth } from "../hooks/useMeasuredWidth";
import { HISTOGRAM_BUCKETS, histogram } from "../stats";
import ChartTip from "./ChartTip";

const PAD_BOTTOM = 14;
const BUCKET_WIDTH = MAX_SCORE / HISTOGRAM_BUCKETS;

interface ScoreHistogramProps {
  scores: ScoreWithContext[];
  /** The bars cannot size themselves vertically; every caller states this. */
  height: number;
  /** Announced to screen readers, which get nothing out of the drawing. */
  label: string;
}

/**
 * Bar chart of a score distribution over the full 0–10000 range. Only the
 * ends are labelled — twenty ranges never fit on a phone, but without the
 * anchors the bars have no scale at all; each bucket answers hover or tap
 * with its range and count.
 */
export default function ScoreHistogram({
  scores,
  height,
  label,
}: ScoreHistogramProps) {
  const [containerRef, width] = useMeasuredWidth<HTMLDivElement>(340);
  const { tip, clear, markTip } = useChartTip(containerRef);
  const buckets = histogram(scores);
  const fullest = Math.max(...buckets, 1);
  const barWidth = width / HISTOGRAM_BUCKETS;
  const barSpace = height - PAD_BOTTOM - 4;

  return (
    <div
      className="chart-plot"
      ref={containerRef}
      role="img"
      aria-label={label}
      onClick={clear}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {buckets.map((count, index) => {
          const barHeight = (count / fullest) * barSpace;
          return (
            <g key={index}>
              <rect
                data-testid="histogram-bar"
                x={index * barWidth + 0.5}
                y={height - PAD_BOTTOM - barHeight}
                width={Math.max(barWidth - 1, 1)}
                height={barHeight}
                fill={chartTheme.accent}
              />
              {/* The whole column answers, not just the bar — an empty or
                  1px bucket is otherwise impossible to ask about. */}
              <rect
                x={index * barWidth}
                y={0}
                width={barWidth}
                height={height}
                fill="transparent"
                {...markTip(`bucket:${index}`, [
                  `${index * BUCKET_WIDTH} – ${(index + 1) * BUCKET_WIDTH}`,
                  `${count} score${count === 1 ? "" : "s"}`,
                ])}
              />
            </g>
          );
        })}
        <line
          x1={0}
          x2={width}
          y1={height - PAD_BOTTOM}
          y2={height - PAD_BOTTOM}
          stroke={chartTheme.grid}
          strokeWidth={1}
        />
        <text
          x={0}
          y={height - 2}
          fontSize={10}
          fill={chartTheme.axisQuiet}
          textAnchor="start"
        >
          0
        </text>
        <text
          x={width}
          y={height - 2}
          fontSize={10}
          fill={chartTheme.axisQuiet}
          textAnchor="end"
        >
          {MAX_SCORE}
        </text>
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}
