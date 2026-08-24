import { parseServerTime } from "../duration";
import {
  buildHistogramOption,
  difficultyLabel,
  scoreLabel,
  type Grouping,
  type ScoreGroup,
} from "../stats";
import Chart from "./Chart";
import { Icon } from "./icons";
import SongCover from "./SongCover";
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

/** One line under the group name: the other axis for a single score, the
 * spread in words for several — no glyph codes, nothing hover-only. */
function caption(group: ScoreGroup, grouping: Grouping): string {
  if (group.scores.length === 1) return scoreLabel(group.scores[0], grouping);
  return `${group.scores.length} sings · best ${group.best} · worst ${group.worst}`;
}

/**
 * The ranking, one expandable row per group: open one and it shows how that
 * player's (or song's) scores are spread plus every single score behind it.
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
              <span className="score-group-rank">{index + 1}</span>
              {grouping === "song" && group.scores[0].song !== null && (
                <SongCover
                  song={group.scores[0].song}
                  className="score-group-cover"
                />
              )}
              <span className="score-group-text">
                <span className="score-group-label">{group.label}</span>
                <span className="score-group-caption">
                  {caption(group, grouping)}
                </span>
              </span>
              {/* The big number is the value the list is sorted by, so it can
                  never disagree with the rank order. */}
              <span className="score-group-score">
                {group.scores.length > 1 ? group.median : group.scores[0].score}
              </span>
              <Icon name="chevron-down" className="score-group-chevron" />
            </summary>

            {/* A couple of bars across twenty buckets is noise, not a shape. */}
            {group.scores.length >= 4 && (
              <Chart
                option={buildHistogramOption(group.scores)}
                height={96}
                label={`Score distribution for ${group.label}`}
              />
            )}

            <ul className="score-group-scores">
              {group.scores.map((score) => {
                const difficulty = difficultyLabel(score.difficulty);
                const at = shortTime(score.recorded_at);
                return (
                  <li key={score.id} data-testid="score-row">
                    <span className="score-group-text">
                      <span className="score-group-label">
                        {scoreLabel(score, grouping)}
                      </span>
                      <span className="score-group-caption">
                        {difficulty === "—" ? at : `${difficulty} · ${at}`}
                      </span>
                    </span>
                    <span className="score-group-score">{score.score}</span>
                  </li>
                );
              })}
            </ul>
          </details>
        </li>
      ))}
    </ol>
  );
}
