import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { PlayerRead, ScoreWithContext, SongRead } from "../api";
import {
  evaluationLabel,
  isNewHighscore,
  scoreMarkers,
  scoreOffset,
  scorePlayer,
  songHistory,
  type ScoreMarker,
} from "../stats";
import { Icon, type IconName } from "./icons";
import PlayerAvatar from "./PlayerAvatar";
import ScoreSummary from "./ScoreSummary";
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

/** The glyph each of the three all-time marks wears. */
const MARKER_ICONS: Record<ScoreMarker["kind"], IconName> = {
  worst: "arrow-down",
  average: "average",
  best: "arrow-up",
};

/**
 * The gap two markers keep, in em of their own font size (§7): one glyph, its
 * pointer, and air.
 */
const MARKER_GAP_EM = 2.5;

/**
 * What that gap is worth on a strip nothing has measured yet — jsdom lays
 * nothing out, and a TV strip is about this many percent wide per em.
 */
const FALLBACK_GAP = 4;

/**
 * The marker collision distance as a percentage of the strip: 2.5em of the
 * marker's own font size, which is a share of the strip only once both are in
 * pixels. The font size is read off the strip itself, which is why the clamp
 * lives there rather than on the marks (LastSong.css).
 *
 * The strip is drawn whether or not there is a history to mark, so this
 * measures once on mount and again whenever the element changes size — the
 * height moves with `vh` alone, so a window resized only in height is caught
 * too.
 */
function useMarkerGap(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [gap, setGap] = useState(FALLBACK_GAP);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = () => {
      const width = element.clientWidth;
      if (width <= 0) return;
      const size = Number.parseFloat(getComputedStyle(element).fontSize);
      if (!Number.isFinite(size) || size <= 0) return;
      setGap(((MARKER_GAP_EM * size) / width) * 100);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, gap];
}

/**
 * The result screen on the TV: the song that just finished, what it has scored
 * over its whole life, and a bar per singer of this run.
 *
 * The all-time numbers are the point of the block — a 7000 means something
 * different on a song nobody ever cleared 6000 on — and they are the phones'
 * own score summary, in the naming column beside the cover (§7).
 */
export default function LastSong({
  song,
  scores,
  history,
  players,
}: LastSongProps) {
  const stats = songHistory(history);
  const record = isNewHighscore(history, scores);
  const [strip, gap] = useMarkerGap();

  return (
    <section className="last-song" aria-label="Last song">
      <div className="last-song-head">
        {song !== null && <SongCover song={song} className="last-song-cover" />}
        <div className="last-song-naming">
          <h2 className="last-song-title">{song?.title ?? "Unknown song"}</h2>
          {song !== null && <p className="last-song-artist">{song.artist}</p>}
          {/* Every score is a different singer's, so the peaks are named; every
              score is the same song, so the song count would be a fixed 1. */}
          <ScoreSummary scores={history} named className="last-song-summary" />
        </div>
      </div>

      <div className="last-song-bars">
        {/* The same numbers as the summary above, placed on the scale the bars
            use — decoration for them, so it is not announced twice. Drawn
            whether or not the history has landed: the strip is what the
            markers are measured against, and a band that appears a round trip
            later would push the bars down in front of the room. */}
        <div className="last-song-markers" aria-hidden="true">
          <span />
          <div ref={strip}>
            {stats !== null &&
              scoreMarkers(stats, gap).map((marker) => (
                <span
                  className="last-song-marker"
                  key={marker.kind}
                  style={{ left: `${marker.offset}%` }}
                >
                  <Icon name={MARKER_ICONS[marker.kind]} />
                </span>
              ))}
          </div>
        </div>

        {scores.map((score) => (
          <div className="last-song-row" key={score.id}>
            <PlayerAvatar
              player={scorePlayer(score, players)}
              className="last-song-avatar"
            />
            <div className="last-song-bar">
              <span
                className="last-song-percent"
                style={{ width: `${scoreOffset(score.score)}%` }}
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
