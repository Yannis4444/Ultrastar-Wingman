import type { ScoreWithContext, SessionRead } from "../api";
import { songLabel, summarize } from "../stats";
import { Icon } from "./icons";
import "./SessionSummaryRow.css";

interface SessionSummaryRowProps {
  session: SessionRead;
  scores: ScoreWithContext[];
}

/** One card describing a party at a glance: the top score and three counts. */
export default function SessionSummaryRow({
  session,
  scores,
}: SessionSummaryRowProps) {
  const { songs, singers, top } = summarize(scores);

  return (
    <section className="session-summary" aria-label="Session summary">
      {top !== null && (
        <p className="session-summary-top">
          <Icon name="trophy" className="session-summary-trophy" />
          <span className="session-summary-score">{top.score}</span>
          {" — "}
          <span className="session-summary-who">{top.player_name}</span>
          {" · "}
          <span className="session-summary-song">{songLabel(top)}</span>
        </p>
      )}
      <dl className="session-summary-counts">
        <div>
          {/* From the session row, not the scores: a stopped song records none. */}
          <dt>Sings</dt>
          <dd>{session.sing_count}</dd>
        </div>
        <div>
          <dt>Songs</dt>
          <dd>{songs}</dd>
        </div>
        <div>
          <dt>Singers</dt>
          <dd>{singers}</dd>
        </div>
      </dl>
    </section>
  );
}
