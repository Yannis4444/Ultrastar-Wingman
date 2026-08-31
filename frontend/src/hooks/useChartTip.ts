import { useState, type RefObject } from "react";

export interface ChartTipState {
  /** What the tip belongs to — a second tap on the same mark closes it. */
  key: string;
  /** Where to stand, relative to the chart's `.chart-plot` container. */
  x: number;
  y: number;
  /** What it says, one line each; the first line is the mark's name. */
  lines: string[];
}

interface MarkTipProps {
  onPointerEnter: (event: React.PointerEvent) => void;
  onPointerLeave: (event: React.PointerEvent) => void;
  onClick: (event: React.MouseEvent) => void;
}

/**
 * The tooltip state of one chart. A mouse gets hover (enter shows, leave
 * hides); a finger gets taps (one shows, the same mark again or the chart
 * background hides) — `pointerType` tells the two apart, and a plain click
 * without one counts as a tap so the charts stay usable everywhere.
 *
 * The container is the element the tip is positioned in (`.chart-plot`); give
 * its `onClick` the returned `clear` so a tap beside the marks dismisses.
 */
export function useChartTip(container: RefObject<HTMLElement | null>): {
  tip: ChartTipState | null;
  clear: () => void;
  markTip: (key: string, lines: string[]) => MarkTipProps;
} {
  const [tip, setTip] = useState<ChartTipState | null>(null);

  const at = (event: { clientX: number; clientY: number }) => {
    const rect = container.current?.getBoundingClientRect();
    if (rect === undefined) return { x: 0, y: 0 };
    // Clamped so the tip never pokes out of the card into the page's width —
    // the page must not gain a sideways scroll over a tooltip (§1.11).
    const margin = Math.min(100, rect.width / 2);
    return {
      x: Math.min(
        Math.max(event.clientX - rect.left, margin),
        rect.width - margin,
      ),
      y: event.clientY - rect.top,
    };
  };

  const markTip = (key: string, lines: string[]): MarkTipProps => ({
    onPointerEnter: (event) => {
      if (event.pointerType === "mouse") setTip({ key, lines, ...at(event) });
    },
    onPointerLeave: (event) => {
      if (event.pointerType === "mouse") setTip(null);
    },
    onClick: (event) => {
      // The chart container's own click is the "tap beside" dismissal.
      event.stopPropagation();
      const pointerType = (event.nativeEvent as PointerEvent).pointerType as
        string | undefined;
      if (pointerType === "mouse") return;
      setTip((current) =>
        current?.key === key ? null : { key, lines, ...at(event) },
      );
    },
  });

  return { tip, clear: () => setTip(null), markTip };
}
