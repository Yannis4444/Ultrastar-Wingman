import { Icon, type IconName } from "./icons";
import "./IconStat.css";

interface IconStatProps {
  icon: IconName;
  /** The word the glyph stands for: tooltip for pointers, name for readers. */
  label: string;
  value: string | number;
  className?: string;
  /**
   * Print the word under the value instead of only announcing it. A row of
   * five glyphs is exactly where an icon stops being self-evident, so the
   * score summary (§7) sets it on every stat it draws; a strip of two or
   * three whose glyphs each say one obvious thing leaves it off.
   */
  showLabel?: boolean;
}

/**
 * One number behind a glyph. `showLabel` decides whether the word is printed
 * under it: `ScoreSummary` prints all five of its own, a summary strip of a
 * couple of counts does not.
 *
 * Unprinted, the word is not lost: `title` shows it on hover and the visually
 * hidden copy is what a screen reader announces before the value.
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
