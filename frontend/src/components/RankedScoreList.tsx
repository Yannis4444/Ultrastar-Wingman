import type { PlayerRead, ScoreWithContext } from "../api";
import { shortDate } from "../duration";
import { difficultyLabel, scorePlayer } from "../stats";
import PlayerAvatar from "./PlayerAvatar";
import "./RankedScoreList.css";

interface RankedScoreListProps {
  /** Already sorted, strongest first. The caller slices it. */
  scores: ScoreWithContext[];
  /** Registered players by id, for the avatars — same map Scores builds. */
  players: Map<string, PlayerRead>;
  /** Second line under the name. Defaults to difficulty · date; an empty
   * string draws no second line. */
  caption?: (score: ScoreWithContext) => string;
  /** Accessible name of the `<ol>`. */
  label: string;
  /**
   * The number in a row's rank cell, `null` for an empty cell. Defaults to the
   * position in the list. The sing view passes the stored `placement`, never a
   * recount, so two tied scores both read 1 and both wear the podium colour.
   */
  rank?: (score: ScoreWithContext, index: number) => number | null;
  /**
   * Makes every row an `aria-pressed` button choosing one score: the sing
   * view's rows choose the score the share card is of (share-cards §8).
   * Without it the rows are plain list items.
   */
  pressed?: {
    id: number | null;
    onPress: (score: ScoreWithContext) => void;
  };
  /** The reader's own player: their row carries a quiet *You* after the name. */
  ownPlayerId?: string | null;
}

/** How hard it was sung and when — the same shape a session's score rows use,
 * with the date in place of the clock time: an all-time list spans parties. */
function defaultCaption(score: ScoreWithContext): string {
  const difficulty = difficultyLabel(score.difficulty);
  const at = shortDate(score.recorded_at);
  return difficulty === "—" ? at : `${difficulty} · ${at}`;
}

const position = (_score: ScoreWithContext, index: number) => index + 1;

/**
 * A ranking of single scores: position, who sang it, and what they got.
 *
 * Shared so the song modal's best scores, the sing view's singers and the
 * scores page's rankings stay one object drawn once — the metrics deliberately
 * mirror `ScoreGroupList`'s summary rows.
 *
 * Rows are not buttons unless `pressed` says what a press chooses: in the song
 * modal the reader is already inside the song.
 */
export default function RankedScoreList({
  scores,
  players,
  caption = defaultCaption,
  label,
  rank = position,
  pressed,
  ownPlayerId = null,
}: RankedScoreListProps) {
  return (
    <ol className="ranked-score-list" aria-label={label}>
      {scores.map((score, index) => {
        const shown = rank(score, index);
        const second = caption(score);
        const own = ownPlayerId !== null && score.player_id === ownPlayerId;
        const body = (
          <>
            <span
              className={
                shown !== null && shown <= 3
                  ? "ranked-score-rank ranked-score-podium"
                  : "ranked-score-rank"
              }
            >
              {shown}
            </span>
            <PlayerAvatar
              player={scorePlayer(score, players)}
              className="ranked-score-avatar"
            />
            <span className="ranked-score-text">
              <span className="ranked-score-name-line">
                <span className="ranked-score-name">{score.player_name}</span>
                {/* A word, never a chip: which row is the reader's is a
                    fact about the row, not a mark on it. */}
                {own && <span className="ranked-score-you">You</span>}
              </span>
              {second !== "" && (
                <span className="ranked-score-caption">{second}</span>
              )}
            </span>
            <span className="ranked-score-value">{score.score}</span>
          </>
        );
        return (
          <li key={score.id}>
            {pressed === undefined ? (
              <div className="ranked-score-row">{body}</div>
            ) : (
              <button
                type="button"
                className="ranked-score-row ranked-score-button"
                aria-pressed={pressed.id === score.id}
                onClick={() => pressed.onPress(score)}
              >
                {body}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
