import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * The rendered width of an element, for the SVG charts: SVG text does not
 * reflow, so a chart draws itself at the pixel width its container actually
 * has and redraws when that changes (a rotated phone, a resized window).
 *
 * jsdom lays nothing out and has no `ResizeObserver`, so tests render at the
 * fallback width — pick one a phone-sized card would really have.
 */
export function useMeasuredWidth<T extends HTMLElement>(
  fallback: number,
): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = () => {
      const measured = element.clientWidth;
      // A display: none ancestor measures 0 — keep the last real width
      // rather than collapsing every mark onto x = 0.
      if (measured > 0) setWidth(measured);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
