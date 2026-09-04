import { progressFraction, progressLabel } from "../achievements";
import "./AchievementProgress.css";

interface Props {
  /** How far along the player is, straight off their record row. */
  current: number | null;
  /** What the achievement asks for, or `null` when it asks for no number. */
  target: number | null;
}

/**
 * How far along one player is on one achievement: the bar, and the "7 / 10"
 * beside it in words.
 *
 * Its own component because two surfaces draw the same picture — the row on the
 * user page and the modal that row opens — and a second copy of a bar is a
 * second bar to keep in step.
 *
 * It draws nothing where there is nothing to draw, so no caller has to ask
 * first: `=`, `<` and `<=` progress towards nothing and carry no target, and a
 * masked row is deliberately given neither number — a bar that filled would say
 * what the achievement is for.
 */
export default function AchievementProgress({ current, target }: Props) {
  const fraction = progressFraction(current, target);
  const label = progressLabel(current, target);
  if (fraction === null || label === null) return null;

  return (
    <span className="achievement-progress">
      {/* The words carry it; the bar is the same picture in colour. */}
      <span className="achievement-progress-bar" aria-hidden="true">
        <span style={{ width: `${fraction * 100}%` }} />
      </span>
      <span className="achievement-progress-label">{label}</span>
    </span>
  );
}
