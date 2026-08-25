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
  /** Second line under the name. Defaults to difficulty · date. */
  caption?: (score: ScoreWithContext) => string;
  /** Accessible name of the `<ol>`. */
  label: string;
}

/** How hard it was sung and when — the same shape a session's score rows use,
 * with the date in place of the clock time: an all-time list spans parties. */
function defaultCaption(score: ScoreWithContext): string {
  const difficulty = difficultyLabel(score.difficulty);
  const at = shortDate(score.recorded_at);
  return difficulty === "—" ? at : `${difficulty} · ${at}`;
}

/**
 * A ranking of single scores: position, who sang it, and what they got.
 *
 * Shared so the song modal's best scores and the scores page's rankings stay
 * one object drawn once — the metrics deliberately mirror `ScoreGroupList`'s
 * summary rows.
 *
 * Rows are not buttons: in the song modal the reader is already inside the
 * song, and inside a grouped list the row's own toggle owns the click.
 */
export default function RankedScoreList({
  scores,
  players,
  caption = defaultCaption,
  label,
}: RankedScoreListProps) {
  return (
    <ol className="ranked-score-list" aria-label={label}>
      {scores.map((score, index) => (
        <li key={score.id} className="ranked-score-row">
          <span className="ranked-score-rank">{index + 1}</span>
          <PlayerAvatar
            player={scorePlayer(score, players)}
            className="ranked-score-avatar"
          />
          <span className="ranked-score-text">
            <span className="ranked-score-name">{score.player_name}</span>
            <span className="ranked-score-caption">{caption(score)}</span>
          </span>
          <span className="ranked-score-value">{score.score}</span>
        </li>
      ))}
    </ol>
  );
}
