import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import "./EmptyState.css";

interface EmptyStateProps {
  /** The glyph of whatever is missing — the list's own icon. */
  icon: IconName;
  /** What is not there, in three or four words. */
  title: string;
  /** One sentence on what to do about it. Optional: a reader who may not act
   *  on the invitation is not given one. */
  children?: ReactNode;
  /** The way out — a link or a button, rendered under the sentence. */
  action?: ReactNode;
}

/**
 * An empty list that says what to do about it rather than only that it is
 * empty. The heading, the sentence and the action come from the caller; the
 * shape does not.
 */
export default function EmptyState({
  icon,
  title,
  children,
  action,
}: EmptyStateProps) {
  return (
    <div className="empty-state">
      <Icon name={icon} className="empty-state-icon" />
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
