import type { AchievementRead } from "../api";
import {
  achievementColorClass,
  achievementGlyph,
  achievementIconUrl,
  isMasked,
} from "../achievements";
import { Icon } from "./icons";
import "./AchievementBadge.css";

interface Props {
  achievement: AchievementRead;
  /**
   * Whether the player this badge is being drawn for has it. The catalogue is
   * nobody's record — every row there is the badge itself — so it says nothing
   * and gets the full-colour one; a player's record says so per row.
   */
  earned?: boolean;
  /** The version of a picture the caller knows has just been replaced. */
  iconVersion?: number | null;
  className?: string;
}

/**
 * The one place a badge is drawn: the admin list, a player's record, the host
 * screen. A medallion — a plate in the achievement's colour with the glyph
 * centred, or the uploaded picture when there is one.
 *
 * Three states, and masked wins over every other: a `hidden` achievement the
 * reader has not earned is a `lock` and nothing else, whatever else the row
 * says about it. Earned is full colour, unearned is the plate in `--input-bg`
 * with a `--color-darkerer` glyph — the same "off" the app draws everywhere.
 *
 * It takes no size: the medallion is 2.5em and its glyph 1.25em of that, so the
 * parent's `font-size` sizes it (§3). A row's 16px makes the 40px square every
 * other list row leads with; the host screen's `clamp()` makes it a badge across
 * the room, and neither needs a prop.
 *
 * Decorative by construction (`aria-hidden`): every surface that draws one draws
 * the achievement's name beside it, and a screen reader announcing the picture
 * as well would say everything twice.
 */
export default function AchievementBadge({
  achievement,
  earned = true,
  iconVersion,
  className,
}: Props) {
  const masked = isMasked(achievement);
  // A masked row is drawn like an unearned one because that is what it is: the
  // API only ever blanks an achievement the reader has not got.
  const lit = earned && !masked;
  const classes = [
    "achievement-badge",
    lit ? "achievement-badge-earned" : "achievement-badge-off",
    lit ? achievementColorClass(achievement.color) : "",
    className ?? "",
  ]
    .filter((name) => name !== "")
    .join(" ");

  return (
    <span className={classes} aria-hidden="true">
      {masked ? (
        <Icon name="lock" className="achievement-badge-glyph" />
      ) : achievement.has_image ? (
        <img
          className="achievement-badge-image"
          src={achievementIconUrl(achievement.id, iconVersion)}
          alt=""
        />
      ) : (
        <Icon
          name={achievementGlyph(achievement.icon)}
          className="achievement-badge-glyph"
        />
      )}
    </span>
  );
}
