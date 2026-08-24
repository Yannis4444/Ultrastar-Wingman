import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import {
  getCurrentSingOptions,
  listLatestScoresOptions,
  listLatestScoresQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import { songLabel } from "../stats";
import { Icon } from "./icons";
import "./LatestScores.css";

// A duet has two singers, USDX allows more; a handful covers the last song and
// leaves headroom without pulling the whole history onto the TV.
const LIMIT = 12;

interface LatestScoresProps {
  /** What the host stage shows instead while there is nothing to score. */
  fallback?: ReactNode;
}

/**
 * The result screen on the TV: what the song that just finished scored.
 *
 * Seeded from `/stats/latest` so a reload right after a song still shows it,
 * refreshed when USDX reports new scores, and cleared once the next song starts.
 */
export default function LatestScores({ fallback = null }: LatestScoresProps) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);

  const canView = auth.can("stats.view");
  const latest = useQuery({
    ...listLatestScoresOptions({ query: { limit: LIMIT } }),
    enabled: auth.loaded && canView,
  });
  // Shares CurrentlyPlaying's cache entry: a page reloaded mid-song must not
  // show the previous song's scores next to the running one.
  const current = useQuery(getCurrentSingOptions());

  useWingmanEvent("scores.recorded", () => {
    setDismissed(false);
    void queryClient.invalidateQueries({
      queryKey: listLatestScoresQueryKey({ query: { limit: LIMIT } }),
    });
  });
  useWingmanEvent("karaoke.started", () => setDismissed(true));

  // A live sing owns the stage — never scores (or the fallback) next to it.
  if (current.isPending || current.data?.sing) return null;
  if (!canView || dismissed) return <>{fallback}</>;

  // The list is newest first and one sing's scores share a `sing_id`, so the
  // first row's sing is the one that just finished.
  const all = latest.data?.scores ?? [];
  const sing = all[0]?.sing_id;
  const scores = all
    .filter((score) => score.sing_id === sing)
    .sort((a, b) => b.score - a.score);
  if (scores.length === 0) return <>{fallback}</>;

  return (
    <section
      className={`latest-scores${scores.length > 3 ? " latest-scores-dense" : ""}`}
      aria-label="Latest scores"
    >
      <h2>{songLabel(scores[0])}</h2>
      <ol>
        {scores.map((score, index) => (
          <li key={score.id}>
            {index === 0 ? (
              <Icon name="star" className="latest-scores-star" />
            ) : (
              <span className="latest-scores-rank">{index + 1}</span>
            )}
            <span className="latest-scores-name">{score.player_name}</span>
            <span className="latest-scores-value">{score.score}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
