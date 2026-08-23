/**
 * Chart colors, mirrored from the custom properties in `index.css`.
 *
 * echarts builds its options as plain JS objects and paints to a canvas, so it
 * never sees `var(--…)`. Reading the computed properties at render time would
 * work in the browser but not in jsdom, where the pure option builders are
 * tested — so the hex values are duplicated here. Keep them in sync with
 * `index.css`; that file stays the source of truth for the CSS side.
 */
export const chartTheme = {
  /** --highlight-blue-light */
  accent: "#4b92cd",
  /** --highlight-pink-light */
  emphasis: "#9e3b95",
  /** --highlight-pink-dark */
  emphasisFill: "#6d2d90",
  /** --highlight-blue-dark, one shade up so a box body reads against --tile-bg */
  fill: "#203f59",
  /** --color-dark */
  axis: "#ccc",
  /** --input-border-color */
  grid: "#384a59",
  /** --tile-bg */
  tooltipBackground: "#1b3347",
} as const;

/** USDX scores a song out of 10000, so every score axis shares this range. */
export const MAX_SCORE = 10000;
