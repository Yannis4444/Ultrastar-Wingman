import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listLatestScoresOptions,
  listLatestScoresQueryKey,
} from "../api/@tanstack/react-query.gen";
import { useAuth } from "../auth";
import { useWingmanEvent } from "../hooks/useWingmanEvents";
import { songLabel } from "../stats";
import "./LatestScores.css";

// A duet has two singers, USDX allows more; a handful covers the last song and
// leaves headroom without pulling the whole history onto the TV.
const LIMIT = 12;

/**
 * The result screen on the TV: what the song that just finished scored.
 *
 * Seeded from `/stats/latest` so a reload right after a song still shows it,
 * refreshed when USDX reports new scores, and cleared once the next song starts.
 */
export default function LatestScores() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);

  const canView = auth.can("stats.view");
  const latest = useQuery({
    ...listLatestScoresOptions({ query: { limit: LIMIT } }),
    enabled: auth.loaded && canView,
  });

  useWingmanEvent("scores.recorded", () => {
    setDismissed(false);
    void queryClient.invalidateQueries({
      queryKey: listLatestScoresQueryKey({ query: { limit: LIMIT } }),
    });
  });
  useWingmanEvent("karaoke.started", () => setDismissed(true));

  if (!canView || dismissed) return null;

  // The list is newest first and one sing's scores share a `sing_id`, so the
  // first row's sing is the one that just finished.
  const all = latest.data?.scores ?? [];
  const sing = all[0]?.sing_id;
  const scores = all
    .filter((score) => score.sing_id === sing)
    .sort((a, b) => b.score - a.score);
  if (scores.length === 0) return null;

  return (
    <section className="latest-scores" aria-label="Latest scores">
      <h2>{songLabel(scores[0])}</h2>
      <ol>
        {scores.map((score) => (
          <li key={score.id}>
            <span className="latest-scores-name">{score.player_name}</span>
            <span className="latest-scores-value">{score.score}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
