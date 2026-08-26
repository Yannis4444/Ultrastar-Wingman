import type { PlayerRead, ScoreWithContext, SongRead } from "../api";
import { shortDate, shortTime } from "../duration";
import {
  buildHistogramOption,
  difficultyLabel,
  groupValue,
  scoreLabel,
  scorePlayer,
  type Grouping,
  type ScoreGroup,
  type Sorting,
} from "../stats";
import Chart from "./Chart";
import IconStat from "./IconStat";
import { Icon } from "./icons";
import PlayerAvatar from "./PlayerAvatar";
import SongCover from "./SongCover";
import "./ScoreGroupList.css";

interface ScoreGroupListProps {
  groups: ScoreGroup[];
  grouping: Grouping;
  sorting: Sorting;
  /** Registered players by id, for the avatars. */
  players: Map<string, PlayerRead>;
  onOpenSong: (song: SongRead) => void;
  /**
   * Whether the caption's best and worst name the singer who managed them.
   * Under a song that name is the interesting half, which is the default — but
   * a list of one singer's own scores would repeat the same name twice per row
   * and truncate the rest of the caption away on a phone.
   */
  namedPeaks?: boolean;
  /**
   * Whether the list spans more than one party. Inside one session a clock
   * time places a score; across parties it says nothing, so the date joins it.
   */
  allTime?: boolean;
}

/** A single score's second line: how hard it was sung and when. */
function scoreDetail(score: ScoreWithContext, allTime: boolean): string {
  const difficulty = difficultyLabel(score.difficulty);
  const at = allTime
    ? `${shortDate(score.recorded_at)}, ${shortTime(score.recorded_at)}`
    : shortTime(score.recorded_at);
  return difficulty === "—" ? at : `${difficulty} · ${at}`;
}

/**
 * The frame a score keeps when its song has left the library: the same square
 * the covers occupy, so a row without one does not shift its whole text column
 * left. Shares `SongCover`'s fallback look rather than inventing a second one.
 */
function MissingCover({ className }: { className: string }) {
  return (
    <span
      className={`song-cover song-cover-fallback ${className}`}
      aria-hidden="true"
    >
      ?
    </span>
  );
}

/**
 * The line under a group's name. One score has no spread to describe, so it
 * names the other axis instead; several get the old app's icon run — count,
 * best, worst, average — with the singer's name behind best and worst when the
 * group is a song and the name is the interesting half.
 */
function Caption({
  group,
  grouping,
  named,
  allTime,
}: {
  group: ScoreGroup;
  grouping: Grouping;
  named: boolean;
  allTime: boolean;
}) {
  if (group.scores.length === 1) {
    // The other axis — under a song that is the singer. A list of one singer's
    // own scores has no other axis, though: it would print the reader's own
    // name and nothing else, so that one says when the run happened instead.
    const only = group.scores[0];
    return (
      <span className="score-group-caption">
        {named || grouping !== "song"
          ? scoreLabel(only, grouping)
          : scoreDetail(only, allTime)}
      </span>
    );
  }
  const worstScore = group.scores[group.scores.length - 1];
  return (
    <span className="score-group-caption">
      {/* "Scores", not "sings": one duet run leaves two rows in here. */}
      <IconStat icon="hash" label="Scores" value={group.scores.length} />
      <IconStat
        icon="arrow-up"
        label="Best"
        value={
          named ? `${group.best} · ${group.scores[0].player_name}` : group.best
        }
      />
      <IconStat
        icon="arrow-down"
        label="Worst"
        value={
          named ? `${group.worst} · ${worstScore.player_name}` : group.worst
        }
      />
      <IconStat icon="average" label="Average" value={group.average} />
    </span>
  );
}

/**
 * The ranking, one expandable row per group: open one and it shows how that
 * player's (or song's) scores are spread plus every single score behind it.
 *
 * `<details>` does the expanding — no state, and it stays keyboard-operable.
 * The song modal therefore hangs off the cover rather than the row: a click
 * anywhere else in a `<summary>` is the toggle.
 */
export default function ScoreGroupList({
  groups,
  grouping,
  sorting,
  players,
  onOpenSong,
  // Under a song, "who" is the interesting half of best and worst; under a
  // player it would repeat the name the row is already headed by.
  namedPeaks = grouping === "song",
  allTime = false,
}: ScoreGroupListProps) {
  // Ranks 1–3 are a podium only while the list is ordered best-first. Under
  // "alphabetically" or "worst score" the numerals are positions, nothing more.
  const podium = sorting === "best" || sorting === "average";
  // Grouped by player the expanded rows are songs, so they are the way into the
  // song modal; otherwise they are singers and carry an avatar instead.
  const rowsAreSongs = grouping === "player";

  return (
    <ol
      className={podium ? "score-groups score-groups-podium" : "score-groups"}
    >
      {groups.map((group, index) => (
        <li key={group.key}>
          <details data-testid="score-group">
            <summary>
              <span className="score-group-rank">{index + 1}</span>
              {grouping === "player" ? (
                <PlayerAvatar
                  player={scorePlayer(group.scores[0], players)}
                  className="score-group-avatar"
                />
              ) : group.song !== null ? (
                <button
                  type="button"
                  className="score-group-cover-button"
                  aria-label={`Details for ${group.song.title}`}
                  onClick={(event) => {
                    // Inside a `<summary>`, a click's default action is the
                    // toggle — stopping propagation alone would not cancel it.
                    event.preventDefault();
                    event.stopPropagation();
                    if (group.song !== null) onOpenSong(group.song);
                  }}
                >
                  <SongCover song={group.song} className="score-group-cover" />
                </button>
              ) : (
                <MissingCover className="score-group-cover" />
              )}
              <span className="score-group-text">
                <span className="score-group-label">{group.label}</span>
                <Caption
                  group={group}
                  grouping={grouping}
                  named={namedPeaks}
                  allTime={allTime}
                />
              </span>
              {/* The number the list is sorted by, so it can never disagree
                  with the rank order. */}
              <span className="score-group-score">
                {groupValue(group, sorting)}
              </span>
              {/* Right while collapsed like every other row in the app, down
                  while open — the rotation below turns the one glyph, so the
                  open state never points the arrow up. */}
              <Icon name="chevron-right" className="score-group-chevron" />
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
                const song = score.song;
                const body = (
                  <>
                    {rowsAreSongs ? (
                      song !== null ? (
                        <SongCover song={song} className="score-entry-cover" />
                      ) : (
                        <MissingCover className="score-entry-cover" />
                      )
                    ) : (
                      <PlayerAvatar
                        player={scorePlayer(score, players)}
                        className="score-entry-avatar"
                      />
                    )}
                    <span className="score-group-text">
                      <span className="score-group-label">
                        {scoreLabel(score, grouping)}
                      </span>
                      <span className="score-group-caption">
                        {scoreDetail(score, allTime)}
                      </span>
                    </span>
                    <span className="score-group-score">{score.score}</span>
                  </>
                );
                return (
                  <li key={score.id} data-testid="score-row">
                    {rowsAreSongs && song !== null ? (
                      <button
                        type="button"
                        className="score-entry score-entry-button"
                        onClick={() => onOpenSong(song)}
                      >
                        {body}
                      </button>
                    ) : (
                      <div className="score-entry">{body}</div>
                    )}
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
