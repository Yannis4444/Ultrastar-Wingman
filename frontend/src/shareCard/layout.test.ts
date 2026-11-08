import type { ScoreWithContext } from "../api";
import { cardDate } from "../duration";
import {
  LONG_ACHIEVEMENT,
  PICTURED,
  SONGS,
  achievementContent,
  cardParty,
  cardPlayers,
  cardScore,
  fakeMeasure,
  partySession,
  singerId,
  singerScores,
  song,
} from "../test/shareCard";
import { chartTheme } from "../chartTheme";
import {
  partyCard,
  type AchievementCardContent,
  playerCard,
  scoreCard,
  type PartyCardContent,
  type PlayerCardContent,
  type ScoreCardContent,
} from "./content";
import {
  CARD_COLORS,
  CARD_WIDTH,
  COLOURED_MIN,
  MIN_BRAND_TEXT,
  MIN_TEXT,
  SAFE_AREA,
  SCRIM_ALPHA,
  elementBox,
  layoutAchievementCard,
  layoutPartyCard,
  layoutPlayerCard,
  layoutScoreCard,
  type Box,
  type CardFormat,
  type CardLayout,
  type TextElement,
} from "./layout";
import {
  PARTY_DESIGNS,
  PLAYER_DESIGNS,
  resolveAchievementOptions,
  resolvePartyOptions,
  resolvePlayerOptions,
  resolveScoreOptions,
} from "./possible";

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
  [
    "name off, ten singers",
    party(cardParty(10, 3), { partyNameAndDate: false }),
  ],
  [
    "name off, one singer",
    party(cardParty(1, 5), { me: "chiara", partyNameAndDate: false }),
  ],
  [
    "unnamed",
    party(cardParty(4, 3), { session: partySession({ name: null }) }),
  ],
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
    halo: false,
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

/** Every slide of the carousel in both formats: what the panel can ask a
 * party card for. */
const PARTY_SLIDES = FORMATS.flatMap((format) =>
  PARTY_DESIGNS.map((design) => [format, design] as const),
);

describe.each(PARTIES)("the party card, %s", (_, content) => {
  test.each(PARTY_SLIDES)(
    "%s %s keeps every region apart and readable",
    (format, design) => {
      const options = resolvePartyOptions(content, design, format, all);
      checkLayout(layoutPartyCard(content, options, fakeMeasure), format);
    },
  );
});

function playerOf(
  scores: ScoreWithContext[],
  overrides: Partial<Parameters<typeof playerCard>[0]> = {},
): PlayerCardContent {
  return playerCard({
    scores,
    session: partySession(),
    players,
    me: "chiara",
    otherPictures: true,
    partyNameAndDate: true,
    ...overrides,
  });
}

/** A record of `count` scores over every song, spread over the range. */
function record(id: string, count: number): ScoreWithContext[] {
  return singerScores(
    id,
    Array.from({ length: count }, (_, index) =>
      Math.round(9800 - ((index * 3137) % 7000)),
    ),
  );
}

const manySongs = Array.from({ length: 12 }, (_, index) =>
  index % 4 === 3
    ? longSong
    : song(`usdb:${200 + index}`, `Artist ${index}`, `Song number ${index}`),
);

const PLAYERS: [string, PlayerCardContent][] = [
  ["many scores", playerOf(record("alice", 60))],
  ["four scores", playerOf(record("alice", 4))],
  ["one score", playerOf(record("alice", 1))],
  [
    "three scores of one song",
    playerOf(singerScores("alice", [7000, 8000, 6000], [SONGS[0]])),
  ],
  ["my own, all parties", playerOf(record("chiara", 20), { session: null })],
  ["line off", playerOf(record("alice", 12), { partyNameAndDate: false })],
  [
    "a long name at a long party, long songs",
    playerOf(
      singerScores(
        "long",
        Array.from({ length: 24 }, (_, index) => 9500 - index * 300),
        manySongs,
      ),
      { session: longParty },
    ),
  ],
  [
    "lost songs, a zero and a perfect score",
    playerOf(singerScores("alice", [0, 10000, 5000, 2500], [null, SONGS[1]])),
  ],
  [
    "every score in one bucket",
    playerOf(singerScores("alice", [8100, 8200, 8300, 8400, 8450])),
  ],
];

/** Every slide of a player card in both formats. */
const PLAYER_SLIDES = FORMATS.flatMap((format) =>
  PLAYER_DESIGNS.map((design) => [format, design] as const),
);

describe.each(PLAYERS)("the player card, %s", (_, content) => {
  test.each(PLAYER_SLIDES)(
    "%s %s keeps every region apart and readable",
    (format, design) => {
      const options = resolvePlayerOptions(content, design, format);
      checkLayout(layoutPlayerCard(content, options, fakeMeasure), format);
    },
  );
});

test("the player square sits where §9 puts it: the head, the numbers at 232, the focus between 392 and 936", () => {
  const content = PLAYERS[0][1];
  for (const design of PLAYER_DESIGNS) {
    const layout = layoutPlayerCard(
      content,
      { format: "square", focus: design },
      fakeMeasure,
    );
    const avatar = layout.elements.find(
      (element) => element.kind === "image" && element.region === "head",
    );
    expect(avatar).toMatchObject({ x: 72, y: 72, w: 120, h: 120 });
    const value = layout.elements.find(
      (element) => element.kind === "text" && element.region === "numbers",
    );
    expect(value).toMatchObject({ y: 232, size: 56 });
    const focus = layout.elements.filter(
      (element) =>
        element.region === design ||
        (design === "strip" && element.region === "strip"),
    );
    expect(focus.length).toBeGreaterThan(0);
    for (const element of focus) {
      const box = elementBox(element);
      expect(box.y).toBeGreaterThanOrEqual(392 - 0.5);
      expect(box.y + box.h).toBeLessThanOrEqual(936 + 0.5);
    }
    expect(layout.background).toEqual({ kind: "dark" });
    expect(texts(layout, "head")).toEqual([
      "Alice",
      `Friday karaoke · ${cardDate(partySession().started_at)}`,
    ]);
    // "ranked by best score" is the Songs design's alone.
    expect(texts(layout, "brand-note")).toEqual(
      design === "songs" ? ["ranked by best score"] : [],
    );
  }
});

test("the numbers are Sings, Songs, Best and Average, Best gold with no holder", () => {
  const layout = layoutPlayerCard(
    PLAYERS[0][1],
    { format: "square", focus: "histogram" },
    fakeMeasure,
  );
  const labels = texts(layout, "numbers").filter((text) => /\D/.test(text));
  expect(labels).toEqual(["Sings", "Songs", "Best", "Average"]);
  const best = layout.elements.find(
    (element) =>
      element.kind === "text" &&
      element.region === "numbers" &&
      element.runs[0].text === String(PLAYERS[0][1].numbers.best),
  ) as TextElement;
  expect(best.runs[0].color).toBe(CARD_COLORS.gold);
});

test("the histogram is twenty bars at most 440 tall, the best's bar gold, on a baseline over three ticks", () => {
  const content = PLAYERS[0][1];
  const layout = layoutPlayerCard(
    content,
    { format: "square", focus: "histogram" },
    fakeMeasure,
  );
  const bars = layout.elements.filter(
    (element) => element.kind === "rect" && element.region === "histogram",
  );
  expect(bars).toHaveLength(
    content.buckets.filter((count) => count > 0).length,
  );
  expect(
    Math.max(...bars.map((bar) => (bar.kind === "rect" ? bar.h : 0))),
  ).toBe(440);
  const gold = bars.filter(
    (bar) => bar.kind === "rect" && bar.fill === chartTheme.gold,
  );
  expect(gold).toHaveLength(1);
  expect(texts(layout, "histogram")).toEqual(["0", "5k", "10k"]);
  // A bucket of one among many is still a bar a chat keeps.
  for (const bar of bars)
    if (bar.kind === "rect") expect(bar.h).toBeGreaterThanOrEqual(8);
  const story = layoutPlayerCard(
    content,
    { format: "story", focus: "histogram" },
    fakeMeasure,
  );
  const storyBars = story.elements.filter(
    (element) => element.kind === "rect" && element.region === "histogram",
  );
  expect(
    Math.max(...storyBars.map((bar) => (bar.kind === "rect" ? bar.h : 0))),
  ).toBe(640);
});

test("the strip is the party card's, larger: Median over dots r 12, the best one gold", () => {
  const layout = layoutPlayerCard(
    PLAYERS[1][1],
    { format: "square", focus: "strip" },
    fakeMeasure,
  );
  expect(texts(layout, "strip")[0]).toMatch(/^Median \d+$/);
  const dots = layout.elements.filter(
    (element) =>
      element.kind === "circle" &&
      element.region === "strip" &&
      element.fill !== null,
  );
  expect(dots).toHaveLength(4);
  for (const dot of dots) if (dot.kind === "circle") expect(dot.r).toBe(12);
  expect(
    dots.filter((dot) => dot.kind === "circle" && dot.fill === chartTheme.gold),
  ).toHaveLength(1);
});

test.each(FORMATS)(
  "a dense cloud on the %s strip gets a lane per dot: the band grows instead of piling them up",
  (format) => {
    // Fifty scores packed into 6000–8500, as an evening of one regular is.
    const content = playerOf(
      singerScores(
        "alice",
        Array.from({ length: 50 }, (_, index) => 6000 + ((index * 977) % 2500)),
      ),
    );
    const layout = layoutPlayerCard(
      content,
      { format, focus: "strip" },
      fakeMeasure,
    );
    checkLayout(layout, format);
    const dots = layout.elements.flatMap((element) =>
      element.kind === "circle" &&
      element.region === "strip" &&
      element.fill !== null
        ? [element]
        : [],
    );
    expect(dots).toHaveLength(50);
    for (let i = 0; i < dots.length; i++)
      for (let j = i + 1; j < dots.length; j++)
        expect(
          Math.hypot(dots[i].cx - dots[j].cx, dots[i].cy - dots[j].cy),
        ).toBeGreaterThanOrEqual(28 - 1e-6);
    // The grid lines are the band: every dot and its ring inside it.
    const band = layout.elements.flatMap((element) =>
      element.kind === "line" &&
      element.region === "strip" &&
      element.x1 === element.x2
        ? [element]
        : [],
    );
    const top = Math.min(...band.map((line) => line.y1));
    const bottom = Math.max(...band.map((line) => line.y2));
    // The square's 200 is too low for this cloud; the story's 280 holds it.
    if (format === "square") expect(bottom - top).toBeGreaterThan(200);
    else expect(bottom - top).toBe(280);
    for (const dot of dots) {
      expect(dot.cy - 24).toBeGreaterThanOrEqual(top);
      expect(dot.cy + 24).toBeLessThanOrEqual(bottom);
    }
  },
);

/** The strip's band (its grid lines' extent) and its dots. */
function stripOf(layout: CardLayout) {
  const lines = layout.elements.flatMap((element) =>
    element.kind === "line" &&
    element.region === "strip" &&
    element.x1 === element.x2
      ? [element]
      : [],
  );
  const dots = layout.elements.flatMap((element) =>
    element.kind === "circle" &&
    element.region === "strip" &&
    element.fill !== null
      ? [element]
      : [],
  );
  const top = Math.min(...lines.map((line) => line.y1));
  const bottom = Math.max(...lines.map((line) => line.y2));
  // Every dot at one size, whichever step the strip took (§4.2: r 10, 8, 6).
  const r = Math.max(...dots.map((dot) => dot.r));
  expect(dots.every((dot) => dot.r === r)).toBe(true);
  // The swarm's gap is 2.4 radii (24 at r 10): no two dots closer, no pile.
  const apart = dots.every((dot, i) =>
    dots
      .slice(i + 1)
      .every(
        (other) =>
          Math.hypot(dot.cx - other.cx, dot.cy - other.cy) >= 2.4 * r - 1e-6,
      ),
  );
  return { band: bottom - top, top, bottom, dots, r, apart };
}

/** Forty-eight scores packed into 6000–8500 over `singers` singers: a big
 * evening's dense cloud. */
function denseParty(singers: number): ScoreWithContext[] {
  return Array.from({ length: 48 }, (_, index) =>
    cardScore(
      singerId(index % singers),
      6000 + ((index * 977) % 2500),
      SONGS[index % SONGS.length],
    ),
  );
}

test.each([
  // [what, singers, format, head, the band at most, the dots' radius]
  // Under a head the square has about 120 of air: too little for every dot
  // at r 10 or r 8, so the dots step down to r 6 rather than pile.
  ["a square under a head", 8, "square", true, 120, 6],
  ["a square without a head", 8, "square", false, 270, 10],
  ["a story with rows", 8, "story", true, 175, 8],
  ["a story of three singers", 3, "story", true, 452, 10],
  // One singer is the hero: it keeps the preset it takes at the least band.
  ["a square of one singer under a head", 1, "square", true, 120, 6],
  ["a square of one singer without a head", 1, "square", false, 160, 8],
] as const)(
  "a dense party strip on %s grows into the room its region leaves, then draws smaller dots, never piled ones",
  (_, singers, format, head, most, r) => {
    const content = party(denseParty(singers), { partyNameAndDate: head });
    const options = resolvePartyOptions(content, "strip", format, all);
    expect(options.under).toBe("strip");
    const layout = layoutPartyCard(content, options, fakeMeasure);
    checkLayout(layout, format);
    const strip = stripOf(layout);
    expect(strip.dots).toHaveLength(48);
    // Never under its least, and never past what the podium leaves.
    expect(strip.band).toBeGreaterThanOrEqual(format === "square" ? 100 : 150);
    expect(strip.band).toBeLessThanOrEqual(most);
    expect(strip.r).toBeCloseTo(r);
    for (const dot of strip.dots) {
      expect(dot.cy - dot.r).toBeGreaterThanOrEqual(strip.top);
      expect(dot.cy + dot.r).toBeLessThanOrEqual(strip.bottom);
    }
    // Every dot has a lane of its own.
    expect(strip.apart).toBe(true);
  },
);

test.each(FORMATS)(
  "a party strip of a few scores keeps its least band on a %s",
  (format) => {
    const content = party(cardParty(4, 2));
    const layout = layoutPartyCard(
      content,
      resolvePartyOptions(content, "strip", format, all),
      fakeMeasure,
    );
    const strip = stripOf(layout);
    expect(strip.band).toBe(format === "square" ? 100 : 150);
    // And its full-size dots.
    expect(strip.r).toBe(10);
  },
);

test.each(
  FORMATS.flatMap((format) =>
    PLAYER_DESIGNS.map((design) => [format, design] as const),
  ),
)(
  "a player %s %s carries the logo and its words, and the note on Songs alone",
  (format, focus) => {
    const layout = layoutPlayerCard(
      PLAYERS[0][1],
      { format, focus },
      fakeMeasure,
    );
    expectBrand(layout, format);
    expect(texts(layout, "brand-note")).toEqual(
      focus === "songs" ? ["ranked by best score"] : [],
    );
  },
);

test("Songs lists five on a square and eight on a story, the top one gold", () => {
  const content = PLAYERS[6][1];
  const rows = (format: CardFormat) =>
    layoutPlayerCard(
      content,
      { format, focus: "songs" },
      fakeMeasure,
    ).elements.filter(
      (element) => element.kind === "image" && element.region === "songs",
    );
  expect(rows("square")).toHaveLength(5);
  expect(rows("story")).toHaveLength(8);
  for (const cover of rows("square"))
    expect(cover).toMatchObject({ w: 80, h: 80, radius: 0 });
  const square = layoutPlayerCard(
    content,
    { format: "square", focus: "songs" },
    fakeMeasure,
  );
  const golds = square.elements.filter(
    (element) =>
      element.kind === "text" &&
      element.region === "songs" &&
      element.runs.some((part) => part.color === CARD_COLORS.gold),
  );
  expect(golds).toHaveLength(1);
});

test("with the line off the name stands alone, and the story's head is centred", () => {
  const content = PLAYERS[5][1];
  const square = layoutPlayerCard(
    content,
    { format: "square", focus: "histogram" },
    fakeMeasure,
  );
  expect(texts(square, "head")).toEqual(["Alice"]);
  const story = layoutPlayerCard(
    PLAYERS[0][1],
    { format: "story", focus: "histogram" },
    fakeMeasure,
  );
  const avatar = story.elements.find(
    (element) => element.kind === "image" && element.region === "head",
  );
  expect(avatar).toMatchObject({ w: 200, x: 540 - 100 });
});

test("a card with nothing to focus on is the head and the numbers alone", () => {
  const content = PLAYERS[2][1];
  const layout = layoutPlayerCard(
    content,
    resolvePlayerOptions(content, "histogram", "square"),
    fakeMeasure,
  );
  expect(new Set(layout.elements.map((element) => element.region))).toEqual(
    new Set(["head", "numbers", "brand"]),
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
    {
      format: "square",
      look: "dark",
      focus: "podium",
      under: "ranking",
    },
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
    {
      format: "square",
      look: "dark",
      focus: "podium",
      under: "ranking",
    },
    fakeMeasure,
  );
  expect(texts(podium, "rows")).toContain("+44 more");
  const spread = layoutPartyCard(
    content,
    {
      format: "square",
      look: "dark",
      focus: "spread",
      under: "none",
    },
    fakeMeasure,
  );
  expect(texts(spread, "spread")).toContain("+43 more");
  const story = layoutPartyCard(
    content,
    {
      format: "story",
      look: "dark",
      focus: "spread",
      under: "none",
    },
    fakeMeasure,
  );
  expect(texts(story, "spread").some((text) => /^\+\d+ more$/.test(text))).toBe(
    true,
  );
});

test("one singer gets no podium: their picture large, their best the hero", () => {
  const layout = layoutPartyCard(
    PARTIES[0][1],
    {
      format: "square",
      look: "dark",
      focus: "podium",
      under: "strip",
    },
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

test("a story's Podium draws the rows, its Strip the rows and the strip", () => {
  const story = (under: "ranking" | "strip", content = PARTIES[3][1]) =>
    layoutPartyCard(
      content,
      { format: "story", look: "dark", focus: "podium", under },
      fakeMeasure,
    );
  const has = (layout: CardLayout, region: string) =>
    layout.elements.some((element) => element.region === region);
  const podium = story("ranking");
  expect(has(podium, "rows")).toBe(true);
  expect(has(podium, "strip")).toBe(false);
  const strip = story("strip");
  expect(has(strip, "rows")).toBe(true);
  expect(has(strip, "strip")).toBe(true);
  // Each where there is something to draw: three singers have no rows, and
  // under four scores there is no strip.
  const three = story("strip", PARTIES[2][1]);
  expect(has(three, "rows")).toBe(false);
  expect(has(three, "strip")).toBe(true);
  expect(has(story("strip", PARTIES[5][1]), "strip")).toBe(false);
});

test("the strip marks one gold score and says the median, not the best", () => {
  const content = PARTIES[3][1];
  const layout = layoutPartyCard(
    content,
    {
      format: "square",
      look: "dark",
      focus: "podium",
      under: "strip",
    },
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
    {
      format: "square",
      look: "dark",
      focus: "spread",
      under: "none",
    },
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
    {
      format: "square",
      look: "dark",
      focus: "spread",
      under: "none",
    },
    fakeMeasure,
  );
  expect(texts(ten, "spread")).toContain("+3 more");
});

test("the spread boxes a singer from five scores on", () => {
  const content = party(cardParty(3, 5));
  const layout = layoutPartyCard(
    content,
    {
      format: "square",
      look: "dark",
      focus: "spread",
      under: "none",
    },
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
    {
      format: "square",
      look: "mosaic",
      focus: "podium",
      under: "none",
    },
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
    {
      format: "story",
      look: "mosaic",
      focus: "podium",
      under: "none",
    },
    fakeMeasure,
  );
  if (story.background.kind !== "mosaic") throw new Error("not a mosaic");
  expect(story.background.cells).toHaveLength(18);
  // Only the covers that arrived take a cell.
  const some = layoutPartyCard(
    content,
    {
      format: "square",
      look: "mosaic",
      focus: "podium",
      under: "none",
    },
    fakeMeasure,
    (url) => url !== content.covers[0],
  );
  if (some.background.kind !== "mosaic") throw new Error("not a mosaic");
  expect(some.background.cells.map((cell) => cell.url)).not.toContain(
    content.covers[0],
  );
});

function runColors(layout: CardLayout): string[] {
  return layout.elements.flatMap((element) =>
    element.kind === "text" ? element.runs.map((part) => part.color) : [],
  );
}

test.each(["square", "story"] as const)(
  "the mosaic's %s is the covers under one scrim, no band, every word over a halo",
  (format) => {
    const layout = layoutPartyCard(
      party(cardParty(4, 2)),
      { format, look: "mosaic", focus: "podium", under: "none" },
      fakeMeasure,
    );
    if (layout.background.kind !== "mosaic") throw new Error("not a mosaic");
    expect(Object.keys(layout.background).sort()).toEqual(["cells", "kind"]);
    expect(SCRIM_ALPHA.mosaic).toBe(0.84);
    expect(layout.halo).toBe(true);
    // The grey words take #ccc over the covers; nothing is left at #888.
    const colors = runColors(layout);
    expect(colors).not.toContain(CARD_COLORS.textDarker);
    expect(colors).toContain(CARD_COLORS.textDark);
    expect(texts(layout, "brand")).toEqual(["Ultrastar Wingman"]);
  },
);

test("dark has no halo and keeps its #888 words", () => {
  const dark = layoutPartyCard(
    party(cardParty(4, 2)),
    {
      format: "square",
      look: "dark",
      focus: "podium",
      under: "none",
    },
    fakeMeasure,
  );
  expect(dark.background).toEqual({ kind: "dark" });
  expect(dark.halo).toBe(false);
  expect(runColors(dark)).toContain(CARD_COLORS.textDarker);
  const score = layoutScoreCard(
    SCORES[0][1],
    { format: "square", look: "cover" },
    fakeMeasure,
  );
  expect(score.halo).toBe(false);
});

/** The top of the first element of `region`. */
function topOf(layout: CardLayout, region: string): number {
  return Math.min(
    ...layout.elements
      .filter((element) => element.region === region)
      .map((element) => elementBox(element).y),
  );
}

function bottomOf(layout: CardLayout, region: string): number {
  return Math.max(
    ...layout.elements
      .filter((element) => element.region === region)
      .map((element) => {
        const box = elementBox(element);
        return box.y + box.h;
      }),
  );
}

const named = party(cardParty(6, 4));
const nameless = party(cardParty(6, 4), { partyNameAndDate: false });

test("a party's head is its name over the date and the singer count", () => {
  const layout = layoutPartyCard(
    named,
    {
      format: "square",
      look: "dark",
      focus: "podium",
      under: "strip",
    },
    fakeMeasure,
  );
  expect(texts(layout, "head")).toEqual([
    "Friday karaoke",
    `${cardDate(partySession().started_at)} · 6 singers`,
  ]);
  expect(topOf(layout, "head")).toBe(72);
  expect(topOf(layout, "numbers")).toBe(222);
  const unnamed = layoutPartyCard(
    party(cardParty(6, 4), { session: partySession({ name: null }) }),
    {
      format: "square",
      look: "dark",
      focus: "podium",
      under: "strip",
    },
    fakeMeasure,
  );
  expect(texts(unnamed, "head")).toEqual([
    cardDate(partySession().started_at),
    "6 singers",
  ]);
});

/** The margin, and the line 24 above the brand's logo: what a square party
 * card's content stands between. */
const SQUARE_CONTENT = { top: 72, bottom: 1080 - 72 - 48 - 24 };

test.each(["ranking", "strip"] as const)(
  "with the name and date off the block closes up and is centred, %s under the podium",
  (under) => {
    const options = {
      format: "square",
      look: "dark",
      focus: "podium",
      under,
    } as const;
    const on = layoutPartyCard(named, options, fakeMeasure);
    const off = layoutPartyCard(nameless, options, fakeMeasure);
    expect(off.elements.some((element) => element.region === "head")).toBe(
      false,
    );
    expect(texts(off).some((text) => text.includes("singers"))).toBe(false);
    const region = under === "ranking" ? "rows" : "strip";
    // What is under the podium follows it at the head card's own 24 (the
    // rows' first numeral sits 2 into its row's line, hence the slack),
    // rather than staying at the foot with the air above it.
    const gap = topOf(off, region) - bottomOf(off, "podium");
    expect(gap).toBeGreaterThanOrEqual(24);
    expect(gap).toBeLessThanOrEqual(26);
    // The podium starts 150 under the numbers' top, the head card's body gap
    // without the slack the head card centres its podium in.
    const numbersToPodium = topOf(off, "podium") - topOf(off, "numbers");
    expect(numbersToPodium).toBeCloseTo(150);
    expect(numbersToPodium).toBeLessThanOrEqual(
      topOf(on, "podium") - topOf(on, "numbers"),
    );
    // And the whole block, numbers to the last row or the strip's axis, is
    // centred in the card's content area.
    const above = topOf(off, "numbers") - SQUARE_CONTENT.top;
    const below = SQUARE_CONTENT.bottom - bottomOf(off, region);
    expect(above).toBeGreaterThan(0);
    expect(Math.abs(above - below)).toBeLessThanOrEqual(4);
  },
);

test.each([
  ["the mosaic's podium alone", nameless, "mosaic", "podium"],
  [
    "one singer's hero",
    party(cardParty(1, 5), { partyNameAndDate: false }),
    "dark",
    "hero",
  ],
] as const)(
  "with the name and date off %s is centred with the numbers over it",
  (_, content, look, body) => {
    const options = {
      format: "square",
      look,
      focus: "podium",
      under: "none",
    } as const;
    const off = layoutPartyCard(content, options, fakeMeasure);
    expect(topOf(off, body) - topOf(off, "numbers")).toBeCloseTo(150);
    const above = topOf(off, "numbers") - SQUARE_CONTENT.top;
    const below = SQUARE_CONTENT.bottom - bottomOf(off, body);
    expect(above).toBeGreaterThan(0);
    expect(Math.abs(above - below)).toBeLessThanOrEqual(4);
  },
);

test("the party's numbers say 1 Sing and 1 Song, never 1 Songs", () => {
  const options = {
    format: "square",
    look: "dark",
    focus: "podium",
    under: "none",
  } as const;
  const one = layoutPartyCard(party(cardParty(1, 1)), options, fakeMeasure);
  expect(texts(one, "numbers")).toEqual(
    expect.arrayContaining(["1", "Sing", "Song"]),
  );
  expect(texts(one, "numbers")).not.toContain("Songs");
  const many = layoutPartyCard(named, options, fakeMeasure);
  expect(texts(many, "numbers")).toEqual(
    expect.arrayContaining(["Sings", "Songs"]),
  );
});

test("with the name and date off the spread's line and rows move up by the head", () => {
  const options = {
    format: "square",
    look: "dark",
    focus: "spread",
    under: "none",
  } as const;
  const on = layoutPartyCard(named, options, fakeMeasure);
  const off = layoutPartyCard(nameless, options, fakeMeasure);
  expect(topOf(off, "numbers")).toBe(72);
  expect(topOf(off, "ranking")).toBe(topOf(on, "ranking") - 150);
  expect(topOf(off, "spread")).toBeLessThan(topOf(on, "spread"));
  // The rows take the room the head left: never fewer of them.
  const rows = (layout: CardLayout) =>
    texts(layout, "spread").filter((text) => text.includes("×")).length;
  expect(rows(off)).toBeGreaterThanOrEqual(rows(on));
});

test.each(["podium", "spread"] as const)(
  "a story without the name and date leads with the numbers, the rest centred, %s",
  (focus) => {
    const options = {
      format: "story",
      look: "dark",
      focus,
      under: "none",
    } as const;
    const on = layoutPartyCard(named, options, fakeMeasure);
    const off = layoutPartyCard(nameless, options, fakeMeasure);
    expect(off.elements.some((element) => element.region === "head")).toBe(
      false,
    );
    expect(topOf(off, "numbers")).toBeLessThan(topOf(on, "numbers"));
    const body = focus === "podium" ? "podium" : "spread";
    // The stack lost the head and its gap; centred, everything under rises
    // by half of what went — unless the spread grew into the room instead.
    if (focus === "podium") {
      const went = 56 * 1.3 + 4 + 32 * 1.3 + 56;
      expect(topOf(off, body)).toBeCloseTo(topOf(on, body) - went / 2);
    } else {
      expect(topOf(off, body)).toBeLessThanOrEqual(topOf(on, body));
    }
  },
);

/** One logo, at the brand's place and size, and its words beside it. */
function expectBrand(layout: CardLayout, format: "square" | "story"): void {
  const logos = layout.elements.filter((element) => element.kind === "logo");
  expect(logos).toHaveLength(1);
  const bottom = SAFE_AREA[format].bottom;
  expect(logos[0]).toMatchObject({ x: 72, y: bottom - 48, size: 48 });
  expect(texts(layout, "brand")).toEqual(["Ultrastar Wingman"]);
}

test.each(
  FORMATS.flatMap((format) =>
    (["dark", "cover"] as const).map((look) => [format, look] as const),
  ),
)(
  "a score %s %s carries the logo and its words, with the party · date beside them on a square",
  (format, look) => {
    const layout = layoutScoreCard(SCORES[1][1], { format, look }, fakeMeasure);
    expectBrand(layout, format);
    expect(texts(layout, "brand-note")).toHaveLength(
      format === "square" ? 1 : 0,
    );
  },
);

test.each(PARTY_SLIDES)(
  "a party %s %s carries the logo and its words, and the ranking note",
  (format, design) => {
    const layout = layoutPartyCard(
      named,
      resolvePartyOptions(named, design, format, all),
      fakeMeasure,
    );
    expectBrand(layout, format);
    expect(texts(layout, "brand-note")).toEqual(["ranked by best score"]);
  },
);

// ------------------------------------------------------------ an achievement

const ACHIEVEMENTS: [string, AchievementCardContent][] = [
  ["a built-in with a picture", achievementContent(PICTURED)],
  ["a badge without a picture", achievementContent({ icon: "mic" })],
  [
    "a long name and a long description, no picture",
    achievementContent(LONG_ACHIEVEMENT),
  ],
  [
    "a long name and description with a picture, no count, no face",
    achievementContent(
      { ...PICTURED, ...LONG_ACHIEVEMENT, holder_count: null },
      null,
    ),
  ],
  ["a sentence of one line", achievementContent({ description: "Sing." })],
  ["no sentence at all", achievementContent({ description: "" })],
];

describe.each(ACHIEVEMENTS)("the achievement card, %s", (_, content) => {
  test.each(FORMATS)("fits on a %s card", (format) => {
    const options = resolveAchievementOptions(format);
    // Both with the picture in and without it: one that did not decode is
    // the plate, which takes the same box.
    for (const loaded of [all, () => false]) {
      checkLayout(
        layoutAchievementCard(content, options, fakeMeasure, loaded),
        format,
      );
    }
  });
});

function boxOf(layout: CardLayout, region: string): Box {
  const boxes = layout.elements
    .filter((element) => element.region === region)
    .map(elementBox);
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    w: Math.max(...boxes.map((box) => box.x + box.w)) - x,
    h: Math.max(...boxes.map((box) => box.y + box.h)) - y,
  };
}

test("the achievement square sits where §10 puts it", () => {
  const layout = layoutAchievementCard(
    achievementContent({
      ...PICTURED,
      // Two lines of description, as §10's table is drawn for.
      description:
        "Sing your very first song at a party, any song at all, and any score.",
    }),
    { format: "square" },
    fakeMeasure,
  );
  const badge = layout.elements.find((element) => element.region === "badge");
  expect(badge).toMatchObject({ kind: "image", w: 400, h: 400, radius: 80 });
  expect(boxOf(layout, "badge").x).toBe(340);
  expect(boxOf(layout, "badge").y).toBeCloseTo(72, 0);
  expect(boxOf(layout, "name").y).toBeCloseTo(512, 0);
  expect(boxOf(layout, "description").y).toBeCloseTo(600, 0);
  expect(boxOf(layout, "description").h).toBeCloseTo(104, 0);
  expect(boxOf(layout, "sharer").y).toBeCloseTo(744, 0);
  expect(boxOf(layout, "sharer").h).toBe(72);
  expect(boxOf(layout, "earned").y).toBeCloseTo(848, 0);
  expect(texts(layout, "name")).toEqual(["First Time on the Mic"]);
  expect(texts(layout, "sharer")).toEqual(["Chiara"]);
  expect(texts(layout, "earned")).toEqual([
    `Earned ${cardDate("2026-08-12T20:15:00Z")}`,
    "Earned by 3 players",
  ]);
  // Everything is centred on the card.
  for (const region of ["badge", "name", "description", "sharer", "earned"]) {
    const box = boxOf(layout, region);
    expect(box.x + box.w / 2).toBeCloseTo(CARD_WIDTH / 2, 0);
  }
  // The brand alone at the foot, nothing at its right.
  expect(texts(layout, "brand")).toEqual(["Ultrastar Wingman"]);
  expect(texts(layout, "brand-note")).toEqual([]);
});

test("without a picture the badge is its plate, a fifth rounded, the glyph half its side in --bg", () => {
  const content = achievementContent({ icon: "mic", color: "gold" });
  for (const [format, side] of [
    ["square", 400],
    ["story", 560],
  ] as const) {
    const layout = layoutAchievementCard(content, { format }, fakeMeasure);
    const badge = layout.elements.filter(
      (element) => element.region === "badge",
    );
    expect(badge).toMatchObject([
      { kind: "rect", w: side, h: side, radius: side / 5, fill: "#faa636" },
      { kind: "icon", name: "mic", size: side / 2, color: CARD_COLORS.bg },
    ]);
  }
});

test("a picture that did not arrive is drawn as the plate, never a letter", () => {
  const layout = layoutAchievementCard(
    achievementContent(PICTURED),
    { format: "square" },
    fakeMeasure,
    () => false,
  );
  expect(
    layout.elements
      .filter((element) => element.region === "badge")
      .map((element) => element.kind),
  ).toEqual(["rect", "icon"]);
});

test("a long name is one line, cut; a long description two lines on a square and three on a story", () => {
  const content = achievementContent(LONG_ACHIEVEMENT);
  const square = layoutAchievementCard(
    content,
    { format: "square" },
    fakeMeasure,
  );
  const story = layoutAchievementCard(
    content,
    { format: "story" },
    fakeMeasure,
  );
  for (const layout of [square, story]) {
    const name = texts(layout, "name");
    expect(name).toHaveLength(1);
    expect(name[0].endsWith("…")).toBe(true);
  }
  expect(texts(square, "description")).toHaveLength(2);
  expect(texts(square, "description")[1].endsWith("…")).toBe(true);
  expect(texts(story, "description")).toHaveLength(3);
  // The name at its smaller size, the description at its one.
  const sizes = (layout: CardLayout, region: string) =>
    layout.elements
      .filter(
        (element): element is TextElement =>
          element.kind === "text" && element.region === region,
      )
      .map((element) => element.size);
  expect(sizes(square, "name")).toEqual([52]);
  expect(sizes(story, "name")).toEqual([60]);
  expect(new Set(sizes(square, "description"))).toEqual(new Set([40]));
  expect(new Set(sizes(story, "description"))).toEqual(new Set([44]));
});

test("the achievement story keeps the order in its safe area: the badge 560, the avatar 96", () => {
  const layout = layoutAchievementCard(
    achievementContent(PICTURED),
    { format: "story" },
    fakeMeasure,
  );
  expect(boxOf(layout, "badge")).toMatchObject({ w: 560, h: 560 });
  expect(boxOf(layout, "sharer").h).toBe(96);
  const order = ["badge", "name", "description", "sharer", "earned", "brand"];
  for (let i = 1; i < order.length; i++) {
    const above = boxOf(layout, order[i - 1]);
    expect(boxOf(layout, order[i]).y).toBeGreaterThan(above.y + above.h);
  }
  expect(boxOf(layout, "badge").y).toBeGreaterThanOrEqual(SAFE_AREA.story.top);
});

test("the achievement card carries the logo and its words, on Dark, with no note", () => {
  const content = achievementContent(PICTURED);
  for (const format of FORMATS) {
    const layout = layoutAchievementCard(content, { format }, fakeMeasure);
    expectBrand(layout, format);
    expect(texts(layout, "brand-note")).toEqual([]);
    expect(layout.background).toEqual({ kind: "dark" });
    expect(layout.halo).toBe(false);
  }
});
