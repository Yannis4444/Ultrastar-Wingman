import type { ScoreWithContext } from "../api";
import {
  SONGS,
  cardParty,
  cardPlayers,
  cardScore,
  partySession,
  singerScores,
} from "../test/shareCard";
import {
  partyCard,
  playerCard,
  scoreCard,
  type PartyCardContent,
  type PlayerCardContent,
} from "./content";
import {
  ACHIEVEMENT_DESIGNS,
  FORMATS,
  PARTY_DESIGNS,
  achievementCardDesigns,
  achievementSlideToggles,
  resolveAchievementOptions,
  PLAYER_DESIGNS,
  playerCardDesigns,
  playerSlideToggles,
  resolvePlayerOptions,
  SCORE_DESIGNS,
  SHARE_TOGGLES,
  TOGGLES_REST,
  partyCardDesigns,
  partyDesignOptions,
  partySlideToggles,
  resolvePartyOptions,
  resolveScoreOptions,
  scoreCardDesigns,
  scoreSlideToggles,
  toggleSentence,
  type PartyDesign,
} from "./possible";

const players = cardPlayers();
const all = () => true;
const none = () => false;

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

/** A party's two contents: the whole party, and the sharer alone. */
function both(
  scores: ScoreWithContext[],
  overrides: Partial<Parameters<typeof partyCard>[0]> = {},
): [PartyCardContent, PartyCardContent] {
  return [
    party(scores, overrides),
    party(scores, { ...overrides, onlyMe: true }),
  ];
}

function reasonOf<T>(choices: { value: T; reason: string | null }[], value: T) {
  return choices.find((choice) => choice.value === value)?.reason;
}

function drawn(content: PartyCardContent, design: PartyDesign, loaded = all) {
  return resolvePartyOptions(content, design, "square", true, loaded);
}

test("a score without a cover falls back to Dark and says why", () => {
  const gone = scoreCard({
    score: cardScore("chiara", 8000, null),
    partyScores: [],
    session: null,
    players,
    me: "chiara",
    otherPictures: true,
    partyNameAndDate: true,
  });
  expect(reasonOf(scoreCardDesigns(gone, all), "cover")).toBe(
    "This song has left the library, so there is no cover to draw.",
  );
  const missing = scoreCard({
    score: cardScore("chiara", 8000, SONGS[0]),
    partyScores: [],
    session: null,
    players,
    me: "chiara",
    otherPictures: true,
    partyNameAndDate: true,
  });
  expect(reasonOf(scoreCardDesigns(missing, none), "cover")).toBe(
    "This song has no cover, so the card stays dark.",
  );
  expect(reasonOf(scoreCardDesigns(missing, all), "cover")).toBeNull();
  // The slides in the carousel's order, Dark always drawable.
  expect(scoreCardDesigns(missing, none).map((d) => [d.value, d.ok])).toEqual([
    ["dark", true],
    ["cover", false],
  ]);
  expect(SCORE_DESIGNS).toEqual(["dark", "cover"]);
  expect(
    resolveScoreOptions(
      missing,
      { format: "story", look: "cover", logo: true },
      none,
    ),
  ).toEqual({ format: "story", look: "dark", logo: true });
  expect(
    resolveScoreOptions(
      missing,
      { format: "story", look: "cover", logo: true },
      all,
    ),
  ).toEqual({ format: "story", look: "cover", logo: true });
});

test("the Wingman logo is the reader's on every card, carried through as asked", () => {
  const score = scoreCard({
    score: cardScore("chiara", 8000, SONGS[0]),
    partyScores: [],
    session: null,
    players,
    me: "chiara",
    otherPictures: true,
    partyNameAndDate: true,
  });
  for (const logo of [true, false]) {
    // Even where the look falls back, the logo stays what was asked.
    expect(
      resolveScoreOptions(
        score,
        { format: "square", look: "cover", logo },
        none,
      ).logo,
    ).toBe(logo);
    const content = party(cardParty(6, 4));
    expect(
      resolvePartyOptions(content, "spread", "square", logo, none),
    ).toEqual({
      format: "square",
      look: "dark",
      focus: "spread",
      under: "none",
      logo,
    });
  }
});

test("both formats, on every card; there is no 4:5", () => {
  expect(FORMATS).toEqual(["square", "story"]);
});

test("a party's slides are Podium, Strip, Mosaic, Spread and You", () => {
  expect(PARTY_DESIGNS).toEqual(["podium", "strip", "mosaic", "spread", "you"]);
  expect(PARTY_DESIGNS.map(partyDesignOptions)).toEqual([
    { look: "dark", focus: "podium", under: "ranking", onlyMe: false },
    { look: "dark", focus: "podium", under: "strip", onlyMe: false },
    { look: "mosaic", focus: "podium", under: "none", onlyMe: false },
    { look: "dark", focus: "spread", under: "none", onlyMe: false },
    { look: "dark", focus: "podium", under: "strip", onlyMe: true },
  ]);
  const [whole, mine] = both(cardParty(6, 2));
  expect(
    partyCardDesigns(whole, mine, all).map((d) => [d.value, d.ok]),
  ).toEqual([
    ["podium", true],
    ["strip", true],
    ["mosaic", true],
    ["spread", true],
    ["you", true],
  ]);
});

test("Podium is ranks 4–6 under the podium, Strip the score strip, neither falling back to the other", () => {
  const six = party(cardParty(6, 2));
  expect(drawn(six, "podium")).toMatchObject({
    look: "dark",
    under: "ranking",
  });
  expect(drawn(six, "strip")).toMatchObject({ look: "dark", under: "strip" });
  // Three singers: the podium is the whole ranking, and it stands alone.
  const three = party(cardParty(3, 2));
  expect(drawn(three, "podium").under).toBe("none");
  expect(drawn(three, "strip").under).toBe("strip");
  // The strip needs four scores; Podium is always there.
  const few = party(cardParty(3, 1));
  const designs = partyCardDesigns(
    few,
    party(cardParty(3, 1), { onlyMe: true }),
    all,
  );
  expect(reasonOf(designs, "strip")).toBe(
    "The score strip needs at least four scores.",
  );
  expect(reasonOf(designs, "podium")).toBeNull();
});

test("Mosaic needs four different covers that arrived, and stands alone", () => {
  const [four, fourMine] = both(cardParty(4, 1));
  expect(reasonOf(partyCardDesigns(four, fourMine, all), "mosaic")).toBeNull();
  expect(drawn(four, "mosaic")).toMatchObject({
    look: "mosaic",
    under: "none",
  });
  const [three, threeMine] = both(cardParty(3, 1));
  expect(reasonOf(partyCardDesigns(three, threeMine, all), "mosaic")).toBe(
    "Mosaic needs four different covers, and this party has 3.",
  );
  expect(reasonOf(partyCardDesigns(four, fourMine, none), "mosaic")).toBe(
    "Mosaic needs four different covers, and this party has none.",
  );
  expect(drawn(three, "mosaic").look).toBe("dark");
});

test("the spread needs two singers and four scores, and the dark look", () => {
  const five = party(cardParty(5, 2));
  expect(drawn(five, "spread")).toEqual({
    format: "square",
    look: "dark",
    focus: "spread",
    under: "none",
    logo: true,
  });
  const one = both(cardParty(1, 5), { me: "chiara" });
  expect(reasonOf(partyCardDesigns(...one, all), "spread")).toBe(
    "One singer has nobody to compare with.",
  );
  const few = both(cardParty(3, 1));
  expect(reasonOf(partyCardDesigns(...few, all), "spread")).toBe(
    "The spread needs at least four scores.",
  );
});

test("You is the sharer alone with their own strip, for somebody who sang there", () => {
  const scores = cardParty(6, 4);
  const [whole, mine] = both(scores);
  expect(reasonOf(partyCardDesigns(whole, mine, all), "you")).toBeNull();
  expect(mine.ranking.map((entry) => entry.person.name)).toEqual(["Alice"]);
  expect(drawn(mine, "you")).toMatchObject({
    look: "dark",
    focus: "podium",
    under: "strip",
  });
  // Under four scores of their own the hero stands alone.
  const short = party(cardParty(6, 2), { onlyMe: true });
  expect(drawn(short, "you").under).toBe("none");
  // Nobody to be for somebody who did not sing, or a guest.
  for (const me of ["jule", null]) {
    const other = both(scores, { me });
    expect(reasonOf(partyCardDesigns(...other, all), "you")).toBe(
      "You did not sing at this party.",
    );
  }
});

test("the toggles are the same three on every slide, in one order", () => {
  expect(SHARE_TOGGLES).toEqual(["pictures", "date", "logo"]);
  const [whole, mine] = both(cardParty(6, 2));
  for (const design of PARTY_DESIGNS) {
    const content = design === "you" ? mine : whole;
    expect(Object.keys(partySlideToggles(design, content))).toEqual([
      "pictures",
      "date",
      "logo",
    ]);
  }
});

test("other singers' pictures dim wherever the only face is the sharer's, and on the spread", () => {
  const [whole, mine] = both(cardParty(6, 2));
  expect(partySlideToggles("podium", whole).pictures).toBeNull();
  expect(partySlideToggles("mosaic", whole).pictures).toBeNull();
  expect(partySlideToggles("you", mine)).toEqual({
    pictures: "Nobody else is on this card.",
    date: null,
    logo: null,
  });
  expect(partySlideToggles("spread", whole).pictures).toBe(
    "The spread draws names, not pictures.",
  );
  // A party the sharer sang alone.
  const alone = party(cardParty(1, 5), { me: "chiara" });
  expect(partySlideToggles("podium", alone).pictures).toBe(
    "Nobody else is on this card.",
  );

  const own = scoreCard({
    score: cardScore("chiara", 8000, SONGS[0]),
    partyScores: [],
    session: null,
    players,
    me: "chiara",
    otherPictures: true,
    partyNameAndDate: true,
  });
  expect(scoreSlideToggles(own).pictures).toBe("Nobody else is on this card.");
  expect(scoreSlideToggles({ ...own, mine: false }).pictures).toBeNull();
});

test("a toggle's sentence follows its state, and a dimmed one says why", () => {
  expect(TOGGLES_REST).toBe(
    "Press a symbol to take it off the card or put it back.",
  );
  expect(toggleSentence("pictures", true, null)).toBe(
    "Other singers' pictures are on the card.",
  );
  expect(toggleSentence("pictures", false, null)).toBe(
    "Other singers are drawn as their initials.",
  );
  expect(toggleSentence("date", false, null)).toBe(
    "The party's name and date are left off.",
  );
  expect(toggleSentence("logo", true, null)).toBe(
    "The Wingman logo is on the card.",
  );
  expect(toggleSentence("logo", false, null)).toBe(
    "The Wingman logo is left off.",
  );
  expect(toggleSentence("pictures", true, "Nobody else is on this card.")).toBe(
    "Nobody else is on this card.",
  );
});

// ---------------------------------------------------------------- a player

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

const reasons = (content: PlayerCardContent) =>
  playerCardDesigns(content).map((entry) => [entry.value, entry.reason]);

test("a player's slides are Histogram, Strip and Songs, all drawable from four scores of two songs", () => {
  expect(PLAYER_DESIGNS).toEqual(["histogram", "strip", "songs"]);
  const content = playerOf(singerScores("alice", [9000, 8000, 7000, 6000]));
  expect(reasons(content)).toEqual([
    ["histogram", null],
    ["strip", null],
    ["songs", null],
  ]);
  for (const design of PLAYER_DESIGNS)
    expect(resolvePlayerOptions(content, design, "story", false)).toEqual({
      format: "story",
      focus: design,
      logo: false,
    });
});

test("under four scores the two charts are dimmed with their sentences, Songs still drawn", () => {
  const content = playerOf(singerScores("alice", [9000, 8000, 7000]));
  expect(reasons(content)).toEqual([
    ["histogram", "The histogram needs at least four scores."],
    ["strip", "The strip needs at least four scores."],
    ["songs", null],
  ]);
});

test("two scores of two songs are a list of songs, and not yet a chart", () => {
  const content = playerOf(
    singerScores("alice", [9000, 8000], [SONGS[0], SONGS[1]]),
  );
  expect(reasons(content)).toEqual([
    ["histogram", "The histogram needs at least four scores."],
    ["strip", "The strip needs at least four scores."],
    ["songs", null],
  ]);
});

test("one song is no list of songs, however often it was sung", () => {
  const content = playerOf(
    singerScores("alice", [9000, 8000, 7000, 6000], [SONGS[0]]),
  );
  expect(reasons(content)).toEqual([
    ["histogram", null],
    ["strip", null],
    ["songs", "One song is no list of songs."],
  ]);
});

test("a design the card cannot draw resolves to the head and the numbers, never another design", () => {
  const one = playerOf(singerScores("alice", [9000]));
  expect(playerCardDesigns(one).every((entry) => !entry.ok)).toBe(true);
  for (const design of PLAYER_DESIGNS)
    expect(resolvePlayerOptions(one, design, "square", true).focus).toBe(
      "none",
    );
});

test("on the sharer's own stats the pictures toggle is dimmed, on somebody else's it is live", () => {
  expect(playerSlideToggles(playerOf(singerScores("chiara", [9000])))).toEqual({
    pictures: "Nobody else is on this card.",
    date: null,
    logo: null,
  });
  expect(playerSlideToggles(playerOf(singerScores("alice", [9000])))).toEqual({
    pictures: null,
    date: null,
    logo: null,
  });
});

test("on a player card the date toggle speaks of the party line", () => {
  expect(toggleSentence("date", true, null, "player")).toBe(
    "The party line is on the card.",
  );
  expect(toggleSentence("date", false, null, "player")).toBe(
    "The party line is left off.",
  );
  // The other two read as on every card.
  expect(toggleSentence("logo", false, null, "player")).toBe(
    "The Wingman logo is left off.",
  );
  expect(toggleSentence("date", true, null, "party")).toBe(
    "The party's name and date are on the card.",
  );
});

// ------------------------------------------------------------ an achievement

test("an achievement card is one slide, Badge, which it can always draw", () => {
  expect(ACHIEVEMENT_DESIGNS).toEqual(["badge"]);
  expect(achievementCardDesigns()).toEqual([
    { value: "badge", ok: true, reason: null },
  ]);
});

test("on an achievement card only the logo reaches the card, the other two say why", () => {
  const reasons = achievementSlideToggles();
  expect(reasons).toEqual({
    pictures: "Nobody else is on this card.",
    date: "An achievement belongs to no party.",
    logo: null,
  });
  // The line reads the reason whatever state the toggle was left in.
  expect(toggleSentence("date", true, reasons.date, "achievement")).toBe(
    "An achievement belongs to no party.",
  );
  expect(
    toggleSentence("pictures", false, reasons.pictures, "achievement"),
  ).toBe("Nobody else is on this card.");
  expect(toggleSentence("logo", false, reasons.logo, "achievement")).toBe(
    "The Wingman logo is left off.",
  );
});

test("an achievement card draws in the format and with the logo asked for", () => {
  for (const format of FORMATS) {
    expect(resolveAchievementOptions(format, true)).toEqual({
      format,
      logo: true,
    });
    expect(resolveAchievementOptions(format, false)).toEqual({
      format,
      logo: false,
    });
  }
});
