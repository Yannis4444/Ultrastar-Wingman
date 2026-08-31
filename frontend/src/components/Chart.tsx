import type { EChartsOption } from "echarts";
import { BarChart, BoxplotChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import ReactEChartsCore from "echarts-for-react/lib/core";

// Only the pieces the stats page draws: importing all of `echarts` costs about
// a megabyte, this is a fraction of it. It lands in its own chunk because the
// stats route is lazy in `App.tsx` — nothing but that page pays for it.
echarts.use([
  BoxplotChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  CanvasRenderer,
]);

interface ChartProps {
  option: EChartsOption;
  /** echarts cannot size itself vertically — every caller states a height. */
  height: number;
  /**
   * The width the chart needs, for one that states its own — a standing
   * boxplot needs about 56px per category and scrolls sideways inside its box
   * once that is more than there is. `min-width: 100%` keeps it filling a box
   * that is wider than that, so echarts still measures the box. Left out, the
   * chart takes the width it is given, as every other one here does.
   */
  width?: number;
  /** Announced to screen readers, which get nothing out of the canvas. */
  label: string;
}

/**
 * The one place echarts is wired up. Component tests mock this module: jsdom has
 * no canvas, and the option building is tested on its own in `stats.test.ts`.
 */
export default function Chart({ option, height, width, label }: ChartProps) {
  return (
    <div
      role="img"
      aria-label={label}
      // The stated width sizes this wrapper rather than the canvas inside it,
      // so a scrolling box measures one element and echarts fills whatever
      // that element turns out to be.
      style={width === undefined ? undefined : { width, minWidth: "100%" }}
    >
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ height, width: "100%" }}
        // Without this a changed grouping merges into the old axis instead of
        // replacing it, leaving stale categories behind.
        notMerge
      />
    </div>
  );
}
