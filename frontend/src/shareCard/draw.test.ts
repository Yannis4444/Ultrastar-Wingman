import {
  PICTURED,
  SONGS,
  achievementContent,
  cardParty,
  cardPlayers,
  cardScore,
  partySession,
} from "../test/shareCard";
import {
  cardImageUrls,
  partyCard,
  scoreCard,
  type AchievementCardContent,
  type PartyCardContent,
} from "./content";
import { LOGO_URL, paintCard, type CardRequest } from "./draw";
import { CARD_COLORS, HALO, SCRIM_ALPHA } from "./layout";

/**
 * The renderer against a recording 2D context: jsdom has no canvas, and what
 * matters here is *what* is painted, in which state — the logo as it is, the
 * Mosaic's halo passes, the toggle — not the pixels, which the harness
 * renders look at.
 */

interface Call {
  method: string;
  args: unknown[];
  shadowBlur: number;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  globalAlpha: number;
  globalCompositeOperation: string;
  fillStyle: unknown;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
}

const STATE = {
  shadowBlur: 0,
  shadowColor: "rgba(0, 0, 0, 0)",
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  globalAlpha: 1,
  globalCompositeOperation: "source-over",
  fillStyle: "#000",
  strokeStyle: "#000",
  lineWidth: 1,
  font: "10px sans-serif",
  textBaseline: "alphabetic",
  textAlign: "start",
  direction: "inherit",
  imageSmoothingEnabled: true,
  imageSmoothingQuality: "low",
};

type State = typeof STATE;

/** A context that records every call with the state it was made in, keeps
 * `save` / `restore` honest, and measures text like `fakeMeasure`. */
function recordingContext() {
  const calls: Call[] = [];
  let state: State = { ...STATE };
  const stack: State[] = [];
  const record = (method: string, args: unknown[]) =>
    calls.push({
      method,
      args,
      shadowBlur: state.shadowBlur,
      shadowColor: state.shadowColor,
      shadowOffsetX: state.shadowOffsetX,
      shadowOffsetY: state.shadowOffsetY,
      globalAlpha: state.globalAlpha,
      globalCompositeOperation: state.globalCompositeOperation,
      fillStyle: state.fillStyle,
      imageSmoothingEnabled: state.imageSmoothingEnabled,
      imageSmoothingQuality: state.imageSmoothingQuality,
    });
  const methods: Record<string, (...args: unknown[]) => unknown> = {
    save: () => void stack.push({ ...state }),
    restore: () => {
      state = stack.pop() ?? { ...STATE };
    },
    measureText: (text) => ({ width: String(text).length * 20 }),
    setLineDash: () => undefined,
  };
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_, key: string) {
      if (key in state) return state[key as keyof State];
      if (key in methods) return methods[key];
      return (...args: unknown[]) => record(key, args);
    },
    set(_, key: string, value) {
      (state as Record<string, unknown>)[key] = value;
      return true;
    },
  });
  return { ctx, calls };
}

function fakeCanvas() {
  const { ctx, calls } = recordingContext();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

/** A picture that decodes and has a size, as `decoded` asks. */
function picture(): HTMLImageElement {
  return {
    decode: () => Promise.resolve(),
    naturalWidth: 800,
    naturalHeight: 800,
    width: 800,
    height: 800,
  } as unknown as HTMLImageElement;
}

const players = cardPlayers();

function partyContent(): PartyCardContent {
  return partyCard({
    scores: cardParty(4, 2),
    session: partySession(),
    players,
    me: "alice",
    otherPictures: true,
    partyNameAndDate: true,
    onlyMe: false,
  });
}

function scoreRequest(logo: boolean): CardRequest {
  return {
    kind: "score",
    content: scoreCard({
      score: cardScore("chiara", 8662, SONGS[0], {
        placement: 1,
        field_size: 3,
      }),
      partyScores: [],
      session: partySession(),
      players,
      me: "chiara",
      otherPictures: true,
      partyNameAndDate: true,
    }),
    options: { format: "square", look: "dark", logo },
  };
}

/** Every URL the card names, and the logo, as a decodable picture. */
function imagesFor(content: PartyCardContent | null) {
  const images = new Map<string, HTMLImageElement>([[LOGO_URL, picture()]]);
  for (const url of content === null ? [] : cardImageUrls(content))
    images.set(url, picture());
  return images;
}

const texts = (calls: Call[]) =>
  calls.filter((call) => call.method === "fillText");
const textOf = (call: Call) => String(call.args[0]);

test("the logo is drawn as it is: the picture itself, once, nothing composited into it", async () => {
  const { canvas, calls } = fakeCanvas();
  const images = imagesFor(null);
  const logo = images.get(LOGO_URL);
  await paintCard(canvas, scoreRequest(true), images);
  const drawn = calls.filter(
    (call) => call.method === "drawImage" && call.args[0] === logo,
  );
  expect(drawn).toHaveLength(1);
  // Straight onto the card at the brand's place and size (§4.1).
  expect(drawn[0].args.slice(1)).toEqual([72, 1080 - 72 - 48, 48, 48]);
  expect(
    calls.some((call) => call.globalCompositeOperation !== "source-over"),
  ).toBe(false);
  expect(texts(calls).map(textOf)).toContain("Ultrastar Wingman");
});

test("the logo off takes the logo and its words, and leaves the note", async () => {
  const { canvas, calls } = fakeCanvas();
  const images = imagesFor(null);
  await paintCard(canvas, scoreRequest(false), images);
  expect(
    calls.some(
      (call) =>
        call.method === "drawImage" && call.args[0] === images.get(LOGO_URL),
    ),
  ).toBe(false);
  const words = texts(calls).map(textOf);
  expect(words).not.toContain("Ultrastar Wingman");
  expect(words.some((text) => text.startsWith("Friday karaoke · "))).toBe(true);
});

test("a mosaic: one uniform scrim, no gradient, and every word and the logo over a halo", async () => {
  const { canvas, calls } = fakeCanvas();
  const content = partyContent();
  const images = imagesFor(content);
  const logo = images.get(LOGO_URL);
  await paintCard(
    canvas,
    {
      kind: "party",
      content,
      options: {
        format: "square",
        look: "mosaic",
        focus: "podium",
        under: "none",
        logo: true,
      },
    },
    images,
  );
  // The scrim: the whole card in --bg at 84%, and nothing banded over it.
  expect(
    calls.filter(
      (call) =>
        call.method === "fillRect" &&
        call.globalAlpha === SCRIM_ALPHA.mosaic &&
        call.fillStyle === CARD_COLORS.bg,
    ),
  ).toHaveLength(1);
  expect(calls.some((call) => call.method === "createLinearGradient")).toBe(
    false,
  );

  const halo = (call: Call) =>
    call.shadowBlur === HALO.blur &&
    call.shadowColor === HALO.color &&
    call.shadowOffsetX === 0 &&
    call.shadowOffsetY === 0;
  const plain = (call: Call) => call.shadowBlur === 0;

  // Each word: twice over the halo, then once plainly on top, in that order.
  const words = texts(calls);
  expect(words.length).toBeGreaterThan(0);
  const byText = new Map<string, Call[]>();
  for (const call of words)
    byText.set(textOf(call), [...(byText.get(textOf(call)) ?? []), call]);
  for (const [text, painted] of byText) {
    expect({ text, passes: painted.length % 3 }).toEqual({ text, passes: 0 });
    for (let i = 0; i < painted.length; i += 3) {
      expect({ text, halo: [painted[i], painted[i + 1]].every(halo) }).toEqual({
        text,
        halo: true,
      });
      expect({ text, plain: plain(painted[i + 2]) }).toEqual({
        text,
        plain: true,
      });
    }
  }
  // The grey words read #ccc over the covers.
  expect(words.some((call) => call.fillStyle === CARD_COLORS.textDarker)).toBe(
    false,
  );

  // The logo the same way: twice with the halo, then plainly.
  const logos = calls.filter(
    (call) => call.method === "drawImage" && call.args[0] === logo,
  );
  expect(logos).toHaveLength(3);
  expect(logos.slice(0, 2).every(halo)).toBe(true);
  expect(plain(logos[2])).toBe(true);

  // The pictures are not haloed: a cover or a face is painted once.
  const covers = calls.filter(
    (call) => call.method === "drawImage" && call.args[0] !== logo,
  );
  expect(covers.length).toBeGreaterThan(0);
  expect(covers.every(plain)).toBe(true);
});

test("a mosaic's cover cells are drawn at high smoothing, like every other picture", async () => {
  const { canvas, calls } = fakeCanvas();
  const content = partyContent();
  const images = imagesFor(content);
  await paintCard(
    canvas,
    {
      kind: "party",
      content,
      options: {
        format: "square",
        look: "mosaic",
        focus: "podium",
        under: "none",
        logo: true,
      },
    },
    images,
  );
  const coverPictures = new Set(content.covers.map((url) => images.get(url)));
  const cells = calls.filter(
    (call) =>
      call.method === "drawImage" &&
      coverPictures.has(call.args[0] as HTMLImageElement),
  );
  // Nine cells on a square, each a cover cut to a 360 px square.
  expect(cells).toHaveLength(9);
  for (const cell of cells) {
    expect(cell.imageSmoothingEnabled).toBe(true);
    expect(cell.imageSmoothingQuality).toBe("high");
  }
});

function achievementRequest(content: AchievementCardContent): CardRequest {
  return {
    kind: "achievement",
    content,
    options: { format: "square", logo: true },
  };
}

test("an achievement's picture is drawn once, clipped to the badge's rounded square", async () => {
  const { canvas, calls } = fakeCanvas();
  const content = achievementContent(PICTURED);
  const images = imagesFor(null);
  const badge = picture();
  images.set(content.badge.url ?? "", badge);
  await paintCard(canvas, achievementRequest(content), images);
  const drawn = calls.filter(
    (call) => call.method === "drawImage" && call.args[0] === badge,
  );
  expect(drawn).toHaveLength(1);
  expect(drawn[0].args.slice(5)).toEqual([340, expect.any(Number), 400, 400]);
  // The clip is the rounded square: arcs, not a plain rectangle.
  const clip = calls.findIndex((call) => call.method === "clip");
  expect(clip).toBeGreaterThan(-1);
  expect(
    calls.slice(0, clip).filter((call) => call.method === "arcTo").length,
  ).toBeGreaterThanOrEqual(4);
  expect(texts(calls).map(textOf)).toContain("First Time on the Mic");
});

test("an achievement's picture that will not decode is the plate and its glyph", async () => {
  const { canvas, calls } = fakeCanvas();
  vi.stubGlobal(
    "Path2D",
    class {
      readonly d: string;
      constructor(d: string) {
        this.d = d;
      }
    },
  );
  try {
    const content = achievementContent({ ...PICTURED, color: "pink" });
    const images = imagesFor(null);
    images.set(content.badge.url ?? "", {
      ...picture(),
      decode: () => Promise.reject(new Error("broken")),
    } as unknown as HTMLImageElement);
    await paintCard(canvas, achievementRequest(content), images);
    const fills = calls.filter((call) => call.method === "fill");
    // The plate in its colour, then the glyph cut out of it in --bg.
    expect(fills.some((call) => call.fillStyle === "#9e3b95")).toBe(true);
    expect(
      fills.some(
        (call) =>
          call.fillStyle === CARD_COLORS.bg && call.args[0] instanceof Path2D,
      ),
    ).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("on dark nothing is haloed and every word is painted once", async () => {
  const { canvas, calls } = fakeCanvas();
  const content = partyContent();
  await paintCard(
    canvas,
    {
      kind: "party",
      content,
      options: {
        format: "square",
        look: "dark",
        focus: "podium",
        under: "strip",
        logo: true,
      },
    },
    imagesFor(content),
  );
  expect(calls.every((call) => call.shadowBlur === 0)).toBe(true);
  const words = texts(calls).map(textOf);
  expect(words.filter((text) => text === "Ultrastar Wingman")).toHaveLength(1);
  expect(words.filter((text) => text === "Friday karaoke")).toHaveLength(1);
});
