import type { PlayerRead, ScoreWithContext, SongRead } from "../api";
import { MAX_SCORE } from "../chartTheme";
import {
  evaluationLabel,
  isNewHighscore,
  scorePlayer,
  songHistory,
} from "../stats";
import { Icon } from "./icons";
import IconStat from "./IconStat";
import PlayerAvatar from "./PlayerAvatar";
import SongCover from "./SongCover";
import "./LastSong.css";

interface LastSongProps {
  /** `null` once the song has left the library — its scores outlive it. */
  song: SongRead | null;
  /** What the sing that just finished scored, best singer first. */
  scores: ScoreWithContext[];
  /** Every score this song ever got, or an empty list while unknown. */
  history: ScoreWithContext[];
  /** For the avatars; a singer without a record falls back to their initial. */
  players: Map<string, PlayerRead>;
}

/** Where a value sits on the 0…`MAX_SCORE` scale the bars are drawn on. */
function offset(score: number): string {
  return `${Math.min(100, Math.max(0, (score / MAX_SCORE) * 100))}%`;
}

/**
 * The result screen on the TV: the song that just finished, what it has scored
 * over its whole life, and a bar per singer of this run.
 *
 * The all-time numbers are the point of the block — a 7000 means something
 * different on a song nobody ever cleared 6000 on.
 */
export default function LastSong({
  song,
  scores,
  history,
  players,
}: LastSongProps) {
  const stats = songHistory(history);
  const record = isNewHighscore(history, scores);

  return (
    <section className="last-song" aria-label="Last song">
      <div className="last-song-head">
        {song !== null && <SongCover song={song} className="last-song-cover" />}
        <div className="last-song-naming">
          <h2 className="last-song-title">{song?.title ?? "Unknown song"}</h2>
          {song !== null && <p className="last-song-artist">{song.artist}</p>}
        </div>
      </div>

      {stats !== null && (
        <div className="last-song-stats">
          <IconStat
            className="last-song-stat"
            icon="hash"
            label="Times sung"
            value={stats.sings}
          />
          <IconStat
            className="last-song-stat"
            icon="arrow-up"
            label="Best score"
            value={`${stats.best} (${stats.bestPlayers.join(", ")})`}
          />
          <IconStat
            className="last-song-stat"
            icon="average"
            label="Average score"
            value={stats.average}
          />
          <IconStat
            className="last-song-stat"
            icon="arrow-down"
            label="Worst score"
            value={`${stats.worst} (${stats.worstPlayers.join(", ")})`}
          />
        </div>
      )}

      <div className="last-song-bars">
        {/* The same three numbers as the stat lines above, placed on the scale
            the bars use — decoration for them, so it is not announced twice. */}
        {stats !== null && (
          <div className="last-song-markers" aria-hidden="true">
            <span />
            <div>
              <span
                className="last-song-marker"
                style={{ left: offset(stats.worst) }}
              >
                <Icon name="arrow-down" />
              </span>
              <span
                className="last-song-marker"
                style={{ left: offset(stats.average) }}
              >
                <Icon name="average" />
              </span>
              <span
                className="last-song-marker"
                style={{ left: offset(stats.best) }}
              >
                <Icon name="arrow-up" />
              </span>
            </div>
          </div>
        )}

        {scores.map((score) => (
          <div className="last-song-row" key={score.id}>
            <PlayerAvatar
              player={scorePlayer(score, players)}
              className="last-song-avatar"
            />
            <div className="last-song-bar">
              <span
                className="last-song-percent"
                style={{ width: offset(score.score) }}
                aria-hidden="true"
              />
              <span className="last-song-singer">
                <span className="last-song-name">{score.player_name}</span>
                <span className="last-song-evaluation">
                  {evaluationLabel(score.score)}
                </span>
              </span>
              <span className="last-song-value">
                <span className="last-song-score">{score.score}</span>
                {record && stats !== null && score.score === stats.best && (
                  <span className="last-song-record">New Highscore</span>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
