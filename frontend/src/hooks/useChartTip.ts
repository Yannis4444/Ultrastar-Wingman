import { useRef, useState, type RefObject } from "react";

export interface ChartTipState {
  /** What the tip belongs to — a second tap on the same mark closes it. */
  key: string;
  /** Where to stand, relative to the chart's `.chart-plot` container. */
  x: number;
  y: number;
  /** What it says, one line each; the first line is the mark's name. */
  lines: string[];
}

/** One thing a tap can land on, in the coordinates of the SVG it is in. */
export interface SurfaceMark {
  key: string;
  x: number;
  y: number;
  lines: string[];
}

interface MarkTipProps {
  onPointerEnter: (event: React.PointerEvent) => void;
  onPointerLeave: (event: React.PointerEvent) => void;
}

/**
 * How far a tap may land from a mark and still mean it, in px. A fingertip
 * covers ~40px and the marks are 6px — without this, most taps on a phone
 * missed, and every miss landed on the background, which dismisses. The
 * value is roughly a fingertip's radius plus half a mark.
 */
const TAP_RANGE = 28;

/**
 * The tooltip state of one chart. A mouse gets hover (enter shows, leave
 * hides, per mark via `markTip`); a finger gets taps, resolved on the whole
 * SVG via `surfaceTip`: the tap means the mark it landed on, or failing that
 * the nearest one within `TAP_RANGE` — never a pixel hunt. A second tap on
 * the same mark closes the tip; a tap on nothing falls through to the
 * container, whose `onClick` gets the returned `clear` and dismisses.
 */
export function useChartTip(container: RefObject<HTMLElement | null>): {
  tip: ChartTipState | null;
  clear: () => void;
  markTip: (key: string, lines: string[]) => MarkTipProps;
  surfaceTip: (marks: SurfaceMark[]) => {
    onPointerDown: (event: React.PointerEvent<SVGSVGElement>) => void;
    onClick: (event: React.MouseEvent<SVGSVGElement>) => void;
  };
} {
  const [tip, setTip] = useState<ChartTipState | null>(null);
  // What kind of pointer last went down on a chart. WebKit stamps the click
  // a tap synthesizes with pointerType "mouse" (Chrome says "touch"), so the
  // click's own pointerType cannot be trusted — the pointerdown that always
  // precedes it can, on every engine.
  const lastPointerType = useRef<string | undefined>(undefined);

  // Where a point of an SVG sits inside the container — the tip is absolutely
  // positioned in the container, but a chart can hold several row SVGs.
  const place = (svg: Element, x: number, y: number) => {
    const rect = container.current?.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    if (rect === undefined) return { x: 0, y: 0 };
    // Clamped so the tip never pokes out of the chart into the page's width —
    // the page must not gain a sideways scroll over a tooltip (§1.11).
    const margin = Math.min(100, rect.width / 2);
    return {
      x: Math.min(
        Math.max(svgRect.left - rect.left + x, margin),
        rect.width - margin,
      ),
      y: svgRect.top - rect.top + y,
    };
  };

  const markTip = (key: string, lines: string[]): MarkTipProps => ({
    onPointerEnter: (event) => {
      if (event.pointerType !== "mouse") return;
      const svg = (event.currentTarget as Element).closest("svg");
      if (svg === null) return;
      const svgRect = svg.getBoundingClientRect();
      setTip({
        key,
        lines,
        ...place(
          svg,
          event.clientX - svgRect.left,
          event.clientY - svgRect.top,
        ),
      });
    },
    onPointerLeave: (event) => {
      if (event.pointerType === "mouse") setTip(null);
    },
  });

  const surfaceTip = (marks: SurfaceMark[]) => ({
    onPointerDown: (event: React.PointerEvent<SVGSVGElement>) => {
      lastPointerType.current = event.pointerType;
    },
    onClick: (event: React.MouseEvent<SVGSVGElement>) => {
      // The tracked pointerdown type first; the click's own only for a
      // browser without pointer events, where no pointerdown was seen.
      const pointerType =
        lastPointerType.current ??
        ((event.nativeEvent as PointerEvent).pointerType as string | undefined);
      // What the click actually landed on, when it is a mark: exact hits stay
      // exact whatever the geometry says (and jsdom, which lays nothing out,
      // resolves clicks this way in tests).
      const hitKey =
        (event.target as Element)
          .closest?.("[data-tipkey]")
          ?.getAttribute("data-tipkey") ?? null;
      if (pointerType === "mouse") {
        // Hover owns the mouse tip. A click on a mark stays inert rather
        // than dismissing the tip under the pointer; one beside the marks
        // falls through to the container's dismissal.
        if (hitKey !== null) event.stopPropagation();
        return;
      }
      const svgRect = event.currentTarget.getBoundingClientRect();
      const localX = event.clientX - svgRect.left;
      const localY = event.clientY - svgRect.top;
      let mark =
        hitKey === null
          ? null
          : (marks.find((candidate) => candidate.key === hitKey) ?? null);
      if (mark === null) {
        let closest = TAP_RANGE * TAP_RANGE;
        for (const candidate of marks) {
          const dx = candidate.x - localX;
          const dy = candidate.y - localY;
          const distance = dx * dx + dy * dy;
          if (distance < closest) {
            closest = distance;
            mark = candidate;
          }
        }
      }
      // A tap on nothing bubbles on to the container, which dismisses.
      if (mark === null) return;
      event.stopPropagation();
      const chosen = mark;
      // Placed before setTip: React replays the updater after dispatch, when
      // the synthetic event's currentTarget is gone.
      const position = place(event.currentTarget, chosen.x, chosen.y);
      setTip((current) =>
        current?.key === chosen.key
          ? null
          : { key: chosen.key, lines: chosen.lines, ...position },
      );
    },
  });

  return { tip, clear: () => setTip(null), markTip, surfaceTip };
}
