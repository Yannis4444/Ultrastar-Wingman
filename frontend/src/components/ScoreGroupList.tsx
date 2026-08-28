import type { PlayerRead, ScoreWithContext, SongRead } from "../api";
import { shortDate, shortTime } from "../duration";
import {
  buildHistogramOption,
  groupValue,
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
   * Whether the panel's best and worst name the singer who managed them.
   * Under a song that name is the interesting half, which is the default — but
   * a list of one singer's own scores would print the same name twice.
   */
  namedPeaks?: boolean;
  /**
   * Whether every score in here belongs to the reader. Their own name and
   * avatar on each of a hundred expanded rows says nothing (§1.5) — and under
   * one song those rows are otherwise identical, so they lead with when the
   * run happened instead.
   */
  ownRows?: boolean;
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
 * The two lines a group row is headed by: the thing it stands for, and the
 * quiet line under it — the artist under a song, the number of scores under a
 * singer, both under a single ungrouped score, where the singer has nowhere
 * else to go. The same shape every other list in the app uses; the spread
 * itself is in the panel the row unfolds.
 */
function rowLines(
  group: ScoreGroup,
  grouping: Grouping,
): { title: string; caption: string | null } {
  if (grouping === "player") {
    const count = group.scores.length;
    return {
      // "Scores", not "sings": one duet run leaves two rows in here.
      caption: `${count} score${count === 1 ? "" : "s"}`,
      title: group.label,
    };
  }
  const song = group.song;
  // `group.label` already reads "Unknown song" once a song has left the
  // library, and then there is no artist to print either.
  const title = song?.title ?? group.label;
  if (grouping !== "none") return { title, caption: song?.artist ?? null };
  const singer = group.scores[0].player_name;
  return {
    title,
    caption: song === null ? singer : `${song.artist} · ${singer}`,
  };
}

/**
 * What an opened group adds up to: the four numbers the row no longer carries,
 * plus the shape behind them. The one tile on this page besides the session's
 * boxplot — it holds the summary, never the scores themselves, which stay flat
 * rows like every other list.
 */
function GroupPanel({ group, named }: { group: ScoreGroup; named: boolean }) {
  const worst = group.scores[group.scores.length - 1];
  return (
    <div className="score-group-panel">
      <div className="score-group-stats">
        <IconStat
          className="score-group-stat"
          icon="hash"
          label="Scores"
          value={group.scores.length}
          showLabel
        />
        <IconStat
          className="score-group-stat"
          icon="arrow-up"
          label={named ? `Best · ${group.scores[0].player_name}` : "Best"}
          value={group.best}
          showLabel
        />
        <IconStat
          className="score-group-stat"
          icon="arrow-down"
          label={named ? `Worst · ${worst.player_name}` : "Worst"}
          value={group.worst}
          showLabel
        />
        <IconStat
          className="score-group-stat"
          icon="average"
          label="Average"
          value={group.average}
          showLabel
        />
      </div>
      {/* A couple of bars across twenty buckets is noise, not a shape. */}
      {group.scores.length >= 4 && (
        <div className="score-group-chart">
          <Chart
            option={buildHistogramOption(group.scores)}
            height={96}
            label={`Score distribution for ${group.label}`}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The ranking, one expandable row per group: open one and it shows what that
 * player's (or song's) scores add up to plus every single score behind it.
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
  ownRows = false,
}: ScoreGroupListProps) {
  // Ranks 1–3 are a podium only while the list is ordered best-first. Under
  // "alphabetically" or "worst score" the numerals are positions, nothing more.
  const podium = sorting === "best" || sorting === "average";
  // Grouped by player the expanded rows are songs, so they are the way into the
  // song modal; otherwise they are singers and carry an avatar instead.
  const rowsAreSongs = grouping === "player";
  // Ungrouped a row *is* one score — there is nothing behind it to unfold, so
  // it is a plain song row that opens the modal, as everywhere else in the app.
  const expandable = grouping !== "none";

  return (
    <ol
      className={podium ? "score-groups score-groups-podium" : "score-groups"}
    >
      {groups.map((group, index) => {
        const song = group.song;
        const lines = rowLines(group, grouping);
        const head = (
          <>
            <span className="score-group-rank">{index + 1}</span>
            {grouping === "player" ? (
              <PlayerAvatar
                player={scorePlayer(group.scores[0], players)}
                className="score-group-avatar"
              />
            ) : song === null ? (
              <MissingCover className="score-group-cover" />
            ) : expandable ? (
              <button
                type="button"
                className="score-group-cover-button"
                aria-label={`Details for ${song.title}`}
                onClick={(event) => {
                  // Inside a `<summary>`, a click's default action is the
                  // toggle — stopping propagation alone would not cancel it.
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenSong(song);
                }}
              >
                <SongCover song={song} className="score-group-cover" />
              </button>
            ) : (
              // The whole row already opens the modal; a button inside it
              // would be a second one, and nested buttons are invalid HTML.
              <SongCover song={song} className="score-group-cover" />
            )}
            <span className="score-group-text">
              <span className="score-group-label">{lines.title}</span>
              {lines.caption !== null && (
                <span className="score-group-caption">{lines.caption}</span>
              )}
            </span>
            {/* The number the list is sorted by, so it can never disagree
                with the rank order. */}
            <span className="score-group-score">
              {groupValue(group, sorting)}
            </span>
            {/* Right while collapsed like every other row in the app, down
                while open — the rotation below turns the one glyph, so the
                open state never points the arrow up. */}
            {expandable && (
              <Icon name="chevron-right" className="score-group-chevron" />
            )}
          </>
        );

        if (!expandable) {
          return (
            <li key={group.key}>
              {song === null ? (
                <div className="score-group-row" data-testid="score-group">
                  {head}
                </div>
              ) : (
                <button
                  type="button"
                  className="score-group-row score-group-row-button"
                  data-testid="score-group"
                  onClick={() => onOpenSong(song)}
                >
                  {head}
                </button>
              )}
            </li>
          );
        }

        return (
          <li key={group.key}>
            <details data-testid="score-group">
              <summary>{head}</summary>

              {/* One score is its own best, worst and average — four times the
                  same number says nothing the row below it does not. */}
              {group.scores.length > 1 && (
                <GroupPanel group={group} named={namedPeaks} />
              )}

              <ul className="score-group-scores">
                {group.scores.map((score) => {
                  const entry = entryLines(score, {
                    ownRows,
                    rowsAreSongs,
                  });
                  const body = (
                    <>
                      {ownRows ? null : rowsAreSongs ? (
                        score.song !== null ? (
                          <SongCover
                            song={score.song}
                            className="score-entry-cover"
                          />
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
                        <span
                          className={
                            ownRows
                              ? "score-group-label score-entry-when"
                              : "score-group-label"
                          }
                        >
                          {entry.title}
                        </span>
                        {entry.caption !== null && (
                          <span className="score-group-caption">
                            {entry.caption}
                          </span>
                        )}
                      </span>
                      <span className="score-group-score">{score.score}</span>
                    </>
                  );
                  const entrySong = score.song;
                  return (
                    <li key={score.id} data-testid="score-row">
                      {rowsAreSongs && entrySong !== null ? (
                        <button
                          type="button"
                          className="score-entry score-entry-button"
                          onClick={() => onOpenSong(entrySong)}
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
        );
      })}
    </ol>
  );
}

/**
 * The two lines of one expanded score. A song row is the song row the rest of
 * the app draws — title over artist, nothing else; under a song the rows are
 * the singers, and a name needs no second line.
 *
 * The reader's own history is the exception: it lists one song sung by one
 * person, so without the date and time every row would read the same.
 */
function entryLines(
  score: ScoreWithContext,
  { ownRows, rowsAreSongs }: { ownRows: boolean; rowsAreSongs: boolean },
): { title: string; caption: string | null } {
  if (ownRows) {
    return {
      title: `${shortDate(score.recorded_at)}, ${shortTime(score.recorded_at)}`,
      caption: null,
    };
  }
  if (!rowsAreSongs) return { title: score.player_name, caption: null };
  return {
    title: score.song?.title ?? "Unknown song",
    caption: score.song?.artist ?? null,
  };
}
