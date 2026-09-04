import type { AchievementRead } from "../api";
import {
  type AchievementIconSize,
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
  /**
   * Which file to ask the icon endpoint for — the picture's **resolution**,
   * never its size on screen, which stays the parent's `font-size` (§3). Every
   * surface that draws a list of badges keeps the 256px `small`; only the
   * achievement modal, which fills a phone with one of them, asks for `full`,
   * and only while it is open: a shipped picture is over a megabyte.
   */
  resolution?: AchievementIconSize;
  className?: string;
}

/**
 * The one place a badge is drawn: the admin list, a player's record, the host
 * screen. A rounded square — a plate in the achievement's colour with the
 * glyph centred, or the picture when there is one: an uploaded one, or the one
 * Wingman ships with a built-in (`has_image` covers both).
 *
 * Three states, and masked wins over every other: a `hidden` achievement the
 * reader has not earned is a `lock` and nothing else, whatever else the row
 * says about it. Earned is full colour, unearned is the plate in `--input-bg`
 * with a `--color-darkerer` glyph — the same "off" the app draws everywhere.
 *
 * An uploaded picture is asked for at the row's own `icon_version`, so a
 * replaced one is drawn the moment the listing carries the new version and no
 * caller has to say that the bytes moved.
 *
 * It takes no size: the badge is 2.5em and its glyph 1.25em of that, so the
 * parent's `font-size` sizes it (§3). A row's 16px makes the 40px square every
 * other list row leads with; the host screen's `clamp()` makes it a badge across
 * the room, and neither needs a prop. `resolution` is not a size — it is which
 * file the endpoint hands back, and the modal is the only caller that moves it.
 *
 * Decorative by construction (`aria-hidden`): every surface that draws one draws
 * the achievement's name beside it, and a screen reader announcing the picture
 * as well would say everything twice.
 */
export default function AchievementBadge({
  achievement,
  earned = true,
  resolution = "small",
  className,
}: Props) {
  const masked = isMasked(achievement);
  // A masked row is drawn like an unearned one because that is what it is: the
  // API only ever blanks an achievement the reader has not got.
  const lit = earned && !masked;
  const picture = !masked && achievement.has_image;
  const classes = [
    "achievement-badge",
    lit ? "achievement-badge-earned" : "achievement-badge-off",
    lit ? achievementColorClass(achievement.color) : "",
    // A picture fills the plate, so the plate is not painted under it: the
    // rounded corners would otherwise show a hairline of the plate's colour
    // around the picture's edge.
    picture ? "achievement-badge-picture" : "",
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
          src={achievementIconUrl(
            achievement.id,
            achievement.icon_version,
            resolution,
          )}
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
