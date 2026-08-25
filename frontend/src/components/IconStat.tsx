import { Icon, type IconName } from "./icons";
import "./IconStat.css";

interface IconStatProps {
  icon: IconName;
  /** The word the glyph stands for: tooltip for pointers, name for readers. */
  label: string;
  value: string | number;
  className?: string;
  /**
   * Print the word under the value instead of only announcing it. For a stat
   * row that appears once on a page there is room for it; a scoreboard that
   * repeats the same stats on every row leaves it off.
   */
  showLabel?: boolean;
}

/**
 * One number behind a glyph — by default no visible word, because a scoreboard
 * repeats the same four stats on every row and the labels would outweigh the
 * numbers.
 *
 * The word is not lost: `title` shows it on hover and the visually hidden copy
 * is what a screen reader announces before the value.
 */
export default function IconStat({
  icon,
  label,
  value,
  className,
  showLabel = false,
}: IconStatProps) {
  return (
    <span
      className={className ? `icon-stat ${className}` : "icon-stat"}
      // A tooltip repeating a word that is already printed is just noise.
      title={showLabel ? undefined : label}
    >
      <Icon name={icon} className="icon-stat-icon" />
      {!showLabel && <span className="visually-hidden">{label}</span>}
      <span className="icon-stat-value">{value}</span>
      {showLabel && <span className="icon-stat-label">{label}</span>}
    </span>
  );
}
