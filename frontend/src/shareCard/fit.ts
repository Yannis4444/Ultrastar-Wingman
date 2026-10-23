/**
 * Text fitting for the share cards (share-cards.md §4): a line is tried at its
 * sizes from the largest down, and only at the smallest does it give up and
 * end in an ellipsis. Nothing here touches a canvas — the width of a string is
 * whatever `measure` says, so the tests hand in a fake and the renderer hands
 * in `ctx.measureText`.
 */

/** The app's own font stack (`index.css` loads no webfont), so a card looks
 * slightly different on every device — accepted in share-cards.md §3. */
export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif';

export type FontWeight = "normal" | "bold";

export interface FontSpec {
  size: number;
  weight: FontWeight;
}

/** How wide `text` is in `font`, in canvas pixels. */
export type Measure = (text: string, font: FontSpec) => number;

/** The CSS font shorthand a canvas context takes for `font`. */
export function fontString(font: FontSpec): string {
  return `${font.weight} ${font.size}px ${FONT_STACK}`;
}

export const ELLIPSIS = "…";

interface GraphemeSegmenter {
  segment(text: string): Iterable<{ segment: string }>;
}

/** `Intl.Segmenter`, which the ES2020 lib this project compiles against does
 * not declare; `undefined` in a browser without it. */
const Segmenter = (
  Intl as unknown as {
    Segmenter?: new (
      locale?: string,
      options?: { granularity: "grapheme" },
    ) => GraphemeSegmenter;
  }
).Segmenter;

/**
 * `text` as the characters a reader sees: a flag, a family emoji joined by
 * zero-width joiners or a letter with its combining accent stays one piece,
 * so no cut leaves half of it on the card. Code points where the browser has
 * no `Intl.Segmenter`, which still keeps every surrogate pair whole.
 */
export function graphemes(text: string): string[] {
  if (Segmenter === undefined) return Array.from(text);
  return Array.from(
    new Segmenter(undefined, { granularity: "grapheme" }).segment(text),
    (part) => part.segment,
  );
}

/**
 * `text` cut down until it and an ellipsis fit `maxWidth`, or `text` itself
 * when it already fits. Cut on characters, not words: a name has one word, and
 * the ellipsis says that something was cut either way. Trailing spaces go
 * with the cut, so a line never reads "Chiara …".
 */
export function ellipsize(
  text: string,
  font: FontSpec,
  maxWidth: number,
  measure: Measure,
): string {
  if (measure(text, font) <= maxWidth) return text;
  const chars = graphemes(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = chars.slice(0, middle).join("").trimEnd() + ELLIPSIS;
    if (measure(candidate, font) <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return chars.slice(0, low).join("").trimEnd() + ELLIPSIS;
}

export interface FittedLine {
  text: string;
  size: number;
}

/**
 * One line: the first size `text` fits at whole, or the last size with the
 * text ellipsized — a singer's name, 48 → 36, then the ellipsis.
 */
export function fitLine(
  text: string,
  sizes: readonly number[],
  weight: FontWeight,
  maxWidth: number,
  measure: Measure,
): FittedLine {
  for (const size of sizes) {
    if (measure(text, { size, weight }) <= maxWidth) return { text, size };
  }
  const size = sizes[sizes.length - 1];
  return { text: ellipsize(text, { size, weight }, maxWidth, measure), size };
}

/**
 * Greedy word wrap of `text` into lines no wider than `maxWidth`. A word wider
 * than the whole line is broken on characters, or a long run without a space
 * (a URL-like title, a CJK title) would never fit and never wrap.
 */
export function wrap(
  text: string,
  font: FontSpec,
  maxWidth: number,
  measure: Measure,
): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter((part) => part !== "")) {
    const joined = current === "" ? word : `${current} ${word}`;
    if (measure(joined, font) <= maxWidth) {
      current = joined;
      continue;
    }
    if (current !== "") lines.push(current);
    current = "";
    // The word alone: broken into as many full lines as it needs.
    let rest = word;
    while (measure(rest, font) > maxWidth) {
      const chars = graphemes(rest);
      let take = 1;
      while (
        take < chars.length &&
        measure(chars.slice(0, take + 1).join(""), font) <= maxWidth
      ) {
        take++;
      }
      lines.push(chars.slice(0, take).join(""));
      rest = chars.slice(take).join("");
    }
    current = rest;
  }
  if (current !== "") lines.push(current);
  return lines;
}

export interface FittedLines {
  lines: string[];
  size: number;
}

/**
 * A wrapping block of at most `maxLines` lines — a song title, 52 → 44, then
 * an ellipsis at the end of the last line. Never more lines than that: at the
 * smallest size the first `maxLines - 1` lines stand as wrapped and everything
 * after them is folded onto the last line and cut.
 */
export function fitLines(
  text: string,
  sizes: readonly number[],
  weight: FontWeight,
  maxWidth: number,
  maxLines: number,
  measure: Measure,
): FittedLines {
  for (const size of sizes) {
    const lines = wrap(text, { size, weight }, maxWidth, measure);
    if (lines.length <= maxLines) return { lines, size };
  }
  const size = sizes[sizes.length - 1];
  const font = { size, weight };
  // Every wrapped line is a prefix of what is left of the normalised text, so
  // the remainder is that text with the kept lines taken off its front — a
  // word broken across lines comes back whole, without a space in it.
  let rest = text
    .split(/\s+/)
    .filter((part) => part !== "")
    .join(" ");
  const kept = wrap(rest, font, maxWidth, measure).slice(0, maxLines - 1);
  for (const line of kept) rest = rest.slice(line.length).trimStart();
  // The rest is longer than one line by construction, so this always cuts.
  return { lines: [...kept, ellipsize(rest, font, maxWidth, measure)], size };
}
