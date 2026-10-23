import { scoreTickLabel, scoreX, swarm, jitterOf } from "../chartLayout";
import { chartTheme, MAX_SCORE } from "../chartTheme";
import type { IconName } from "../components/icons";
import { CHART_MIN_SCORES } from "../stats";
import {
  FACES_SHOWN,
  type CardDot,
  type CardImage,
  type CardRank,
  type PartyCardContent,
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
/** What stands under the podium on a square Dark card; `none` is what is left
 * when neither can be drawn, never something the panel offers. */
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

/** The Wingman mark, drawn small and grey out of the app's logo. */
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

/** A stretch of the card, top to bottom, that a Mosaic paints `--bg` at 100%
 * behind: the text that sits there must read clean over sharp covers. */
export interface MosaicBand {
  top: number;
  bottom: number;
}

export type CardBackground =
  | { kind: "dark" }
  /** The cover blurred over the whole card under `--bg` at 70%. */
  | { kind: "cover"; url: string }
  /** The party's covers in a grid under the same scrim, and over that the
   * bands behind the head, the numbers and the brand line. */
  | { kind: "mosaic"; cells: MosaicCell[]; bands: MosaicBand[] };

export interface CardLayout {
  width: number;
  height: number;
  background: CardBackground;
  elements: CardElement[];
}

/** The scrim over a background picture: `--bg` at this opacity. The blurred
 * cover takes §3.1's 70%; the mosaic's covers are sharp, lettering and all,
 * and at 70% they fought the grey labels over them, so they sit deeper. */
export const SCRIM_ALPHA = { cover: 0.7, mosaic: 0.8 } as const;

/** The Mosaic's bands (§3.1): even at 80% a cover's lettering showed through
 * the head, the four numbers and the brand line, so behind those the card is
 * `--bg` at 100% — `pad` past their text — and falls back to the scrim over
 * `fade` px on each side. A uniform 88% was tried and dimmed the covers in
 * the middle without cleaning the grey labels. */
export const MOSAIC_BAND = { pad: 24, fade: 96 } as const;

/** The regions a band is drawn behind, grouped into one band each. */
const BANDED: Region[][] = [["head", "numbers"], ["brand"]];

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

/** The Wingman mark and its words bottom left, and `note` at the right of the
 * same line — the party · date of a score, or what a party is ranked by. */
function brand(b: Builder, bottom: number, note: string | null): void {
  const logo = 48;
  const top = bottom - logo;
  b.push({ kind: "logo", region: "brand", x: MARGIN, y: top, size: logo });
  const words = b.text(
    "brand",
    [run("Ultrastar Wingman", CARD_COLORS.textDarker)],
    MIN_BRAND_TEXT,
    MARGIN + logo + 16,
    top + (logo - lineHeight(MIN_BRAND_TEXT)) / 2,
  );
  if (note === null) return;
  const room = RIGHT - (words.x + words.w + 32);
  const fitted = fitLine(note, [MIN_TEXT], "normal", room, b.measure);
  b.text(
    "brand-note",
    [run(fitted.text, CARD_COLORS.textDarker)],
    fitted.size,
    RIGHT,
    top + (logo - lineHeight(MIN_TEXT)) / 2,
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
  const brandTop = area.bottom - 48;
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

function partyHead(b: Builder, content: PartyCardContent, top: number): number {
  const head = fitLine(content.head, [56, 44], "bold", CONTENT, b.measure);
  b.text("head", [bold(head.text)], head.size, MARGIN, top);
  let y = top + lineHeight(head.size);
  if (content.sub !== null) {
    const sub = fitLine(content.sub, [MIN_TEXT], "normal", CONTENT, b.measure);
    b.text(
      "head",
      [run(sub.text, CARD_COLORS.textDarker)],
      sub.size,
      MARGIN,
      y + 4,
    );
    y += 4 + lineHeight(MIN_TEXT);
  }
  return y;
}

const HEAD_HEIGHT = lineHeight(56) + 4 + lineHeight(MIN_TEXT);

/** The four numbers: the value 56 bold over its label; Best gold with its
 * holder. Never the worst (§1.2). */
const NUMBER_COLUMNS = [190, 190, 316, 240];
const NUMBERS_HEIGHT = 56 * 1.2 + lineHeight(MIN_TEXT);

function numbers(b: Builder, content: PartyCardContent, top: number): void {
  const { sings, songs, best, bestBy, average } = content.numbers;
  const columns: [number, string, string][] = [
    [sings, "Sings", CARD_COLORS.text],
    [songs, "Songs", CARD_COLORS.text],
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

function hero(
  b: Builder,
  content: PartyCardContent,
  top: number,
  bottom: number,
): void {
  const entry = content.ranking[0];
  const preset =
    HERO_PRESETS.find(
      (option) => heroHeight(content, option) <= bottom - top,
    ) ?? HERO_PRESETS[HERO_PRESETS.length - 1];
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

/** The strip's marks, at §4.2's sizes: dots r 10, the best's gold ring. */
const STRIP_DOT = { r: 10, ring: 3, gap: 24, bestRing: 19 };
/** What keeps a mark on 0 or 10k from being cut by the card's margin. */
const STRIP_INSET = 24;

function stripHeight(band: number): number {
  return lineHeight(MIN_TEXT) + 8 + band + 8 + lineHeight(MIN_TEXT);
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
  const reach = STRIP_DOT.bestRing + STRIP_DOT.ring / 2;
  const lanes = Math.floor((band / 2 - reach - 2) / STRIP_DOT.gap);
  const placed = swarm(
    dots,
    (dot) => x(dot.score),
    middle,
    STRIP_DOT.gap,
    Math.max(0, lanes) * STRIP_DOT.gap,
  );
  // The gold one last, so no grey dot is ever painted over it.
  placed.sort((a, b2) => Number(a.item.best) - Number(b2.item.best));
  for (const { item, x: cx, y } of placed) {
    b.push({
      kind: "circle",
      region,
      cx,
      cy: y,
      r: STRIP_DOT.r,
      fill: item.best ? chartTheme.gold : chartTheme.dot,
      stroke: CARD_COLORS.bg,
      lineWidth: STRIP_DOT.ring,
    });
    if (item.best) {
      b.push({
        kind: "circle",
        region,
        cx,
        cy: y,
        r: STRIP_DOT.bestRing,
        fill: null,
        stroke: chartTheme.gold,
        lineWidth: STRIP_DOT.ring,
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

/** One band per group of `BANDED` regions the card carries: from the top of
 * their text to its bottom, `pad` past both, kept on the card. */
function mosaicBands(elements: CardElement[], height: number): MosaicBand[] {
  const bands: MosaicBand[] = [];
  for (const regions of BANDED) {
    const boxes = elements
      .filter((element) => regions.includes(element.region))
      .map(elementBox);
    if (boxes.length === 0) continue;
    const top = Math.min(...boxes.map((box) => box.y));
    const bottom = Math.max(...boxes.map((box) => box.y + box.h));
    bands.push({
      top: Math.max(0, top - MOSAIC_BAND.pad),
      bottom: Math.min(height, bottom + MOSAIC_BAND.pad),
    });
  }
  return bands;
}

function partySquare(
  b: Builder,
  content: PartyCardContent,
  options: PartyCardOptions,
): void {
  partyHead(b, content, MARGIN);
  const numbersTop = 222;
  numbers(b, content, numbersTop);
  const bodyTop = 372;
  const bodyBottom = 1080 - MARGIN - 48 - 24;

  if (options.focus === "spread") {
    rankingLine(b, content, bodyTop - 10);
    spread(b, content, bodyTop + 68, bodyBottom, 96);
    brand(b, 1080 - MARGIN, content.rankingNote);
    return;
  }

  const under = options.look === "mosaic" ? "none" : options.under;
  const stripBand = 100;
  const underHeight =
    under === "ranking"
      ? rowsHeight(content)
      : under === "strip"
        ? stripHeight(stripBand)
        : 0;
  const underTop = bodyBottom - underHeight;
  const heroBottom = underHeight > 0 ? underTop - 24 : bodyBottom;
  if (content.ranking.length === 1) {
    hero(b, content, bodyTop, heroBottom);
  } else {
    const space = heroBottom - bodyTop;
    podium(b, content, bodyTop + Math.max(0, (space - PODIUM_HEIGHT) / 2));
  }
  if (under === "ranking") rows(b, content, underTop);
  if (under === "strip")
    strip(b, content.dots, content.median, underTop, stripBand);
  brand(b, 1080 - MARGIN, content.rankingNote);
}

function partyStory(
  b: Builder,
  content: PartyCardContent,
  options: PartyCardOptions,
): void {
  const area = SAFE_AREA.story;
  const bottom = area.bottom - 48 - 40;
  const items: StackItem[] = [
    {
      height: content.sub === null ? lineHeight(56) : HEAD_HEIGHT,
      gap: 0,
      place: (top) => void partyHead(b, content, top),
    },
    {
      height: NUMBERS_HEIGHT,
      gap: 56,
      place: (top) => numbers(b, content, top),
    },
  ];

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
    // A story has room for both the rows and the strip (§4.2).
    if (plain && rowsHeight(content) > 0) {
      items.push({
        height: rowsHeight(content),
        gap: 64,
        place: (top) => rows(b, content, top),
      });
    }
    if (plain && content.dots.length >= CHART_MIN_SCORES) {
      const band = 150;
      items.push({
        height: stripHeight(band),
        gap: 64,
        place: (top) => strip(b, content.dots, content.median, top, band),
      });
    }
  }
  stack(items, area.top, bottom, 0, 0);
  brand(b, area.bottom, content.rankingNote);
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
  return {
    width: CARD_WIDTH,
    height,
    background:
      options.look === "mosaic"
        ? {
            kind: "mosaic",
            cells: mosaicCells(content.covers.filter(loaded), height),
            bands: mosaicBands(b.elements, height),
          }
        : { kind: "dark" },
    elements: b.elements,
  };
}
