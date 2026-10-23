import { SONGS, cardScore } from "../test/shareCard";
import { scoreFlags } from "./flags";

const song = SONGS[0];

test("the song's best score, alone, is a New Highscore", () => {
  const mine = cardScore("chiara", 9500, song);
  const history = [mine, cardScore("alice", 9100, song)];
  expect(scoreFlags(mine, history).newHighscore).toBe(true);
});

test("a score under the song's best is no record", () => {
  const mine = cardScore("chiara", 8000, song);
  const history = [mine, cardScore("alice", 9100, song)];
  expect(scoreFlags(mine, history).newHighscore).toBe(false);
});

test("a tie with another sing holds no record", () => {
  const mine = cardScore("chiara", 9100, song);
  const history = [mine, cardScore("alice", 9100, song)];
  expect(scoreFlags(mine, history).newHighscore).toBe(false);
});

test("a duet partner's record does not light the other singer's card", () => {
  const partner = cardScore("alice", 9500, song, { sing_id: "duet" });
  const mine = cardScore("chiara", 7000, song, { sing_id: "duet" });
  expect(scoreFlags(mine, [partner, mine]).newHighscore).toBe(false);
  expect(scoreFlags(partner, [partner, mine]).newHighscore).toBe(true);
});

test("a personal best needs an earlier try that it beats", () => {
  const first = cardScore("chiara", 6000, song);
  const second = cardScore("chiara", 7000, song);
  const record = cardScore("alice", 9000, song);
  const history = [first, second, record];
  expect(scoreFlags(second, history)).toEqual({
    newHighscore: false,
    personalBest: true,
  });
  expect(scoreFlags(first, history).personalBest).toBe(false);
  // Alone on a song, a first attempt is trivially the best and says nothing.
  expect(scoreFlags(record, history).personalBest).toBe(false);
});

test("an equal earlier try leaves no personal best", () => {
  const first = cardScore("chiara", 7000, song);
  const second = cardScore("chiara", 7000, song);
  expect(scoreFlags(second, [first, second]).personalBest).toBe(false);
});

test("a history that does not hold the score proves nothing about it", () => {
  const mine = cardScore("chiara", 9900, song);
  expect(scoreFlags(mine, [cardScore("alice", 100, song)])).toEqual({
    newHighscore: false,
    personalBest: false,
  });
});
