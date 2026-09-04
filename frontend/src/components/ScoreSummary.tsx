import type { ScoreWithContext } from "../api";
import { scoreSummary } from "../stats";
import IconStat from "./IconStat";
import "./ScoreSummary.css";

interface ScoreSummaryProps {
  /** The scores being added up. Empty draws nothing at all. */
  scores: ScoreWithContext[];
  /**
   * Whether the distinct songs are counted. Left out where every score in the
   * summary is the same song, which would make it a permanent "1".
   */
  songs?: boolean;
  /**
   * Whether Best and Worst name the singer who holds them. Off where every
   * score in the summary belongs to the reader: their own name twice says
   * nothing (§1.5).
   */
  named?: boolean;
  /** The surface's own margins. Never its layout — that is this one's. */
  className?: string;
}

/**
 * What a set of scores adds up to, in one shape wherever they are added up
 * (§7): Sings · Songs · Best · Average · Worst — what was sung before how well
 * it went, and the three score numbers reading down from the best.
 *
 * Every word is printed under its number: five glyphs in a row is exactly
 * where an icon stops being self-evident, so this is the one place `IconStat`
 * is asked for its label.
 *
 * The chart under a summary belongs to the surface, not to this component: the
 * user page and an open group want a distribution, a song's ranking wants the
 * scores themselves. Only the threshold is shared (`CHART_MIN_SCORES`).
 */
export default function ScoreSummary({
  scores,
  songs = false,
  named = false,
  className,
}: ScoreSummaryProps) {
  const summary = scoreSummary(scores);
  // Nothing to add up: the surface says why in its own words, if at all.
  if (summary === null) return null;

  // Four stats read as two rows of two on a phone, five as three and two. The
  // count is fixed per surface, so the class says which rather than a guess.
  const classes = ["score-summary"];
  if (songs) classes.push("score-summary-five");
  if (className !== undefined) classes.push(className);

  return (
    <div className={classes.join(" ")}>
      <IconStat
        className="score-summary-stat"
        icon="hash"
        label="Sings"
        value={summary.sings}
        showLabel
      />
      {songs && (
        <IconStat
          className="score-summary-stat"
          icon="music"
          label="Songs"
          value={summary.songs}
          showLabel
        />
      )}
      <IconStat
        className="score-summary-stat"
        icon="arrow-up"
        label={named ? `Best · ${summary.bestBy}` : "Best"}
        value={summary.best}
        showLabel
      />
      <IconStat
        className="score-summary-stat"
        icon="average"
        label="Average"
        value={summary.average}
        showLabel
      />
      <IconStat
        className="score-summary-stat"
        icon="arrow-down"
        label={named ? `Worst · ${summary.worstBy}` : "Worst"}
        value={summary.worst}
        showLabel
      />
    </div>
  );
}
