import {
  PICTURED,
  SONGS,
  achievementContent,
  cardParty,
  cardPlayers,
  cardScore,
  partySession,
  player,
  singerScores,
  song,
} from "../test/shareCard";
import { cardDate } from "../duration";
import {
  ALL_PARTIES,
  PLAYER_SONGS_SHOWN,
  cardImageUrls,
  coverUrl,
  ordinal,
  partnersLine,
  partyCard,
  plateColor,
  playerCard,
  scoreCard,
  type PartyCardInput,
  type PlayerCardInput,
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
  expect(content.sub).toBe(
    `${cardDate(partySession().started_at)} · 3 singers`,
  );
  expect(content.party).toBe("Friday karaoke");
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

test.each([
  [true, "Friday karaoke"],
  [true, null],
  [false, "Friday karaoke"],
  [false, null],
] as const)(
  "the head with the name and date %s, the party named %s",
  (toggle, name) => {
    const date = cardDate(partySession().started_at);
    const content = partyCard(
      partyInput({
        scores: cardParty(5, 1),
        session: partySession({ name }),
        partyNameAndDate: toggle,
      }),
    );
    // Off, there is no head and no count at all — never "5 singers" in its
    // place (§1.10, §7.9) — and the card still knows the party it is of.
    const expected = !toggle
      ? { head: null, sub: null }
      : name === null
        ? // Unnamed: the date leads and is never said twice.
          { head: date, sub: "5 singers" }
        : { head: name, sub: `${date} · 5 singers` };
    expect({ head: content.head, sub: content.sub }).toEqual(expected);
    expect(content.party).toBe(name ?? date);
    expect(content.singerCount).toBe(5);
  },
);

test("a nameless party of one heads with its date over one singer", () => {
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

// ---------------------------------------------------------------- a player

function playerInput(
  overrides: Partial<PlayerCardInput> & Pick<PlayerCardInput, "scores">,
): PlayerCardInput {
  return {
    session: partySession(),
    players,
    me: "chiara",
    otherPictures: true,
    partyNameAndDate: true,
    ...overrides,
  };
}

test("a player: their four numbers, Best without a holder, never the worst", () => {
  // Two runs of one sing would be a duet, here five sings of three songs.
  const scores = singerScores(
    "alice",
    [8000, 6000, 9100, 4000, 7000],
    SONGS.slice(0, 3),
  );
  const content = playerCard(playerInput({ scores }));
  expect(content.kind).toBe("player");
  expect(content.person.name).toBe("Alice");
  expect(content.numbers).toEqual({
    sings: 5,
    songs: 3,
    best: 9100,
    bestBy: null,
    average: 6820,
  });
  expect(content.scoreCount).toBe(5);
  expect(content.mine).toBe(false);
  expect(Object.keys(content.numbers)).not.toContain("worst");
});

test("the party line is the party's name and date, a nameless party its date, every party All parties", () => {
  const scores = singerScores("alice", [8000]);
  const date = cardDate(partySession().started_at);
  expect(playerCard(playerInput({ scores })).line).toBe(
    `Friday karaoke · ${date}`,
  );
  expect(
    playerCard(playerInput({ scores, session: partySession({ name: null }) }))
      .line,
  ).toBe(date);
  const all = playerCard(playerInput({ scores, session: null }));
  expect(all.line).toBe(ALL_PARTIES);
  expect(all.scope).toBe("All parties");
});

test("with the date toggle off the line goes, and the scope stays for the file", () => {
  const content = playerCard(
    playerInput({
      scores: singerScores("alice", [8000]),
      partyNameAndDate: false,
    }),
  );
  expect(content.line).toBeNull();
  expect(content.scope).toMatch(/^Friday karaoke · /);
});

test("somebody else's picture is their initial with the toggle off, the sharer's never", () => {
  const theirs = playerCard(
    playerInput({
      scores: singerScores("alice", [8000]),
      otherPictures: false,
    }),
  );
  expect(theirs.person.avatar).toEqual({ url: null, initial: "A" });
  const mine = playerCard(
    playerInput({
      scores: singerScores("chiara", [8000]),
      otherPictures: false,
    }),
  );
  expect(mine.mine).toBe(true);
  expect(mine.person.avatar.url).toBe("/api/v1/players/chiara/avatar?v=3");
});

test("the histogram is twenty buckets, a perfect score in the last, the best's bucket gold", () => {
  const content = playerCard(
    playerInput({
      scores: singerScores("alice", [0, 499, 500, 7250, 10000, 9999]),
    }),
  );
  expect(content.buckets).toHaveLength(20);
  expect(content.buckets[0]).toBe(2);
  expect(content.buckets[1]).toBe(1);
  expect(content.buckets[14]).toBe(1);
  expect(content.buckets[19]).toBe(2);
  expect(content.bestBucket).toBe(19);
  expect(content.dots.filter((dot) => dot.best)).toHaveLength(1);
  expect(content.dots.find((dot) => dot.best)?.score).toBe(10000);
  expect(content.median).toBe(3875);
});

test("the songs are their best per song, best first, the top one gold, a lost song unknown", () => {
  const scores = singerScores(
    "alice",
    [5000, 9000, 7000, 8000, 6000],
    [SONGS[0], SONGS[1], SONGS[0], null, SONGS[1]],
  );
  const content = playerCard(playerInput({ scores }));
  expect(
    content.songs.map((entry) => [entry.title, entry.best, entry.gold]),
  ).toEqual([
    ["Dancing Queen", 9000, true],
    ["Unknown song", 8000, false],
    ["Bohemian Rhapsody", 7000, false],
  ]);
  expect(content.songs[1].artist).toBeNull();
  expect(content.songs[1].cover).toEqual({ url: null, initial: "?" });
  expect(content.songCount).toBe(3);
});

test("a long record lists eight songs and counts them all", () => {
  const many = Array.from({ length: 12 }, (_, index) =>
    song(`usdb:${100 + index}`, `Artist ${index}`, `Song ${index}`),
  );
  const content = playerCard(
    playerInput({
      scores: singerScores(
        "alice",
        many.map((_, index) => 9000 - index * 100),
        many,
      ),
    }),
  );
  expect(content.songs).toHaveLength(PLAYER_SONGS_SHOWN);
  expect(content.songCount).toBe(12);
  // The picture, and the covers of the songs a card can list — not twelve.
  expect(cardImageUrls(content)).toEqual([
    "/api/v1/players/alice/avatar?v=3",
    ...many.slice(0, 8).map((entry) => coverUrl(entry.id)),
  ]);
});

// ------------------------------------------------------------ an achievement

test("an achievement card says the badge, the name, the sentence, the sharer, the day and the holders", () => {
  const content = achievementContent(PICTURED);
  expect(content).toMatchObject({
    kind: "achievement",
    id: "first-time-on-the-mic",
    name: "First Time on the Mic",
    description: "Sing your first song.",
    sharer: {
      name: "Chiara",
      avatar: { url: "/api/v1/players/chiara/avatar?v=3", initial: "C" },
    },
    earned: `Earned ${cardDate("2026-08-12T20:15:00Z")}`,
    holders: "Earned by 3 players",
  });
  // The full-size picture at the row's own version, on Wingman's origin.
  expect(content.badge.url).toBe(
    "/api/v1/achievements/first-time-on-the-mic/icon?size=full&v=7",
  );
  expect(content.badge.plate).toBe("#4b92cd");
  // The picture and the sharer's face: everything the card can draw.
  expect(cardImageUrls(content)).toEqual([
    "/api/v1/achievements/first-time-on-the-mic/icon?size=full&v=7",
    "/api/v1/players/chiara/avatar?v=3",
  ]);
});

test("without a picture the badge is the plate in its colour under its glyph", () => {
  const content = achievementContent({ icon: "mic", color: "pink" });
  expect(content.badge).toEqual({
    url: null,
    glyph: "mic",
    plate: "#9e3b95",
  });
  // A glyph this build has not got is the feature's own, as on the badge.
  expect(achievementContent({ icon: "no-such-glyph" }).badge.glyph).toBe(
    "trophy",
  );
  expect(cardImageUrls(content)).toEqual(["/api/v1/players/chiara/avatar?v=3"]);
});

test("the plate takes each tag colour's literal, and an unknown one is neutral", () => {
  expect(plateColor("neutral")).toBe("#ccc");
  expect(plateColor("blue")).toBe("#4b92cd");
  expect(plateColor("pink")).toBe("#9e3b95");
  expect(plateColor("gold")).toBe("#faa636");
  expect(plateColor("teal")).toBe("#ccc");
});

test("the holders line is counted with the sharer, and there is none without a count", () => {
  // One holder is the sharer: the host screen's reading, not the modal's.
  expect(achievementContent({ holder_count: 1 }).holders).toBe(
    "First to earn it",
  );
  expect(achievementContent({ holder_count: 12 }).holders).toBe(
    "Earned by 12 players",
  );
  expect(achievementContent({ holder_count: null }).holders).toBeNull();
});

test("a sharer whose player row the page could not read is their initial", () => {
  const content = achievementContent({}, null);
  expect(content.sharer).toEqual({
    name: "Chiara",
    avatar: { url: null, initial: "C" },
  });
  expect(cardImageUrls(content)).toEqual([]);
  // And one without a picture of their own, the same.
  const plain = achievementContent({}, player("chiara", "Chiara", false));
  expect(plain.sharer.avatar.url).toBeNull();
});
