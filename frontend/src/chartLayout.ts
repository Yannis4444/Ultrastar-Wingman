import { MAX_SCORE } from "./chartTheme";

/**
 * Geometry the hand-drawn SVG charts share: the score scale's ticks, the
 * beeswarm placement that staggers colliding marks apart, and the wall-clock
 * ticks of the evening timeline. Pure functions — the components own the
 * drawing, this module owns the arithmetic behind it.
 */

/** Every score axis shows the same five ticks over USDX's fixed 0–10000. */
export const SCORE_TICKS = [0, 2500, 5000, 7500, 10000] as const;

/** "0", "2.5k", "10k" — the gutter is narrow, "10,000" would not fit it. */
export function scoreTickLabel(value: number): string {
  return value === 0 ? "0" : `${value / 1000}k`;
}

/** A score's place on a track of `width` pixels. */
export function scoreX(score: number, width: number): number {
  return (score / MAX_SCORE) * width;
}

export interface PlacedMark<T> {
  item: T;
  x: number;
  y: number;
}

/**
 * Beeswarm placement: each mark takes the free spot nearest the base line,
 * trying above and below alternately, so two near-identical scores sit beside
 * each other instead of one hiding the other.
 *
 * `items` must be in ascending x order — that is what lets the collision test
 * slide a window over the already-placed marks instead of rescanning all of
 * them (the all-sessions strip places every score the reader may see).
 * `maxOffset` caps how far a mark may leave the base line; a spot past the cap
 * overlaps at the cap rather than escaping the track.
 */
export function swarm<T>(
  items: T[],
  xOf: (item: T) => number,
  base: number,
  minGap: number,
  maxOffset = Number.POSITIVE_INFINITY,
): PlacedMark<T>[] {
  const placed: { x: number; y: number }[] = [];
  const gapSquared = minGap * minGap;
  let windowStart = 0;
  return items.map((item) => {
    const x = xOf(item);
    while (windowStart < placed.length && placed[windowStart].x < x - minGap) {
      windowStart++;
    }
    let y = base;
    for (let attempt = 0; ; attempt++) {
      const offset =
        Math.ceil(attempt / 2) * minGap * (attempt % 2 === 0 ? 1 : -1);
      if (Math.abs(offset) > maxOffset) break;
      y = base + offset;
      let free = true;
      for (let i = windowStart; i < placed.length; i++) {
        const dx = placed[i].x - x;
        const dy = placed[i].y - y;
        if (dx * dx + dy * dy < gapSquared) {
          free = false;
          break;
        }
      }
      if (free) break;
    }
    placed.push({ x, y });
    return { item, x, y };
  });
}

/**
 * A deterministic jitter in [-1, 1] for the raw-score dots behind a box, keyed
 * on the score's id: the cloud keeps its shape across re-renders instead of
 * reshuffling on every refetch. Knuth's multiplicative hash, folded small.
 */
export function jitterOf(id: number): number {
  return ((Math.imul(id, 2654435761) >>> 16) % 1000) / 499.5 - 1;
}

/**
 * Wall-clock ticks for the evening timeline: whole clock times (21:00, 23:00),
 * with the step chosen so the range gets at most about four labels. Walked in
 * wall-clock steps from the midnight before the range, so a DST switch lands
 * the labels on real clock times rather than on offsets of the start.
 */
export function timeTicks(start: number, end: number): number[] {
  const MINUTE = 60_000;
  const stepsMinutes = [30, 60, 120, 180, 360, 720, 1440];
  const span = Math.max(end - start, MINUTE);
  const step =
    stepsMinutes.find((minutes) => span <= 4 * minutes * MINUTE) ?? 1440;
  const ticks: number[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  // The guard only backstops a corrupt range; 250 steps of the chosen size
  // always outrun the four-step span above.
  for (let guard = 0; guard < 250 && cursor.getTime() <= end; guard++) {
    if (cursor.getTime() >= start) ticks.push(cursor.getTime());
    cursor.setMinutes(cursor.getMinutes() + step);
  }
  return ticks;
}
