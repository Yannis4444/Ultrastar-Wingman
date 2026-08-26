import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./icons";

/**
 * An empty score page that says what to do about it, not just that it is
 * empty. Shared by the session view and the account's own history, which are
 * empty for different reasons — hence the sentence comes from the caller.
 *
 * The rules live in `pages/Scores.css`, which both callers import.
 */
export default function ScoresEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="scores-empty">
      <Icon name="chart" className="scores-empty-icon" />
      <h2>No scores yet</h2>
      <p>{children}</p>
      <Link className="button button-primary" to="/songs">
        Browse songs
      </Link>
    </div>
  );
}
