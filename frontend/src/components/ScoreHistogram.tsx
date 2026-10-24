import type { ScoreWithContext } from "../api";
import { CHART_LABEL_SIZE, histogramLineX } from "../chartLayout";
import { MAX_SCORE, chartTheme } from "../chartTheme";
import { useChartTip } from "../hooks/useChartTip";
import { useMeasuredWidth } from "../hooks/useMeasuredWidth";
import { HISTOGRAM_BUCKETS, bucketOf, histogram } from "../stats";
import ChartTip from "./ChartTip";

const PAD_BOTTOM = 14;
const BUCKET_WIDTH = MAX_SCORE / HISTOGRAM_BUCKETS;

/** One of the score overview's three numbers, drawn as a line through the
 * bars at its score. */
export interface HistogramMark {
  kind: "worst" | "average" | "best";
  score: number;
}

/** The order the lines are painted in: gold last, so it is on top. */
const PAINT_ORDER: HistogramMark["kind"][] = ["worst", "average", "best"];

const MARK_STYLE: Record<
  HistogramMark["kind"],
  { stroke: string; dash?: string }
> = {
  worst: { stroke: chartTheme.dot },
  average: { stroke: chartTheme.axis, dash: "3 3" },
  best: { stroke: chartTheme.gold },
};

interface ScoreHistogramProps {
  scores: ScoreWithContext[];
  /** The bars cannot size themselves vertically; every caller states this. */
  height: number;
  /** Announced to screen readers, which get nothing out of the drawing. */
  label: string;
  /**
   * Lines through the bars, from the top of the drawing to the axis, at each
   * mark's score — the score overview's Best · Average · Worst. Their labels
   * are the caller's, as HTML over the drawing, where a screen reader reads
   * them. Left out, the chart is the bare distribution.
   */
  marks?: HistogramMark[];
  /**
   * The best score of the lot, and who holds it where the peaks are named:
   * its bucket is the gold one (the player card's rule), and that bucket's
   * tip says so. Left out, every bar is the accent.
   */
  best?: { score: number; holder?: string };
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
  marks = [],
  best,
}: ScoreHistogramProps) {
  const [containerRef, width] = useMeasuredWidth<HTMLDivElement>(340);
  const { tip, clear, markTip, surfaceTip } = useChartTip(containerRef);
  const buckets = histogram(scores);
  const fullest = Math.max(...buckets, 1);
  const barWidth = width / HISTOGRAM_BUCKETS;
  const axisY = height - PAD_BOTTOM;
  const barSpace = axisY - 4;
  const bestBucket = best === undefined ? null : bucketOf(best.score);
  const bucketLines = (index: number) => {
    const lines = [
      `${index * BUCKET_WIDTH} to ${(index + 1) * BUCKET_WIDTH}`,
      `${buckets[index]} score${buckets[index] === 1 ? "" : "s"}`,
    ];
    if (best !== undefined && index === bestBucket) {
      lines.push(
        best.holder === undefined
          ? `Best ${best.score}`
          : `Best ${best.score} · ${best.holder}`,
      );
    }
    return lines;
  };
  // The full-height columns tile the SVG, so every tap lands on one — the
  // surface handler only needs them for the exact-hit resolution.
  const tappable = buckets.map((_count, index) => ({
    key: `bucket:${index}`,
    x: index * barWidth + barWidth / 2,
    y: height / 2,
    lines: bucketLines(index),
  }));
  const painted = PAINT_ORDER.flatMap((kind) =>
    marks.filter((mark) => mark.kind === kind),
  );

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
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        {...surfaceTip(tappable)}
      >
        {buckets.map((count, index) => {
          const barHeight = (count / fullest) * barSpace;
          return (
            <g key={index}>
              <rect
                data-testid="histogram-bar"
                x={index * barWidth + 0.5}
                y={axisY - barHeight}
                width={Math.max(barWidth - 1, 1)}
                height={barHeight}
                fill={
                  index === bestBucket ? chartTheme.gold : chartTheme.accent
                }
              />
              {/* The whole column answers, not just the bar — an empty or
                  1px bucket is otherwise impossible to ask about. */}
              <rect
                x={index * barWidth}
                y={0}
                width={barWidth}
                height={height}
                fill="transparent"
                data-tipkey={`bucket:${index}`}
                {...markTip(`bucket:${index}`, bucketLines(index))}
              />
            </g>
          );
        })}
        <line
          x1={0}
          x2={width}
          y1={axisY}
          y2={axisY}
          stroke={chartTheme.grid}
          strokeWidth={1}
        />
        {/* Over the hit columns, so they must let a tap through to them. */}
        {painted.map((mark) => {
          const x = histogramLineX(mark.score, width);
          const style = MARK_STYLE[mark.kind];
          return (
            <line
              key={mark.kind}
              data-testid={`histogram-mark-${mark.kind}`}
              x1={x}
              x2={x}
              y1={0}
              y2={axisY}
              stroke={style.stroke}
              strokeWidth={1}
              strokeDasharray={style.dash}
              pointerEvents="none"
            />
          );
        })}
        <text
          x={0}
          y={height - 2}
          fontSize={CHART_LABEL_SIZE}
          fill={chartTheme.axisQuiet}
          textAnchor="start"
        >
          0
        </text>
        <text
          x={width}
          y={height - 2}
          fontSize={CHART_LABEL_SIZE}
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
