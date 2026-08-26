import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import EmptyState from "./EmptyState";

/**
 * An empty score page. Shared by the session view and the account's own
 * history, which are empty for different reasons — hence the sentence comes
 * from the caller, while the glyph, the heading and the way out do not. Three
 * call sites, one "Browse songs" link.
 */
export default function ScoresEmpty({ children }: { children: ReactNode }) {
  return (
    <EmptyState
      icon="chart"
      title="No scores yet"
      action={
        <Link className="button button-primary" to="/songs">
          Browse songs
        </Link>
      }
    >
      {children}
    </EmptyState>
  );
}
