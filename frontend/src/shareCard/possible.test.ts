import type { ScoreWithContext } from "../api";
import {
  SONGS,
  cardParty,
  cardPlayers,
  cardScore,
  partySession,
} from "../test/shareCard";
import { partyCard, scoreCard, type PartyCardContent } from "./content";
import type { PartyCardOptions } from "./layout";
import {
  partyCardChoices,
  resolvePartyOptions,
  resolveScoreOptions,
  scoreCardChoices,
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

const square = (
  overrides: Partial<PartyCardOptions> = {},
): PartyCardOptions => ({
  format: "square",
  look: "dark",
  focus: "podium",
  under: "ranking",
  logo: true,
  ...overrides,
});

function reasonOf<T>(choices: { value: T; reason: string | null }[], value: T) {
  return choices.find((choice) => choice.value === value)?.reason;
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
  expect(reasonOf(scoreCardChoices(gone, all).looks, "cover")).toBe(
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
  expect(reasonOf(scoreCardChoices(missing, none).looks, "cover")).toBe(
    "This song has no cover, so the card stays dark.",
  );
  expect(reasonOf(scoreCardChoices(missing, all).looks, "cover")).toBeNull();
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
      resolvePartyOptions(
        content,
        square({ look: "mosaic", focus: "spread", logo }),
        none,
      ),
    ).toEqual({
      format: "square",
      look: "dark",
      focus: "spread",
      under: "none",
      logo,
    });
  }
});

test("both formats are always there; there is no 4:5", () => {
  const content = party(cardParty(3, 2));
  expect(
    partyCardChoices(content, square(), all).formats.map((f) => f.value),
  ).toEqual(["square", "story"]);
});

test("Mosaic needs four different covers that arrived", () => {
  const four = party(cardParty(4, 1));
  expect(
    reasonOf(partyCardChoices(four, square(), all).looks, "mosaic"),
  ).toBeNull();
  const three = party(cardParty(3, 1));
  expect(reasonOf(partyCardChoices(three, square(), all).looks, "mosaic")).toBe(
    "Mosaic needs four different covers, and this party has 3.",
  );
  expect(reasonOf(partyCardChoices(four, square(), none).looks, "mosaic")).toBe(
    "Mosaic needs four different covers, and this party has none.",
  );
  expect(resolvePartyOptions(three, square({ look: "mosaic" }), all).look).toBe(
    "dark",
  );
});

test("the spread needs two singers and four scores, and the dark look", () => {
  const five = party(cardParty(5, 2));
  const choices = partyCardChoices(five, square({ focus: "spread" }), all);
  expect(reasonOf(choices.focus, "spread")).toBeNull();
  expect(reasonOf(choices.looks, "mosaic")).toBe(
    "The spread is drawn on the dark look, where its dots can be read.",
  );
  expect(choices.under).toBeNull();
  expect(choices.underNote).toBe("The spread takes the place of the podium.");
  expect(
    resolvePartyOptions(five, square({ focus: "spread", look: "mosaic" }), all),
  ).toEqual({
    format: "square",
    look: "dark",
    focus: "spread",
    under: "none",
    logo: true,
  });

  const one = party(cardParty(1, 5), { me: "chiara" });
  expect(reasonOf(partyCardChoices(one, square(), all).focus, "spread")).toBe(
    "One singer has nobody to compare with.",
  );
  const few = party(cardParty(3, 1));
  expect(reasonOf(partyCardChoices(few, square(), all).focus, "spread")).toBe(
    "The spread needs at least four scores.",
  );
  const mine = party(cardParty(5, 2), { onlyMe: true });
  expect(reasonOf(partyCardChoices(mine, square(), all).focus, "spread")).toBe(
    "Only me and my place shows one singer, and the spread compares several.",
  );
  expect(
    resolvePartyOptions(mine, square({ focus: "spread" }), all).focus,
  ).toBe("podium");
});

test("under the podium: the rows need a fourth singer, the strip four scores", () => {
  const six = party(cardParty(6, 2));
  const choices = partyCardChoices(six, square(), all);
  expect(choices.under?.map((choice) => choice.ok)).toEqual([true, true]);
  expect(resolvePartyOptions(six, square({ under: "strip" }), all).under).toBe(
    "strip",
  );

  const three = party(cardParty(3, 2));
  expect(
    reasonOf(partyCardChoices(three, square(), all).under ?? [], "ranking"),
  ).toBe("With three singers or fewer the podium is the whole ranking.");
  expect(
    resolvePartyOptions(three, square({ under: "ranking" }), all).under,
  ).toBe("strip");

  const few = party(cardParty(3, 1));
  expect(
    reasonOf(partyCardChoices(few, square(), all).under ?? [], "strip"),
  ).toBe("The score strip needs at least four scores.");
  expect(resolvePartyOptions(few, square({ under: "strip" }), all).under).toBe(
    "none",
  );

  const mine = party(cardParty(6, 2), { onlyMe: true });
  expect(
    reasonOf(partyCardChoices(mine, square(), all).under ?? [], "ranking"),
  ).toBe("Only me and my place leaves nobody else to rank.");
});

test("a story and a mosaic have no under-the-podium choice, and say why", () => {
  const six = party(cardParty(6, 2));
  const story = partyCardChoices(six, square({ format: "story" }), all);
  expect(story.under).toBeNull();
  expect(story.underNote).toBe(
    "A story has room for the ranking and the strip both.",
  );
  const mosaic = partyCardChoices(six, square({ look: "mosaic" }), all);
  expect(mosaic.under).toBeNull();
  expect(mosaic.underNote).toBe(
    "Mosaic keeps the podium alone over the covers.",
  );
  expect(resolvePartyOptions(six, square({ look: "mosaic" }), all).under).toBe(
    "none",
  );
});

test("only me is offered to somebody who sang at the party", () => {
  const scores = cardParty(3, 1);
  expect(partyCardChoices(party(scores), square(), all).onlyMe.ok).toBe(true);
  expect(
    partyCardChoices(party(scores, { me: "jule" }), square(), all).onlyMe,
  ).toEqual({
    value: true,
    ok: false,
    reason: "You did not sing at this party.",
  });
  expect(
    partyCardChoices(party(scores, { me: null }), square(), all).onlyMe.ok,
  ).toBe(false);
});
