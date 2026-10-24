import { ICON_PATHS } from "../components/icons";
import {
  cardImageUrls,
  type AchievementCardContent,
  type PartyCardContent,
  type PlayerCardContent,
  type ScoreCardContent,
} from "./content";
import { fontString, type Measure } from "./fit";
import {
  CARD_COLORS,
  CARD_HEIGHT,
  CARD_WIDTH,
  HALO,
  SCRIM_ALPHA,
  layoutAchievementCard,
  layoutPartyCard,
  layoutPlayerCard,
  layoutScoreCard,
  type CardBackground,
  type CardElement,
  type CardLayout,
  type AchievementCardOptions,
  type ImageElement,
  type TextElement,
  type PartyCardOptions,
  type PlayerCardOptions,
  type ScoreCardOptions,
} from "./layout";
import { resolveScoreOptions, settlePartyOptions } from "./possible";

/**
 * The share card renderer: a layout painted onto a fixed-size canvas and
 * exported as a PNG (share-cards.md §5's canvas traps, all of them): 1080 wide
 * and never scaled by `devicePixelRatio`, an opaque background always, the
 * fonts awaited before anything is measured, every picture decoded before it
 * is drawn, `toBlob` rather than `toDataURL`, and the canvas zeroed after the
 * export because Safari keeps old canvas memory alive.
 *
 * It loads nothing. The caller hands in the pictures it loaded from
 * Wingman's own origin, by the URL the content names (`cardImageUrls`) — the
 * logo under `LOGO_URL` — so the canvas is never tainted; a picture that is
 * missing or will not decode is drawn as its letter on `--input-bg`.
 */

/** The app's logo (`frontend/public/logo.png`), drawn on a card as it is. */
export const LOGO_URL = "/logo.png";

export type CardImages = ReadonlyMap<string, HTMLImageElement>;

export type CardRequest =
  | { kind: "score"; content: ScoreCardContent; options: ScoreCardOptions }
  | { kind: "party"; content: PartyCardContent; options: PartyCardOptions }
  | { kind: "player"; content: PlayerCardContent; options: PlayerCardOptions }
  | {
      kind: "achievement";
      content: AchievementCardContent;
      options: AchievementCardOptions;
    };

/** The blurred cover is the cover drawn this small and scaled back up:
 * `ctx.filter` is not reliable on WebKit (§4.3). */
const BLUR_SIZE = 24;

function rounded(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  if (r <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  // `arcTo` rather than `roundRect`, which older Safari lacks.
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** `image` into the box the way `object-fit: cover` does: the middle of it,
 * cropped to the box's shape. */
function drawCropped(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource & { width: number; height: number },
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const source =
    image instanceof HTMLImageElement
      ? { width: image.naturalWidth, height: image.naturalHeight }
      : { width: image.width, height: image.height };
  const scale = Math.max(w / source.width, h / source.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(
    image,
    (source.width - sw) / 2,
    (source.height - sh) / 2,
    sw,
    sh,
    x,
    y,
    w,
    h,
  );
}

function scratchCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function paintBackground(
  ctx: CanvasRenderingContext2D,
  background: CardBackground,
  width: number,
  height: number,
  images: CardImages,
): void {
  // Opaque first, whatever comes over it: a transparent PNG turns black or
  // white depending on the chat app (§4.3).
  ctx.fillStyle = CARD_COLORS.bg;
  ctx.fillRect(0, 0, width, height);
  if (background.kind === "dark") return;

  if (background.kind === "cover") {
    const cover = images.get(background.url);
    if (cover === undefined) return;
    const small = scratchCanvas(BLUR_SIZE);
    const smallCtx = small.getContext("2d");
    if (smallCtx === null) return;
    // The one big step down: averaged rather than sampled, so a sharp detail
    // of the cover does not survive as a stray bright square.
    smallCtx.imageSmoothingEnabled = true;
    smallCtx.imageSmoothingQuality = "high";
    drawCropped(smallCtx, cover, 0, 0, BLUR_SIZE, BLUR_SIZE);
    // Up by doubling: one 80× bilinear stretch shows the small picture's
    // grid as soft squares, while each 2× pass smooths the one before it.
    const side = Math.max(width, height);
    let blurred = small;
    while (blurred.width * 2 < side) {
      const next = scratchCanvas(blurred.width * 2);
      const nextCtx = next.getContext("2d");
      if (nextCtx === null) break;
      nextCtx.imageSmoothingEnabled = true;
      nextCtx.imageSmoothingQuality = "high";
      nextCtx.drawImage(blurred, 0, 0, next.width, next.height);
      blurred.width = 0;
      blurred = next;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(blurred, (width - side) / 2, (height - side) / 2, side, side);
    blurred.width = 0;
  } else {
    // A cover of any size into a 360 px cell: averaged like every other
    // picture on the card (`paintImage`), not sampled at the default `low`.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    for (const cell of background.cells) {
      const cover = images.get(cell.url);
      if (cover === undefined) continue;
      drawCropped(ctx, cover, cell.x, cell.y, cell.size, cell.size);
    }
  }
  // One uniform scrim, the whole card: no band, no gradient (§3.1).
  ctx.save();
  ctx.globalAlpha = SCRIM_ALPHA[background.kind];
  ctx.fillStyle = CARD_COLORS.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function paintImage(
  ctx: CanvasRenderingContext2D,
  element: ImageElement,
  images: CardImages,
  measure: Measure,
): void {
  const { x, y, w, h, radius } = element;
  const picture =
    element.image.url === null ? undefined : images.get(element.image.url);
  if (element.shadow) {
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    ctx.shadowBlur = 48;
    ctx.shadowOffsetY = 16;
    ctx.fillStyle = CARD_COLORS.bg;
    rounded(ctx, x, y, w, h, radius);
    ctx.fill();
    ctx.restore();
  }
  if (picture !== undefined) {
    ctx.save();
    rounded(ctx, x, y, w, h, radius);
    ctx.clip();
    // Shrunk to a fraction of its size — a badge's 1254 px file to 400, an
    // avatar to 72 — and the default `low` smoothing would alias its lines.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    drawCropped(ctx, picture, x, y, w, h);
    ctx.restore();
    return;
  }
  ctx.fillStyle = CARD_COLORS.inputBg;
  rounded(ctx, x, y, w, h, radius);
  ctx.fill();
  const size = Math.round(h * 0.45);
  const font = { size, weight: "bold" as const };
  ctx.font = fontString(font);
  ctx.fillStyle = element.initialColor;
  ctx.textBaseline = "middle";
  const letter = element.image.initial;
  ctx.fillText(letter, x + (w - measure(letter, font)) / 2, y + h / 2);
}

/** The Wingman logo as it is, in its own colours (§1.8): one plain
 * `drawImage`, nothing composited into it. */
function paintLogo(
  ctx: CanvasRenderingContext2D,
  logo: HTMLImageElement,
  x: number,
  y: number,
  size: number,
): void {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(logo, x, y, size, size);
}

function paintText(
  ctx: CanvasRenderingContext2D,
  element: TextElement,
  measure: Measure,
): void {
  ctx.textBaseline = "middle";
  let x = element.x;
  for (const run of element.runs) {
    const font = { size: element.size, weight: run.weight };
    ctx.font = fontString(font);
    ctx.fillStyle = run.color;
    ctx.fillText(run.text, x, element.y + element.h / 2);
    x += measure(run.text, font);
  }
}

/**
 * `paint` over a halo (§3.1): painted `HALO.passes` times with a `--bg`
 * shadow and no offset, then once plainly on top. The whole element goes
 * through each pass before the next, so a later run's halo never lies over
 * an earlier run's clean text.
 */
function withHalo(ctx: CanvasRenderingContext2D, paint: () => void): void {
  ctx.save();
  ctx.shadowColor = HALO.color;
  ctx.shadowBlur = HALO.blur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  for (let pass = 0; pass < HALO.passes; pass++) paint();
  ctx.restore();
  paint();
}

function paintElement(
  ctx: CanvasRenderingContext2D,
  element: CardElement,
  images: CardImages,
  measure: Measure,
  halo: boolean,
): void {
  switch (element.kind) {
    case "text": {
      if (halo) withHalo(ctx, () => paintText(ctx, element, measure));
      else paintText(ctx, element, measure);
      return;
    }
    case "image":
      paintImage(ctx, element, images, measure);
      return;
    case "rect":
      rounded(ctx, element.x, element.y, element.w, element.h, element.radius);
      ctx.fillStyle = element.fill;
      ctx.fill();
      if (element.stroke !== null) {
        ctx.strokeStyle = element.stroke;
        ctx.lineWidth = element.lineWidth;
        ctx.stroke();
      }
      return;
    case "circle":
      ctx.beginPath();
      ctx.arc(element.cx, element.cy, element.r, 0, 2 * Math.PI);
      if (element.fill !== null) {
        ctx.fillStyle = element.fill;
        ctx.fill();
      }
      if (element.stroke !== null) {
        ctx.strokeStyle = element.stroke;
        ctx.lineWidth = element.lineWidth;
        ctx.stroke();
      }
      return;
    case "line":
      ctx.save();
      ctx.globalAlpha = element.alpha;
      ctx.strokeStyle = element.color;
      ctx.lineWidth = element.width;
      ctx.lineCap = "butt";
      ctx.setLineDash(element.dash ?? []);
      ctx.beginPath();
      ctx.moveTo(element.x1, element.y1);
      ctx.lineTo(element.x2, element.y2);
      ctx.stroke();
      ctx.restore();
      return;
    case "icon":
      ctx.save();
      ctx.translate(element.x, element.y);
      ctx.scale(element.size / 24, element.size / 24);
      ctx.fillStyle = element.color;
      ctx.fill(new Path2D(ICON_PATHS[element.name]));
      ctx.restore();
      return;
    case "logo": {
      const logo = images.get(LOGO_URL);
      if (logo === undefined) return;
      const paint = () =>
        paintLogo(ctx, logo, element.x, element.y, element.size);
      if (halo) withHalo(ctx, paint);
      else paint();
      return;
    }
  }
}

/**
 * The pictures that will actually draw: each one decoded first (§5), and one
 * that will not decode left out, so it falls back to its letter instead of
 * throwing from `drawImage`.
 */
async function decoded(
  urls: string[],
  images: CardImages,
): Promise<CardImages> {
  const ready = new Map<string, HTMLImageElement>();
  await Promise.all(
    urls.map(async (url) => {
      const image = images.get(url);
      if (image === undefined) return;
      try {
        await image.decode();
        if (image.naturalWidth > 0) ready.set(url, image);
      } catch {
        // A broken picture is a missing one.
      }
    }),
  );
  return ready;
}

function layoutOf(
  request: CardRequest,
  measure: Measure,
  images: CardImages,
): CardLayout {
  const loaded = (url: string) => images.has(url);
  if (request.kind === "score") {
    const options = resolveScoreOptions(
      request.content,
      request.options,
      loaded,
    );
    return layoutScoreCard(request.content, options, measure);
  }
  // A player card is Dark whatever arrived: a cover that did not decode is
  // its letter on its row, as every other missing picture.
  if (request.kind === "player")
    return layoutPlayerCard(request.content, request.options, measure);
  // A badge picture that did not decode is the plate and its glyph, the way
  // `AchievementBadge` draws one without a picture — never a letter.
  if (request.kind === "achievement")
    return layoutAchievementCard(
      request.content,
      request.options,
      measure,
      loaded,
    );
  const options = settlePartyOptions(request.content, request.options, loaded);
  return layoutPartyCard(request.content, options, measure, loaded);
}

/**
 * Paints `request` onto `canvas`, sizing it first. Exposed apart from
 * `renderCard` for a caller that wants the canvas itself; it does not zero
 * it afterwards.
 */
export async function paintCard(
  canvas: HTMLCanvasElement,
  request: CardRequest,
  images: CardImages,
): Promise<void> {
  if (typeof document !== "undefined" && document.fonts !== undefined) {
    await document.fonts.ready;
  }
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT[request.options.format];
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("This browser cannot draw a share card.");
  // The layout already placed every line by its left edge: say so, rather
  // than leave "start" to a direction a right-to-left page could flip.
  ctx.textAlign = "left";
  ctx.direction = "ltr";
  const measure: Measure = (text, font) => {
    ctx.font = fontString(font);
    return ctx.measureText(text).width;
  };
  // Decoded before the layout, so a cover that will not decode is a missing
  // one there too and the card falls back to Dark rather than painting a
  // Cover look with no cover.
  const ready = await decoded(
    [LOGO_URL, ...cardImageUrls(request.content)],
    images,
  );
  const layout = layoutOf(request, measure, ready);
  paintBackground(ctx, layout.background, layout.width, layout.height, ready);
  for (const element of layout.elements)
    paintElement(ctx, element, ready, measure, layout.halo);
}

/**
 * The card as a PNG. The canvas is the renderer's own and is zeroed once the
 * PNG exists; the object URL the caller makes of the blob is the caller's to
 * revoke.
 */
export async function renderCard(
  request: CardRequest,
  images: CardImages,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  try {
    await paintCard(canvas, request, images);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob === null
            ? reject(new Error("The share card could not be exported."))
            : resolve(blob),
        "image/png",
      ),
    );
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
