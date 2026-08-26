import type { ScoreWithContext, SessionRead } from "../api";
import { summarize } from "../stats";
import IconStat from "./IconStat";
import "./SessionSummaryRow.css";

interface SessionSummaryRowProps {
  session: SessionRead;
  scores: ScoreWithContext[];
}

/**
 * A party in four numbers: how much was sung, how varied it was, how many
 * people took a turn, and what the evening's best score was.
 *
 * Deliberately numbers only. Who sang that best score, and on what, is the
 * first row of the ranking directly below — printing it here as well said the
 * same thing twice, and grouped by player it said it twice in a row.
 *
 * The counts come from the scores, not from `session.sing_count`. That column
 * counts every song *started* — restarts and songs stopped before Ultrastar
 * Deluxe scored them included — so it regularly disagreed with everything on
 * screen. It is not thrown away: when it is higher than the number of scored
 * performances, the difference goes into the stat's tooltip.
 */
export default function SessionSummaryRow({
  session,
  scores,
}: SessionSummaryRowProps) {
  const { sings, songs, singers, top } = summarize(scores);
  const singsLabel =
    session.sing_count > sings
      ? `Sings — ${sings} scored of ${session.sing_count} started`
      : "Sings";

  return (
    <section className="session-summary" aria-label="Session summary">
      <p className="session-summary-stats">
        <IconStat icon="hash" label={singsLabel} value={sings} />
        <IconStat icon="music" label="Songs" value={songs} />
        <IconStat icon="users" label="Singers" value={singers} />
        {top !== null && (
          <IconStat
            icon="trophy"
            label="Top score"
            value={top.score}
            className="session-summary-best"
          />
        )}
      </p>
    </section>
  );
}
