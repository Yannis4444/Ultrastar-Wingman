import type { ChartTipState } from "../hooks/useChartTip";
import "./ChartTip.css";

/**
 * The floating label a chart mark answers hover or tap with. Purely visual —
 * everything it says is also in the ranking list, so screen readers lose
 * nothing (the charts are `role="img"` summaries of the list below them).
 *
 * Positioned inside the chart's `.chart-plot` container, above the pointer;
 * near the container's top edge it flips below instead of clipping.
 */
export default function ChartTip({ tip }: { tip: ChartTipState | null }) {
  if (tip === null) return null;
  return (
    <div
      className={tip.y < 70 ? "chart-tip chart-tip-below" : "chart-tip"}
      style={{ left: tip.x, top: tip.y }}
      aria-hidden="true"
    >
      {tip.lines.map((line, index) => (
        <div className="chart-tip-line" key={index}>
          {line}
        </div>
      ))}
    </div>
  );
}
