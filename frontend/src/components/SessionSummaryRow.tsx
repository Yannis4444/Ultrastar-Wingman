import type { ScoreWithContext, SessionRead } from "../api";
import { songLabel, summarize } from "../stats";
import "./SessionSummaryRow.css";

interface SessionSummaryRowProps {
  session: SessionRead;
  scores: ScoreWithContext[];
}

/** The four numbers that describe a party at a glance. */
export default function SessionSummaryRow({
  session,
  scores,
}: SessionSummaryRowProps) {
  const { songs, singers, top } = summarize(scores);

  const tiles: [string, string][] = [
    ["Sings", String(session.sing_count)],
    ["Songs", String(songs)],
    ["Singers", String(singers)],
    [
      "Top score",
      top === null
        ? "—"
        : `${top.score} — ${top.player_name} · ${songLabel(top)}`,
    ],
  ];

  return (
    <dl className="session-summary" aria-label="Session summary">
      {tiles.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
