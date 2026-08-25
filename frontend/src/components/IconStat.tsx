import { Icon, type IconName } from "./icons";
import "./IconStat.css";

interface IconStatProps {
  icon: IconName;
  /** The word the glyph stands for: tooltip for pointers, name for readers. */
  label: string;
  value: string | number;
  className?: string;
}

/**
 * One number behind a glyph — no visible word, because a scoreboard repeats the
 * same four stats on every row and the labels would outweigh the numbers.
 *
 * The word is not lost: `title` shows it on hover and the visually hidden copy
 * is what a screen reader announces before the value.
 */
export default function IconStat({
  icon,
  label,
  value,
  className,
}: IconStatProps) {
  return (
    <span
      className={className ? `icon-stat ${className}` : "icon-stat"}
      title={label}
    >
      <Icon name={icon} className="icon-stat-icon" />
      <span className="visually-hidden">{label}</span>
      <span className="icon-stat-value">{value}</span>
    </span>
  );
}
