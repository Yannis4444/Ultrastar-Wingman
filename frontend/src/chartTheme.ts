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
  /** --highlight-blue-dark, one shade up so a box body reads as a body */
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
  /** --bg — what every chart sits on, flat (§1.1), and so the ring that
   * keeps two piled marks readable as two. */
  pageBg: "#021720",
  /** A singer-initial chip on a song row, and the ink on it. */
  chip: "#2c516d",
  chipText: "#dcebf7",
  /**
   * The timeline's per-singer hues, assigned in this order to the session's
   * five best singers; everybody past them wears `categoricalRest`. Validated
   * as a set on `--bg` (`#021720`, where the timeline is drawn since the
   * charts went flat; the dataviz validator, dark mode, 2026-10-18): every
   * hue inside the L 0.48–0.67 band, adjacent-pair CVD ΔE ≥ 8.4 (protan,
   * `#c98500` ↔ `#199e70`), normal-vision ΔE ≥ 19.3, contrast 4.65:1 at the
   * lowest (`#d55181`) and 3.43:1 for `categoricalRest`. (It also passed on
   * `--tile-bg`, at 3.30:1 lowest — the darker ground only raises contrast.)
   * Never extend it by generating a sixth hue — fold into the grey instead.
   */
  categorical: ["#4b92cd", "#d95926", "#199e70", "#c98500", "#d55181"],
  categoricalRest: "#5c6d7c",
} as const;

/** USDX scores a song out of 10000, so every score axis shares this range. */
export const MAX_SCORE = 10000;
