import type { ScoreWithContext } from "../api";
import { isNewHighscore, scorePlayerKey } from "../stats";

/**
 * The two flags a score card may carry beside the singer (share-cards.md
 * §7.4), worked out from the song's all-time scores — which only a reader
 * holding `stats.history` may read. Without that history the card has no
 * flag at all: nothing on it may claim more than the data on hand proves.
 */
export interface ScoreFlags {
  newHighscore: boolean;
  personalBest: boolean;
}

/**
 * `history` is every score the song ever got (`GET /stats/songs/{id}/scores`).
 *
 * - *New Highscore*: this score holds the song's record alone —
 *   `isNewHighscore` over the score by itself, so a duet partner's record
 *   never lights the sharer's card, and a tie with another sing is no record.
 * - *Personal best*: the singer has sung the song more than once and this is
 *   their best on it, alone. A first attempt is trivially a best, and says
 *   nothing.
 */
export function scoreFlags(
  score: ScoreWithContext,
  history: readonly ScoreWithContext[],
): ScoreFlags {
  // The history is the song's, and should already hold the score; a list that
  // does not is one that cannot prove anything about it.
  if (!history.some((entry) => entry.id === score.id))
    return { newHighscore: false, personalBest: false };
  const newHighscore = isNewHighscore([...history], [score]);
  const key = scorePlayerKey(score);
  const own = history.filter((entry) => scorePlayerKey(entry) === key);
  const personalBest =
    own.length > 1 &&
    own.every((entry) => entry.id === score.id || entry.score < score.score);
  return { newHighscore, personalBest };
}
