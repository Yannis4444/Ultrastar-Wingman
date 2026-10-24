import type { ScoreWithContext } from "../api";
import { scoreSummary } from "../stats";
import IconStat from "./IconStat";
import "./ScoreSummary.css";

interface ScoreSummaryProps {
  /** The scores being added up. Empty draws nothing at all. */
  scores: ScoreWithContext[];
  /**
   * Whether Best and Worst name the singer who holds them. Off where every
   * score in the summary belongs to one singer: their name twice says
   * nothing (§1.5).
   */
  named?: boolean;
  /** The surface's own margins. Never its layout — that is this one's. */
  className?: string;
}

/**
 * What a song's history adds up to on the host's results (`LastSong`, §7
 * *Host*): Sings · Best · Average · Worst, what was sung before how well it
 * went, and the three score numbers reading down from the best. No Songs: the
 * results are one song's.
 *
 * The host's alone. Every phone surface adds its scores up in `ScoreOverview`
 * instead, the numbers marked on its histogram; read across a room, that
 * would be too small, so the TV keeps a glyph, a number and a word per stat —
 * five glyphs in a row being exactly where an icon stops being self-evident,
 * this is the one place `IconStat` is asked for its label.
 */
export default function ScoreSummary({
  scores,
  named = false,
  className,
}: ScoreSummaryProps) {
  const summary = scoreSummary(scores);
  // Nothing to add up: the surface says why in its own words, if at all.
  if (summary === null) return null;

  const classes = ["score-summary"];
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
