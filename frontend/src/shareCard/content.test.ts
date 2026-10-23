import {
  SONGS,
  cardParty,
  cardPlayers,
  cardScore,
  partySession,
} from "../test/shareCard";
import {
  cardDate,
  cardImageUrls,
  coverUrl,
  ordinal,
  partnersLine,
  partyCard,
  scoreCard,
  type PartyCardInput,
  type ScoreCardInput,
} from "./content";

const players = cardPlayers();

function scoreInput(
  overrides: Partial<ScoreCardInput> & Pick<ScoreCardInput, "score">,
): ScoreCardInput {
  return {
    partyScores: [overrides.score],
    session: partySession(),
    players,
    me: "chiara",
    otherPictures: true,
    partyNameAndDate: true,
    ...overrides,
  };
}

function partyInput(
  overrides: Partial<PartyCardInput> & Pick<PartyCardInput, "scores">,
): PartyCardInput {
  return {
    session: partySession(),
    players,
    me: "alice",
    otherPictures: true,
    partyNameAndDate: true,
    onlyMe: false,
    ...overrides,
  };
}

test("ordinals read the English way, teens included", () => {
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
    "1st",
    "2nd",
    "3rd",
    "4th",
    "11th",
    "12th",
    "13th",
    "21st",
    "22nd",
    "23rd",
    "101st",
    "111th",
  ]);
});

test("a card's date always carries its year", () => {
  expect(cardDate(new Date().toISOString())).toContain(
    String(new Date().getFullYear()),
  );
});

test("one score: the song, the number, the rating word and the place", () => {
  const score = cardScore("chiara", 8662, SONGS[0], {
    placement: 1,
    field_size: 3,
  });
  const content = scoreCard(scoreInput({ score }));
  expect(content).toMatchObject({
    title: "Bohemian Rhapsody",
    artist: "Queen",
    cover: { url: coverUrl("usdb:1"), initial: "Q" },
    score: 8662,
    rating: "Superstar",
    fraction: 0.8662,
    place: "1st of 3",
    detail: "1st of 3",
    flag: null,
  });
  expect(content.eyebrow).toMatch(/^Friday karaoke · .*2026$/);
  expect(content.singer.name).toBe("Chiara");
  expect(content.singer.avatar.url).toBe("/api/v1/players/chiara/avatar?v=3");
});

test("no place without a recorded one, and none for a solo sing", () => {
  const old = cardScore("chiara", 7000, SONGS[0]);
  expect(scoreCard(scoreInput({ score: old })).place).toBeNull();
  const half = cardScore("chiara", 7000, SONGS[0], { placement: 1 });
  expect(scoreCard(scoreInput({ score: half })).place).toBeNull();
  const solo = cardScore("chiara", 7000, SONGS[0], {
    placement: 1,
    field_size: 1,
  });
  const content = scoreCard(scoreInput({ score: solo }));
  expect(content.place).toBeNull();
  expect(content.detail).toBeNull();
});

test("a song that left the library is an unknown song with no cover", () => {
  const content = scoreCard(
    scoreInput({ score: cardScore("chiara", 4000, null) }),
  );
  expect(content.title).toBe("Unknown song");
  expect(content.artist).toBeNull();
  expect(content.cover).toEqual({ url: null, initial: "?" });
});

test("a duet names the other singer of the same sing", () => {
  const mine = cardScore("chiara", 9124, SONGS[1], {
    sing_id: "duet",
    placement: 1,
    field_size: 2,
  });
  const theirs = cardScore("ben", 7934, SONGS[1], {
    sing_id: "duet",
    placement: 2,
    field_size: 2,
  });
  const other = cardScore("alice", 5000, SONGS[2]);
  const content = scoreCard(
    scoreInput({ score: mine, partyScores: [mine, theirs, other] }),
  );
  expect(content.partners).toEqual(["Ben"]);
  expect(content.detail).toBe("1st of 2 · with Ben");
});

test("the partners line names two and counts the rest", () => {
  expect(partnersLine([])).toBeNull();
  expect(partnersLine(["Bob"])).toBe("with Bob");
  expect(partnersLine(["Bob", "Carol"])).toBe("with Bob and Carol");
  expect(partnersLine(["Bob", "Carol", "Dan", "Eve"])).toBe(
    "with Bob, Carol and 2 more",
  );
});

test("another singer's picture is their initial with the toggle off, mine never", () => {
  const theirs = cardScore("alice", 8000, SONGS[0]);
  expect(
    scoreCard(scoreInput({ score: theirs, otherPictures: false })).singer
      .avatar,
  ).toEqual({ url: null, initial: "A" });
  const mine = cardScore("chiara", 8000, SONGS[0]);
  expect(
    scoreCard(scoreInput({ score: mine, otherPictures: false })).singer.avatar
      .url,
  ).toBe("/api/v1/players/chiara/avatar?v=3");
});

test("the party name and date go with their toggle; a nameless party is its date", () => {
  const score = cardScore("chiara", 8000, SONGS[0]);
  expect(
    scoreCard(scoreInput({ score, partyNameAndDate: false })).eyebrow,
  ).toBeNull();
  const nameless = scoreCard(
    scoreInput({ score, session: partySession({ name: null }) }),
  );
  expect(nameless.eyebrow).toBe(cardDate(score.recorded_at));
});

test("the flag is drawn only when the caller proved it, the record first", () => {
  const score = cardScore("chiara", 9876, SONGS[3]);
  expect(scoreCard(scoreInput({ score })).flag).toBeNull();
  expect(scoreCard(scoreInput({ score, personalBest: true })).flag).toBe(
    "personal-best",
  );
  expect(
    scoreCard(scoreInput({ score, newHighscore: true, personalBest: true }))
      .flag,
  ).toBe("highscore");
});

test("a party: four numbers and never the worst, Best with its holder", () => {
  const content = partyCard(partyInput({ scores: cardParty(3, 2) }));
  expect(content.numbers).toEqual({
    sings: 6,
    songs: 6,
    best: 9500,
    bestBy: "Chiara",
    average: expect.any(Number),
  });
  expect(content.numbers).not.toHaveProperty("worst");
  expect(content.head).toBe("Friday karaoke");
  expect(content.sub).toMatch(/2026 · 3 singers$/);
  expect(content.rankingNote).toBe("ranked by best score");
});

test("a duet run counts as one sing", () => {
  const a = cardScore("chiara", 9000, SONGS[0], { sing_id: "run" });
  const b = cardScore("alice", 8000, SONGS[0], { sing_id: "run" });
  expect(partyCard(partyInput({ scores: [a, b] })).numbers.sings).toBe(1);
});

test("the ranking is by best score, the holder of the party's best the gold one", () => {
  const content = partyCard(partyInput({ scores: cardParty(4, 3) }));
  expect(content.ranking.map((entry) => entry.person.name)).toEqual([
    "Chiara",
    "Alice",
    "Ben",
    "Dana",
  ]);
  expect(content.ranking.map((entry) => entry.place)).toEqual([1, 2, 3, 4]);
  expect(content.ranking.map((entry) => entry.gold)).toEqual([
    true,
    false,
    false,
    false,
  ]);
  expect(content.ranking[1].isMe).toBe(true);
  expect(content.ranking[0].dots).toHaveLength(3);
  // Five scores make a box; three do not.
  expect(content.ranking[0].box).toBeNull();
  expect(
    partyCard(partyInput({ scores: cardParty(2, 5) })).ranking[0].box,
  ).not.toBeNull();
});

test("two equal bests share a place", () => {
  const scores = [
    cardScore("chiara", 9000, SONGS[0]),
    cardScore("alice", 9000, SONGS[1]),
    cardScore("ben", 7000, SONGS[2]),
  ];
  const content = partyCard(partyInput({ scores }));
  expect(content.ranking.map((entry) => entry.place)).toEqual([1, 1, 3]);
  // The tie's gold goes to whoever got there first, as `scoreSummary` says.
  expect(content.ranking.filter((entry) => entry.gold)).toHaveLength(1);
  expect(content.numbers.bestBy).toBe("Chiara");
});

test("with the name and date off the head is the singer count alone", () => {
  const content = partyCard(
    partyInput({ scores: cardParty(5, 1), partyNameAndDate: false }),
  );
  expect(content.head).toBe("5 singers");
  expect(content.sub).toBeNull();
});

test("a nameless party heads with its date", () => {
  const content = partyCard(
    partyInput({
      scores: cardParty(1, 1),
      session: partySession({ name: null }),
    }),
  );
  expect(content.head).toBe(cardDate(partySession().started_at));
  expect(content.sub).toBe("1 singer");
  expect(content.rankingNote).toBeNull();
});

test("only me and my place: the sharer alone, their numbers, their place", () => {
  const scores = cardParty(5, 2);
  const content = partyCard(partyInput({ scores, onlyMe: true }));
  expect(content.onlyMe).toBe(true);
  expect(content.ranking.map((entry) => entry.person.name)).toEqual(["Alice"]);
  expect(content.myPlace).toBe("2nd of 5");
  expect(content.singerCount).toBe(5);
  expect(content.numbers.bestBy).toBeNull();
  expect(content.numbers.sings).toBe(2);
  expect(content.dots).toHaveLength(2);
  expect(content.dots.filter((dot) => dot.best)).toHaveLength(1);
});

test("only me at a party of one gives no place, as a solo sing has none", () => {
  const content = partyCard(
    partyInput({ scores: cardParty(1, 3), me: "chiara", onlyMe: true }),
  );
  expect(content.onlyMe).toBe(true);
  expect(content.myPlace).toBeNull();
});

test("only me is not applied for somebody who did not sing there", () => {
  const content = partyCard(
    partyInput({ scores: cardParty(3, 1), onlyMe: true, me: "jule" }),
  );
  expect(content.onlyMe).toBe(false);
  expect(content.mayOnlyMe).toBe(false);
  expect(content.ranking).toHaveLength(3);
});

test("other pictures off draws everybody but me as an initial", () => {
  const content = partyCard(
    partyInput({ scores: cardParty(3, 1), otherPictures: false }),
  );
  expect(content.ranking.map((entry) => entry.person.avatar.url)).toEqual([
    null,
    "/api/v1/players/alice/avatar?v=3",
    null,
  ]);
  expect(content.ranking[0].person.avatar.initial).toBe("C");
});

test("the mosaic's covers are distinct, in the order they were sung", () => {
  const scores = [
    cardScore("chiara", 9000, SONGS[2]),
    cardScore("alice", 8000, SONGS[0]),
    cardScore("ben", 7000, SONGS[2]),
    cardScore("dana", 6000, null),
  ];
  const content = partyCard(partyInput({ scores }));
  expect(content.covers).toEqual([coverUrl("usdb:3"), coverUrl("usdb:1")]);
});

test("the pictures a card asks for, once each", () => {
  const score = cardScore("chiara", 8000, SONGS[0]);
  expect(cardImageUrls(scoreCard(scoreInput({ score })))).toEqual([
    coverUrl("usdb:1"),
    "/api/v1/players/chiara/avatar?v=3",
  ]);
  const party = partyCard(partyInput({ scores: cardParty(2, 2) }));
  expect(cardImageUrls(party)).toEqual([
    "/api/v1/players/chiara/avatar?v=3",
    "/api/v1/players/alice/avatar?v=3",
    ...party.covers,
  ]);
});

test("a party of fifty asks for the six faces a card can draw, not fifty", () => {
  const party = partyCard(
    partyInput({ scores: cardParty(50, 1), players: cardPlayers(50) }),
  );
  expect(party.ranking).toHaveLength(50);
  const avatars = cardImageUrls(party).filter((url) =>
    url.includes("/players/"),
  );
  expect(avatars).toEqual(
    party.ranking.slice(0, 6).map((entry) => entry.person.avatar.url),
  );
});

test("an initial is the first character a reader sees, a flag whole", () => {
  const flagged = cardScore("chiara", 8000, SONGS[0], {
    player_name: "🇩🇪 Hans",
  });
  const content = scoreCard(
    scoreInput({ score: flagged, otherPictures: false }),
  );
  expect(content.singer.avatar.initial).toBe("🇩🇪");
});
