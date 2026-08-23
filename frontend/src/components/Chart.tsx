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
  /** Announced to screen readers, which get nothing out of the canvas. */
  label: string;
}

/**
 * The one place echarts is wired up. Component tests mock this module: jsdom has
 * no canvas, and the option building is tested on its own in `stats.test.ts`.
 */
export default function Chart({ option, height, label }: ChartProps) {
  return (
    <div role="img" aria-label={label}>
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ height }}
        // Without this a changed grouping merges into the old axis instead of
        // replacing it, leaving stale categories behind.
        notMerge
      />
    </div>
  );
}
