import { parseServerTime } from "../duration";
import {
  buildHistogramOption,
  difficultyLabel,
  scoreLabel,
  type Grouping,
  type ScoreGroup,
} from "../stats";
import Chart from "./Chart";
import "./ScoreGroupList.css";

interface ScoreGroupListProps {
  groups: ScoreGroup[];
  grouping: Grouping;
}

function shortTime(timestamp: string): string {
  return new Date(parseServerTime(timestamp)).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The chart's groups again, in full: open one and it shows how that player's
 * (or song's) scores are spread plus every single score behind the box.
 *
 * `<details>` does the expanding — no state, and it stays keyboard-operable.
 */
export default function ScoreGroupList({
  groups,
  grouping,
}: ScoreGroupListProps) {
  return (
    <ol className="score-groups">
      {groups.map((group, index) => (
        <li key={group.key}>
          <details>
            <summary>
              <span className="score-group-rank">{index + 1}.</span>
              <span className="score-group-label">{group.label}</span>
              <span className="score-group-numbers">
                <span title="Number of scores">{group.scores.length}×</span>
                <span title="Best score">▲ {group.best}</span>
                <span title="Median score">◆ {group.median}</span>
                <span title="Worst score">▼ {group.worst}</span>
              </span>
            </summary>

            {/* One score is a single bar — a distribution needs a spread. */}
            {group.scores.length > 1 && (
              <Chart
                option={buildHistogramOption(group.scores)}
                height={120}
                label={`Score distribution for ${group.label}`}
              />
            )}

            <table className="score-group-table">
              <thead>
                <tr>
                  <th>{grouping === "song" ? "Player" : "Song"}</th>
                  <th>Score</th>
                  <th>Difficulty</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {group.scores.map((score) => (
                  <tr key={score.id}>
                    <td>{scoreLabel(score, grouping)}</td>
                    <td>{score.score}</td>
                    <td>{difficultyLabel(score.difficulty)}</td>
                    <td>{shortTime(score.recorded_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </li>
      ))}
    </ol>
  );
}
