import type { ScoreWithContext } from "../api";
import {
  SONGS,
  cardParty,
  cardPlayers,
  cardScore,
  fakeMeasure,
  partySession,
  song,
} from "../test/shareCard";
import {
  partyCard,
  scoreCard,
  type PartyCardContent,
  type ScoreCardContent,
} from "./content";
import {
  CARD_COLORS,
  CARD_WIDTH,
  COLOURED_MIN,
  MIN_BRAND_TEXT,
  MIN_TEXT,
  SAFE_AREA,
  elementBox,
  layoutPartyCard,
  layoutScoreCard,
  type Box,
  type CardFormat,
  type CardLayout,
  type PartyCardOptions,
  type TextElement,
} from "./layout";
import { resolvePartyOptions, resolveScoreOptions } from "./possible";

const players = cardPlayers();
const all = () => true;

function score(
  overrides: Partial<Parameters<typeof scoreCard>[0]> & {
    score: ScoreWithContext;
  },
): ScoreCardContent {
  return scoreCard({
    partyScores: [overrides.score],
    session: partySession(),
    players,
    me: "chiara",
    otherPictures: true,
    partyNameAndDate: true,
    ...overrides,
  });
}

function party(
  scores: ScoreWithContext[],
  overrides: Partial<Parameters<typeof partyCard>[0]> = {},
): PartyCardContent {
  return partyCard({
    scores,
    session: partySession(),
    players,
    me: "alice",
    otherPictures: true,
    partyNameAndDate: true,
    onlyMe: false,
    ...overrides,
  });
}

const longSong = song(
  "usdb:99",
  "Glenn Medeiros feat. the Philharmonic Orchestra of Somewhere Far Away",
  "Nothing's Gonna Change My Love for You (Extended Midnight Version Remastered 2011)",
);
const longParty = partySession({
  name: "The very long and winding birthday karaoke night at the old boathouse by the lake",
});
const duetScores = (() => {
  const mine = cardScore("chiara", 9124, SONGS[1], {
    sing_id: "four",
    placement: 1,
    field_size: 4,
  });
  return [
    mine,
    ...["alice", "ben", "dana"].map((id, index) =>
      cardScore(id, 8000 - index * 500, SONGS[1], {
        sing_id: "four",
        placement: index + 2,
        field_size: 4,
      }),
    ),
  ];
})();
players.set("long", {
  id: "long",
  name: "Maximiliane-Alexandra von Hohenzollern-Sigmaringen",
  registered: true,
  hidden: false,
  has_avatar: true,
  avatar_version: 1,
});

const SCORES: [string, ScoreCardContent][] = [
  [
    "plain",
    score({
      score: cardScore("chiara", 8662, SONGS[0], {
        placement: 1,
        field_size: 3,
      }),
    }),
  ],
  [
    "long title, long party",
    score({
      score: cardScore("chiara", 5480, longSong, {
        placement: 2,
        field_size: 4,
      }),
      session: longParty,
    }),
  ],
  [
    "long name, record",
    score({
      score: cardScore("long", 9020, SONGS[4], { placement: 1, field_size: 4 }),
      newHighscore: true,
    }),
  ],
  [
    "four at once, personal best",
    score({
      score: duetScores[0],
      partyScores: duetScores,
      personalBest: true,
    }),
  ],
  ["unknown song", score({ score: cardScore("chiara", 4410, null) })],
  [
    "no eyebrow",
    score({ score: cardScore("chiara", 0, SONGS[0]), partyNameAndDate: false }),
  ],
  [
    "a perfect score",
    score({ score: cardScore("chiara", 10000, longSong), newHighscore: true }),
  ],
  [
    "a title of emoji and one endless word",
    score({
      score: cardScore(
        "chiara",
        7300,
        song(
          "usdb:98",
          "🎤".repeat(40),
          `🇩🇪${"Donaudampfschifffahrtsgesellschaftskapitän".repeat(3)}🎶`,
        ),
        { placement: 3, field_size: 3 },
      ),
    }),
  ],
];

function longNamed(scores: ScoreWithContext[]): ScoreWithContext[] {
  return scores.map((entry, index) =>
    index % 3 === 0
      ? {
          ...entry,
          player_name: `${entry.player_name} Featherstonehaugh-Cholmondeley`,
        }
      : entry,
  );
}

const PARTIES: [string, PartyCardContent][] = [
  ["one singer", party(cardParty(1, 5), { me: "chiara" })],
  ["two singers", party(cardParty(2, 3))],
  ["three singers", party(cardParty(3, 2))],
  ["six singers", party(cardParty(6, 4))],
  ["ten singers", party(cardParty(10, 3))],
  ["under four scores", party(cardParty(3, 1))],
  ["only me", party(cardParty(6, 4), { onlyMe: true })],
  ["name off", party(cardParty(5, 2), { partyNameAndDate: false })],
  ["long names", party(longNamed(cardParty(8, 5)), { session: longParty })],
  ["fifty singers", party(cardParty(50, 2), { players: cardPlayers(50) })],
];

const FORMATS: CardFormat[] = ["square", "story"];

function boxesOverlap(a: Box, b: Box): boolean {
  const slack = 0.5;
  return (
    a.x + a.w > b.x + slack &&
    b.x + b.w > a.x + slack &&
    a.y + a.h > b.y + slack &&
    b.y + b.h > a.y + slack
  );
}

/** The checks §4.3 asks of every card: inside its area, no two regions over
 * each other, nothing to read under 32 px, coloured text 40 bold. */
function checkLayout(layout: CardLayout, format: CardFormat): void {
  const area = SAFE_AREA[format];
  const regions = new Map<string, Box>();
  for (const element of layout.elements) {
    const box = elementBox(element);
    expect({ element, inside: box.x >= 72 - 0.5 }).toEqual({
      element,
      inside: true,
    });
    expect({ element, inside: box.x + box.w <= CARD_WIDTH - 72 + 0.5 }).toEqual(
      {
        element,
        inside: true,
      },
    );
    expect({ element, inside: box.y >= area.top - 0.5 }).toEqual({
      element,
      inside: true,
    });
    expect({ element, inside: box.y + box.h <= area.bottom + 0.5 }).toEqual({
      element,
      inside: true,
    });
    const known = regions.get(element.region);
    regions.set(
      element.region,
      known === undefined
        ? box
        : {
            x: Math.min(known.x, box.x),
            y: Math.min(known.y, box.y),
            w:
              Math.max(known.x + known.w, box.x + box.w) -
              Math.min(known.x, box.x),
            h:
              Math.max(known.y + known.h, box.y + box.h) -
              Math.min(known.y, box.y),
          },
    );
    if (element.kind === "text") checkText(element);
  }
  const entries = [...regions];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [nameA, a] = entries[i];
      const [nameB, b] = entries[j];
      expect({
        pair: `${nameA} / ${nameB}`,
        overlap: boxesOverlap(a, b),
      }).toEqual({
        pair: `${nameA} / ${nameB}`,
        overlap: false,
      });
    }
  }
}

const GREYS: string[] = [
  CARD_COLORS.text,
  CARD_COLORS.textDark,
  CARD_COLORS.textDarker,
];

function checkText(element: TextElement): void {
  const floor = element.region === "brand" ? MIN_BRAND_TEXT : MIN_TEXT;
  expect({ text: element.runs, size: element.size >= floor }).toEqual({
    text: element.runs,
    size: true,
  });
  for (const run of element.runs) {
    if (GREYS.includes(run.color)) continue;
    expect({
      run,
      readable: element.size >= COLOURED_MIN && run.weight === "bold",
    }).toEqual({
      run,
      readable: true,
    });
  }
}

test("the checks themselves catch an overlap, a small text and a stray box", () => {
  const text = (region: string, y: number, size = MIN_TEXT): TextElement => ({
    kind: "text",
    region,
    x: 100,
    y,
    w: 200,
    h: size * 1.3,
    size,
    runs: [{ text: "x", color: CARD_COLORS.text, weight: "normal" }],
  });
  const layout = (elements: TextElement[]): CardLayout => ({
    width: 1080,
    height: 1080,
    background: { kind: "dark" },
    elements,
  });
  expect(() =>
    checkLayout(layout([text("a", 100), text("a", 110)]), "square"),
  ).not.toThrow();
  expect(() =>
    checkLayout(layout([text("a", 100), text("b", 110)]), "square"),
  ).toThrow();
  expect(() => checkLayout(layout([text("a", 100, 30)]), "square")).toThrow();
  expect(() => checkLayout(layout([text("a", 40)]), "square")).toThrow();
  expect(() => checkLayout(layout([text("a", 200)]), "story")).toThrow();
});

describe.each(SCORES)("the score card, %s", (_, content) => {
  test.each(
    FORMATS.flatMap((format) =>
      (["dark", "cover"] as const).map((look) => [format, look] as const),
    ),
  )("%s %s keeps every region apart and readable", (format, look) => {
    const options = resolveScoreOptions(content, { format, look }, all);
    checkLayout(layoutScoreCard(content, options, fakeMeasure), format);
  });
});

const PARTY_OPTIONS: PartyCardOptions[] = FORMATS.flatMap((format) =>
  (["dark", "mosaic"] as const).flatMap((look) =>
    (["podium", "spread"] as const).flatMap((focus) =>
      (["ranking", "strip"] as const).map((under) => ({
        format,
        look,
        focus,
        under,
      })),
    ),
  ),
);

describe.each(PARTIES)("the party card, %s", (_, content) => {
  test.each(
    PARTY_OPTIONS.map(
      (options) =>
        [
          options.format,
          options.look,
          options.focus,
          options.under,
          options,
        ] as const,
    ),
  )(
    "%s %s %s %s keeps every region apart and readable",
    (format, _look, _focus, _under, requested) => {
      const options = resolvePartyOptions(content, requested, all);
      checkLayout(layoutPartyCard(content, options, fakeMeasure), format);
    },
  );
});

function texts(layout: CardLayout, region?: string): string[] {
  return layout.elements
    .filter(
      (element): element is TextElement =>
        element.kind === "text" &&
        (region === undefined || element.region === region),
    )
    .map((element) => element.runs.map((run) => run.text).join(""));
}

test("the dark score square sits where §4.1 puts it", () => {
  const content = SCORES[0][1];
  const layout = layoutScoreCard(
    content,
    { format: "square", look: "dark" },
    fakeMeasure,
  );
  const cover = layout.elements.find((element) => element.kind === "image");
  expect(cover).toMatchObject({ x: 72, y: 72, w: 216, h: 216, radius: 0 });
  const number = layout.elements.find(
    (element) => element.kind === "text" && element.region === "score",
  );
  expect(number).toMatchObject({ size: 220, y: 336 });
  expect(texts(layout, "brand-note")[0]).toMatch(/^Friday karaoke · /);
  expect(layout.background).toEqual({ kind: "dark" });
});

test("the score turns gold only for a new highscore", () => {
  const plain = layoutScoreCard(
    SCORES[0][1],
    { format: "square", look: "dark" },
    fakeMeasure,
  );
  const record = layoutScoreCard(
    SCORES[2][1],
    { format: "square", look: "dark" },
    fakeMeasure,
  );
  const colour = (layout: CardLayout) =>
    (
      layout.elements.find(
        (e) => e.kind === "text" && e.region === "score",
      ) as TextElement
    ).runs[0].color;
  expect(colour(plain)).toBe(CARD_COLORS.text);
  expect(colour(record)).toBe(CARD_COLORS.gold);
  expect(texts(record, "flag")).toEqual(["New Highscore"]);
});

test("the cover look blurs the song's own cover behind the card", () => {
  const content = SCORES[0][1];
  const layout = layoutScoreCard(
    content,
    { format: "square", look: "cover" },
    fakeMeasure,
  );
  expect(layout.background).toEqual({ kind: "cover", url: content.cover.url });
  // No bar on the square Cover look (§4.1); the story keeps it.
  expect(layout.elements.some((element) => element.region === "bar")).toBe(
    false,
  );
  const story = layoutScoreCard(
    content,
    { format: "story", look: "cover" },
    fakeMeasure,
  );
  expect(story.elements.some((element) => element.region === "bar")).toBe(true);
  expect(texts(story, "eyebrow")[0]).toMatch(/^Friday karaoke · /);
});

test("a title never runs to a third line", () => {
  const content = SCORES[1][1];
  for (const format of FORMATS) {
    for (const look of ["dark", "cover"] as const) {
      const layout = layoutScoreCard(content, { format, look }, fakeMeasure);
      const lines = layout.elements.filter(
        (element) => element.kind === "text" && element.region === "title",
      );
      // Two title lines and the artist's.
      expect(lines).toHaveLength(3);
      expect(texts(layout, "title")[1].endsWith("…")).toBe(true);
    }
  }
});

test("ten singers: the podium, three rows and +4 more", () => {
  const content = PARTIES[4][1];
  const layout = layoutPartyCard(
    content,
    { format: "square", look: "dark", focus: "podium", under: "ranking" },
    fakeMeasure,
  );
  expect(texts(layout, "rows")).toContain("+4 more");
  expect(
    layout.elements.filter((e) => e.kind === "image" && e.region === "podium"),
  ).toHaveLength(3);
  expect(
    layout.elements.filter((e) => e.kind === "image" && e.region === "rows"),
  ).toHaveLength(3);
});

test("fifty singers: three rows and +44 more, the spread seven rows and +43 more", () => {
  const content = PARTIES.find(([name]) => name === "fifty singers")![1];
  const podium = layoutPartyCard(
    content,
    { format: "square", look: "dark", focus: "podium", under: "ranking" },
    fakeMeasure,
  );
  expect(texts(podium, "rows")).toContain("+44 more");
  const spread = layoutPartyCard(
    content,
    { format: "square", look: "dark", focus: "spread", under: "none" },
    fakeMeasure,
  );
  expect(texts(spread, "spread")).toContain("+43 more");
  const story = layoutPartyCard(
    content,
    { format: "story", look: "dark", focus: "spread", under: "none" },
    fakeMeasure,
  );
  expect(texts(story, "spread").some((text) => /^\+\d+ more$/.test(text))).toBe(
    true,
  );
});

test("one singer gets no podium: their picture large, their best the hero", () => {
  const layout = layoutPartyCard(
    PARTIES[0][1],
    { format: "square", look: "dark", focus: "podium", under: "strip" },
    fakeMeasure,
  );
  expect(layout.elements.some((element) => element.region === "podium")).toBe(
    false,
  );
  expect(texts(layout, "hero")).toEqual([
    "Chiara",
    String(PARTIES[0][1].numbers.best),
  ]);
});

test("a story has room for the rows and the strip both", () => {
  const layout = layoutPartyCard(
    PARTIES[3][1],
    { format: "story", look: "dark", focus: "podium", under: "ranking" },
    fakeMeasure,
  );
  expect(layout.elements.some((element) => element.region === "rows")).toBe(
    true,
  );
  expect(layout.elements.some((element) => element.region === "strip")).toBe(
    true,
  );
  const few = layoutPartyCard(
    PARTIES[5][1],
    { format: "story", look: "dark", focus: "podium", under: "ranking" },
    fakeMeasure,
  );
  expect(few.elements.some((element) => element.region === "strip")).toBe(
    false,
  );
});

test("the strip marks one gold score and says the median, not the best", () => {
  const content = PARTIES[3][1];
  const layout = layoutPartyCard(
    content,
    { format: "square", look: "dark", focus: "podium", under: "strip" },
    fakeMeasure,
  );
  const gold = layout.elements.filter(
    (element) =>
      element.kind === "circle" &&
      element.region === "strip" &&
      element.fill === CARD_COLORS.gold,
  );
  expect(gold).toHaveLength(1);
  expect(texts(layout, "strip")[0]).toBe(`Median ${content.median}`);
  expect(texts(layout, "strip").slice(1)).toEqual(["0", "5k", "10k"]);
});

test("the spread is one row per singer under a one-line ranking", () => {
  const content = PARTIES[3][1];
  const layout = layoutPartyCard(
    content,
    { format: "square", look: "dark", focus: "spread", under: "none" },
    fakeMeasure,
  );
  expect(texts(layout, "ranking")).toEqual([
    `1 Chiara ${content.ranking[0].best} · 2 Alice ${content.ranking[1].best} · 3 Ben ${content.ranking[2].best}`,
  ]);
  const names = texts(layout, "spread").filter((text) => text.includes("×"));
  expect(names).toEqual(
    content.ranking.map((entry) => `${entry.person.name} ×4`),
  );
  expect(layout.elements.some((element) => element.region === "podium")).toBe(
    false,
  );
  // Ten singers do not fit a square: the rest are counted.
  const ten = layoutPartyCard(
    PARTIES[4][1],
    { format: "square", look: "dark", focus: "spread", under: "none" },
    fakeMeasure,
  );
  expect(texts(ten, "spread")).toContain("+3 more");
});

test("the spread boxes a singer from five scores on", () => {
  const content = party(cardParty(3, 5));
  const layout = layoutPartyCard(
    content,
    { format: "square", look: "dark", focus: "spread", under: "none" },
    fakeMeasure,
  );
  expect(
    layout.elements.filter((e) => e.kind === "rect" && e.region === "spread"),
  ).toHaveLength(3);
});

test("the mosaic fills its grid by repeating the covers it has", () => {
  const content = party(cardParty(4, 1));
  expect(content.covers).toHaveLength(4);
  const square = layoutPartyCard(
    content,
    { format: "square", look: "mosaic", focus: "podium", under: "none" },
    fakeMeasure,
  );
  expect(square.background.kind).toBe("mosaic");
  if (square.background.kind !== "mosaic") return;
  expect(square.background.cells).toHaveLength(9);
  expect(square.background.cells.map((cell) => cell.url).slice(4, 5)).toEqual([
    content.covers[0],
  ]);
  const story = layoutPartyCard(
    content,
    { format: "story", look: "mosaic", focus: "podium", under: "none" },
    fakeMeasure,
  );
  if (story.background.kind !== "mosaic") throw new Error("not a mosaic");
  expect(story.background.cells).toHaveLength(18);
  // Only the covers that arrived take a cell.
  const some = layoutPartyCard(
    content,
    { format: "square", look: "mosaic", focus: "podium", under: "none" },
    fakeMeasure,
    (url) => url !== content.covers[0],
  );
  if (some.background.kind !== "mosaic") throw new Error("not a mosaic");
  expect(some.background.cells.map((cell) => cell.url)).not.toContain(
    content.covers[0],
  );
});
