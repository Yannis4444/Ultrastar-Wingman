/**
 * The one palette every chart draws from. The SVG charts state their fills as
 * attributes rather than CSS classes so the same values are assertable in
 * tests; the token-backed entries mirror the custom properties in
 * `index.css`, which stays the source of truth for the CSS side — keep them
 * in sync. The rest (the dot grey, the categorical hues) exist only for
 * marks, so they get no CSS tokens (§2: no new tokens).
 */
export const chartTheme = {
  /** --highlight-blue-light */
  accent: "#4b92cd",
  /** --highlight-blue-dark, one shade up so a box body reads against --tile-bg */
  fill: "#203f59",
  /** --color-dark */
  axis: "#ccc",
  /** --input-border-color */
  grid: "#384a59",
  /** --color-darker — tick labels, which are quieter than axis names */
  axisQuiet: "#888",
  /** --highlight-gold-light — the session's best score, and nothing else */
  gold: "#faa636",
  /** Raw scores as dots: neutral on purpose, the ggplot-grey of a dark theme —
   * the box stays the only coloured thing, so the eye reads box first. */
  dot: "#aebfcc",
  /** The median line — near-white so it reads through the dot cloud. */
  median: "#e8f2fa",
  /** --tile-bg — the ring that keeps two piled marks readable as two. */
  surface: "#1b3347",
  /** A singer-initial chip on a song row, and the ink on it. */
  chip: "#2c516d",
  chipText: "#dcebf7",
  /**
   * The timeline's per-singer hues, assigned in this order to the session's
   * five best singers; everybody past them wears `categoricalRest`. Validated
   * as a set on `--tile-bg`: adjacent-pair CVD ΔE ≥ 8.4, all ≥ 3:1 contrast.
   * Never extend it by generating a sixth hue — fold into the grey instead.
   */
  categorical: ["#4b92cd", "#d95926", "#199e70", "#c98500", "#d55181"],
  categoricalRest: "#5c6d7c",
} as const;

/** USDX scores a song out of 10000, so every score axis shares this range. */
export const MAX_SCORE = 10000;
