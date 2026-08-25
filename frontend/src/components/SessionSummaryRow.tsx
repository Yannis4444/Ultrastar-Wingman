import type { PlayerRead, ScoreWithContext, SessionRead } from "../api";
import { scorePlayer, songLabel, summarize } from "../stats";
import IconStat from "./IconStat";
import { Icon } from "./icons";
import PlayerAvatar from "./PlayerAvatar";
import "./SessionSummaryRow.css";

interface SessionSummaryRowProps {
  session: SessionRead;
  scores: ScoreWithContext[];
  /** Registered players by id, for the winner's avatar. */
  players: Map<string, PlayerRead>;
}

/**
 * A party at a glance: who won it, and three counts that can all be checked
 * against the list below.
 *
 * The counts deliberately come from the scores, not from `session.sing_count`.
 * That column counts every song *started* — restarts and songs stopped before
 * Ultrastar Deluxe scored them included — so it regularly disagreed with
 * everything on screen. It is not thrown away: when it is higher than the
 * number of scored performances, the difference goes into the stat's tooltip.
 */
export default function SessionSummaryRow({
  session,
  scores,
  players,
}: SessionSummaryRowProps) {
  const { sings, songs, singers, top } = summarize(scores);
  const singsLabel =
    session.sing_count > sings
      ? `Sings — ${sings} scored of ${session.sing_count} started`
      : "Sings";

  return (
    <section className="session-summary" aria-label="Session summary">
      {/* The fourth stat, spelled out rather than squeezed into the icon row:
          a scoreboard's headline is who won it and on what. */}
      {top !== null && (
        <p className="session-summary-top" title="Top score">
          <Icon name="trophy" className="session-summary-trophy" />
          <span className="visually-hidden">Top score</span>
          <span className="session-summary-score">{top.score}</span>
          <PlayerAvatar
            player={scorePlayer(top, players)}
            className="session-summary-avatar"
          />
          <span className="session-summary-who">{top.player_name}</span>
          <span className="session-summary-song">{songLabel(top)}</span>
        </p>
      )}
      <p className="session-summary-stats">
        <IconStat icon="hash" label={singsLabel} value={sings} />
        <IconStat icon="music" label="Songs" value={songs} />
        <IconStat icon="users" label="Singers" value={singers} />
      </p>
    </section>
  );
}
