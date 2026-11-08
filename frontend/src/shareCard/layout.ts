import { scoreTickLabel, scoreX, swarm, jitterOf } from "../chartLayout";
import { chartTheme, MAX_SCORE } from "../chartTheme";
import type { IconName } from "../components/icons";
import { CHART_MIN_SCORES, countWord } from "../stats";
import {
  FACES_SHOWN,
  RANKING_NOTE,
  type AchievementCardContent,
  type CardDot,
  type CardImage,
  type CardNumbers,
  type CardRank,
  type PartyCardContent,
  type PlayerCardContent,
  type ScoreCardContent,
} from "./content";
import { fitLine, fitLines, type FontWeight, type Measure } from "./fit";

/**
 * Where everything on a share card goes (share-cards.md §4), as plain boxes in
 * canvas pixels: the renderer paints them and the tests check them — every box
 * inside the card, no two regions overlapping, nothing that must be read under
 * 32 px. The numbers are §4's, at 1080 wide with side margins of 72.
 */

export type CardFormat = "square" | "story";
export type ScoreLook = "dark" | "cover";
export type PartyLook = "dark" | "mosaic";
/** What a party card is built around: the podium, or the spread rows (§7.1). */
export type PartyFocus = "podium" | "spread";
/** What stands under the podium on a Dark card: the *Podium* slide's ranks
 * 4–6 or the *Strip* slide's score strip (a story draws the rows on both and
 * the strip on *Strip* alone); `none` where the slide has nothing to put
 * there. */
export type UnderPodium = "ranking" | "strip" | "none";

export interface ScoreCardOptions {
  format: CardFormat;
  look: ScoreLook;
}

export interface PartyCardOptions {
  format: CardFormat;
  look: PartyLook;
  focus: PartyFocus;
  under: UnderPodium;
}

/** What a player card is built around (share-cards §9): one of its three
 * designs, or nothing under the head and the numbers (`none`) where the card
 * cannot draw the design asked for. */
export type PlayerFocus = "histogram" | "strip" | "songs" | "none";

export interface PlayerCardOptions {
  format: CardFormat;
  focus: PlayerFocus;
}

/** An achievement card has one design and nothing to choose but its format
 * (share-cards §10). */
export interface AchievementCardOptions {
  format: CardFormat;
}

/** The app's tokens (`index.css`), as the canvas needs them: literal colours. */
export const CARD_COLORS = {
  /** --bg */
  bg: "#021720",
  /** --input-bg: the fallback tiles and the bar's track */
  inputBg: "#1c2832",
  /** --color */
  text: "#fff",
  /** --color-dark */
  textDark: "#ccc",
  /** --color-darker */
  textDarker: "#888",
  /** --highlight-blue-light: the rating word */
  blue: "#4b92cd",
  /** --highlight-pink-light: the podium numerals */
  pink: "#9e3b95",
  /** --highlight-pink-dark: the score bar's fill, as `LastSong` draws it */
  pinkDark: "#6d2d90",
  /** --highlight-gold-light: the best score and nothing else */
  gold: "#faa636",
} as const;

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT: Record<CardFormat, number> = {
  square: 1080,
  story: 1920,
};
const MARGIN = 72;
const CONTENT = CARD_WIDTH - 2 * MARGIN;
const RIGHT = CARD_WIDTH - MARGIN;
const CENTER = CARD_WIDTH / 2;

/**
 * Where content may go. The story apps draw their own controls over the top
 * and bottom 270 px of a story, so it carries background only there (§3.2).
 */
export const SAFE_AREA: Record<CardFormat, { top: number; bottom: number }> = {
  square: { top: MARGIN, bottom: 1080 - MARGIN },
  story: { top: 270, bottom: 1650 },
};

/** The smallest size anything that must be read is set in (§4.3), and the
 * brand's own. Coloured text is never under `COLOURED_MIN`, bold. */
export const MIN_TEXT = 32;
export const MIN_BRAND_TEXT = 28;
export const COLOURED_MIN = 40;

/** The ticks of a card's score axis: three, as §4.2 drew them, because five
 * labels at 32 px crowd a track the width of a phone screen's third. */
export const CARD_TICKS = [0, 5000, 10000] as const;

/** A box that clips keeps its line-height at 1.3 (ui-guidelines §2). */
const LEADING = 1.3;

export interface Run {
  text: string;
  color: string;
  weight: FontWeight;
}

/** Which part of the card an element belongs to. Elements of one region may
 * overlap (a dot on a gridline); two regions never do. */
export type Region = string;

export interface TextElement {
  kind: "text";
  region: Region;
  /** The line box: `x` is its left edge whatever the alignment was. */
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  runs: Run[];
}

export interface ImageElement {
  kind: "image";
  region: Region;
  x: number;
  y: number;
  w: number;
  h: number;
  image: CardImage;
  /** Corner radius in px: 0 for covers (artwork), 20% for people. */
  radius: number;
  /** The colour of the fallback letter: `#888` on a cover, `#ccc` on a
   * person, as `CoverImage` and `PlayerAvatar` draw them. */
  initialColor: string;
  shadow: boolean;
}

export interface RectElement {
  kind: "rect";
  region: Region;
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  fill: string;
  stroke: string | null;
  lineWidth: number;
}

export interface CircleElement {
  kind: "circle";
  region: Region;
  cx: number;
  cy: number;
  r: number;
  fill: string | null;
  stroke: string | null;
  lineWidth: number;
}

export interface LineElement {
  kind: "line";
  region: Region;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  dash: number[] | null;
  alpha: number;
}

export interface IconElement {
  kind: "icon";
  region: Region;
  name: IconName;
  x: number;
  y: number;
  size: number;
  color: string;
}

/** The Wingman logo, drawn as it is in its own colours (§1.8). */
export interface LogoElement {
  kind: "logo";
  region: Region;
  x: number;
  y: number;
  size: number;
}

export type CardElement =
  | TextElement
  | ImageElement
  | RectElement
  | CircleElement
  | LineElement
  | IconElement
  | LogoElement;

export interface MosaicCell {
  url: string;
  x: number;
  y: number;
  size: number;
}

export type CardBackground =
  | { kind: "dark" }
  /** The cover blurred over the whole card under `--bg` at 70%. */
  | { kind: "cover"; url: string }
  /** The party's covers in a grid under one uniform scrim — no band, no
   * gradient: the covers show behind the text as behind the podium. */
  | { kind: "mosaic"; cells: MosaicCell[] };

export interface CardLayout {
  width: number;
  height: number;
  background: CardBackground;
  elements: CardElement[];
  /** Whether every text and the logo are painted over a halo (`HALO`): on a
   * Mosaic, where sharp covers stand behind them. */
  halo: boolean;
}

/** The scrim over a background picture: `--bg` at this opacity — §3.1's 70%
 * over the blurred cover, 84% over the Mosaic's sharp ones. */
export const SCRIM_ALPHA = { cover: 0.7, mosaic: 0.84 } as const;

/**
 * What a Mosaic's text and logo stand on (§3.1): a scrim alone let a cover's
 * lettering through the grey labels, so each is painted `passes` times with a
 * `--bg` shadow at 90% blurred `blur` px and no offset, then plainly on top.
 * A shadow rather than `ctx.filter`, which WebKit does not hold to.
 */
export const HALO = {
  color: "rgba(2, 23, 32, 0.9)",
  blur: 20,
  passes: 2,
} as const;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The box an element takes, for the overlap and bounds checks. */
export function elementBox(element: CardElement): Box {
  switch (element.kind) {
    case "circle": {
      const reach = element.r + (element.stroke ? element.lineWidth / 2 : 0);
      return {
        x: element.cx - reach,
        y: element.cy - reach,
        w: 2 * reach,
        h: 2 * reach,
      };
    }
    case "line": {
      const half = element.width / 2;
      const x = Math.min(element.x1, element.x2);
      const y = Math.min(element.y1, element.y2);
      // A line's caps are butt: it reaches half its width sideways only.
      const vertical = element.x1 === element.x2;
      return {
        x: vertical ? x - half : x,
        y: vertical ? y : y - half,
        w: vertical ? element.width : Math.abs(element.x2 - element.x1),
        h: vertical ? Math.abs(element.y2 - element.y1) : element.width,
      };
    }
    case "icon":
    case "logo":
      return {
        x: element.x,
        y: element.y,
        w: element.size,
        h: element.size,
      };
    default:
      return { x: element.x, y: element.y, w: element.w, h: element.h };
  }
}

// ---------------------------------------------------------------------------
// Building blocks

type Align = "left" | "center" | "right";

class Builder {
  readonly elements: CardElement[] = [];
  readonly measure: Measure;

  constructor(measure: Measure) {
    this.measure = measure;
  }

  width(runs: Run[], size: number): number {
    return runs.reduce(
      (sum, run) => sum + this.measure(run.text, { size, weight: run.weight }),
      0,
    );
  }

  /**
   * One line of runs. `anchor` is the left edge, the centre or the right edge
   * by `align`; `y` is the top of the line box, `leading` its height in em.
   */
  text(
    region: Region,
    runs: Run[],
    size: number,
    anchor: number,
    y: number,
    align: Align = "left",
    leading = LEADING,
  ): TextElement {
    const w = this.width(runs, size);
    const x =
      align === "left"
        ? anchor
        : align === "center"
          ? anchor - w / 2
          : anchor - w;
    const element: TextElement = {
      kind: "text",
      region,
      x,
      y,
      w,
      h: size * leading,
      size,
      runs,
    };
    this.elements.push(element);
    return element;
  }

  image(
    region: Region,
    box: Box,
    image: CardImage,
    person: boolean,
    shadow = false,
  ): void {
    this.elements.push({
      kind: "image",
      region,
      ...box,
      image,
      radius: person ? box.w * 0.2 : 0,
      initialColor: person ? CARD_COLORS.textDark : CARD_COLORS.textDarker,
      shadow,
    });
  }

  push(element: CardElement): void {
    this.elements.push(element);
  }
}

const run = (
  text: string,
  color: string = CARD_COLORS.text,
  weight: FontWeight = "normal",
): Run => ({ text, color, weight });
const bold = (text: string, color: string = CARD_COLORS.text): Run =>
  run(text, color, "bold");

function lineHeight(size: number): number {
  return size * LEADING;
}

const BRAND_LOGO = 48;
const BRAND_WORDS = [run("Ultrastar Wingman", CARD_COLORS.textDarker)];

/**
 * The Wingman logo and its words bottom left, and `note` at the right of the
 * same line — the party · date of a score, or what a party is ranked by. On
 * every card of every kind (§1.8): it is not an option.
 */
function brand(b: Builder, bottom: number, note: string | null): void {
  const top = bottom - BRAND_LOGO;
  const wordsLeft = MARGIN + BRAND_LOGO + 16;
  b.push({
    kind: "logo",
    region: "brand",
    x: MARGIN,
    y: top,
    size: BRAND_LOGO,
  });
  b.text(
    "brand",
    BRAND_WORDS,
    MIN_BRAND_TEXT,
    wordsLeft,
    top + (BRAND_LOGO - lineHeight(MIN_BRAND_TEXT)) / 2,
  );
  if (note === null) return;
  const wordsRight = wordsLeft + b.width(BRAND_WORDS, MIN_BRAND_TEXT);
  const room = RIGHT - (wordsRight + 32);
  const fitted = fitLine(note, [MIN_TEXT], "normal", room, b.measure);
  b.text(
    "brand-note",
    [run(fitted.text, CARD_COLORS.textDarker)],
    fitted.size,
    RIGHT,
    top + (BRAND_LOGO - lineHeight(MIN_TEXT)) / 2,
    "right",
  );
}

/** The flag beside a score: the trophy and *New Highscore* in gold, or the
 * summary's best arrow and *Personal best* in blue. */
function flagRuns(content: ScoreCardContent): {
  icon: IconName;
  color: string;
  label: string;
} | null {
  if (content.flag === "highscore")
    return { icon: "trophy", color: CARD_COLORS.gold, label: "New Highscore" };
  if (content.flag === "personal-best")
    return {
      icon: "arrow-up",
      color: CARD_COLORS.blue,
      label: "Personal best",
    };
  return null;
}

const FLAG_SIZE = COLOURED_MIN;
const FLAG_GAP = 10;

function flagWidth(b: Builder, content: ScoreCardContent): number {
  const flag = flagRuns(content);
  if (flag === null) return 0;
  return FLAG_SIZE + FLAG_GAP + b.width([bold(flag.label)], FLAG_SIZE);
}

/** Draws the flag with its left edge at `x`, centred on `centerY`. */
function flag(
  b: Builder,
  content: ScoreCardContent,
  x: number,
  centerY: number,
): void {
  const looks = flagRuns(content);
  if (looks === null) return;
  b.push({
    kind: "icon",
    region: "flag",
    name: looks.icon,
    x,
    y: centerY - FLAG_SIZE / 2,
    size: FLAG_SIZE,
    color: looks.color,
  });
  b.text(
    "flag",
    [bold(looks.label, looks.color)],
    FLAG_SIZE,
    x + FLAG_SIZE + FLAG_GAP,
    centerY - lineHeight(FLAG_SIZE) / 2,
  );
}

/** The score's bar: `--input-bg` track, the pink fill over 0–10000. */
function bar(b: Builder, y: number, fraction: number): void {
  const height = 24;
  b.push({
    kind: "rect",
    region: "bar",
    x: MARGIN,
    y,
    w: CONTENT,
    h: height,
    radius: 8,
    fill: CARD_COLORS.inputBg,
    stroke: null,
    lineWidth: 0,
  });
  if (fraction <= 0) return;
  b.push({
    kind: "rect",
    region: "bar",
    x: MARGIN,
    y,
    // Never narrower than its own rounded ends.
    w: Math.max(16, CONTENT * fraction),
    h: height,
    radius: 8,
    fill: CARD_COLORS.pinkDark,
    stroke: null,
    lineWidth: 0,
  });
}

const AVATAR = 120;

/**
 * The singer: the avatar, the name (48 → 36, then an ellipsis) and the place
 * and partners under it, as one block. `left` is where the avatar goes, or
 * `null` to centre the whole block on the card; `room` is the width it may
 * take.
 */
function singerRow(
  b: Builder,
  content: ScoreCardContent,
  top: number,
  left: number | null,
  room: number,
): void {
  const textRoom = room - AVATAR - 24;
  const name = fitLine(
    content.singer.name,
    [48, 36],
    "bold",
    textRoom,
    b.measure,
  );
  const detail =
    content.detail === null
      ? null
      : fitLine(content.detail, [36], "normal", textRoom, b.measure);
  const nameWidth = b.width([bold(name.text)], name.size);
  const detailWidth =
    detail === null ? 0 : b.width([run(detail.text)], detail.size);
  const blockWidth = AVATAR + 24 + Math.max(nameWidth, detailWidth);
  const x = left ?? CENTER - blockWidth / 2;
  b.image(
    "singer",
    { x, y: top, w: AVATAR, h: AVATAR },
    content.singer.avatar,
    true,
  );
  const column =
    lineHeight(name.size) + (detail === null ? 0 : 4 + lineHeight(36));
  let y = top + (AVATAR - column) / 2;
  b.text("singer", [bold(name.text)], name.size, x + AVATAR + 24, y);
  y += lineHeight(name.size) + 4;
  if (detail !== null) {
    b.text(
      "singer",
      [run(detail.text, CARD_COLORS.textDark)],
      detail.size,
      x + AVATAR + 24,
      y,
    );
  }
}

// ---------------------------------------------------------------------------
// One score

/** §4.1: the cover beside the title, the score big at the left, the bar, the
 * singer, the brand with party · date at the right. */
function scoreDarkSquare(b: Builder, content: ScoreCardContent): void {
  const cover = 216;
  b.image(
    "cover",
    { x: MARGIN, y: MARGIN, w: cover, h: cover },
    content.cover,
    false,
  );
  const textLeft = MARGIN + cover + 40;
  const room = RIGHT - textLeft;
  const title = fitLines(content.title, [52, 44], "bold", room, 2, b.measure);
  const artist =
    content.artist === null
      ? null
      : fitLine(content.artist, [36], "normal", room, b.measure);
  const block =
    title.lines.length * lineHeight(title.size) +
    (artist === null ? 0 : 8 + lineHeight(36));
  let y = MARGIN + cover / 2 - block / 2;
  for (const line of title.lines) {
    b.text("title", [bold(line)], title.size, textLeft, y);
    y += lineHeight(title.size);
  }
  if (artist !== null) {
    b.text(
      "title",
      [run(artist.text, CARD_COLORS.textDark)],
      artist.size,
      textLeft,
      y + 8,
    );
  }

  const scoreColor =
    content.flag === "highscore" ? CARD_COLORS.gold : CARD_COLORS.text;
  b.text(
    "score",
    [bold(String(content.score), scoreColor)],
    220,
    MARGIN,
    336,
    "left",
    1,
  );
  b.text("rating", [bold(content.rating, CARD_COLORS.blue)], 44, MARGIN, 576);
  bar(b, 660, content.fraction);

  const flagW = flagWidth(b, content);
  singerRow(b, content, 730, MARGIN, CONTENT - (flagW > 0 ? flagW + 32 : 0));
  if (flagW > 0) flag(b, content, RIGHT - flagW, 730 + AVATAR / 2);
  brand(b, 1080 - MARGIN, content.eyebrow);
}

interface StackItem {
  height: number;
  /** The space above it. */
  gap: number;
  place: (top: number) => void;
}

/**
 * Lays `items` out top to bottom, the whole stack centred between `top` and
 * `bottom`. The cover is the one item whose size gives: it takes what the
 * rest leaves, up to `coverMax` and down to `coverMin`.
 */
function stack(
  items: (StackItem | ((cover: number) => StackItem))[],
  top: number,
  bottom: number,
  coverMax: number,
  coverMin: number,
): void {
  const fixed = items.filter(
    (item): item is StackItem => typeof item !== "function",
  );
  const flexible = items.filter((item) => typeof item === "function");
  const taken = fixed.reduce((sum, item) => sum + item.height + item.gap, 0);
  const probe = flexible.map((item) => item(0));
  const probeGaps = probe.reduce((sum, item) => sum + item.gap, 0);
  const free = bottom - top - taken - probeGaps;
  const cover = Math.round(
    Math.max(coverMin, Math.min(coverMax, flexible.length > 0 ? free : 0)),
  );
  const resolved = items.map((item) =>
    typeof item === "function" ? item(cover) : item,
  );
  const total = resolved.reduce((sum, item) => sum + item.height + item.gap, 0);
  let y = top + Math.max(0, (bottom - top - total) / 2);
  for (const item of resolved) {
    y += item.gap;
    item.place(y);
    y += item.height;
  }
}

/** The centred score card: Cover square, and both looks of the story. */
function scoreCentred(
  b: Builder,
  content: ScoreCardContent,
  format: CardFormat,
): void {
  const story = format === "story";
  const area = SAFE_AREA[format];
  const brandTop = area.bottom - BRAND_LOGO;
  const titleSizes = story ? [64, 52] : [52, 44];
  const artistSize = story ? 40 : 36;
  const scoreSize = story ? 240 : 200;
  const title = fitLines(
    content.title,
    titleSizes,
    "bold",
    CONTENT,
    2,
    b.measure,
  );
  const artist =
    content.artist === null
      ? null
      : fitLine(content.artist, [artistSize], "normal", CONTENT, b.measure);
  const scoreColor =
    content.flag === "highscore" ? CARD_COLORS.gold : CARD_COLORS.text;

  const items: (StackItem | ((cover: number) => StackItem))[] = [];
  if (story && content.eyebrow !== null) {
    const eyebrow = fitLine(
      content.eyebrow,
      [MIN_TEXT],
      "normal",
      CONTENT,
      b.measure,
    );
    items.push({
      height: lineHeight(MIN_TEXT),
      gap: 0,
      place: (top) => {
        b.text(
          "eyebrow",
          [run(eyebrow.text, CARD_COLORS.textDarker)],
          MIN_TEXT,
          CENTER,
          top,
          "center",
        );
      },
    });
  }
  const coverGap = items.length > 0 ? 32 : 0;
  items.push((cover) => ({
    height: cover,
    gap: coverGap,
    place: (top) =>
      b.image(
        "cover",
        { x: CENTER - cover / 2, y: top, w: cover, h: cover },
        content.cover,
        false,
        true,
      ),
  }));
  items.push({
    height: title.lines.length * lineHeight(title.size),
    gap: story ? 40 : 28,
    place: (top) => {
      title.lines.forEach((line, index) =>
        b.text(
          "title",
          [bold(line)],
          title.size,
          CENTER,
          top + index * lineHeight(title.size),
          "center",
        ),
      );
    },
  });
  if (artist !== null) {
    items.push({
      height: lineHeight(artistSize),
      gap: 4,
      place: (top) => {
        b.text(
          "title",
          [run(artist.text, CARD_COLORS.textDark)],
          artist.size,
          CENTER,
          top,
          "center",
        );
      },
    });
  }
  items.push({
    height: scoreSize * 0.9,
    gap: story ? 32 : 20,
    place: (top) => {
      b.text(
        "score",
        [bold(String(content.score), scoreColor)],
        scoreSize,
        CENTER,
        top,
        "center",
        0.9,
      );
    },
  });
  // The rating word, with the flag beside it on the same line: a centred card
  // has no right-hand column to put it in.
  items.push({
    height: lineHeight(44),
    gap: 8,
    place: (top) => {
      const ratingWidth = b.width([bold(content.rating)], 44);
      const flagW = flagWidth(b, content);
      const total = ratingWidth + (flagW > 0 ? 32 + flagW : 0);
      const left = CENTER - total / 2;
      b.text("rating", [bold(content.rating, CARD_COLORS.blue)], 44, left, top);
      if (flagW > 0)
        flag(b, content, left + ratingWidth + 32, top + lineHeight(44) / 2);
    },
  });
  if (story) {
    items.push({
      height: 24,
      gap: 36,
      place: (top) => bar(b, top, content.fraction),
    });
  }
  items.push({
    height: AVATAR,
    gap: story ? 48 : 28,
    place: (top) => singerRow(b, content, top, null, CONTENT),
  });

  stack(items, area.top, brandTop - 40, story ? 440 : 300, story ? 280 : 180);
  brand(b, area.bottom, story ? null : content.eyebrow);
}

// ---------------------------------------------------------------------------
// One party

/** The party's name (or date) over its sub line (§2.2). Only called with a
 * head: with *Party name and date* off the card has none. */
function partyHead(
  b: Builder,
  head: string,
  sub: string | null,
  top: number,
): void {
  const fitted = fitLine(head, [56, 44], "bold", CONTENT, b.measure);
  // A head cut down to 44 keeps its 56 line, so the sub line never moves.
  b.text(
    "head",
    [bold(fitted.text)],
    fitted.size,
    MARGIN,
    top + (lineHeight(56) - lineHeight(fitted.size)) / 2,
  );
  if (sub === null) return;
  const line = fitLine(sub, [MIN_TEXT], "normal", CONTENT, b.measure);
  b.text(
    "head",
    [run(line.text, CARD_COLORS.textDarker)],
    line.size,
    MARGIN,
    top + lineHeight(56) + 4,
  );
}

const HEAD_HEIGHT = lineHeight(56) + 4 + lineHeight(MIN_TEXT);

/** The four numbers: the value 56 bold over its label; Best gold with its
 * holder. Never the worst (§1.2). */
const NUMBER_COLUMNS = [190, 190, 316, 240];
const NUMBERS_HEIGHT = 56 * 1.2 + lineHeight(MIN_TEXT);

function numbers(b: Builder, values: CardNumbers, top: number): void {
  const { sings, songs, best, bestBy, average } = values;
  const columns: [number, string, string][] = [
    // "1 Song", never "1 Songs": *Only me* is often one of each.
    [sings, countWord(sings, "Sing"), CARD_COLORS.text],
    [songs, countWord(songs, "Song"), CARD_COLORS.text],
    [best, bestBy === null ? "Best" : `Best · ${bestBy}`, CARD_COLORS.gold],
    [average, "Average", CARD_COLORS.text],
  ];
  let x = MARGIN;
  columns.forEach(([value, label, color], index) => {
    const room = NUMBER_COLUMNS[index] - 24;
    b.text("numbers", [bold(String(value), color)], 56, x, top, "left", 1.2);
    const fitted = fitLine(label, [MIN_TEXT], "normal", room, b.measure);
    b.text(
      "numbers",
      [run(fitted.text, CARD_COLORS.textDarker)],
      fitted.size,
      x,
      top + 56 * 1.2,
    );
    x += NUMBER_COLUMNS[index];
  });
}

/** The pink numeral and the name after it, centred on `center`. */
function rankedName(
  b: Builder,
  region: Region,
  entry: CardRank,
  center: number,
  top: number,
  room: number,
): void {
  const numeral = [bold(String(entry.place), CARD_COLORS.pink)];
  const numeralWidth = b.width(numeral, COLOURED_MIN);
  const name = fitLine(
    entry.person.name,
    [COLOURED_MIN, MIN_TEXT],
    "bold",
    room - numeralWidth - 12,
    b.measure,
  );
  const nameWidth = b.width([bold(name.text)], name.size);
  const left = center - (numeralWidth + 12 + nameWidth) / 2;
  const middle = top + lineHeight(COLOURED_MIN) / 2;
  b.text(
    region,
    numeral,
    COLOURED_MIN,
    left,
    middle - lineHeight(COLOURED_MIN) / 2,
  );
  b.text(
    region,
    [bold(name.text)],
    name.size,
    left + numeralWidth + 12,
    middle - lineHeight(name.size) / 2,
  );
}

/** The 1st's avatar, the others', and how much lower the others stand. */
const PODIUM = { first: 180, other: 140, drop: 60, column: 296 };
const PODIUM_HEIGHT =
  PODIUM.drop + PODIUM.other + 12 + lineHeight(COLOURED_MIN) + lineHeight(44);

/** §4.2: 1st in the middle and raised, 2nd at its left, 3rd at its right. */
function podium(b: Builder, content: PartyCardContent, top: number): void {
  const entries = content.ranking.slice(0, 3);
  const spacing = CONTENT / 3;
  // Left to right: 2nd, 1st, 3rd — or, for two, 2nd and 1st about the middle.
  const columns =
    entries.length === 2
      ? [
          { entry: entries[1], center: CENTER - spacing / 2 },
          { entry: entries[0], center: CENTER + spacing / 2 },
        ]
      : [
          { entry: entries[1], center: CENTER - spacing },
          { entry: entries[0], center: CENTER },
          { entry: entries[2], center: CENTER + spacing },
        ];
  for (const { entry, center } of columns) {
    if (entry === undefined) continue;
    const first = entry === entries[0];
    const size = first ? PODIUM.first : PODIUM.other;
    const avatarTop = top + (first ? 0 : PODIUM.drop);
    b.image(
      "podium",
      { x: center - size / 2, y: avatarTop, w: size, h: size },
      entry.person.avatar,
      true,
    );
    const nameTop = avatarTop + size + 12;
    rankedName(b, "podium", entry, center, nameTop, PODIUM.column);
    b.text(
      "podium",
      [
        bold(
          String(entry.best),
          entry.gold ? CARD_COLORS.gold : CARD_COLORS.text,
        ),
      ],
      44,
      center,
      nameTop + lineHeight(COLOURED_MIN),
      "center",
    );
  }
}

/** The one singer, large: the party of one, or *Only me and my place*. */
const HERO_PRESETS = [
  { avatar: 220, score: 140 },
  { avatar: 180, score: 110 },
  { avatar: 150, score: 96 },
  { avatar: 120, score: 80 },
];

function heroHeight(
  content: PartyCardContent,
  preset: (typeof HERO_PRESETS)[number],
): number {
  return (
    preset.avatar +
    16 +
    lineHeight(48) +
    (content.myPlace === null ? 0 : 4 + lineHeight(44)) +
    8 +
    preset.score * 0.9
  );
}

/** The largest hero that fits `room`, or the smallest there is. */
function heroPreset(
  content: PartyCardContent,
  room: number,
): (typeof HERO_PRESETS)[number] {
  return (
    HERO_PRESETS.find((option) => heroHeight(content, option) <= room) ??
    HERO_PRESETS[HERO_PRESETS.length - 1]
  );
}

function hero(
  b: Builder,
  content: PartyCardContent,
  top: number,
  bottom: number,
): void {
  const entry = content.ranking[0];
  const preset = heroPreset(content, bottom - top);
  let y = top + (bottom - top - heroHeight(content, preset)) / 2;
  b.image(
    "hero",
    { x: CENTER - preset.avatar / 2, y, w: preset.avatar, h: preset.avatar },
    entry.person.avatar,
    true,
  );
  y += preset.avatar + 16;
  const name = fitLine(entry.person.name, [48, 36], "bold", CONTENT, b.measure);
  b.text(
    "hero",
    [bold(name.text)],
    name.size,
    CENTER,
    y + (lineHeight(48) - lineHeight(name.size)) / 2,
    "center",
  );
  y += lineHeight(48);
  if (content.myPlace !== null) {
    b.text(
      "hero",
      [bold(content.myPlace, CARD_COLORS.pink)],
      44,
      CENTER,
      y + 4,
      "center",
    );
    y += 4 + lineHeight(44);
  }
  // Their best is the best of what the card shows, so it is the gold one.
  b.text(
    "hero",
    [bold(String(content.numbers.best), CARD_COLORS.gold)],
    preset.score,
    CENTER,
    y + 8,
    "center",
    0.9,
  );
}

const ROW_PITCH = 56;
const ROW_AVATAR = 48;
/** Ranks 4–6: what is left of `FACES_SHOWN` after the podium's three. */
const ROWS_SHOWN = FACES_SHOWN - 3;

function rowsHeight(content: PartyCardContent): number {
  const rest = content.ranking.length - 3;
  if (rest <= 0) return 0;
  const shown = Math.min(rest, ROWS_SHOWN);
  return shown * ROW_PITCH + (rest > shown ? 4 + lineHeight(MIN_TEXT) : 0);
}

/** Ranks 4–6 as rows, then "+N more" (§4.2). */
function rows(b: Builder, content: PartyCardContent, top: number): void {
  const entries = content.ranking.slice(3, 3 + ROWS_SHOWN);
  entries.forEach((entry, index) => {
    const rowTop = top + index * ROW_PITCH;
    const middle = rowTop + ROW_PITCH / 2;
    b.text(
      "rows",
      [bold(String(entry.place), CARD_COLORS.pink)],
      COLOURED_MIN,
      MARGIN + 48,
      middle - lineHeight(COLOURED_MIN) / 2,
      "right",
    );
    b.image(
      "rows",
      {
        x: MARGIN + 64,
        y: middle - ROW_AVATAR / 2,
        w: ROW_AVATAR,
        h: ROW_AVATAR,
      },
      entry.person.avatar,
      true,
    );
    const score = [
      bold(
        String(entry.best),
        entry.gold ? CARD_COLORS.gold : CARD_COLORS.text,
      ),
    ];
    const scoreWidth = b.width(score, COLOURED_MIN);
    const nameLeft = MARGIN + 64 + ROW_AVATAR + 16;
    const name = fitLine(
      entry.person.name,
      [COLOURED_MIN, MIN_TEXT],
      "bold",
      RIGHT - scoreWidth - 24 - nameLeft,
      b.measure,
    );
    b.text(
      "rows",
      [bold(name.text)],
      name.size,
      nameLeft,
      middle - lineHeight(name.size) / 2,
    );
    b.text(
      "rows",
      score,
      COLOURED_MIN,
      RIGHT,
      middle - lineHeight(COLOURED_MIN) / 2,
      "right",
    );
  });
  const rest = content.ranking.length - 3 - entries.length;
  if (rest > 0) {
    b.text(
      "rows",
      [run(`+${rest} more`, CARD_COLORS.textDarker)],
      MIN_TEXT,
      MARGIN,
      top + entries.length * ROW_PITCH + 4,
    );
  }
}

interface StripMarks {
  r: number;
  ring: number;
  /** How far apart the swarm keeps two dots. */
  gap: number;
  bestRing: number;
}

/** The strip's marks, at §4.2's sizes: dots r 10, the best's gold ring —
 * smaller only for a cloud its region has no room for (`fittedStrip`). */
const STRIP_DOT: StripMarks = { r: 10, ring: 3, gap: 24, bestRing: 19 };
/** The party strip's band at its least (§4.2); it grows with the cloud
 * into the air its region leaves (`fittedStrip`). */
const PARTY_STRIP_BAND = { square: 100, story: 150 };
/** The player card's strip, the focus of its card: dots r 12 (§9), stepped
 * down the same way. */
const PLAYER_STRIP_DOT: StripMarks = { r: 12, ring: 3, gap: 28, bestRing: 22 };
/** What keeps a mark on 0 or 10k from being cut by the card's margin. */
const STRIP_INSET = 24;

function stripHeight(band: number): number {
  return lineHeight(MIN_TEXT) + 8 + band + 8 + lineHeight(MIN_TEXT);
}

/** The steps a strip's marks take down, `heroPreset`'s idiom: a cloud its
 * region cannot give every dot a lane at full size is drawn smaller before it
 * is drawn piled — the dot, its ring, the gap and the gold ring together. */
const STRIP_SCALES = [1, 0.8, 0.6] as const;

function scaledMarks(mark: StripMarks, scale: number): StripMarks {
  return {
    r: mark.r * scale,
    ring: mark.ring * scale,
    gap: mark.gap * scale,
    bestRing: mark.bestRing * scale,
  };
}

/** The band the swarm needs at `mark` for every dot to find a lane of its
 * own. */
function neededBand(dots: CardDot[], mark: StripMarks): number {
  // The very placement `strip` makes, uncapped: same dots, same order.
  const spread = Math.max(
    0,
    ...swarm(
      dots,
      (dot) => MARGIN + scoreX(dot.score, CONTENT, STRIP_INSET),
      0,
      mark.gap,
    ).map((placed) => Math.abs(placed.y)),
  );
  return 2 * (spread + mark.bestRing + mark.ring / 2 + 2);
}

/** A strip's band and the marks it is drawn at (`fittedStrip`). */
interface FittedStrip {
  band: number;
  mark: StripMarks;
}

/**
 * A strip that grows with its cloud: the band `least` at the least, and as
 * tall as the swarm needs for every dot to find a lane of its own — a band
 * that caps the lanes piles the rest of a big cloud onto the outer one, dots
 * over dots — up to `most`, the room its region has. Where even `most` is too
 * little at full size the marks step down (`STRIP_SCALES`) until the cloud
 * fits; past the last step the lanes are capped and the outer ones carry the
 * rest.
 */
function fittedStrip(
  dots: CardDot[],
  mark: StripMarks,
  least: number,
  most: number,
): FittedStrip {
  const room = Math.max(least, most);
  let fitted: FittedStrip = { band: least, mark };
  for (const scale of STRIP_SCALES) {
    const scaled = scaledMarks(mark, scale);
    const needed = neededBand(dots, scaled);
    fitted = { band: Math.max(least, Math.min(most, needed)), mark: scaled };
    if (needed <= room) break;
  }
  return fitted;
}

/** Tick labels under an axis from `left` over `width`, 0 and 10k inwards. */
function ticks(
  b: Builder,
  region: Region,
  left: number,
  width: number,
  inset: number,
  top: number,
): void {
  for (const tick of CARD_TICKS) {
    const x = left + scoreX(tick, width, inset);
    const align: Align =
      tick === 0 ? "left" : tick === MAX_SCORE ? "right" : "center";
    // The ends sit on the track's own edges, not on the inset mark.
    const anchor = tick === 0 ? left : tick === MAX_SCORE ? left + width : x;
    b.text(
      region,
      [run(scoreTickLabel(tick), CARD_COLORS.textDarker)],
      MIN_TEXT,
      anchor,
      top,
      align,
    );
  }
}

/**
 * The score strip (§4.2): every score as a grey dot on the shared 0–10k
 * scale, staggered apart by the screens' own swarm, the best one gold and
 * ringed, the median dashed, and "Median N" over it. The best is not written
 * out — the numbers above already print it with its holder, as `ScoreStrip`
 * leaves it out under a score summary.
 */
function strip(
  b: Builder,
  dots: CardDot[],
  median: number | null,
  top: number,
  band: number,
  mark: StripMarks = STRIP_DOT,
): void {
  const region = "strip";
  if (median !== null) {
    b.text(
      region,
      [run("Median ", CARD_COLORS.textDarker), bold(String(median))],
      MIN_TEXT,
      MARGIN,
      top,
    );
  }
  const bandTop = top + lineHeight(MIN_TEXT) + 8;
  const middle = bandTop + band / 2;
  const x = (score: number) => MARGIN + scoreX(score, CONTENT, STRIP_INSET);
  for (const tick of CARD_TICKS) {
    b.push({
      kind: "line",
      region,
      x1: x(tick),
      y1: bandTop,
      x2: x(tick),
      y2: bandTop + band,
      color: chartTheme.grid,
      width: 3,
      dash: null,
      alpha: 0.55,
    });
  }
  if (median !== null) {
    b.push({
      kind: "line",
      region,
      x1: x(median),
      y1: bandTop,
      x2: x(median),
      y2: bandTop + band,
      color: chartTheme.median,
      width: 3,
      dash: [9, 12],
      alpha: 0.8,
    });
  }
  const reach = mark.bestRing + mark.ring / 2;
  // A band `neededBand` sized holds its lanes exactly; the 1e-6 keeps a
  // scaled gap's rounding from taking the last one away.
  const lanes = Math.floor((band / 2 - reach - 2) / mark.gap + 1e-6);
  const placed = swarm(
    dots,
    (dot) => x(dot.score),
    middle,
    mark.gap,
    Math.max(0, lanes) * mark.gap,
  );
  // The gold one last, so no grey dot is ever painted over it.
  placed.sort((a, b2) => Number(a.item.best) - Number(b2.item.best));
  for (const { item, x: cx, y } of placed) {
    b.push({
      kind: "circle",
      region,
      cx,
      cy: y,
      r: mark.r,
      fill: item.best ? chartTheme.gold : chartTheme.dot,
      stroke: CARD_COLORS.bg,
      lineWidth: mark.ring,
    });
    if (item.best) {
      b.push({
        kind: "circle",
        region,
        cx,
        cy: y,
        r: mark.bestRing,
        fill: null,
        stroke: chartTheme.gold,
        lineWidth: mark.ring,
      });
    }
  }
  const axis = bandTop + band;
  b.push({
    kind: "line",
    region,
    x1: MARGIN,
    y1: axis,
    x2: RIGHT,
    y2: axis,
    color: chartTheme.grid,
    width: 3,
    dash: null,
    alpha: 1,
  });
  ticks(b, region, MARGIN, CONTENT, STRIP_INSET, axis + 8);
}

/** "1 Chiara 9124 · 2 Alice 8662 · 3 Ben 7934", the ranking of a card whose
 * focus is a chart: three entries at 36 → 32, then fewer, then a cut name. */
function rankingLine(b: Builder, content: PartyCardContent, top: number): void {
  const runsOf = (entries: CardRank[], last: string | null): Run[] =>
    entries.flatMap((entry, index) => [
      ...(index > 0 ? [run(" · ", CARD_COLORS.textDarker)] : []),
      bold(`${entry.place} `),
      run(
        index === entries.length - 1 && last !== null
          ? last
          : entry.person.name,
        CARD_COLORS.textDark,
      ),
      bold(` ${entry.best}`),
    ]);
  for (let count = Math.min(3, content.ranking.length); count >= 1; count--) {
    const entries = content.ranking.slice(0, count);
    for (const size of [36, MIN_TEXT]) {
      const runs = runsOf(entries, null);
      if (b.width(runs, size) <= CONTENT) {
        b.text("ranking", runs, size, MARGIN, top);
        return;
      }
    }
  }
  // Even the winner alone is too wide: their name is cut.
  const entry = content.ranking[0];
  const frame = b.width(runsOf([entry], ""), MIN_TEXT);
  const name = fitLine(
    entry.person.name,
    [MIN_TEXT],
    "normal",
    CONTENT - frame,
    b.measure,
  );
  b.text("ranking", runsOf([entry], name.text), MIN_TEXT, MARGIN, top);
}

const SPREAD = {
  name: 260,
  best: 128,
  gap: 24,
  /** No row is shorter than its 40 px best value's line. */
  minPitch: Math.ceil(lineHeight(COLOURED_MIN)),
  dot: { r: 8, ring: 3, gap: 18 },
  raw: { r: 7, ring: 2 },
};

function spreadAxisHeight(): number {
  return 8 + 8 + lineHeight(MIN_TEXT);
}

/**
 * The spread rows as the focus (§7.1): one row per singer in the ranking's
 * order — the name and count at the left, the track on the shared 0–10k
 * scale, their best at the right — a Tukey box under the raw dots from five
 * scores on, plain dots below that, the party's best the one gold mark, the
 * gridlines once behind every row and the axis once under them.
 */
function spread(
  b: Builder,
  content: PartyCardContent,
  top: number,
  bottom: number,
  maxPitch: number,
): void {
  const region = "spread";
  const axisY = bottom - spreadAxisHeight() + 8;
  const area = axisY - 8 - top;
  const fits = Math.floor(area / SPREAD.minPitch);
  const all = content.ranking;
  const shown = all.length <= fits ? all : all.slice(0, Math.max(1, fits - 1));
  const more = all.length - shown.length;
  const slots = shown.length + (more > 0 ? 1 : 0);
  const pitch = Math.min(maxPitch, Math.floor(area / slots));
  const used = slots * pitch;
  const rowsTop = top + (area - used) / 2;
  const trackLeft = MARGIN + SPREAD.name + SPREAD.gap;
  const track = RIGHT - SPREAD.best - SPREAD.gap - trackLeft;
  const x = (score: number) => trackLeft + scoreX(score, track, STRIP_INSET);

  for (const tick of CARD_TICKS) {
    b.push({
      kind: "line",
      region,
      x1: x(tick),
      y1: rowsTop,
      x2: x(tick),
      y2: axisY,
      color: chartTheme.grid,
      width: 3,
      dash: null,
      alpha: 0.55,
    });
  }

  shown.forEach((entry, index) => {
    const middle = rowsTop + index * pitch + pitch / 2;
    const count = run(` ×${entry.dots.length}`, CARD_COLORS.textDarker);
    const name = fitLine(
      entry.person.name,
      [MIN_TEXT],
      "bold",
      SPREAD.name - b.width([count], MIN_TEXT),
      b.measure,
    );
    b.text(
      region,
      [bold(name.text), count],
      MIN_TEXT,
      MARGIN,
      middle - lineHeight(MIN_TEXT) / 2,
    );
    b.text(
      region,
      [
        bold(
          String(entry.best),
          entry.gold ? CARD_COLORS.gold : CARD_COLORS.text,
        ),
      ],
      COLOURED_MIN,
      RIGHT,
      middle - lineHeight(COLOURED_MIN) / 2,
      "right",
    );

    if (entry.box !== null) {
      const box = entry.box;
      const height = Math.min(48, Math.round(pitch * 0.55));
      for (const [from, to] of [
        [box.whiskerLow, box.q1],
        [box.q3, box.whiskerHigh],
      ]) {
        b.push({
          kind: "line",
          region,
          x1: x(from),
          y1: middle,
          x2: x(to),
          y2: middle,
          color: chartTheme.accent,
          width: 3,
          dash: null,
          alpha: 1,
        });
      }
      for (const end of [box.whiskerLow, box.whiskerHigh]) {
        b.push({
          kind: "line",
          region,
          x1: x(end),
          y1: middle - height * 0.3,
          x2: x(end),
          y2: middle + height * 0.3,
          color: chartTheme.accent,
          width: 3,
          dash: null,
          alpha: 1,
        });
      }
      b.push({
        kind: "rect",
        region,
        x: x(box.q1),
        y: middle - height / 2,
        w: Math.max(x(box.q3) - x(box.q1), 6),
        h: height,
        radius: 6,
        fill: chartTheme.fill,
        stroke: chartTheme.accent,
        lineWidth: 3,
      });
      b.push({
        kind: "line",
        region,
        x1: x(box.median),
        y1: middle - height / 2,
        x2: x(box.median),
        y2: middle + height / 2,
        color: chartTheme.median,
        width: 4,
        dash: null,
        alpha: 1,
      });
      const dots = [...entry.dots].sort(
        (a, b2) => Number(a.best) - Number(b2.best),
      );
      for (const dot of dots) {
        b.push({
          kind: "circle",
          region,
          cx: x(dot.score),
          cy: middle + jitterOf(dot.id) * height * 0.3,
          // The party's best a size up: a 7 px gold dot inside a box is
          // gone at chat-thumbnail size.
          r: dot.best ? SPREAD.dot.r + 2 : SPREAD.raw.r,
          fill: dot.best ? chartTheme.gold : chartTheme.dot,
          stroke: chartTheme.fill,
          lineWidth: SPREAD.raw.ring,
        });
      }
      return;
    }

    const reach = SPREAD.dot.r + SPREAD.dot.ring / 2;
    const lanes = Math.floor((pitch / 2 - reach - 2) / SPREAD.dot.gap);
    const placed = swarm(
      entry.dots,
      (dot) => x(dot.score),
      middle,
      SPREAD.dot.gap,
      Math.max(0, lanes) * SPREAD.dot.gap,
    );
    placed.sort((a, b2) => Number(a.item.best) - Number(b2.item.best));
    for (const { item, x: cx, y } of placed) {
      b.push({
        kind: "circle",
        region,
        cx,
        cy: y,
        r: SPREAD.dot.r,
        fill: item.best ? chartTheme.gold : chartTheme.dot,
        stroke: CARD_COLORS.bg,
        lineWidth: SPREAD.dot.ring,
      });
    }
  });

  if (more > 0) {
    b.text(
      region,
      [run(`+${more} more`, CARD_COLORS.textDarker)],
      MIN_TEXT,
      MARGIN,
      rowsTop + shown.length * pitch + (pitch - lineHeight(MIN_TEXT)) / 2,
    );
  }

  b.push({
    kind: "line",
    region,
    x1: trackLeft,
    y1: axisY,
    x2: trackLeft + track,
    y2: axisY,
    color: chartTheme.grid,
    width: 3,
    dash: null,
    alpha: 1,
  });
  ticks(b, region, trackLeft, track, STRIP_INSET, axisY + 8);
}

/** How tall the spread wants to be at `pitch`, axis included. */
function spreadHeight(content: PartyCardContent, pitch: number): number {
  return content.ranking.length * pitch + 8 + spreadAxisHeight();
}

function mosaicCells(urls: string[], height: number): MosaicCell[] {
  if (urls.length === 0) return [];
  const size = CARD_WIDTH / 3;
  const rowCount = Math.ceil(height / size);
  // A story's grid is taller than the card: centred, the overhang cut evenly.
  const offset = (height - rowCount * size) / 2;
  const cells: MosaicCell[] = [];
  for (let index = 0; index < rowCount * 3; index++) {
    cells.push({
      url: urls[index % urls.length],
      x: (index % 3) * size,
      y: offset + Math.floor(index / 3) * size,
      size,
    });
  }
  return cells;
}

/** §4.2's square: where the numbers stand under a head, how far below them
 * the body starts, and the air between the podium and what is under it.
 * Without a head the numbers lead, and the block they head is centred (§7.9). */
const SQUARE_NUMBERS_TOP = 222;
const SQUARE_BODY_GAP = 150;
const SQUARE_UNDER_GAP = 24;

function partySquare(
  b: Builder,
  content: PartyCardContent,
  options: PartyCardOptions,
): void {
  if (content.head !== null) partyHead(b, content.head, content.sub, MARGIN);
  const numbersTop = content.head === null ? MARGIN : SQUARE_NUMBERS_TOP;
  const bodyTop = numbersTop + SQUARE_BODY_GAP;
  const bodyBottom = 1080 - MARGIN - BRAND_LOGO - 24;

  if (options.focus === "spread") {
    numbers(b, content.numbers, numbersTop);
    rankingLine(b, content, bodyTop - 10);
    spread(b, content, bodyTop + 68, bodyBottom, 96);
    brand(b, 1080 - MARGIN, content.rankingNote);
    return;
  }

  const under = options.look === "mosaic" ? "none" : options.under;
  const one = content.ranking.length === 1;
  const least = PARTY_STRIP_BAND.square;
  // At its least first: what the podium or the hero takes is settled at
  // that, and the band then grows into the air they leave and no further.
  let fitted: FittedStrip = { band: least, mark: STRIP_DOT };
  const underHeightAt = (band: number) =>
    under === "ranking"
      ? rowsHeight(content)
      : under === "strip"
        ? stripHeight(band)
        : 0;
  const placeUnder = (top: number) => {
    if (under === "ranking") rows(b, content, top);
    if (under === "strip")
      strip(b, content.dots, content.median, top, fitted.band, fitted.mark);
  };
  const grow = (slack: number) =>
    fittedStrip(content.dots, STRIP_DOT, least, least + Math.max(0, slack));

  if (content.head === null) {
    // Nothing above the numbers: rather than leaving the podium alone in the
    // middle of what the head freed, with the rows still at the foot, the
    // whole block closes up at the head card's own gaps and is centred
    // between the margin and the brand (§4.2).
    const leastHeight = underHeightAt(least);
    const underRoom = leastHeight > 0 ? SQUARE_UNDER_GAP + leastHeight : 0;
    const bodyHeight = one
      ? heroHeight(
          content,
          heroPreset(content, bodyBottom - bodyTop - underRoom),
        )
      : PODIUM_HEIGHT;
    if (under === "strip")
      fitted = grow(
        bodyBottom - MARGIN - SQUARE_BODY_GAP - bodyHeight - underRoom,
      );
    const underHeight = underHeightAt(fitted.band);
    const items: StackItem[] = [
      {
        height: NUMBERS_HEIGHT,
        gap: 0,
        place: (top) => numbers(b, content.numbers, top),
      },
      {
        height: bodyHeight,
        gap: SQUARE_BODY_GAP - NUMBERS_HEIGHT,
        place: (top) =>
          one
            ? hero(b, content, top, top + bodyHeight)
            : podium(b, content, top),
      },
    ];
    if (underHeight > 0)
      items.push({
        height: underHeight,
        gap: SQUARE_UNDER_GAP,
        place: placeUnder,
      });
    stack(items, MARGIN, bodyBottom, 0, 0);
    brand(b, 1080 - MARGIN, content.rankingNote);
    return;
  }

  numbers(b, content.numbers, numbersTop);
  if (under === "strip") {
    const space = bodyBottom - SQUARE_UNDER_GAP - stripHeight(least) - bodyTop;
    const body = one
      ? heroHeight(content, heroPreset(content, space))
      : PODIUM_HEIGHT;
    fitted = grow(space - body);
  }
  const underHeight = underHeightAt(fitted.band);
  const underTop = bodyBottom - underHeight;
  const heroBottom = underHeight > 0 ? underTop - SQUARE_UNDER_GAP : bodyBottom;
  if (one) {
    hero(b, content, bodyTop, heroBottom);
  } else {
    const space = heroBottom - bodyTop;
    podium(b, content, bodyTop + Math.max(0, (space - PODIUM_HEIGHT) / 2));
  }
  placeUnder(underTop);
  brand(b, 1080 - MARGIN, content.rankingNote);
}

function partyStory(
  b: Builder,
  content: PartyCardContent,
  options: PartyCardOptions,
): void {
  const area = SAFE_AREA.story;
  const bottom = area.bottom - BRAND_LOGO - 40;
  const items: StackItem[] = [];
  const { head, sub } = content;
  if (head !== null) {
    items.push({
      height: sub === null ? lineHeight(56) : HEAD_HEIGHT,
      gap: 0,
      place: (top) => partyHead(b, head, sub, top),
    });
  }
  // Without a head the numbers lead (§7.9).
  items.push({
    height: NUMBERS_HEIGHT,
    gap: items.length > 0 ? 56 : 0,
    place: (top) => numbers(b, content.numbers, top),
  });

  if (options.focus === "spread") {
    const pitch = 110;
    items.push({
      height: lineHeight(36),
      gap: 56,
      place: (top) => rankingLine(b, content, top),
    });
    const fixed = items.reduce((sum, item) => sum + item.height + item.gap, 0);
    const room = bottom - area.top - fixed - 40;
    const height = Math.min(room, spreadHeight(content, pitch));
    items.push({
      height,
      gap: 40,
      place: (top) => spread(b, content, top, top + height, pitch),
    });
  } else {
    const plain = options.look !== "mosaic";
    const one = content.ranking.length === 1;
    const heroRoom = 520;
    items.push({
      height: one ? heroRoom : PODIUM_HEIGHT,
      gap: 72,
      place: (top) =>
        one ? hero(b, content, top, top + heroRoom) : podium(b, content, top),
    });
    // A story has room for both (§4.2): its *Podium* draws the rows, its
    // *Strip* the rows and the strip, each where there is something to draw.
    if (plain && rowsHeight(content) > 0) {
      items.push({
        height: rowsHeight(content),
        gap: 64,
        place: (top) => rows(b, content, top),
      });
    }
    if (
      plain &&
      options.under === "strip" &&
      content.dots.length >= CHART_MIN_SCORES
    ) {
      // What the stack leaves under everything else is the strip's room.
      const gap = 64;
      const taken = items.reduce(
        (sum, item) => sum + item.height + item.gap,
        0,
      );
      const least = PARTY_STRIP_BAND.story;
      const { band, mark } = fittedStrip(
        content.dots,
        STRIP_DOT,
        least,
        bottom - area.top - taken - gap - stripHeight(0),
      );
      items.push({
        height: stripHeight(band),
        gap,
        place: (top) => strip(b, content.dots, content.median, top, band, mark),
      });
    }
  }
  stack(items, area.top, bottom, 0, 0);
  brand(b, area.bottom, content.rankingNote);
}

// ---------------------------------------------------------------------------
// One singer

/** §9's square: the head's avatar, where the numbers stand, and the region
 * the focus is centred in, down to 24 over the brand's line. */
const PLAYER_SQUARE = {
  avatar: 120,
  numbersTop: 232,
  focusTop: 392,
  focusBottom: 1080 - MARGIN - BRAND_LOGO - 24,
  histogram: 440,
  /** The strip's band at its least: it grows with the cloud (`playerStrip`). */
  stripBand: 200,
};

/** §9's story: the head's avatar gives — it is the one thing that shrinks,
 * from 200 down to 120, so the eight song rows fit under it — and the focus'
 * own heights. */
const PLAYER_STORY = {
  avatarMax: 200,
  avatarMin: 120,
  gap: 48,
  histogram: 640,
  /** At its least, as on the square; at most as tall as the histogram. */
  stripBand: 280,
};

/**
 * The player strip (`fittedStrip`): §9's 200 (a story's 280) at least, up to
 * what the format has room for — the square's focus region, the story's
 * histogram height.
 */
function playerStrip(
  content: PlayerCardContent,
  format: CardFormat,
): FittedStrip {
  const least =
    format === "story" ? PLAYER_STORY.stripBand : PLAYER_SQUARE.stripBand;
  const most =
    format === "story"
      ? PLAYER_STORY.histogram
      : PLAYER_SQUARE.focusBottom - PLAYER_SQUARE.focusTop - stripHeight(0);
  return fittedStrip(content.dots, PLAYER_STRIP_DOT, least, most);
}

/** The song rows: the cover 80 in a 104 row on a square, eight of them in
 * 96 rows on a story, where 104 does not fit under the head. */
const SONG_ROWS = {
  cover: 80,
  square: { pitch: 104, shown: 5 },
  story: { pitch: 96, shown: 8 },
};

/** The histogram's bars: 6 apart, and a bucket that holds anything never
 * lower than this, or one score among fifty is gone in a chat thumbnail. */
const BAR_GAP = 6;
const BAR_MIN = 8;

/** The square's head: the avatar at the margin and, centred on it, the name
 * 56 bold (→ 44, then an ellipsis) over the party line 32 (§9). A name cut to
 * 44 keeps its 56 line, so the party line never moves. */
function playerHeadSquare(b: Builder, content: PlayerCardContent): void {
  const size = PLAYER_SQUARE.avatar;
  b.image(
    "head",
    { x: MARGIN, y: MARGIN, w: size, h: size },
    content.person.avatar,
    true,
  );
  const left = MARGIN + size + 32;
  const room = RIGHT - left;
  const name = fitLine(content.person.name, [56, 44], "bold", room, b.measure);
  const line =
    content.line === null
      ? null
      : fitLine(content.line, [MIN_TEXT], "normal", room, b.measure);
  const column =
    lineHeight(56) + (line === null ? 0 : 4 + lineHeight(MIN_TEXT));
  const top = MARGIN + (size - column) / 2;
  b.text(
    "head",
    [bold(name.text)],
    name.size,
    left,
    top + (lineHeight(56) - lineHeight(name.size)) / 2,
  );
  if (line !== null) {
    b.text(
      "head",
      [run(line.text, CARD_COLORS.textDarker)],
      line.size,
      left,
      top + lineHeight(56) + 4,
    );
  }
}

/** The story's head under its avatar: the name 64 (→ 52) over the party line
 * 36 (→ 32), both centred. */
function playerNameStory(
  b: Builder,
  content: PlayerCardContent,
  top: number,
): void {
  const name = fitLine(
    content.person.name,
    [64, 52],
    "bold",
    CONTENT,
    b.measure,
  );
  b.text(
    "head",
    [bold(name.text)],
    name.size,
    CENTER,
    top + (lineHeight(64) - lineHeight(name.size)) / 2,
    "center",
  );
  if (content.line === null) return;
  const line = fitLine(
    content.line,
    [36, MIN_TEXT],
    "normal",
    CONTENT,
    b.measure,
  );
  b.text(
    "head",
    [run(line.text, CARD_COLORS.textDarker)],
    line.size,
    CENTER,
    top + lineHeight(64) + 4 + (lineHeight(36) - lineHeight(line.size)) / 2,
    "center",
  );
}

function playerNameStoryHeight(content: PlayerCardContent): number {
  return lineHeight(64) + (content.line === null ? 0 : 4 + lineHeight(36));
}

function histogramHeight(maxBar: number): number {
  return maxBar + 3 + 8 + lineHeight(MIN_TEXT);
}

/**
 * The histogram as the focus (§9): `ScoreHistogram`'s twenty buckets over
 * 0–10k across the content width, the bars in the charts' blue and the one
 * holding the best score gold, on a 3 px baseline over 0 / 5k / 10k. The
 * fullest bucket is `maxBar` tall.
 */
function bars(
  b: Builder,
  content: PlayerCardContent,
  top: number,
  maxBar: number,
): void {
  const region = "histogram";
  const count = content.buckets.length;
  const width = (CONTENT - (count - 1) * BAR_GAP) / count;
  const fullest = Math.max(1, ...content.buckets);
  const base = top + maxBar;
  content.buckets.forEach((value, index) => {
    if (value === 0) return;
    const height = Math.max(BAR_MIN, (value / fullest) * maxBar);
    b.push({
      kind: "rect",
      region,
      x: MARGIN + index * (width + BAR_GAP),
      y: base - height,
      w: width,
      h: height,
      radius: 0,
      fill: index === content.bestBucket ? chartTheme.gold : chartTheme.accent,
      stroke: null,
      lineWidth: 0,
    });
  });
  b.push({
    kind: "line",
    region,
    x1: MARGIN,
    y1: base + 1.5,
    x2: RIGHT,
    y2: base + 1.5,
    color: chartTheme.grid,
    width: 3,
    dash: null,
    alpha: 1,
  });
  ticks(b, region, MARGIN, CONTENT, 0, base + 3 + 8);
}

/** Their best song by song (§9): the cover 80 with square corners, the title
 * 40 bold (→ 32, then an ellipsis) over the artist 32, their best 44 bold at
 * the right — gold on the song their best of all is on. */
function songRows(
  b: Builder,
  content: PlayerCardContent,
  top: number,
  pitch: number,
  shown: number,
): void {
  const region = "songs";
  const size = SONG_ROWS.cover;
  content.songs.slice(0, shown).forEach((entry, index) => {
    const middle = top + index * pitch + pitch / 2;
    b.image(
      region,
      { x: MARGIN, y: middle - size / 2, w: size, h: size },
      entry.cover,
      false,
    );
    const score = [
      bold(
        String(entry.best),
        entry.gold ? CARD_COLORS.gold : CARD_COLORS.text,
      ),
    ];
    const scoreWidth = b.width(score, 44);
    const left = MARGIN + size + 24;
    const room = RIGHT - scoreWidth - 24 - left;
    const title = fitLine(
      entry.title,
      [COLOURED_MIN, MIN_TEXT],
      "bold",
      room,
      b.measure,
    );
    const artist =
      entry.artist === null
        ? null
        : fitLine(entry.artist, [MIN_TEXT], "normal", room, b.measure);
    const column =
      lineHeight(COLOURED_MIN) + (artist === null ? 0 : lineHeight(MIN_TEXT));
    const textTop = middle - column / 2;
    b.text(
      region,
      [bold(title.text)],
      title.size,
      left,
      textTop + (lineHeight(COLOURED_MIN) - lineHeight(title.size)) / 2,
    );
    if (artist !== null) {
      b.text(
        region,
        [run(artist.text, CARD_COLORS.textDark)],
        artist.size,
        left,
        textTop + lineHeight(COLOURED_MIN),
      );
    }
    b.text(region, score, 44, RIGHT, middle - lineHeight(44) / 2, "right");
  });
}

/** How many song rows a format lists. */
function songsShown(content: PlayerCardContent, format: CardFormat): number {
  return Math.min(content.songs.length, SONG_ROWS[format].shown);
}

/** The focus' height on a format, for centring it. */
function playerFocusHeight(
  content: PlayerCardContent,
  options: PlayerCardOptions,
): number {
  const story = options.format === "story";
  switch (options.focus) {
    case "histogram":
      return histogramHeight(
        story ? PLAYER_STORY.histogram : PLAYER_SQUARE.histogram,
      );
    case "strip":
      return stripHeight(playerStrip(content, options.format).band);
    case "songs":
      return (
        songsShown(content, options.format) * SONG_ROWS[options.format].pitch
      );
    default:
      return 0;
  }
}

function placePlayerFocus(
  b: Builder,
  content: PlayerCardContent,
  options: PlayerCardOptions,
  top: number,
): void {
  const story = options.format === "story";
  switch (options.focus) {
    case "histogram":
      bars(
        b,
        content,
        top,
        story ? PLAYER_STORY.histogram : PLAYER_SQUARE.histogram,
      );
      return;
    case "strip": {
      const { band, mark } = playerStrip(content, options.format);
      strip(b, content.dots, content.median, top, band, mark);
      return;
    }
    case "songs":
      songRows(
        b,
        content,
        top,
        SONG_ROWS[options.format].pitch,
        songsShown(content, options.format),
      );
      return;
    default:
      return;
  }
}

/** "ranked by best score" at the foot of *Songs*, the one design that ranks
 * anything (§9). */
function playerNote(options: PlayerCardOptions): string | null {
  return options.focus === "songs" ? RANKING_NOTE : null;
}

function playerSquare(
  b: Builder,
  content: PlayerCardContent,
  options: PlayerCardOptions,
): void {
  playerHeadSquare(b, content);
  numbers(b, content.numbers, PLAYER_SQUARE.numbersTop);
  const room = PLAYER_SQUARE.focusBottom - PLAYER_SQUARE.focusTop;
  const height = playerFocusHeight(content, options);
  placePlayerFocus(
    b,
    content,
    options,
    PLAYER_SQUARE.focusTop + Math.max(0, (room - height) / 2),
  );
  brand(b, 1080 - MARGIN, playerNote(options));
}

function playerStory(
  b: Builder,
  content: PlayerCardContent,
  options: PlayerCardOptions,
): void {
  const area = SAFE_AREA.story;
  const bottom = area.bottom - BRAND_LOGO - 40;
  const items: (StackItem | ((avatar: number) => StackItem))[] = [
    (avatar) => ({
      height: avatar,
      gap: 0,
      place: (top) =>
        b.image(
          "head",
          { x: CENTER - avatar / 2, y: top, w: avatar, h: avatar },
          content.person.avatar,
          true,
        ),
    }),
    {
      height: playerNameStoryHeight(content),
      gap: 16,
      place: (top) => playerNameStory(b, content, top),
    },
    {
      height: NUMBERS_HEIGHT,
      gap: PLAYER_STORY.gap,
      place: (top) => numbers(b, content.numbers, top),
    },
  ];
  const height = playerFocusHeight(content, options);
  if (height > 0) {
    items.push({
      height,
      gap: PLAYER_STORY.gap,
      place: (top) => placePlayerFocus(b, content, options, top),
    });
  }
  stack(
    items,
    area.top,
    bottom,
    PLAYER_STORY.avatarMax,
    PLAYER_STORY.avatarMin,
  );
  brand(b, area.bottom, playerNote(options));
}

// ---------------------------------------------------------------------------
// An achievement

/** §10's numbers per format: the badge, the name's sizes, the description's
 * size and lines, the sharer's avatar and name, the earned lines' size, and
 * the gaps between them — the square's reproduce §10's table (the badge at
 * 72, the name at 512, the description at 600, the sharer at 744, the day at
 * 848) for a full card, and the whole column is centred when a short
 * description or a missing holders line leaves it shorter. */
const ACHIEVEMENT = {
  square: {
    badge: 400,
    name: [64, 52],
    description: 40,
    lines: 2,
    avatar: 72,
    sharer: [40, 32],
    facts: MIN_TEXT,
    gaps: { name: 40, description: 4.8, sharer: 40, facts: 32 },
  },
  story: {
    badge: 560,
    name: [72, 60],
    description: 44,
    lines: 3,
    avatar: 96,
    sharer: [44, 36],
    facts: 36,
    gaps: { name: 48, description: 8, sharer: 48, facts: 40 },
  },
} as const;

/** The badge as `AchievementBadge` draws it earned, a rounded square whose
 * radius is a fifth of its side: the picture clipped to it, or — without
 * one, or with one that did not decode — the plate in the achievement's
 * colour with the glyph, half the side, cut out of it in `--bg`. */
function badge(
  b: Builder,
  content: AchievementCardContent,
  top: number,
  size: number,
  loaded: (url: string) => boolean,
): void {
  const x = CENTER - size / 2;
  const radius = size / 5;
  const url = content.badge.url;
  if (url !== null && loaded(url)) {
    b.push({
      kind: "image",
      region: "badge",
      x,
      y: top,
      w: size,
      h: size,
      image: { url, initial: "" },
      radius,
      initialColor: CARD_COLORS.textDark,
      shadow: false,
    });
    return;
  }
  b.push({
    kind: "rect",
    region: "badge",
    x,
    y: top,
    w: size,
    h: size,
    radius,
    fill: content.badge.plate,
    stroke: null,
    lineWidth: 0,
  });
  b.push({
    kind: "icon",
    region: "badge",
    name: content.badge.glyph,
    x: x + size / 4,
    y: top + size / 4,
    size: size / 2,
    color: CARD_COLORS.bg,
  });
}

/** The sharer as one centred row: the avatar and the name beside it. */
function sharerRow(
  b: Builder,
  content: AchievementCardContent,
  top: number,
  avatar: number,
  sizes: readonly number[],
): void {
  const gap = 24;
  const name = fitLine(
    content.sharer.name,
    sizes,
    "bold",
    CONTENT - avatar - gap,
    b.measure,
  );
  const width = avatar + gap + b.width([bold(name.text)], name.size);
  const x = CENTER - width / 2;
  b.image(
    "sharer",
    { x, y: top, w: avatar, h: avatar },
    content.sharer.avatar,
    true,
  );
  b.text(
    "sharer",
    [bold(name.text)],
    name.size,
    x + avatar + gap,
    top + (avatar - lineHeight(name.size)) / 2,
  );
}

function achievementColumn(
  b: Builder,
  content: AchievementCardContent,
  format: CardFormat,
  loaded: (url: string) => boolean,
): void {
  const n = ACHIEVEMENT[format];
  const nameSize = n.name[0];
  const name = fitLine(content.name, n.name, "bold", CONTENT, b.measure);
  const description =
    content.description.trim() === ""
      ? null
      : fitLines(
          content.description,
          [n.description],
          "normal",
          CONTENT,
          n.lines,
          b.measure,
        );
  const facts = [content.earned, content.holders].filter(
    (line): line is string => line !== null && line !== "",
  );
  const items: StackItem[] = [
    {
      height: n.badge,
      gap: 0,
      place: (top) => badge(b, content, top, n.badge, loaded),
    },
    {
      height: lineHeight(nameSize),
      gap: n.gaps.name,
      // A name cut to the smaller size keeps the larger's line, so nothing
      // under it moves.
      place: (top) =>
        b.text(
          "name",
          [bold(name.text)],
          name.size,
          CENTER,
          top + (lineHeight(nameSize) - lineHeight(name.size)) / 2,
          "center",
        ),
    },
  ];
  if (description !== null) {
    items.push({
      height: description.lines.length * lineHeight(description.size),
      gap: n.gaps.description,
      place: (top) =>
        description.lines.forEach((line, index) =>
          b.text(
            "description",
            [run(line, CARD_COLORS.textDark)],
            description.size,
            CENTER,
            top + index * lineHeight(description.size),
            "center",
          ),
        ),
    });
  }
  items.push({
    height: n.avatar,
    gap: n.gaps.sharer,
    place: (top) => sharerRow(b, content, top, n.avatar, n.sharer),
  });
  if (facts.length > 0) {
    items.push({
      height: facts.length * lineHeight(n.facts) + (facts.length - 1) * 4,
      gap: n.gaps.facts,
      place: (top) =>
        facts.forEach((line, index) => {
          const fitted = fitLine(
            line,
            [n.facts, MIN_TEXT],
            "normal",
            CONTENT,
            b.measure,
          );
          b.text(
            "earned",
            [run(fitted.text, CARD_COLORS.textDarker)],
            fitted.size,
            CENTER,
            top +
              index * (lineHeight(n.facts) + 4) +
              (lineHeight(n.facts) - lineHeight(fitted.size)) / 2,
            "center",
          );
        }),
    });
  }
  const area = SAFE_AREA[format];
  // Down to 24 over the brand's line on a square, 40 on a story, as on the
  // other cards.
  const bottom = area.bottom - BRAND_LOGO - (format === "story" ? 40 : 24);
  stack(items, area.top, bottom, 0, 0);
  brand(b, area.bottom, null);
}

/**
 * A Mosaic's words (§3.1): the covers stay visible behind them, so the
 * `#888` that reads on flat `--bg` takes `#ccc`, each over its halo.
 */
function onMosaic(elements: CardElement[]): CardElement[] {
  return elements.map((element) =>
    element.kind === "text"
      ? {
          ...element,
          runs: element.runs.map((part) =>
            part.color === CARD_COLORS.textDarker
              ? { ...part, color: CARD_COLORS.textDark }
              : part,
          ),
        }
      : element,
  );
}

// ---------------------------------------------------------------------------

/**
 * The whole card, for options `resolve…Options` (possible.ts) has already
 * made drawable: a Cover look here has a cover that loaded, a Mosaic its
 * covers, and `loaded` says which of the party's covers those are.
 */
export function layoutScoreCard(
  content: ScoreCardContent,
  options: ScoreCardOptions,
  measure: Measure,
): CardLayout {
  const b = new Builder(measure);
  if (options.format === "square" && options.look === "dark") {
    scoreDarkSquare(b, content);
  } else {
    scoreCentred(b, content, options.format);
  }
  return {
    width: CARD_WIDTH,
    height: CARD_HEIGHT[options.format],
    background:
      options.look === "cover" && content.cover.url !== null
        ? { kind: "cover", url: content.cover.url }
        : { kind: "dark" },
    elements: b.elements,
    halo: false,
  };
}

/** A player card, for options `resolvePlayerOptions` made drawable. Always on
 * Dark (§9): a chart over a cover wash does not read. */
export function layoutPlayerCard(
  content: PlayerCardContent,
  options: PlayerCardOptions,
  measure: Measure,
): CardLayout {
  const b = new Builder(measure);
  if (options.format === "square") playerSquare(b, content, options);
  else playerStory(b, content, options);
  return {
    width: CARD_WIDTH,
    height: CARD_HEIGHT[options.format],
    background: { kind: "dark" },
    elements: b.elements,
    halo: false,
  };
}

/**
 * An achievement card (share-cards §10), always on Dark: the badge large and
 * centred over its name, its description, the sharer, the day and the
 * holders line. `loaded` says whether the badge's picture arrived; without it
 * the badge is its plate and glyph, never a letter.
 */
export function layoutAchievementCard(
  content: AchievementCardContent,
  options: AchievementCardOptions,
  measure: Measure,
  loaded: (url: string) => boolean = () => true,
): CardLayout {
  const b = new Builder(measure);
  achievementColumn(b, content, options.format, loaded);
  return {
    width: CARD_WIDTH,
    height: CARD_HEIGHT[options.format],
    background: { kind: "dark" },
    elements: b.elements,
    halo: false,
  };
}

export function layoutPartyCard(
  content: PartyCardContent,
  options: PartyCardOptions,
  measure: Measure,
  loaded: (url: string) => boolean = () => true,
): CardLayout {
  const b = new Builder(measure);
  if (options.format === "square") partySquare(b, content, options);
  else partyStory(b, content, options);
  const height = CARD_HEIGHT[options.format];
  const mosaic = options.look === "mosaic";
  return {
    width: CARD_WIDTH,
    height,
    background: mosaic
      ? {
          kind: "mosaic",
          cells: mosaicCells(content.covers.filter(loaded), height),
        }
      : { kind: "dark" },
    elements: mosaic ? onMosaic(b.elements) : b.elements,
    halo: mosaic,
  };
}
